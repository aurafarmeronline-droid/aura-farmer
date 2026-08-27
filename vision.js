/* ============================================================
   AURA FARMER — vision.js  (reemplaza a pose.js)
   v0.4-web — VisionService: orquesta Pose Landmarker + Face
   Landmarker de MediaPipe sobre el mismo <video>, en UN solo
   loop rAF, para no correr dos schedulers de detección compitiendo
   por el mismo frame (ver casos borde de la tanda).

   Sigue sin ScoreEngine: solo detección + dibujo. En v0.5-web un
   ScoreEngine se engancha vía onLandmarks({pose, face}).

   Compat: se exponen también window.PoseService y window.FaceService
   como wrappers finos sobre VisionService, por si algo externo los
   necesita sueltos — pero ambos comparten el mismo loop interno.
   ============================================================ */

import {
  PoseLandmarker,
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/vision_bundle.mjs';

const VisionService = (() => {
  const state = {
    poseLandmarker: null,
    faceLandmarker: null,
    faceAvailable: false,    // false si el modelo de cara no cargó (fallback: cuerpo sigue solo)

    videoEl: null,
    canvasEl: null,
    ctx: null,
    drawingUtils: null,

    running: false,
    rafId: null,
    sessionId: 0,
    lastVideoTime: -1
  };

  /**
   * Carga ambos modelos en paralelo. Si Face falla, NO tira todo abajo:
   * el cuerpo sigue funcionando solo (mismo criterio que el .pyw v0.6).
   */
  async function loadModels() {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm'
    );

    const posePromise = PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
          'pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numPoses: 1
    });

    const facePromise = FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/' +
          'face_landmarker/float16/1/face_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true   // necesario para v0.5-web (Yagami/Rugido/Chad)
    });

    // Pose es obligatorio: si falla, propagamos el error (sin cuerpo no hay juego).
    const poseLandmarker = await posePromise;

    // Face es opcional: si falla, lo logueamos y seguimos sin él.
    let faceLandmarker = null;
    try {
      faceLandmarker = await facePromise;
    } catch (err) {
      console.warn('VisionService: Face Landmarker no cargó, sigue solo el cuerpo.', err);
    }

    return { poseLandmarker, faceLandmarker };
  }

  /**
   * @param {Object} opts
   * @param {HTMLVideoElement} opts.videoEl
   * @param {HTMLCanvasElement} opts.canvasEl
   * @param {Function} [opts.onReady]         - primer frame detectado
   * @param {Function} [opts.onFaceUnavailable] - avisa si Face no cargó (UI puede mostrar chip distinto)
   * @param {Function} [opts.onError]         - error fatal (pose no cargó)
   * @param {Function} [opts.onLandmarks]     - ({pose, face}) por cada frame detectado, para ScoreEngine
   */
  async function start({ videoEl, canvasEl, onReady, onFaceUnavailable, onError, onLandmarks }) {
    if (state.running) stop();

    state.sessionId += 1;
    const mySession = state.sessionId;
    state.videoEl  = videoEl;
    state.canvasEl = canvasEl;
    state.ctx      = canvasEl.getContext('2d');
    state.running  = true;
    state.lastVideoTime = -1;

    try {
      if (!state.poseLandmarker) {
        const { poseLandmarker, faceLandmarker } = await loadModels();
        state.poseLandmarker = poseLandmarker;
        state.faceLandmarker = faceLandmarker;
        state.faceAvailable  = !!faceLandmarker;
      }
    } catch (err) {
      state.running = false;
      console.error('VisionService loadModels:', err);
      onError && onError({
        code: 'model-load',
        msg: 'No se pudo cargar el modelo de IA.\nRevisá tu conexión.'
      });
      return;
    }

    if (mySession !== state.sessionId || !state.running) return;

    if (!state.faceAvailable) {
      onFaceUnavailable && onFaceUnavailable();
    }

    state.drawingUtils = new DrawingUtils(state.ctx);
    state.onLandmarks = onLandmarks || null;
    canvasEl.width  = videoEl.videoWidth  || 640;
    canvasEl.height = videoEl.videoHeight || 480;

    onReady && onReady();
    loop();
  }

  function loop() {
    if (!state.running) return;

    const { videoEl, canvasEl, ctx, poseLandmarker, faceLandmarker, drawingUtils } = state;

    if (videoEl && videoEl.readyState >= 2 &&
        videoEl.currentTime !== state.lastVideoTime) {

      state.lastVideoTime = videoEl.currentTime;
      // Un solo timestamp compartido entre ambos modelos: MediaPipe exige
      // timestamps estrictamente crecientes por landmarker, y si Pose y
      // Face recibieran valores distintos en el mismo frame igual está bien,
      // pero usar el mismo nowMs simplifica y evita drift entre ambos.
      const nowMs = performance.now();

      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      let poseLandmarksFrame = null;
      try {
        const poseResult = poseLandmarker.detectForVideo(videoEl, nowMs);
        if (poseResult.landmarks && poseResult.landmarks.length > 0) {
          poseLandmarksFrame = poseResult.landmarks[0];
          for (const landmarks of poseResult.landmarks) {
            drawingUtils.drawConnectors(
              landmarks,
              PoseLandmarker.POSE_CONNECTIONS,
              { color: '#8E44FF', lineWidth: 3 }
            );
            drawingUtils.drawLandmarks(landmarks, {
              color: '#B978FF',
              radius: 3
            });
          }
        }
      } catch (err) {
        console.warn('VisionService pose detect error:', err);
      }

      let faceLandmarksFrame = null;
      let blendshapesFrame = null;   // dict plano {nombre: score} o null si no hay cara
      if (state.faceAvailable) {
        try {
          const faceResult = faceLandmarker.detectForVideo(videoEl, nowMs);
          if (faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
            faceLandmarksFrame = faceResult.faceLandmarks[0];
            drawFaceSimplificada(faceLandmarksFrame, ctx, canvasEl);
          }
          // Blendshapes: array de {categoryName, score}. Los aplanamos a
          // {categoryName: score} para que el ScoreEngine consulte por nombre
          // sin recorrer el array en cada pose.
          if (faceResult.faceBlendshapes && faceResult.faceBlendshapes.length > 0) {
            blendshapesFrame = {};
            for (const cat of faceResult.faceBlendshapes[0].categories) {
              blendshapesFrame[cat.categoryName] = cat.score;
            }
          }
        } catch (err) {
          console.warn('VisionService face detect error:', err);
        }
      }

      // Un solo punto de salida hacia afuera (ScoreEngine u otro consumidor),
      // el loop no sabe ni le importa qué hace el callback con esto.
      if (state.onLandmarks) {
        state.onLandmarks({ pose: poseLandmarksFrame, face: faceLandmarksFrame, blendshapes: blendshapesFrame });
      }
    }

    state.rafId = requestAnimationFrame(loop);
  }

  /**
   * Dibujo liviano de cara: solo contorno de ojos y boca (no los 478 puntos
   * completos, sería ruido visual sobre el esqueleto). Color aura tenue
   * para diferenciarlo del cuerpo sin competir visualmente.
   */
  const OJO_IZQ = [33, 160, 158, 133, 153, 144];
  const OJO_DER = [362, 385, 387, 263, 373, 380];
  const BOCA    = [61, 291, 0, 17, 78, 308];

  function drawFaceSimplificada(landmarks, ctx, canvasEl) {
    ctx.strokeStyle = 'rgba(185, 120, 255, 0.6)'; // aura-glow tenue
    ctx.lineWidth = 1.5;

    const dibujarContorno = (indices) => {
      ctx.beginPath();
      indices.forEach((idx, i) => {
        const pt = landmarks[idx];
        if (!pt) return;
        const x = pt.x * canvasEl.width;
        const y = pt.y * canvasEl.height;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    };

    dibujarContorno(OJO_IZQ);
    dibujarContorno(OJO_DER);
    dibujarContorno(BOCA);
  }

  function stop() {
    state.running = false;
    state.sessionId += 1;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    if (state.ctx && state.canvasEl) {
      state.ctx.clearRect(0, 0, state.canvasEl.width, state.canvasEl.height);
    }
    state.videoEl = null;
    state.canvasEl = null;
    state.ctx = null;
  }

  return { start, stop };
})();

window.VisionService = VisionService;

// Compat: wrappers fino por si algo externo espera PoseService/FaceService
// sueltos. Ambos delegan al mismo VisionService/loop unificado.
window.PoseService = { start: VisionService.start, stop: VisionService.stop };
window.FaceService = { start: VisionService.start, stop: VisionService.stop };
