'use strict';
const { q } = require('./db');
const { HttpError, setCookie } = require('./lib/http');
const { signJwt, verifyJwt } = require('./lib/security');
const { IS_PROD } = require('./config');

const COOKIE = 'cp_token';

function startSession(res, user, remember) {
  const ttl = remember ? 30 * 24 * 3600 : 12 * 3600;
  const token = signJwt({ uid: user.id, tv: user.token_version }, ttl);
  // Con "mantener sesión" la cookie persiste 30 días; si no, es de sesión del navegador.
  setCookie(res, COOKIE, token, { maxAge: remember ? ttl : undefined, secure: IS_PROD });
}

function endSession(res) {
  setCookie(res, COOKIE, '', { maxAge: 0, secure: IS_PROD });
}

function auth(req) {
  const p = verifyJwt(req.cookies[COOKIE]);
  const user = p && q.get('SELECT id, name, email, role, status, token_version FROM users WHERE id = ?', p.uid);
  if (!user || user.status !== 'active' || user.token_version !== p.tv) throw new HttpError(401, 'Sesión no válida');
  req.user = user;
}

function admin(req) {
  if (req.user.role !== 'admin') throw new HttpError(403, 'Acceso restringido a administradores');
}

// Perfil activo: se envía en la cabecera X-Profile-Id y se valida que pertenezca al usuario.
function profile(req) {
  const id = Number(req.headers['x-profile-id']);
  const p = id && q.get('SELECT id, name, avatar_color FROM profiles WHERE id = ? AND user_id = ?', id, req.user.id);
  if (!p) throw new HttpError(400, 'Selecciona un perfil para continuar');
  req.profile = p;
}

module.exports = { auth, admin, profile, startSession, endSession };
