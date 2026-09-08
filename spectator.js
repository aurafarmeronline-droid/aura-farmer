/* ============================================================
   AURA FARMER — spectator.js
   v0.2-web (v2.2.4) — F5 FASE 2a: WebRTC REAL (video). Un solo
   RTCPeerConnection persistente por duelo (iniciarConexion, llamado UNA
   vez al arrancar el duelo, no por turno). actualizarTrackLocal()
   hace replaceTrack cuando la cámara prende/apaga según el turno.
   Señalización vía online.js (enviarSenal/escucharSenalRival, inyectados
   por parámetro — este módulo no conoce OnlineService directamente).
   Timeout real de 5s si no hay conexión → modo 'esqueleto' (el DIBUJO
   real del esqueleto con landmarks queda para Fase 2b, sigue siendo
   placeholder de texto por ahora).
   v0.1-web (v2.2.4) — máquina de estados de los 3 modos, placeholder.

   NO TOCA: duelo.js, farmeo.js, poses.js, vision.js, store.js, auth.js,
   player.js, online.js (solo LEE las funciones que ya expone).
   ============================================================ */

const SpectatorService = (() => {
  const MODOS = ['inactivo', 'conectando', 'video', 'esqueleto'];
  const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
  const TIMEOUT_CONEXION_MS = 5000;

  const state = {
    modo: 'inactivo',
    contenedorEl: null,
    videoEl: null,
    remoteStream: null,
    pc: null,
    unsubSenal: null,
    candidatosPendientes: [],
    remoteDescListo: false,
    timeoutId: null,
    sessionId: 0
  };

  function siguienteModo(modoActual, evento) {
    switch (evento) {
      case 'iniciar':     return 'conectando';
      case 'conexion-ok': return modoActual === 'conectando' ? 'video' : modoActual;
      case 'timeout':     return modoActual === 'conectando' ? 'esqueleto' : modoActual;
      case 'detener':     return 'inactivo';
      default:            return modoActual;
    }
  }

  function textoPlaceholder(modo) {
    switch (modo) {
      case 'conectando': return 'Conectando con el rival…';
      case 'esqueleto':   return 'Esqueleto en vivo (Fase 2b)';
      default:            return '';
    }
  }

  function necesitaBuffer(remoteDescListo) {
    return !remoteDescListo;
  }

  function pintar() {
    if (!state.contenedorEl) return;
    if (state.modo === 'video' && state.remoteStream) {
      if (!state.videoEl) {
        state.videoEl = document.createElement('video');
        state.videoEl.autoplay = true;
        state.videoEl.playsInline = true;
        state.videoEl.muted = true;
        state.videoEl.style.width = '100%';
        state.videoEl.style.borderRadius = '12px';
        state.contenedorEl.textContent = '';
        state.contenedorEl.appendChild(state.videoEl);
      }
      if (state.videoEl.srcObject !== state.remoteStream) state.videoEl.srcObject = state.remoteStream;
      return;
    }
    state.videoEl = null;
    state.contenedorEl.textContent = textoPlaceholder(state.modo);
    if (state.contenedorEl.dataset) state.contenedorEl.dataset.modo = state.modo;
  }

  function cambiarModo(evento) {
    state.modo = siguienteModo(state.modo, evento);
    pintar();
    return state.modo;
  }

  function montar(contenedorEl) {
    if (!contenedorEl) return;
    state.contenedorEl = contenedorEl;
    state.videoEl = null;
    pintar();
  }

  function desmontar() {
    if (state.contenedorEl) state.contenedorEl.textContent = '';
    state.contenedorEl = null;
    state.videoEl = null;
  }

  function iniciarConexion(opts) {
    if (typeof RTCPeerConnection === 'undefined') return;
    cerrarConexion();
    state.sessionId += 1;
    const miSesion = state.sessionId;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    state.pc = pc;
    state.remoteDescListo = false;
    state.candidatosPendientes = [];
    cambiarModo('iniciar');

    pc.addTransceiver('video', { direction: 'sendrecv' });
    const streamInicial = opts.obtenerStreamLocal && opts.obtenerStreamLocal();
    if (streamInicial) actualizarTrackLocal(streamInicial);

    pc.ontrack = (e) => {
      if (miSesion !== state.sessionId) return;
      state.remoteStream = e.streams[0];
      if (['connected', 'completed'].includes(pc.iceConnectionState)) cambiarModo('conexion-ok');
    };
    pc.oniceconnectionstatechange = () => {
      if (miSesion !== state.sessionId) return;
      if (['connected', 'completed'].includes(pc.iceConnectionState) && state.remoteStream) {
        cambiarModo('conexion-ok');
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) opts.enviarSenal({ candidate: e.candidate.toJSON() }).catch(() => {});
    };

    state.unsubSenal = opts.escucharSenalRival(async (datos) => {
      if (!datos || miSesion !== state.sessionId) return;
      try {
        if (datos.offer && opts.rol === 'B' && !state.remoteDescListo) {
          state.remoteDescListo = true;   // seteo YA (síncrono) para cortar la carrera de re-entradas
          await pc.setRemoteDescription(datos.offer);
          state.candidatosPendientes.splice(0).forEach(c => pc.addIceCandidate(c).catch(() => {}));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await opts.enviarSenal({ answer: { type: answer.type, sdp: answer.sdp } });
        } else if (datos.answer && opts.rol === 'A' && !state.remoteDescListo) {
          state.remoteDescListo = true;
          await pc.setRemoteDescription(datos.answer);
          state.candidatosPendientes.splice(0).forEach(c => pc.addIceCandidate(c).catch(() => {}));
        }
        if (datos.candidate) {
          if (necesitaBuffer(state.remoteDescListo)) state.candidatosPendientes.push(datos.candidate);
          else await pc.addIceCandidate(datos.candidate).catch(() => {});
        }
      } catch (err) {
        console.warn('SpectatorService señalización:', err);
      }
    });

    if (opts.rol === 'A') {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer).then(() =>
          opts.enviarSenal({ offer: { type: offer.type, sdp: offer.sdp } })))
        .catch(err => console.warn('SpectatorService createOffer:', err));
    }

    state.timeoutId = setTimeout(() => {
      if (miSesion !== state.sessionId) return;
      cambiarModo('timeout');
    }, TIMEOUT_CONEXION_MS);
  }

  function actualizarTrackLocal(stream) {
    if (!state.pc) return;
    const sender = state.pc.getSenders().find(s => !s.track || s.track.kind === 'video');
    if (!sender) return;
    const track = stream ? stream.getVideoTracks()[0] : null;
    sender.replaceTrack(track || null).catch(() => {});
  }

  function cerrarConexion() {
    if (state.timeoutId) clearTimeout(state.timeoutId);
    state.timeoutId = null;
    if (state.unsubSenal) state.unsubSenal();
    state.unsubSenal = null;
    if (state.pc) state.pc.close();
    state.pc = null;
    state.remoteStream = null;
    state.remoteDescListo = false;
    state.candidatosPendientes = [];
    state.sessionId += 1;
    state.modo = siguienteModo(state.modo, 'detener');
    desmontar();
  }

  function obtenerModo() { return state.modo; }

  return {
    montar, desmontar, obtenerModo,
    iniciarConexion, actualizarTrackLocal, cerrarConexion,
    _puras: { siguienteModo, textoPlaceholder, necesitaBuffer, MODOS }
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpectatorService;
} else {
  window.SpectatorService = SpectatorService;
}
