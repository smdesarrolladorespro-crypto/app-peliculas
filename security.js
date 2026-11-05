'use strict';
// Hash de contraseñas (scrypt) y tokens JWT HS256, solo con el módulo crypto.
const crypto = require('crypto');
const { promisify } = require('util');
const { JWT_SECRET } = require('../config');

const scrypt = promisify(crypto.scrypt);
const b64u = (b) => Buffer.from(b).toString('base64url');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(key, expected);
}

function signJwt(payload, expiresInSec) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

module.exports = { hashPassword, verifyPassword, signJwt, verifyJwt, sha256, randomToken };
