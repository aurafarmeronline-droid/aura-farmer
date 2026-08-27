/* ============================================================
   AURA FARMER — score.js
   ┌──────────────────────────────────────────────────────────┐
   │  MOTOR DE AURA — CHASIS v1  (pendiente auditoría profunda) │
   │  Esta es la BASE del proyecto. Toda la mecánica del juego  │
   │  se monta encima. Marcado para revisión dedicada futura.   │
   └──────────────────────────────────────────────────────────┘
   v0.6.1-web — Bandas ensanchadas (parche provisorio, ver Tanda 4) +
     resincronizados los dos usos internos de clasificarBanda que traducían
     puntaje→banda con umbrales viejos (confianza facial y promedio de
     keyframe). Sin esto quedaban desalineados con las bandas nuevas.
   v0.6-web — ScoreEngine: compara landmarks reales contra una
   pose objetivo y devuelve puntaje. Puro (sin DOM, sin cámara,
   sin canvas) para que sea testeable con node directo.

   DOS CAPAS (separadas a propósito, para escalar sin reescribir):
     1) MEDICIÓN por frame  → evaluarFrame(): mide "cómo estás AHORA"
        (precisión → banda). NO suma al total. Alimenta un buffer.
     2) ACUMULACIÓN keyframe → capturarKeyframe(): promedia el buffer
        de la ventana previa y ESO suma al total. Hoy lo dispara un
        timer (Opción 1 - temporizado). Migrar a Opción 2 (sostenimiento)
        = cambiar SOLO quién dispara el keyframe; la fórmula ya queda lista.

   Bandas de precisión (ensanchadas v0.6.1-web — parche provisorio hasta
   auditoría con video real, Tanda 4):
     PERFECT ≤30°  100pts   GOOD ≤50°  60pts
     OK      ≤70°   30pts   MISS >70°   0pts
   Combo: hits consecutivos sin MISS multiplican x(1+combo*0.1), tope x2.0

   MODELO DE "AURA" (intuición, ver auditoría futura):
     El aura no es un instante, es área bajo la curva: entrar, clavar
     la pose y SOSTENERLA con confianza. Por eso el keyframe promedia
     una ventana, no toma un solo frame. Fórmula objetivo a futuro:
        puntaje_pose = precisión × sostenimiento × confianza_facial
     v0.9.3-web (T3): CARA CONECTADA → puntos = precisión × confianza_facial.
     Blendshapes (Yagami/Rugido/Chad) ya alimentan el motor. Sostenimiento
     sigue vía ventana/keyframe. Ángulos SIN recalibrar (esperan videos ref).
     Falta auditoría profunda de bandas/combo/intervalo → Tanda 4.
   ============================================================ */

const ScoreEngine = (() => {

  /**
   * Ángulo en grados en el vértice B, dado A-B-C (puntos {x,y} normalizados).
   * Devuelve null si algún vector es de longitud ~0 (landmarks degenerados,
   * ej. dos puntos coincidentes) para no dividir por cero.
   */
  function anguloEnVertice(A, B, C) {
    const v1 = { x: A.x - B.x, y: A.y - B.y };
    const v2 = { x: C.x - B.x, y: C.y - B.y };

    const mag1 = Math.hypot(v1.x, v1.y);
    const mag2 = Math.hypot(v2.x, v2.y);
    if (mag1 < 1e-6 || mag2 < 1e-6) return null;

    const dot = v1.x * v2.x + v1.y * v2.y;
    let cos = dot / (mag1 * mag2);
    cos = Math.min(1, Math.max(-1, cos));   // clamp por errores de float
    return (Math.acos(cos) * 180) / Math.PI;
  }

  /**
   * Valida la forma mínima de una pose objetivo antes de usarla.
   * Evita crashear si alguien pasa un objeto mal armado.
   */
  function poseValida(poseObjetivo) {
    return Array.isArray(poseObjetivo) &&
      poseObjetivo.length > 0 &&
      poseObjetivo.every(j =>
        j && typeof j.anguloEsperado === 'number' &&
        Number.isInteger(j.a) && Number.isInteger(j.b) && Number.isInteger(j.c)
      );
  }

  function clasificarBanda(errorPromedio) {
    if (errorPromedio <= 30) return { banda: 'PERFECT', puntos: 100 };
    if (errorPromedio <= 50) return { banda: 'GOOD',    puntos: 60  };
    if (errorPromedio <= 70) return { banda: 'OK',      puntos: 30  };
    return { banda: 'MISS', puntos: 0 };
  }

  /**
   * CONFIANZA FACIAL ∈ [0,1] — CAPA CARA del modelo de aura.
   * Para cada blendshape requerido {nombre, minimo}, mide qué tan por encima
   * del mínimo está el score real (saturado a 1). Devuelve el promedio.
   *   - Pose sin blendshapes requeridos → 1.0 (neutro: la cara no penaliza).
   *   - Blendshapes no disponibles (cara no detectada) pero la pose los pide →
   *     0.0 no; usamos un piso suave (0.5) para no anular una buena pose de
   *     cuerpo solo porque falló la detección facial de la cara ese frame.
   *   - Un blendshape que llega al mínimo cuenta 1.0; por debajo, proporcional.
   * @param {Object|null} blendshapes  - dict {nombre:score} o null
   * @param {Array} requeridos         - [{nombre, minimo}, ...] (puede ser [])
   * @returns {number} confianza en [0,1]
   */
  const PISO_CARA_SIN_DETECCION = 0.5;

  function evaluarConfianzaFacial(blendshapes, requeridos) {
    if (!Array.isArray(requeridos) || requeridos.length === 0) return 1.0;
    // La pose pide cara pero no hay blendshapes este frame: no anulamos, piso suave.
    if (!blendshapes) return PISO_CARA_SIN_DETECCION;

    let suma = 0;
    for (const req of requeridos) {
      const score = blendshapes[req.nombre] ?? 0;
      const min = req.minimo > 0 ? req.minimo : 1e-6;
      // Proporción hasta el mínimo, saturada en 1 (superar el mínimo no da bonus).
      const razon = Math.min(1, score / min);
      suma += razon;
    }
    return suma / requeridos.length;
  }

  /**
   * Normaliza el 3er argumento de evaluarFrame para aceptar DOS firmas:
   *   - firma vieja: un array de joints            → {joints, blendshapesReq: []}
   *   - firma nueva: una pose {joints, blendshapes} → {joints, blendshapesReq}
   * Así no rompemos los tests/llamadas previas que pasaban solo joints.
   */
  function normalizarObjetivo(objetivo) {
    if (Array.isArray(objetivo)) {
      return { joints: objetivo, blendshapesReq: [] };
    }
    if (objetivo && typeof objetivo === 'object') {
      return {
        joints: Array.isArray(objetivo.joints) ? objetivo.joints : [],
        blendshapesReq: Array.isArray(objetivo.blendshapes) ? objetivo.blendshapes : []
      };
    }
    return { joints: [], blendshapesReq: [] };
  }

  /**
   * Crea un estado de sesión nuevo. Un estado por duelo/ronda — no singleton.
   * ventanaMediciones = buffer de precisión de los últimos frames, para que
   * el keyframe promedie una VENTANA (premia sostener) en vez de un instante.
   */
  const VENTANA_MAX = 30;   // ~1s a 30fps: cuántas mediciones recientes promediamos

  function crearEstado() {
    return {
      comboActual: 0,
      puntajeTotal: 0,
      ventanaMediciones: [],   // [{puntosBase, banda}, ...] recientes, sin combo
      ultimaBanda: null        // para feedback visual en vivo
    };
  }

  /**
   * CAPA 1 — MEDICIÓN por frame. Mide "cómo estás AHORA" y lo guarda en el
   * buffer de ventana. NO suma al puntajeTotal (eso lo hace capturarKeyframe).
   * Sirve para feedback visual en vivo (banda/color) y para alimentar el
   * promedio que el keyframe va a cobrar.
   * @param {Object} estado         - de crearEstado(), se muta in-place
   * @param {Array|null} landmarks  - landmarks del PoseLandmarker (33 puntos) o null
   * @param {Array|Object} objetivo - pose {joints, blendshapes} (nuevo) o array de joints (viejo)
   * @param {Object|null} blendshapes - dict {nombre:score} del FaceLandmarker, o null
   * @returns {{banda, comboActual, puntajeTotal, errorPromedio, confianzaFacial}}
   */
  function evaluarFrame(estado, landmarks, objetivo, blendshapes = null) {
    const { joints: poseObjetivo, blendshapesReq } = normalizarObjetivo(objetivo);
    // Registra una medición en el buffer de ventana (con tope FIFO).
    const registrar = (puntosBase, banda) => {
      estado.ventanaMediciones.push({ puntosBase, banda });
      if (estado.ventanaMediciones.length > VENTANA_MAX) {
        estado.ventanaMediciones.shift();
      }
      estado.ultimaBanda = banda;
    };

    // Sin persona en cuadro → MISS, corta combo, no crashea.
    if (!landmarks || landmarks.length === 0) {
      estado.comboActual = 0;
      registrar(0, 'MISS');
      return { banda: 'MISS', comboActual: 0,
               puntajeTotal: estado.puntajeTotal, errorPromedio: null, confianzaFacial: 0 };
    }

    if (!poseValida(poseObjetivo)) {
      // Pose SOLO de cara (sin joints válidos, ej. Yagami/Chad): puntuamos por
      // confianza facial pura en vez de descartar el frame.
      if (blendshapesReq.length > 0) {
        const confianza = evaluarConfianzaFacial(blendshapes, blendshapesReq);
        const puntos = Math.round(100 * confianza);
        // Valores 10/40/60/80 son proxies de "error en grados" elegidos para
        // caer en la banda correcta según los umbrales de clasificarBanda
        // (30/50/70) — no son ángulos reales, solo aprovechan la función.
        const banda = clasificarBanda(confianza >= 0.8 ? 10 : confianza >= 0.45 ? 40 : confianza >= 0.2 ? 60 : 80).banda;
        if (banda === 'MISS') estado.comboActual = 0; else estado.comboActual += 1;
        registrar(puntos, banda);
        return { banda, comboActual: estado.comboActual,
                 puntajeTotal: estado.puntajeTotal, errorPromedio: null, confianzaFacial: confianza };
      }
      console.warn('ScoreEngine: poseObjetivo mal formada, se ignora el frame.');
      return { banda: estado.ultimaBanda, comboActual: estado.comboActual,
               puntajeTotal: estado.puntajeTotal, errorPromedio: null, confianzaFacial: 1 };
    }

    const errores = [];
    for (const joint of poseObjetivo) {
      const A = landmarks[joint.a], B = landmarks[joint.b], C = landmarks[joint.c];
      if (!A || !B || !C) continue;
      const anguloReal = anguloEnVertice(A, B, C);
      if (anguloReal === null) continue;
      errores.push(Math.abs(anguloReal - joint.anguloEsperado));
    }

    if (errores.length === 0) {
      return { banda: estado.ultimaBanda, comboActual: estado.comboActual,
               puntajeTotal: estado.puntajeTotal, errorPromedio: null, confianzaFacial: 1 };
    }

    const errorPromedio = errores.reduce((s, e) => s + e, 0) / errores.length;
    const { banda, puntos } = clasificarBanda(errorPromedio);

    // MODELO DE AURA: puntos_base = precisión_cuerpo × confianza_facial.
    // Si la pose no pide cara, confianza=1 y no afecta (comportamiento previo intacto).
    const confianzaFacial = evaluarConfianzaFacial(blendshapes, blendshapesReq);
    const puntosBase = Math.round(puntos * confianzaFacial);

    // Combo se sigue actualizando por frame (feedback en vivo), pero NO
    // multiplica el total acá — solo influye en el keyframe.
    if (banda === 'MISS') estado.comboActual = 0;
    else estado.comboActual += 1;

    registrar(puntosBase, banda);

    return {
      banda,
      comboActual: estado.comboActual,
      puntajeTotal: estado.puntajeTotal,   // sin cambios: acá NO se suma
      errorPromedio: Math.round(errorPromedio),
      confianzaFacial: Math.round(confianzaFacial * 100) / 100
    };
  }

  /**
   * CAPA 2 — ACUMULACIÓN en keyframe ("pam"). Promedia la ventana de
   * mediciones recientes (premia haber SOSTENIDO la pose, no clavarla justo
   * en el instante) y suma ESO al total, con el multiplicador de combo.
   * Después limpia la ventana para el próximo keyframe.
   *
   * Hoy lo dispara un timer (Opción 1). Para migrar a sostenimiento (Opción 2)
   * solo cambia QUIÉN lo llama; esta función no se toca.
   * @returns {{puntosKeyframe, bandaPromedio, comboActual, puntajeTotal}}
   */
  function capturarKeyframe(estado) {
    const v = estado.ventanaMediciones;
    if (v.length === 0) {
      return { puntosKeyframe: 0, bandaPromedio: 'MISS',
               comboActual: estado.comboActual, puntajeTotal: estado.puntajeTotal };
    }

    // Promedio de puntos base de la ventana = "qué tan bien la venías sosteniendo".
    const promedioBase = v.reduce((s, m) => s + m.puntosBase, 0) / v.length;
    const multiplicador = Math.min(2.0, 1 + estado.comboActual * 0.1);
    const puntosKeyframe = Math.round(promedioBase * multiplicador);

    estado.puntajeTotal += puntosKeyframe;

    // Banda representativa del promedio, para el cartel del "pam".
    // Mismo truco de proxies que en evaluarConfianzaFacial: 10/40/60/80
    // resincronizados con los umbrales 30/50/70 de clasificarBanda.
    const bandaPromedio = clasificarBanda(
      promedioBase >= 80 ? 10 : promedioBase >= 45 ? 40 : promedioBase >= 20 ? 60 : 80
    ).banda;

    // Limpiamos la ventana: cada keyframe cobra su propio tramo.
    estado.ventanaMediciones = [];

    return { puntosKeyframe, bandaPromedio,
             comboActual: estado.comboActual, puntajeTotal: estado.puntajeTotal };
  }

  return { crearEstado, evaluarFrame, capturarKeyframe, anguloEnVertice, clasificarBanda, evaluarConfianzaFacial };
})();

// Node (tests) y browser (app.js) por igual
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ScoreEngine;
} else {
  window.ScoreEngine = ScoreEngine;
}
