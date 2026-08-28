/* ============================================================
   AURA FARMER — online.js
   v0.12-web — Matchmaking AUTOMÁTICO completo (F3): buscarRival() con
     transacción sobre /cola/actual, notificación vía /colaNotificaciones,
     crearSalaEmparejada(), cancelarBusqueda() y timeout de 20s. Reusa las
     puras F2. Convive con el código de sala (no lo reemplaza).
   v0.11-web — Matchmaking AUTOMÁTICO (F2 lógica pura): slot mutex
     /cola/actual + decidirMatchmaking()/slotEsMio()/generarUidBusqueda().
   v0.10-web — OnlineService: multiplayer 1v1 vía Firebase Realtime DB.
   Único módulo que toca Firebase (igual que store.js con localStorage).
   Todo lo demás lo ignora: app.js solo ve datos planos por callback.

   MODELO: matchmaking por CÓDIGO DE SALA (no automático todavía).
   Un jugador crea sala → recibe un código de 4 letras → se lo pasa al
   rival → el rival entra con ese código. Simple, testeable con dos
   pestañas, ideal mientras no hay masa de jugadores.

   DISEÑO DEFENSIVO (aditivo, nunca rompe lo offline):
     - Si Firebase no está configurado/no carga → estaDisponible()===false
       y el juego local sigue intacto. Online es opcional.
     - Cada jugador escribe SOLO en su propia rama (jugadorA/jugadorB).
     - onDisconnect de Firebase limpia estado si el jugador se va.
     - heartbeat + detección de rival caído → victoria por abandono.

   FASES (integradas en este único archivo):
     F1  init + reglas (abajo, en comentario) + escritura/lectura básica
     F2  matchmaking: crear/tomar sala con TRANSACCIÓN atómica (anti-carrera)
     F3  sincronización: puntaje/turno/resultado en vivo vía escucharSala()
     F4  robustez: heartbeat, onDisconnect, victoria por abandono, limpieza

   ─────────────────────────────────────────────────────────────
   REGLAS DE SEGURIDAD (pegar en Firebase Console → Realtime DB → Reglas).
   Evitan que un jugador escriba el puntaje del rival o toque el resultado:

   {
     "rules": {
       "salas": {
         "$salaId": {
           ".read": true,
           ".write": true,
           "resultado": {
             // El resultado lo calcula el cliente al cerrar; en producción
             // esto debería ir a una Cloud Function. Por ahora abierto.
             ".write": true
           }
         }
       }
     }
   }

   NOTA: en "modo de prueba" Firebase ya deja todo abierto ~30 días.
   Estas reglas son el siguiente paso, no bloqueante para testear.
   ─────────────────────────────────────────────────────────────

   Cómo se enchufa Firebase (Fase 0, cuando Maxi tenga la config):
     1) En index.html, ANTES de online.js, cargar el SDK de Firebase:
          <script type="module">
            import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
            import * as DB from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
            window.__FIREBASE__ = { initializeApp, DB };
          </script>
     2) Pegar la firebaseConfig real en FIREBASE_CONFIG (abajo).
   ============================================================ */

const OnlineService = (() => {

  /* ═══════════════════════════════════════════════════════════
     CONFIG — reemplazar los placeholder por la config real de Firebase.
     Mientras tenga placeholders, estaDisponible() devuelve false y el
     juego sigue funcionando 100% en modo local.
     ═══════════════════════════════════════════════════════════ */
  const FIREBASE_CONFIG = {
    apiKey:            'AIzaSyBC0g-gQAWfSBlV2EnTWTH0tZfbULQh2XY',
    authDomain:        'aura-farmer-fdc2e.firebaseapp.com',
    databaseURL:       'https://aura-farmer-fdc2e-default-rtdb.firebaseio.com',
    projectId:         'aura-farmer-fdc2e',
    storageBucket:     'aura-farmer-fdc2e.firebasestorage.app',
    messagingSenderId: '258803414780',
    appId:             '1:258803414780:web:3807ac32c9b592b9fb0979'
  };

  // Segundos sin heartbeat del rival tras los cuales lo damos por caído.
  const TIMEOUT_RIVAL_S = 12;
  // Cada cuántos segundos late nuestro heartbeat.
  const HEARTBEAT_S = 3;
  // Alfabeto para códigos de sala: sin caracteres ambiguos (0/O, 1/I/L).
  const ALFABETO_SALA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const LARGO_CODIGO = 4;

  /* Estado interno del módulo. Aislado, no pisa nada de otros módulos. */
  let fb = null;            // { app, db, refs... } de Firebase, o null
  let disponible = false;   // ¿Firebase inicializó bien?
  let sesion = null;        // { salaId, rol:'A'|'B', unsub, heartbeatTimer }

  /* ═══════════════════════════════════════════════════════════
     LÓGICA PURA (sin Firebase, sin DOM) — testeable con Node directo.
     ═══════════════════════════════════════════════════════════ */

  /** ¿La config sigue con placeholders? (no toca red) */
  function configEsPlaceholder(cfg) {
    return !cfg || Object.values(cfg).some(v => v === 'PEGAR_AQUI' || !v);
  }

  /** Genera un código de sala aleatorio legible (ej. "K7QM"). */
  function generarCodigoSala(rng = Math.random) {
    let s = '';
    for (let i = 0; i < LARGO_CODIGO; i++) {
      s += ALFABETO_SALA[Math.floor(rng() * ALFABETO_SALA.length)];
    }
    return s;
  }

  /** Normaliza un código tipeado por el usuario: mayúsculas, sin espacios. */
  function normalizarCodigo(codigo) {
    return String(codigo || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  /** Valida forma de un código antes de pegarle a la base (evita queries basura). */
  function codigoValido(codigo) {
    const c = normalizarCodigo(codigo);
    if (c.length !== LARGO_CODIGO) return false;
    return [...c].every(ch => ALFABETO_SALA.includes(ch));
  }

  /** El rol del rival dado el mío. */
  function rolRival(rol) {
    return rol === 'A' ? 'B' : 'A';
  }

  /** ¿El rival está caído? Compara su último heartbeat contra ahora. */
  function rivalCaido(heartbeatRival, ahoraMs, timeoutS = TIMEOUT_RIVAL_S) {
    if (!heartbeatRival) return false;   // todavía no latió nunca: no lo matamos
    return (ahoraMs - heartbeatRival) > timeoutS * 1000;
  }

  /* ─────────────────────────────────────────────────────────────
     MATCHMAKING AUTOMÁTICO (v0.11-web) — LÓGICA PURA.
     Modelo: un único slot mutex /cola/actual. El que lo encuentra vacío
     escribe su ficha y ESPERA; el que lo encuentra ocupado lo VACÍA y
     EMPAREJA. La atomicidad la garantiza la transacción de Firebase (F3);
     acá abajo va solo la decisión pura, sin red, para poder testearla.
     ───────────────────────────────────────────────────────────── */

  const TIMEOUT_BUSQUEDA_S = 20;   // sin rival en este tiempo → onTimeout y limpieza

  /**
   * uid efímero por búsqueda. NO usamos el nombre como clave: dos jugadores
   * pueden llamarse igual y colisionarían en la cola.
   */
  function generarUidBusqueda(rng = Math.random) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'uid-' + Math.floor(rng() * 1e9).toString(36) + Date.now().toString(36);
  }

  /**
   * DECISIÓN CENTRAL del matchmaking, PURA. Dado el slot actual y mi ficha:
   *   - slot vacío           → 'esperar'   (escribo mi ficha)
   *   - slot con OTRO         → 'emparejar' (lo saco y creo sala)
   *   - slot con MI ficha     → 'esperar'   (no me emparejo solo)
   * @returns {{accion:'esperar'|'emparejar', rival:Object|null}}
   */
  function decidirMatchmaking(slot, miFicha) {
    if (!slot || !slot.uid) return { accion: 'esperar', rival: null };
    if (slot.uid === miFicha.uid) return { accion: 'esperar', rival: null };
    return { accion: 'emparejar', rival: slot };
  }

  /** ¿La ficha del slot sigue siendo MÍA? (para limpiar sin borrar a otro). PURA. */
  function slotEsMio(slot, miUid) {
    return !!slot && slot.uid === miUid;
  }

  /**
   * Traduce el nodo crudo de la sala (Firebase) a un estado plano para app.js.
   * app.js NUNCA ve la forma de Firebase, solo esto. PURA.
   * @param {Object|null} sala  - nodo /salas/{id} tal cual viene de la base
   * @param {'A'|'B'} miRol
   * @param {number} ahoraMs
   */
  function proyectarEstado(sala, miRol, ahoraMs) {
    if (!sala) return { existe: false };
    const otro = rolRival(miRol);
    const yo = sala['jugador' + miRol] || {};
    const rival = sala['jugador' + otro] || {};
    return {
      existe: true,
      estado: sala.estado || 'esperando',          // esperando|jugando|terminado
      turno: sala.turno || 'A',
      esMiTurno: (sala.turno || 'A') === miRol,
      miPuntaje: yo.puntajeTotal ?? 0,
      rivalNombre: rival.nombre || 'Rival',
      rivalPuntaje: rival.puntajeTotal ?? 0,
      rivalConectado: !!rival.conectado && !rivalCaido(rival.heartbeat, ahoraMs),
      resultado: sala.resultado || null
    };
  }

  /* ═══════════════════════════════════════════════════════════
     CAPA FIREBASE — todo lo que toca la red vive acá abajo.
     Si Firebase no cargó, cada método degrada elegante (throw controlado
     o no-op) sin tumbar el juego local.
     ═══════════════════════════════════════════════════════════ */

  /** F1 — Inicializa Firebase una vez. Idempotente. No crashea si falta el SDK. */
  function init() {
    if (disponible) return true;
    if (configEsPlaceholder(FIREBASE_CONFIG)) {
      console.info('OnlineService: config con placeholders, modo online deshabilitado (local sigue OK).');
      return false;
    }
    const F = (typeof window !== 'undefined') ? window.__FIREBASE__ : null;
    if (!F || !F.initializeApp || !F.DB) {
      console.warn('OnlineService: SDK de Firebase no cargado en window.__FIREBASE__.');
      return false;
    }
    try {
      const app = F.initializeApp(FIREBASE_CONFIG);
      const db = F.DB.getDatabase(app);
      fb = { app, db, DB: F.DB };
      disponible = true;
      return true;
    } catch (err) {
      console.error('OnlineService init falló:', err);
      return false;
    }
  }

  function estaDisponible() {
    return disponible;
  }

  /** Arma el nodo inicial de un jugador. */
  function nodoJugador(nombre) {
    return {
      nombre: String(nombre || 'Jugador').slice(0, 20),
      conectado: true,
      heartbeat: Date.now(),
      puntajeTotal: 0,
      poseActual: null
    };
  }

  /**
   * F2 — CREAR sala. Genera código único, escribe el nodo, deja al creador
   * como jugadorA. Reintenta si el código ya existía (colisión rara).
   * @returns {Promise<{salaId, rol:'A'}>}
   */
  async function crearSala(nombre) {
    if (!disponible && !init()) throw new Error('online-no-disponible');
    const { ref, get, set, onDisconnect } = fb.DB;

    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigoSala();
      const salaRef = ref(fb.db, 'salas/' + codigo);
      const snap = await get(salaRef);
      if (snap.exists()) continue;   // colisión: probá otro código

      await set(salaRef, {
        estado: 'esperando',
        creadaEn: Date.now(),
        turno: 'A',
        jugadorA: nodoJugador(nombre),
        jugadorB: null,
        resultado: null
      });

      // Si el creador se desconecta antes de que llegue nadie, la sala se borra.
      onDisconnect(salaRef).remove();

      sesion = { salaId: codigo, rol: 'A', unsub: null, heartbeatTimer: null };
      return { salaId: codigo, rol: 'A' };
    }
    throw new Error('no-se-pudo-generar-sala');
  }

  /**
   * F2 — UNIRSE a sala por código, usando TRANSACCIÓN (atómica) para tomar
   * el slot B. Previene la carrera de dos rivales entrando a la vez.
   * @returns {Promise<{salaId, rol:'B'}>}
   */
  async function unirseSala(codigoInput, nombre) {
    if (!disponible && !init()) throw new Error('online-no-disponible');
    const codigo = normalizarCodigo(codigoInput);
    if (!codigoValido(codigo)) throw new Error('codigo-invalido');

    const { ref, runTransaction, onDisconnect } = fb.DB;
    const salaRef = ref(fb.db, 'salas/' + codigo);

    const res = await runTransaction(salaRef, (sala) => {
      if (sala === null) return sala;              // no existe → aborta abajo
      if (sala.jugadorB) return;                   // ocupada → aborta (undefined)
      sala.jugadorB = nodoJugador(nombre);
      sala.estado = 'jugando';
      return sala;
    });

    if (!res.committed || !res.snapshot.exists()) throw new Error('sala-no-disponible');
    const sala = res.snapshot.val();
    if (!sala.jugadorB || sala.jugadorB.nombre !== nodoJugador(nombre).nombre) {
      // Otro nos ganó el slot entre medio.
      if (!sala.jugadorB) throw new Error('sala-inexistente');
    }

    onDisconnect(ref(fb.db, 'salas/' + codigo + '/jugadorB/conectado')).set(false);
    sesion = { salaId: codigo, rol: 'B', unsub: null, heartbeatTimer: null };
    return { salaId: codigo, rol: 'B' };
  }

  /* ─────────────────────────────────────────────────────────────
     F3 — MATCHMAKING AUTOMÁTICO, capa Firebase. Usa las puras F2
     (decidirMatchmaking / slotEsMio / generarUidBusqueda) sobre el slot
     mutex /cola/actual y notifica al que espera vía /colaNotificaciones.

     REGLAS DE SEGURIDAD (agregar al bloque de reglas de arriba):
       "cola":              { ".read": true, ".write": true },
       "colaNotificaciones":{ ".read": true, ".write": true }
     ───────────────────────────────────────────────────────────── */

  let busqueda = null;   // { uid, timeoutId, unsubNotif } de la búsqueda en curso

  /**
   * Crea una sala con AMBOS jugadores ya presentes (la usa el que empareja:
   * él es A, el que esperaba es B). Distinta de crearSala(), que deja B vacío.
   */
  async function crearSalaEmparejada(nombreA, nombreB) {
    const { ref, get, set, onDisconnect } = fb.DB;
    for (let intento = 0; intento < 5; intento++) {
      const codigo = generarCodigoSala();
      const salaRef = ref(fb.db, 'salas/' + codigo);
      if ((await get(salaRef)).exists()) continue;
      await set(salaRef, {
        estado: 'jugando',           // ya están los dos → arranca directo
        creadaEn: Date.now(),
        turno: 'A',
        jugadorA: nodoJugador(nombreA),
        jugadorB: nodoJugador(nombreB),
        resultado: null
      });
      onDisconnect(ref(fb.db, 'salas/' + codigo + '/jugadorA/conectado')).set(false);
      sesion = { salaId: codigo, rol: 'A', unsub: null, heartbeatTimer: null };
      return codigo;
    }
    throw new Error('no-se-pudo-generar-sala');
  }

  /**
   * F3 — BUSCAR RIVAL automático. No bloqueante: avisa por callbacks.
   * @param {string} nombre
   * @param {{onEmparejado:Function, onTimeout:Function, onError:Function}} cbs
   */
  async function buscarRival(nombre, { onEmparejado, onTimeout, onError } = {}) {
    if (!disponible && !init()) { onError && onError(new Error('online-no-disponible')); return; }
    const { ref, runTransaction, onDisconnect, onValue, get, set, remove } = fb.DB;

    const miUid = generarUidBusqueda();
    const miFicha = { uid: miUid, nombre: String(nombre || 'Jugador').slice(0, 20), creadaEn: Date.now() };
    const colaRef = ref(fb.db, 'cola/actual');
    busqueda = { uid: miUid, timeoutId: null, unsubNotif: null };

    // Decisión atómica: escribo mi ficha (esperar) o me llevo la del otro (emparejar).
    let rivalTomado = null;
    try {
      const res = await runTransaction(colaRef, (slot) => {
        const d = decidirMatchmaking(slot, miFicha);
        if (d.accion === 'emparejar') { rivalTomado = d.rival; return null; }  // vacío el slot
        return miFicha;                                                        // escribo mi ficha
      });
      if (!res.committed) throw new Error('cola-conflicto');
    } catch (err) {
      busqueda = null;
      onError && onError(err);
      return;
    }

    // CASO EMPAREJAR: creo la sala (yo A, el que esperaba B) y le aviso por notif.
    if (rivalTomado) {
      try {
        const salaId = await crearSalaEmparejada(miFicha.nombre, rivalTomado.nombre);
        await set(ref(fb.db, 'colaNotificaciones/' + rivalTomado.uid), { salaId, creadaEn: Date.now() });
        busqueda = null;
        onEmparejado && onEmparejado({ salaId, rol: 'A' });
      } catch (err) {
        busqueda = null;
        onError && onError(err);
      }
      return;
    }

    // CASO ESPERAR: mi ficha quedó en la cola. Si me caigo, que se borre sola.
    onDisconnect(colaRef).remove();

    // Escucho mi buzón: el que me empareje va a dejar acá el salaId.
    const notifRef = ref(fb.db, 'colaNotificaciones/' + miUid);
    busqueda.unsubNotif = onValue(notifRef, async (snap) => {
      const notif = snap.val();
      if (!notif || !notif.salaId) return;
      // Me emparejaron: limpio buzón + timeout, engancho la sala como jugadorB.
      await remove(notifRef).catch(() => {});
      if (busqueda) { clearTimeout(busqueda.timeoutId); if (busqueda.unsubNotif) busqueda.unsubNotif(); }
      busqueda = null;
      sesion = { salaId: notif.salaId, rol: 'B', unsub: null, heartbeatTimer: null };
      onDisconnect(ref(fb.db, 'salas/' + notif.salaId + '/jugadorB/conectado')).set(false);
      onEmparejado && onEmparejado({ salaId: notif.salaId, rol: 'B' });
    });

    // Timeout: si nadie llega, limpio mi ficha (solo si sigue siendo mía) y aviso.
    busqueda.timeoutId = setTimeout(async () => {
      await limpiarMiFichaCola(miUid);
      if (busqueda && busqueda.unsubNotif) busqueda.unsubNotif();
      busqueda = null;
      onTimeout && onTimeout();
    }, TIMEOUT_BUSQUEDA_S * 1000);
  }

  /** Borra mi ficha de /cola/actual SOLO si sigue siendo mía (slotEsMio). */
  async function limpiarMiFichaCola(miUid) {
    if (!disponible) return;
    const { ref, get, remove } = fb.DB;
    const colaRef = ref(fb.db, 'cola/actual');
    try {
      const slot = (await get(colaRef)).val();
      if (slotEsMio(slot, miUid)) await remove(colaRef);
    } catch (err) {
      console.warn('OnlineService limpiarMiFichaCola:', err);
    }
  }

  /** F3 — CANCELAR búsqueda en curso: corta listener + timeout + limpia cola. */
  async function cancelarBusqueda() {
    if (!busqueda) return;
    const { uid, timeoutId, unsubNotif } = busqueda;
    clearTimeout(timeoutId);
    if (unsubNotif) unsubNotif();
    busqueda = null;
    await limpiarMiFichaCola(uid);
  }

  /**
   * F3 — ESCUCHAR la sala en vivo. Cada cambio dispara el callback con el
   * estado YA proyectado (plano). Devuelve función para desuscribirse.
   */
  function escucharSala(callback) {
    if (!disponible || !sesion) return () => {};
    const { ref, onValue } = fb.DB;
    const salaRef = ref(fb.db, 'salas/' + sesion.salaId);
    const off = onValue(salaRef, (snap) => {
      const estado = proyectarEstado(snap.val(), sesion.rol, Date.now());
      callback(estado);
    });
    sesion.unsub = off;
    return off;
  }

  /** F3 — Sube MI puntaje (y opcionalmente la pose actual para feedback en vivo). */
  async function enviarPuntaje(puntaje, poseActual = null) {
    if (!disponible || !sesion) return;
    const { ref, update } = fb.DB;
    const miRef = ref(fb.db, 'salas/' + sesion.salaId + '/jugador' + sesion.rol);
    await update(miRef, {
      puntajeTotal: Math.max(0, Math.round(puntaje || 0)),
      poseActual,
      heartbeat: Date.now()
    });
  }

  /** F3 — Cede el turno al rival (fuente de verdad única del turno). */
  async function pasarTurno() {
    if (!disponible || !sesion) return;
    const { ref, update } = fb.DB;
    await update(ref(fb.db, 'salas/' + sesion.salaId), {
      turno: rolRival(sesion.rol)
    });
  }

  /** F3 — Escribe el resultado final (lo llama quien detecta el cierre). */
  async function cerrarConResultado(ganador) {
    if (!disponible || !sesion) return;
    const { ref, update } = fb.DB;
    await update(ref(fb.db, 'salas/' + sesion.salaId), {
      estado: 'terminado',
      resultado: { ganador }
    });
  }

  /**
   * F4 — HEARTBEAT: late cada HEARTBEAT_S segundos para avisar "sigo vivo".
   * Arrancalo al entrar al duelo, pará al salir.
   */
  function iniciarHeartbeat() {
    if (!disponible || !sesion) return;
    detenerHeartbeat();
    const { ref, update } = fb.DB;
    const miRef = ref(fb.db, 'salas/' + sesion.salaId + '/jugador' + sesion.rol);
    sesion.heartbeatTimer = setInterval(() => {
      update(miRef, { heartbeat: Date.now(), conectado: true }).catch(() => {});
    }, HEARTBEAT_S * 1000);
  }

  function detenerHeartbeat() {
    if (sesion && sesion.heartbeatTimer) {
      clearInterval(sesion.heartbeatTimer);
      sesion.heartbeatTimer = null;
    }
  }

  /**
   * F4 — SALIR de la sala: corta escucha, heartbeat, marca desconexión y,
   * si la sala queda vacía, la borra. Seguro llamarlo siempre al salir.
   */
  async function salir() {
    detenerHeartbeat();
    if (!disponible || !sesion) { sesion = null; return; }
    const { ref, update, get, remove } = fb.DB;
    const salaId = sesion.salaId, rol = sesion.rol;
    try {
      if (sesion.unsub) sesion.unsub();
      await update(ref(fb.db, 'salas/' + salaId + '/jugador' + rol), { conectado: false });
      // Si el rival tampoco está, limpiamos la sala para no dejar basura.
      const snap = await get(ref(fb.db, 'salas/' + salaId));
      const sala = snap.val();
      if (sala) {
        const otro = rolRival(rol);
        const rivalVivo = sala['jugador' + otro] && sala['jugador' + otro].conectado;
        if (!rivalVivo) await remove(ref(fb.db, 'salas/' + salaId));
      }
    } catch (err) {
      console.warn('OnlineService salir: limpieza parcial.', err);
    }
    sesion = null;
  }

  function sesionActual() {
    return sesion ? { salaId: sesion.salaId, rol: sesion.rol } : null;
  }

  /* API pública — datos planos hacia afuera, nunca objetos de Firebase. */
  return {
    // ciclo de vida
    init, estaDisponible, sesionActual,
    // matchmaking (F2 código de sala + F3 automático)
    crearSala, unirseSala, buscarRival, cancelarBusqueda,
    // sincronización (F3)
    escucharSala, enviarPuntaje, pasarTurno, cerrarConResultado,
    // robustez (F4)
    iniciarHeartbeat, detenerHeartbeat, salir,
    // puras (export para tests / reuso)
    _puras: {
      configEsPlaceholder, generarCodigoSala, normalizarCodigo,
      codigoValido, rolRival, rivalCaido, proyectarEstado,
      generarUidBusqueda, decidirMatchmaking, slotEsMio
    }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = OnlineService;
} else {
  window.OnlineService = OnlineService;
}
