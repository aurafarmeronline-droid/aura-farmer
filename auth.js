/* ============================================================
   AURA FARMER — auth.js
   v0.3-web (v2.1.7) — regla de conflicto: si la nube tiene un nombre
     residual "Usuario XXXX" (del bug viejo) y lo local trae el nombre real
     de Google, se corrige y se re-sube. Rompe el círculo del nombre pegado.
   v0.2-web — proyectarUsuario() ahora expone 'foto' (photoURL de Google),
     usada por el panel VS del farmeo (v1.2.2). Cambio aditivo: nada de lo
     anterior depende del campo nuevo.
   v0.1-web — AuthService: login con Google (Firebase Auth) + sincronización
   de perfil con la nube (/usuarios/{uid}). Único módulo que toca Firebase
   Auth, igual que store.js con localStorage y online.js con Realtime DB
   para salas. Todo lo demás ve datos planos por callback.

   REGLA DE CONFLICTO (decidida con Maxi): si ya hay perfil en la nube para
   esa cuenta, LA NUBE MANDA — pisa lo local. Si es la primera vez que esa
   cuenta Google entra (no hay perfil nube todavía), lo local sube como
   semilla de la cuenta nueva. Nunca se mezclan datos parcialmente.

   DISEÑO DEFENSIVO (aditivo, nunca rompe el modo sin cuenta):
     - Si Firebase/Auth no cargó → estaDisponible()===false, el juego
       sigue 100% local (igual criterio que online.js).
     - Login roto/cancelado (popup cerrado, bloqueado) → no crashea,
       onError avisa y se sigue en modo local.
     - Fallo de red al leer /usuarios/{uid} → NO se pisa lo local con
       vacío; se sigue con lo local y se loguea el warning.

   REGLAS DE SEGURIDAD (agregar en Firebase Console → Realtime DB → Reglas,
   junto a "salas"/"cola"/"colaNotificaciones" que ya existen):
     "usuarios": {
       "$uid": {
         ".read":  "auth != null && auth.uid === $uid",
         ".write": "auth != null && auth.uid === $uid"
       }
     }
   A diferencia de salas/cola (abiertas a propósito), acá SÍ conviene
   restringir: cada cuenta solo lee/escribe su propio perfil.

   PASO PREVIO EN FIREBASE (fuera de este archivo, ya hecho por Maxi):
     Authentication → Sign-in method → habilitar Google.
     Authentication → Settings → Authorized domains → agregar el dominio
     de GitHub Pages.
   ============================================================ */

const AuthService = (() => {

  /* Misma config que online.js (mismo proyecto Firebase, bc36a). */
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyDg7uwrgypu6dYd1AVQaKs3NS66xBV9qSE',
    authDomain:        'aura-farmer-bc36a.firebaseapp.com',
    databaseURL:       'https://aura-farmer-bc36a-default-rtdb.firebaseio.com',
    projectId:         'aura-farmer-bc36a',
    storageBucket:     'aura-farmer-bc36a.firebasestorage.app',
    messagingSenderId: '1059874986011',
    appId:             '1:1059874986011:web:eb8d406f6adc13c30fc0be'
  };

  let fb = null;            // { app, db, auth, DB, AUTH } o null
  let disponible = false;
  let usuario = null;       // { uid, nombre, email } o null (no logueado)
  const listeners = new Set();   // callbacks de onCambioSesion

  /* ═══════════════════════════════════════════════════════════
     LÓGICA PURA — sin Firebase, sin DOM. Testeable con Node directo.
     ═══════════════════════════════════════════════════════════ */

  /**
   * REGLA DE CONFLICTO, pura. Decide qué perfil queda tras loguear.
   *   - hay perfil nube  → 'usar-nube'   (la nube pisa lo local)
   *   - NO hay perfil nube → 'subir-local' (lo local sube como semilla)
   *
   * v2.1.7 — EXCEPCIÓN: si el nombre en la nube es un "Usuario XXXX" residual
   * (quedó del bug viejo donde el invitado pisaba el nombre de Google), y lo
   * local trae un nombre real, preferimos el nombre local pero conservamos los
   * datos de la nube (puntaje/historial/monedas). Rompe el círculo del nombre
   * pegado sin perder el progreso de la cuenta.
   */
  function esNombreResidual(nombre) {
    return /^Usuario \d{3,4}$/.test(String(nombre || '').trim());
  }

  function resolverConflicto(perfilNube, perfilLocal) {
    if (perfilNube && perfilNube.perfil) {
      const nombreNube  = perfilNube.perfil.nombre;
      const nombreLocal = perfilLocal && perfilLocal.perfil && perfilLocal.perfil.nombre;
      // Si la nube tiene un nombre residual y lo local trae uno real, corregimos.
      if (esNombreResidual(nombreNube) && nombreLocal && !esNombreResidual(nombreLocal)) {
        const corregido = JSON.parse(JSON.stringify(perfilNube));
        corregido.perfil.nombre = nombreLocal;
        if (perfilLocal.perfil.foto) corregido.perfil.foto = perfilLocal.perfil.foto;
        return { accion: 'usar-nube-corregida', datos: corregido };
      }
      return { accion: 'usar-nube', datos: perfilNube };
    }
    return { accion: 'subir-local', datos: perfilLocal };
  }

  /** Traduce el usuario crudo de Firebase Auth a datos planos. PURA.
   *  v0.2-web: se agrega 'foto' (photoURL de Google) para el avatar del
   *  panel VS de la pantalla de farmeo. Campo opcional: null si la cuenta
   *  no tiene imagen, y nadie debe asumir que existe. */
  function proyectarUsuario(fbUser) {
    if (!fbUser) return null;
    return {
      uid:    fbUser.uid,
      nombre: fbUser.displayName || 'Jugador',
      email:  fbUser.email || null,
      foto:   fbUser.photoURL || null
    };
  }

  /* ═══════════════════════════════════════════════════════════
     CAPA FIREBASE
     ═══════════════════════════════════════════════════════════ */

  /** Inicializa Firebase Auth. Idempotente. No crashea si falta el SDK. */
  function init() {
    if (disponible) return true;
    const F = (typeof window !== 'undefined') ? window.__FIREBASE__ : null;
    if (!F || !F.initializeApp || !F.AUTH || !F.DB) {
      console.warn('AuthService: SDK de Firebase no cargado en window.__FIREBASE__.');
      return false;
    }
    try {
      // Reusa la misma app que online.js si ya existe (evita "app duplicada");
      // si no, la crea. getApps()/getApp() vienen del propio módulo firebase-app,
      // que no importamos acá — más simple: cada módulo puede initializeApp con
      // la misma config, Firebase deduplica por nombre de app internamente.
      const app  = F.initializeApp(FIREBASE_CONFIG);
      const db   = F.DB.getDatabase(app);
      const auth = F.AUTH.getAuth(app);
      fb = { app, db, auth, DB: F.DB, AUTH: F.AUTH };
      disponible = true;

      F.AUTH.onAuthStateChanged(auth, (fbUser) => {
        usuario = proyectarUsuario(fbUser);
        listeners.forEach(cb => { try { cb(usuario); } catch (e) { console.warn('AuthService listener:', e); } });
      });

      return true;
    } catch (err) {
      console.error('AuthService init falló:', err);
      return false;
    }
  }

  function estaDisponible() { return disponible; }
  function estaLogueado()   { return !!usuario; }
  function usuarioActual()  { return usuario; }

  /** Avisa cuando cambia el estado de sesión (login/logout). Devuelve función para desuscribirse. */
  function onCambioSesion(callback) {
    listeners.add(callback);
    if (usuario !== undefined) callback(usuario);   // estado inicial inmediato
    return () => listeners.delete(callback);
  }

  /**
   * Login con Google vía popup. No bloqueante en el sentido de que el popup
   * lo maneja el navegador; esta función SÍ espera el resultado.
   * @returns {Promise<{uid,nombre,email}>}
   */
  async function iniciarSesionGoogle() {
    if (!disponible && !init()) throw new Error('auth-no-disponible');
    const { GoogleAuthProvider, signInWithPopup } = fb.AUTH;
    const provider = new GoogleAuthProvider();
    try {
      const res = await signInWithPopup(fb.auth, provider);
      return proyectarUsuario(res.user);
    } catch (err) {
      // Errores comunes y esperables (caso borde 1): no son "fallas" del
      // sistema, son decisiones del usuario. Los dejamos pasar tal cual
      // para que app.js decida el mensaje.
      throw err;
    }
  }

  async function cerrarSesion() {
    if (!disponible) return;
    const { signOut } = fb.AUTH;
    await signOut(fb.auth).catch(() => {});
  }

  /**
   * Sincroniza el perfil local con la nube al loguear, aplicando la regla
   * de conflicto pura. Si falla la lectura de red, NO pisa lo local
   * (caso borde 2): devuelve lo local tal cual y loguea el warning.
   * @param {Object} perfilLocalActual - Store.exportarTodo()
   * @returns {Promise<Object>} el perfil final a aplicar (para Store.reemplazarPerfil)
   */
  async function sincronizarPerfil(perfilLocalActual) {
    if (!disponible || !usuario) return perfilLocalActual;
    const { ref, get, set } = fb.DB;
    const uidRef = ref(fb.db, 'usuarios/' + usuario.uid);

    let perfilNube = null;
    try {
      const snap = await get(uidRef);
      perfilNube = snap.exists() ? snap.val() : null;
    } catch (err) {
      console.warn('AuthService sincronizarPerfil: no se pudo leer la nube, sigo con lo local.', err);
      return perfilLocalActual;
    }

    const { accion, datos } = resolverConflicto(perfilNube, perfilLocalActual);

    // subir-local (semilla) o usar-nube-corregida (arreglar nombre residual):
    // en ambos casos escribimos la nube con los datos resultantes.
    if (accion === 'subir-local' || accion === 'usar-nube-corregida') {
      try { await set(uidRef, datos); }
      catch (err) { console.warn('AuthService sincronizarPerfil: no se pudo subir.', err); }
      return datos;
    }
    // accion === 'usar-nube': la nube ya tiene el estado correcto, se aplica tal cual.
    return datos;
  }

  /** Sube el estado local actual a la nube (llamar tras cada resultado si hay sesión). */
  async function subirPerfil(perfilLocalActual) {
    if (!disponible || !usuario) return;
    const { ref, set } = fb.DB;
    try {
      await set(ref(fb.db, 'usuarios/' + usuario.uid), perfilLocalActual);
    } catch (err) {
      console.warn('AuthService subirPerfil:', err);
    }
  }

  return {
    init, estaDisponible, estaLogueado, usuarioActual, onCambioSesion,
    iniciarSesionGoogle, cerrarSesion, sincronizarPerfil, subirPerfil,
    _puras: { resolverConflicto, proyectarUsuario }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthService;
} else {
  window.AuthService = AuthService;
}
