/* ============================================================
   AURA FARMER — spectator.js
   v0.1-web (v2.2.4) — F5 MODO ESPECTADOR, FASE 1: solo estructura.
   Estado propio y aislado (no pisa duelo.js/online.js/camera.js).

   Máquina de estados de 3 modos:
     inactivo   → sin sesión de espectador activa.
     conectando → recién montado, esperando decidir video o esqueleto.
     video      → conexión WebRTC OK, se ve al rival en vivo.
     esqueleto  → fallback: no hubo conexión, se dibujan los landmarks.

   FASE 1 (esta entrega): la transición conectando→video/esqueleto es un
   placeholder con un timeout de demo, SIN RTCPeerConnection real. Deja
   la estructura + el layout listos para que Fase 2 la reemplace por los
   eventos reales (oferta/respuesta/ICE vía OnlineService.enviarSenalizacion
   / escucharSenalizacionRival, más el timeout real de conexión).

   NO TOCA: duelo.js, farmeo.js, poses.js, vision.js, store.js, auth.js,
   player.js. Entradas/salidas modulares, dict de estado propio.
   ============================================================ */

const SpectatorService = (() => {
  const MODOS = ['inactivo', 'conectando', 'video', 'esqueleto'];

  /* Estado interno del módulo. Aislado, no pisa nada de otros módulos. */
  const state = {
    modo: 'inactivo',
    contenedorEl: null,
    timeoutId: null,
    sessionId: 0   // anti-race: cada montar() incrementa
  };

  /* ═══════════════════════════════════════════════════════════
     LÓGICA PURA (sin DOM, sin Firebase) — testeable con Node directo.
     ═══════════════════════════════════════════════════════════ */

  /** Transición de la máquina de estados. Eventos: 'iniciar' | 'conexion-ok'
   *  | 'timeout' | 'detener'. Puro: mismo input siempre da mismo output. */
  function siguienteModo(modoActual, evento) {
    switch (evento) {
      case 'iniciar':
        return 'conectando';
      case 'conexion-ok':
        // Solo "sube" a video si todavía estábamos decidiendo. Si ya
        // caímos a esqueleto (o ya estábamos en video), no hay vuelta atrás
        // en Fase 1 — evita parpadeos si un evento tardío llega de más.
        return modoActual === 'conectando' ? 'video' : modoActual;
      case 'timeout':
        return modoActual === 'conectando' ? 'esqueleto' : modoActual;
      case 'detener':
        return 'inactivo';
      default:
        return modoActual;
    }
  }

  /** Texto de placeholder por modo (Fase 1 — Fase 2 reemplaza 'video' por
   *  el <video> real y 'esqueleto' por el canvas dibujando landmarks). */
  function textoPlaceholder(modo) {
    switch (modo) {
      case 'conectando': return 'Conectando con el rival…';
      case 'video':       return 'Video en vivo (Fase 2)';
      case 'esqueleto':   return 'Esqueleto en vivo (Fase 2)';
      default:            return '';
    }
  }

  /* ═══════════════════════════════════════════════════════════
     DOM — recibe el contenedor ya resuelto (mismo criterio que
     CameraService: no busca IDs por su cuenta, se lo pasan armado).
     ═══════════════════════════════════════════════════════════ */

  function pintar() {
    if (!state.contenedorEl) return;
    state.contenedorEl.textContent = textoPlaceholder(state.modo);
    if (state.contenedorEl.dataset) state.contenedorEl.dataset.modo = state.modo;
  }

  function cambiarModo(evento) {
    state.modo = siguienteModo(state.modo, evento);
    pintar();
    return state.modo;
  }

  /**
   * Arranca el modo espectador en el contenedor dado. Cierra cualquier
   * sesión previa antes de empezar (idempotente, como CameraService.start).
   * @param {HTMLElement} contenedorEl - dónde pintar el placeholder/video/esqueleto
   * @param {Object} [opts]
   * @param {number} [opts.demoTimeoutMs=5000] - FASE 1: tiempo antes de caer
   *   a 'esqueleto' si nadie manda 'conexion-ok'. En Fase 2 esto lo dispara
   *   el timeout real de conexión WebRTC, no un setTimeout de demo.
   */
  function montar(contenedorEl, opts = {}) {
    if (!contenedorEl) return;
    detener();   // limpio cualquier sesión anterior antes de empezar

    state.sessionId += 1;
    const miSesion = state.sessionId;
    state.contenedorEl = contenedorEl;
    cambiarModo('iniciar');

    const demoMs = opts.demoTimeoutMs != null ? opts.demoTimeoutMs : 5000;
    state.timeoutId = setTimeout(() => {
      if (miSesion !== state.sessionId) return;   // sesión vieja, ignorar
      cambiarModo('timeout');
    }, demoMs);
  }

  /** Corta la sesión de espectador y limpia el contenedor. Idempotente. */
  function detener() {
    if (state.timeoutId) clearTimeout(state.timeoutId);
    state.timeoutId = null;
    state.sessionId += 1;   // invalida cualquier timeout pendiente
    state.modo = 'inactivo';
    if (state.contenedorEl) state.contenedorEl.textContent = '';
    state.contenedorEl = null;
  }

  function obtenerModo() { return state.modo; }

  return {
    montar, detener, obtenerModo,
    _puras: { siguienteModo, textoPlaceholder, MODOS }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpectatorService;
} else {
  window.SpectatorService = SpectatorService;
}
