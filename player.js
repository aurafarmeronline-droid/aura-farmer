/* ============================================================================
 * player.js — Reproductor de música del duelo ("Aura Booster")
 * ----------------------------------------------------------------------------
 * We Do — dtp & ele · Aura Farmer Web
 *
 * CHANGELOG
 *   v1.0.0-web (v1.2.2 del proyecto) — Primera versión. Reproductor real con
 *     <audio>, playlist declarativa, fondo por pista, barra de progreso
 *     clickeable, mute y "boost" visual. Degrada solo si no hay archivos.
 *
 * FILOSOFÍA
 *   El reproductor NO es esencial para jugar: si no hay pistas cargadas, o si
 *   el navegador bloquea el autoplay, o si el archivo no existe, el duelo
 *   sigue igual y el widget queda en modo "sin audio" (visible pero inerte).
 *   Nunca tira una excepción hacia arriba ni corta el loop de la cámara.
 *
 * CÓMO AGREGAR MÚSICA (para Maxi, cuando suba los temas)
 *   1. Crear la carpeta `music/` en la raíz del repo, al lado de index.html.
 *   2. Poner ahí los archivos: `music/phonk1.mp3`, `music/phonk1.jpg`, etc.
 *      El fondo puede ser imagen (.jpg/.png/.gif) o video (.mp4/.webm).
 *   3. Agregar una entrada al array PLAYLIST de acá abajo. Nada más.
 *      Si `src` apunta a un archivo que no existe, esa pista se marca como
 *      no disponible y el widget muestra "sin pista cargada" — no rompe.
 *
 * ESTRUCTURA DE DATOS (una pista)
 *   {
 *     id:       'phonk1',            // único, para futuras preferencias
 *     titulo:   'BRAZILIAN PHONK',   // línea 1 del widget
 *     subtitulo:'PHONK BRASILEIRO 2025 🔥',
 *     meta:     'Playlist • 52 tracks • 2h 34min',
 *     autor:    'ZemReis',
 *     tag:      'PHONK ENERGY',      // etiqueta roja arriba del "AURA BOOSTER"
 *     boost:    0.72,                // 0..1 — cuánto llena la barrita de boost
 *     src:      'music/phonk1.mp3',  // audio (null = solo maqueta)
 *     fondo:    'music/phonk1.jpg',  // imagen o video de fondo (null = sin fondo)
 *     fondoTipo:'imagen'             // 'imagen' | 'video'
 *   }
 * ==========================================================================*/

'use strict';

const MusicPlayer = (() => {

  /* --------------------------------------------------------------------------
   * PLAYLIST — editar acá para sumar temas. Vacía = widget en modo maqueta.
   * ------------------------------------------------------------------------*/
  const PLAYLIST = [
    {
      id: 'demo',
      titulo: 'BRAZILIAN PHONK',
      subtitulo: 'PHONK BRASILEIRO 2025 🔥',
      meta: 'Playlist • sin archivos todavía',
      autor: 'We Do',
      tag: 'PHONK ENERGY',
      boost: 0.62,
      src: null,                 // ← poner 'music/tuTema.mp3' cuando exista
      fondo: null,               // ← poner 'music/tuFondo.jpg' o .mp4
      fondoTipo: 'imagen'
    }
  ];

  /* Estado interno del módulo. Aislado: nadie de afuera lo toca. */
  const state = {
    audio: null,        // HTMLAudioElement o null si la pista no tiene src
    indice: 0,
    sonando: false,
    silenciado: false,
    disponible: false,  // ¿hay audio real cargable?
    els: null,          // cache de nodos del DOM
    montado: false
  };

  /* ==========================================================================
   * LÓGICA PURA — testeable con Node, sin DOM ni <audio>.
   * ========================================================================*/

  /**
   * Segundos → "mm:ss". Robusto ante NaN/Infinity/negativos (un <audio> sin
   * metadata cargada devuelve NaN en .duration, y eso pintaría "NaN:NaN").
   */
  function formatearTiempo(segundos) {
    const s = Number(segundos);
    if (!Number.isFinite(s) || s < 0) return '00:00';
    const total = Math.floor(s);
    const min = Math.floor(total / 60);
    const seg = total % 60;
    return String(min).padStart(2, '0') + ':' + String(seg).padStart(2, '0');
  }

  /** Porcentaje 0..100 de avance. Duración 0/NaN → 0 (no divide por cero). */
  function porcentaje(actual, duracion) {
    const a = Number(actual), d = Number(duracion);
    if (!Number.isFinite(a) || !Number.isFinite(d) || d <= 0) return 0;
    return Math.min(100, Math.max(0, (a / d) * 100));
  }

  /**
   * Traduce un click sobre la barra a segundos de la pista.
   * @param {number} clickX   px desde el borde izquierdo de la barra
   * @param {number} ancho    ancho total de la barra en px
   * @param {number} duracion duración de la pista en segundos
   */
  function segundosDesdeClick(clickX, ancho, duracion) {
    if (!Number.isFinite(duracion) || duracion <= 0 || ancho <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, clickX / ancho));
    return ratio * duracion;
  }

  /** ¿La pista tiene audio real para reproducir? */
  function pistaReproducible(pista) {
    return !!(pista && typeof pista.src === 'string' && pista.src.trim().length > 0);
  }

  /* ==========================================================================
   * CAPA DOM
   * ========================================================================*/

  function cachearEls() {
    const g = (id) => document.getElementById(id);
    return {
      raiz:   g('player'),
      bg:     g('player-bg'),
      titulo: g('player-title'),
      meta:   g('player-meta'),
      by:     g('player-by'),
      tag:    g('player-tag'),
      boost:  g('player-boost-fill'),
      play:   g('player-play'),
      vol:    g('player-vol'),
      tiempo: g('player-time'),
      track:  g('player-track'),
      prog:   g('player-prog'),
      follow: g('btn-follow')
    };
  }

  /** Cambia el <use href> del icono dentro de un botón. */
  function setIcono(boton, simbolo) {
    const use = boton && boton.querySelector('use');
    if (use) use.setAttribute('href', simbolo);
  }

  /** Pinta la pista actual (textos + fondo). No toca la reproducción. */
  function pintarPista() {
    const e = state.els;
    const p = PLAYLIST[state.indice];
    if (!e || !p) return;

    const hayAudio = pistaReproducible(p);
    e.titulo.textContent = hayAudio
      ? (p.titulo + (p.subtitulo ? '\n' + p.subtitulo : ''))
      : 'SIN PISTA CARGADA';
    e.meta.textContent = hayAudio ? (p.meta || '') : 'Poné tus temas en /music (ver player.js)';
    if (e.by)  e.by.textContent  = 'by ' + (p.autor || 'We Do');
    if (e.tag) e.tag.textContent = p.tag || 'AURA';
    if (e.boost) e.boost.style.width = Math.round((p.boost || 0) * 100) + '%';

    // Fondo: imagen por CSS, video como elemento inyectado.
    if (e.bg) {
      e.bg.innerHTML = '';
      e.bg.style.backgroundImage = '';
      if (p.fondo && p.fondoTipo === 'video') {
        const v = document.createElement('video');
        v.src = p.fondo; v.autoplay = true; v.loop = true; v.muted = true;
        v.playsInline = true;
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        // Si el video no carga, el fondo simplemente queda liso.
        v.addEventListener('error', () => { e.bg.innerHTML = ''; });
        e.bg.appendChild(v);
      } else if (p.fondo) {
        e.bg.style.backgroundImage = `url('${p.fondo}')`;
      }
    }

    e.raiz && e.raiz.classList.toggle('player--sin-audio', !hayAudio);
    actualizarBarra();
  }

  /** Refresca tiempo + barra de progreso desde el <audio>. */
  function actualizarBarra() {
    const e = state.els;
    if (!e) return;
    const a = state.audio;
    const actual = a ? a.currentTime : 0;
    const dur    = a ? a.duration : 0;
    e.tiempo.textContent = formatearTiempo(actual) + ' / ' + formatearTiempo(dur);
    e.prog.style.width = porcentaje(actual, dur) + '%';
  }

  /** Crea (o recrea) el <audio> de la pista actual. */
  function montarAudio() {
    const p = PLAYLIST[state.indice];
    if (state.audio) {
      state.audio.pause();
      state.audio.src = '';
      state.audio = null;
    }
    state.disponible = false;
    if (!pistaReproducible(p)) return;

    const a = new Audio(p.src);
    a.preload = 'metadata';
    a.loop = true;
    a.volume = 0.55;
    a.addEventListener('loadedmetadata', () => { state.disponible = true; actualizarBarra(); });
    a.addEventListener('timeupdate', actualizarBarra);
    // Archivo inexistente o formato no soportado: modo maqueta, sin ruido.
    a.addEventListener('error', () => {
      state.disponible = false;
      state.sonando = false;
      setIcono(state.els.play, '#ic-play');
      state.els.raiz && state.els.raiz.classList.add('player--sin-audio');
      console.warn('MusicPlayer: no se pudo cargar la pista', p.src);
    });
    state.audio = a;
  }

  /* ==========================================================================
   * API PÚBLICA
   * ========================================================================*/

  /** Engancha los controles del DOM. Idempotente: se puede llamar de nuevo. */
  function montar() {
    const e = cachearEls();
    if (!e.raiz) return false;      // la pantalla de farmeo no está en el DOM
    state.els = e;

    if (!state.montado) {
      e.play && e.play.addEventListener('click', alternar);
      e.vol  && e.vol.addEventListener('click', alternarSilencio);
      e.track && e.track.addEventListener('click', (ev) => {
        if (!state.audio || !state.disponible) return;
        const r = e.track.getBoundingClientRect();
        state.audio.currentTime = segundosDesdeClick(ev.clientX - r.left, r.width, state.audio.duration);
        actualizarBarra();
      });
      e.follow && e.follow.addEventListener('click', () => {
        const on = e.follow.classList.toggle('is-on');
        e.follow.textContent = on ? 'SIGUIENDO' : 'FOLLOW';
      });
      state.montado = true;
    }

    montarAudio();
    pintarPista();
    return true;
  }

  /** Play/pause. Si el navegador bloquea el autoplay, no rompe: vuelve a pausa. */
  function alternar() {
    if (!state.audio || !pistaReproducible(PLAYLIST[state.indice])) return;
    if (state.sonando) {
      state.audio.pause();
      state.sonando = false;
      setIcono(state.els.play, '#ic-play');
    } else {
      state.audio.play().then(() => {
        state.sonando = true;
        setIcono(state.els.play, '#ic-pause');
      }).catch(() => {
        // Autoplay bloqueado hasta que haya gesto del usuario: se ignora.
        state.sonando = false;
        setIcono(state.els.play, '#ic-play');
      });
    }
  }

  function alternarSilencio() {
    state.silenciado = !state.silenciado;
    if (state.audio) state.audio.muted = state.silenciado;
    setIcono(state.els.vol, state.silenciado ? '#ic-vol-mute' : '#ic-vol');
  }

  /** Pausa sin desmontar (al salir de la pantalla de farmeo). */
  function pausar() {
    if (state.audio && state.sonando) {
      state.audio.pause();
      state.sonando = false;
      if (state.els) setIcono(state.els.play, '#ic-play');
    }
  }

  /** Corta todo y libera el audio (al cerrar la app). */
  function detener() {
    pausar();
    if (state.audio) {
      state.audio.src = '';
      state.audio = null;
    }
  }

  /** Habilita/deshabilita desde Ajustes. */
  function setHabilitado(on) {
    if (!on) pausar();
    if (state.els && state.els.raiz) state.els.raiz.style.display = on ? '' : 'none';
  }

  return {
    montar, alternar, alternarSilencio, pausar, detener, setHabilitado,
    PLAYLIST,
    _puras: { formatearTiempo, porcentaje, segundosDesdeClick, pistaReproducible }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MusicPlayer;      // Node / tests headless
} else if (typeof window !== 'undefined') {
  window.MusicPlayer = MusicPlayer;  // navegador
}
