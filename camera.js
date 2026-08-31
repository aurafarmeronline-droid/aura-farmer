/* ============================================================
   AURA FARMER — camera.js
   v0.3-web (v2.1.8) — cámara frontal/trasera seleccionable (tipo WhatsApp):
     start({facingMode}), cambiarCamara(), camaraActual(), hayVariasCamaras().
     Si la cámara pedida falla, vuelve sola a la anterior.
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
    sessionId: 0,       // anti-race: cada start() incrementa; callbacks
                        // async chequean que su sessionId siga vigente.
    // v2.1.8 — cámara activa: 'user' (frontal) o 'environment' (trasera).
    facingMode: 'user',
    // Guardamos los callbacks del último start() para poder re-arrancar
    // con la otra cámara sin que app.js tenga que volver a pasarlos.
    ultimoStart: null
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
   * @param {string}   [opts.facingMode]    - v2.1.8: 'user' (frontal) o 'environment' (trasera)
   */
  async function start(opts) {
    const { videoEl, onReady, onError } = opts;
    // Si ya había una sesión viva, la cerramos limpio antes de empezar otra.
    if (state.running) stop();

    // v2.1.8 — recordamos con qué arrancamos, para poder cambiar de cámara.
    if (opts.facingMode === 'user' || opts.facingMode === 'environment') {
      state.facingMode = opts.facingMode;
    }
    state.ultimoStart = opts;

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
      // v2.1.8 — facingMode configurable: 'user' = frontal (selfie),
      // 'environment' = trasera. En desktop suele haber una sola cámara y
      // el navegador ignora la preferencia, lo cual está bien.
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: state.facingMode,
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
   * v2.1.8 — Cambia entre cámara frontal y trasera (tipo WhatsApp).
   * Re-arranca el stream con el facingMode opuesto, reusando los callbacks
   * del último start(). Devuelve el modo nuevo, o null si no se pudo.
   * @returns {Promise<'user'|'environment'|null>}
   */
  async function cambiarCamara() {
    if (!state.ultimoStart) return null;
    const nuevo = state.facingMode === 'user' ? 'environment' : 'user';
    const opts = { ...state.ultimoStart, facingMode: nuevo };
    const anterior = state.facingMode;

    let fallo = false;
    await start({
      ...opts,
      onError: (e) => {
        // Si la cámara pedida no existe (ej. desktop sin trasera), volvemos
        // a la anterior para no dejar al jugador sin imagen.
        fallo = true;
        console.warn('CameraService.cambiarCamara:', e);
      }
    });
    if (fallo) {
      await start({ ...state.ultimoStart, facingMode: anterior });
      return null;
    }
    return nuevo;
  }

  /** v2.1.8 — Cámara activa: 'user' (frontal) o 'environment' (trasera). */
  function camaraActual() { return state.facingMode; }

  /**
   * v2.1.8 — ¿Hay más de una cámara en el dispositivo? Sirve para ocultar
   * el botón de cambio en equipos con una sola (típico desktop).
   * No pide permisos: enumerateDevices funciona igual (sin labels).
   * @returns {Promise<boolean>}
   */
  async function hayVariasCamaras() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return false;
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter(d => d.kind === 'videoinput').length > 1;
    } catch {
      return false;
    }
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

  return { start, stop, cambiarCamara, camaraActual, hayVariasCamaras };
})();

window.CameraService = CameraService;
