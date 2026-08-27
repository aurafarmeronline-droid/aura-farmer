/* ============================================================
   AURA FARMER — poses.js
   v0.7-web — Catálogo de las 6 poses + definición de rondas.
   Puro data + helpers, sin DOM. El ScoreEngine consume esto.

   ÍNDICES DE LANDMARK (MediaPipe Pose, 33 puntos / BlazePose):
     0 nariz · 11/12 hombro izq/der · 13/14 codo izq/der
     15/16 muñeca izq/der · 23/24 cadera izq/der
   NOTA: "izq/der" es del punto de vista del MODELO (imagen sin espejar).

   Cada pose tiene:
     id, nombre, emoji, tipo ('cuerpo' | 'cara' | 'mixta')
     joints[]      → [{a,b,c,anguloEsperado}] para el ScoreEngine
     blendshapes[] → [{nombre, minimo}] para poses de cara (v0.8-web)
     tip           → texto guía para el jugador
   ============================================================ */

const CatalogoPoses = (() => {

  const POSES = [
    {
      id: 'doble_biceps',
      nombre: 'Doble Bíceps',
      emoji: '💪',
      tipo: 'cuerpo',
      tip: 'Ambos brazos arriba, codos bien flexionados',
      joints: [
        { a: 11, b: 13, c: 15, anguloEsperado: 45 },   // codo izq flexionado
        { a: 12, b: 14, c: 16, anguloEsperado: 45 }    // codo der flexionado
      ],
      blendshapes: []
    },
    {
      id: 'brazos_cruzados',
      nombre: 'Brazos Cruzados',
      emoji: '🧊',
      tipo: 'cuerpo',
      tip: 'Cruzá los brazos sobre el pecho, firme',
      joints: [
        { a: 11, b: 13, c: 15, anguloEsperado: 35 },
        { a: 12, b: 14, c: 16, anguloEsperado: 35 },
        { a: 13, b: 11, c: 23, anguloEsperado: 25 }    // brazo pegado al torso
      ],
      blendshapes: []
    },
    {
      id: 'senalar',
      nombre: 'Señalar',
      emoji: '👉',
      tipo: 'cuerpo',
      tip: 'Un brazo extendido señalando al frente',
      joints: [
        { a: 12, b: 14, c: 16, anguloEsperado: 165 },  // brazo der estirado
        { a: 14, b: 12, c: 24, anguloEsperado: 85 }    // hombro abierto ~90°
      ],
      blendshapes: []
    },
    {
      id: 'mirada_yagami',
      nombre: 'Mirada Yagami',
      emoji: '😈',
      tipo: 'cara',
      tip: 'Mirada intensa, ojos bien abiertos, sin sonreír',
      joints: [
        { a: 11, b: 0, c: 12, anguloEsperado: 55 }     // cabeza centrada entre hombros
      ],
      // v0.8-web: se leerán del FaceLandmarker (ya capturamos blendshapes)
      blendshapes: [
        { nombre: 'eyeWideLeft',  minimo: 0.25 },
        { nombre: 'eyeWideRight', minimo: 0.25 },
        { nombre: 'browDownLeft', minimo: 0.20 }
      ]
    },
    {
      id: 'rugido',
      nombre: 'Rugido',
      emoji: '🦁',
      tipo: 'mixta',
      tip: 'Boca bien abierta, brazos tensos hacia afuera',
      joints: [
        { a: 11, b: 13, c: 15, anguloEsperado: 120 },
        { a: 12, b: 14, c: 16, anguloEsperado: 120 }
      ],
      blendshapes: [
        { nombre: 'jawOpen', minimo: 0.45 }
      ]
    },
    {
      id: 'sonrisa_chad',
      nombre: 'Sonrisa de Chad',
      emoji: '😏',
      tipo: 'cara',
      tip: 'Sonrisa ladeada, mentón alto, confianza total',
      joints: [
        { a: 11, b: 0, c: 12, anguloEsperado: 55 }
      ],
      blendshapes: [
        { nombre: 'mouthSmileLeft',  minimo: 0.30 },
        { nombre: 'mouthSmileRight', minimo: 0.30 }
      ]
    }
  ];

  /** Devuelve una pose por id, o null si no existe. */
  function porId(id) {
    return POSES.find(p => p.id === id) || null;
  }

  /**
   * Arma una ronda: N poses elegidas al azar sin repetir.
   * Si se piden más poses de las que hay, devuelve todas (no repite ni crashea).
   */
  function armarRonda(cantidad = 3) {
    const n = Math.max(1, Math.min(cantidad, POSES.length));
    const mezcladas = [...POSES].sort(() => Math.random() - 0.5);
    return mezcladas.slice(0, n);
  }

  return { POSES, porId, armarRonda };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CatalogoPoses;
} else {
  window.CatalogoPoses = CatalogoPoses;
}
