'use strict';
const { q, tx } = require('../db');
const { HttpError, rateLimit } = require('../lib/http');
const { hashPassword, verifyPassword, randomToken, sha256 } = require('../lib/security');
const { auth, startSession, endSession } = require('../middleware');
const { APP_URL, SHOW_RESET_LINK } = require('../config');
const { sendMail } = require('../mailer');

const COLORS = ['#e50914', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cleanName(v, label = 'Nombre') {
  const s = String(v || '').trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 40) throw new HttpError(400, `${label}: entre 2 y 40 caracteres`);
  return s;
}
function cleanPassword(v) {
  const s = String(v || '');
  if (s.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
  if (s.length > 200) throw new HttpError(400, 'Contraseña demasiado larga');
  if (!/[a-zA-Z]/.test(s) || !/\d/.test(s)) throw new HttpError(400, 'La contraseña debe incluir letras y números');
  return s;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
function userPayload(u) {
  return { user: publicUser(u), profiles: q.all('SELECT id, name, avatar_color FROM profiles WHERE user_id = ? ORDER BY id', u.id) };
}

module.exports = (app) => {
  const limiter = rateLimit({ name: 'auth', max: 30, windowMs: 15 * 60_000 });
  const resetLimiter = rateLimit({ name: 'reset', max: 8, windowMs: 15 * 60_000 });

  app.post('/api/auth/register', limiter, async (req, res) => {
    const name = cleanName(req.body.name);
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 120) throw new HttpError(400, 'Correo electrónico inválido');
    const password = cleanPassword(req.body.password);
    if (q.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Ya existe una cuenta con ese correo');
    const hash = await hashPassword(password);
    const now = Date.now();
    const userId = tx(() => {
      const r = q.run('INSERT INTO users (name, email, password_hash, created_at) VALUES (?,?,?,?)', name, email, hash, now);
      q.run('INSERT INTO profiles (user_id, name, avatar_color, created_at) VALUES (?,?,?,?)', r.lastInsertRowid, name, COLORS[0], now);
      return Number(r.lastInsertRowid);
    });
    const user = q.get('SELECT * FROM users WHERE id = ?', userId);
    startSession(res, user, !!req.body.remember);
    res.json(userPayload(user), 201);
  });

  app.post('/api/auth/login', limiter, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = q.get('SELECT * FROM users WHERE email = ?', email);
    // Se verifica siempre un hash para no revelar por tiempo si el correo existe.
    const ok = user
      ? await verifyPassword(String(req.body.password || ''), user.password_hash)
      : (await verifyPassword('x', 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64')), false);
    if (!ok) throw new HttpError(401, 'Correo o contraseña incorrectos');
    if (user.status !== 'active') throw new HttpError(403, 'Tu cuenta está bloqueada. Contacta al administrador.');
    startSession(res, user, !!req.body.remember);
    res.json(userPayload(user));
  });

  app.post('/api/auth/logout', (req, res) => {
    endSession(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', auth, (req, res) => res.json(userPayload(req.user)));

  app.post('/api/auth/forgot', resetLimiter, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = q.get('SELECT * FROM users WHERE email = ? AND status = ?', email, 'active');
    const out = { ok: true, message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' };
    if (user) {
      const token = randomToken();
      q.run('DELETE FROM password_resets WHERE user_id = ?', user.id);
      q.run('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)', user.id, sha256(token), Date.now() + 30 * 60_000);
      const link = `${APP_URL}/#/reset/${token}`;
      await sendMail({ to: user.email, subject: 'Restablece tu contraseña de CINEPLUS', text: `Hola ${user.name},\n\nUsa este enlace (válido 30 minutos) para crear una nueva contraseña:\n${link}\n\nSi no lo solicitaste, ignora este mensaje.` });
      // Solo en desarrollo (sin servicio de correo) se devuelve el enlace para poder probar el flujo.
      if (SHOW_RESET_LINK) out.devLink = `/#/reset/${token}`;
    }
    res.json(out);
  });

  app.post('/api/auth/reset', resetLimiter, async (req, res) => {
    const password = cleanPassword(req.body.password);
    const row = q.get('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0', sha256(String(req.body.token || '')));
    if (!row || row.expires_at < Date.now()) throw new HttpError(400, 'El enlace no es válido o ya expiró');
    const hash = await hashPassword(password);
    tx(() => {
      q.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', hash, row.user_id);
      q.run('UPDATE password_resets SET used = 1 WHERE id = ?', row.id);
    });
    res.json({ ok: true });
  });

  // Actualizar datos de la cuenta (nombre y/o contraseña)
  app.patch('/api/auth/account', auth, async (req, res) => {
    const u = q.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (req.body.name !== undefined) q.run('UPDATE users SET name = ? WHERE id = ?', cleanName(req.body.name), u.id);
    if (req.body.newPassword) {
      if (!(await verifyPassword(String(req.body.currentPassword || ''), u.password_hash))) throw new HttpError(400, 'La contraseña actual es incorrecta');
      const hash = await hashPassword(cleanPassword(req.body.newPassword));
      q.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', hash, u.id);
      const fresh = q.get('SELECT * FROM users WHERE id = ?', u.id);
      startSession(res, fresh, true); // mantiene viva esta sesión; las demás quedan invalidadas
    }
    res.json(userPayload(q.get('SELECT * FROM users WHERE id = ?', u.id)));
  });
};

module.exports.COLORS = COLORS;
module.exports.cleanName = cleanName;
