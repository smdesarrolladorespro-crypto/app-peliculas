'use strict';
// Importador desde una página o feed público.
//
// Lee de una página los datos que el propio sitio publica en formatos estándar para que otros los usen
// (JSON-LD de schema.org, etiquetas Open Graph, <video>/<source>, RSS/Atom y sitemaps de video) y propone
// una lista de títulos para que el administrador elija cuáles importar. Reglas de seguridad:
//   · Acepta cualquier dominio público HTTPS, salvo los bloqueados expresamente por administración.
//   · Respeta robots.txt del sitio, se identifica como FLIXOR-Importer y va despacio.
//   · No evade protecciones: no descifra reproductores, no usa navegador oculto ni salta bloqueos.
//   · Puede proponer videos alojados en dominios externos, siempre que sean URLs HTTPS públicas.
//   · No se conecta a direcciones internas (protección SSRF), limita tamaño, tiempo y redirecciones.
// La lista de dominios es un resguardo técnico, no una verificación legal: la responsabilidad de usar
// únicamente contenido libre o con permiso es de quien administra la plataforma.
const https = require('https');
const dns = require('dns');
const net = require('net');
const { HttpError } = require('./lib/http');
const { isUrlAllowed, normalizeHost } = require('./sources');
const { decodeEntities } = require('./archive');

const UA = 'FLIXOR-Importer/1.0';
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATES = 200;

/* ------------------------------------------------------------ Red segura */
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = String(ip).toLowerCase();
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('::ffff:')) { const rest = v.slice(7); return net.isIPv4(rest) ? isPrivateIp(rest) : true; }
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

// Resuelve el nombre y rechaza direcciones privadas EN el momento de conectar (sin ventana para rebinding).
function publicLookup(hostname, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) return cb(new Error('Dirección no permitida'));
    return opts.all ? cb(null, addrs) : cb(null, addrs[0].address, addrs[0].family);
  });
}

function fetchOnce(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      protocol: 'https:', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET', lookup: publicLookup, timeout: 12_000,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/rss+xml,text/xml;q=0.9,*/*;q=0.5', 'accept-language': 'es,en;q=0.8', 'accept-encoding': 'identity' },
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { req.destroy(); return reject(new HttpError(413, 'La página es demasiado grande para analizarla')); } chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', reject);
    req.end();
  });
}
let fetcher = fetchOnce;
let delayMs = 400;

function assertAllowed(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { throw new HttpError(400, 'Escribe una dirección válida que empiece por https://'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'La dirección debe usar HTTPS');
  if (!isUrlAllowed(u.toString())) {
    const host = u.hostname.replace(/^www\./, '');
    throw new HttpError(403, `El dominio ${host} está bloqueado o la URL no es válida.`, { code: 'host_blocked', host });
  }
  return u;
}

async function safeGet(urlStr, hops = 3) {
  let cur = assertAllowed(urlStr).toString();
  for (let i = 0; i <= hops; i++) {
    let r;
    try { r = await fetcher(cur); } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, `No se pudo abrir la página (${e.message || 'error de conexión'})`);
    }
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      cur = assertAllowed(new URL(r.headers.location, cur).toString()).toString();
      continue;
    }
    return { ...r, url: cur };
  }
  throw new HttpError(502, 'La página redirige demasiadas veces');
}

/* ------------------------------------------------------------ robots.txt */
function parseRobots(text) {
  const groups = [];
  let cur = null; let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      lastWasAgent = false;
      if (v) cur.rules.push({ allow: k === 'allow', path: v });
    } else lastWasAgent = false;
  }
  const mine = groups.find((g) => g.agents.includes('flixor-importer')) || groups.find((g) => g.agents.includes('*'));
  const rules = mine ? mine.rules : [];
  const toRe = (p) => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return (pathAndQuery) => {
    let best = null;
    for (const r of rules) if (toRe(r.path).test(pathAndQuery) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    return !best || best.allow;
  };
}
const robotsCache = new Map();
async function robotsAllows(u) {
  const hit = robotsCache.get(u.origin);
  let allows = hit && Date.now() - hit.at < 10 * 60_000 ? hit.fn : null;
  if (!allows) {
    try {
      const r = await fetcher(u.origin + '/robots.txt');
      allows = r.status >= 500 ? () => false : r.status >= 200 && r.status < 300 ? parseRobots(r.body.toString('utf8')) : () => true;
    } catch { allows = () => true; }
    robotsCache.set(u.origin, { at: Date.now(), fn: allows });
  }
  return allows(u.pathname + u.search);
}

/* ------------------------------------------------------------ Extracción */
const decode = (s) => decodeEntities(String(s ?? ''));
const textOf = (s, max = 1500) => decode(String(s ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);
const attr = (tag, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3]) : null;
};
const abs = (v, base) => { if (!v) return null; try { const u = new URL(String(v).trim(), base); return /^https?:$/.test(u.protocol) ? u.toString() : null; } catch { return null; } };
const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

function classify(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const p = u.pathname.toLowerCase();
  if (/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(u.hostname)) return 'youtube';
  if (p.endsWith('.m3u8')) return 'hls';
  if (/\.(mp4|m4v|webm|ogv)$/.test(p)) return 'mp4';
  return null;
}
const isoMinutes = (d) => {
  if (d == null) return null;
  if (/^\d+$/.test(String(d))) return Math.max(1, Math.round(Number(d) / 60)) || null; // segundos
  const m = /^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(String(d));
  if (m) { const v = Number(m[1] || 0) * 60 + Number(m[2] || 0) + Math.round(Number(m[3] || 0) / 60); return v || null; }
  const c = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(String(d)); // hh:mm:ss
  return c ? Number(c[1] || 0) * 60 + Number(c[2]) + (Number(c[3]) >= 30 ? 1 : 0) || null : null;
};
const yearOf = (d) => { const m = /^(\d{4})/.exec(String(d || '')); const y = m ? Number(m[1]) : null; return y && y >= 1888 && y <= 2100 ? y : null; };

function makeCollector(pageUrl) {
  const seen = new Set(); const items = [];
  return {
    items,
    add(c) {
      const url = abs(c.url, pageUrl);
      if (!url || seen.has(url)) return;
      const type = c.type || classify(url);
      if (!type) return;
      seen.add(url);
      items.push({
        title: textOf(c.title, 150), overview: textOf(c.overview, 1500), year: c.year || null, runtime: c.runtime || null,
        poster_url: abs(c.poster, pageUrl), video_url: url, video_type: type, page_url: c.page || pageUrl, via: c.via,
      });
    },
  };
}

function jsonLdNodes(html) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n !== 'object') return;
    if (n['@graph']) walk(n['@graph']);
    if (n.itemListElement) walk(n.itemListElement);
    if (n.item) walk(n.item);
    const t = [].concat(n['@type'] || []).map(String);
    if (t.some((x) => /^(Movie|TVEpisode|Episode|TVSeries|VideoObject|Clip|CreativeWork)$/.test(x))) out.push(n);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* JSON inválido: se ignora */ }
  }
  return out;
}
const imageOf = (v) => { const x = firstOf(v); return typeof x === 'string' ? x : x && (x.url || x.contentUrl) || null; };

function extractHtml(html, pageUrl) {
  const col = makeCollector(pageUrl);
  const metas = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const k = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    const v = attr(m[0], 'content');
    if (k && v != null && !(k in metas)) metas[k] = v;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const pageTitle = textOf(metas['og:title'] || (titleTag && titleTag[1]) || '', 150);
  const pageOverview = textOf(metas['og:description'] || metas.description || '', 1500);
  const pagePoster = metas['og:image'] || metas['twitter:image'] || null;
  const base = { title: pageTitle, overview: pageOverview, poster: pagePoster };

  // 1) JSON-LD (schema.org)
  for (const n of jsonLdNodes(html)) {
    const info = {
      title: n.name || n.headline || base.title, overview: n.description || base.overview, poster: imageOf(n.image) || imageOf(n.thumbnailUrl) || base.poster,
      year: yearOf(n.datePublished || n.dateCreated || n.uploadDate), runtime: isoMinutes(n.duration), page: abs(n.url, pageUrl) || pageUrl, via: 'schema.org',
    };
    if (n.contentUrl) col.add({ ...info, url: n.contentUrl });
    if (n.embedUrl) col.add({ ...info, url: n.embedUrl, type: classify(abs(n.embedUrl, pageUrl) || '') || 'embed' });
    for (const v of [].concat(n.video || [])) {
      if (!v || typeof v !== 'object') continue;
      const vi = { ...info, title: v.name || info.title, overview: v.description || info.overview, poster: imageOf(v.thumbnailUrl) || imageOf(v.image) || info.poster, runtime: isoMinutes(v.duration) || info.runtime, year: yearOf(v.uploadDate) || info.year };
      if (v.contentUrl) col.add({ ...vi, url: v.contentUrl });
      if (v.embedUrl) col.add({ ...vi, url: v.embedUrl, type: classify(abs(v.embedUrl, pageUrl) || '') || 'embed' });
    }
  }
  // 2) Open Graph
  const ogType = (metas['og:video:type'] || '').toLowerCase();
  for (const k of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
    if (!metas[k]) continue;
    const u = abs(metas[k], pageUrl);
    col.add({ ...base, url: u, type: classify(u || '') || (/video\/|mpegurl/.test(ogType) ? 'mp4' : 'embed'), via: 'Open Graph' });
  }
  // 3) Etiquetas <video> y <source>
  for (const m of html.matchAll(/<(?:video|source)\b[^>]*>/gi)) col.add({ ...base, url: attr(m[0], 'src'), via: 'etiqueta de video' });
  // 4) Enlaces directos a archivos de video
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = abs(attr(m[0], 'href'), pageUrl);
    if (href && /\.(mp4|m4v|webm|m3u8)(\?|$)/i.test(href)) col.add({ ...base, url: href, via: 'enlace' });
  }
  // 5) Reproductores insertados (iframe)
  for (const m of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const u = abs(attr(m[0], 'src') || attr(m[0], 'data-src'), pageUrl);
    if (u) col.add({ ...base, url: u, type: classify(u) || 'embed', via: 'reproductor insertado' });
  }
  // Enlaces a otras páginas del mismo sitio (para explorarlas)
  const host = new URL(pageUrl).hostname.replace(/^www\./, '');
  const links = []; const lseen = new Set([pageUrl.split('#')[0]]);
  for (const m of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = abs(attr(m[0], 'href'), pageUrl);
    if (!href) continue;
    const u = new URL(href); u.hash = '';
    if (u.protocol !== 'https:' || u.hostname.replace(/^www\./, '') !== host) continue;
    if (/\.(jpe?g|png|gif|webp|svg|css|js|pdf|zip|mp4|m3u8|webm|ico|xml)$/i.test(u.pathname)) continue;
    if (lseen.has(u.toString()) || u.pathname === '/') continue;
    lseen.add(u.toString());
    links.push({ url: u.toString(), text: textOf(m[1], 80) });
    if (links.length >= 200) break;
  }
  return { kind: 'page', title: pageTitle, candidates: col.items.slice(0, MAX_CANDIDATES), links };
}

const tagBlock = (s, name) => [...s.matchAll(new RegExp(`<${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${name}>)`, 'gi'))].map((m) => m[0]);
const tagVal = (s, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(s); return m ? textOf(m[1]) : ''; };
const tagAttr = (s, name, a) => { const m = new RegExp(`<${name}\\b[^>]*>`, 'i').exec(s); return m ? attr(m[0], a) : null; };

function extractFeed(xml, pageUrl) {
  const col = makeCollector(pageUrl);
  const channelTitle = tagVal(xml.replace(/<(item|entry)\b[\s\S]*?<\/\1>/gi, ''), 'title');
  // RSS / Atom
  for (const block of [...tagBlock(xml, 'item'), ...tagBlock(xml, 'entry')]) {
    const info = {
      title: tagVal(block, 'title'), overview: tagVal(block, 'description') || tagVal(block, 'summary') || tagVal(block, 'media:description'),
      poster: tagAttr(block, 'media:thumbnail', 'url') || tagAttr(block, 'itunes:image', 'href'), year: yearOf(tagVal(block, 'published') || tagVal(block, 'updated')) || (/\b(19|20)\d{2}\b/.exec(tagVal(block, 'pubDate')) || [])[0] * 1 || null,
      runtime: isoMinutes(tagVal(block, 'itunes:duration')), page: abs(tagVal(block, 'link') || tagAttr(block, 'link', 'href'), pageUrl) || pageUrl, via: 'feed',
    };
    for (const e of tagBlock(block, 'enclosure')) { const t = (attr(e, 'type') || '').toLowerCase(); const u = abs(attr(e, 'url'), pageUrl); if (u && (t.startsWith('video') || classify(u))) col.add({ ...info, url: u }); }
    for (const e of tagBlock(block, 'media:content')) { const t = (attr(e, 'type') || '').toLowerCase(); const u = abs(attr(e, 'url'), pageUrl); if (u && (t.startsWith('video') || classify(u))) col.add({ ...info, url: u, runtime: isoMinutes(attr(e, 'duration')) || info.runtime }); }
    for (const e of tagBlock(block, 'link')) if ((attr(e, 'rel') || '') === 'enclosure') { const u = abs(attr(e, 'href'), pageUrl); if (u) col.add({ ...info, url: u }); }
  }
  // Sitemap de video
  for (const block of tagBlock(xml, 'url')) {
    const loc = abs(tagVal(block, 'loc'), pageUrl);
    for (const v of tagBlock(block, 'video:video')) {
      const info = {
        title: tagVal(v, 'video:title'), overview: tagVal(v, 'video:description'), poster: tagVal(v, 'video:thumbnail_loc'),
        runtime: isoMinutes(tagVal(v, 'video:duration')), year: yearOf(tagVal(v, 'video:publication_date')), page: loc || pageUrl, via: 'sitemap de video',
      };
      const content = tagVal(v, 'video:content_loc'); const player = tagVal(v, 'video:player_loc');
      if (content) col.add({ ...info, url: content });
      if (player) col.add({ ...info, url: player, type: classify(abs(player, pageUrl) || '') || 'embed' });
    }
  }
  return { kind: 'feed', title: channelTitle, candidates: col.items.slice(0, MAX_CANDIDATES), links: [] };
}

/* ------------------------------------------------------------ API pública */
function finish(result) {
  const skipped = new Map();
  const candidates = [];
  for (const c of result.candidates) {
    if (isUrlAllowed(c.video_url)) candidates.push(c);
    else { const h = new URL(c.video_url).hostname.replace(/^www\./, ''); skipped.set(h, (skipped.get(h) || 0) + 1); }
  }
  return { ...result, candidates, skipped: [...skipped].map(([host, count]) => ({ host, count })) };
}

async function analyzeUrl(urlStr) {
  const u = assertAllowed(urlStr);
  if (!(await robotsAllows(u))) throw new HttpError(403, 'El sitio no permite la lectura automática de esta página (robots.txt). Respetamos esa decisión: agrega el contenido manualmente o pide permiso al sitio.');
  const r = await safeGet(u.toString());
  if (r.status === 404 || r.status === 410) throw new HttpError(404, 'La página no existe (404)');
  if (r.status >= 400) throw new HttpError(502, `El sitio respondió con error ${r.status}${r.status === 403 || r.status === 429 ? ' (bloquea la lectura automática)' : ''}`);
  const body = r.body.toString('utf8');
  const ct = String(r.headers['content-type'] || '').toLowerCase();
  const isXml = /xml|rss|atom/.test(ct) || /^\s*(<\?xml|<rss|<feed|<urlset)/i.test(body);
  const out = isXml ? extractFeed(body, r.url) : extractHtml(body, r.url);
  return { url: r.url, ...out };
}

async function analyze(urlStr) { return finish(await analyzeUrl(urlStr)); }

// Analiza varias páginas enlazadas (una por una y con pausa, para no cargar el sitio).
async function expand(urls) {
  const list = [...new Set((Array.isArray(urls) ? urls : []).map(String))].slice(0, 50);
  if (!list.length) throw new HttpError(400, 'Elige al menos una página');
  const all = []; const errors = []; const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    if (i && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const r = await analyzeUrl(list[i]);
      for (const c of r.candidates) if (!seen.has(c.video_url)) { seen.add(c.video_url); all.push(c); }
    } catch (e) { errors.push({ url: list[i], message: e.message }); }
  }
  return { ...finish({ candidates: all.slice(0, MAX_CANDIDATES) }), errors };
}

module.exports = { analyze, expand, parseRobots, extractHtml, extractFeed, isPrivateIp, classify, normalizeHost,
  _setFetcher: (f) => { fetcher = f || fetchOnce; robotsCache.clear(); }, _setDelay: (n) => { delayMs = n; } };
