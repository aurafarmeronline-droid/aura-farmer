/* ============================================================
   AURA FARMER — store.js
   v0.12-web (v1.4.1 del proyecto) — MODELO INVITADO vs CUENTA:
     · Invitado temporal (tipo agar.io): nombre "Usuario xxxx", vive en
       sessionStorage → se borra SOLO al cerrar la pestaña. Sin código de
       limpieza que pueda fallar: el navegador lo tira al cerrar.
     · Cuenta Google: perfil persistente en localStorage, atado al email.
       Sobrevive cierres, sincroniza con la nube (auth.js).
     · Nuevos campos de perfil: monedas y resets (además de W/L/E/puntaje).
     El modo lo fija app.js: entrarComoInvitado() o entrarComoCuenta().
   v0.11-web — reemplazarPerfil() y exportarTodo() para sincronizar con
     Google (Entrega B): la nube pisa lo local, o lo local sube de semilla.
   v0.10-web — guardarNombre() con validación (trim/cap 20/no vacío) +
     nombreEsDefault() para disparar onboarding la primera vez.
   v0.9-web — Store: persistencia de perfil + historial.
   Único módulo que toca el almacenamiento del navegador. Si no está
   disponible (incógnito estricto, cuota llena, JSON corrupto), degrada a
   memoria en RAM sin crashear — el juego sigue jugable, solo no persiste.
   ============================================================ */

const Store = (() => {
  const KEY = 'aurafarmer_v1';
  const HISTORIAL_MAX = 20;

  // Campos nuevos (monedas/resets) con default 0: perfiles viejos guardados
  // sin estos campos los completan al cargar (ver normalizarPerfil).
  const DEFAULT_DATA = {
    perfil: {
      nombre: 'Vos', puntajeTotal: 0,
      victorias: 0, derrotas: 0, empates: 0,
      monedas: 0, resets: 0
    },
    historial: []
  };

  // Fallback en memoria si el storage no está disponible o falla.
  let memoriaFallback = null;

  /* MODO de almacenamiento. Por defecto arranca en localStorage (persistente)
   * para no romper el comportamiento previo; app.js lo cambia a invitado
   * (sessionStorage) cuando el jugador elige "jugar sin cuenta". */
  let modoInvitado = false;

  /** Devuelve el storage activo según el modo. Invitado → session; cuenta → local. */
  function storageActivo() {
    return modoInvitado ? window.sessionStorage : window.localStorage;
  }

  /** Chequea que un storage puntual (local o session) sea usable. */
  function storageUsable(storage) {
    try {
      const test = '__test__';
      storage.setItem(test, '1');
      storage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  function storageDisponible() {
    return storageUsable(storageActivo());
  }

  const persistente = storageUsable(window.localStorage);
  if (!persistente) {
    console.warn('Store: localStorage no disponible, usando memoria (no persiste al recargar).');
  }

  /**
   * Fija el modo de almacenamiento. Lo llama app.js al elegir identidad.
   *   'invitado' → sessionStorage (temporal, se borra al cerrar pestaña)
   *   'cuenta'   → localStorage (persistente, para sesión Google)
   * Cambiar de modo NO migra datos: cada modo tiene su propio espacio.
   */
  function fijarModo(modo) {
    modoInvitado = (modo === 'invitado');
  }

  /** Genera un nombre de invitado tipo "Usuario 4821" (como agar.io). */
  function nombreInvitadoAleatorio(rng = Math.random) {
    return 'Usuario ' + Math.floor(1000 + rng() * 9000);
  }

  /** Completa campos faltantes en perfiles viejos (monedas/resets). */
  function normalizarPerfil(perfil) {
    return {
      nombre:       typeof perfil.nombre === 'string' ? perfil.nombre : 'Vos',
      puntajeTotal: Number(perfil.puntajeTotal) || 0,
      victorias:    Number(perfil.victorias) || 0,
      derrotas:     Number(perfil.derrotas) || 0,
      empates:      Number(perfil.empates) || 0,
      monedas:      Number(perfil.monedas) || 0,
      resets:       Number(perfil.resets) || 0
    };
  }

  /** Carga los datos guardados, o defaults si no hay nada / están corruptos.
   *  Lee del storage ACTIVO (session si invitado, local si cuenta) y completa
   *  campos nuevos (monedas/resets) en perfiles guardados por versiones viejas. */
  function cargar() {
    if (!storageDisponible()) {
      const base = memoriaFallback || structuredClone(DEFAULT_DATA);
      base.perfil = normalizarPerfil(base.perfil);
      return base;
    }
    try {
      const raw = storageActivo().getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_DATA);
      const data = JSON.parse(raw);
      // Validación mínima de forma esperada; si está corrupto, reseteamos limpio.
      if (!data.perfil || !Array.isArray(data.historial)) {
        console.warn('Store: datos corruptos, reseteando.');
        return structuredClone(DEFAULT_DATA);
      }
      data.perfil = normalizarPerfil(data.perfil);  // completa monedas/resets
      return data;
    } catch (err) {
      console.warn('Store: error leyendo storage, reseteando.', err);
      return structuredClone(DEFAULT_DATA);
    }
  }

  /** Guarda en el storage ACTIVO. Si falla (cuota, etc.), cae a memoria. */
  function guardar(data) {
    if (!storageDisponible()) {
      memoriaFallback = data;
      return;
    }
    try {
      storageActivo().setItem(KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Store: no se pudo guardar (cuota?), usando memoria.', err);
      memoriaFallback = data;
    }
  }

  /**
   * Registra el resultado de un duelo terminado: actualiza perfil (W/L/E,
   * puntaje acumulado) y agrega una entrada al historial (tope 20, FIFO).
   * @param {Object} resolucion - { ganador:'A'|'B'|'empate', puntajeA, puntajeB }
   * @param {string} nombreRival
   */
  function guardarResultado({ ganador, puntajeA, puntajeB }, nombreRival) {
    const data = cargar();

    data.perfil.puntajeTotal += puntajeA;
    if (ganador === 'A') data.perfil.victorias += 1;
    else if (ganador === 'B') data.perfil.derrotas += 1;
    else data.perfil.empates += 1;

    data.historial.unshift({
      fecha: new Date().toISOString(),
      rival: nombreRival,
      resultado: ganador === 'A' ? 'victoria' : ganador === 'B' ? 'derrota' : 'empate',
      puntajeMio: puntajeA,
      puntajeRival: puntajeB
    });
    if (data.historial.length > HISTORIAL_MAX) {
      data.historial = data.historial.slice(0, HISTORIAL_MAX);
    }

    guardar(data);
    return data;
  }

  /**
   * Valida y persiste el nombre del jugador. Reglas (ver casos borde A):
   *   - trim de espacios; si queda vacío → se rechaza (devuelve el actual).
   *   - cap a 20 caracteres (mismo límite que online.js/nodoJugador).
   *   - nunca guarda vacío: si no había nombre previo válido, cae a 'Jugador'.
   * NO toca puntajes/W-L-E: solo el nombre. PURA respecto de validación.
   * @param {string} nombreNuevo
   * @returns {string} el nombre final efectivamente aplicado
   */
  function guardarNombre(nombreNuevo) {
    const data = cargar();
    const limpio = String(nombreNuevo || '').trim().slice(0, 20);
    if (limpio.length === 0) {
      // Rechazo: mantengo el que había; si tampoco había, 'Jugador'.
      const actual = (data.perfil.nombre || '').trim();
      return actual || 'Jugador';
    }
    data.perfil.nombre = limpio;
    guardar(data);
    return limpio;
  }

  /** ¿El perfil todavía es el default de fábrica? (para disparar onboarding). */
  function nombreEsDefault() {
    const n = (cargar().perfil.nombre || '').trim();
    return n === '' || n === 'Vos';
  }

  function obtenerPerfil() {
    return cargar().perfil;
  }

  function obtenerHistorial() {
    return cargar().historial;
  }

  /**
   * Sobrescribe TODO el local (perfil + historial) con lo que venga de la
   * nube. Usada por auth.js cuando "Google manda" (regla de conflicto B).
   * Valida forma mínima para no aceptar basura y romper el juego.
   * @param {{perfil:Object, historial:Array}} data
   * @returns {boolean} true si se aplicó
   */
  function reemplazarPerfil(data) {
    if (!data || !data.perfil || typeof data.perfil.nombre !== 'string') return false;
    const limpio = {
      perfil: {
        nombre:       String(data.perfil.nombre || 'Jugador').trim().slice(0, 20) || 'Jugador',
        puntajeTotal: Number(data.perfil.puntajeTotal) || 0,
        victorias:    Number(data.perfil.victorias) || 0,
        derrotas:     Number(data.perfil.derrotas) || 0,
        empates:      Number(data.perfil.empates) || 0,
        monedas:      Number(data.perfil.monedas) || 0,
        resets:       Number(data.perfil.resets) || 0
      },
      historial: Array.isArray(data.historial) ? data.historial.slice(0, HISTORIAL_MAX) : []
    };
    guardar(limpio);
    return true;
  }

  /** Todo el estado local tal cual, para subirlo a la nube (semilla de cuenta nueva). */
  function exportarTodo() {
    return cargar();
  }

  /* ── Monedas / resets ──────────────────────────────────────────────────
   * Ajustan el saldo sin tocar el resto del perfil. delta puede ser negativo.
   * Monedas nunca bajan de 0 (no queremos saldo negativo). */
  function sumarMonedas(delta) {
    const data = cargar();
    data.perfil.monedas = Math.max(0, data.perfil.monedas + (Number(delta) || 0));
    guardar(data);
    return data.perfil.monedas;
  }

  function registrarReset() {
    const data = cargar();
    data.perfil.resets += 1;
    guardar(data);
    return data.perfil.resets;
  }

  return {
    cargar, guardarResultado, guardarNombre, nombreEsDefault, obtenerPerfil, obtenerHistorial,
    reemplazarPerfil, exportarTodo,
    // v0.12: modo invitado/cuenta + economía
    fijarModo, nombreInvitadoAleatorio, sumarMonedas, registrarReset
  };
})();

window.Store = Store;
