// Reproductor con adaptadores por tipo de fuente: mp4 (archivo directo), hls (.m3u8),
// youtube y embed (iframe de un proveedor autorizado). Para añadir un tipo nuevo basta con
// agregar una función en ADAPTERS que devuelva { el, api } (ver más abajo).
import { h, icon, fmtTime, toast, spinner } from './ui.js';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1);
    if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
    return u.searchParams.get('v');
  } catch { return null; }
}

// ---------- Adaptador de iframe (YouTube / embed): control limitado por el proveedor ----------
function iframeAdapter(opts) {
  const { source, startAt, onProgress } = opts;
  let src = source.url;
  const listeners = {};
  let yt = false;
  if (source.type === 'youtube') {
    const id = youtubeId(source.url);
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    yt = true;
    src = `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&rel=0&modestbranding=1&playsinline=1&start=${Math.floor(startAt || 0)}&autoplay=1`;
  }
  const el = h('iframe', { src, allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin', title: 'Reproductor' });
  let last = 0;
  const onMsg = (e) => {
    if (!yt || e.source !== el.contentWindow) return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    if (d && d.event === 'infoDelivery' && d.info && typeof d.info.currentTime === 'number') {
      last = d.info.currentTime;
      onProgress(last, d.info.duration || 0);
    }
    if (d && d.event === 'onStateChange' && d.info === 0 && listeners.ended) listeners.ended();
  };
  window.addEventListener('message', onMsg);
  el.addEventListener('load', () => {
    if (yt) el.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*');
    if (!yt) onProgress(0, 0); // sin telemetría: al menos queda registrado en el historial
  });
  return {
    el, native: false,
    on: (ev, fn) => { listeners[ev] = fn; },
    destroy: () => window.removeEventListener('message', onMsg),
    position: () => last,
  };
}

export function createPlayer(opts) {
  const { source, subtitles = [], startAt = 0, title, subtitle, onProgress, onEnded, onBack, next, onNext } = opts;
  const root = h('div', { class: 'player', tabindex: '0' });
  let destroyed = false;
  const cleanups = [];

  // ---- Fuentes con iframe -------------------------------------------------
  if (source.type === 'youtube' || source.type === 'embed') {
    const ad = iframeAdapter({ source, startAt, onProgress });
    if (!ad) { root.append(errorBox('No se pudo cargar esta fuente.', onBack)); return { el: root, destroy() {} }; }
    ad.on('ended', () => onEnded && onEnded());
    root.append(ad.el, h('div', { class: 'p-top', style: 'pointer-events:none' },
      h('button', { class: 'icon-btn', style: 'pointer-events:auto', 'aria-label': 'Volver', onclick: onBack }, icon('arrowL')),
      h('div', { class: 'grow' }, h('h2', null, title), subtitle ? h('div', { class: 'muted' }, subtitle) : null)));
    return { el: root, destroy() { ad.destroy(); } };
  }

  // ---- Video HTML5 (mp4 / hls) ----------------------------------------------------
  // crossorigin solo si hay subtítulos de otro origen (exige CORS); si no, se evita bloquear fuentes sin CORS.
  const externalSubs = subtitles.some((s) => !s.url.startsWith('/'));
  const video = h('video', { playsinline: true, preload: 'metadata', crossorigin: externalSubs ? 'anonymous' : null });
  for (const [i, s] of subtitles.entries()) {
    video.append(h('track', { kind: 'subtitles', src: s.url, srclang: s.lang, label: s.label, default: i === 0 && /^es/.test(s.lang) }));
  }
  for (const t of video.textTracks) t.mode = 'disabled';

  let hls = null;
  const setSource = () => {
    if (source.type === 'hls') {
      if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = source.url; return; }
      if (window.Hls && window.Hls.isSupported()) { hls = new window.Hls(); hls.loadSource(source.url); hls.attachMedia(video); return; }
      // hls.js debe estar en /vendor/hls.min.js (ver README)
      const sc = document.createElement('script');
      sc.src = '/vendor/hls.min.js';
      sc.onload = () => { if (window.Hls && window.Hls.isSupported()) { hls = new window.Hls(); hls.loadSource(source.url); hls.attachMedia(video); } else showError(); };
      sc.onerror = showError;
      document.head.append(sc);
      return;
    }
    video.src = source.url;
  };

  // ---- Controles ------------------------------------------------------------
  const playBtn = h('button', { class: 'icon-btn', 'aria-label': 'Reproducir/Pausar', title: 'Reproducir/Pausar (espacio)' });
  const setPlayIcon = () => { playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause', true)); };
  const timeEl = h('span', { class: 't' }, '0:00 / 0:00');
  const buf = h('div', { class: 'buf' });
  const cur = h('div', { class: 'cur' });
  const knob = h('div', { class: 'knob' });
  const tip = h('div', { class: 'tip' }, '0:00');
  const seek = h('div', { class: 'seek', role: 'slider', 'aria-label': 'Progreso', tabindex: '0' }, h('div', { class: 'track' }, buf, cur, knob), tip);
  const volIcon = h('button', { class: 'icon-btn', 'aria-label': 'Silenciar (m)' });
  const volRange = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '1', 'aria-label': 'Volumen' });
  const popHost = h('div', { class: 'ctrl-wrap' });
  const center = h('div', { class: 'p-center' }, spinner());
  center.hidden = true;

  const flash = (txt) => { const f = h('div', { class: 'p-flash' }, txt); root.append(f); setTimeout(() => f.remove(), 700); };
  const seekBy = (d) => { if (video.duration) video.currentTime = Math.min(Math.max(0, video.currentTime + d), video.duration); flash((d > 0 ? '+' : '') + d + ' s'); };
  const toggle = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const toggleFs = () => {
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else { const f = root.requestFullscreen || root.webkitRequestFullscreen; if (f) f.call(root); }
  };

  playBtn.onclick = toggle;
  volIcon.onclick = () => { video.muted = !video.muted; };
  volRange.oninput = () => { video.volume = Number(volRange.value); video.muted = video.volume === 0; };

  const closePop = () => popHost.replaceChildren();
  function openPop(kind) {
    if (popHost.firstChild && popHost.dataset.kind === kind) return closePop();
    closePop();
    popHost.dataset.kind = kind;
    const pop = h('div', { class: 'pop' });
    if (kind === 'speed') {
      pop.append(h('div', { class: 'ttl' }, 'Velocidad'));
      for (const s of SPEEDS) pop.append(h('button', { class: video.playbackRate === s ? 'on' : '', onclick: () => { video.playbackRate = s; closePop(); } }, s === 1 ? 'Normal' : s + '×'));
    } else {
      pop.append(h('div', { class: 'ttl' }, 'Subtítulos'));
      const tracks = [...video.textTracks];
      const none = tracks.every((t) => t.mode !== 'showing');
      pop.append(h('button', { class: none ? 'on' : '', onclick: () => { tracks.forEach((t) => (t.mode = 'disabled')); closePop(); } }, 'Desactivados'));
      tracks.forEach((t) => pop.append(h('button', { class: t.mode === 'showing' ? 'on' : '', onclick: () => { tracks.forEach((x) => (x.mode = x === t ? 'showing' : 'disabled')); closePop(); } }, t.label || t.language)));
    }
    popHost.append(pop);
  }

  const ctrls = h('div', { class: 'ctrls' },
    playBtn,
    h('button', { class: 'icon-btn', 'aria-label': 'Retroceder 10 segundos', title: 'Retroceder 10 s (←)', onclick: () => seekBy(-10) }, icon('back10')),
    h('button', { class: 'icon-btn', 'aria-label': 'Adelantar 10 segundos', title: 'Adelantar 10 s (→)', onclick: () => seekBy(10) }, icon('fwd10')),
    h('div', { class: 'vol' }, volIcon, volRange),
    timeEl,
    h('div', { class: 'grow' }),
    next ? h('button', { class: 'icon-btn', 'aria-label': 'Siguiente episodio', title: 'Siguiente episodio', onclick: () => onNext && onNext() }, icon('next')) : null,
    subtitles.length ? h('button', { class: 'icon-btn', 'aria-label': 'Subtítulos', title: 'Subtítulos (c)', onclick: () => openPop('subs') }, icon('cc')) : null,
    h('button', { class: 'icon-btn', 'aria-label': 'Velocidad', title: 'Velocidad', onclick: () => openPop('speed') }, icon('gear')),
    h('button', { class: 'icon-btn', 'aria-label': 'Pantalla completa', title: 'Pantalla completa (f)', onclick: toggleFs }, icon('full')),
    popHost
  );
  const top = h('div', { class: 'p-top' },
    h('button', { class: 'icon-btn', 'aria-label': 'Volver', onclick: onBack }, icon('arrowL')),
    h('div', { class: 'grow' }, h('h2', null, title), subtitle ? h('div', { class: 'muted', style: 'font-size:13px' }, subtitle) : null));
  const bottom = h('div', { class: 'p-bottom' }, seek, ctrls);
  root.append(video, center, top, bottom);

  // ---- Barra de progreso (ratón y táctil) ------------------------------------
  const ratioFrom = (e) => { const r = seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  let dragging = false;
  seek.addEventListener('pointerdown', (e) => { dragging = true; seek.setPointerCapture(e.pointerId); if (video.duration) video.currentTime = ratioFrom(e) * video.duration; });
  seek.addEventListener('pointermove', (e) => {
    const r = ratioFrom(e);
    tip.textContent = fmtTime(r * (video.duration || 0));
    tip.style.left = r * 100 + '%';
    if (dragging && video.duration) video.currentTime = r * video.duration;
  });
  seek.addEventListener('pointerup', () => { dragging = false; });
  seek.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') { e.stopPropagation(); seekBy(-5); } if (e.key === 'ArrowRight') { e.stopPropagation(); seekBy(5); } });

  // ---- Eventos del video ---------------------------------------------------------
  const paint = () => {
    const d = video.duration || 0;
    const t = video.currentTime || 0;
    cur.style.width = knob.style.left = d ? (t / d) * 100 + '%' : '0';
    if (video.buffered.length && d) buf.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + '%';
    timeEl.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    seek.setAttribute('aria-valuenow', String(Math.round(t)));
  };
  let lastSave = 0;
  const save = (force) => {
    const now = Date.now();
    if (!force && now - lastSave < 10_000) return;
    lastSave = now;
    if (video.duration) onProgress(video.currentTime, video.duration);
  };
  video.addEventListener('timeupdate', () => { paint(); save(false); });
  video.addEventListener('progress', paint);
  video.addEventListener('durationchange', paint);
  video.addEventListener('play', () => { setPlayIcon(); wake(); });
  video.addEventListener('pause', () => { setPlayIcon(); save(true); root.classList.remove('idle'); });
  video.addEventListener('waiting', () => { center.hidden = false; });
  for (const ev of ['playing', 'canplay', 'seeked']) video.addEventListener(ev, () => { center.hidden = true; });
  video.addEventListener('volumechange', () => {
    volIcon.replaceChildren(icon(video.muted || video.volume === 0 ? 'mute' : 'vol'));
    volRange.value = video.muted ? 0 : video.volume;
  });
  video.addEventListener('ended', () => { save(true); if (onEnded) onEnded(); });
  video.addEventListener('error', () => showError());
  video.addEventListener('click', toggle);
  video.addEventListener('dblclick', toggleFs);
  let resumed = false;
  video.addEventListener('loadedmetadata', () => {
    if (!resumed && startAt > 3 && startAt < (video.duration || Infinity) - 5) video.currentTime = startAt;
    resumed = true;
    paint();
  });

  function showError() {
    if (destroyed) return;
    root.querySelector('.p-msg')?.remove();
    root.append(errorBox('No se pudo reproducir este video. La fuente puede no estar disponible o no ser compatible con tu navegador.', onBack));
  }

  // ---- Ocultar controles por inactividad -------------------------------------
  let idleT;
  function wake() {
    root.classList.remove('idle', 'hide-cursor');
    clearTimeout(idleT);
    if (!video.paused) idleT = setTimeout(() => { if (!popHost.firstChild) root.classList.add('idle', 'hide-cursor'); }, 3000);
  }
  root.addEventListener('mousemove', wake);
  root.addEventListener('touchstart', wake, { passive: true });

  // ---- Teclado ------------------------------------------------------------------
  const onKey = (e) => {
    if (e.target.matches && e.target.matches('input[type=text], textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'arrowleft' || k === 'j') seekBy(-10);
    else if (k === 'arrowright' || k === 'l') seekBy(10);
    else if (k === 'arrowup') { video.volume = Math.min(1, video.volume + 0.1); video.muted = false; }
    else if (k === 'arrowdown') video.volume = Math.max(0, video.volume - 0.1);
    else if (k === 'm') video.muted = !video.muted;
    else if (k === 'f') toggleFs();
    else if (k === 'c' && subtitles.length) openPop('subs');
    else if (k === 'escape' && !fsEl()) onBack();
    else return;
    wake();
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  const onHide = () => { if (document.visibilityState === 'hidden') save(true); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => save(true));
  cleanups.push(() => document.removeEventListener('visibilitychange', onHide));
  root.addEventListener('click', (e) => { if (!e.target.closest('.pop, .ctrls button')) closePop(); });

  setPlayIcon();
  volIcon.replaceChildren(icon('vol'));
  setSource();
  video.play().catch(() => { /* el navegador exige un toque: el usuario pulsa reproducir */ });
  root.focus();

  return {
    el: root,
    savePosition: () => save(true),
    destroy() {
      destroyed = true;
      save(true);
      cleanups.forEach((f) => f());
      clearTimeout(idleT);
      if (hls) hls.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    },
  };
}

function errorBox(msg, onBack) {
  return h('div', { class: 'p-msg' },
    h('p', null, msg),
    h('div', null, h('button', { class: 'btn primary', onclick: onBack }, 'Volver')));
}

export function notifyUnsupported() { toast('Tu navegador no puede reproducir este formato', 'err'); }
