import { h, icon, logo, toast, modal, confirmBox, clear, fmtTime, fmtRuntime, fmtDate, spinner, initial } from './ui.js';
import { S, api, get, post, put, patch, del, loadFavs, toggleFav, setSession, selectProfile, clearSession } from './api.js';
import { createPlayer } from './player.js';
import { pushState, enablePush, disablePush, detachPush } from './push.js';

const root = document.getElementById('app');
const COLORS = ['#e50914', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
const PLACEHOLDER = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#1f1f23"/><text x="200" y="305" text-anchor="middle" fill="#555" font-family="sans-serif" font-size="22">Sin portada</text></svg>');
let GENRES = [];
const genreName = (slug) => (GENRES.find((g) => g.slug === slug) || {}).name || slug;

let seq = 0;            // invalida renders asíncronos antiguos
let cleanup = null;     // limpieza de la vista actual (reproductor, timers)
let shell = null;       // referencias a la estructura (barra superior, contenedor)
let shellDispose = null; // quita los listeners globales de la estructura anterior

/* ------------------------------------------------------------------ Router */
const routes = [];
const route = (pattern, fn, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ re, keys, fn, opts });
};
const parseHash = () => {
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
};
export const go = (path, { replace = false } = {}) => {
  if (replace) location.replace('#' + path); else location.hash = path;
};

async function render() {
  const my = ++seq;
  if (cleanup) { try { cleanup(); } catch { /* ignorar */ } cleanup = null; }
  document.querySelectorAll('.modal-bg').forEach((m) => m.remove());
  const { path, query } = parseHash();
  let matched = null;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) { matched = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; break; }
  }
  if (!matched) return go(S.user ? '/home' : '/welcome', { replace: true });
  const { r, params } = matched;
  if (!r.opts.public && !S.user) return go('/welcome', { replace: true });
  if (r.opts.public && S.user && !r.opts.always) return go(S.profile ? '/home' : '/profiles', { replace: true });
  if (!r.opts.public && !r.opts.noProfile && !S.profile) return go('/profiles', { replace: true });
  if (r.opts.admin && S.user.role !== 'admin') { toast('Acceso restringido a administradores', 'err'); return go('/home', { replace: true }); }
  window.scrollTo(0, 0);
  const ctx = { params, query, alive: () => my === seq, setCleanup: (f) => { cleanup = f; } };
  try {
    if (r.opts.layout === 'shell') { const box = ensureShell(path); clear(box); box.append(spinner()); ctx.box = box; await r.fn(ctx); }
    else { shell = null; clear(root); ctx.box = root; await r.fn(ctx); }
  } catch (e) {
    if (my !== seq) return;
    const target = ctx.box || root;
    clear(target);
    target.append(h('div', { class: 'empty', style: 'padding-top:120px' }, icon('info'), h('p', null, e.message || 'Algo salió mal'), h('p', null, h('a', { class: 'btn', href: '#/home' }, 'Ir al inicio'))));
  }
}
window.addEventListener('hashchange', render);

S.onAuthLost = () => { clearSession(); toast('Tu sesión expiró. Inicia sesión de nuevo.', 'err'); go('/login'); };

/* --------------------------------------------------------------- Componentes */
function posterCard(t, { href, sub, progress, onToggle } = {}) {
  const on = S.favs.has(t.id);
  const fav = h('button', {
    class: 'fav' + (on ? ' on' : ''), 'aria-label': on ? 'Quitar de favoritos' : 'Añadir a favoritos',
    onclick: async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        const now = await toggleFav(t.id);
        fav.classList.toggle('on', now);
        fav.replaceChildren(icon('heart', now));
        fav.setAttribute('aria-label', now ? 'Quitar de favoritos' : 'Añadir a favoritos');
        toast(now ? 'Añadido a Favoritos' : 'Quitado de Favoritos', 'ok');
        if (onToggle) onToggle(now);
      } catch (err) { toast(err.message, 'err'); }
    },
  }, icon('heart', on));
  return h('div', { class: 'card' },
    h('a', { href: href || `#/title/${t.id}`, style: 'display:block', 'aria-label': t.title },
      h('div', { class: 'poster' },
        h('img', { src: t.poster_url || PLACEHOLDER, alt: '', loading: 'lazy', decoding: 'async' }),
        t.rating ? h('span', { class: 'rate' }, '★ ' + Number(t.rating).toFixed(1)) : null,
        t.playable === false ? h('div', { class: 'soon' }, 'PRÓXIMAMENTE') : null,
        progress != null ? h('div', { class: 'prog' }, h('i', { style: `width:${Math.min(100, progress)}%` })) : null),
      h('div', { class: 'name' }, t.title),
      h('div', { class: 'sub' }, sub || [t.year, t.type === 'series' ? 'Serie' : 'Película'].filter(Boolean).join(' · '))),
    fav);
}

function shelf(title, items, { moreHref } = {}) {
  if (!items || !items.length) return null;
  const rail = h('div', { class: 'rail' }, items);
  const scroll = (d) => rail.scrollBy({ left: d * rail.clientWidth * 0.85, behavior: 'smooth' });
  return h('section', { class: 'shelf' },
    h('div', { class: 'shelf-head' }, h('h2', null, title), moreHref ? h('a', { href: moreHref }, 'Ver todo ›') : null),
    h('div', { class: 'shelf-body' },
      h('button', { class: 'rail-btn prev', 'aria-label': 'Anterior', onclick: () => scroll(-1) }, icon('arrowL')),
      rail,
      h('button', { class: 'rail-btn next', 'aria-label': 'Siguiente', onclick: () => scroll(1) }, icon('arrowR'))));
}

const metaLine = (t) => h('div', { class: 'meta' },
  t.rating ? h('span', { class: 'star' }, '★ ' + Number(t.rating).toFixed(1)) : null,
  t.year ? h('span', null, t.year) : null,
  t.runtime ? h('span', null, fmtRuntime(t.runtime)) : null,
  h('span', { class: 'tag' }, t.type === 'series' ? 'SERIE' : 'PELÍCULA'),
  ...(t.genres || []).slice(0, 3).map((g) => h('span', null, genreName(g))));

function favButton(t, { label = true } = {}) {
  const btn = h('button', { class: 'btn ghost' });
  const paint = () => {
    const on = S.favs.has(t.id);
    btn.replaceChildren(icon(on ? 'check' : 'plus'), label ? (on ? 'En mi lista' : 'Mi lista') : null);
    btn.setAttribute('aria-pressed', String(on));
  };
  btn.onclick = async () => {
    try { const on = await toggleFav(t.id); paint(); toast(on ? 'Añadido a Favoritos' : 'Quitado de Favoritos', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  };
  paint();
  return btn;
}

const pct = (p) => (p.duration > 0 ? Math.min(100, (p.position / p.duration) * 100) : 0);
const watchHref = (titleId, epId) => `#/watch/${titleId}` + (epId ? `?ep=${epId}` : '');

/* --------------------------------------------------------------- Estructura */
function ensureShell(path) {
  if (!shell || !root.contains(shell.main)) {
    clear(root);
    const main = h('main', { id: 'main' });
    const links = [
      ['/home', 'Inicio', 'home'], ['/movies', 'Películas', 'film'], ['/series', 'Series', 'tv'],
      ['/genres', 'Géneros', 'grid'], ['/favorites', 'Favoritos', 'heart'], ['/history', 'Historial', 'clock'],
    ];
    const search = h('input', { type: 'search', placeholder: 'Buscar películas y series', 'aria-label': 'Buscar', autocomplete: 'off', maxlength: '100' });
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const v = search.value.trim();
        if (v) go('/search?q=' + encodeURIComponent(v), { replace: parseHash().path === '/search' });
        else if (parseHash().path === '/search') go('/home');
      }, 350);
    });
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(t); const v = search.value.trim(); if (v) go('/search?q=' + encodeURIComponent(v), { replace: parseHash().path === '/search' }); } });

    const menu = h('div', { class: 'menu', hidden: true });
    const avatarBtn = h('button', { class: 'icon-btn', 'aria-label': 'Menú de usuario', 'aria-haspopup': 'true', style: 'width:auto;border-radius:8px' }, h('span', { class: 'avatar sm', style: `background:${S.profile.avatar_color}` }, initial(S.profile.name)));
    const closeMenu = () => { menu.hidden = true; };
    avatarBtn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
    const onDocClick = (e) => { if (!menu.contains(e.target)) closeMenu(); };
    document.addEventListener('click', onDocClick);
    menu.append(
      h('div', { class: 'who' }, S.profile.name + ' · ' + S.user.email),
      h('a', { href: '#/profile', onclick: closeMenu }, icon('user'), 'Mi perfil'),
      h('a', { href: '#/history', onclick: closeMenu }, icon('clock'), 'Historial'),
      h('a', { href: '#/profiles', onclick: closeMenu }, icon('swap'), 'Cambiar de perfil'),
      S.user.role === 'admin' ? h('a', { href: '#/admin', onclick: closeMenu }, icon('shield'), 'Panel de administración') : null,
      h('hr'),
      h('button', { onclick: doLogout }, icon('logout'), 'Cerrar sesión'));

    const top = h('header', { class: 'topbar' },
      h('a', { href: '#/home', 'aria-label': 'CINEPLUS - Inicio' }, logo()),
      h('nav', { 'aria-label': 'Principal' }, links.map(([p, l]) => h('a', { href: '#' + p, 'data-p': p }, l))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'searchbox' }, icon('search'), search),
      h('div', { class: 'menu-wrap' }, avatarBtn, menu));
    const bottom = h('nav', { class: 'bottomnav', 'aria-label': 'Navegación móvil' }, links.map(([p, l, i]) => h('a', { href: '#' + p, 'data-p': p }, icon(i), l)));
    const onScroll = () => top.classList.toggle('solid', window.scrollY > 20);
    if (shellDispose) shellDispose();
    window.addEventListener('scroll', onScroll, { passive: true });
    shellDispose = () => { document.removeEventListener('click', onDocClick); window.removeEventListener('scroll', onScroll); shellDispose = null; };
    root.append(top, main, bottom);
    shell = { main, top, bottom, search, menu };
    onScroll();
  }
  const base = '/' + (path.split('/')[1] || '');
  const active = base === '/genre' ? '/genres' : base === '/title' ? null : base;
  shell.top.querySelectorAll('a[data-p]').forEach((a) => a.classList.toggle('active', a.dataset.p === active));
  shell.bottom.querySelectorAll('a[data-p]').forEach((a) => a.classList.toggle('active', a.dataset.p === active));
  shell.menu.hidden = true;
  if (base !== '/search' && shell.search.value) shell.search.value = '';
  return shell.main;
}

async function doLogout() {
  await detachPush();
  try { await post('/api/auth/logout'); } catch { /* ignorar */ }
  clearSession();
  shell = null;
  go('/welcome');
}

async function enterApp() {
  GENRES = (await get('/api/genres')).genres;
  if (S.profile) await loadFavs();
}

/* ------------------------------------------------------- Bienvenida y acceso */
route('/welcome', ({ box }) => {
  box.append(h('div', { class: 'welcome' },
    h('div', { class: 'content' },
      logo(true),
      h('h1', null, 'Películas y series gratis, de fuentes legales'),
      h('p', null, 'Disfruta de cine de dominio público y obras abiertas, guarda tus favoritos y continúa viendo justo donde lo dejaste.'),
      h('div', { class: 'actions' },
        h('a', { class: 'btn primary', href: '#/login' }, 'Iniciar sesión'),
        h('a', { class: 'btn', href: '#/register' }, 'Crear cuenta')))));
}, { public: true });

function authLayout(box, title, body, links) {
  box.append(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('a', { href: '#/welcome', 'aria-label': 'Inicio' }, logo()), h('h2', null, title), body, links ? h('div', { class: 'links' }, links) : null)));
}

function formHelper() {
  const err = h('div', { class: 'error', role: 'alert', hidden: true });
  return {
    err,
    show(m) { err.textContent = m; err.hidden = !m; },
    async run(btn, fn) {
      err.hidden = true; btn.disabled = true;
      try { await fn(); } catch (e) { err.textContent = e.message; err.hidden = false; } finally { btn.disabled = false; }
    },
  };
}
const field = (label, input, hint) => h('div', { class: 'field' }, h('label', { for: input.id }, label), input, hint ? h('div', { class: 'hint' }, hint) : null);

async function afterAuth(payload) {
  setSession(payload);
  shell = null;
  await enterApp();
  go(S.profile ? '/home' : '/profiles');
}

route('/login', ({ box }) => {
  const f = formHelper();
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'username', placeholder: 'tu@correo.com' });
  const pass = h('input', { id: 'pass', type: 'password', required: true, autocomplete: 'current-password' });
  const rem = h('input', { type: 'checkbox', checked: true });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Iniciar sesión');
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); f.run(btn, async () => afterAuth(await post('/api/auth/login', { email: email.value, password: pass.value, remember: rem.checked }))); } },
    f.err, field('Correo electrónico', email), field('Contraseña', pass),
    h('label', { class: 'check', style: 'margin-bottom:16px' }, rem, 'Mantener la sesión iniciada'), btn);
  authLayout(box, 'Iniciar sesión', form, [h('a', { href: '#/forgot' }, '¿Olvidaste tu contraseña?'), h('span', null, '¿Nuevo? ', h('a', { href: '#/register' }, 'Crear cuenta'))]);
}, { public: true });

route('/register', ({ box }) => {
  const f = formHelper();
  const name = h('input', { id: 'name', required: true, minlength: '2', maxlength: '40', autocomplete: 'name' });
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email' });
  const pass = h('input', { id: 'pass', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
  const pass2 = h('input', { id: 'pass2', type: 'password', required: true, autocomplete: 'new-password' });
  const rem = h('input', { type: 'checkbox', checked: true });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Crear cuenta');
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    if (pass.value !== pass2.value) return f.show('Las contraseñas no coinciden');
    f.run(btn, async () => afterAuth(await post('/api/auth/register', { name: name.value, email: email.value, password: pass.value, remember: rem.checked })));
  } }, f.err, field('Nombre', name), field('Correo electrónico', email),
  field('Contraseña', pass, 'Mínimo 8 caracteres, con letras y números'), field('Repetir contraseña', pass2),
  h('label', { class: 'check', style: 'margin-bottom:16px' }, rem, 'Mantener la sesión iniciada'), btn);
  authLayout(box, 'Crear cuenta', form, [h('span', null, '¿Ya tienes cuenta? ', h('a', { href: '#/login' }, 'Iniciar sesión'))]);
}, { public: true });

route('/forgot', ({ box }) => {
  const f = formHelper();
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'email' });
  const out = h('div');
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Enviar enlace');
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    f.run(btn, async () => {
      const r = await post('/api/auth/forgot', { email: email.value });
      clear(out);
      out.append(h('div', { class: 'notice' }, r.message));
      if (r.devLink) out.append(h('div', { class: 'notice' }, 'Modo desarrollo (sin servicio de correo): ', h('a', { href: r.devLink, style: 'text-decoration:underline' }, 'abrir enlace de restablecimiento')));
    });
  } }, f.err, out, field('Correo de tu cuenta', email), btn);
  authLayout(box, 'Recuperar contraseña', form, [h('a', { href: '#/login' }, '‹ Volver a iniciar sesión')]);
}, { public: true });

route('/reset/:token', ({ box, params }) => {
  const f = formHelper();
  const pass = h('input', { id: 'pass', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
  const pass2 = h('input', { id: 'pass2', type: 'password', required: true, autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Guardar contraseña');
  const form = h('form', { onsubmit: (e) => {
    e.preventDefault();
    if (pass.value !== pass2.value) return f.show('Las contraseñas no coinciden');
    f.run(btn, async () => { await post('/api/auth/reset', { token: params.token, password: pass.value }); toast('Contraseña actualizada. Ya puedes iniciar sesión.', 'ok'); go('/login'); });
  } }, f.err, field('Nueva contraseña', pass, 'Mínimo 8 caracteres, con letras y números'), field('Repetir contraseña', pass2), btn);
  authLayout(box, 'Nueva contraseña', form, [h('a', { href: '#/login' }, '‹ Volver a iniciar sesión')]);
}, { public: true, always: true });

/* ------------------------------------------------------------------ Perfiles */
function profileForm({ profile, onSaved }) {
  modal((box, close) => {
    const f = formHelper();
    let color = profile ? profile.avatar_color : COLORS[S.profiles.length % COLORS.length];
    const name = h('input', { id: 'pname', required: true, maxlength: '40', value: profile ? profile.name : '' });
    const sw = h('div', { class: 'swatches' });
    const paint = () => { clear(sw); COLORS.forEach((c) => sw.append(h('button', { type: 'button', class: 'swatch' + (c === color ? ' on' : ''), style: `background:${c}`, 'aria-label': 'Color ' + c, onclick: () => { color = c; paint(); } }))); };
    paint();
    const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar');
    const delBtn = profile && S.profiles.length > 1 ? h('button', { type: 'button', class: 'btn danger', style: 'margin-right:auto', onclick: async () => {
      if (!(await confirmBox(`¿Eliminar el perfil “${profile.name}”? Se borrarán sus favoritos e historial.`, { okText: 'Eliminar', danger: true }))) return;
      try {
        await del('/api/profiles/' + profile.id);
        S.profiles = S.profiles.filter((x) => x.id !== profile.id);
        if (S.profile && S.profile.id === profile.id) S.profile = null;
        close(); onSaved && onSaved(null);
      } catch (e) { f.show(e.message); }
    } }, 'Eliminar') : null;
    box.append(h('h3', null, profile ? 'Editar perfil' : 'Nuevo perfil'),
      h('form', { onsubmit: (e) => {
        e.preventDefault();
        f.run(btn, async () => {
          const r = profile ? await patch(`/api/profiles/${profile.id}`, { name: name.value, avatar_color: color }) : await post('/api/profiles', { name: name.value, avatar_color: color });
          const list = (await get('/api/profiles')).profiles;
          S.profiles = list;
          if (S.profile) { const cur = list.find((p) => p.id === S.profile.id); if (cur) S.profile = cur; }
          close(); onSaved && onSaved(r.profile);
        });
      } }, f.err, field('Nombre del perfil', name), h('div', { class: 'field' }, h('label', null, 'Color'), sw),
      h('div', { class: 'foot' }, delBtn, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancelar'), btn)));
  }, { narrow: true });
}

route('/profiles', ({ box }) => {
  const list = h('div', { class: 'avatars' });
  const title = h('h1', null, '¿Quién está viendo?');
  const manageBtn = h('button', { class: 'btn' }, 'Administrar perfiles');
  let managing = false;
  const draw = () => {
    clear(list);
    title.textContent = managing ? 'Administrar perfiles' : '¿Quién está viendo?';
    manageBtn.textContent = managing ? 'Listo' : 'Administrar perfiles';
    if (S.profile && !S.profiles.some((p) => p.id === S.profile.id)) S.profile = null;
    S.profiles.forEach((p) => list.append(h('button', {
      class: 'avatar-btn',
      onclick: async () => {
        if (managing) return profileForm({ profile: p, onSaved: draw });
        selectProfile(p); await loadFavs(); shell = null; go('/home');
      },
    }, h('span', { class: 'avatar', style: `background:${p.avatar_color}` }, managing ? '✎' : initial(p.name)), p.name)));
    if (S.profiles.length < 5) list.append(h('button', { class: 'avatar-btn', onclick: () => profileForm({ onSaved: draw }) }, h('span', { class: 'avatar add' }, '+'), 'Añadir perfil'));
  };
  manageBtn.onclick = () => { managing = !managing; draw(); };
  draw();
  box.append(h('div', { class: 'profiles' }, logo(), title, list,
    h('div', { class: 'row-flex', style: 'justify-content:center' },
      manageBtn,
      S.profile ? h('a', { class: 'btn', href: '#/profile' }, 'Mi cuenta') : null,
      h('button', { class: 'btn', onclick: doLogout }, 'Cerrar sesión'))));
}, { noProfile: true });

/* ------------------------------------------------------------------- Inicio */
function hero(items) {
  if (!items.length) return null;
  let idx = 0;
  const slides = items.map((t, i) => h('div', { class: 'slide' + (i === 0 ? ' on' : ''), 'aria-hidden': String(i !== 0) },
    t.backdrop_url || t.poster_url ? h('img', { src: t.backdrop_url || t.poster_url, alt: '', fetchpriority: i === 0 ? 'high' : 'auto' }) : null,
    h('div', { class: 'info' },
      h('span', { class: 'badge-red' }, 'DESTACADO'),
      h('h1', { style: 'margin-top:12px' }, t.title),
      metaLine(t),
      h('p', { class: 'desc' }, t.overview),
      h('div', { class: 'row-flex' },
        t.type === 'movie' && t.playable
          ? h('a', { class: 'btn primary', href: watchHref(t.id) }, icon('play', true), 'Reproducir')
          : h('a', { class: 'btn primary', href: `#/title/${t.id}` }, icon('play', true), t.type === 'series' ? 'Ver episodios' : 'Ver ficha'),
        h('a', { class: 'btn ghost', href: `#/title/${t.id}` }, icon('info'), 'Más información'),
        favButton(t)))));
  const dots = items.map((_, i) => h('button', { 'aria-label': 'Ir a la diapositiva ' + (i + 1), class: i === 0 ? 'on' : '', onclick: () => show(i, true) }));
  const el = h('div', { class: 'hero' }, slides, items.length > 1 ? h('div', { class: 'dots' }, dots) : null);
  let timer;
  const show = (i, manual) => {
    idx = (i + items.length) % items.length;
    slides.forEach((s, k) => { s.classList.toggle('on', k === idx); s.setAttribute('aria-hidden', String(k !== idx)); });
    dots.forEach((d, k) => d.classList.toggle('on', k === idx));
    if (manual) start();
  };
  const start = () => { clearInterval(timer); if (items.length > 1) timer = setInterval(() => { if (!el.isConnected) return clearInterval(timer); if (!document.hidden) show(idx + 1); }, 7000); };
  start();
  return el;
}

route('/home', async ({ box, alive }) => {
  const [home, cont] = await Promise.all([get('/api/home'), get('/api/continue')]);
  if (!alive()) return;
  clear(box);
  box.append(
    hero(home.featured),
    h('div', { style: 'padding-top:10px' },
      cont.items.length ? shelf('Continuar viendo', cont.items.map((c) => posterCard(
        { id: c.title_id, title: c.title, poster_url: c.poster_url, type: c.type, playable: true, favHidden: true },
        { href: watchHref(c.title_id, c.episode_id), progress: pct(c), sub: c.type === 'series' ? `T${c.season} · E${c.number}` : fmtTime(c.position) + ' / ' + fmtTime(c.duration) }))) : null,
      shelf('Populares', home.popular.map((t) => posterCard(t)), { moreHref: '#/movies' }),
      shelf('Estrenos', home.latest.map((t) => posterCard(t))),
      shelf('Películas', home.movies.map((t) => posterCard(t)), { moreHref: '#/movies' }),
      shelf('Series', home.series.map((t) => posterCard(t)), { moreHref: '#/series' }),
      home.genres.map((g) => shelf(g.name, g.items.map((t) => posterCard(t)), { moreHref: '#/genre/' + g.slug }))));
}, { layout: 'shell' });

/* ------------------------------------------------- Catálogo, géneros, búsqueda */
function catalog(ctx, { title, subtitle, type, genre, text, showTypeChips }) {
  const { box, alive } = ctx;
  const st = { type, genre, sort: text ? 'popular' : 'recent', offset: 0, items: [], total: 0 };
  const chips = h('div', { class: 'chips' });
  const grid = h('div', { class: 'grid' });
  const more = h('button', { class: 'btn', style: 'margin:26px auto 0;display:flex' }, 'Cargar más');
  const count = h('span', { class: 'muted' });
  const sort = h('select', { 'aria-label': 'Ordenar', onchange: () => { st.sort = sort.value; reload(); } },
    ...[['recent', 'Más recientes'], ['popular', 'Más populares'], ['rating', 'Mejor calificadas'], ['year', 'Año'], ['az', 'A–Z']].map(([v, l]) => h('option', { value: v, selected: v === st.sort }, l)));

  const drawChips = () => {
    clear(chips);
    if (showTypeChips) [['', 'Todo'], ['movie', 'Películas'], ['series', 'Series']].forEach(([v, l]) => chips.append(h('button', { class: 'chip' + ((st.type || '') === v ? ' on' : ''), onclick: () => { st.type = v || undefined; drawChips(); reload(); } }, l)));
    chips.append(h('button', { class: 'chip' + (!st.genre ? ' on' : ''), onclick: () => { st.genre = undefined; drawChips(); reload(); } }, 'Todos los géneros'));
    GENRES.forEach((g) => chips.append(h('button', { class: 'chip' + (st.genre === g.slug ? ' on' : ''), onclick: () => { st.genre = g.slug; drawChips(); reload(); } }, g.name)));
  };
  async function load(append) {
    const p = new URLSearchParams({ sort: st.sort, limit: '30', offset: String(st.offset) });
    if (st.type) p.set('type', st.type);
    if (st.genre) p.set('genre', st.genre);
    if (text) p.set('q', text);
    const d = await get('/api/titles?' + p);
    if (!alive()) return;
    st.total = d.total;
    st.items = append ? st.items.concat(d.items) : d.items;
    if (!append) clear(grid);
    d.items.forEach((t) => grid.append(posterCard(t)));
    count.textContent = `${st.total} ${st.total === 1 ? 'resultado' : 'resultados'}`;
    more.hidden = st.items.length >= st.total;
    if (!st.items.length) { clear(grid); grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, icon('film'), h('p', null, text ? `No encontramos resultados para “${text}”.` : 'No hay títulos en esta categoría todavía.'))); }
  }
  const reload = () => { st.offset = 0; load(false).catch((e) => toast(e.message, 'err')); };
  more.onclick = () => { st.offset = st.items.length; load(true).catch((e) => toast(e.message, 'err')); };
  clear(box);
  box.append(h('div', { class: 'page' }, h('h1', null, title), h('p', { class: 'sub' }, subtitle || ''), chips,
    h('div', { class: 'toolbar', style: 'margin-bottom:16px' }, count, sort), grid, more));
  drawChips();
  return load(false);
}

route('/movies', (ctx) => catalog(ctx, { title: 'Películas', subtitle: 'Cine gratuito de dominio público y licencias abiertas', type: 'movie' }), { layout: 'shell' });
route('/series', (ctx) => catalog(ctx, { title: 'Series', subtitle: 'Series y miniseries disponibles', type: 'series' }), { layout: 'shell' });
route('/genre/:slug', (ctx) => catalog(ctx, { title: genreName(ctx.params.slug), subtitle: 'Películas y series de este género', genre: ctx.params.slug }), { layout: 'shell' });
route('/search', (ctx) => {
  const text = (ctx.query.q || '').trim();
  if (shell && shell.search.value !== text) shell.search.value = text;
  if (!text) { clear(ctx.box); return ctx.box.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, icon('search'), h('p', null, 'Escribe algo para buscar películas y series.')))); }
  return catalog(ctx, { title: `Resultados para “${text}”`, text, showTypeChips: true });
}, { layout: 'shell' });

route('/genres', ({ box, alive }) => {
  return get('/api/genres').then(({ genres }) => {
    if (!alive()) return;
    GENRES = genres;
    clear(box);
    box.append(h('div', { class: 'page' }, h('h1', null, 'Géneros'), h('p', { class: 'sub' }, 'Explora el catálogo por categoría'),
      h('div', { class: 'genre-tiles' }, genres.map((g, i) => h('a', { class: 'genre-tile', href: '#/genre/' + g.slug, style: `--c:hsl(${(i * 41 + 350) % 360} 55% 24%)` },
        icon('film'), h('b', null, g.name), h('span', null, `${g.count} ${g.count === 1 ? 'título' : 'títulos'}`))))));
  });
}, { layout: 'shell' });

/* ------------------------------------------------------------------ Detalle */
route('/title/:id', async ({ box, params, alive }) => {
  const id = Number(params.id);
  const [{ title: t, seasons, similar }, prog] = await Promise.all([get('/api/titles/' + id), get('/api/progress/' + id)]);
  if (!alive()) return;
  const progMap = new Map(prog.items.map((p) => [p.episode_id, p]));
  const allEps = seasons.flatMap((s) => s.episodes);
  let cta;
  if (t.type === 'movie') {
    const p = progMap.get(0);
    const resume = p && p.position > 5 && pct(p) < 95;
    cta = t.playable ? h('a', { class: 'btn primary', href: watchHref(id) }, icon('play', true), resume ? `Continuar (${fmtTime(p.position)})` : 'Reproducir') : h('button', { class: 'btn', disabled: true }, 'Aún no disponible');
  } else {
    const lastP = prog.items[0];
    const lastEp = lastP && allEps.find((e) => e.id === lastP.episode_id);
    const resume = lastEp && lastP.position > 5 && pct(lastP) < 95;
    const first = allEps.find((e) => e.playable);
    const target = resume ? lastEp : first;
    cta = target ? h('a', { class: 'btn primary', href: watchHref(id, target.id) }, icon('play', true), `${resume ? 'Continuar' : 'Reproducir'} T${target.season} · E${target.number}`) : h('button', { class: 'btn', disabled: true }, 'Aún no disponible');
  }
  clear(box);
  box.append(h('div', { class: 'detail-hero' },
    t.backdrop_url || t.poster_url ? h('img', { class: 'bg', src: t.backdrop_url || t.poster_url, alt: '' }) : null,
    h('div', { class: 'inner' },
      h('img', { class: 'poster-big', src: t.poster_url || PLACEHOLDER, alt: 'Póster de ' + t.title }),
      h('div', null, h('h1', null, t.title), metaLine(t), h('p', { class: 'overview' }, t.overview || 'Sin sinopsis disponible.'),
        h('div', { class: 'actions' }, cta, favButton(t), h('button', { class: 'btn ghost', onclick: () => history.back() }, icon('arrowL'), 'Volver'))))));

  if (t.type === 'series') {
    const wrap = h('div', { class: 'seasons' });
    if (!seasons.length) wrap.append(h('p', { class: 'muted' }, 'Esta serie aún no tiene episodios.'));
    else {
      const sel = h('select', { 'aria-label': 'Temporada' }, seasons.map((s) => h('option', { value: s.season }, `Temporada ${s.season}`)));
      const list = h('div');
      const drawEps = () => {
        clear(list);
        const s = seasons.find((x) => x.season === Number(sel.value));
        s.episodes.forEach((e) => {
          const p = progMap.get(e.id);
          list.append(h('div', { class: 'ep' },
            h('div', { class: 'n' }, e.number),
            h('div', null, h('h4', null, e.name), e.runtime ? h('span', { class: 'muted', style: 'font-size:12px' }, fmtRuntime(e.runtime)) : null, e.overview ? h('p', null, e.overview) : null,
              p && p.position > 5 ? h('div', { class: 'bar', title: Math.round(pct(p)) + '% visto' }, h('i', { style: `width:${pct(p)}%` })) : null),
            e.playable ? h('a', { class: 'btn small primary', href: watchHref(id, e.id), 'aria-label': `Reproducir episodio ${e.number}` }, icon('play', true), p && p.position > 5 && pct(p) < 95 ? 'Continuar' : 'Ver') : h('span', { class: 'muted', style: 'font-size:12px' }, 'No disponible')));
        });
      };
      sel.onchange = drawEps;
      const lastP = prog.items[0]; const lastEp = lastP && allEps.find((e) => e.id === lastP.episode_id);
      if (lastEp) sel.value = String(lastEp.season);
      drawEps();
      wrap.append(h('div', { class: 'head' }, h('h2', null, 'Episodios'), sel), list);
    }
    box.append(wrap);
  }
  box.append(shelf('Títulos similares', similar.map((x) => posterCard(x))));
}, { layout: 'shell' });

/* ------------------------------------------------------------- Reproducción */
route('/watch/:id', async ({ box, params, query, alive, setCleanup }) => {
  const id = Number(params.id);
  const epId = Number(query.ep) || 0;
  const [info, prog] = await Promise.all([get(`/api/watch/${id}` + (epId ? `?episode=${epId}` : '')), get('/api/progress/' + id)]);
  if (!alive()) return;
  const curEp = info.episode ? info.episode.id : 0;
  const p = prog.items.find((x) => x.episode_id === curEp);
  const startAt = p && pct(p) < 95 ? p.position : 0;
  const back = () => go('/title/' + id);
  const subtitle = info.episode ? `T${info.episode.season} · E${info.episode.number} — ${info.episode.name}` : null;
  let nextTimer = null;
  const save = (position, duration) => { post('/api/history', { titleId: id, episodeId: curEp, position, duration }).catch(() => {}); };
  post(`/api/titles/${id}/view`).catch(() => {});

  const player = createPlayer({
    source: info.source, subtitles: info.subtitles, startAt, title: info.title.title, subtitle, next: info.next,
    onBack: back,
    onProgress: save,
    onNext: () => info.next && go(`/watch/${id}?ep=${info.next.id}`),
    onEnded: () => {
      if (info.source.type === 'mp4' || info.source.type === 'hls') { /* el reproductor ya guardó la posición final */ }
      if (!info.next) return back();
      let n = 8;
      const label = h('span', null, `Siguiente en ${n} s`);
      const card = h('div', { class: 'next-card' },
        h('div', { class: 'muted', style: 'font-size:12px' }, 'A continuación'),
        h('div', { style: 'font-weight:700;margin:4px 0 10px' }, `T${info.next.season} · E${info.next.number} — ${info.next.name}`),
        h('div', { class: 'row-flex' },
          h('button', { class: 'btn primary small', onclick: () => go(`/watch/${id}?ep=${info.next.id}`) }, icon('play', true), 'Ver ahora'),
          h('button', { class: 'btn small', onclick: () => { clearInterval(nextTimer); card.remove(); } }, 'Cancelar'), label));
      player.el.append(card);
      nextTimer = setInterval(() => { n--; label.textContent = `Siguiente en ${n} s`; if (n <= 0) { clearInterval(nextTimer); go(`/watch/${id}?ep=${info.next.id}`); } }, 1000);
    },
  });
  setCleanup(() => { clearInterval(nextTimer); player.destroy(); });
  box.append(h('div', { class: 'watch' }, player.el));
}, { layout: 'bare' });

/* ---------------------------------------------------------------- Favoritos */
route('/favorites', async ({ box, alive }) => {
  const d = await get('/api/favorites');
  if (!alive()) return;
  const grid = h('div', { class: 'grid' });
  const empty = () => h('div', { class: 'empty' }, icon('heart'), h('p', null, 'Aún no tienes favoritos. Pulsa el corazón en cualquier título para guardarlo aquí.'), h('a', { class: 'btn primary', href: '#/home' }, 'Explorar catálogo'));
  const wrap = h('div', { class: 'page' }, h('h1', null, 'Favoritos'), h('p', { class: 'sub' }, `Perfil de ${S.profile.name}`), grid);
  d.items.forEach((t) => {
    const c = posterCard(t, { onToggle: (on) => { if (!on) { c.remove(); if (!grid.children.length) wrap.append(empty()); } } });
    grid.append(c);
  });
  if (!d.items.length) wrap.append(empty());
  clear(box); box.append(wrap);
}, { layout: 'shell' });

/* ---------------------------------------------------------------- Historial */
route('/history', async ({ box, alive }) => {
  const d = await get('/api/history');
  if (!alive()) return;
  const list = h('div');
  const wrap = h('div', { class: 'page' });
  const drawEmpty = () => { clear(list); list.append(h('div', { class: 'empty' }, icon('clock'), h('p', null, 'Tu historial de reproducción está vacío.'), h('a', { class: 'btn primary', href: '#/home' }, 'Explorar catálogo'))); clearBtn.hidden = true; };
  const clearBtn = h('button', { class: 'btn danger small', onclick: async () => {
    if (!(await confirmBox('¿Borrar todo el historial de este perfil?', { okText: 'Borrar todo', danger: true }))) return;
    try { await del('/api/history'); drawEmpty(); toast('Historial borrado', 'ok'); } catch (e) { toast(e.message, 'err'); }
  } }, icon('trash'), 'Borrar historial');
  d.items.forEach((it) => {
    const p = pct(it);
    const row = h('div', { class: 'list-item' },
      h('a', { href: watchHref(it.title_id, it.episode_id) }, h('img', { src: it.backdrop_url || it.poster_url || PLACEHOLDER, alt: '', loading: 'lazy' })),
      h('div', null, h('h4', null, h('a', { href: '#/title/' + it.title_id }, it.title)),
        it.type === 'series' ? h('div', { class: 'muted', style: 'font-size:13px' }, `T${it.season} · E${it.number} — ${it.episode_name}`) : null,
        h('div', { class: 'bar' }, h('i', { style: `width:${p}%` })),
        h('div', { class: 'muted', style: 'font-size:12px' }, `${p >= 95 ? 'Visto' : Math.round(p) + '% visto'} · ${fmtDate(it.updated_at)}`)),
      h('div', { class: 'btns row-flex' },
        h('a', { class: 'btn small primary', href: watchHref(it.title_id, it.episode_id) }, icon('play', true), p >= 95 ? 'Ver de nuevo' : 'Continuar'),
        h('button', { class: 'icon-btn', 'aria-label': 'Quitar del historial', onclick: async () => {
          try { await del('/api/history/' + it.id); row.remove(); if (!list.children.length) drawEmpty(); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash'))));
    list.append(row);
  });
  wrap.append(h('div', { class: 'toolbar' }, h('div', null, h('h1', null, 'Historial'), h('p', { class: 'sub' }, `Perfil de ${S.profile.name}`)), clearBtn), list);
  if (!d.items.length) drawEmpty();
  clear(box); box.append(wrap);
}, { layout: 'shell' });

/* --------------------------------------------------------------- Mi perfil */
route('/profile', ({ box }) => {
  const wrap = h('div', { class: 'page' }, h('h1', null, 'Mi perfil'), h('p', { class: 'sub' }, 'Gestiona tu cuenta y los perfiles de quienes ven contigo'));
  // Cuenta
  const f1 = formHelper();
  const name = h('input', { id: 'acc-name', value: S.user.name, maxlength: '40', required: true });
  const b1 = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar nombre');
  const acc = h('form', { onsubmit: (e) => { e.preventDefault(); f1.run(b1, async () => { const r = await patch('/api/auth/account', { name: name.value }); S.user = r.user; toast('Nombre actualizado', 'ok'); }); } },
    f1.err, field('Nombre de la cuenta', name), field('Correo', h('input', { id: 'acc-email', value: S.user.email, disabled: true })), b1);
  // Contraseña
  const f2 = formHelper();
  const cur = h('input', { id: 'pw-cur', type: 'password', required: true, autocomplete: 'current-password' });
  const n1 = h('input', { id: 'pw-new', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' });
  const b2 = h('button', { class: 'btn primary', type: 'submit' }, 'Cambiar contraseña');
  const pw = h('form', { onsubmit: (e) => { e.preventDefault(); f2.run(b2, async () => { await patch('/api/auth/account', { currentPassword: cur.value, newPassword: n1.value }); cur.value = n1.value = ''; toast('Contraseña actualizada', 'ok'); }); } },
    f2.err, field('Contraseña actual', cur), field('Nueva contraseña', n1, 'Mínimo 8 caracteres, con letras y números'), b2);
  // Perfiles
  const plist = h('div');
  const drawP = () => {
    clear(plist);
    S.profiles.forEach((p) => plist.append(h('div', { class: 'prof-row' },
      h('span', { class: 'avatar sm', style: `background:${p.avatar_color}` }, initial(p.name)),
      h('div', { class: 'grow' }, h('b', null, p.name), S.profile && S.profile.id === p.id ? h('span', { class: 'badge-red', style: 'margin-left:8px' }, 'ACTIVO') : null),
      S.profile && S.profile.id === p.id ? null : h('button', { class: 'btn small', onclick: async () => { selectProfile(p); await loadFavs(); shell = null; toast('Perfil cambiado a ' + p.name, 'ok'); render(); } }, 'Usar'),
      h('button', { class: 'btn small', onclick: () => profileForm({ profile: p, onSaved: () => { shell = null; render(); } }) }, icon('edit'), 'Editar'),
      h('button', { class: 'btn small danger', 'aria-label': 'Eliminar perfil ' + p.name, onclick: async () => {
        if (!(await confirmBox(`¿Eliminar el perfil “${p.name}”? Se borrarán sus favoritos e historial.`, { okText: 'Eliminar', danger: true }))) return;
        try {
          await del('/api/profiles/' + p.id);
          S.profiles = S.profiles.filter((x) => x.id !== p.id);
          if (S.profile && S.profile.id === p.id) { S.profile = null; return go('/profiles'); }
          drawP();
        } catch (e) { toast(e.message, 'err'); }
      } }, icon('trash')))));
    if (S.profiles.length < 5) plist.append(h('div', { style: 'padding-top:14px' }, h('button', { class: 'btn', onclick: () => profileForm({ onSaved: drawP }) }, icon('plus'), 'Añadir perfil')));
  };
  drawP();
  // Notificaciones
  const nbox = h('div');
  const drawN = async () => {
    clear(nbox);
    const st = await pushState();
    if (st === 'unsupported') return nbox.append(h('p', { class: 'muted' }, 'Este dispositivo o navegador no admite notificaciones.'));
    if (st === 'denied') return nbox.append(h('p', { class: 'muted' }, 'Las notificaciones están bloqueadas. Actívalas en los ajustes del teléfono: Aplicaciones > CINEPLUS > Notificaciones (o en los permisos del sitio en tu navegador).'));
    const btn = h('button', { class: 'btn' + (st === 'on' ? '' : ' primary'), onclick: async () => {
      btn.disabled = true;
      try { if (st === 'on') { await disablePush(); toast('Notificaciones desactivadas en este dispositivo', 'ok'); } else { await enablePush(); toast('Notificaciones activadas', 'ok'); } } catch (e) { toast(e.message, 'err'); }
      drawN();
    } }, icon('bell'), st === 'on' ? 'Desactivar en este dispositivo' : 'Activar notificaciones');
    nbox.append(h('p', { class: 'muted', style: 'margin-bottom:12px' }, st === 'on' ? '✔ Este dispositivo recibe avisos de estrenos y novedades.' : 'Recibe un aviso cuando se agreguen películas o series nuevas.'), btn);
  };
  drawN();
  wrap.append(
    h('div', { class: 'two-col' }, h('div', { class: 'panel' }, h('h3', null, 'Cuenta'), acc), h('div', { class: 'panel' }, h('h3', null, 'Seguridad'), pw)),
    h('div', { class: 'panel' }, h('h3', null, 'Perfiles'), plist),
    h('div', { class: 'panel' }, h('h3', null, 'Notificaciones'), nbox),
    h('div', { class: 'row-flex' },
      h('a', { class: 'btn', href: '#/profiles' }, icon('swap'), 'Cambiar de perfil'),
      S.user.role === 'admin' ? h('a', { class: 'btn', href: '#/admin' }, icon('shield'), 'Panel de administración') : null,
      h('button', { class: 'btn danger', onclick: doLogout }, icon('logout'), 'Cerrar sesión')));
  box.replaceChildren(wrap);
}, { layout: 'shell', noProfile: false });

/* ------------------------------------------------------------ Administración */
route('/admin', async (ctx) => {
  const { renderAdmin } = await import('./admin.js');
  await renderAdmin(ctx, { genres: () => GENRES, refreshGenres: async () => { GENRES = (await get('/api/genres')).genres; } });
}, { layout: 'shell', admin: true });

/* --------------------------------------------------------------------- Inicio */
async function boot() {
  const splash = h('div', { class: 'splash', 'aria-label': 'Cargando CINEPLUS', role: 'img' }, h('div', { class: 'splash-play' }, icon('play', true)));
  document.body.append(splash);
  const minWait = new Promise((r) => setTimeout(r, 1500));
  let me = null;
  try { me = await get('/api/auth/me'); } catch { /* sin sesión */ }
  if (me) { setSession(me); try { await enterApp(); } catch { /* se gestionará al navegar */ } }
  await minWait;
  const { path } = parseHash();
  if (path === '/' || path === '') go(me ? (S.profile ? '/home' : '/profiles') : '/welcome', { replace: true });
  await render();
  splash.classList.add('out');
  setTimeout(() => splash.remove(), 600);
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
boot();
