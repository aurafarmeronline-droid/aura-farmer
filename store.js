/* ============================================================
   AURA FARMER — store.js
   v0.10-web — guardarNombre() con validación (trim/cap 20/no vacío) +
     nombreEsDefault() para disparar onboarding la primera vez.
   v0.9-web — Store: persistencia de perfil + historial.
   Único módulo que toca localStorage. Si no está disponible
   (incógnito estricto, cuota llena, JSON corrupto), degrada a
   memoria en RAM sin crashear — el juego sigue jugable, solo
   no persiste entre sesiones.
   ============================================================ */

const Store = (() => {
  const KEY = 'aurafarmer_v1';
  const HISTORIAL_MAX = 20;

  const DEFAULT_DATA = {
    perfil: { nombre: 'Vos', puntajeTotal: 0, victorias: 0, derrotas: 0, empates: 0 },
    historial: []
  };

  // Fallback en memoria si localStorage no está disponible o falla.
  let memoriaFallback = null;

  function localStorageDisponible() {
    try {
      const test = '__test__';
      window.localStorage.setItem(test, '1');
      window.localStorage.removeItem(test);
      return true;
    } catch {
      return false;
    }
  }

  const persistente = localStorageDisponible();
  if (!persistente) {
    console.warn('Store: localStorage no disponible, usando memoria (no persiste al recargar).');
  }

  /** Carga los datos guardados, o defaults si no hay nada / están corruptos. */
  function cargar() {
    if (!persistente) {
      return memoriaFallback || structuredClone(DEFAULT_DATA);
    }
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULT_DATA);
      const data = JSON.parse(raw);
      // Validación mínima de forma esperada; si está corrupto, reseteamos limpio.
      if (!data.perfil || !Array.isArray(data.historial)) {
        console.warn('Store: datos corruptos, reseteando.');
        return structuredClone(DEFAULT_DATA);
      }
      return data;
    } catch (err) {
      console.warn('Store: error leyendo localStorage, reseteando.', err);
      return structuredClone(DEFAULT_DATA);
    }
  }

  /** Guarda. Si localStorage falla (cuota, etc.), cae a memoria sin crashear. */
  function guardar(data) {
    if (!persistente) {
      memoriaFallback = data;
      return;
    }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
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

  return { cargar, guardarResultado, guardarNombre, nombreEsDefault, obtenerPerfil, obtenerHistorial };
})();

window.Store = Store;
