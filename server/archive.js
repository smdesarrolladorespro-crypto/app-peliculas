'use strict';
// Importador de Internet Archive (archive.org): busca películas y devuelve los archivos MP4 de un
// ítem para usarlos como fuente de video. Solo consulta metadatos públicos; el video se reproduce
// directamente desde archive.org (dominio ya incluido en la lista de fuentes autorizadas).
// IMPORTANTE: Internet Archive aloja material con distintos estatus de derechos. Se muestra la
// licencia declarada por el ítem, pero la responsabilidad de usar solo contenido de dominio
// público o con licencia abierta es de quien administra la plataforma.
const { HttpError } = require('./lib/http');

const API = 'https://archive.org';
const COLLECTIONS = ['feature_films', 'silent_films', 'SciFi_Horror', 'classic_tv', 'animationandcartoons'];

async function getJson(url) {
  let r;
  try { r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new HttpError(502, 'No se pudo conectar con Internet Archive'); }
  if (!r.ok) throw new HttpError(502, `Internet Archive respondió con error ${r.status}`);
  try { return await r.json(); } catch { throw new HttpError(502, 'Respuesta inválida de Internet Archive'); }
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', ccedil: 'ç', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

function decodeEntities(str) {
  // Una sola pasada: evita decodificar dos veces (&amp;lt; -> &lt;, no <)
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

function clean(v, max = 1500) {
  const text = String(first(v) ?? '').replace(/<[^>]*>/g, ' ');
  return decodeEntities(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

const poster = (id) => `${API}/services/img/${id}`;

async function search(text, collection) {
  const parts = ['mediatype:movies'];
  if (COLLECTIONS.includes(collection)) parts.push(`collection:${collection}`);
  const t = String(text || '').replace(/["\\()[\]{}:^~*?!&|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t) parts.push(`title:(${t})`);
  if (parts.length === 1) throw new HttpError(400, 'Escribe un título o elige una colección');
  const u = new URL(API + '/advancedsearch.php');
  u.searchParams.set('q', parts.join(' AND '));
  for (const f of ['identifier', 'title', 'year', 'description', 'licenseurl']) u.searchParams.append('fl[]', f);
  u.searchParams.append('sort[]', 'downloads desc');
  u.searchParams.set('rows', '24');
  u.searchParams.set('output', 'json');
  const d = await getJson(u);
  const docs = (d.response && d.response.docs) || [];
  return docs.filter((x) => /^[\w.-]+$/.test(String(x.identifier || ''))).map((x) => ({
    identifier: x.identifier,
    title: clean(x.title, 150) || x.identifier,
    year: Number(first(x.year)) || null,
    overview: clean(x.description),
    license: first(x.licenseurl) ? String(first(x.licenseurl)).slice(0, 300) : null,
    poster_url: poster(x.identifier),
  }));
}

function minutes(runtime) {
  const s = String(first(runtime) ?? '').trim();
  if (!s) return null;
  if (/^\d+:\d+(:\d+)?$/.test(s)) {
    const p = s.split(':').map(Number);
    const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
    return sec ? Math.max(1, Math.round(sec / 60)) : null;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n > 600 ? n / 60 : n) : null; // segundos o minutos
}

async function item(id) {
  if (!/^[\w.-]{1,150}$/.test(String(id || ''))) throw new HttpError(400, 'Identificador de Internet Archive inválido');
  const d = await getJson(`${API}/metadata/${id}`);
  if (!d || !d.metadata) throw new HttpError(404, 'No se encontró ese ítem en Internet Archive');
  const m = d.metadata;
  const rank = (f) => (f.format === 'h.264' ? 0 : /mpeg4/i.test(f.format || '') ? 1 : 2);
  const files = (d.files || [])
    .filter((f) => /\.mp4$/i.test(f.name || '') && f.private !== 'true')
    .map((f) => ({
      name: f.name,
      format: f.format || 'MP4',
      size: Number(f.size) || 0,
      url: `${API}/download/${id}/${String(f.name).split('/').map(encodeURIComponent).join('/')}`,
    }))
    .sort((a, b) => rank(a) - rank(b) || b.size - a.size);
  return {
    identifier: id,
    title: clean(m.title, 150) || id,
    overview: clean(m.description),
    year: Number(first(m.year)) || Number(String(first(m.date) || '').slice(0, 4)) || null,
    runtime: minutes(m.runtime),
    license: first(m.licenseurl) ? String(first(m.licenseurl)).slice(0, 300) : null,
    poster_url: poster(id),
    page_url: `${API}/details/${id}`,
    files,
  };
}

module.exports = { search, item, COLLECTIONS, decodeEntities };
