/* ============================================================
   AURA FARMER — app.js
   v0.9.7-web — Fix enganche: mmEscucharSala usa rivalPresente (no
     rivalConectado) → la PC engancha sin esperar el heartbeat del rival.
   v0.9.6-web — Matchmaking automático completo (F4): mmBuscarAuto/
     mmCancelarBusqueda enganchan buscarRival() real; onEmparejado reusa el
     flujo escuchar-sala + heartbeat; timeout 20s vuelve al panel elegir.
   v0.9.5-web — Matchmaking automático (F1 layout): botón "Buscar rival" +
     panel de búsqueda con spinner/cancelar.
   v0.9.4-web — Auditoría bandas/timer: cartelito con histéresis+cooldown
     (antes redisparaba en cada cruce de banda por ruido de landmarks);
     KEYFRAME_INTERVALO_S 3→10s (ronda de 3 poses pasa de 9s a 30s reales).
   v0.9.3-web — T3: blendshapes de cara → ScoreEngine. vision.js emite
     dict {nombre:score}; app pasa pose completa + blendshapes; motor
     aplica precisión × confianza_facial (poses Yagami/Rugido/Chad).
   v0.9.2-web — T1: ranking real desde Store (vos + rivales del
     historial, ordenado desc, estado vacío). T2: monedas
     (W*50+E*10) y nivel/rango por puntajeTotal en Home,
     dinámicos. Helpers puros: calcularNivel/Monedas/iniciales/
     construirRanking (testeados headless).
   v0.9-web — router + hooks + Camera + Vision + ScoreEngine + Catálogo
   + Duelo (A,B,C) + Store: persistencia de perfil/historial (D) con
   localStorage, fallback a memoria si no está disponible.
   Modo GUIADO: pose objetivo fija (demo). Score por KEYFRAME (cada 3s),
   ya no continuo. Modo LIBRE queda a futuro (puntuado por público real).
   NOTA: el ScoreEngine es el CHASIS del proyecto — auditoría dedicada
   pendiente. Migrar a sostenimiento (Opción 2) = cambiar el disparador
   del keyframe (hoy timer) sin tocar el motor.
   ============================================================ */

// pantallas donde el bottom-nav NO se muestra (flujo de juego/transición)
const SCREENS_SIN_NAV = new Set([
  'screen-matchmaking',
  'screen-traspaso',
  'screen-farmeo',
  'screen-veredicto'
]);

/* ---- RONDA (B): secuencia de poses del catálogo ----
   Cada ronda = N poses. En cada "pam" se cobra la pose actual y se avanza
   a la siguiente. Al terminar todas, la ronda cierra y va a Veredicto.
   Adelanto de (C): rondaState guarda de quién es el turno, para que el
   DueloEngine solo tenga que alternar jugador y comparar totales. */
const POSES_POR_RONDA = 3;

let rondaState = null;      // {poses[], indiceActual, jugador, puntajes[]}
let scoreState = null;      // estado del ScoreEngine para la pose actual
let keyframeTimer = null;   // intervalo que dispara el "pam"
let keyframeCuenta = 0;     // segundos restantes al próximo pam

const KEYFRAME_INTERVALO_S = 10;  // Opción 1: keyframe temporizado cada 10s
                                   // (3 poses × 10s = 30s de ronda; antes era 9s)

/** Crea una ronda nueva para el jugador dado ('A' | 'B'). */
function crearRonda(jugador = 'A') {
  return {
    poses: CatalogoPoses.armarRonda(POSES_POR_RONDA),
    indiceActual: 0,
    jugador,
    puntajeAcumulado: 0
  };
}

/** Pose que se está pidiendo ahora, o null si la ronda terminó. */
function poseActual() {
  if (!rondaState) return null;
  return rondaState.poses[rondaState.indiceActual] || null;
}

/* Hooks por pantalla — mismo patrón que on_show/on_hide del .pyw.
   Acá se enchufa el ciclo de vida de recursos pesados (cámara ahora,
   MediaPipe en v0.3-web). */
const SCREEN_HOOKS = {
  'screen-farmeo':      { onShow: startFarmeo, onHide: stopFarmeo },
  'screen-home':        { onShow: pintarHome },
  'screen-historial':   { onShow: pintarHistorial },
  'screen-ranking':     { onShow: pintarRanking },
  'screen-matchmaking': { onShow: iniciarMatchmaking, onHide: limpiarMatchmaking }
};

let currentScreen = null;

function showScreen(id) {
  // Cleanup de la pantalla que dejamos, antes de tocar el DOM visible.
  // Importante para que la cámara se libere ANTES de que se muestre otra.
  if (currentScreen && SCREEN_HOOKS[currentScreen]?.onHide) {
    SCREEN_HOOKS[currentScreen].onHide();
  }

  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('hidden', el.id !== id);
  });

  const nav = document.getElementById('bottom-nav');
  nav.classList.toggle('hidden', SCREENS_SIN_NAV.has(id));

  document.querySelectorAll('.bottom-nav__item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === id);
  });

  currentScreen = id;

  if (SCREEN_HOOKS[id]?.onShow) {
    SCREEN_HOOKS[id].onShow();
  }
}

/* ---- hooks concretos: pantalla de farmeo ---- */

function startFarmeo() {
  const video    = document.getElementById('viewfinder-video');
  const canvas   = document.getElementById('viewfinder-canvas');
  const errBox   = document.getElementById('viewfinder-error');
  const errMsg   = document.getElementById('viewfinder-error-msg');
  const poseChip = document.getElementById('pose-status');

  // Si venimos de traspaso, rondaState ya trae el jugador correcto.
  // Si es un duelo nuevo, arrancamos con A.
  if (!dueloState) dueloState = DueloEngine.crearDuelo();
  if (!rondaState || rondaState.indiceActual >= rondaState.poses.length) {
    rondaState = crearRonda(dueloState.turnoActual);
  }
  scoreState = ScoreEngine.crearEstado();
  resetBandaPopEstado();        // cartelito arranca limpio cada farmeo
  actualizarHud({ banda: null, comboActual: 0, puntajeTotal: 0 });
  pintarPoseActual();
  arrancarKeyframeTimer();

  errBox.classList.remove('hidden');
  errMsg.textContent = 'Iniciando cámara...';
  video.style.opacity = '0';
  poseChip.classList.add('hidden');

  CameraService.start({
    videoEl: video,
    onReady: () => {
      errBox.classList.add('hidden');
      video.style.opacity = '1';
      // Cámara viva → arrancamos detección de poses encima
      startPoseDetection(video, canvas, poseChip);
    },
    onError: ({ code, msg }) => {
      errBox.dataset.code = code;
      errBox.classList.remove('hidden');
      errMsg.textContent = msg;
    }
  });
}

/**
 * Arranca VisionService (Pose + Face unificados) una vez que la cámara
 * ya está transmitiendo. Muestra el chip "cargando IA..." mientras baja
 * el/los modelo(s) (primer uso). Si Face no cargó, el chip lo indica
 * brevemente pero el cuerpo sigue andando igual.
 * Si VisionService no está disponible (ES module todavía cargando, muy
 * raro porque el usuario tuvo que hacer al menos un click antes), degrada
 * silencioso: cámara sigue visible, sin esqueleto.
 */
function startPoseDetection(video, canvas, poseChip) {
  if (!window.VisionService) {
    console.warn('VisionService no disponible todavía');
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
      // Cuerpo sigue andando; avisamos brevemente que la cara no cargó.
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
      // CAPA 1 (medición): cada frame solo mide la banda actual para feedback
      // en vivo (color del combo). El TOTAL no cambia acá — lo cobra el
      // keyframe. Modo GUIADO; modo LIBRE queda para cuando haya público.
      if (!scoreState) return;
      // Pasamos la pose COMPLETA (joints + blendshapes) para que el motor
      // aplique precisión_cuerpo × confianza_facial en una sola pasada.
      const r = ScoreEngine.evaluarFrame(scoreState, pose, poseActual() || [], blendshapes);
      // Refrescamos solo combo/color, el score lo actualiza el keyframe.
      pintarComboVivo(r.banda, r.comboActual);
    }
  });
}

/**
 * Pinta el HUD completo (score + combo). Se usa al entrar/resetear.
 */
function actualizarHud({ banda, comboActual, puntajeTotal }) {
  const scoreEl = document.getElementById('hud-score');
  if (scoreEl) scoreEl.textContent = puntajeTotal;
  pintarComboVivo(banda, comboActual);
}

/**
 * Feedback EN VIVO (por frame): solo combo + color, sin tocar el score.
 * El score solo cambia en cada "pam" (keyframe).
 */
function pintarComboVivo(banda, comboActual) {
  const comboEl = document.getElementById('hud-combo');
  if (!comboEl) return;
  const mult = Math.min(2.0, 1 + comboActual * 0.1).toFixed(1);
  comboEl.textContent = `Combo ×${mult}`;
  comboEl.classList.toggle('badge--lose', banda === 'MISS');
  comboEl.classList.toggle('badge--combo', banda !== 'MISS');
  mostrarBandaPop(banda);
}

/* Cartelito MISS/GOOD/PERFECT/OK (T3) — v0.9.4-web: antes redisparaba en
   cada frame que CAMBIABA de banda, y a 30fps con landmarks ruidosos la
   banda cruza el límite constantemente (ej. 34°↔36° = GOOD↔OK todo el
   tiempo) → titileo. Ahora exige (a) que la banda se sostenga N frames
   seguidos antes de confirmarla, y (b) un cooldown mínimo entre pops para
   no atropellar la animación anterior (0.7s en CSS). La decisión es una
   función PURA (debeDispararBandaPop) separada del DOM para poder testearla
   headless; mostrarBandaPop es solo el wrapper que pinta. */
const BANDA_ESTABILIDAD_FRAMES = 3;    // frames seguidos iguales para confirmar la banda
const BANDA_POP_COOLDOWN_MS    = 650;  // no repetir pop antes de ~lo que dura la animación

const bandaPopEstado = {
  bandaCandidata: null,
  bandaCandidataCuenta: 0,
  ultimaBandaMostrada: null,
  ultimoPopTs: -Infinity   // -Infinity, no 0: si no, el cooldown bloquea el
                           // primer pop cuando ahoraMs todavía es chico
};

function resetBandaPopEstado() {
  bandaPopEstado.bandaCandidata = null;
  bandaPopEstado.bandaCandidataCuenta = 0;
  bandaPopEstado.ultimaBandaMostrada = null;
  bandaPopEstado.ultimoPopTs = -Infinity;
}

/**
 * Lógica pura: decide si corresponde disparar el pop AHORA. Muta `estado`
 * in-place (candidata, contador, última mostrada, timestamp). Sin DOM →
 * testeable con node directo, pasando un estado y timestamps sintéticos.
 */
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
  void pop.offsetWidth;          // fuerza reflow para reiniciar la animación
  pop.classList.add('show');
}

/**
 * Arranca el temporizador que dispara el keyframe ("pam") cada N segundos.
 * En cada pam: cobra el promedio sostenido y lo suma al score.
 * (Opción 1 - temporizado. Migrar a sostenimiento = cambiar este disparador.)
 */
function arrancarKeyframeTimer() {
  detenerKeyframeTimer();
  keyframeCuenta = KEYFRAME_INTERVALO_S;
  actualizarProximaPose();

  keyframeTimer = setInterval(() => {
    keyframeCuenta -= 1;
    if (keyframeCuenta <= 0) {
      dispararKeyframe();
      keyframeCuenta = KEYFRAME_INTERVALO_S;
    }
    actualizarProximaPose();
  }, 1000);
}

function detenerKeyframeTimer() {
  if (keyframeTimer !== null) {
    clearInterval(keyframeTimer);
    keyframeTimer = null;
  }
}

/**
 * El "pam": cobra la pose actual, avanza a la siguiente y, si no quedan,
 * cierra la ronda. (B: secuencia. Adelanto de C: guarda el total del turno.)
 */
function dispararKeyframe() {
  if (!scoreState || !rondaState) return;

  const k = ScoreEngine.capturarKeyframe(scoreState);
  rondaState.puntajeAcumulado += k.puntosKeyframe;

  const scoreEl = document.getElementById('hud-score');
  if (scoreEl) {
    scoreEl.textContent = rondaState.puntajeAcumulado;
    scoreEl.classList.add('hud-score--pam');
    setTimeout(() => scoreEl.classList.remove('hud-score--pam'), 300);
  }

  // Avanzamos a la siguiente pose de la ronda
  rondaState.indiceActual += 1;

  if (rondaState.indiceActual >= rondaState.poses.length) {
    terminarRonda();
    return;
  }

  // Pose nueva → estado de score limpio (combo no se arrastra entre poses)
  scoreState = ScoreEngine.crearEstado();
  pintarPoseActual();
}

/**
 * Cierra la ronda del jugador actual. El DueloEngine decide si toca
 * traspaso al otro jugador o si ya jugaron los dos y hay veredicto.
 */
function terminarRonda() {
  detenerKeyframeTimer();
  if (!dueloState) dueloState = DueloEngine.crearDuelo();

  const paso = DueloEngine.registrarTurno(
    dueloState, rondaState.jugador, rondaState.puntajeAcumulado
  );

  if (paso.siguiente === 'traspaso') {
    pintarTraspaso(paso.turnoSiguiente);
    showScreen('screen-traspaso');
  } else {
    pintarVeredicto();
    showScreen('screen-veredicto');
  }
}

let dueloState = null;   // duelo en curso (null = todavía no arrancó)

/** Prepara la pantalla de traspaso para el jugador que sigue. */
function pintarTraspaso(turnoSiguiente) {
  const nombre = dueloState.jugadores[turnoSiguiente].nombre;
  const badge = document.querySelector('#screen-traspaso .badge');
  const titulo = document.querySelector('#screen-traspaso .screen__title');
  const avatar = document.querySelector('#screen-traspaso .avatar');

  if (badge)  badge.textContent = `Turno ${turnoSiguiente}`;
  if (titulo) titulo.textContent = `Le toca a ${nombre}`;
  if (avatar) avatar.textContent = nombre.slice(0, 2).toUpperCase();

  // El botón de traspaso arranca el turno del jugador siguiente.
  rondaState = crearRonda(turnoSiguiente);
}

/** Vuelca el resultado final del duelo en la pantalla de Veredicto. */
function pintarVeredicto() {
  const r = DueloEngine.resolver(dueloState);
  const jA = dueloState.jugadores.A, jB = dueloState.jugadores.B;

  // Persistencia (D): guardamos el resultado antes de limpiar dueloState.
  Store.guardarResultado(r, jB.nombre);

  const sub = document.querySelector('#screen-veredicto .screen__subtitle');
  if (sub) sub.textContent = `${jA.nombre} ${r.puntajeA} — ${r.puntajeB} ${jB.nombre}`;

  // Marcadores grandes de cada jugador
  const stats = document.querySelectorAll('#screen-veredicto .stat--lg');
  if (stats[0]) stats[0].textContent = r.puntajeA;
  if (stats[1]) stats[1].textContent = r.puntajeB;

  // Badge de resultado (asumimos que A es el usuario local)
  const badge = document.querySelector('#screen-veredicto .card .badge');
  if (badge) {
    const gano = r.ganador === 'A';
    badge.textContent = r.ganador === 'empate' ? 'EMPATE' : (gano ? 'GANASTE' : 'PERDISTE');
    badge.classList.toggle('badge--win', gano || r.ganador === 'empate');
    badge.classList.toggle('badge--lose', !gano && r.ganador !== 'empate');
  }

  dueloState = null;   // duelo cerrado; el próximo arranca limpio
}

/**
 * Muestra la pose que se está pidiendo: título, tip y cuál viene después.
 */
function pintarPoseActual() {
  const pa = poseActual();
  if (!pa || !rondaState) return;

  const sub = document.querySelector('#screen-farmeo .screen__subtitle');
  if (sub) {
    sub.textContent =
      `Pose ${rondaState.indiceActual + 1} de ${rondaState.poses.length} · ${pa.emoji} ${pa.nombre}`;
  }

  const hint = document.querySelector('#screen-farmeo .encuadre-hint');
  if (hint) hint.textContent = `${pa.emoji} ${pa.tip}`;
}

/**
 * Chip derecho: cuenta regresiva + cuál pose viene después en la ronda.
 */
function actualizarProximaPose() {
  const el = document.getElementById('hud-proxima');
  if (!el || !rondaState) return;

  const siguiente = rondaState.poses[rondaState.indiceActual + 1];
  el.textContent = siguiente
    ? `${keyframeCuenta}s → ${siguiente.emoji}`
    : `${keyframeCuenta}s → fin`;
}

function stopFarmeo() {
  // Orden importa: primero paramos el timer y el loop de inferencia (que lee
  // video), después soltamos el stream.
  detenerKeyframeTimer();
  if (window.VisionService) VisionService.stop();
  CameraService.stop();

  const video = document.getElementById('viewfinder-video');
  if (video) video.style.opacity = '0';
}

/* ---- boot ---- */

/* ---- hooks: Home / Historial con datos reales del Store ---- */

/* ---- Progresión (T2): funciones PURAS, sin DOM, testeables con Node ----
   Nivel y rango derivan de puntajeTotal; monedas de W/E. Single Responsibility:
   cada una calcula una cosa y no toca estado global. */

/** Bandas de nivel por puntajeTotal. Devuelve { nivel, rango }. */
function calcularNivel(puntajeTotal) {
  const bandas = [
    { min: 0,    nivel: 1, rango: 'Iniciado'    },
    { min: 500,  nivel: 2, rango: 'Aprendiz'    },
    { min: 1500, nivel: 3, rango: 'Farmer'      },
    { min: 3000, nivel: 4, rango: 'Aura Farmer' },
    { min: 6000, nivel: 5, rango: 'Leyenda'     }
  ];
  // Recorre de mayor a menor y agarra la primera banda alcanzada.
  for (let i = bandas.length - 1; i >= 0; i--) {
    if (puntajeTotal >= bandas[i].min) return { nivel: bandas[i].nivel, rango: bandas[i].rango };
  }
  return { nivel: 1, rango: 'Iniciado' };
}

/** Monedas = victorias*50 + empates*10. */
function calcularMonedas({ victorias = 0, empates = 0 }) {
  return victorias * 50 + empates * 10;
}

/** Iniciales para el avatar (máx 2 letras, mayúsculas). "Vos" -> "VO". */
function iniciales(nombre) {
  const limpio = (nombre || '?').trim();
  const partes = limpio.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[1][0]).toUpperCase();
}

/** Construye el ranking real: agrega rivales del historial + perfil propio.
   PURA: recibe (perfil, historial), devuelve array ordenado por puntaje desc.
   Suma puntajeRival por nombre de rival; el jugador propio usa puntajeTotal. */
function construirRanking(perfil, historial) {
  const rivales = new Map();  // nombre -> puntaje acumulado
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

/** Pinta el perfil (puntaje, victorias, derrotas, monedas, nivel) persistido. */
/** Progreso dentro de la banda de nivel actual, para la barra.
   Devuelve { actual, meta, pct, esMax }. PURA. */
function progresoNivel(puntajeTotal) {
  const cortes = [0, 500, 1500, 3000, 6000];   // mismos que calcularNivel
  // Banda actual: el mayor corte alcanzado.
  let i = 0;
  for (let k = cortes.length - 1; k >= 0; k--) {
    if (puntajeTotal >= cortes[k]) { i = k; break; }
  }
  const base = cortes[i];
  const techo = cortes[i + 1];               // undefined si es nivel máximo
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

/** Pinta el ranking real (vos + rivales del historial), o un estado vacío. */
function pintarRanking() {
  const perfil = Store.obtenerPerfil();
  const historial = Store.obtenerHistorial();
  const card = document.querySelector('#screen-ranking .card');
  if (!card) return;

  const filas = construirRanking(perfil, historial);

  // Vacío = sin duelos jugados (solo yo con 0 puntos y sin rivales).
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

/** Pinta la lista de historial real (últimos duelos), o un estado vacío. */
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

/** Evita inyección de HTML si el nombre del rival trae caracteres raros. */
function escaparHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ═══════════════════════════════════════════════════════════
   MATCHMAKING ONLINE — v0.10-web (T5)
   Paneles: A) elegir  B) espera con código  C) listo → arrancar
   OnlineService es la única interfaz a Firebase.
   ═══════════════════════════════════════════════════════════ */

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

/* Matchmaking automático (F4). Al emparejar, engancha el MISMO flujo que
   crear/unirse: escucha la sala + heartbeat, y salta a "listo" pintando al
   rival. onEmparejado llega con {salaId, rol} ya listo en OnlineService. */
function mmBuscarAuto() {
  const perfil = Store.obtenerPerfil();
  mmError('');
  mmMostrarPanel('mm-panel-buscando');
  OnlineService.buscarRival(perfil.nombre, {
    onEmparejado: ({ salaId }) => {
      mmSalaId = salaId;
      mmEscucharSala();               // detecta estado 'jugando' → panel listo
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
    // 'jugando' + ficha del rival presente = ambos en la sala → panel listo.
    // Usamos rivalPresente (no rivalConectado) para no depender de que el
    // heartbeat del rival ya haya latido; si no, la PC se queda sin enganchar.
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

function mmEmpezarDuelo() {
  const sesion = OnlineService.sesionActual();
  if (!sesion) return;
  const perfil      = Store.obtenerPerfil();
  const rivalNombre = document.getElementById('mm-nombre-rival').textContent;
  const nombreA     = sesion.rol === 'A' ? perfil.nombre : rivalNombre;
  const nombreB     = sesion.rol === 'A' ? rivalNombre   : perfil.nombre;
  dueloState = DueloEngine.crearDuelo(nombreA, nombreB);
  OnlineService.detenerHeartbeat();
  if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
  showScreen('screen-farmeo');
}

function limpiarMatchmaking() {
  if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
  OnlineService.cancelarBusqueda().catch(() => {});   // por si salís mientras buscabas
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
  // Reenganche limpio de botones (evita listeners duplicados).
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

/* ══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => showScreen(el.dataset.nav));
  });

  window.addEventListener('beforeunload', () => {
    if (window.VisionService) VisionService.stop();
    CameraService.stop();
    OnlineService.salir().catch(() => {});
  });

  showScreen('screen-inicio');
});
