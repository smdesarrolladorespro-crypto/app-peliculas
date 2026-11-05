'use strict';
const { q, tx } = require('../db');
const { HttpError } = require('../lib/http');
const { auth, profile } = require('../middleware');
const { listTitles } = require('../catalog');
const { COLORS, cleanName } = require('./auth');

const MAX_PROFILES = 5;

module.exports = (app) => {
  // ---- Perfiles -----------------------------------------------------------
  app.get('/api/profiles', auth, (req, res) => {
    res.json({ profiles: q.all('SELECT id, name, avatar_color FROM profiles WHERE user_id = ? ORDER BY id', req.user.id) });
  });

  function cleanColor(c) {
    if (c === undefined) return undefined;
    if (!/^#[0-9a-f]{6}$/i.test(String(c))) throw new HttpError(400, 'Color inválido');
    return String(c).toLowerCase();
  }

  app.post('/api/profiles', auth, (req, res) => {
    if (q.get('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', req.user.id).n >= MAX_PROFILES) {
      throw new HttpError(400, `Máximo ${MAX_PROFILES} perfiles por cuenta`);
    }
    const name = cleanName(req.body.name, 'Nombre del perfil');
    const color = cleanColor(req.body.avatar_color) || COLORS[Math.floor(Math.random() * COLORS.length)];
    const r = q.run('INSERT INTO profiles (user_id, name, avatar_color, created_at) VALUES (?,?,?,?)', req.user.id, name, color, Date.now());
    res.json({ profile: q.get('SELECT id, name, avatar_color FROM profiles WHERE id = ?', r.lastInsertRowid) }, 201);
  });

  function ownProfile(req) {
    const p = q.get('SELECT * FROM profiles WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
    if (!p) throw new HttpError(404, 'Perfil no encontrado');
    return p;
  }

  app.patch('/api/profiles/:id', auth, (req, res) => {
    const p = ownProfile(req);
    const name = req.body.name !== undefined ? cleanName(req.body.name, 'Nombre del perfil') : p.name;
    const color = cleanColor(req.body.avatar_color) || p.avatar_color;
    q.run('UPDATE profiles SET name = ?, avatar_color = ? WHERE id = ?', name, color, p.id);
    res.json({ profile: { id: p.id, name, avatar_color: color } });
  });

  app.delete('/api/profiles/:id', auth, (req, res) => {
    const p = ownProfile(req);
    if (q.get('SELECT COUNT(*) AS n FROM profiles WHERE user_id = ?', req.user.id).n <= 1) {
      throw new HttpError(400, 'Debes conservar al menos un perfil');
    }
    q.run('DELETE FROM profiles WHERE id = ?', p.id);
    res.json({ ok: true });
  });

  // ---- Favoritos (por perfil) ---------------------------------------------
  app.get('/api/favorites', auth, profile, (req, res) => {
    const rows = q.all('SELECT title_id FROM favorites WHERE profile_id = ? ORDER BY created_at DESC', req.profile.id);
    const ids = rows.map((r) => r.title_id);
    const byId = new Map(listTitles({ ids, limit: 100 }).items.map((t) => [t.id, t]));
    res.json({ ids, items: ids.map((id) => byId.get(id)).filter(Boolean) });
  });

  app.put('/api/favorites/:titleId', auth, profile, (req, res) => {
    const id = Number(req.params.titleId);
    if (!q.get('SELECT id FROM titles WHERE id = ?', id)) throw new HttpError(404, 'Título no encontrado');
    q.run('INSERT OR IGNORE INTO favorites (profile_id, title_id, created_at) VALUES (?,?,?)', req.profile.id, id, Date.now());
    res.json({ ok: true });
  });

  app.delete('/api/favorites/:titleId', auth, profile, (req, res) => {
    q.run('DELETE FROM favorites WHERE profile_id = ? AND title_id = ?', req.profile.id, Number(req.params.titleId));
    res.json({ ok: true });
  });

  // ---- Historial y "Continuar viendo" ------------------------------------
  const HISTORY_SQL = `SELECT h.id, h.title_id, h.episode_id, h.position, h.duration, h.updated_at,
      t.title, t.type, t.poster_url, t.backdrop_url, e.season, e.number, e.name AS episode_name
    FROM history h JOIN titles t ON t.id = h.title_id LEFT JOIN episodes e ON e.id = h.episode_id
    WHERE h.profile_id = ? ORDER BY h.updated_at DESC LIMIT 300`;

  app.get('/api/history', auth, profile, (req, res) => {
    res.json({ items: q.all(HISTORY_SQL, req.profile.id) });
  });

  app.get('/api/continue', auth, profile, (req, res) => {
    const seen = new Set();
    const items = [];
    for (const h of q.all(HISTORY_SQL, req.profile.id)) {
      if (seen.has(h.title_id)) continue; // solo lo más reciente de cada título
      seen.add(h.title_id);
      const ratio = h.duration > 0 ? h.position / h.duration : 0;
      if (h.position > 5 && ratio < 0.95) items.push(h);
      if (items.length >= 20) break;
    }
    res.json({ items });
  });

  // Progreso guardado de un título (todas las entradas, para marcar episodios vistos)
  app.get('/api/progress/:titleId', auth, profile, (req, res) => {
    const rows = q.all('SELECT episode_id, position, duration, updated_at FROM history WHERE profile_id = ? AND title_id = ? ORDER BY updated_at DESC', req.profile.id, Number(req.params.titleId));
    res.json({ items: rows });
  });

  app.post('/api/history', auth, profile, (req, res) => {
    const titleId = Number(req.body.titleId);
    const episodeId = Number(req.body.episodeId) || 0;
    const position = Math.max(0, Number(req.body.position) || 0);
    const duration = Math.max(0, Number(req.body.duration) || 0);
    const title = q.get('SELECT id, type FROM titles WHERE id = ?', titleId);
    if (!title) throw new HttpError(404, 'Título no encontrado');
    if (title.type === 'series' && !q.get('SELECT id FROM episodes WHERE id = ? AND title_id = ?', episodeId, titleId)) throw new HttpError(400, 'Episodio inválido');
    if (title.type === 'movie' && episodeId !== 0) throw new HttpError(400, 'Episodio inválido');
    q.run(`INSERT INTO history (profile_id, title_id, episode_id, position, duration, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(profile_id, title_id, episode_id) DO UPDATE SET position = excluded.position,
      duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE history.duration END, updated_at = excluded.updated_at`,
      req.profile.id, titleId, episodeId, position, duration, Date.now());
    res.json({ ok: true });
  });

  app.delete('/api/history/:id', auth, profile, (req, res) => {
    q.run('DELETE FROM history WHERE id = ? AND profile_id = ?', Number(req.params.id), req.profile.id);
    res.json({ ok: true });
  });

  app.delete('/api/history', auth, profile, (req, res) => {
    q.run('DELETE FROM history WHERE profile_id = ?', req.profile.id);
    res.json({ ok: true });
  });
};
