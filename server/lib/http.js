'use strict';
// Mini framework HTTP sin dependencias: router, JSON, cookies, estáticos, límites de tasa.
const http = require('http');
const fs = require('fs');
const path = require('path');

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.vtt': 'text/vtt; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.webmanifest': 'application/manifest+json',
};

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
  }
  return out;
}

function setCookie(res, name, value, o = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`;
  if (o.maxAge !== undefined) c += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.secure) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

function rateLimit({ max, windowMs, name }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();
  return (req) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) h = { n: 0, reset: now + windowMs };
    h.n++;
    hits.set(key, h);
    if (h.n > max) throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.');
  };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Solicitud demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function createApp({ trustProxy = false, bodyLimit = 8 * 1024 * 1024 } = {}) {
  const routes = [];
  const statics = [];
  let baseHeaders = {};

  const app = {
    setHeaders(h) { baseHeaders = h; },
    route(method, pattern, ...chain) {
      const keys = [];
      const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
      routes.push({ method, re, keys, chain });
    },
    get: (p, ...c) => app.route('GET', p, ...c),
    post: (p, ...c) => app.route('POST', p, ...c),
    put: (p, ...c) => app.route('PUT', p, ...c),
    patch: (p, ...c) => app.route('PATCH', p, ...c),
    delete: (p, ...c) => app.route('DELETE', p, ...c),
    static(prefix, dir, { spa = false } = {}) { statics.push({ prefix, dir: path.resolve(dir), spa }); },
  };

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido');
    for (const s of statics) {
      if (!(pathname === s.prefix || pathname.startsWith(s.prefix === '/' ? '/' : s.prefix + '/'))) continue;
      const rel = s.prefix === '/' ? pathname : pathname.slice(s.prefix.length);
      if (rel.split('/').some((seg) => seg.startsWith('.'))) throw new HttpError(404, 'No encontrado'); // sin archivos ocultos
      let file = path.normalize(path.join(s.dir, rel));
      if (file !== s.dir && !file.startsWith(s.dir + path.sep)) throw new HttpError(403, 'Prohibido');
      let st = await fs.promises.stat(file).catch(() => null);
      if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = await fs.promises.stat(file).catch(() => null); }
      if (!st && s.spa && !path.extname(pathname)) { file = path.join(s.dir, 'index.html'); st = await fs.promises.stat(file).catch(() => null); }
      if (!st || !st.isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext];
      if (!type) throw new HttpError(404, 'No encontrado');
      const etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', s.prefix === '/uploads' ? 'public, max-age=86400' : 'no-cache');
      res.setHeader('Content-Type', type);
      if (s.prefix === '/uploads') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
      if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers.range;
      if (range && req.method === 'GET') {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = 0; let end = st.size - 1;
        if (m && (m[1] || m[2])) { if (m[1] === '') start = Math.max(0, st.size - Number(m[2])); else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); } }
        if (!m || start > end || start >= st.size) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${st.size}`); return res.end(); }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${st.size}`);
        res.setHeader('Content-Length', end - start + 1);
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.setHeader('Content-Length', st.size);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
      return;
    }
    throw new HttpError(404, 'No encontrado');
  }

  async function handle(req, res) {
    res.json = (obj, code) => {
      if (code) res.statusCode = code;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(obj));
    };
    for (const [k, v] of Object.entries(typeof baseHeaders === 'function' ? baseHeaders() : baseHeaders)) res.setHeader(k, v);
    const fwd = trustProxy && req.headers['x-forwarded-for'];
    req.ip = fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress;
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'URL inválida'); }
      req.path = pathname;
      req.query = Object.fromEntries(url.searchParams);
      req.cookies = parseCookies(req.headers.cookie);

      if (!pathname.startsWith('/api/')) return await serveStatic(req, res, pathname);

      let matched = null;
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (r.method !== req.method) { methodMismatch = true; continue; }
        matched = { r, m };
        break;
      }
      if (!matched) throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'Método no permitido' : 'Ruta no encontrada');
      req.params = {};
      matched.r.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(matched.m[i + 1]); });

      // Protección CSRF: las peticiones que modifican estado exigen una cabecera personalizada
      // (el navegador no la envía entre orígenes sin preflight, y no hay CORS habilitado).
      if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'cineplus') {
        throw new HttpError(403, 'Cabecera de seguridad ausente');
      }
      req.body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const raw = await readBody(req, bodyLimit);
        if (raw.length) {
          if (!String(req.headers['content-type'] || '').includes('application/json')) throw new HttpError(415, 'Se esperaba JSON');
          try { req.body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
        }
      }
      for (const fn of matched.r.chain) {
        await fn(req, res);
        if (res.writableEnded) return;
      }
      if (!res.writableEnded) res.json({ ok: true });
    } catch (e) {
      if (res.writableEnded) return;
      if (e instanceof HttpError) {
        if (req.path && req.path.startsWith('/api/')) return res.json({ error: e.message, ...(e.extra || {}) }, e.status);
        res.statusCode = e.status;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end(e.message);
      }
      console.error('[error]', req.method, req.url, e);
      res.json({ error: 'Error interno del servidor' }, 500);
    }
  }

  app.listen = (port, cb) => http.createServer(handle).listen(port, cb);
  app.server = () => http.createServer(handle);
  return app;
}

module.exports = { createApp, HttpError, setCookie, rateLimit, MIME };
