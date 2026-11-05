'use strict';
// Carga .env (sin dependencias) y expone la configuración central.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (IS_PROD) throw new Error('JWT_SECRET es obligatorio en producción');
  const f = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(f)) JWT_SECRET = fs.readFileSync(f, 'utf8').trim();
  else {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(f, JWT_SECRET, { mode: 0o600 });
  }
}

module.exports = {
  ROOT,
  IS_PROD,
  DATA_DIR,
  UPLOAD_DIR,
  PUBLIC_DIR: path.join(ROOT, 'public'),
  PORT: Number(process.env.PORT || 3000),
  JWT_SECRET,
  APP_URL: (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, ''),
  TRUST_PROXY: process.env.TRUST_PROXY === '1',
  ADMIN_EMAIL: (process.env.ADMIN_EMAIL || 'admin@cineplus.local').toLowerCase(),
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  TMDB_API_KEY: process.env.TMDB_API_KEY || '',
  SHOW_RESET_LINK: process.env.SHOW_RESET_LINK ? process.env.SHOW_RESET_LINK === '1' : !IS_PROD,
};
