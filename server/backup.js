'use strict';
// Copias de seguridad automáticas en un almacenamiento compatible con S3 (Cloudflare R2, Backblaze B2,
// AWS S3, etc.). Sirve para que los usuarios y el contenido NO se pierdan cuando el servidor se reinicia
// en un hosting con disco temporal (p. ej. el plan gratis de Render).
//
//  · Al arrancar, si no hay base de datos local, se restaura la última copia (y las imágenes subidas).
//  · Cada pocos minutos, si hubo cambios, se sube una copia consistente de la base de datos.
//  · Al apagarse el servidor (SIGTERM) se hace una última copia.
//
// Sin dependencias: la firma AWS Signature V4 está implementada con el módulo crypto.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function conf() {
  const e = process.env;
  const c = {
    endpoint: (e.BACKUP_S3_ENDPOINT || '').replace(/\/+$/, ''),
    bucket: e.BACKUP_S3_BUCKET || '',
    keyId: e.BACKUP_S3_KEY_ID || '',
    secret: e.BACKUP_S3_SECRET || '',
    region: e.BACKUP_S3_REGION || 'auto',
  };
  c.enabled = !!(c.endpoint && c.bucket && c.keyId && c.secret);
  return c;
}
const enabled = () => conf().enabled;

// Firma SigV4 (exportada para probarla con el ejemplo oficial de AWS).
function sign({ method, host, uri, query = {}, headers = {}, payloadHash, amzDate, region, keyId, secret, service = 's3' }) {
  const hdrs = { host, ...headers };
  const names = Object.keys(hdrs).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(hdrs).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonical = [method, uri, qs, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha(canonical)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), service), 'aws4_request');
  const signature = hmac(k, toSign).toString('hex');
  return { signature, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, qs };
}

async function s3(method, key, { body, query = {} } = {}) {
  const c = conf();
  const u = new URL(c.endpoint);
  const uri = '/' + [c.bucket, ...String(key).split('/')].filter((x) => x !== '').map(enc).join('/');
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const payloadHash = sha(body || '');
  const headers = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const { authorization, qs } = sign({ method, host: u.host, uri, query, headers, payloadHash, amzDate, region: c.region, keyId: c.keyId, secret: c.secret });
  return fetch(`${u.protocol}//${u.host}${uri}${qs ? '?' + qs : ''}`, {
    method, body, headers: { ...headers, Authorization: authorization }, signal: AbortSignal.timeout(60_000),
  });
}

async function putObject(key, buf) {
  const r = await s3('PUT', key, { body: buf });
  if (!r.ok) throw new Error(`S3 PUT ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}
async function deleteObject(key) {
  const r = await s3('DELETE', key);
  if (!r.ok && r.status !== 404) throw new Error(`S3 DELETE ${key}: ${r.status}`);
}
async function getObject(key) {
  const r = await s3('GET', key);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`S3 GET ${key}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return Buffer.from(await r.arrayBuffer());
}
async function listKeys(prefix) {
  const keys = [];
  let token;
  do {
    const query = { 'list-type': '2', prefix };
    if (token) query['continuation-token'] = token;
    const r = await s3('GET', '', { query });
    if (!r.ok) throw new Error(`S3 LIST: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? (xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] : null;
  } while (token);
  return keys;
}

const safeName = (n) => /^[\w.\-]+$/.test(n);

// Se llama ANTES de abrir la base de datos. Si la copia remota no se puede leer, lanza un error
// (el servidor no arranca) para no empezar vacío y luego sobrescribir la copia buena.
async function restore({ dbPath, uploadDir } = {}) {
  if (!enabled()) return { restored: false, reason: 'disabled' };
  const { DATA_DIR, UPLOAD_DIR } = require('./config');
  dbPath = dbPath || process.env.DB_PATH || path.join(DATA_DIR, 'cineplus.db');
  uploadDir = uploadDir || UPLOAD_DIR;
  fs.mkdirSync(uploadDir, { recursive: true });
  let restored = false;
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) {
    const buf = await getObject('cineplus.db');
    if (buf) {
      fs.writeFileSync(dbPath, buf);
      for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
      restored = true;
      console.log(`[copias] Base de datos restaurada (${Math.round(buf.length / 1024)} KB).`);
    } else console.log('[copias] No hay copia previa: se empieza desde cero.');
  }
  let files = 0;
  for (const key of await listKeys('uploads/')) {
    const name = key.slice('uploads/'.length);
    if (!safeName(name) || fs.existsSync(path.join(uploadDir, name))) continue;
    const buf = await getObject(key);
    if (buf) { fs.writeFileSync(path.join(uploadDir, name), buf); files++; }
  }
  if (files) console.log(`[copias] ${files} archivo(s) subidos restaurados.`);
  return { restored, files };
}

const state = { current: null, lastAt: null, lastError: null, running: false, lastChanges: -1, timer: null };
const uploaded = new Set();

function backupNow(opts = {}) {
  if (!enabled()) return Promise.reject(new Error('Las copias de seguridad no están configuradas'));
  if (!state.current) state.current = run(opts).finally(() => { state.current = null; });
  return state.current; // si ya hay una copia en curso, se espera a esa
}

async function run({ db, uploadDir, dataDir } = {}) {
  state.running = true;
  try {
    const cfg = require('./config');
    db = db || require('./db').db;
    uploadDir = uploadDir || cfg.UPLOAD_DIR;
    dataDir = dataDir || cfg.DATA_DIR;
    const total = db.prepare('SELECT total_changes() AS n').get().n;
    const snap = path.join(dataDir, 'backup-snapshot.db');
    fs.rmSync(snap, { force: true });
    db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`); // copia consistente sin detener el servidor
    const buf = fs.readFileSync(snap);
    fs.rmSync(snap, { force: true });
    await putObject('cineplus.db', buf);
    const day = new Date().toISOString().slice(0, 10);
    if (!uploaded.has('daily:' + day)) {
      await putObject(`daily/cineplus-${day}.db`, buf);
      uploaded.add('daily:' + day);
      // Las copias diarias se conservan 30 días (así lo indica la política de privacidad).
      for (const k of await listKeys('daily/')) {
        const m = k.match(/cineplus-(\d{4}-\d{2}-\d{2})\.db$/);
        if (m && Date.now() - Date.parse(m[1]) > 30 * 86_400_000) await deleteObject(k).catch(() => {});
      }
    }
    for (const name of fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir) : []) {
      if (!safeName(name)) continue;
      const st = fs.statSync(path.join(uploadDir, name));
      if (!st.isFile()) continue;
      const sig = `${name}:${st.size}:${Math.floor(st.mtimeMs)}`;
      if (uploaded.has(sig)) continue;
      await putObject(`uploads/${name}`, fs.readFileSync(path.join(uploadDir, name)));
      uploaded.add(sig);
    }
    state.lastChanges = total;
    state.lastAt = Date.now();
    state.lastError = null;
  } catch (e) {
    state.lastError = e.message;
    console.error('[copias] Error:', e.message);
    throw e;
  } finally { state.running = false; }
  return status();
}

function status() {
  return { enabled: enabled(), lastAt: state.lastAt, lastError: state.lastError, running: state.running };
}

// Revisa cada cierto tiempo si hubo cambios y, en ese caso, sube una copia.
function startSchedule(db) {
  if (!enabled() || state.timer) return;
  const every = Math.max(30, Number(process.env.BACKUP_INTERVAL_SECONDS || 120)) * 1000;
  const tick = () => {
    const total = db.prepare('SELECT total_changes() AS n').get().n;
    if (total !== state.lastChanges) backupNow({ db }).catch(() => {});
  };
  state.timer = setInterval(tick, every);
  state.timer.unref();
  setTimeout(tick, 5000).unref();
}

async function finalBackup(db) {
  if (!enabled()) return;
  const total = db.prepare('SELECT total_changes() AS n').get().n;
  if (total === state.lastChanges) return;
  await Promise.race([backupNow({ db }), new Promise((r) => setTimeout(r, 20_000))]).catch(() => {});
}

module.exports = { enabled, restore, backupNow, status, startSchedule, finalBackup, _sign: sign };
