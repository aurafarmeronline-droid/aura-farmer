/* ============================================================
   AURA FARMER — app.js (con Farmeo integrado)
   v1.8.1-web — FIX trabado al pasar turno a B: writes ordenados
     (terminarMiTurno = marcar jugado + pasar turno, sin carrera). Guard
     de pantalla para no reiniciar la cámara con cada update de Firebase.
   v1.6.2-web — FIX turnos cruzados: al empezar, solo A juega y B va a espera
     (antes jugaban los dos en paralelo → pantalla negra PC / trabado cel).
     Flag jugoTurno en Firebase como fuente de verdad robusta del cierre.
   v1.6.1-web — Pantalla de espera del rival (fin de la pantalla negra) +
     botón "Terminar turno" manual + revancha ya cableada en HTML.
   v1.5.1-web — MULTIPLAYER SINCRONIZADO (turnos estilo Yu-Gi-Oh):
     · Firebase es la fuente de verdad del turno. Los dos dispositivos
       escuchan la sala y ven LA MISMA partida (antes cada uno corría su
       duelo local en paralelo → por eso se desincronizaban).
     · Juega uno por vez: si es tu turno jugás; si es del rival, ves la
       pantalla de espera (screen-espera) con su puntaje subiendo en vivo.
     · terminarRonda online → enviarPuntaje()+pasarTurno() o cerrarConResultado()
       en lugar de tocar solo la copia local.
     · Veredicto desde MI perspectiva real (rol A o B), no asumiendo A.
     Requiere en index.html: una pantalla id="screen-espera" con los ids
     espera-rival-nombre / espera-rival-puntaje / espera-rival-pose.
   v1.2.2-web — MEGA UPDATE VISUAL de la pantalla de farmeo:
     · HUD nuevo: panel VS (dos fichas + marcador + barra), medidor
       vertical de aura, barra de ronda con dots y dos relojes.
     · Relojes en vivo derivados del estado real de Farmeo
       (tiempo restante de la pose y de la coreo). Funciones puras
       separadas del DOM → testeadas con node.
     · Drawers de Chat / Opciones / Info que NO navegan: se abren
       encima de la pantalla para no cortar el duelo en curso.
     · Bottom-nav visible durante el farmeo, con confirmación antes
       de abandonar una ronda activa.
     · Reproductor (player.js) montado y pausado con la pantalla.
     · Pantallas nuevas: Tienda y Ajustes.
   v1.0-web — Motor principal reemplazado por Farmeo (farmeo.js)
   ============================================================ */

// pantallas donde el bottom-nav NO se muestra
// (v1.2.2: farmeo SÍ lo muestra — el nav es parte del diseño nuevo)
const SCREENS_SIN_NAV = new Set([
  'screen-onboarding',
  'screen-matchmaking',
  'screen-traspaso',
  'screen-espera',
  'screen-veredicto'
]);

/* ---- Hooks por pantalla ---- */
const SCREEN_HOOKS = {
  'screen-farmeo':      { onShow: startFarmeo, onHide: stopFarmeo },
  'screen-home':        { onShow: pintarHome },
  'screen-historial':   { onShow: pintarHistorial },
  'screen-ranking':     { onShow: pintarRanking },
  'screen-tienda':      { onShow: pintarTienda },
  'screen-matchmaking': { onShow: iniciarMatchmaking, onHide: limpiarMatchmaking }
};

let currentScreen = null;

function showScreen(id) {
  // Guarda: salir del farmeo con una ronda a medias pierde el puntaje.
  // Pedimos confirmación una sola vez, y solo si realmente se está jugando.
  // v1.5.1 — excepción: ir a la pantalla de espera en un duelo online es parte
  // normal del flujo de turnos, no un abandono → no pedir confirmación.
  if (currentScreen === 'screen-farmeo' && id !== 'screen-farmeo' && rondaActiva &&
      !(dueloEsOnline && id === 'screen-espera')) {
    const salir = window.confirm('Estás en medio de una ronda. ¿Salir y perder el puntaje?');
    if (!salir) return;
  }
  if (currentScreen && SCREEN_HOOKS[currentScreen]?.onHide) {
    SCREEN_HOOKS[currentScreen].onHide();
  }
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('hidden', el.id !== id);
  });
  const nav = document.getElementById('bottom-nav');
  nav.classList.toggle('hidden', SCREENS_SIN_NAV.has(id));
  // v1.2.2: el botón central de cámara también se marca activo.
  document.querySelectorAll('.bottom-nav__item, .bottom-nav__cam').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === id);
  });
  currentScreen = id;
  if (SCREEN_HOOKS[id]?.onShow) {
    SCREEN_HOOKS[id].onShow();
  }
}

/* ---- Estado del duelo ---- */
let dueloState = null;
let dueloEsOnline = false;      // v1.5.1 — true si el duelo actual es multiplayer sincronizado
let miRolOnline = null;         // 'A' o 'B' — mi rol en el duelo online
let dueloUnsub = null;          // desuscriptor de la escucha del duelo online
let esperandoRival = false;     // true mientras miro al rival jugar su turno
let rivalYaJugoOnline = false;  // v1.6.1 — el rival ya cerró su turno (flag Firebase)
let rivalNivelRemoto = 0;       // nivel histórico del rival desde la sala
let farmeoState = null;        // estado interno de Farmeo
let coreoActual = null;        // referencia al coreo que se está jugando
let rondaActiva = false;       // para saber si estamos en medio de una ronda

/* ---- Inicio de la pantalla de farmeo ---- */
function startFarmeo() {
  const video    = document.getElementById('viewfinder-video');
  const canvas   = document.getElementById('viewfinder-canvas');
  const errBox   = document.getElementById('viewfinder-error');
  const errMsg   = document.getElementById('viewfinder-error-msg');
  const poseChip = document.getElementById('pose-status');

  // Si no hay duelo, lo creamos (local o remoto)
  if (!dueloState) {
    dueloState = DueloEngine.crearDuelo();
  }
  // Inicializamos el motor Farmeo con un coreo (por ahora fijo)
  const coreoId = 'basico_juanfe';
  coreoActual = Farmeo.COREOS[coreoId];
  if (!coreoActual) {
    console.error('Coreo no encontrado:', coreoId);
    return;
  }
  farmeoState = Farmeo.fabricarEstado(coreoId);
  rondaActiva = true;

  // v1.2.2: HUD nuevo. Primero lo estático (fichas, dots), después lo vivo.
  resetBandaPopEstado();
  wireFarmeoUI();
  pintarPanelVS();
  pintarRondaDots();
  actualizarHudFarmeo({ puntajeTotal: 0, banda: null, poseNombre: '...' });
  pintarPoseFarmeo();
  arrancarRelojesFarmeo();

  // Reproductor: se monta con la pantalla y se pausa al salir.
  if (window.MusicPlayer) MusicPlayer.montar();

  // Mostrar cámara
  errBox.classList.remove('hidden');
  errMsg.textContent = 'Iniciando cámara...';
  video.style.opacity = '0';
  poseChip.classList.add('hidden');

  CameraService.start({
    videoEl: video,
    onReady: () => {
      errBox.classList.add('hidden');
      video.style.opacity = '1';
      startPoseDetection(video, canvas, poseChip);
    },
    onError: ({ code, msg }) => {
      errBox.dataset.code = code;
      errBox.classList.remove('hidden');
      errMsg.textContent = msg;
    }
  });
}

/* ---- Detección de poses con VisionService ---- */
function startPoseDetection(video, canvas, poseChip) {
  if (!window.VisionService) {
    console.warn('VisionService no disponible');
    return;
  }

  poseChip.classList.remove('hidden', 'pose-status--error');
  poseChip.textContent = '🧠 cargando IA...';

  VisionService.start({
    videoEl: video,
    canvasEl: canvas,
    onReady: () => {
      poseChip.classList.add('hidden');
    },
    onFaceUnavailable: () => {
      poseChip.classList.remove('hidden');
      poseChip.textContent = '🧠 cuerpo OK · cara no disponible';
      setTimeout(() => poseChip.classList.add('hidden'), 2500);
    },
    onError: ({ code, msg }) => {
      poseChip.classList.remove('hidden');
      poseChip.classList.add('pose-status--error');
      poseChip.textContent = '⚠ IA offline';
      console.warn('VisionService:', code, msg);
    },
    onLandmarks: ({ pose, blendshapes }) => {
      if (!rondaActiva || !farmeoState || !coreoActual) return;
      // Llamamos al motor Farmeo con el frame actual
      const ahora = performance.now();
      const resultado = Farmeo.tick(
        farmeoState,
        coreoActual,
        pose,            // landmarks de MediaPipe (array de 33 puntos)
        blendshapes,     // dict de blendshapes faciales
        ahora
      );

      // Actualizar HUD en vivo (v1.2.2: también el medidor de aura)
      actualizarHudFarmeo({
        puntajeTotal: resultado.puntajeTotal || 0,
        banda: resultado.banda || null,
        poseNombre: resultado.poseNombre || '...',
        aura: resultado.auraInstante,
        flags: resultado.flags || []
      });

      // Si se cerró un paso, actualizamos la pose objetivo
      if (resultado.pasoCerrado) {
        pintarPoseFarmeo();
        // v1.5.1 — en duelo online, subir el puntaje parcial para que el
        // rival lo vea crecer en vivo en su pantalla de espera. Una vez por
        // paso (no por frame) para no saturar Firebase.
        if (dueloEsOnline) {
          OnlineService.enviarPuntaje(resultado.puntajeTotal || 0, resultado.poseNombre).catch(() => {});
        }
        // Efecto visual de "pam" (opcional)
        const scoreEl = document.getElementById('hud-score');
        if (scoreEl) {
          scoreEl.classList.add('hud-score--pam');
          setTimeout(() => scoreEl.classList.remove('hud-score--pam'), 300);
        }
      }

      // Si la coreo terminó, cerramos la ronda
      if (resultado.coreoTerminada) {
        rondaActiva = false;
        terminarRonda();
      }
    }
  });
}

/* ============================================================
   v1.2.2 — HUD DEL FARMEO
   Lógica PURA arriba (sin DOM, testeable con node), pintado abajo.
   ============================================================ */

/** Milisegundos → "mm:ss". Robusto ante NaN/negativos/valores enormes. */
function formatearMMSS(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '00:00';
  const total = Math.ceil(n / 1000);
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return String(min).padStart(2, '0') + ':' + String(seg).padStart(2, '0');
}

/**
 * Tiempo que le queda a la POSE actual (duración + gracia menos lo corrido).
 * Antes del primer frame (inicioPaso_ms === null) devuelve el objetivo entero:
 * el reloj arranca recién cuando el motor recibe el primer frame de cámara.
 */
function tiempoRestantePaso(estado, coreo, ahoraMs) {
  if (!estado || !coreo || !Array.isArray(coreo.pasos)) return 0;
  const i = estado.pasoActual;
  if (i < 0 || i >= coreo.pasos.length) return 0;
  const paso = coreo.pasos[i];
  const objetivo = (paso.duracion_ms || 0) + (paso.gracia_ms || 0);
  if (estado.inicioPaso_ms === null || estado.inicioPaso_ms === undefined) return objetivo;
  return Math.max(0, objetivo - (ahoraMs - estado.inicioPaso_ms));
}

/** Tiempo que le queda a la RONDA entera: la pose actual + todas las que faltan. */
function tiempoRestanteCoreo(estado, coreo, ahoraMs) {
  if (!estado || !coreo || !Array.isArray(coreo.pasos)) return 0;
  let total = tiempoRestantePaso(estado, coreo, ahoraMs);
  for (let i = estado.pasoActual + 1; i < coreo.pasos.length; i++) {
    total += (coreo.pasos[i].duracion_ms || 0) + (coreo.pasos[i].gracia_ms || 0);
  }
  return total;
}

/**
 * Reparto de la barra de aura: qué porcentaje del ancho le toca al jugador.
 * Con los dos en 0 (arranque del duelo) la barra queda al medio, no en 0/100.
 */
function porcentajeBarra(puntajeYo, puntajeRival) {
  const a = Math.max(0, Number(puntajeYo) || 0);
  const b = Math.max(0, Number(puntajeRival) || 0);
  if (a + b === 0) return 50;
  return Math.round((a / (a + b)) * 100);
}

/** Altura del medidor (0..100) a partir del aura instantánea (0..1). */
function alturaMedidor(aura) {
  const a = Number(aura);
  if (!Number.isFinite(a)) return 0;
  return Math.min(100, Math.max(0, a * 100));
}

/* ---- Actualización del HUD en vivo ---- */
function actualizarHudFarmeo({ puntajeTotal, banda, poseNombre, aura, flags }) {
  const scoreEl = document.getElementById('hud-score');
  if (scoreEl) scoreEl.textContent = Math.round(puntajeTotal);

  // Barra de proporción yo/rival
  const barra = document.getElementById('vs-bar-yo');
  if (barra) barra.style.width = porcentajeBarra(puntajeTotal, puntajeRivalActual()) + '%';

  // Medidor vertical: fill + aguja, coloreados por banda
  pintarMedidor(aura, banda);

  // Cartelito PERFECT/GOOD/OK/MISS (con histéresis)
  mostrarBandaPop(banda);

  // Cabecera: "Pose 2 de 4 · 💪 DB (Doble Bíceps)"
  const sub = document.getElementById('farmeo-sub');
  const chip = document.getElementById('vf-chip-txt');
  if (farmeoState && coreoActual) {
    const idx = farmeoState.pasoActual;
    if (idx < coreoActual.pasos.length) {
      const pose = Farmeo.POSES[coreoActual.pasos[idx].poseId];
      if (sub)  sub.textContent  = `Pose ${idx + 1} de ${coreoActual.pasos.length} · ${pose.emoji || ''} ${pose.nombre}`;
      if (chip) chip.textContent = pose.nombre;
    } else {
      if (sub)  sub.textContent  = 'Ronda terminada';
      if (chip) chip.textContent = 'FIN';
    }
  }
}

/** Pinta el medidor vertical de aura del viewfinder. */
function pintarMedidor(aura, banda) {
  const fill   = document.getElementById('medidor-fill');
  const marker = document.getElementById('medidor-marker');
  if (!fill && !marker) return;
  const alto = alturaMedidor(aura);
  if (fill) fill.style.height = alto + '%';
  if (marker) {
    marker.style.bottom = alto + '%';
    const color = banda === 'PERFECT' ? 'var(--win)'
                : banda === 'GOOD'    ? 'var(--win)'
                : banda === 'OK'      ? 'var(--combo)'
                : 'var(--lose)';
    marker.style.background = color;
  }
}

/** Puntaje del rival: el que ya jugó su turno, o 0 si todavía no jugó. */
function puntajeRivalActual() {
  if (!dueloState) return 0;
  const yo = dueloState.turnoActual;
  const otro = yo === 'A' ? 'B' : 'A';
  return dueloState.jugadores[otro].puntaje ?? 0;
}

/** Fichas de los dos jugadores del panel VS (nombre, rango, nivel, foto). */
function pintarPanelVS() {
  if (!dueloState) return;
  const yo   = dueloState.turnoActual;
  const otro = yo === 'A' ? 'B' : 'A';
  const nombreYo    = dueloState.jugadores[yo].nombre;
  const nombreRival = dueloState.jugadores[otro].nombre;

  const perfil = Store.obtenerPerfil();
  const nivYo  = calcularNivel(perfil.puntajeTotal);
  // Del rival solo conocemos lo de este duelo (no tenemos su perfil histórico).
  const puntosRival = puntajeRivalActual();
  const nivRival = calcularNivel(puntosRival);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('vs-yo-nombre', nombreYo);
  set('vs-yo-rango', nivYo.rango.toUpperCase());
  set('vs-yo-nivel', 'NIVEL ' + nivYo.nivel);
  set('vs-rival-nombre', nombreRival);
  set('vs-rival-rango', puntosRival > 0 ? nivRival.rango.toUpperCase() : 'SIN MEDIR');
  set('vs-rival-nivel', 'NIVEL ' + nivRival.nivel);
  set('vs-score-rival', puntosRival);

  // Foto: si hay sesión de Google usamos su avatar; si no, iniciales.
  const fotoYo = document.getElementById('vs-yo-foto');
  const usuario = (window.AuthService && AuthService.estaLogueado())
    ? AuthService.usuarioActual() : null;
  if (fotoYo) {
    if (usuario && usuario.foto) {
      fotoYo.style.backgroundImage = `url('${usuario.foto}')`;
      fotoYo.textContent = '';
    } else {
      fotoYo.style.backgroundImage = '';
      fotoYo.textContent = iniciales(nombreYo);
    }
  }
  const fotoRival = document.getElementById('vs-rival-foto');
  if (fotoRival) fotoRival.textContent = iniciales(nombreRival);

  const barra = document.getElementById('vs-bar-yo');
  if (barra) barra.style.width = porcentajeBarra(0, puntosRival) + '%';
}

/** Dots de progreso de la ronda: uno por paso de la coreo. */
function pintarRondaDots() {
  const cont = document.getElementById('ronda-dots');
  if (!cont || !coreoActual) return;
  const total = coreoActual.pasos.length;
  const actual = farmeoState ? farmeoState.pasoActual : 0;
  cont.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('span');
    d.className = 'ronda-dot' + (i < actual ? ' ronda-dot--hecho' : i === actual ? ' ronda-dot--activo' : '');
    cont.appendChild(d);
  }
  const lbl = document.getElementById('ronda-actual');
  if (lbl) lbl.textContent = `${Math.min(actual + 1, total)} / ${total}`;
}

/* ---- Relojes en vivo (independientes del framerate de la cámara) ----
   Van por setInterval y no por el loop de detección: si la cámara se
   traba o el usuario tapa el lente, los relojes igual siguen andando. */
let relojFarmeoId = null;

function arrancarRelojesFarmeo() {
  detenerRelojesFarmeo();
  const pintar = () => {
    if (!farmeoState || !coreoActual) return;
    const ahora = performance.now();
    const tPose  = tiempoRestantePaso(farmeoState, coreoActual, ahora);
    const tRonda = tiempoRestanteCoreo(farmeoState, coreoActual, ahora);
    const elPose  = document.getElementById('vs-timer');
    const elRonda = document.getElementById('ronda-timer');
    if (elPose)  elPose.textContent  = formatearMMSS(tPose);
    if (elRonda) elRonda.textContent = formatearMMSS(tRonda);
  };
  pintar();
  relojFarmeoId = setInterval(pintar, 250);
}

function detenerRelojesFarmeo() {
  if (relojFarmeoId !== null) {
    clearInterval(relojFarmeoId);
    relojFarmeoId = null;
  }
}

/* ---- Cartelito de banda (MISS/GOOD/PERFECT) con histéresis ---- */
// (Se mantiene la misma lógica de antes, pero ahora solo se usa para feedback visual)
const BANDA_ESTABILIDAD_FRAMES = 3;
const BANDA_POP_COOLDOWN_MS    = 650;
const bandaPopEstado = {
  bandaCandidata: null,
  bandaCandidataCuenta: 0,
  ultimaBandaMostrada: null,
  ultimoPopTs: -Infinity
};

function resetBandaPopEstado() {
  bandaPopEstado.bandaCandidata = null;
  bandaPopEstado.bandaCandidataCuenta = 0;
  bandaPopEstado.ultimaBandaMostrada = null;
  bandaPopEstado.ultimoPopTs = -Infinity;
}

function debeDispararBandaPop(banda, estado, ahoraMs) {
  if (!banda) return false;
  if (banda === estado.bandaCandidata) {
    estado.bandaCandidataCuenta += 1;
  } else {
    estado.bandaCandidata = banda;
    estado.bandaCandidataCuenta = 1;
  }
  if (estado.bandaCandidataCuenta < BANDA_ESTABILIDAD_FRAMES) return false;
  if (banda === estado.ultimaBandaMostrada) return false;
  if (ahoraMs - estado.ultimoPopTs < BANDA_POP_COOLDOWN_MS) return false;
  estado.ultimaBandaMostrada = banda;
  estado.ultimoPopTs = ahoraMs;
  return true;
}

function mostrarBandaPop(banda) {
  if (!debeDispararBandaPop(banda, bandaPopEstado, performance.now())) return;
  const pop = document.getElementById('banda-pop');
  if (!pop) return;
  const texto = { PERFECT:'PERFECT', GOOD:'GOOD', OK:'OK', MISS:'MISS' }[banda];
  if (!texto) return;
  pop.textContent = texto;
  pop.className = 'banda-pop banda-pop--' + banda.toLowerCase();
  void pop.offsetWidth;
  pop.classList.add('show');
}

/* ---- Pintar la pose actual en la tarjeta MISIÓN ACTUAL ---- */
function pintarPoseFarmeo() {
  if (!farmeoState || !coreoActual) return;
  pintarRondaDots();

  const pasoIdx = farmeoState.pasoActual;
  const emojiEl = document.getElementById('mision-emoji');
  const txtEl   = document.getElementById('mision-texto');

  // Coreo terminada: la misión pasa a estado de cierre en vez de quedar vieja.
  if (pasoIdx >= coreoActual.pasos.length) {
    if (emojiEl) emojiEl.textContent = '🏁';
    if (txtEl)   txtEl.textContent = 'Ronda completa. Calculando aura...';
    return;
  }

  const pose = Farmeo.POSES[coreoActual.pasos[pasoIdx].poseId];
  if (emojiEl) emojiEl.textContent = pose.emoji || '💪';
  if (txtEl)   txtEl.textContent = pose.nota || pose.nombre;
}

/* ============================================================
   v1.2.2 — CONTROLES DE LA PANTALLA (chat, menú, info, fullscreen)
   Los tres paneles son DRAWERS dentro de #screen-farmeo: se abren
   encima y NO navegan, así el duelo en curso no se corta.
   ============================================================ */
let farmeoUIWired = false;

function abrirDrawer(id) {
  const d = document.getElementById(id);
  if (d) d.classList.remove('hidden');
}
function cerrarDrawer(id) {
  const d = document.getElementById(id);
  if (d) d.classList.add('hidden');
}
function cerrarTodosLosDrawers() {
  ['chat-drawer', 'menu-drawer', 'info-drawer'].forEach(cerrarDrawer);
}

/** Detalle de cómo se puntúa la pose actual (lee el catálogo real). */
function abrirInfoPose() {
  cerrarDrawer('menu-drawer');
  if (!farmeoState || !coreoActual) return;
  const idx = farmeoState.pasoActual;
  if (idx >= coreoActual.pasos.length) return;

  const paso = coreoActual.pasos[idx];
  const pose = Farmeo.POSES[paso.poseId];
  const tit  = document.getElementById('info-titulo');
  const txt  = document.getElementById('info-texto');
  const lista= document.getElementById('info-lista');

  if (tit) tit.textContent = `${pose.emoji || ''} ${pose.nombre}`;
  if (txt) txt.textContent = pose.nota || '';
  if (lista) {
    const items = [];
    const segs = ((paso.duracion_ms + paso.gracia_ms) / 1000).toFixed(1);
    items.push(`Sostenerla ${segs}s (incluye ${(paso.gracia_ms / 1000).toFixed(1)}s de gracia para llegar).`);
    if (Array.isArray(pose.angulos) && pose.angulos.length) {
      items.push(`Se miden ${pose.angulos.length} ángulo(s) del cuerpo: ${pose.angulos.map(a => a.articulacion).join(', ')}.`);
    }
    if (pose.cara) {
      items.push(`También se mide la cara (${pose.cara.blendshape}).`);
    }
    items.push('El puntaje es el área bajo la curva: no alcanza con clavarla un instante, hay que sostenerla.');
    items.push('Romper el personaje (reírse de más, pestañear mucho, mirar a otro lado) resta aura.');
    lista.innerHTML = items.map(t => `<li>${escaparHtml(t)}</li>`).join('');
  }
  abrirDrawer('info-drawer');
}

/** Engancha los controles una sola vez (la pantalla se muestra muchas veces). */
function wireFarmeoUI() {
  if (farmeoUIWired) return;
  farmeoUIWired = true;

  const on = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  on('btn-chat',        () => abrirDrawer('chat-drawer'));
  on('chat-cerrar',     () => cerrarDrawer('chat-drawer'));
  on('chat-cerrar-2',   () => cerrarDrawer('chat-drawer'));

  on('btn-ronda-menu',  () => abrirDrawer('menu-drawer'));
  on('menu-cerrar',     () => cerrarDrawer('menu-drawer'));

  // v1.6.1 — Terminar turno manual: corta la ronda y cobra lo farmeado.
  on('btn-terminar-turno', () => {
    if (!rondaActiva) return;
    rondaActiva = false;
    terminarRonda();
  });

  on('btn-mision-info', abrirInfoPose);
  on('op-info-pose',    abrirInfoPose);
  on('info-cerrar',     () => cerrarDrawer('info-drawer'));
  on('info-cerrar-2',   () => cerrarDrawer('info-drawer'));

  on('op-ranking',   () => { cerrarTodosLosDrawers(); showScreen('screen-ranking'); });
  on('op-historial', () => { cerrarTodosLosDrawers(); showScreen('screen-historial'); });
  on('op-abandonar', () => { cerrarTodosLosDrawers(); showScreen('screen-inicio'); });

  // Fondo del drawer = cerrar (solo si se toca el fondo, no el panel).
  ['chat-drawer', 'menu-drawer', 'info-drawer'].forEach(id => {
    const d = document.getElementById(id);
    if (d) d.addEventListener('click', (ev) => { if (ev.target === d) cerrarDrawer(id); });
  });

  // Pantalla completa del viewfinder. Si el navegador no lo permite, no rompe.
  on('btn-fullscreen', () => {
    const vf = document.getElementById('viewfinder');
    if (!vf) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (vf.requestFullscreen) {
      vf.requestFullscreen().catch(err => console.warn('Fullscreen no disponible:', err));
    }
  });
}

/* ---- Terminar la ronda actual ---- */
function terminarRonda() {
  const puntaje = farmeoState ? Math.round(farmeoState.puntajeTotal) : 0;
  if (!dueloState) dueloState = DueloEngine.crearDuelo();

  // v1.5.1 — DUELO ONLINE: Firebase es la fuente de verdad. Subo mi puntaje
  // y cedo el turno. NO decido local si va a traspaso o veredicto: eso lo
  // dicta el estado de la sala, que llega por escucharDueloOnline().
  if (dueloEsOnline) {
    dueloState.jugadores[miRolOnline].puntaje = puntaje;
    const rolRival = miRolOnline === 'A' ? 'B' : 'A';

    if (rivalYaJugoOnline) {
      // Los dos jugaron → marco mi turno y cierro el duelo con el resultado.
      OnlineService.marcarTurnoJugado(puntaje).catch(() => {});
      const r = DueloEngine.resolver(dueloState);
      OnlineService.cerrarConResultado(r.ganador).catch(() => {});
      // El veredicto llega por escucharDueloOnline (estado='terminado').
    } else {
      // Falta el rival → marco jugado y paso el turno EN ORDEN (sin carrera),
      // después quedo esperando. terminarMiTurno hace ambos writes ordenados.
      OnlineService.terminarMiTurno(puntaje).catch(() => {});
      esperandoRival = true;
      pintarEsperaRival({ rivalNombre: dueloState.jugadores[rolRival].nombre, rivalPuntaje: 0 });
      showScreen('screen-espera');
    }
    return;
  }

  // ---- DUELO LOCAL (mismo dispositivo, por turnos con traspaso) ----
  const paso = DueloEngine.registrarTurno(dueloState, dueloState.turnoActual, puntaje);
  if (paso.siguiente === 'traspaso') {
    pintarTraspaso(paso.turnoSiguiente);
    showScreen('screen-traspaso');
  } else {
    pintarVeredicto();
    showScreen('screen-veredicto');
  }
}

/* ---- Detener farmeo (release recursos) ---- */
function stopFarmeo() {
  rondaActiva = false;
  if (window.VisionService) VisionService.stop();
  CameraService.stop();

  // v1.2.2: apagar todo lo que la pantalla dejó vivo.
  detenerRelojesFarmeo();
  cerrarTodosLosDrawers();
  if (window.MusicPlayer) MusicPlayer.pausar();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

  const video = document.getElementById('viewfinder-video');
  if (video) video.style.opacity = '0';
  // Limpiar estado para la próxima ronda
  farmeoState = null;
  coreoActual = null;
}

/* ---- Traspaso (pantalla intermedia) ---- */
function pintarTraspaso(turnoSiguiente) {
  const nombre = dueloState.jugadores[turnoSiguiente].nombre;
  const badge = document.querySelector('#screen-traspaso .badge');
  const titulo = document.querySelector('#screen-traspaso .screen__title');
  const avatar = document.querySelector('#screen-traspaso .avatar');
  if (badge)  badge.textContent = `Turno ${turnoSiguiente}`;
  if (titulo) titulo.textContent = `Le toca a ${nombre}`;
  if (avatar) avatar.textContent = nombre.slice(0, 2).toUpperCase();
  // El botón de traspaso (data-nav="screen-farmeo") volverá a llamar a startFarmeo
  // y usará el dueloState existente (con el turno actualizado).
}

/* ---- Veredicto final ---- */
function pintarVeredicto() {
  const r = DueloEngine.resolver(dueloState);
  const jA = dueloState.jugadores.A, jB = dueloState.jugadores.B;

  // v1.5.1 — MI rol: en local siempre soy 'A'; en online puede ser 'A' o 'B'.
  const miRol   = dueloEsOnline ? miRolOnline : 'A';
  const rolRival = miRol === 'A' ? 'B' : 'A';
  const miPuntaje    = dueloState.jugadores[miRol].puntaje ?? 0;
  const rivalPuntaje = dueloState.jugadores[rolRival].puntaje ?? 0;
  const nombreRival  = dueloState.jugadores[rolRival].nombre;
  // Resultado desde MI perspectiva para persistir bien (W/L/E correcto).
  const miResultado = miPuntaje > rivalPuntaje ? 'A'
                    : rivalPuntaje > miPuntaje ? 'B' : 'empate';

  // Persistencia: guardo con MI puntaje como puntajeA (así el perfil suma lo mío).
  const dataFinal = Store.guardarResultado(
    { ganador: miResultado, puntajeA: miPuntaje, puntajeB: rivalPuntaje },
    nombreRival
  );
  if (window.AuthService && AuthService.estaLogueado()) {
    AuthService.subirPerfil(dataFinal).catch(() => {});
  }
  informarNivelAOnline();

  const sub = document.querySelector('#screen-veredicto .screen__subtitle');
  if (sub) sub.textContent = `${jA.nombre} ${r.puntajeA} — ${r.puntajeB} ${jB.nombre}`;

  const stats = document.querySelectorAll('#screen-veredicto .stat--lg');
  if (stats[0]) stats[0].textContent = r.puntajeA;
  if (stats[1]) stats[1].textContent = r.puntajeB;

  const badge = document.querySelector('#screen-veredicto .card .badge');
  if (badge) {
    // "GANASTE" si MI puntaje fue mayor (no si el jugador A ganó).
    const gano = miResultado === 'A';
    const empate = miResultado === 'empate';
    badge.textContent = empate ? 'EMPATE' : (gano ? 'GANASTE' : 'PERDISTE');
    badge.classList.toggle('badge--win', gano || empate);
    badge.classList.toggle('badge--lose', !gano && !empate);
  }

  // v1.5.1 — cerrar la sesión online del duelo (ya terminó).
  if (dueloEsOnline) {
    if (dueloUnsub) { dueloUnsub(); dueloUnsub = null; }
    OnlineService.detenerHeartbeat();
    OnlineService.salir().catch(() => {});
    dueloEsOnline = false;
    miRolOnline = null;
    esperandoRival = false;
  }

  dueloState = null;
}

/* ---- Funciones auxiliares de perfil, ranking, historial (sin cambios) ---- */
function calcularNivel(puntajeTotal) {
  const bandas = [
    { min: 0,    nivel: 1, rango: 'Iniciado'    },
    { min: 500,  nivel: 2, rango: 'Aprendiz'    },
    { min: 1500, nivel: 3, rango: 'Farmer'      },
    { min: 3000, nivel: 4, rango: 'Aura Farmer' },
    { min: 6000, nivel: 5, rango: 'Leyenda'     }
  ];
  for (let i = bandas.length - 1; i >= 0; i--) {
    if (puntajeTotal >= bandas[i].min) return { nivel: bandas[i].nivel, rango: bandas[i].rango };
  }
  return { nivel: 1, rango: 'Iniciado' };
}

function calcularMonedas({ victorias = 0, empates = 0 }) {
  return victorias * 50 + empates * 10;
}

function iniciales(nombre) {
  const limpio = (nombre || '?').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

function construirRanking(perfil, historial) {
  const rivales = new Map();
  for (const h of historial) {
    const acum = rivales.get(h.rival) || 0;
    rivales.set(h.rival, acum + (h.puntajeRival || 0));
  }
  const filas = [];
  filas.push({ nombre: perfil.nombre, puntaje: perfil.puntajeTotal, esYo: true });
  for (const [nombre, puntaje] of rivales) {
    filas.push({ nombre, puntaje, esYo: false });
  }
  filas.sort((a, b) => b.puntaje - a.puntaje);
  return filas;
}

function progresoNivel(puntajeTotal) {
  const cortes = [0, 500, 1500, 3000, 6000];
  let i = 0;
  for (let k = cortes.length - 1; k >= 0; k--) {
    if (puntajeTotal >= cortes[k]) { i = k; break; }
  }
  const base = cortes[i];
  const techo = cortes[i + 1];
  if (techo === undefined) {
    return { actual: puntajeTotal - base, meta: 0, pct: 100, esMax: true };
  }
  const actual = puntajeTotal - base;
  const meta = techo - base;
  const pct = Math.min(100, Math.round((actual / meta) * 100));
  return { actual, meta, pct, esMax: false };
}

function pintarHome() {
  const p = Store.obtenerPerfil();
  const { nivel, rango } = calcularNivel(p.puntajeTotal);
  const prog = progresoNivel(p.puntajeTotal);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('profile-avatar', iniciales(p.nombre));
  set('profile-nombre', p.nombre);
  set('profile-nivel', `Nivel ${nivel}`);
  set('profile-aura', rango);
  set('profile-victorias', p.victorias);
  set('profile-derrotas', p.derrotas);
  set('profile-puntos', p.puntajeTotal);
  set('profile-monedas', '🪙 ' + calcularMonedas(p));

  const barra = document.getElementById('nivel-bar-fill');
  if (barra) barra.style.width = prog.pct + '%';
  set('nivel-bar-label', prog.esMax
    ? '¡Nivel máximo alcanzado!'
    : `${prog.actual} / ${prog.meta} pts al siguiente nivel`);
}

/* ---- Tienda (v1.2.2, placeholder con las monedas reales) ---- */
function pintarTienda() {
  const el = document.getElementById('tienda-monedas');
  if (el) el.textContent = '🪙 ' + calcularMonedas(Store.obtenerPerfil());
}

/* ---- Ajustes (v1.2.2). Preferencias en memoria: no se persisten todavía. ---- */
function wireAjustes() {
  const musica    = document.getElementById('set-musica');
  const bandas    = document.getElementById('set-bandas');
  const esqueleto = document.getElementById('set-esqueleto');

  musica?.addEventListener('change', () => {
    if (window.MusicPlayer) MusicPlayer.setHabilitado(musica.checked);
  });
  bandas?.addEventListener('change', () => {
    const pop = document.getElementById('banda-pop');
    if (pop) pop.style.display = bandas.checked ? '' : 'none';
  });
  esqueleto?.addEventListener('change', () => {
    const canvas = document.getElementById('viewfinder-canvas');
    if (canvas) canvas.style.opacity = esqueleto.checked ? '1' : '0';
  });
}

function pintarRanking() {
  const perfil = Store.obtenerPerfil();
  const historial = Store.obtenerHistorial();
  const card = document.querySelector('#screen-ranking .card');
  if (!card) return;

  const filas = construirRanking(perfil, historial);

  if (historial.length === 0 && perfil.puntajeTotal === 0) {
    card.innerHTML = '<p class="screen__subtitle" style="margin:0;">Todavía no hay auras registradas. Jugá un duelo para entrar al ranking.</p>';
    return;
  }

  const medallas = ['🥇', '🥈', '🥉'];
  card.innerHTML = filas.map((f, i) => {
    const rank = medallas[i] || `${i + 1}`;
    const { nivel, rango } = calcularNivel(f.puntaje);
    const nombre = escaparHtml(f.nombre) + (f.esYo ? ' (vos)' : '');
    const meta = f.esYo ? `Nivel ${nivel} · ${rango}` : `Nivel ${nivel}`;
    return `
      <div class="list-row">
        <span class="list-row__rank">${rank}</span>
        <div class="avatar avatar--sm">${escaparHtml(iniciales(f.nombre))}</div>
        <div class="list-row__main">
          <div class="list-row__title">${nombre}</div>
          <div class="list-row__meta">${meta}</div>
        </div>
        <span class="stat">${f.puntaje}</span>
      </div>`;
  }).join('');
}

function pintarHistorial() {
  const historial = Store.obtenerHistorial();
  const card = document.querySelector('#screen-historial .card');
  if (!card) return;

  if (historial.length === 0) {
    card.innerHTML = '<p class="screen__subtitle" style="margin:0;">Todavía no jugaste ningún duelo.</p>';
    return;
  }

  card.innerHTML = historial.map(h => {
    const signo = h.resultado === 'victoria' ? '+' : h.resultado === 'derrota' ? '-' : '';
    const claseBadge = h.resultado === 'victoria' ? 'badge--win'
                      : h.resultado === 'derrota' ? 'badge--lose' : '';
    const fecha = new Date(h.fecha).toLocaleDateString('es-AR', { day:'2-digit', month:'short' });
    return `
      <div class="list-row">
        <div class="list-row__main">
          <div class="list-row__title">vs ${escaparHtml(h.rival)}</div>
          <div class="list-row__meta">${fecha} · ${h.puntajeMio}-${h.puntajeRival}</div>
        </div>
        <span class="badge ${claseBadge}">${signo}${h.puntajeMio}</span>
      </div>`;
  }).join('');
}

function escaparHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ---- Matchmaking (sin cambios) ---- */
let mmUnsubSala = null;
let mmSalaId    = null;

function mmMostrarPanel(nombre) {
  ['mm-panel-elegir', 'mm-panel-buscando', 'mm-panel-espera', 'mm-panel-listo'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === nombre) ? 'flex' : 'none';
  });
}

function mmError(msg) {
  const el = document.getElementById('mm-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function mmBuscarAuto() {
  const perfil = Store.obtenerPerfil();
  mmError('');
  mmMostrarPanel('mm-panel-buscando');
  OnlineService.buscarRival(perfil.nombre, {
    onEmparejado: ({ salaId }) => {
      mmSalaId = salaId;
      mmEscucharSala();
      OnlineService.iniciarHeartbeat();
    },
    onTimeout: () => {
      mmMostrarPanel('mm-panel-elegir');
      mmError('No encontramos rival ahora. Probá de nuevo o usá un código.');
    },
    onError: (err) => {
      console.error('mmBuscarAuto:', err);
      mmMostrarPanel('mm-panel-elegir');
      mmError('No se pudo buscar rival. Revisá tu conexión.');
    }
  });
}

function mmCancelarBusqueda() {
  OnlineService.cancelarBusqueda().catch(() => {});
  mmMostrarPanel('mm-panel-elegir');
}

function mmEscucharSala() {
  if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
  mmUnsubSala = OnlineService.escucharSala((est) => {
    if (!est.existe) return;
    if (est.estado === 'jugando' && est.rivalPresente) {
      const perfil = Store.obtenerPerfil();
      document.getElementById('mm-av-yo').textContent       = iniciales(perfil.nombre);
      document.getElementById('mm-nombre-yo').textContent   = perfil.nombre;
      document.getElementById('mm-av-rival').textContent    = iniciales(est.rivalNombre);
      document.getElementById('mm-nombre-rival').textContent = est.rivalNombre;
      mmMostrarPanel('mm-panel-listo');
    }
  });
}

async function mmCrear() {
  const perfil = Store.obtenerPerfil();
  try {
    const { salaId } = await OnlineService.crearSala(perfil.nombre);
    mmSalaId = salaId;
    document.getElementById('mm-codigo-display').textContent = salaId;
    mmMostrarPanel('mm-panel-espera');
    mmEscucharSala();
    OnlineService.iniciarHeartbeat();
  } catch (err) {
    console.error('mmCrear:', err);
    mmError('No se pudo crear la sala. Revisá tu conexión.');
  }
}

async function mmUnirse() {
  const input  = document.getElementById('mm-input-codigo');
  const codigo = (input?.value || '').trim().toUpperCase();
  mmError('');
  if (!OnlineService._puras.codigoValido(codigo)) {
    mmError('El código debe tener 4 letras/números (ej: K7QM).');
    return;
  }
  const perfil = Store.obtenerPerfil();
  try {
    await OnlineService.unirseSala(codigo, perfil.nombre);
    mmSalaId = codigo;
    mmEscucharSala();
    OnlineService.iniciarHeartbeat();
  } catch (err) {
    const msg = {
      'sala-no-disponible': 'Sala no encontrada o ya ocupada.',
      'codigo-invalido':    'Código inválido.'
    }[err.message] || 'No se pudo conectar. Revisá tu conexión.';
    mmError(msg);
  }
}

/** Envía el puntaje histórico del perfil a online.js si soporta setNivelLocal.
 *  Seguro: si esa versión de online.js no lo tiene, no hace nada. */
function informarNivelAOnline() {
  try {
    const perfil = Store.obtenerPerfil();
    if (window.OnlineService && typeof OnlineService.setNivelLocal === 'function') {
      OnlineService.setNivelLocal(perfil.puntajeTotal || 0);
    }
  } catch (e) { console.warn('informarNivelAOnline:', e); }
}

/* ═══════════════════════════════════════════════════════════════════════
 * v1.5.1 — DUELO ONLINE SINCRONIZADO (turnos estilo Yu-Gi-Oh)
 * ───────────────────────────────────────────────────────────────────────
 * Firebase es la fuente de verdad única: el campo 'turno' de la sala decide
 * quién juega. Ambos dispositivos escuchan la sala y reaccionan igual:
 *   · Es MI turno   → juego (cámara + motor).
 *   · Es su turno   → pantalla de espera, veo su puntaje subir en vivo.
 *   · estado='terminado' → los dos van al veredicto con el mismo resultado.
 * ═══════════════════════════════════════════════════════════════════════ */
function escucharDueloOnline() {
  if (dueloUnsub) { dueloUnsub(); dueloUnsub = null; }
  dueloUnsub = OnlineService.escucharSala((est) => {
    if (!est.existe) return;

    // Reflejar el puntaje del rival en el dueloState local (para HUD/veredicto).
    const rolRival = miRolOnline === 'A' ? 'B' : 'A';
    if (dueloState && typeof est.rivalPuntaje === 'number') {
      dueloState.jugadores[rolRival].puntaje = est.rivalPuntaje;
    }
    if (typeof est.rivalNivel === 'number') rivalNivelRemoto = est.rivalNivel;
    // v1.6.1 — flag robusto de "el rival ya cerró su turno".
    rivalYaJugoOnline = !!est.rivalJugo;

    // El duelo terminó (alguien cerró con resultado): los dos al veredicto.
    if (est.estado === 'terminado') {
      irAVeredictoOnline(est);
      return;
    }

    // v1.6.1 — Si YO ya jugué y ahora veo que el rival TAMBIÉN jugó (su flag
    // llegó tarde), cierro el duelo yo. Cubre la carrera de "los dos terminan
    // casi a la vez" sin que quede nadie trabado esperando.
    if (est.miJugo && est.rivalJugo && est.estado !== 'terminado' && miRolOnline === 'A') {
      const r = DueloEngine.resolver(dueloState);
      OnlineService.cerrarConResultado(r.ganador).catch(() => {});
      return;
    }

    // Sincronizar de quién es el turno según Firebase.
    if (dueloState) dueloState.turnoActual = est.turno;

    if (est.esMiTurno && !est.miJugo) {
      // Es mi turno Y todavía no jugué: entro a jugar (solo si no estoy ya ahí).
      if (currentScreen !== 'screen-farmeo') {
        esperandoRival = false;
        showScreen('screen-farmeo');
      }
    } else {
      // Turno del rival, o ya jugué y espero el cierre: pantalla de espera.
      esperandoRival = true;
      // Actualizo el puntaje en vivo SIEMPRE (para verlo subir), pero solo
      // cambio de pantalla si no estoy ya en espera (evita reinicios).
      pintarEsperaRival(est);
      if (currentScreen !== 'screen-espera') showScreen('screen-espera');
    }
  });
}

/** Pinta la pantalla de espera mientras el rival juega su turno. */
function pintarEsperaRival(est) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const nombre = est.rivalNombre || 'Rival';
  set('espera-rival-nombre', nombre);
  set('espera-rival-puntaje', est.rivalPuntaje || 0);
  set('espera-rival-avatar', nombre.slice(0, 2).toUpperCase());
  const pose = est.rivalPose || est.poseActual;
  set('espera-rival-pose', pose ? ('Haciendo: ' + pose) : '');
}

/** Cierre sincronizado: ambos ven el mismo veredicto desde Firebase. */
function irAVeredictoOnline(est) {
  if (dueloUnsub) { dueloUnsub(); dueloUnsub = null; }
  esperandoRival = false;
  // Aseguramos los dos puntajes en el dueloState antes de resolver.
  const rolRival = miRolOnline === 'A' ? 'B' : 'A';
  if (dueloState) {
    if (typeof est.rivalPuntaje === 'number') dueloState.jugadores[rolRival].puntaje = est.rivalPuntaje;
    dueloState.terminado = true;
  }
  pintarVeredicto();
  showScreen('screen-veredicto');
}

function mmEmpezarDuelo() {
  const sesion = OnlineService.sesionActual();
  if (!sesion) return;
  const perfil      = Store.obtenerPerfil();
  const rivalNombre = document.getElementById('mm-nombre-rival').textContent;
  const nombreA     = sesion.rol === 'A' ? perfil.nombre : rivalNombre;
  const nombreB     = sesion.rol === 'A' ? rivalNombre   : perfil.nombre;
  dueloState = DueloEngine.crearDuelo(nombreA, nombreB);

  // v1.5.1 — DUELO ONLINE SINCRONIZADO. Marcamos que este duelo es online y
  // guardamos mi rol. NO cortamos heartbeat ni escucha: el duelo se juega
  // sincronizado contra Firebase (turnos estilo Yu-Gi-Oh, misma partida).
  dueloEsOnline = true;
  miRolOnline   = sesion.rol;
  rivalYaJugoOnline = false;   // v1.6.1 — reset de flags de turno
  if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
  escucharDueloOnline();  // re-suscribe con el handler del DUELO (no del lobby)

  // v1.6.1 — El turno arranca en 'A'. Solo A entra a jugar; B va directo a la
  // pantalla de espera. Así no juegan los dos en paralelo (bug de turnos
  // cruzados). Cuando A termina, escucharDueloOnline le pasa el turno a B.
  if (miRolOnline === 'A') {
    esperandoRival = false;
    showScreen('screen-farmeo');
  } else {
    esperandoRival = true;
    pintarEsperaRival({ rivalNombre: nombreA, rivalPuntaje: 0 });
    showScreen('screen-espera');
  }
}

function limpiarMatchmaking() {
  if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
  OnlineService.cancelarBusqueda().catch(() => {});
  OnlineService.salir().catch(() => {});
  mmSalaId = null;
  mmError('');
  const inp = document.getElementById('mm-input-codigo');
  if (inp) inp.value = '';
}

function iniciarMatchmaking() {
  mmMostrarPanel('mm-panel-elegir');
  if (!OnlineService.estaDisponible()) {
    window.addEventListener('firebase-ready', () => OnlineService.init(), { once: true });
    OnlineService.init();
  }
  const reBind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    const clone = el.cloneNode(true);
    el.replaceWith(clone);
    clone.addEventListener('click', fn);
  };
  reBind('mm-btn-auto',           mmBuscarAuto);
  reBind('mm-btn-cancelar-buscar',mmCancelarBusqueda);
  reBind('mm-btn-crear',          mmCrear);
  reBind('mm-btn-unirse',         mmUnirse);
  reBind('mm-btn-cancelar-espera',() => { limpiarMatchmaking(); showScreen('screen-inicio'); });
  reBind('mm-btn-empezar',        mmEmpezarDuelo);
  reBind('mm-btn-cancelar-listo', () => { limpiarMatchmaking(); showScreen('screen-inicio'); });
  const inp = document.getElementById('mm-input-codigo');
  if (inp) inp.addEventListener('input', () => mmError(''));
}

/* ---- Inicio y configuración ---- */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.nav));
  });

  window.addEventListener('beforeunload', () => {
    if (window.VisionService) VisionService.stop();
    CameraService.stop();
    if (window.MusicPlayer) MusicPlayer.detener();
    OnlineService.salir().catch(() => {});
  });

  wirePerfil();
  wireAuth();
  wireAjustes();

  // v1.4.1 — Identidad por defecto: INVITADO temporal (se borra al cerrar
  // pestaña). Login Google (en wireAuth) cambia a modo cuenta persistente.
  if (typeof Store.fijarModo === 'function') Store.fijarModo('invitado');
  if (Store.nombreEsDefault() && typeof Store.nombreInvitadoAleatorio === 'function') {
    Store.guardarNombre(Store.nombreInvitadoAleatorio());
  }
  informarNivelAOnline();

  if (Store.nombreEsDefault()) {
    showScreen('screen-onboarding');
  } else {
    showScreen('screen-inicio');
  }
});

/* ---- Perfil editable (sin cambios) ---- */
function wirePerfil() {
  const obInput = document.getElementById('onboarding-input');
  const obError = document.getElementById('onboarding-error');
  const obListo = document.getElementById('btn-onboarding-listo');
  if (obListo) {
    const confirmar = () => {
      const escrito = (obInput?.value || '').trim();
      if (!escrito) { obError?.classList.remove('hidden'); return; }
      Store.guardarNombre(escrito);
      obError?.classList.add('hidden');
      showScreen('screen-inicio');
    };
    obListo.addEventListener('click', confirmar);
    obInput?.addEventListener('keydown', e => { if (e.key === 'Enter') confirmar(); });
    obInput?.addEventListener('input', () => obError?.classList.add('hidden'));
  }

  const editor = document.getElementById('perfil-editor');
  const inp    = document.getElementById('input-nombre');
  const err    = document.getElementById('perfil-editor-error');
  const abrir  = document.getElementById('btn-editar-perfil');
  const guardar= document.getElementById('btn-guardar-nombre');
  const cancel = document.getElementById('btn-cancelar-nombre');

  abrir?.addEventListener('click', () => {
    if (inp) inp.value = Store.obtenerPerfil().nombre || '';
    err?.classList.add('hidden');
    editor?.classList.remove('hidden');
    inp?.focus();
  });
  cancel?.addEventListener('click', () => editor?.classList.add('hidden'));
  const guardarNombre = () => {
    const escrito = (inp?.value || '').trim();
    if (!escrito) { err?.classList.remove('hidden'); return; }
    Store.guardarNombre(escrito);
    editor?.classList.add('hidden');
    pintarHome();
  };
  guardar?.addEventListener('click', guardarNombre);
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') guardarNombre(); });
  inp?.addEventListener('input', () => err?.classList.add('hidden'));
}

/* ---- Auth (sin cambios) ---- */
function wireAuth() {
  const desconectado = document.getElementById('auth-desconectado');
  const conectado     = document.getElementById('auth-conectado');
  const emailEl       = document.getElementById('auth-email');
  const btnLogin       = document.getElementById('btn-google-login');
  const btnLogout      = document.getElementById('btn-google-logout');

  const pintarSesion = (usuario) => {
    if (!desconectado || !conectado) return;
    if (usuario) {
      desconectado.classList.add('hidden');
      conectado.classList.remove('hidden');
      if (emailEl) emailEl.textContent = usuario.email || usuario.nombre;
    } else {
      desconectado.classList.remove('hidden');
      conectado.classList.add('hidden');
    }
  };

  const arrancarAuth = () => {
    if (!AuthService.estaDisponible()) AuthService.init();
    AuthService.onCambioSesion(pintarSesion);
  };
  if (window.__FIREBASE__) arrancarAuth();
  else window.addEventListener('firebase-ready', arrancarAuth, { once: true });

  btnLogin?.addEventListener('click', async () => {
    btnLogin.disabled = true;
    try {
      await AuthService.iniciarSesionGoogle();
      if (typeof Store.fijarModo === 'function') Store.fijarModo('cuenta'); // v1.4.1 persistente
      const perfilFinal = await AuthService.sincronizarPerfil(Store.exportarTodo());
      Store.reemplazarPerfil(perfilFinal);
      informarNivelAOnline();
      pintarHome();
    } catch (err) {
      const codigo = err && err.code;
      if (codigo !== 'auth/popup-closed-by-user' && codigo !== 'auth/cancelled-popup-request') {
        console.error('wireAuth login:', err);
        alert('No se pudo iniciar sesión con Google. Probá de nuevo.');
      }
    } finally {
      btnLogin.disabled = false;
    }
  });

  btnLogout?.addEventListener('click', async () => {
    await AuthService.cerrarSesion();
    // v1.4.1 — al salir, volvemos a invitado temporal.
    if (typeof Store.fijarModo === 'function') Store.fijarModo('invitado');
    if (Store.nombreEsDefault() && typeof Store.nombreInvitadoAleatorio === 'function') {
      Store.guardarNombre(Store.nombreInvitadoAleatorio());
    }
    informarNivelAOnline();
    pintarHome();
  });
}