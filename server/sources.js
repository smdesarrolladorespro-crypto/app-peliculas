'use strict';
// Arquitectura de fuentes de video públicas con bloqueo explícito.
//
// Cada título/episodio guarda un `video_type` y un `video_url`. Los tipos soportados son
// adaptadores del reproductor del frontend: mp4 (archivo directo), hls (.m3u8), youtube e embed
// (iframe de un proveedor). Se aceptan URLs HTTPS de dominios públicos, excepto los bloqueados
// expresamente desde el panel de administración. /uploads sigue permitido para archivos locales. Si un tipo
// de fuente nuevo necesita otro reproductor, se agrega un adaptador aquí y en public/js/player.js.
const { HttpError } = require('./lib/http');
const { q } = require('./db');

const DEFAULT_HOSTS = [
  'archive.org',                  // Internet Archive (dominio público)
  'download.blender.org',         // Películas abiertas de la Blender Foundation (CC)
  'storage.googleapis.com',       // Buckets públicos (muestras abiertas)
  'commondatastorage.googleapis.com',
  'youtube.com', 'youtube-nocookie.com', 'youtu.be', // canales oficiales con permiso
  'vimeo.com', 'dailymotion.com',
];

const TYPES = ['mp4', 'hls', 'youtube', 'embed'];

// La tabla source_hosts conserva una lista de bloqueos explícitos. La lista histórica de permitidos
// se mantiene visible por compatibilidad con el panel, pero ya no limita los dominios aceptados.
let cache = null;
const invalidate = () => { cache = null; };

function envHosts() {
  return (process.env.ALLOWED_SOURCE_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function hostList() {
  const rows = q.all('SELECT host, mode, note FROM source_hosts');
  const blocked = new Set(rows.filter((r) => r.mode === 'block').map((r) => r.host));
  const out = new Map();
  for (const host of DEFAULT_HOSTS) out.set(host, { host, origin: 'default', note: '' });
  for (const host of envHosts()) if (!out.has(host)) out.set(host, { host, origin: 'env', note: '' });
  for (const r of rows) {
    if (r.mode === 'allow' && !out.has(r.host)) out.set(r.host, { host: r.host, origin: 'custom', note: r.note });
    if (r.mode === 'block' && !out.has(r.host)) out.set(r.host, { host: r.host, origin: 'blocked', note: r.note || '' });
  }
  return [...out.values()].map((x) => ({ ...x, enabled: !blocked.has(x.host) }));
}

function allowedHosts() {
  if (!cache) cache = hostList().filter((x) => x.enabled).map((x) => x.host);
  return cache;
}

function hostBlocked(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  const rows = q.all("SELECT host FROM source_hosts WHERE mode = 'block'");
  return rows.some((r) => host === r.host || host.endsWith('.' + r.host));
}

// Se aceptan dominios HTTPS públicos sin alta manual. Los bloqueos del administrador
// siguen teniendo efecto para el dominio y sus subdominios.
function hostAllowed(host) {
  return !hostBlocked(host);
}

// Acepta "archive.org", "https://archive.org/download/x" o "www.archive.org" y devuelve "archive.org"
function normalizeHost(input) {
  let v = String(input || '').trim().toLowerCase();
  if (!v) throw new HttpError(400, 'Escribe un dominio (ejemplo: archive.org)');
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(v)) {
    try { v = new URL(v).hostname; } catch { throw new HttpError(400, 'Dominio inválido'); }
  } else v = v.split(/[/?#]/)[0];
  v = v.replace(/:\d+$/, '').replace(/\.$/, '').replace(/^www\./, '');
  const valid = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v);
  const tooBroad = /^(com|net|org|edu|gov|co|ac|or|ne)\.[a-z]{2}$/.test(v); // sufijos públicos como com.co
  const internal = v === 'localhost' || /\.(local|localhost|internal|lan)$/.test(v);
  if (!valid || tooBroad || internal) throw new HttpError(400, 'Dominio inválido. Escribe solo el sitio, por ejemplo: archive.org');
  return v;
}

function isUrlAllowed(value) {
  const v = String(value || '');
  if (/^\/uploads\/[\w.\-]+$/.test(v)) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && hostAllowed(u.hostname); } catch { return false; }
}

function checkUrl(value, { label, anyHost = false, allowLocal = true }) {
  if (value == null || value === '') return null;
  const v = String(value).trim();
  if (allowLocal && /^\/uploads\/[\w.\-]+$/.test(v)) return v;
  let u;
  try { u = new URL(v); } catch { throw new HttpError(400, `${label}: URL inválida`); }
  if (u.protocol !== 'https:') throw new HttpError(400, `${label}: debe usar HTTPS`);
  if (u.username || u.password) throw new HttpError(400, `${label}: no se permiten credenciales en la URL`);
  if (hostBlocked(u.hostname)) {
    const host = u.hostname.replace(/^www\./, '');
    throw new HttpError(403, `${label}: el dominio ${host} está bloqueado`, { code: 'host_blocked', host });
  }
  return u.toString();
}

function validateSource(type, url, label = 'Fuente de video') {
  if (url == null || url === '') return { type: TYPES.includes(type) ? type : 'mp4', url: null };
  if (!TYPES.includes(type)) throw new HttpError(400, `${label}: tipo no soportado (${TYPES.join(', ')})`);
  const clean = checkUrl(url, { label });
  if (type === 'youtube') {
    const h = new URL(clean, 'https://x').hostname;
    if (!/(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(h)) throw new HttpError(400, `${label}: no es una URL de YouTube`);
  }
  return { type, url: clean };
}

function validateImage(url, label) {
  return checkUrl(url, { label, anyHost: true });
}

function validateSubtitles(list) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 20) throw new HttpError(400, 'Subtítulos inválidos');
  return list.map((s) => ({
    lang: String(s.lang || 'es').slice(0, 10).replace(/[^\w-]/g, ''),
    label: String(s.label || s.lang || 'Subtítulos').slice(0, 40),
    url: checkUrl(s.url, { label: 'Subtítulo' }),
  })).filter((s) => s.url);
}

module.exports = { TYPES, allowedHosts, hostList, normalizeHost, invalidate, isUrlAllowed, validateSource, validateImage, validateSubtitles, hostAllowed };
