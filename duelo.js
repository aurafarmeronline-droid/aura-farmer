/* ============================================================
   AURA FARMER — duelo.js
   v0.8-web — DueloEngine: duelo 1v1 por turnos. Puro (sin DOM).
   Alterna jugador A → traspaso → jugador B → veredicto.
   No sabe de cámara ni de poses: solo recibe puntajes de turno.
   ============================================================ */

const DueloEngine = (() => {

  /** Crea un duelo nuevo con los dos jugadores en 0. */
  function crearDuelo(nombreA = 'Vos', nombreB = 'Rival') {
    return {
      jugadores: {
        A: { nombre: nombreA, puntaje: null },   // null = todavía no jugó
        B: { nombre: nombreB, puntaje: null }
      },
      turnoActual: 'A',
      terminado: false
    };
  }

  /**
   * Registra el puntaje del turno que acaba de terminar y decide qué sigue.
   * @returns {{siguiente: 'traspaso'|'veredicto', turnoSiguiente: 'A'|'B'|null}}
   */
  function registrarTurno(duelo, jugador, puntaje) {
    if (!duelo || !duelo.jugadores[jugador]) {
      return { siguiente: 'veredicto', turnoSiguiente: null };
    }

    duelo.jugadores[jugador].puntaje = puntaje;

    // Si el otro jugador todavía no jugó → traspaso de dispositivo.
    const otro = jugador === 'A' ? 'B' : 'A';
    if (duelo.jugadores[otro].puntaje === null) {
      duelo.turnoActual = otro;
      return { siguiente: 'traspaso', turnoSiguiente: otro };
    }

    // Jugaron los dos → veredicto.
    duelo.terminado = true;
    return { siguiente: 'veredicto', turnoSiguiente: null };
  }

  /**
   * Compara los dos puntajes. Solo válido con el duelo terminado.
   * @returns {{ganador: 'A'|'B'|'empate', puntajeA, puntajeB, diferencia}}
   */
  function resolver(duelo) {
    const a = duelo.jugadores.A.puntaje ?? 0;
    const b = duelo.jugadores.B.puntaje ?? 0;

    let ganador = 'empate';
    if (a > b) ganador = 'A';
    else if (b > a) ganador = 'B';

    return { ganador, puntajeA: a, puntajeB: b, diferencia: Math.abs(a - b) };
  }

  return { crearDuelo, registrarTurno, resolver };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DueloEngine;
} else {
  window.DueloEngine = DueloEngine;
}
