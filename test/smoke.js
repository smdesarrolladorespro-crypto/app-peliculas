'use strict';
// Prueba de humo de la API: arranca el servidor con una base de datos temporal y verifica
// autenticación, rutas privadas, roles, validación de fuentes, favoritos e historial.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cineplus-'));
process.env.DATA_DIR = tmp;
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ADMIN_PASSWORD = 'Admin12345';
process.env.NODE_ENV = 'test';

const { seed } = require('../server/seed');
const { build } = require('../server/index');

let base;
let srv;
test.before(async () => {
  await seed();
  srv = build().server();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  let profile = '';
  const call = async (method, url, body, extra = {}) => {
    const headers = { 'X-Requested-With': 'cineplus', ...extra };
    if (cookie) headers.Cookie = cookie;
    if (profile) headers['X-Profile-Id'] = profile;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let data = null; try { data = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, data, headers: r.headers };
  };
  return { call, setProfile: (id) => { profile = String(id); } };
}

test('rutas privadas exigen sesión', async () => {
  const c = client();
  for (const u of ['/api/home', '/api/titles', '/api/favorites', '/api/history', '/api/admin/stats', '/api/auth/me']) {
    assert.equal((await c.call('GET', u)).status, 401, u);
  }
});

test('CSRF: las peticiones que modifican datos exigen la cabecera de seguridad', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('registro, validaciones, login, sesión y logout', async () => {
  const c = client();
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'A', email: 'x', password: '1' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@example.com', password: 'sololetras' })).status, 400);
  const reg = await c.call('POST', '/api/auth/register', { name: 'Ana', email: 'ana@example.com', password: 'Clave12345', remember: true });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.profiles.length, 1);
  assert.match(reg.headers.get('set-cookie'), /HttpOnly/);
  assert.match(reg.headers.get('set-cookie'), /Max-Age=/);
  assert.equal((await c.call('POST', '/api/auth/register', { name: 'Ana', email: 'ANA@example.com', password: 'Clave12345' })).status, 409);
  assert.equal((await c.call('GET', '/api/auth/me')).status, 200);
  await c.call('POST', '/api/auth/logout');
  const c2 = client();
  assert.equal((await c2.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'mala' })).status, 401);
  assert.equal((await c2.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Clave12345' })).status, 200);
  assert.equal((await c2.call('GET', '/api/auth/me')).data.user.email, 'ana@example.com');
});

test('la contraseña no se guarda en claro y el JWT manipulado se rechaza', async () => {
  const { q } = require('../server/db');
  const row = q.get('SELECT password_hash FROM users WHERE email = ?', 'ana@example.com');
  assert.match(row.password_hash, /^scrypt\$/);
  assert.ok(!row.password_hash.includes('Clave12345'));
  const c = client();
  await c.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Clave12345' });
  const bad = await fetch(base + '/api/auth/me', { headers: { Cookie: 'cp_token=aaa.bbb.ccc' } });
  assert.equal(bad.status, 401);
});

test('usuario normal no accede a la administración', async () => {
  const c = client();
  await c.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Clave12345' });
  assert.equal((await c.call('GET', '/api/admin/stats')).status, 403);
  assert.equal((await c.call('POST', '/api/admin/titles', { type: 'movie', title: 'X' })).status, 403);
  assert.equal((await c.call('GET', '/api/admin/users')).status, 403);
});

test('catálogo, búsqueda y detalle', async () => {
  const c = client();
  await c.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Clave12345' });
  const home = await c.call('GET', '/api/home');
  assert.ok(home.data.featured.length > 0 && home.data.popular.length > 0 && home.data.genres.length > 0);
  const s = await c.call('GET', '/api/titles?q=sintel');
  assert.equal(s.data.items[0].title, 'Sintel');
  const t = await c.call('GET', '/api/titles?genre=terror');
  assert.ok(t.data.items.every((x) => x.genres.includes('terror')));
  const ser = (await c.call('GET', '/api/titles?type=series')).data.items[0];
  const d = await c.call('GET', '/api/titles/' + ser.id);
  assert.equal(d.data.seasons.length, 2);
  assert.ok(!JSON.stringify(d.data).includes('video_url'), 'el detalle no expone URLs de video');
  // búsqueda con caracteres de LIKE no rompe nada
  assert.equal((await c.call('GET', '/api/titles?q=' + encodeURIComponent("100%_'\\"))).status, 200);
});

test('favoritos e historial por perfil', async () => {
  const c = client();
  const login = await c.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'Clave12345' });
  assert.equal((await c.call('GET', '/api/favorites')).status, 400, 'requiere perfil');
  const p1 = login.data.profiles[0].id;
  c.setProfile(p1);
  const movie = (await c.call('GET', '/api/titles?type=movie')).data.items[0];
  assert.equal((await c.call('PUT', '/api/favorites/' + movie.id)).status, 200);
  assert.deepEqual((await c.call('GET', '/api/favorites')).data.ids, [movie.id]);
  await c.call('POST', '/api/history', { titleId: movie.id, position: 42, duration: 100 });
  await c.call('POST', '/api/history', { titleId: movie.id, position: 60, duration: 100 });
  const h = (await c.call('GET', '/api/history')).data.items;
  assert.equal(h.length, 1);
  assert.equal(h[0].position, 60);
  assert.equal((await c.call('GET', '/api/continue')).data.items.length, 1);
  // otro perfil de la misma cuenta empieza vacío
  const p2 = (await c.call('POST', '/api/profiles', { name: 'Peque' })).data.profile;
  c.setProfile(p2.id);
  assert.equal((await c.call('GET', '/api/history')).data.items.length, 0);
  assert.equal((await c.call('GET', '/api/favorites')).data.ids.length, 0);
  // no se puede usar el perfil de otro usuario
  const other = client();
  await other.call('POST', '/api/auth/register', { name: 'Otro', email: 'otro@example.com', password: 'Clave12345' });
  other.setProfile(p1);
  assert.equal((await other.call('GET', '/api/favorites')).status, 400);
  // episodio inválido
  const ser = (await c.call('GET', '/api/titles?type=series')).data.items[0];
  assert.equal((await c.call('POST', '/api/history', { titleId: ser.id, episodeId: 999999, position: 1, duration: 2 })).status, 400);
});

test('recuperar contraseña: token de un solo uso', async () => {
  const c = client();
  const r = await c.call('POST', '/api/auth/forgot', { email: 'ana@example.com' });
  assert.equal(r.status, 200);
  const token = r.data.devLink.split('/').pop();
  const unknown = await c.call('POST', '/api/auth/forgot', { email: 'noexiste@example.com' });
  assert.equal(unknown.status, 200);
  assert.equal(unknown.data.devLink, undefined, 'no revela si el correo existe');
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'corta' })).status, 400);
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'NuevaClave789' })).status, 200);
  assert.equal((await c.call('POST', '/api/auth/reset', { token, password: 'OtraClave789' })).status, 400, 'segundo uso rechazado');
  assert.equal((await c.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'NuevaClave789' })).status, 200);
});

test('administración: fuentes autorizadas, destacados, episodios y usuarios', async () => {
  const a = client();
  assert.equal((await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' })).status, 200);
  const bad = await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Pirata', video_type: 'mp4', video_url: 'https://sitio-pirata.example.com/p.mp4' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /autorizadas/);
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'HTTP', video_type: 'mp4', video_url: 'http://archive.org/x.mp4' })).status, 400);
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'JS', video_type: 'mp4', video_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Img', poster_url: 'javascript:alert(1)' })).status, 400);
  const ok = await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Legal', year: 2020, genres: ['drama'], video_type: 'mp4', video_url: 'https://archive.org/download/x/y.mp4', featured: true });
  assert.equal(ok.status, 201);
  const id = ok.data.title.id;
  assert.equal((await a.call('PUT', '/api/admin/titles/' + id, { title: 'Legal 2', genres: ['drama', 'comedia'], video_type: 'mp4', video_url: 'https://archive.org/download/x/y.mp4' })).data.title.genres.length, 2);
  assert.equal((await a.call('PATCH', `/api/admin/titles/${id}/featured`, { featured: false })).status, 200);
  const s = await a.call('POST', '/api/admin/titles', { type: 'series', title: 'Serie' });
  const sid = s.data.title.id;
  assert.equal((await a.call('POST', `/api/admin/titles/${sid}/episodes`, { season: 1, number: 1, name: 'Piloto', video_type: 'mp4', video_url: 'https://download.blender.org/a.mp4' })).status, 201);
  assert.equal((await a.call('POST', `/api/admin/titles/${sid}/episodes`, { season: 1, number: 1, name: 'Duplicado' })).status, 409);
  assert.equal((await a.call('POST', `/api/admin/titles/${id}/episodes`, { season: 1, number: 1, name: 'En película' })).status, 400);
  // subida: rechaza contenido que no es imagen
  assert.equal((await a.call('POST', '/api/admin/upload', { filename: 'x.jpg', data: Buffer.from('<script>alert(1)</script>').toString('base64') })).status, 400);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
  const up = await a.call('POST', '/api/admin/upload', { filename: 'p.png', data: png.toString('base64') });
  assert.equal(up.status, 200);
  assert.match(up.data.url, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await fetch(base + up.data.url)).status, 200);
  // usuarios
  const users = (await a.call('GET', '/api/admin/users')).data.users;
  const ana = users.find((u) => u.email === 'ana@example.com');
  const adminSelf = users.find((u) => u.role === 'admin');
  assert.equal((await a.call('PATCH', '/api/admin/users/' + adminSelf.id, { status: 'blocked' })).status, 400, 'no puede bloquearse a sí mismo');
  assert.equal((await a.call('PATCH', '/api/admin/users/' + ana.id, { status: 'blocked' })).status, 200);
  const blocked = client();
  assert.equal((await blocked.call('POST', '/api/auth/login', { email: 'ana@example.com', password: 'NuevaClave789' })).status, 403);
  // reproducción: la película legal recién creada y un episodio sin fuente
  const user = client();
  await user.call('POST', '/api/auth/login', { email: 'otro@example.com', password: 'Clave12345' });
  const w = await user.call('GET', '/api/watch/' + id);
  assert.equal(w.status, 200);
  assert.equal(w.data.source.type, 'mp4');
});

test('archivos estáticos: sin recorrido de rutas ni archivos ocultos', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
  assert.equal((await fetch(base + '/.env')).status, 404);
  const raw = await fetch(base + '/%2e%2e/server/config.js');
  assert.notEqual(raw.status, 200);
  const trav = await fetch(base + '/uploads/..%2f..%2fcineplus.db');
  assert.notEqual(trav.status, 200);
});

test('importador de Internet Archive (respuestas simuladas)', async () => {
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.startsWith('https://archive.org/')) return realFetch(url, opts);
    calls.push(u);
    if (u.includes('/advancedsearch.php')) {
      return new Response(JSON.stringify({ response: { docs: [
        { identifier: 'night_of_the_living_dead', title: 'Night of the Living Dead', year: '1968', description: '<p>Zombies &amp; m&aacute;s</p>', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' },
        { identifier: '../malo', title: 'Identificador inválido' },
      ] } }));
    }
    if (u.includes('/metadata/night_of_the_living_dead')) {
      return new Response(JSON.stringify({
        metadata: { title: 'Night of the Living Dead', description: ['<b>Clásico</b> de terror'], date: '1968-10-01', runtime: '01:36:00', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' },
        files: [
          { name: 'night.ogv', format: 'Ogg Video', size: '1000' },
          { name: 'night_512kb.mp4', format: '512Kb MPEG4', size: '90000000' },
          { name: 'sub dir/night.mp4', format: 'h.264', size: '400000000' },
        ],
      }));
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const a = client();
    await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
    const s = await a.call('GET', '/api/admin/archive/search?q=' + encodeURIComponent('night "of" (the)') + '&collection=feature_films');
    assert.equal(s.status, 200);
    assert.equal(s.data.items.length, 1, 'descarta identificadores inválidos');
    assert.equal(s.data.items[0].poster_url, 'https://archive.org/services/img/night_of_the_living_dead');
    assert.equal(s.data.items[0].overview, 'Zombies & más');
    assert.equal(new URL(calls[0]).searchParams.get('q'), 'mediatype:movies AND collection:feature_films AND title:(night of the)', 'se sanean los caracteres especiales de la consulta');
    assert.equal((await a.call('GET', '/api/admin/archive/search?q=')).status, 400);
    const it = await a.call('GET', '/api/admin/archive/item?id=night_of_the_living_dead');
    assert.equal(it.status, 200);
    assert.equal(it.data.item.files[0].format, 'h.264', 'prefiere H.264');
    assert.equal(it.data.item.files[0].url, 'https://archive.org/download/night_of_the_living_dead/sub%20dir/night.mp4');
    assert.equal(it.data.item.runtime, 96);
    assert.equal(it.data.item.year, 1968);
    assert.equal(it.data.item.overview, 'Clásico de terror');
    assert.equal(it.data.item.files.length, 2, 'solo MP4');
    assert.equal((await a.call('GET', '/api/admin/archive/item?id=' + encodeURIComponent('../etc/passwd'))).status, 400);
    // la URL importada pasa la validación de fuentes autorizadas
    const saved = await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Night', poster_url: it.data.item.poster_url, video_type: 'mp4', video_url: it.data.item.files[0].url });
    assert.equal(saved.status, 201);
    // un usuario normal no puede usarlo
    const u = client();
    await u.call('POST', '/api/auth/login', { email: 'otro@example.com', password: 'Clave12345' });
    assert.equal((await u.call('GET', '/api/admin/archive/search?q=x')).status, 403);
  } finally { global.fetch = realFetch; }
});

test('dominios autorizados gestionados desde el panel', async () => {
  const a = client();
  await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
  const url = 'https://cine-libre.example.org/pelicula.mp4';
  // 1) sitio nuevo: el servidor lo rechaza con un código que el panel usa para ofrecer autorizarlo
  const bad = await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Libre', video_type: 'mp4', video_url: url });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.code, 'host_not_allowed');
  assert.equal(bad.data.host, 'cine-libre.example.org');
  // 2) validación de dominios
  for (const x of ['', 'localhost', '192.168.1.5', 'miservidor.local', 'com.co', 'solo-una-palabra', 'a b.com']) {
    assert.equal((await a.call('POST', '/api/admin/hosts', { host: x })).status, 400, `rechaza "${x}"`);
  }
  // 3) autorizar pegando un enlace completo (se normaliza al dominio)
  const add = await a.call('POST', '/api/admin/hosts', { host: 'https://www.Cine-Libre.example.org/pelicula.mp4', note: 'prueba' });
  assert.equal(add.status, 201);
  assert.ok(add.data.hosts.some((x) => x.host === 'cine-libre.example.org' && x.origin === 'custom' && x.enabled));
  assert.equal((await a.call('POST', '/api/admin/hosts', { host: 'cine-libre.example.org' })).status, 409);
  const ok = await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Libre', video_type: 'mp4', video_url: url });
  assert.equal(ok.status, 201);
  const id = ok.data.title.id;
  // los subdominios también quedan cubiertos
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'Sub', video_type: 'mp4', video_url: 'https://cdn.cine-libre.example.org/x.mp4' })).status, 201);
  // 4) el CSP incluye el nuevo dominio para iframes
  const csp = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(csp, /https:\/\/\*\.cine-libre\.example\.org/);
  // 5) reproducción permitida mientras el dominio esté autorizado...
  const user = client();
  await user.call('POST', '/api/auth/login', { email: 'otro@example.com', password: 'Clave12345' });
  assert.equal((await user.call('GET', '/api/watch/' + id)).status, 200);
  // ...y bloqueada al quitarlo
  assert.equal((await a.call('DELETE', '/api/admin/hosts/cine-libre.example.org')).status, 200);
  const blocked = await user.call('GET', '/api/watch/' + id);
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.error, /ya no está autorizada/);
  assert.ok(!(await fetch(base + '/')).headers.get('content-security-policy').includes('cine-libre'));
  // 6) los dominios por defecto no se eliminan, pero sí se desactivan y reactivan
  assert.equal((await a.call('DELETE', '/api/admin/hosts/archive.org')).status, 400);
  assert.equal((await a.call('PATCH', '/api/admin/hosts/vimeo.com', { enabled: false })).status, 200);
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'V', video_type: 'mp4', video_url: 'https://vimeo.com/x.mp4' })).data.code, 'host_not_allowed');
  assert.equal((await a.call('PATCH', '/api/admin/hosts/vimeo.com', { enabled: true })).status, 200);
  assert.equal((await a.call('POST', '/api/admin/titles', { type: 'movie', title: 'V', video_type: 'mp4', video_url: 'https://vimeo.com/x.mp4' })).status, 201);
  // 7) solo administradores
  assert.equal((await user.call('GET', '/api/admin/hosts')).status, 403);
  assert.equal((await user.call('POST', '/api/admin/hosts', { host: 'pirata.example.com' })).status, 403);
});

/* ------------------------------------------------ Producción: correo, push y copias */
const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const collect = (req) => new Promise((r) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => r(Buffer.concat(ch))); });

test('correo: la recuperación de contraseña se envía por la API del proveedor', async () => {
  process.env.BREVO_API_KEY = 'clave-de-prueba';
  process.env.MAIL_FROM = 'FLIXOR <cine@example.com>';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.brevo.com')) { calls.push({ url: String(url), opts }); return new Response('{}', { status: 201 }); }
    return realFetch(url, opts);
  };
  try {
    const c = client();
    assert.equal((await c.call('POST', '/api/auth/register', { name: 'Mail', email: 'mail@example.com', password: 'Clave12345' })).status, 201);
    assert.equal((await c.call('POST', '/api/auth/forgot', { email: 'noexiste2@example.com' })).status, 200);
    assert.equal((await c.call('POST', '/api/auth/forgot', { email: 'mail@example.com' })).status, 200);
    for (let i = 0; i < 20 && !calls.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1, 'solo se envía correo si la cuenta existe');
    assert.equal(calls[0].opts.headers['api-key'], 'clave-de-prueba');
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.sender.email, 'cine@example.com');
    assert.equal(body.to[0].email, 'mail@example.com');
    assert.match(body.htmlContent, /#\/reset\//);
    assert.match(body.textContent, /#\/reset\//);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.BREVO_API_KEY; delete process.env.MAIL_FROM;
  }
});

test('push: suscripción validada y mensaje cifrado que el dispositivo puede descifrar', async () => {
  const got = [];
  let status = 201;
  const pushSrv = http.createServer(async (req, res) => { got.push({ headers: req.headers, body: await collect(req) }); res.statusCode = status; res.end(); });
  const port = await listen(pushSrv);
  const endpoint = `http://127.0.0.1:${port}/push/dispositivo-1`;
  const ua = crypto.createECDH('prime256v1');
  const uaPub = ua.generateKeys();
  const authSecret = crypto.randomBytes(16);
  const keys = { p256dh: uaPub.toString('base64url'), auth: authSecret.toString('base64url') };

  const u = client();
  assert.equal((await u.call('POST', '/api/auth/register', { name: 'Push', email: 'push@example.com', password: 'Clave12345' })).status, 201);
  const key = (await u.call('GET', '/api/push/key')).data.key;
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  for (const bad of ['https://169.254.169.254/latest', 'http://10.0.0.5/x', 'https://evil.example.com/push', 'nada']) {
    assert.equal((await u.call('POST', '/api/push/subscribe', { endpoint: bad, keys })).status, 400, bad);
  }
  assert.equal((await u.call('POST', '/api/push/subscribe', { endpoint, keys: { p256dh: 'AAAA', auth: keys.auth } })).status, 400);
  assert.equal((await u.call('POST', '/api/push/subscribe', { endpoint, keys })).status, 200);
  assert.equal((await u.call('POST', '/api/admin/push/send', { title: 'Hola' })).status, 403, 'solo el administrador envía avisos');

  const { q } = require('../server/db');
  const titleId = q.get('SELECT id FROM titles LIMIT 1').id;
  const a = client();
  await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
  assert.equal((await a.call('POST', '/api/admin/push/send', { title: '', body: 'x' })).status, 400);
  const r = await a.call('POST', '/api/admin/push/send', { title: 'Nueva película', body: 'Ya disponible', titleId });
  assert.equal(r.status, 200);
  assert.equal(r.data.sent, 1);
  assert.equal(got.length, 1);

  // Descifrado en el lado del dispositivo (RFC 8291)
  const { headers, body } = got[0];
  assert.equal(headers['content-encoding'], 'aes128gcm');
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const secret = ua.computeSecret(asPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'delimitador de relleno');
  const msg = JSON.parse(plain.subarray(0, plain.length - 1).toString());
  assert.equal(msg.title, 'Nueva película');
  assert.equal(msg.url, `/#/title/${titleId}`);

  // Firma VAPID verificable con la clave pública publicada
  const m = headers.authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, 'cabecera VAPID');
  assert.equal(m[4], key);
  const pub = Buffer.from(key, 'base64url');
  const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), 'firma ES256 válida');
  assert.equal(JSON.parse(Buffer.from(m[2], 'base64url')).aud, `http://127.0.0.1:${port}`);

  // Un dispositivo dado de baja (410) se elimina solo
  status = 410;
  const r2 = await a.call('POST', '/api/admin/push/send', { title: 'Otra', body: '' });
  assert.equal(r2.data.removed, 1);
  assert.equal(q.get('SELECT COUNT(*) n FROM push_subscriptions').n, 0);
  pushSrv.close();
});

test('copias de seguridad: se suben, se restauran en un servidor nuevo y un fallo no deja arrancar vacío', async () => {
  const store = new Map();
  let failGets = false;
  let signed = 0;
  const s3 = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const key = decodeURIComponent(url.pathname.split('/').slice(2).join('/'));
    if (/^AWS4-HMAC-SHA256 Credential=KEY\//.test(req.headers.authorization || '')) signed++;
    if (req.method === 'PUT') { store.set(key, await collect(req)); return res.end(); }
    if (req.method === 'DELETE') { store.delete(key); return res.end(); }
    if (failGets) { res.statusCode = 500; return res.end('boom'); }
    if (!key) {
      const prefix = url.searchParams.get('prefix') || '';
      return res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...store.keys()].filter((k) => k.startsWith(prefix)).map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}</ListBucketResult>`);
    }
    if (!store.has(key)) { res.statusCode = 404; return res.end('<Error/>'); }
    res.end(store.get(key));
  });
  const port = await listen(s3);
  Object.assign(process.env, { BACKUP_S3_ENDPOINT: `http://127.0.0.1:${port}`, BACKUP_S3_BUCKET: 'b', BACKUP_S3_KEY_ID: 'KEY', BACKUP_S3_SECRET: 'SECRET' });
  try {
    const backup = require('../server/backup');
    const { UPLOAD_DIR } = require('../server/config');
    fs.writeFileSync(path.join(UPLOAD_DIR, 'portada.png'), Buffer.from('imagen-falsa'));
    store.set('daily/cineplus-2020-01-01.db', Buffer.from('vieja'));
    await backup.backupNow();
    assert.equal(store.has('daily/cineplus-2020-01-01.db'), false, 'las copias de más de 30 días se eliminan');
    assert.ok(store.has('cineplus.db') && store.has('uploads/portada.png'));
    assert.ok([...store.keys()].some((k) => k.startsWith('daily/')));
    assert.ok(signed >= 3, 'las peticiones van firmadas');
    assert.equal(backup.status().lastError, null);

    // Servidor nuevo (sin datos): restaura usuarios y archivos subidos
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'cineplus-restore-'));
    const out = await backup.restore({ dbPath: path.join(fresh, 'x.db'), uploadDir: path.join(fresh, 'up') });
    assert.equal(out.restored, true);
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(path.join(fresh, 'x.db'));
    assert.ok(copy.prepare("SELECT COUNT(*) n FROM users WHERE email = 'admin@cineplus.local'").get().n === 1);
    assert.ok(copy.prepare('SELECT COUNT(*) n FROM titles').get().n > 0);
    copy.close();
    assert.equal(fs.readFileSync(path.join(fresh, 'up', 'portada.png'), 'utf8'), 'imagen-falsa');

    // Si ya hay base de datos local, no se pisa
    const again = await backup.restore({ dbPath: path.join(fresh, 'x.db'), uploadDir: path.join(fresh, 'up') });
    assert.equal(again.restored, false);

    // Si el almacenamiento falla, NO se arranca vacío (para no sobrescribir la copia buena)
    failGets = true;
    await assert.rejects(backup.restore({ dbPath: path.join(fresh, 'otra.db'), uploadDir: path.join(fresh, 'up2') }), /S3 GET/);
    assert.equal(fs.existsSync(path.join(fresh, 'otra.db')), false);
    fs.rmSync(fresh, { recursive: true, force: true });
  } finally {
    for (const k of ['BACKUP_S3_ENDPOINT', 'BACKUP_S3_BUCKET', 'BACKUP_S3_KEY_ID', 'BACKUP_S3_SECRET']) delete process.env[k];
    s3.close();
  }
});

test('la firma AWS SigV4 coincide con el ejemplo oficial de AWS', () => {
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const r = require('../server/backup')._sign({
    method: 'GET', host: 'examplebucket.s3.amazonaws.com', uri: '/test.txt', payloadHash: empty, amzDate: '20130524T000000Z',
    headers: { Range: 'bytes=0-9', 'x-amz-content-sha256': empty, 'x-amz-date': '20130524T000000Z' },
    region: 'us-east-1', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  });
  assert.equal(r.signature, 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

test('anime: se marca en el panel, tiene su sección y no se mezcla con Películas ni Series', async () => {
  const a = client();
  await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
  const mk = async (title, type, anime) => (await a.call('POST', '/api/admin/titles', { type, title, overview: 'x', anime, genres: [] })).data.title;
  const an1 = await mk('Anime de prueba', 'series', true);
  const mv = await mk('Pelicula normal de prueba', 'movie', false);
  assert.equal(an1.anime, true);
  assert.equal(mv.anime, false);
  const only = (await a.call('GET', '/api/titles?anime=1&limit=100')).data.items.map((t) => t.title);
  assert.ok(only.includes('Anime de prueba') && !only.includes('Pelicula normal de prueba'));
  const noAnime = (await a.call('GET', '/api/titles?type=series&anime=0&limit=100')).data.items.map((t) => t.title);
  assert.ok(!noAnime.includes('Anime de prueba'));
  const home = (await a.call('GET', '/api/home')).data;
  assert.ok(home.anime.some((t) => t.title === 'Anime de prueba'));
  assert.ok(!home.series.some((t) => t.title === 'Anime de prueba'));
  // se puede quitar la marca
  const edited = await a.call('PUT', `/api/admin/titles/${an1.id}`, { type: 'series', title: 'Anime de prueba', overview: 'x', anime: false, genres: [] });
  assert.equal(edited.data.title.anime, false);
  assert.ok((await a.call('GET', '/api/admin/stats')).data.anime >= 0);
});

test('sugerencias: se validan, se guardan, se envían al correo del equipo y el admin las gestiona', async () => {
  process.env.BREVO_API_KEY = 'k'; process.env.MAIL_FROM = 'FLIXOR <cine@example.com>';
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.brevo.com')) { calls.push(JSON.parse(opts.body)); return new Response('{}', { status: 201 }); }
    return realFetch(url, opts);
  };
  try {
    const u = client();
    assert.equal((await u.call('POST', '/api/suggestions', { kind: 'anime', title: 'X' })).status, 401, 'requiere sesión');
    assert.equal((await u.call('POST', '/api/auth/register', { name: 'Fan', email: 'fan@example.com', password: 'Clave12345' })).status, 201);
    assert.equal((await u.call('POST', '/api/suggestions', { kind: 'otro', title: 'X' })).status, 400);
    assert.equal((await u.call('POST', '/api/suggestions', { kind: 'anime', title: '' })).status, 400);
    assert.equal((await u.call('POST', '/api/suggestions', { kind: 'comment', note: '' })).status, 400);
    assert.equal((await u.call('POST', '/api/suggestions', { kind: 'anime', title: 'Cowboy Bebop', note: 'Por favor' })).status, 200);
    for (let i = 0; i < 20 && !calls.length; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to[0].email, 'sm.desarrolladores.pro@gmail.com');
    assert.match(calls[0].subject, /Anime — Cowboy Bebop/);
    assert.match(calls[0].textContent, /Enviado por: Fan/);
    assert.equal((await u.call('GET', '/api/admin/suggestions')).status, 403);
    const a = client();
    await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
    const list = (await a.call('GET', '/api/admin/suggestions')).data.items;
    const it = list.find((x) => x.title === 'Cowboy Bebop');
    assert.ok(it && it.kind === 'anime' && it.done === false);
    assert.equal((await a.call('PATCH', `/api/admin/suggestions/${it.id}`, { done: true })).status, 200);
    assert.equal((await a.call('DELETE', `/api/admin/suggestions/${it.id}`)).status, 200);
    assert.ok(!(await a.call('GET', '/api/admin/suggestions')).data.items.some((x) => x.id === it.id));
  } finally {
    globalThis.fetch = realFetch; delete process.env.BREVO_API_KEY; delete process.env.MAIL_FROM;
  }
});

test('eliminar cuenta: pide la contraseña, borra los datos y el único administrador no puede', async () => {
  const { q } = require('../server/db');
  const u = client();
  assert.equal((await u.call('POST', '/api/auth/register', { name: 'Adios', email: 'adios@example.com', password: 'Clave12345' })).status, 201);
  const me = (await u.call('GET', '/api/auth/me')).data;
  const uid = me.user.id;
  assert.ok(q.get('SELECT COUNT(*) n FROM profiles WHERE user_id = ?', uid).n >= 1);
  assert.equal((await u.call('POST', '/api/auth/delete-account', { password: 'incorrecta1' })).status, 400);
  assert.equal((await u.call('POST', '/api/auth/delete-account', { password: 'Clave12345' })).status, 200);
  assert.equal(q.get('SELECT COUNT(*) n FROM users WHERE id = ?', uid).n, 0);
  assert.equal(q.get('SELECT COUNT(*) n FROM profiles WHERE user_id = ?', uid).n, 0);
  assert.equal((await u.call('GET', '/api/auth/me')).status, 401, 'la sesión queda cerrada');
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'adios@example.com', password: 'Clave12345' })).status, 401);
  const a = client();
  await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
  assert.equal((await a.call('POST', '/api/auth/delete-account', { password: 'Admin12345' })).status, 400, 'único administrador');
});

test('importador de páginas: solo fuentes autorizadas, respeta robots.txt y extrae datos estándar', async () => {
  const scrape = require('../server/scrape');
  const html = `<html><head><title>Catálogo</title>
    <meta property="og:description" content="Cine abierto"><meta property="og:image" content="/img/p.jpg">
    <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
      {"@type":"Movie","name":"Película Uno","description":"Sinopsis uno","datePublished":"1922-03-04","image":"https://media.libre.test/uno.jpg",
       "video":{"@type":"VideoObject","name":"Película Uno","duration":"PT1H30M","contentUrl":"https://media.libre.test/uno.mp4"}},
      {"@type":"VideoObject","name":"Corto","embedUrl":"https://www.youtube.com/embed/abcdefghijk"}]}</script></head>
    <body><video><source src="/v/dos.m3u8" type="application/x-mpegURL"></video>
    <a href="https://otro-sitio.test/ajeno.mp4">ajeno</a><a href="/serie/ep1">Episodio 1</a><a href="/serie/ep2">Episodio 2</a><a href="/foto.jpg">img</a></body></html>`;
  const pages = {
    'https://libre.test/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /privado\nAllow: /privado/ok' },
    'https://libre.test/catalogo': { status: 200, body: html },
    'https://libre.test/serie/ep1': { status: 200, body: '<meta property="og:title" content="Ep 1"><video src="https://media.libre.test/e1.mp4"></video>' },
    'https://libre.test/serie/ep2': { status: 404, body: '' },
    'https://libre.test/feed.xml': { status: 200, ct: 'application/rss+xml', body: `<?xml version="1.0"?><rss xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Feed</title>
      <item><title><![CDATA[Cortometraje]]></title><description>Un corto</description><link>https://libre.test/c1</link><pubDate>Mon, 01 Jan 2018 00:00:00 GMT</pubDate>
      <enclosure url="https://media.libre.test/c1.mp4" type="video/mp4"/><media:thumbnail url="https://media.libre.test/c1.jpg"/></item></channel></rss>` },
    'https://libre.test/privado/x': { status: 200, body: '<video src="https://media.libre.test/x.mp4"></video>' },
  };
  scrape._setFetcher(async (u) => { const p = pages[u]; if (!p) return { status: 404, headers: {}, body: Buffer.from('') }; return { status: p.status, headers: { 'content-type': p.ct || 'text/html' }, body: Buffer.from(p.body) }; });
  scrape._setDelay(0);
  const a = client();
  await a.call('POST', '/api/auth/login', { email: 'admin@cineplus.local', password: 'Admin12345' });
  try {
    // dominio no autorizado: se pide autorizarlo primero
    let r = await a.call('POST', '/api/admin/scrape/analyze', { url: 'https://libre.test/catalogo' });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'host_not_allowed'); assert.equal(r.data.host, 'libre.test');
    assert.equal((await a.call('POST', '/api/admin/scrape/analyze', { url: 'http://libre.test/catalogo' })).status, 400, 'solo HTTPS');
    assert.equal((await a.call('POST', '/api/admin/scrape/analyze', { url: 'nada' })).status, 400);
    assert.equal((await client().call('POST', '/api/admin/scrape/analyze', { url: 'https://libre.test/' })).status, 401);
    for (const host of ['libre.test', 'media.libre.test']) assert.equal((await a.call('POST', '/api/admin/hosts', { host, note: 'prueba' })).status < 300, true);

    r = await a.call('POST', '/api/admin/scrape/analyze', { url: 'https://libre.test/catalogo' });
    assert.equal(r.status, 200);
    const byUrl = Object.fromEntries(r.data.candidates.map((c) => [c.video_url, c]));
    const uno = byUrl['https://media.libre.test/uno.mp4'];
    assert.ok(uno && uno.title === 'Película Uno' && uno.year === 1922 && uno.runtime === 90 && uno.video_type === 'mp4');
    assert.equal(uno.poster_url, 'https://media.libre.test/uno.jpg');
    assert.equal(byUrl['https://www.youtube.com/embed/abcdefghijk'].video_type, 'youtube');
    assert.equal(byUrl['https://libre.test/v/dos.m3u8'].video_type, 'hls');
    assert.equal(byUrl['https://libre.test/v/dos.m3u8'].overview, 'Cine abierto');
    assert.ok(!byUrl['https://otro-sitio.test/ajeno.mp4'], 'no se importan videos de dominios no autorizados');
    assert.deepEqual(r.data.skipped, [{ host: 'otro-sitio.test', count: 1 }]);
    assert.deepEqual(r.data.links.map((l) => l.url), ['https://libre.test/serie/ep1', 'https://libre.test/serie/ep2']);

    // explorar páginas enlazadas (una falla y se informa)
    r = await a.call('POST', '/api/admin/scrape/expand', { urls: ['https://libre.test/serie/ep1', 'https://libre.test/serie/ep2'] });
    assert.equal(r.status, 200);
    assert.equal(r.data.candidates.length, 1); assert.equal(r.data.candidates[0].title, 'Ep 1');
    assert.equal(r.data.errors.length, 1);
    assert.equal((await a.call('POST', '/api/admin/scrape/expand', { urls: [] })).status, 400);

    // feed RSS
    r = await a.call('POST', '/api/admin/scrape/analyze', { url: 'https://libre.test/feed.xml' });
    assert.equal(r.data.kind, 'feed');
    assert.deepEqual([r.data.candidates[0].title, r.data.candidates[0].year, r.data.candidates[0].poster_url], ['Cortometraje', 2018, 'https://media.libre.test/c1.jpg']);

    // robots.txt
    r = await a.call('POST', '/api/admin/scrape/analyze', { url: 'https://libre.test/privado/x' });
    assert.equal(r.status, 403); assert.match(r.data.error || r.data.message || '', /robots/);
  } finally { scrape._setFetcher(null); scrape._setDelay(400); }
});

test('importador: robots.txt (reglas más específicas) y bloqueo de direcciones internas', () => {
  const { parseRobots, isPrivateIp } = require('../server/scrape');
  const ok = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\n');
  assert.equal(ok('/a/c'), false); assert.equal(ok('/a/b'), true); assert.equal(ok('/z'), true);
  assert.equal(ok('/x.pdf'), false); assert.equal(ok('/x.pdf?v=1'), true);
  assert.equal(parseRobots('User-agent: *\nDisallow: /')('/cualquier'), false);
  assert.equal(parseRobots('User-agent: otro\nDisallow: /')('/cualquier'), true);
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '151.101.1.1', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip);
});

test('el catálogo inicial se carga una sola vez: lo que el administrador borra no reaparece', async () => {
  const { q } = require('../server/db');
  q.run('DELETE FROM titles');
  await seed();
  assert.equal(q.get('SELECT COUNT(*) n FROM titles').n, 0);
});
