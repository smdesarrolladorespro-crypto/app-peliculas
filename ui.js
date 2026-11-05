// Utilidades de interfaz: creación segura de DOM (sin innerHTML), iconos, toasts y modales.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  tv: 'M3 7h18v12H3zM8 3l4 4 4-4',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  heart: 'M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  back10: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6M10 14.5v-3l-1 .6M13 11.5h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-2z',
  fwd10: 'M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6M10 14.5v-3l-1 .6M13 11.5h2a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-2z',
  vol: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12',
  mute: 'M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  cc: 'M4 5h16v14H4zM10 10a2 2 0 1 0 0 4M17 10a2 2 0 1 0 0 4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z',
  next: 'M5 4l11 8-11 8zM18 4v16',
  arrowL: 'M15 5l-7 7 7 7',
  arrowR: 'M9 5l7 7-7 7',
  close: 'M5 5l14 14M19 5L5 19',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M16 8l4 4-4 4M20 12H9',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  film2: 'M3 5h18v14H3zM3 9h18M3 15h18',
};

export function icon(name, filled = false) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', filled ? 'currentColor' : 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  s.append(p);
  return s;
}

export function logo(big = false) {
  return h('span', { class: 'logo' + (big ? ' big' : '') }, icon('play', true), h('span', null, 'CINE', h('b', null, 'PLUS')));
}

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5000 : 2800);
}

export function modal(build, { narrow = false } = {}) {
  const prevFocus = document.activeElement;
  const bg = h('div', { class: 'modal-bg', role: 'dialog', 'aria-modal': 'true' });
  const box = h('div', { class: 'modal' + (narrow ? ' narrow' : '') });
  bg.append(box);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey);
  build(box, close);
  document.body.append(bg);
  const f = box.querySelector('input, select, textarea, button');
  if (f) f.focus();
  return close;
}

export function confirmBox(message, { okText = 'Aceptar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    modal((box, close) => {
      const origClose = close;
      box.append(
        h('h3', null, 'Confirmar'),
        h('p', null, message),
        h('div', { class: 'foot' },
          h('button', { class: 'btn', onclick: () => { finish(false); origClose(); } }, 'Cancelar'),
          h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { finish(true); origClose(); } }, okText))
      );
      box.parentElement.addEventListener('remove', () => finish(false));
      new MutationObserver((_, o) => { if (!document.body.contains(box)) { finish(false); o.disconnect(); } }).observe(document.body, { childList: true });
    }, { narrow: true });
  });
}

export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
};
export const fmtRuntime = (m) => (m ? (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} min`) : '');
export const fmtDate = (ms) => new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
export const spinner = () => h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Cargando' });
export const initial = (name) => (String(name || '?').trim()[0] || '?').toUpperCase();
