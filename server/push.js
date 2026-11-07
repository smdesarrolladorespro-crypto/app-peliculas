'use strict';
// Notificaciones push (Web Push, RFC 8030 + cifrado RFC 8291 + VAPID RFC 8292) sin dependencias.
// Las claves VAPID se generan una vez y se guardan en la base de datos (tabla settings), así que
// viajan con las copias de seguridad.
const crypto = require('crypto');
const { q, getSetting, setSetting } = require('./db');
const { ADMIN_EMAIL, APP_URL } = require('./config');

const b64u = (b) => Buffer.from(b).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

let keys = null;
function vapid() {
  if (keys) return keys;
  let jwk;
  try { jwk = JSON.parse(getSetting('vapid_jwk') || 'null'); } catch { jwk = null; }
  if (!jwk) {
    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    jwk = privateKey.export({ format: 'jwk' });
    setSetting('vapid_jwk', JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
  }
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicRaw = Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]);
  keys = { privateKey, publicKey: b64u(publicRaw) };
  return keys;
}
const publicKey = () => vapid().publicKey;

function vapidHeader(endpoint) {
  const { privateKey, publicKey: pub } = vapid();
  const aud = new URL(endpoint).origin;
  const sub = /\.(local|localhost)$/.test(ADMIN_EMAIL) ? APP_URL : `mailto:${ADMIN_EMAIL}`;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

// Cifrado aes128gcm (RFC 8291)
function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const secret = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', secret, auth, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, data]);
}

// Solo se aceptan los servicios de push reales de los navegadores (evita que alguien registre
// una dirección interna para que el servidor le haga peticiones).
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.microsoft\.com$/];
function validEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    if (process.env.NODE_ENV === 'test' && u.hostname === '127.0.0.1') return true;
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch { return false; }
}

async function sendOne(sub, payload) {
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal',
      Authorization: vapidHeader(sub.endpoint),
    },
    body: encrypt(payload, sub.p256dh, sub.auth),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404 || r.status === 410) { q.run('DELETE FROM push_subscriptions WHERE id = ?', sub.id); return 'gone'; }
  if (!r.ok) { console.error(`[push] ${new URL(sub.endpoint).hostname} respondió ${r.status}`); return 'failed'; }
  return 'sent';
}

// message: { title, body, url }. userIds: lista opcional; sin ella, se envía a todos los suscritos.
async function broadcast(message, userIds) {
  const payload = JSON.stringify({
    title: String(message.title || 'FLIXOR').slice(0, 80),
    body: String(message.body || '').slice(0, 200),
    url: message.url || '/',
    icon: '/img/icon-192.png',
  });
  const subs = userIds
    ? q.all(`SELECT * FROM push_subscriptions WHERE user_id IN (${userIds.map(() => '?').join(',') || 'NULL'})`, ...userIds)
    : q.all('SELECT * FROM push_subscriptions');
  const out = { total: subs.length, sent: 0, failed: 0, removed: 0 };
  for (let i = 0; i < subs.length; i += 20) {
    const res = await Promise.allSettled(subs.slice(i, i + 20).map((s) => sendOne(s, payload)));
    for (const r of res) {
      if (r.status === 'fulfilled' && r.value === 'sent') out.sent++;
      else if (r.status === 'fulfilled' && r.value === 'gone') out.removed++;
      else out.failed++;
    }
  }
  return out;
}

module.exports = { publicKey, validEndpoint, broadcast, _encrypt: encrypt };
