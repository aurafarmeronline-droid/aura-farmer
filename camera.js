/* ============================================================
   AURA FARMER — camera.js
   v0.2-web — CameraService aislado.
   NO sabe nada de MediaPipe ni del juego. Solo:
   - pide permiso de cámara,
   - conecta el stream a un <video>,
   - cierra todo cuando se le dice stop().
   En v0.3-web un PoseService se enganchará vía onFrame().
   ============================================================ */

const CameraService = (() => {
  // Estado privado del módulo
  const state = {
    stream: null,
    videoEl: null,
    running: false,
    sessionId: 0        // anti-race: cada start() incrementa; callbacks
                        // async chequean que su sessionId siga vigente.
  };

  /**
   * Traduce excepciones de getUserMedia a códigos internos + mensaje UI.
   */
  function classifyError(err) {
    if (!err) return { code: 'unknown', msg: 'Error desconocido' };
    // El name viene estandarizado por WebRTC
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return { code: 'denied',   msg: 'Permiso de cámara denegado.\nHabilitalo en el sitio y recargá.' };
      case 'NotFoundError':
      case 'OverconstrainedError':
        return { code: 'no-camera', msg: 'No se detectó ninguna cámara.' };
      case 'NotReadableError':
        return { code: 'busy',     msg: 'La cámara está siendo usada por otra app.' };
      default:
        return { code: 'unknown',  msg: 'No se pudo abrir la cámara.\n(' + err.name + ')' };
    }
  }

  /**
   * Pre-chequeo: sin estos no tiene sentido siquiera pedir permiso.
   */
  function precheck() {
    if (!window.isSecureContext) {
      return { code: 'insecure', msg: 'La cámara requiere HTTPS o localhost.\nAbrir vía servidor, no doble-clic.' };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { code: 'no-support', msg: 'Este navegador no soporta acceso a cámara.' };
    }
    return null;
  }

  /**
   * Arranca la cámara y la conecta al <video> dado.
   * @param {Object} opts
   * @param {HTMLVideoElement} opts.videoEl - elemento donde se pinta el stream
   * @param {Function} [opts.onReady]       - llamado cuando el primer frame está listo
   * @param {Function} [opts.onError]       - llamado con ({code, msg}) si falla
   */
  async function start({ videoEl, onReady, onError }) {
    // Si ya había una sesión viva, la cerramos limpio antes de empezar otra.
    if (state.running) stop();

    state.sessionId += 1;
    const mySession = state.sessionId;
    state.videoEl = videoEl;
    state.running = true;

    // Chequeos previos: capacidades del navegador y contexto seguro.
    const pre = precheck();
    if (pre) {
      state.running = false;
      onError && onError(pre);
      return;
    }

    let stream;
    try {
      // 'user' = cámara frontal; ideal para selfie/poses.
      // Pedimos resolución modesta por perf en móviles.
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width:  { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
    } catch (err) {
      state.running = false;
      onError && onError(classifyError(err));
      return;
    }

    // Anti-race: si el usuario ya cambió de pantalla mientras esperábamos
    // el permiso, esta sesión quedó obsoleta → cerramos el stream ya mismo.
    if (mySession !== state.sessionId || !state.running) {
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    state.stream = stream;
    videoEl.srcObject = stream;
    videoEl.playsInline = true;     // iOS: sin esto el video va a fullscreen

    // Esperamos a que haya un frame válido antes de avisar 'ready'
    const onMeta = () => {
      videoEl.removeEventListener('loadedmetadata', onMeta);
      if (mySession !== state.sessionId) return;
      videoEl.play().catch(() => {/* autoplay bloqueado: no rompemos */});
      onReady && onReady();
    };
    videoEl.addEventListener('loadedmetadata', onMeta);
  }

  /**
   * Cierra el stream y limpia el <video>. Idempotente.
   * CRÍTICO llamar esto al salir de la pantalla de cámara: sin stop() el
   * LED de la webcam queda prendido y otras apps no pueden usarla.
   */
  function stop() {
    state.running = false;
    state.sessionId += 1;    // invalida cualquier callback async pendiente

    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
    if (state.videoEl) {
      state.videoEl.srcObject = null;
      state.videoEl = null;
    }
  }

  return { start, stop };
})();

window.CameraService = CameraService;
