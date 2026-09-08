/* ============================================================
   AURA FARMER — duelo.js
   v0.9-web — RONDAS: cada jugador ahora juega RONDAS_TOTAL=3 rondas
     (antes: 1 sola). jugadores[x].puntaje (único) pasa a ser
     jugadores[x].rondas (array). Se alterna A→B en cada llamada a
     registrarTurno() hasta que ambos completan sus 3 rondas; recién
     ahí se resuelve por la SUMA de las 3. Mismo motor para duelo
     local y online (online.js lo usa solo para resolver(), el
     turno-a-turno online lo maneja Firebase).
   v0.8-web — DueloEngine: duelo 1v1 por turnos. Puro (sin DOM).
   Alterna jugador A → traspaso → jugador B → veredicto.
   No sabe de cámara ni de poses: solo recibe puntajes de turno.
   ============================================================ */

const DueloEngine = (() => {

  const RONDAS_TOTAL = 3;

  /** Crea un duelo nuevo con los dos jugadores sin rondas jugadas. */
  function crearDuelo(nombreA = 'Vos', nombreB = 'Rival') {
    return {
      jugadores: {
        A: { nombre: nombreA, rondas: [] },
        B: { nombre: nombreB, rondas: [] }
      },
      turnoActual: 'A',
      terminado: false
    };
  }

  /** Suma robusta de un array de puntajes (ronda faltante = no cuenta). */
  function sumarRondas(arr) {
    return (arr || []).reduce((s, v) => s + (v || 0), 0);
  }

  /**
   * Registra el puntaje de la ronda que acaba de terminar y decide qué sigue.
   * Sigue alternando A↔B hasta que AMBOS completaron sus RONDAS_TOTAL rondas.
   * @returns {{siguiente: 'traspaso'|'veredicto', turnoSiguiente: 'A'|'B'|null}}
   */
  function registrarTurno(duelo, jugador, puntaje) {
    if (!duelo || !duelo.jugadores[jugador]) {
      return { siguiente: 'veredicto', turnoSiguiente: null };
    }

    duelo.jugadores[jugador].rondas.push(Math.max(0, Math.round(puntaje || 0)));

    const otro = jugador === 'A' ? 'B' : 'A';
    const yoTerminado   = duelo.jugadores[jugador].rondas.length >= RONDAS_TOTAL;
    const otroTerminado = duelo.jugadores[otro].rondas.length   >= RONDAS_TOTAL;

    if (yoTerminado && otroTerminado) {
      duelo.terminado = true;
      return { siguiente: 'veredicto', turnoSiguiente: null };
    }

    // Todavía falta alguna ronda (mía o del otro): sigue el otro jugador.
    duelo.turnoActual = otro;
    return { siguiente: 'traspaso', turnoSiguiente: otro };
  }

  /**
   * Compara la SUMA de las rondas de cada jugador. Válido en cualquier
   * momento (no hace falta esperar al duelo terminado): sirve también para
   * mostrar "quién va ganando" a mitad de partida si hiciera falta.
   * @returns {{ganador: 'A'|'B'|'empate', puntajeA, puntajeB, diferencia}}
   */
  function resolver(duelo) {
    const a = sumarRondas(duelo.jugadores.A.rondas);
    const b = sumarRondas(duelo.jugadores.B.rondas);

    let ganador = 'empate';
    if (a > b) ganador = 'A';
    else if (b > a) ganador = 'B';

    return { ganador, puntajeA: a, puntajeB: b, diferencia: Math.abs(a - b) };
  }

  return { crearDuelo, registrarTurno, resolver, RONDAS_TOTAL, _puras: { sumarRondas } };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DueloEngine;
} else {
  window.DueloEngine = DueloEngine;
}
