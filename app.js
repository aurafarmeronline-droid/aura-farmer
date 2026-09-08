/* ============================================================
   AURA FARMER — app.js (con Farmeo integrado)
   v2.2.6-web — REVANCHA REAL (mismo rival, misma sala):
     · pintarVeredicto() ya NO cierra la sesión online (OnlineService.salir())
       al llegar al veredicto — la deja viva para poder reconectar. El
       cierre real pasa a salirDeVeredicto() (botón Salir) o al terminar
       una espera de revancha sin acuerdo (terminarEsperaRevancha).
     · pedirRevanchaUI(): local arranca de nuevo directo (screen-farmeo);
       online pide + escucha 30s (manejarRevanchaEstado) — si ambos
       aceptan, A (single-writer) reinicia la MISMA sala
       (OnlineService.reiniciarParaRevancha) y los dos reusan
       mmEmpezarDuelo() tal cual, sin rearmar matchmaking de cero.
     · Botones "Salir"/"Revancha" de screen-veredicto: pasan de data-nav
       plano a ids + handlers propios (salirDeVeredicto/pedirRevanchaUI).
   v2.2.5-web — SALIR DEL DUELO:
     · abandonarDuelo() (nueva): confirm() → si es online, fuerza mi derrota
       vía OnlineService.cerrarConResultado(rolRival) y me pinto el mismo
       veredicto ya (sin esperar el roundtrip); si es local, solo resetea.
       Reemplaza el hardcode viejo de op-abandonar (que no confirmaba ni
       avisaba al rival). Botón "Salir" nuevo en screen-farmeo y
       screen-espera (esta última no tenía NINGUNA salida antes).
     · pintarVeredicto(ganadorForzado): el ganador ahora puede venir FORZADO
       (abandono) en vez de calculado siempre por puntaje — así alguien que
       va ganando pero abandona, pierde igual. Sin argumento, mismo cálculo
       de siempre (no rompe el cierre normal).
     · escucharDueloOnline(): victoria automática por abandono — si
       est.rivalConectado cae (heartbeat > 12s, ya calculado en online.js)
       mientras estado==='jugando', cierro yo con cerrarConResultado(miRol).
       Cubre cierre de pestaña/pérdida de conexión/"atrás" del navegador sin
       tocar beforeunload ni rutas nuevas.
     · mmEscucharSala(): llama OnlineService.cancelarRemocionSala() apenas
       detecta rivalPresente (ver online.js v0.17 para el porqué).
   v2.2.4-web — RONDAS: cada duelo (local y online) pasa de 1 turno por
     jugador a RONDAS_TOTAL=3, de DURACION_RONDA_MS=30s fijos c/u, alternando
     A→B→A→B→A→B. Si la coreo termina antes de los 30s, se reinicia sola sin
     perder el puntaje. Label "RONDA ACTUAL" ahora muestra la ronda del
     partido (1/3); los puntitos siguen siendo el progreso de poses. Ver
     duelo.js (modelo .rondas[]) y online.js (rondasJugadas/acumulado).
   v2.2.1-web — FIX login persistente: ya no pide login cada vez si ya estás
     logueado. La causa era que onCambioSesion disparaba null antes de que
     Firebase resolviera la sesión. Ahora espera el 1er estado real de Auth.
   v2.1.6-web — Sesión Google PERSISTENTE (espera onCambioSesion antes de
     decidir pantalla; ya no se pierde al cerrar pestaña ni cae a invitado) +
     editar nombre/foto sube a la nube si hay sesión.
   v2.1.5-web — FIX nombre Google (usa displayName real, no el invitado) +
     editor de perfil con FOTO (subir del dispositivo, comprimida a 256px).
   v1.9.1-web — Pantalla de IDENTIDAD al iniciar (screen-identidad):
     elegir "Iniciar con Google" o "Jugar como invitado" (con nombre).
     Si ya hay sesión Google, se saltea directo a inicio.

   ⚠️⚠️ IMPORTANTE — ANTES DE LA VERSIÓN FINAL, SACAR EL DEBUG ⚠️⚠️
     Hay logs de diagnóstico activos: la función dbg() (busca "function dbg"),
     el cartel #debug-duelo en index.html, y las llamadas dbg(...) en el
     duelo online. Sirven para diagnosticar el multiplayer. NO afectan el
     juego, pero hay que quitarlos antes de publicar la versión final.
     Buscar en este archivo: dbg(   y en index.html: id="debug-duelo".
   ============================================================ */
/* ============================================================
   AURA FARMER — app.js (con Farmeo integrado)
   v2.2.1-web — FIX login persistente: ya no pide login cada vez si ya estás
     logueado. La causa era que onCambioSesion disparaba null antes de que
     Firebase resolviera la sesión. Ahora espera el 1er estado real de Auth.
   v2.1.6-web — Sesión Google PERSISTENTE (espera onCambioSesion antes de
     decidir pantalla; ya no se pierde al cerrar pestaña ni cae a invitado) +
     editar nombre/foto sube a la nube si hay sesión.
   v2.1.5-web — FIX nombre Google (usa displayName real, no el invitado) +
     editor de perfil con FOTO (subir del dispositivo, comprimida a 256px).
   v1.8.2-web — FIX CRÍTICO multiplayer: limpiarMatchmaking ya NO cierra
     la sesión al pasar a la cámara (era la causa de sesionActual()=null
     y del jugador 2 muerto). + Cuenta atrás de 30s en panel listo con
     auto-inicio si nadie aprieta "Empezar duelo".
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
  'screen-identidad',
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
  'screen-matchmaking': { onShow: iniciarMatchmaking, onHide: limpiarMatchmaking },
  'screen-espera':      { onShow: montarEspectador, onHide: desmontarEspectador }
};

/** F5 — Fase 1: monta/desmonta el placeholder de modo espectador junto con
 *  la pantalla de espera (solo en duelo online — offline no hay rival real
 *  del que ver nada). Sin lógica WebRTC real todavía, ver spectator.js. */
function montarEspectador() {
  if (!dueloEsOnline || !window.SpectatorService) return;
  const el = document.getElementById('espera-espectador');
  if (el) SpectatorService.montar(el);
}

function desmontarEspectador() {
  if (window.SpectatorService) SpectatorService.desmontar();
}

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
// v2.2.5 — guard para no disparar cerrarConResultado() más de una vez
// mientras espero que ese mismo update() vuelva como estado='terminado'
// (escucharDueloOnline sigue recibiendo snapshots viejos mientras tanto).
let cerrandoPorAbandono = false;
// v2.2.6 — F6 revancha: dueloEsOnline/miRolOnline se resetean apenas
// termina el duelo (ver pintarVeredicto), pero la pantalla de veredicto
// todavía necesita saber "¿esto fue online?" y "¿cómo se llama el rival?"
// para ofrecer Revancha real. veredictoRevanchaUnsub/TimeoutId son del
// listener/timer de 30s mientras se espera la respuesta del rival.
let veredictoFueOnline = false;
let veredictoRivalNombre = '';
let veredictoRevanchaUnsub = null;
let veredictoRevanchaTimeoutId = null;
let dueloUnsub = null;          // desuscriptor de la escucha del duelo online
let esperandoRival = false;     // true mientras miro al rival jugar su turno
let rivalYaJugoOnline = false;  // v1.6.1 — el rival ya cerró su turno (flag Firebase)
let ultimoEnvioPuntaje = 0;     // v1.9.1 — throttle de envío de puntaje en vivo
let ultimoEnvioLandmarks = 0;   // v2.2.4 — F5 Fase 2b — throttle de landmarks
// F5 Fase 2b — subset de índices MediaPipe Pose (33 puntos) para el esqueleto
// del rival: nariz, hombros, codos, muñecas, caderas. Liviano, alcanza para
// una silueta reconocible sin mandar los 33 puntos completos.
const LANDMARKS_ESPECTADOR = [0, 11, 12, 13, 14, 15, 16, 23, 24];
let rivalNivelRemoto = 0;       // nivel histórico del rival desde la sala
let farmeoState = null;        // estado interno de Farmeo
let coreoActual = null;        // referencia al coreo que se está jugando
let rondaActiva = false;       // para saber si estamos en medio de una ronda
let rivalRondasJugadas = 0;    // v2.2.4 — rondas que el rival ya cerró (online)

// v2.2.4 — RONDAS: cada jugador juega RONDAS_TOTAL rondas de DURACION_RONDA_MS
// fijos (antes: 1 sola ronda de duración variable según la coreo). Si la
// coreo (secuencia de poses) termina antes de tiempo, se reinicia sola sin
// perder el puntaje acumulado — ver startPoseDetection(). El timer duro de
// acá abajo es el único que realmente cierra la ronda.
const RONDAS_TOTAL = DueloEngine.RONDAS_TOTAL;
const DURACION_RONDA_MS = 30000;
let rondaDeadline_ms = null;   // performance.now() al que se corta la ronda
let rondaTimeoutId = null;

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
  rondaDeadline_ms = null;   // v2.2.4 — arranca recién cuando la cámara está lista

  CameraService.start({
    videoEl: video,
    onReady: () => {
      errBox.classList.add('hidden');
      video.style.opacity = '1';
      startPoseDetection(video, canvas, poseChip);
      // F5 Fase 2a — mi cámara está prendida: el rival empieza a recibir mi video.
      if (dueloEsOnline && window.SpectatorService) {
        SpectatorService.actualizarTrackLocal(CameraService.streamActual());
      }

      // v2.2.4 — timer duro de la ronda: 30s fijos desde que la cámara
      // arrancó, sin importar cómo venga la coreo. Es el único que cierra
      // la ronda de verdad (ver también el loop en onLandmarks abajo).
      rondaDeadline_ms = performance.now() + DURACION_RONDA_MS;
      clearTimeout(rondaTimeoutId);
      rondaTimeoutId = setTimeout(() => {
        if (rondaActiva) { rondaActiva = false; terminarRonda(); }
      }, DURACION_RONDA_MS);
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

      // v1.9.1 — En duelo online, subir mi puntaje seguido (throttle ~1.5s)
      // para que el rival lo vea crecer FLUIDO en su pantalla de espera, no
      // solo al cerrar cada paso. El throttle evita saturar Firebase.
      if (dueloEsOnline) {
        const ahora = Date.now();
        if (ahora - ultimoEnvioPuntaje > 1500) {
          ultimoEnvioPuntaje = ahora;
          OnlineService.enviarPuntaje(resultado.puntajeTotal || 0, resultado.poseNombre).catch(() => {});
        }
        // F5 Fase 2b — landmarks del esqueleto, más seguido que el puntaje
        // (~150ms) para que se vea fluido, pero sin saturar Firebase.
        if (pose && ahora - ultimoEnvioLandmarks > 150) {
          ultimoEnvioLandmarks = ahora;
          const subset = LANDMARKS_ESPECTADOR.map(i => pose[i] ? { x: pose[i].x, y: pose[i].y } : null);
          OnlineService.enviarLandmarks(subset).catch(() => {});
        }
      }

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

      // v2.2.4 — Si la coreo (secuencia de poses) termina ANTES de los 30s
      // de la ronda, se reinicia sola desde la pose 1 sin perder el puntaje
      // acumulado (puntajeTotal no se toca). Se limpia puntajePorPaso para
      // que el bonus de intensidad de la próxima vuelta no se recalcule
      // sobre los pasos de vueltas anteriores. Solo el timer duro (arriba)
      // cierra la ronda de verdad.
      if (resultado.coreoTerminada) {
        farmeoState.pasoActual = 0;
        farmeoState.fase = 'esperando';
        farmeoState.inicioPaso_ms = null;
        farmeoState.ultimoFrame_ms = null;
        farmeoState.buffer = [];
        farmeoState.puntajePorPaso = [];
        pintarPoseFarmeo();   // ya repinta ronda-dots adentro
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

/** Puntaje acumulado del rival hasta ahora (suma de sus rondas cerradas). */
function puntajeRivalActual() {
  if (!dueloState) return 0;
  const yo = dueloState.turnoActual;
  const otro = yo === 'A' ? 'B' : 'A';
  const rondas = dueloState.jugadores[otro].rondas || [];
  return rondas.reduce((s, v) => s + (v || 0), 0);
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
  // v2.2.4 — este label ahora muestra la RONDA DEL PARTIDO (1/3), no la pose
  // dentro de la coreo (eso lo siguen mostrando los puntitos de arriba). Se
  // calcula por cuántas rondas ya cerró el jugador que le toca jugar ahora.
  const lbl = document.getElementById('ronda-actual');
  if (lbl) {
    const rol = dueloEsOnline ? miRolOnline : 'A';
    const jugadas = (dueloState && dueloState.jugadores[rol] && dueloState.jugadores[rol].rondas)
      ? dueloState.jugadores[rol].rondas.length : 0;
    lbl.textContent = `${Math.min(jugadas + 1, RONDAS_TOTAL)} / ${RONDAS_TOTAL}`;
  }
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
    const tPose = tiempoRestantePaso(farmeoState, coreoActual, ahora);
    // v2.2.4 — "termina la ronda en" ahora es el timer duro de 30s fijos, no
    // el tiempo de la coreo (que puede hacer loop varias veces en esos 30s).
    // Antes de que la cámara esté lista (rondaDeadline_ms===null) muestra el
    // total fijo como placeholder.
    const tRonda = rondaDeadline_ms ? Math.max(0, rondaDeadline_ms - ahora) : DURACION_RONDA_MS;
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
  on('op-abandonar', abandonarDuelo);   // v2.2.5 — antes salía sin confirmar ni avisar al rival
  on('btn-salir-farmeo',  abandonarDuelo);   // v2.2.5 — botón nuevo en screen-farmeo
  on('btn-salir-espera',  abandonarDuelo);   // v2.2.5 — botón nuevo en screen-espera (no tenía salida)
  on('btn-salir-veredicto', salirDeVeredicto);   // v2.2.6 — antes era data-nav plano
  on('btn-revancha',        pedirRevanchaUI);    // v2.2.6 — antes era data-nav a screen-matchmaking

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
  clearTimeout(rondaTimeoutId);   // v2.2.4 — ya se cerró, que no dispare de nuevo
  const puntaje = farmeoState ? Math.round(farmeoState.puntajeTotal) : 0;
  if (!dueloState) dueloState = DueloEngine.crearDuelo();

  // v1.5.1 — DUELO ONLINE: Firebase es la fuente de verdad. Subo mi puntaje
  // y cedo el turno. NO decido local si va a traspaso o veredicto: eso lo
  // dicta el estado de la sala, que llega por escucharDueloOnline().
  // v2.2.4 — ahora son RONDAS_TOTAL rondas por jugador, no 1: recién cierro
  // con resultado cuando YO llego a mis 3 Y el rival ya llegó a las suyas.
  if (dueloEsOnline) {
    dueloState.jugadores[miRolOnline].rondas.push(puntaje);
    const rolRival = miRolOnline === 'A' ? 'B' : 'A';
    const misRondas = dueloState.jugadores[miRolOnline].rondas.length;

    if (misRondas >= RONDAS_TOTAL && rivalRondasJugadas >= RONDAS_TOTAL) {
      // Los dos completaron sus 3 rondas → marco la mía y RECIÉN cuando esa
      // escritura se confirma, cierro con el resultado. marcarMiRonda hace
      // un get()+update() (necesita leer el acumulado previo), así que si no
      // espero, cerrarConResultado podría llegarle al rival ANTES de que mi
      // última ronda se haya guardado (vería un acumulado viejo en veredicto).
      const r = DueloEngine.resolver(dueloState);
      OnlineService.marcarMiRonda(puntaje)
        .then(() => OnlineService.cerrarConResultado(r.ganador))
        .catch(() => {});
      // El veredicto llega por escucharDueloOnline (estado='terminado').
    } else {
      // Todavía falta alguna ronda (mía o del rival) → marco y paso el turno
      // EN ORDEN (sin carrera), después quedo esperando.
      OnlineService.terminarMiRonda(puntaje).catch(() => {});
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
  clearTimeout(rondaTimeoutId);   // v2.2.4 — no dejar el timer corriendo fuera de la ronda
  rondaDeadline_ms = null;
  if (window.VisionService) VisionService.stop();
  CameraService.stop();
  // F5 Fase 2a — mi turno terminó: dejo de mandar video (no un frame congelado).
  if (dueloEsOnline && window.SpectatorService) SpectatorService.actualizarTrackLocal(null);

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

/* ---- v2.2.5 — Abandonar el duelo a propósito (botón "Salir") ---- */
/**
 * Confirma y cierra el duelo actual declarando MI derrota.
 *   · Online: fuerzo cerrarConResultado(rolRival) — el rival lo recibe por
 *     escucharSala() como cualquier cierre normal — y me pinto YA el mismo
 *     veredicto acá (sin esperar el roundtrip de Firebase).
 *   · Local: no hay rival real, solo reseteo (no toca Store: no hay
 *     "derrota" que registrar contra nadie).
 * Sin duelo activo (o ya terminado), no hace nada raro: solo navega.
 */
function abandonarDuelo() {
  if (!dueloState || dueloState.terminado) {
    cerrarTodosLosDrawers();
    showScreen('screen-inicio');
    return;
  }

  if (!window.confirm('¿Seguro que querés salir? Vas a perder el duelo.')) return;

  cerrarTodosLosDrawers();
  stopFarmeo();   // corta cámara/visión/música/timers, sea duelo online o local

  if (dueloEsOnline) {
    const rolRival = miRolOnline === 'A' ? 'B' : 'A';
    // Dejo de escuchar ANTES de escribir: ya decidí el cierre yo mismo, no
    // quiero que mi propio update() me vuelva a disparar irAVeredictoOnline.
    if (dueloUnsub) { dueloUnsub(); dueloUnsub = null; }
    if (window.SpectatorService) SpectatorService.cerrarConexion();
    OnlineService.cerrarConResultado(rolRival).catch(() => {});
    pintarVeredicto(rolRival);   // hace TODO el cleanup online (salir/heartbeat/flags)
    showScreen('screen-veredicto');
  } else {
    dueloState = null;
    showScreen('screen-inicio');
  }
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
/**
 * @param {'A'|'B'|'empate'} [ganadorForzado] - v2.2.5: si viene, ES el
 *   resultado final (rol ABSOLUTO, no "mío") sin importar el puntaje —
 *   caso abandono: quien se va pierde aunque estuviera arriba. Sin este
 *   argumento, se calcula por puntaje como siempre (cierre normal).
 */
function pintarVeredicto(ganadorForzado) {
  const r = DueloEngine.resolver(dueloState);
  const jA = dueloState.jugadores.A, jB = dueloState.jugadores.B;

  // v1.5.1 — MI rol: en local siempre soy 'A'; en online puede ser 'A' o 'B'.
  const miRol   = dueloEsOnline ? miRolOnline : 'A';
  const rolRival = miRol === 'A' ? 'B' : 'A';
  // v2.2.4 — el modelo pasó de un .puntaje único a .rondas (array de hasta
  // 3); el total de cada uno ya viene sumado en r.puntajeA/r.puntajeB.
  const miPuntaje    = miRol === 'A' ? r.puntajeA : r.puntajeB;
  const rivalPuntaje = miRol === 'A' ? r.puntajeB : r.puntajeA;
  const nombreRival  = dueloState.jugadores[rolRival].nombre;
  // v2.2.5 — ganador ABSOLUTO: forzado (abandono) o el de siempre (puntaje).
  const ganadorAbsoluto = ganadorForzado || r.ganador;
  // Resultado desde MI perspectiva para persistir bien (W/L/E correcto).
  const miResultado = ganadorAbsoluto === 'empate' ? 'empate'
                    : (ganadorAbsoluto === miRol ? 'A' : 'B');

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
  // v2.2.6 — YA NO llamo a OnlineService.salir() acá: si el jugador pide
  // Revancha real, necesito la MISMA sesión (salaId/rol) viva para
  // reconectar con el mismo rival sin rearmar el matchmaking de cero. El
  // cierre real pasa a terminarVeredictoOnline(), llamado al salir de la
  // pantalla de veredicto (con o sin haber pedido revancha).
  veredictoFueOnline = dueloEsOnline;
  veredictoRivalNombre = nombreRival;
  if (dueloEsOnline) {
    if (dueloUnsub) { dueloUnsub(); dueloUnsub = null; }
    OnlineService.detenerHeartbeat();
    dueloEsOnline = false;
    miRolOnline = null;
    esperandoRival = false;
  }

  dueloState = null;
  pintarBotonRevancha();   // v2.2.6 — texto/estado inicial del botón, ver más abajo
}

/* ---- v2.2.6 — F6 Revancha real (mismo rival, misma sala) ---- */

/** Deja el botón/mensaje de Revancha en su estado inicial (se llama al
 *  pintar cada veredicto nuevo, y al salir de uno con revancha pendiente). */
function pintarBotonRevancha() {
  const btn = document.getElementById('btn-revancha');
  const msg = document.getElementById('veredicto-revancha-msg');
  if (btn) { btn.disabled = false; btn.textContent = 'Revancha'; }
  if (msg) msg.textContent = '';
}

function limpiarEsperaRevancha() {
  if (veredictoRevanchaUnsub) { veredictoRevanchaUnsub(); veredictoRevanchaUnsub = null; }
  if (veredictoRevanchaTimeoutId) { clearTimeout(veredictoRevanchaTimeoutId); veredictoRevanchaTimeoutId = null; }
}

/** Corta la espera de revancha (rival dijo que no, o se agotaron los 30s). */
function terminarEsperaRevancha(mensaje) {
  limpiarEsperaRevancha();
  OnlineService.rechazarRevancha().catch(() => {});   // dejo MI voto en false, prolijo
  pintarBotonRevancha();
  const msg = document.getElementById('veredicto-revancha-msg');
  if (msg) msg.textContent = mensaje;
}

/** Se llama con cada snapshot de la sala mientras espero que el rival conteste. */
function manejarRevanchaEstado(est) {
  if (!est.existe) return;   // sala rara: dejo que el timeout de 30s corte

  if (est.revanchaRival === false) {
    terminarEsperaRevancha('El rival no quiso revancha.');
    return;
  }
  if (est.revanchaMia === true && est.revanchaRival === true) {
    limpiarEsperaRevancha();
    const sesion = OnlineService.sesionActual();
    // Single-writer: solo A reinicia la sala, para no pisarse con un
    // update() duplicado si los dos lo dispararan al mismo tiempo.
    if (sesion && sesion.rol === 'A') OnlineService.reiniciarParaRevancha().catch(() => {});
    // Reusa TODO el flujo de arranque de duelo online ya probado — solo
    // necesita el nombre del rival en el mismo lugar que lee mmEmpezarDuelo.
    const elRival = document.getElementById('mm-nombre-rival');
    if (elRival) elRival.textContent = veredictoRivalNombre;
    mmEmpezarDuelo();
  }
}

/** Click en "Revancha": local arranca de nuevo directo; online pide y espera. */
function pedirRevanchaUI() {
  if (!veredictoFueOnline) {
    showScreen('screen-farmeo');   // startFarmeo() crea un dueloState nuevo solo
    return;
  }
  if (!OnlineService.sesionActual()) {
    const msg = document.getElementById('veredicto-revancha-msg');
    if (msg) msg.textContent = 'Se perdió la conexión con la sala.';
    return;
  }
  const btn = document.getElementById('btn-revancha');
  if (btn) { btn.disabled = true; btn.textContent = 'Esperando al rival… (30s)'; }
  OnlineService.pedirRevancha().catch(() => {});
  veredictoRevanchaUnsub = OnlineService.escucharSala(manejarRevanchaEstado);
  veredictoRevanchaTimeoutId = setTimeout(() => terminarEsperaRevancha('No hubo respuesta a tiempo.'), 30000);
}

/** Click en "Salir" desde veredicto: corta revancha pendiente y cierra la
 *  sesión online de verdad (si había una en pausa esperando revancha). */
function salirDeVeredicto() {
  limpiarEsperaRevancha();
  if (OnlineService.sesionActual()) OnlineService.terminarSesionOnline().catch(() => {});
  showScreen('screen-inicio');
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

  // v2.1.5 — avatar con foto si hay, si no iniciales.
  const av = document.getElementById('profile-avatar');
  if (av) {
    if (p.foto) {
      av.style.backgroundImage = `url('${p.foto}')`;
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      av.textContent = iniciales(p.nombre);
    }
  }
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
      // v2.2.5 — el rival ya está: si YO soy el creador de una sala por
      // código, esto cancela el onDisconnect(salaRef).remove() que crearSala
      // dejó armado (ver online.js v0.17). No-op seguro si no aplica.
      OnlineService.cancelarRemocionSala();
      const perfil = Store.obtenerPerfil();
      document.getElementById('mm-av-yo').textContent       = iniciales(perfil.nombre);
      document.getElementById('mm-nombre-yo').textContent   = perfil.nombre;
      document.getElementById('mm-av-rival').textContent    = iniciales(est.rivalNombre);
      document.getElementById('mm-nombre-rival').textContent = est.rivalNombre;
      mmMostrarPanel('mm-panel-listo');
      arrancarCuentaAtras();   // v1.8.1 — 30s y arranca solo
    }
  });
}

/* v1.8.1 — Cuenta atrás de 30s en el panel "listo". Si nadie aprieta
   "¡Empezar duelo!", arranca solo. Evita quedarse trabado esperando el click. */
let mmCuentaId = null;
function arrancarCuentaAtras(segundos = 30) {
  detenerCuentaAtras();
  let restante = segundos;
  const lbl = document.getElementById('mm-btn-empezar');
  const textoBase = '¡Empezar duelo!';
  const pintar = () => {
    if (lbl) lbl.textContent = textoBase + '  (' + restante + 's)';
  };
  pintar();
  mmCuentaId = setInterval(() => {
    restante--;
    if (restante <= 0) {
      detenerCuentaAtras();
      if (lbl) lbl.textContent = textoBase;
      mmEmpezarDuelo();   // arranca solo
      return;
    }
    pintar();
  }, 1000);
}
function detenerCuentaAtras() {
  if (mmCuentaId) { clearInterval(mmCuentaId); mmCuentaId = null; }
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

    // === DIAGNÓSTICO TEMPORAL v1.8.1 (borrar cuando ande) ===
    console.log('[DUELO]', 'miRol=' + miRolOnline, 'turno=' + est.turno,
                'esMiTurno=' + est.esMiTurno, 'miJugo=' + est.miJugo,
                'rivalJugo=' + est.rivalJugo, 'estado=' + est.estado,
                'pantalla=' + currentScreen);

    // v2.2.4 — Reflejar el TOTAL del rival en el dueloState local (para
    // HUD/veredicto): acumulado (rondas ya cerradas) + su puntaje en vivo de
    // la ronda actual, sin sumarlo dos veces si esa ronda ya cerró (rivalJugo).
    const rolRival = miRolOnline === 'A' ? 'B' : 'A';
    if (dueloState && typeof est.rivalAcumulado === 'number') {
      const enVivo = est.rivalJugo ? 0 : (est.rivalPuntaje || 0);
      dueloState.jugadores[rolRival].rondas = [est.rivalAcumulado + enVivo];
    }
    if (typeof est.rivalNivel === 'number') rivalNivelRemoto = est.rivalNivel;
    // v1.6.1 — flag robusto de "el rival ya cerró su turno [ronda actual]".
    rivalYaJugoOnline = !!est.rivalJugo;
    rivalRondasJugadas = est.rivalRondasJugadas || 0;   // v2.2.4

    // El duelo terminó (alguien cerró con resultado): los dos al veredicto.
    if (est.estado === 'terminado') {
      irAVeredictoOnline(est);
      return;
    }

    // v2.2.5 — VICTORIA POR ABANDONO: el rival perdió heartbeat (>12s, ver
    // rivalCaido en online.js) mientras el duelo está en curso. Cierro yo
    // declarándome ganador — cubre cierre de pestaña, wifi caído, "atrás"
    // del navegador, lo que sea, sin importar cómo se fue. SIEMPRE corto acá
    // (return) mientras el rival esté caído: si no, en el snapshot SIGUIENTE
    // (mi propio heartbeat cada 3s) cerrandoPorAbandono ya estaría en true y
    // caería en la lógica normal de turnos de más abajo (reabriría la
    // cámara con el duelo ya cerrándose). El guard solo evita reintentar el
    // WRITE, no la salida temprana.
    if (est.estado === 'jugando' && !est.rivalConectado) {
      if (!cerrandoPorAbandono) {
        cerrandoPorAbandono = true;
        OnlineService.cerrarConResultado(miRolOnline).catch(() => { cerrandoPorAbandono = false; });
      }
      return;
    }

    // v2.2.4 — Si YO ya completé mis RONDAS_TOTAL rondas y ahora veo que el
    // rival TAMBIÉN completó las suyas (su flag llegó tarde), cierro el
    // duelo yo. Cubre la carrera de "los dos terminan casi a la vez" sin que
    // quede nadie trabado esperando. (Antes miraba miJugo/rivalJugo, que
    // ahora se resetean cada ronda; hay que mirar el conteo completo.)
    if (est.miRondasJugadas >= RONDAS_TOTAL && est.rivalRondasJugadas >= RONDAS_TOTAL &&
        est.estado !== 'terminado' && miRolOnline === 'A') {
      const r = DueloEngine.resolver(dueloState);
      OnlineService.cerrarConResultado(r.ganador).catch(() => {});
      return;
    }

    // Sincronizar de quién es el turno según Firebase.
    if (dueloState) dueloState.turnoActual = est.turno;

    if (est.esMiTurno && !est.miJugo && est.estado === 'jugando') {
      // Es mi turno Y todavía no jugué: entro a jugar.
      // Solo si NO estoy ya jugando (evita reiniciar la cámara con cada update).
      if (currentScreen !== 'screen-farmeo') {
        console.log('[DUELO] → entrando a MI turno (screen-farmeo)');
        esperandoRival = false;
        showScreen('screen-farmeo');
      }
    } else {
      // Turno del rival, o ya jugué y espero el cierre: pantalla de espera.
      esperandoRival = true;
      pintarEsperaRival(est);
      if (currentScreen !== 'screen-espera') {
        console.log('[DUELO] → yendo a espera (screen-espera)');
        showScreen('screen-espera');
      }
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
  if (window.SpectatorService) SpectatorService.cerrarConexion();
  // Aseguramos los dos puntajes en el dueloState antes de resolver.
  const rolRival = miRolOnline === 'A' ? 'B' : 'A';
  if (dueloState) {
    // v2.2.4 — a esta altura el duelo ya cerró: el total del rival es su
    // acumulado de las RONDAS_TOTAL rondas (ya no hay ronda "en vivo").
    if (typeof est.rivalAcumulado === 'number') dueloState.jugadores[rolRival].rondas = [est.rivalAcumulado];
    dueloState.terminado = true;
  }
  // v2.2.5 — uso el ganador que Firebase ya trae en resultado.ganador: en un
  // cierre normal coincide con el cálculo por puntaje (no cambia nada); en
  // un cierre por abandono (mío o del rival) es el que manda, aunque el
  // puntaje diga otra cosa.
  pintarVeredicto(est.resultado && est.resultado.ganador);
  showScreen('screen-veredicto');
}

function mmEmpezarDuelo() {
  detenerCuentaAtras();   // v1.8.1 — frena el auto-inicio si arrancamos a mano
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
  rivalRondasJugadas = 0;      // v2.2.4 — reset del conteo de rondas
  cerrandoPorAbandono = false; // v2.2.5 — reset por si quedó pegado de un duelo anterior

  // F5 Fase 2a — arranca la conexión WebRTC UNA vez por duelo (no por
  // turno). Vive independiente de qué pantalla se esté mirando.
  if (window.SpectatorService) {
    SpectatorService.iniciarConexion({
      rol: miRolOnline,
      enviarSenal: OnlineService.enviarSenalizacion,
      escucharSenalRival: OnlineService.escucharSenalizacionRival,
      escucharLandmarksRival: OnlineService.escucharLandmarksRival,
      obtenerStreamLocal: () => CameraService.streamActual()
    });
  }

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
  // v1.8.1 FIX — Si el duelo online YA arrancó, NO cerramos la sesión: el
  // duelo la necesita viva. Antes esto llamaba salir() y mataba la sesión
  // justo al pasar a la cámara (por eso sesionActual() daba null y B moría).
  if (dueloEsOnline) {
    if (mmUnsubSala) { mmUnsubSala(); mmUnsubSala = null; }
    mmError('');
    return;
  }
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
  reBind('mm-btn-cancelar-listo', () => { detenerCuentaAtras(); limpiarMatchmaking(); showScreen('screen-inicio'); });
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
  wireIdentidad();   // v1.9.1

  // v2.1.6 — Arranque con sesión Google PERSISTENTE. Firebase carga la sesión
  // de forma asíncrona: estaLogueado() da false en el primer instante aunque
  // ya estés logueado en el navegador. Por eso ESPERAMOS a que Auth confirme
  // (onCambioSesion) antes de decidir la pantalla. Si hay sesión → modo cuenta
  // y directo a inicio (con tu nombre/foto de Google). Si no → identidad.
  // v2.2.1 — LOGIN PERSISTENTE (best practice). Firebase resuelve la sesión
  // de forma asíncrona vía onAuthStateChanged, que SIEMPRE dispara al menos
  // una vez con el estado real (logueado o no). El bug anterior era un timeout
  // de 2.5s que a veces ganaba la carrera y mostraba "identidad" aunque hubiera
  // sesión. Ahora: esperamos el PRIMER disparo real de Auth (sin timeout que
  // compita), y solo caemos a "identidad" si Firebase directamente no está.
  let decidido = false;
  const decidirPantalla = (usuario) => {
    if (decidido) return;
    decidido = true;
    if (usuario) {
      // Sesión Google activa: modo cuenta, sembrar nombre/foto reales.
      if (typeof Store.fijarModo === 'function') Store.fijarModo('cuenta');
      if (usuario.nombre) Store.guardarNombre(usuario.nombre);
      if (usuario.foto)   Store.guardarFoto(usuario.foto);
      AuthService.sincronizarPerfil(Store.exportarTodo())
        .then(pf => { Store.reemplazarPerfil(pf); informarNivelAOnline(); pintarHome?.(); })
        .catch(() => {});
      informarNivelAOnline();
      showScreen('screen-inicio');
    } else {
      showScreen('screen-identidad');
    }
  };

  const arrancarConAuth = () => {
    // onCambioSesion → onAuthStateChanged: el primer disparo trae el estado
    // real ya resuelto (Firebase lee la sesión persistida antes de disparar).
    // Ese primer disparo decide la pantalla; los siguientes ya no (decidido).
    AuthService.onCambioSesion(decidirPantalla);
    // Fallback SOLO por si Auth nunca responde (raro): margen amplio de 6s
    // para no ganarle la carrera a una confirmación de sesión lenta en móvil.
    setTimeout(() => {
      if (!decidido) decidirPantalla(AuthService.usuarioActual?.() || null);
    }, 6000);
  };

  if (window.AuthService && AuthService.estaDisponible?.()) {
    arrancarConAuth();
  } else if (window.AuthService && AuthService.init?.()) {
    arrancarConAuth();
  } else if (window.__FIREBASE__) {
    AuthService.init(); arrancarConAuth();
  } else {
    window.addEventListener('firebase-ready', () => { AuthService.init(); arrancarConAuth(); }, { once: true });
    // Si Firebase nunca llega (offline / sin SDK), a los 6s → identidad.
    setTimeout(() => { if (!decidido) decidirPantalla(null); }, 6000);
  }
});

/* v1.9.1 — Pantalla de identidad: elegir Google o invitado antes de jugar. */
function wireIdentidad() {
  const btnGoogle   = document.getElementById('id-btn-google');
  const btnInvitado = document.getElementById('id-btn-invitado');
  const inp         = document.getElementById('id-input-invitado');
  const err         = document.getElementById('id-error');
  const setErr = (m) => { if (err) err.textContent = m || ''; };

  btnGoogle?.addEventListener('click', async () => {
    if (!AuthService || !AuthService.estaDisponible || !AuthService.estaDisponible()) {
      AuthService?.init?.();
    }
    btnGoogle.disabled = true;
    try {
      const userG = await AuthService.iniciarSesionGoogle();
      if (typeof Store.fijarModo === 'function') Store.fijarModo('cuenta');
      // v2.1.5 FIX — Al loguearse, el nombre/foto salen de GOOGLE, no del
      // invitado viejo. Sembramos el perfil local con los datos de Google
      // ANTES de sincronizar, así la nube recibe "bocon" y no "Usuario 4505".
      if (userG && userG.nombre) Store.guardarNombre(userG.nombre);
      if (userG && userG.foto)   Store.guardarFoto(userG.foto);
      const perfilFinal = await AuthService.sincronizarPerfil(Store.exportarTodo());
      Store.reemplazarPerfil(perfilFinal);
      informarNivelAOnline();
      showScreen('screen-inicio');
    } catch (e) {
      const cod = e && e.code;
      if (cod !== 'auth/popup-closed-by-user' && cod !== 'auth/cancelled-popup-request') {
        setErr('No se pudo iniciar con Google. Probá de nuevo o jugá como invitado.');
      }
    } finally {
      btnGoogle.disabled = false;
    }
  });

  btnInvitado?.addEventListener('click', () => {
    const nombre = (inp?.value || '').trim();
    if (nombre.length < 2) { setErr('Poné un nombre de al menos 2 letras.'); return; }
    if (typeof Store.fijarModo === 'function') Store.fijarModo('invitado');
    Store.guardarNombre(nombre);
    informarNivelAOnline();
    showScreen('screen-inicio');
  });

  inp?.addEventListener('input', () => setErr(''));
}

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
    pintarPreviewFoto();   // v2.1.5
    inp?.focus();
  });
  cancel?.addEventListener('click', () => editor?.classList.add('hidden'));
  const guardarNombre = () => {
    const escrito = (inp?.value || '').trim();
    if (!escrito) { err?.classList.remove('hidden'); return; }
    Store.guardarNombre(escrito);
    // v2.1.6 — si estás logueado, subir el cambio a la nube.
    if (window.AuthService && AuthService.estaLogueado()) {
      AuthService.subirPerfil(Store.exportarTodo()).catch(() => {});
    }
    editor?.classList.add('hidden');
    pintarHome();
  };
  guardar?.addEventListener('click', guardarNombre);
  inp?.addEventListener('keydown', e => { if (e.key === 'Enter') guardarNombre(); });
  inp?.addEventListener('input', () => err?.classList.add('hidden'));

  // v2.1.5 — Foto de perfil: subir desde el dispositivo, comprimida.
  const fotoInput   = document.getElementById('editor-foto-input');
  const btnSubir    = document.getElementById('btn-subir-foto');
  const btnQuitar   = document.getElementById('btn-quitar-foto');
  btnSubir?.addEventListener('click', () => fotoInput?.click());
  btnQuitar?.addEventListener('click', () => {
    Store.guardarFoto(null);
    pintarPreviewFoto();
    pintarHome();
  });
  fotoInput?.addEventListener('change', async () => {
    const file = fotoInput.files && fotoInput.files[0];
    if (!file) return;
    try {
      const dataUrl = await comprimirImagen(file, 256); // 256px máx, cuadrada
      Store.guardarFoto(dataUrl);
      if (window.AuthService && AuthService.estaLogueado()) {
        AuthService.subirPerfil(Store.exportarTodo()).catch(() => {});
      }
      pintarPreviewFoto();
      pintarHome();
    } catch (e) {
      console.warn('subir foto:', e);
      err && (err.textContent = 'No se pudo cargar la imagen.', err.classList.remove('hidden'));
    }
    fotoInput.value = '';
  });
}

/** v2.1.5 — Pinta el preview de la foto en el editor (foto o iniciales). */
function pintarPreviewFoto() {
  const prev = document.getElementById('editor-foto-preview');
  if (!prev) return;
  const p = Store.obtenerPerfil();
  if (p.foto) {
    prev.style.backgroundImage = `url('${p.foto}')`;
    prev.textContent = '';
  } else {
    prev.style.backgroundImage = '';
    prev.textContent = iniciales(p.nombre);
  }
}

/** v2.1.5 — Comprime una imagen a un cuadrado de lado `max` px → dataURL JPEG.
 *  Achica para no reventar el storage (localStorage ~5MB). */
function comprimirImagen(file, max = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('img'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = max; canvas.height = max;
        const ctx = canvas.getContext('2d');
        // Recorte cuadrado centrado (cover).
        const lado = Math.min(img.width, img.height);
        const sx = (img.width - lado) / 2, sy = (img.height - lado) / 2;
        ctx.drawImage(img, sx, sy, lado, lado, 0, 0, max, max);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
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
      const userG = await AuthService.iniciarSesionGoogle();
      if (typeof Store.fijarModo === 'function') Store.fijarModo('cuenta'); // v1.4.1 persistente
      // v2.1.5 FIX — nombre/foto de Google como semilla antes de sincronizar.
      if (userG && userG.nombre) Store.guardarNombre(userG.nombre);
      if (userG && userG.foto)   Store.guardarFoto(userG.foto);
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