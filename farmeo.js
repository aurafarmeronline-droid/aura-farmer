/* ============================================================================
 * farmeo.js — Motor de Farmeo de Aura (motor principal, capa 1 de 3)
 * ----------------------------------------------------------------------------
 * We Do — dtp & ele · Aura Farmer Web
 *
 * CHANGELOG (versión del MOTOR de farmeo de aura)
 *   v1.2.0-web — CAPA DE PULIDO (reglas sacadas de batallas reales con
 *                       jurado). Tres bonus/penalización que se aplican al
 *                       cerrar paso / terminar coreo, encima de la fórmula
 *                       por-frame (no la reemplazan):
 *                       · FLUIDEZ    — premia transiciones suaves (menos
 *                                      saltos bruscos de aura entre frames).
 *                       · VARIEDAD   — penaliza repetir la misma pose que el
 *                                      paso anterior ("muy repetitivo").
 *                       · INTENSIDAD — premia escalar: empezar tranqui y
 *                                      cerrar fuerte ("tirá la ulti al final").
 *   v1.1.1-web — Fix escala de puntaje (×1000, ahora en cientos/miles) +
 *                       campo emoji por pose.
 *   v1.1.0-web — Fase 2+3 funcional (beta):
 *                       · Fase 2: cálculo de ángulos + evaluación de pose
 *                         (cuerpo) y confianza facial.
 *                       · Fase 3: secuencia con timing, sostenimiento por
 *                         área bajo la curva, y SISTEMA DE COMPOSTURA
 *                         (romper el personaje resta aura).
 *                       ⚠️ Ángulos ideales estimados del video, NO calibrados
 *                         con webcam real todavía. Beta jugable, no final.
 *   v1.0.0-web (Fase 1) — Estructura base + catálogo de poses Tier 1.
 *
 * FILOSOFÍA DE PUNTAJE (de las transcripciones de referencia):
 *   "Gana quien mantenga compostura robótica." El aura NO es solo acertar la
 *   pose: es sostenerla con seriedad. Romper el personaje resta:
 *     · reírse como tonto (sonrisa exageradísima) → penaliza
 *     · pestañear en exceso → penaliza
 *     · desviar la mirada → penaliza
 *   PERO una sonrisa media-alta CON confianza (tipo Chad) SUMA. La sonrisa
 *   tiene una zona buena y recién penaliza cuando se pasa de rosca.
 *
 *   aura_paso = precisión_cuerpo × confianza_facial × factor_compostura
 *   (todo promediado por ventana de tiempo = área bajo la curva)
 *
 * ROL EN LA ARQUITECTURA (3 capas concatenadas, plan a futuro):
 *   Capa 1 · farmeo.js   → ESTE. Motor principal: secuencias (mini-coreos)
 *                          de poses torso-up. El más avanzado.
 *   Capa 2 · (futuro)    → mini-motor de refinamiento: capta detalles finos
 *                          que a la capa 1 se le escapan (parche de precisión).
 *   Capa 3 · score.js    → motor viejo (pose única). Queda como fallback.
 *
 * ALCANCE HOY: solo Tier 1 (brazos + cara, jugador sentado frente a webcam).
 *              La estructura deja lugar preparado para Tier 2/3 (cuerpo
 *              completo) sin reescribir nada: se agregan entradas al catálogo.
 * ==========================================================================*/

'use strict';

/* ----------------------------------------------------------------------------
 * 1. VOCABULARIO DE ARTICULACIONES (torso-up)
 * ----------------------------------------------------------------------------
 * Nombres canónicos de los ángulos que sabemos medir con MediaPipe Pose
 * (33 landmarks). Cada ángulo se define por 3 landmarks: el del medio es el
 * vértice. Índices según pose_landmarker de MediaPipe.
 *
 *   11 hombro_izq   12 hombro_der
 *   13 codo_izq     14 codo_der
 *   15 muñeca_izq   16 muñeca_der
 *   23 cadera_izq   24 cadera_der
 *
 * ⚠️ "izq/der" son del landmark de MediaPipe (imagen SIN espejar). Como el
 * juego muestra la cámara espejada tipo selfie, el brazo que el jugador
 * levanta a SU derecha aparece acá como "_izq". Lo resolvemos con espejo_ok.
 * -------------------------------------------------------------------------- */
const ARTIC = {
  codo_izq:    [11, 13, 15], // hombro-codo-muñeca izquierdos
  codo_der:    [12, 14, 16],
  hombro_izq:  [13, 11, 23], // codo-hombro-cadera (apertura del brazo)
  hombro_der:  [14, 12, 24],
};

/* ----------------------------------------------------------------------------
 * 1b. UMBRALES DE COMPOSTURA (blendshapes de MediaPipe Face)
 * ----------------------------------------------------------------------------
 * Reglas de "romper el personaje". Todos operan sobre blendshapes 0..1.
 * Nombres de blendshape según face_landmarker de MediaPipe.
 *
 * SONRISA (curva con pico, no lineal):
 *   0.0 – NEUTRO_MAX      → neutro (ni suma ni resta)
 *   NEUTRO_MAX – CHAD_MAX → bonus (sonrisa confiada tipo Chad) ✅
 *   CHAD_MAX – 1.0        → penalización creciente (risa de tonto) ❌
 * La sonrisa se lee como el promedio de mouthSmile izq+der.
 *
 * PARPADEO: eyeBlink alto sostenido = pestañeo excesivo → penaliza.
 * MIRADA: eyeLookOut/In alto = ojos desviados del frente → penaliza.
 * -------------------------------------------------------------------------- */
const COMPOSTURA = {
  sonrisa: {
    blendshapes: ['mouthSmileLeft', 'mouthSmileRight'],
    neutro_max: 0.30,   // por debajo: no pasa nada
    chad_max:   0.70,   // entre neutro_max y esto: BONUS confiado
    bonus_max:  0.15,   // cuánto puede sumar como máximo (en el pico Chad)
    pena_max:   0.40,   // cuánto puede restar como máximo (risa total)
  },
  parpadeo: {
    blendshapes: ['eyeBlinkLeft', 'eyeBlinkRight'],
    umbral: 0.55,       // por encima cuenta como "ojos cerrados" este frame
    pena_max: 0.20,     // penalización máxima si parpadea sin parar
  },
  mirada: {
    blendshapes: ['eyeLookOutLeft', 'eyeLookOutRight',
                  'eyeLookInLeft', 'eyeLookInRight'],
    umbral: 0.50,       // por encima = mirada desviada del frente
    pena_max: 0.20,     // penalización máxima si mira para otro lado
  },
};

/* ----------------------------------------------------------------------------
 * 2. CATÁLOGO DE POSES (unidad atómica)
 * ----------------------------------------------------------------------------
 * Una POSE = una foto biomecánica. Campos:
 *   id           identificador corto único
 *   nombre       nombre visible (el del video)
 *   tier         1 = torso-up detectable hoy · 2/3 = futuro (cuerpo completo)
 *   detectable   si false, el motor la SALTA (no suma ni resta) — Fase 3
 *   espejo_ok    true = acepta el lado invertido (mov. simétricos/ambiguos)
 *   angulos[]    condiciones sobre articulaciones:
 *                  { articulacion, ideal, tol_perfect, tol_good }
 *                  ideal = grados esperados · tol_* = margen en grados
 *   cara         condición facial opcional (blendshape de MediaPipe Face) o null
 *                  { blendshape, min }  → confianza mínima 0..1
 *   nota         recordatorio humano de cómo se ve la pose (del video)
 *
 * ⚠️ Los valores de 'ideal' y tolerancias son ESTIMACIONES INICIALES a partir
 * de la descripción del video. Se calibran con datos reales en Fase 2+ (la
 * auditoría de bandas pendiente). Marco con ⚠️ los más inciertos.
 * -------------------------------------------------------------------------- */
const POSES = {

  maywin: {
    id: 'maywin',
    nombre: 'Maywin (silencio)',
    emoji: '🤫',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Una mano sube hacia la boca: codo bien cerrado, brazo recogido.
      { articulacion: 'codo_izq', ideal: 45, tol_perfect: 20, tol_good: 40 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 30, tol_perfect: 20, tol_good: 40 }, // ⚠️
    ],
    // "trompita de pato" + ojos entrecerrados → labios fruncidos.
    cara: { blendshape: 'mouthPucker', min: 0.3 }, // ⚠️
    nota: 'Dedo a la boca, trompita, ojos como con mucho sol. Silencio.',
  },

  zorro_guapo: {
    id: 'zorro_guapo',
    nombre: 'Zorro Guapo de Sutopía',
    emoji: '👉',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Señala al rival con desprecio: brazo extendido al frente.
      { articulacion: 'codo_izq', ideal: 160, tol_perfect: 20, tol_good: 40 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
    ],
    cara: null,
    nota: 'Señalar "apestas, bro" con cara de desprecio, sin que importe nada.',
  },

  six: {
    id: 'six',
    nombre: 'Six / 6-7',
    emoji: '🙌',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Ambas manos arriba, "una arriba, otra arriba".
      { articulacion: 'codo_izq', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'codo_der', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 150, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_der', ideal: 150, tol_perfect: 25, tol_good: 45 }, // ⚠️
    ],
    cara: null,
    nota: 'Manos arriba, de lento a lo más rápido que puedas.',
  },

  db: {
    id: 'db',
    nombre: 'DB (Doble Bíceps)',
    emoji: '💪',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Un codo afuera flexionado, el otro hacia arriba en diagonal.
      { articulacion: 'codo_izq', ideal: 90, tol_perfect: 20, tol_good: 40 }, // ⚠️
      { articulacion: 'codo_der', ideal: 90, tol_perfect: 20, tol_good: 40 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_der', ideal: 120, tol_perfect: 25, tol_good: 45 }, // ⚠️
    ],
    cara: null,
    nota: 'Doble bíceps clásico; "te hueles la axila" entre pose y pose.',
  },

  npc_lloron: {
    id: 'npc_lloron',
    nombre: 'NPC Llorón',
    emoji: '😭',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Ambas manos suben a cubrir la cara: codos muy cerrados.
      { articulacion: 'codo_izq', ideal: 30, tol_perfect: 20, tol_good: 40 }, // ⚠️
      { articulacion: 'codo_der', ideal: 30, tol_perfect: 20, tol_good: 40 }, // ⚠️
    ],
    cara: null, // la cara queda tapada; se detecta por ausencia, se ve en Fase 2
    nota: 'Cubrirse la cara con las manos y "llorar" como NPC de los Sims.',
  },

  codo_x3: {
    id: 'codo_x3',
    nombre: 'Codo x3',
    emoji: '🫷',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    angulos: [
      // Misma mano/misma pierna; acá solo el brazo: codo marcando hacia afuera.
      { articulacion: 'codo_izq', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 80, tol_perfect: 25, tol_good: 45 }, // ⚠️
    ],
    cara: null,
    nota: 'Codo, codo, codo — tres rápidos. Combinable con six.',
  },

  db67: {
    id: 'db67',
    nombre: 'DB 67',
    emoji: '🔥',
    tier: 1,
    detectable: true,
    espejo_ok: true,
    // Combo: DB + six. Comparte geometría con DB; se afina en Fase 2.
    angulos: [
      { articulacion: 'codo_izq', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'codo_der', ideal: 90, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_izq', ideal: 120, tol_perfect: 25, tol_good: 45 }, // ⚠️
      { articulacion: 'hombro_der', ideal: 120, tol_perfect: 25, tol_good: 45 }, // ⚠️
    ],
    cara: null,
    nota: 'El favorito: DB y 67 juntos.',
  },

};

/* ----------------------------------------------------------------------------
 * 3. CATÁLOGO DE COREOS (secuencias)
 * ----------------------------------------------------------------------------
 * Una COREO = lista ordenada de pasos. Cada paso apunta a una pose y dice
 * cuánto hay que sostenerla y cuánta gracia hay para llegar a ella.
 *   poseId        clave dentro de POSES
 *   duracion_ms   cuánto se sostiene la pose para puntuar el sostenimiento
 *   gracia_ms     ventana extra para "llegar" a la pose antes de penalizar
 *
 * El modelo de aura: "no es un instante, es área bajo la curva" → el puntaje
 * de cada paso surge de promediar mediciones durante duracion_ms (Fase 3).
 * -------------------------------------------------------------------------- */
const COREOS = {

  basico_juanfe: {
    id: 'basico_juanfe',
    nombre: 'Combo Básico',
    nivel: 'basico',
    pasos: [
      { poseId: 'maywin',      duracion_ms: 2500, gracia_ms: 800 },
      { poseId: 'zorro_guapo', duracion_ms: 2000, gracia_ms: 800 },
      { poseId: 'six',         duracion_ms: 3000, gracia_ms: 800 },
      { poseId: 'db',          duracion_ms: 2500, gracia_ms: 800 },
    ],
  },

};

/* ----------------------------------------------------------------------------
 * 4. ESTADO EN VIVO DEL MOTOR (aislado — no pisa score.js ni otros módulos)
 * ----------------------------------------------------------------------------
 * fabricarEstado() devuelve un estado limpio por partida. Nunca hay estado
 * global mutable compartido: cada duelo/ronda crea el suyo.
 * -------------------------------------------------------------------------- */
function fabricarEstado(coreoId) {
  return {
    coreoId: coreoId,        // qué coreo se está jugando
    pasoActual: 0,           // índice dentro de coreo.pasos
    fase: 'esperando',       // 'esperando' | 'sosteniendo' | 'transicion' | 'fin'
    inicioPaso_ms: null,     // timestamp de arranque del paso actual
    ultimoFrame_ms: null,    // timestamp del frame anterior (para dt real)
    buffer: [],              // mediciones acumuladas del paso (para promediar)
    puntajePorPaso: [],      // resultado cerrado de cada paso ya terminado
    puntajeTotal: 0,         // suma acumulada
  };
}

/* ============================================================================
 * FASE 2 — GEOMETRÍA Y EVALUACIÓN DE POSE
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * anguloEntre — Ángulo (grados, 0..180) entre 3 landmarks. Vértice = el medio.
 * ----------------------------------------------------------------------------
 * landmarks: array de {x, y, ...} normalizados 0..1 (formato MediaPipe Pose).
 * Devuelve null si algún landmark falta (robustez ante detección parcial).
 * Usa solo x,y (proyección 2D frontal) — suficiente para poses torso-up.
 * -------------------------------------------------------------------------- */
function anguloEntre(landmarks, idxA, idxVertice, idxB) {
  const A = landmarks && landmarks[idxA];
  const V = landmarks && landmarks[idxVertice];
  const B = landmarks && landmarks[idxB];
  if (!A || !V || !B) return null;

  // Vectores desde el vértice hacia A y hacia B.
  const v1x = A.x - V.x, v1y = A.y - V.y;
  const v2x = B.x - V.x, v2y = B.y - V.y;

  const mag1 = Math.hypot(v1x, v1y);
  const mag2 = Math.hypot(v2x, v2y);
  if (mag1 === 0 || mag2 === 0) return null; // landmarks superpuestos

  // Ángulo por producto punto. clamp evita NaN por error de punto flotante.
  let cos = (v1x * v2x + v1y * v2y) / (mag1 * mag2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos) * 180 / Math.PI;
}

/* ----------------------------------------------------------------------------
 * puntajePorTolerancia — Traduce un desvío (grados) a un puntaje 0..1.
 * ----------------------------------------------------------------------------
 * Dentro de tol_perfect → 1.0 (lineal hasta ahí no: perfect es meseta alta).
 * Entre perfect y good  → decae de 1.0 a 0.5.
 * Más allá de good      → decae de 0.5 a 0, y a 2×good ya es 0 (MISS).
 * -------------------------------------------------------------------------- */
function puntajePorTolerancia(desvio, tolPerfect, tolGood) {
  if (desvio <= tolPerfect) return 1.0;
  if (desvio <= tolGood) {
    // Interpola 1.0 → 0.5 en la franja perfect..good
    const t = (desvio - tolPerfect) / (tolGood - tolPerfect);
    return 1.0 - 0.5 * t;
  }
  const limite = tolGood * 2; // más allá del doble de good = MISS total
  if (desvio >= limite) return 0.0;
  // Interpola 0.5 → 0.0 en la franja good..2×good
  const t = (desvio - tolGood) / (limite - tolGood);
  return 0.5 * (1 - t);
}

/* ----------------------------------------------------------------------------
 * precisionCuerpo — Qué tan bien el cuerpo hace la pose (0..1).
 * ----------------------------------------------------------------------------
 * Promedia el puntaje de cada ángulo requerido por la pose. Si espejo_ok,
 * también prueba la versión espejada (lado invertido) y se queda con la mejor.
 * Devuelve { valor, banda, angulosMedidos }.
 * -------------------------------------------------------------------------- */
function precisionCuerpo(landmarks, pose) {
  // Evalúa el set de ángulos tal cual está definido.
  function evalSet(angulos) {
    let suma = 0, n = 0;
    const medidos = [];
    for (const cond of angulos) {
      const [a, v, b] = ARTIC[cond.articulacion];
      const ang = anguloEntre(landmarks, a, v, b);
      if (ang === null) { medidos.push({ art: cond.articulacion, ang: null, p: 0 }); n++; continue; }
      const p = puntajePorTolerancia(Math.abs(ang - cond.ideal), cond.tol_perfect, cond.tol_good);
      suma += p; n++;
      medidos.push({ art: cond.articulacion, ang: Math.round(ang), p: +p.toFixed(2) });
    }
    return { valor: n ? suma / n : 0, medidos };
  }

  const normal = evalSet(pose.angulos);
  let mejor = normal;

  if (pose.espejo_ok) {
    // Versión espejada: intercambia izq<->der en cada articulación.
    const espejadas = pose.angulos.map(c => ({
      ...c,
      articulacion: c.articulacion.replace('_izq', '_TMP')
                                   .replace('_der', '_izq')
                                   .replace('_TMP', '_der'),
    }));
    const esp = evalSet(espejadas);
    if (esp.valor > mejor.valor) mejor = esp;
  }

  const v = mejor.valor;
  const banda = v >= 0.85 ? 'PERFECT' : v >= 0.65 ? 'GOOD' : v >= 0.4 ? 'OK' : 'MISS';
  return { valor: v, banda, angulosMedidos: mejor.medidos };
}

/* ----------------------------------------------------------------------------
 * confianzaFacial — Confianza facial base (0..1) con soft-floor.
 * ----------------------------------------------------------------------------
 * Si no hay cara detectada (blendshapes null/vacío) devuelve el soft-floor
 * de 0.5, para no matar el puntaje de un paso que está bien de cuerpo pero
 * con la cara tapada (Maywin, DB). Si la pose pide un blendshape específico
 * (ej. Maywin pide mouthPucker), lo verifica y modula.
 * -------------------------------------------------------------------------- */
function confianzaFacial(blendshapes, pose) {
  const SOFT_FLOOR = 0.5;
  if (!blendshapes || Object.keys(blendshapes).length === 0) return SOFT_FLOOR;

  if (pose.cara && pose.cara.blendshape) {
    const val = blendshapes[pose.cara.blendshape] || 0;
    // Escala: si alcanza el min pedido → 1.0; si es 0 → soft-floor.
    if (val >= pose.cara.min) return 1.0;
    return SOFT_FLOOR + (1.0 - SOFT_FLOOR) * (val / pose.cara.min);
  }
  // Sin requisito facial específico: cara detectada = confianza plena.
  return 1.0;
}

/* ----------------------------------------------------------------------------
 * promedioBlend — Helper: promedia una lista de blendshapes (los ausentes = 0).
 * -------------------------------------------------------------------------- */
function promedioBlend(blendshapes, nombres) {
  if (!blendshapes) return 0;
  let suma = 0;
  for (const n of nombres) suma += (blendshapes[n] || 0);
  return suma / nombres.length;
}

/* ----------------------------------------------------------------------------
 * factorCompostura — Multiplicador de "romper el personaje" (0..1.15 aprox).
 * ----------------------------------------------------------------------------
 * Parte de 1.0. La sonrisa confiada puede SUMAR (>1). Reírse como tonto,
 * pestañear en exceso o desviar la mirada RESTAN. Devuelve { factor, flags }
 * para poder mostrar feedback ("¡te reíste!", "mirá al frente").
 *
 * Si no hay cara detectada, no penaliza (factor 1.0): no podemos saber si
 * rompió el personaje, así que no lo castigamos por la duda.
 * -------------------------------------------------------------------------- */
function factorCompostura(blendshapes) {
  const flags = [];
  if (!blendshapes || Object.keys(blendshapes).length === 0) {
    return { factor: 1.0, flags };
  }

  let factor = 1.0;

  // --- Sonrisa (curva con pico) ---
  const s = COMPOSTURA.sonrisa;
  const sonrisa = promedioBlend(blendshapes, s.blendshapes);
  if (sonrisa > s.neutro_max && sonrisa <= s.chad_max) {
    // Zona Chad: bonus proporcional a qué tan metido está en la franja.
    const t = (sonrisa - s.neutro_max) / (s.chad_max - s.neutro_max);
    factor += s.bonus_max * t;
    flags.push('chad');
  } else if (sonrisa > s.chad_max) {
    // Se pasó de rosca: penalización creciente de chad_max a 1.0.
    const t = (sonrisa - s.chad_max) / (1.0 - s.chad_max);
    factor -= s.pena_max * t;
    flags.push('risa_tonta');
  }

  // --- Parpadeo excesivo ---
  const pb = COMPOSTURA.parpadeo;
  const blink = promedioBlend(blendshapes, pb.blendshapes);
  if (blink > pb.umbral) {
    const t = (blink - pb.umbral) / (1.0 - pb.umbral);
    factor -= pb.pena_max * t;
    flags.push('parpadeo');
  }

  // --- Mirada desviada ---
  const mb = COMPOSTURA.mirada;
  const mirada = promedioBlend(blendshapes, mb.blendshapes);
  if (mirada > mb.umbral) {
    const t = (mirada - mb.umbral) / (1.0 - mb.umbral);
    factor -= mb.pena_max * t;
    flags.push('mirada');
  }

  // El factor no baja de 0 (no queremos aura negativa por frame).
  factor = Math.max(0, factor);
  return { factor, flags };
}

/* ----------------------------------------------------------------------------
 * ESCALA_PUNTOS — Multiplicador para llevar el aura (0..~1.15 por paso) a la
 * escala visible del juego (cientos/miles, como el motor viejo score.js).
 * Un paso PERFECT sostenido ≈ 1.0 → 1000 pts. Coreo de 4 pasos ≈ 4000 máx.
 * -------------------------------------------------------------------------- */
const ESCALA_PUNTOS = 1000;

/* ----------------------------------------------------------------------------
 * PULIDO — Parámetros de las 3 reglas sacadas de batallas reales con jurado.
 * ----------------------------------------------------------------------------
 * Todos son multiplicadores suaves sobre el puntaje ya calculado, para que
 * nunca den vuelta el resultado (una pose bien hecha siempre gana): topes
 * chicos. Se pueden apagar poniendo el bonus/pena en 0.
 * -------------------------------------------------------------------------- */
const PULIDO = {
  // FLUIDEZ: qué tan suave fue la transición dentro del paso. Se mide como
  // 1 − volatilidad del aura entre frames consecutivos. Suave = bonus.
  fluidez:   { bonus_max: 0.12 },   // hasta +12% si el paso fue muy fluido
  // VARIEDAD: repetir la misma pose que el paso anterior penaliza.
  variedad:  { pena_repeticion: 0.15 }, // −15% si el paso repite al anterior
  // INTENSIDAD: escalar a lo largo de la coreo (segunda mitad > primera mitad)
  // premia el cierre. Se aplica UNA vez, al terminar la coreo, sobre el total.
  intensidad:{ bonus_max: 0.10 },   // hasta +10% al total si la coreo escaló
};

/* ----------------------------------------------------------------------------
 * evaluarPose — Fase 2 completa: puntaje instantáneo de un frame vs una pose.
 * ----------------------------------------------------------------------------
 * aura = precisión_cuerpo × confianza_facial × factor_compostura
 * Devuelve todo desglosado para poder mostrar feedback y para los tests.
 * -------------------------------------------------------------------------- */
function evaluarPose(landmarks, blendshapes, pose) {
  const cuerpo = precisionCuerpo(landmarks, pose);
  const facial = confianzaFacial(blendshapes, pose);
  const comp = factorCompostura(blendshapes);

  const aura = cuerpo.valor * facial * comp.factor;
  return {
    aura,                         // puntaje instantáneo 0..~1.15
    banda: cuerpo.banda,          // PERFECT/GOOD/OK/MISS (según cuerpo)
    precisionCuerpo: cuerpo.valor,
    confianzaFacial: facial,
    factorCompostura: comp.factor,
    flags: comp.flags,            // ['chad'] / ['risa_tonta','parpadeo'] ...
    angulos: cuerpo.angulosMedidos,
  };
}

/* ============================================================================
 * FASE 3 — SECUENCIA, TIMING Y SOSTENIMIENTO (área bajo la curva)
 * ==========================================================================*/

/* ----------------------------------------------------------------------------
 * tick — Avanza el motor un frame. Muta 'estado', devuelve feedback en vivo.
 * ----------------------------------------------------------------------------
 * Entradas:
 *   estado       el que fabrica fabricarEstado() — se MUTA in-place
 *   coreo        objeto de COREOS que se está jugando
 *   landmarks    pose landmarks del frame (o null)
 *   blendshapes  blendshapes faciales del frame (o null)
 *   ahora_ms     timestamp del frame (performance.now() o Date.now())
 *
 * Salida (objeto de feedback para la UI, NO muta nada más):
 *   { fase, pasoActual, poseObjetivo, banda, flags, auraInstante,
 *     pasoCerrado, coreoTerminada, puntajeTotal }
 *
 * Lógica de sostenimiento = área bajo la curva:
 *   Mientras se sostiene un paso, cada frame aporta su aura al buffer junto
 *   con el delta de tiempo real transcurrido. Al cerrar el paso, el puntaje
 *   es el promedio ponderado por tiempo (no por cantidad de frames — así un
 *   frame que tardó más pesa más, y un lag no infla ni desinfla).
 * -------------------------------------------------------------------------- */
function tick(estado, coreo, landmarks, blendshapes, ahora_ms) {
  if (estado.fase === 'fin') {
    return { fase: 'fin', coreoTerminada: true, puntajeTotal: estado.puntajeTotal };
  }

  const paso = coreo.pasos[estado.pasoActual];
  const pose = POSES[paso.poseId];

  // Poses no detectables (Tier 2/3): se saltan, no suman ni restan.
  if (!pose.detectable) {
    return cerrarPaso(estado, coreo, 0, ahora_ms, { saltado: true });
  }

  const ev = evaluarPose(landmarks, blendshapes, pose);

  // Arranque del paso: primer frame, fijamos el reloj.
  if (estado.inicioPaso_ms === null) {
    estado.inicioPaso_ms = ahora_ms;
    estado.ultimoFrame_ms = ahora_ms;
    estado.fase = 'sosteniendo';
  }

  // Delta de tiempo real desde el frame anterior (área bajo la curva).
  const dt = Math.max(0, ahora_ms - estado.ultimoFrame_ms);
  estado.ultimoFrame_ms = ahora_ms;
  estado.buffer.push({ aura: ev.aura, dt });

  const transcurrido = ahora_ms - estado.inicioPaso_ms;
  const objetivo = paso.duracion_ms + paso.gracia_ms;

  // ¿Se cumplió el tiempo del paso? Cerrar y avanzar.
  let pasoCerrado = false, coreoTerminada = false;
  if (transcurrido >= objetivo) {
    const cierre = cerrarPaso(estado, coreo, promedioPonderado(estado.buffer), ahora_ms, {});
    pasoCerrado = true;
    coreoTerminada = cierre.coreoTerminada;
  }

  return {
    fase: estado.fase,
    pasoActual: estado.pasoActual,
    poseObjetivo: paso.poseId,
    poseNombre: pose.nombre,
    banda: ev.banda,
    flags: ev.flags,
    auraInstante: +ev.aura.toFixed(3),
    pasoCerrado,
    coreoTerminada,
    puntajeTotal: Math.round(estado.puntajeTotal),
  };
}

/* ----------------------------------------------------------------------------
 * promedioPonderado — Promedia el aura del buffer ponderando por tiempo (dt).
 * ----------------------------------------------------------------------------
 * Esta es la traducción literal de "área bajo la curva": cada medición pesa
 * proporcional al tiempo real que representó. Robusto ante frames irregulares.
 * -------------------------------------------------------------------------- */
function promedioPonderado(buffer) {
  let area = 0, tiempo = 0;
  for (const m of buffer) { area += m.aura * m.dt; tiempo += m.dt; }
  return tiempo > 0 ? area / tiempo : 0;
}

/* ----------------------------------------------------------------------------
 * cerrarPaso — Cierra el paso actual, guarda su puntaje y avanza al siguiente.
 * ----------------------------------------------------------------------------
 * Función aparte (Single Responsibility): tick decide CUÁNDO cerrar; esto
 * hace el cierre. Resetea el buffer y el reloj para el próximo paso.
 * -------------------------------------------------------------------------- */
/* ----------------------------------------------------------------------------
 * FLUIDEZ (pulido) — Bonus por transición suave dentro del paso.
 * ----------------------------------------------------------------------------
 * Mide la volatilidad del aura entre frames consecutivos del buffer. Poca
 * volatilidad = el jugador entró y sostuvo suave = fluido = bonus. Muchos
 * saltos bruscos = 0 bonus. Devuelve un multiplicador 1..(1+bonus_max).
 * -------------------------------------------------------------------------- */
function calcularFluidez(buffer) {
  if (!buffer || buffer.length < 3) return 1.0; // muy pocos frames: neutro
  let saltos = 0;
  for (let i = 1; i < buffer.length; i++) {
    saltos += Math.abs(buffer[i].aura - buffer[i - 1].aura);
  }
  const volatilidadMedia = saltos / (buffer.length - 1); // 0..~1
  // Menos volatilidad → más bonus. Saturamos: volatilidad ≥0.3 = sin bonus.
  const suavidad = Math.max(0, 1 - volatilidadMedia / 0.3);
  return 1 + PULIDO.fluidez.bonus_max * suavidad;
}

/* ----------------------------------------------------------------------------
 * VARIEDAD (pulido) — Penaliza repetir la misma pose que el paso anterior.
 * ----------------------------------------------------------------------------
 * Los jurados penalizan lo repetitivo. Devuelve multiplicador 1 o (1−pena).
 * -------------------------------------------------------------------------- */
function calcularVariedad(coreo, indicePaso) {
  if (indicePaso === 0) return 1.0; // el primer paso nunca repite
  const actual = coreo.pasos[indicePaso].poseId;
  const previo = coreo.pasos[indicePaso - 1].poseId;
  return actual === previo ? (1 - PULIDO.variedad.pena_repeticion) : 1.0;
}

/* ----------------------------------------------------------------------------
 * INTENSIDAD (pulido) — Bonus final por escalar a lo largo de la coreo.
 * ----------------------------------------------------------------------------
 * "Empezá tranqui, tirá la ulti al final." Compara el promedio de puntaje de
 * la segunda mitad de los pasos vs la primera mitad. Si la segunda es mayor,
 * la coreo escaló → bonus. Se aplica UNA vez al terminar, sobre el total.
 * Devuelve multiplicador 1..(1+bonus_max).
 * -------------------------------------------------------------------------- */
function calcularIntensidad(puntajePorPaso) {
  const n = puntajePorPaso.length;
  if (n < 2) return 1.0;
  const mitad = Math.floor(n / 2);
  const prom = (arr) => arr.reduce((s, p) => s + p.puntaje, 0) / (arr.length || 1);
  const primera = prom(puntajePorPaso.slice(0, mitad));
  const segunda = prom(puntajePorPaso.slice(mitad));
  if (primera <= 0) return 1.0;
  // Cuánto creció la segunda mitad respecto de la primera (saturado en +50%).
  const crecimiento = Math.max(0, Math.min(1, (segunda - primera) / (primera * 0.5)));
  return 1 + PULIDO.intensidad.bonus_max * crecimiento;
}

/* ----------------------------------------------------------------------------
 * cerrarPaso — Cierra el paso actual, guarda su puntaje y avanza al siguiente.
 * ----------------------------------------------------------------------------
 * Función aparte (Single Responsibility): tick decide CUÁNDO cerrar; esto
 * hace el cierre. Aplica el pulido POR-PASO (fluidez + variedad) antes de
 * escalar. Resetea el buffer y el reloj para el próximo paso.
 * -------------------------------------------------------------------------- */
function cerrarPaso(estado, coreo, puntaje, ahora_ms, meta) {
  // Pulido por-paso: fluidez (del buffer) × variedad (vs paso anterior).
  const fFluidez  = meta.saltado ? 1.0 : calcularFluidez(estado.buffer);
  const fVariedad = calcularVariedad(coreo, estado.pasoActual);
  const puntajeConPulido = puntaje * fFluidez * fVariedad;
  const puntajeEscalado = puntajeConPulido * ESCALA_PUNTOS;

  estado.puntajePorPaso.push({
    poseId: coreo.pasos[estado.pasoActual].poseId,
    puntaje: Math.round(puntajeEscalado),
    saltado: !!meta.saltado,
    fluidez: +fFluidez.toFixed(2),
    variedad: +fVariedad.toFixed(2),
  });
  estado.puntajeTotal += puntajeEscalado;

  // Avanzar
  estado.pasoActual++;
  estado.buffer = [];
  estado.inicioPaso_ms = null;
  estado.ultimoFrame_ms = null;

  const terminada = estado.pasoActual >= coreo.pasos.length;
  estado.fase = terminada ? 'fin' : 'transicion';

  // Pulido de cierre: al terminar, bonus de INTENSIDAD sobre el total.
  if (terminada) {
    const fIntensidad = calcularIntensidad(estado.puntajePorPaso);
    estado.puntajeTotal *= fIntensidad;
    estado.bonusIntensidad = +fIntensidad.toFixed(2); // para feedback/tests
  }

  return { coreoTerminada: terminada };
}

/* ----------------------------------------------------------------------------
 * 6. EXPORTS
 * ----------------------------------------------------------------------------
 * Doble export: en el navegador cuelga de window.Farmeo; en Node (tests
 * headless) usa module.exports. Así se valida la lógica sin navegador.
 * -------------------------------------------------------------------------- */
const Farmeo = {
  ARTIC, COMPOSTURA, POSES, COREOS, PULIDO,
  fabricarEstado,
  // Fase 2
  anguloEntre, puntajePorTolerancia, precisionCuerpo,
  confianzaFacial, factorCompostura, evaluarPose,
  // Fase 3
  tick, promedioPonderado, cerrarPaso,
  // Pulido (v1.2.0)
  calcularFluidez, calcularVariedad, calcularIntensidad,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Farmeo;         // Node / tests
} else if (typeof window !== 'undefined') {
  window.Farmeo = Farmeo;          // navegador
}
