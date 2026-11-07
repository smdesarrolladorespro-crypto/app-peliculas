'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { q, tx } = require('../db');
const { HttpError, rateLimit } = require('../lib/http');
const { auth, admin } = require('../middleware');
const { UPLOAD_DIR } = require('../config');
const { validateSource, validateImage, validateSubtitles, allowedHosts, hostList, normalizeHost, invalidate, TYPES } = require('../sources');
const { getTitle, parseSubs } = require('../catalog');
const tmdb = require('../tmdb');
const archive = require('../archive');
const scrape = require('../scrape');

const IMG_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'text/vtt': '.vtt' };

function str(v, max, label, { required = false } = {}) {
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${label} es obligatorio`);
  if (s.length > max) throw new HttpError(400, `${label}: máximo ${max} caracteres`);
  return s;
}
function num(v, { min, max, label, int = false }) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new HttpError(400, `${label} inválido`);
  return n;
}

function setGenres(titleId, slugs) {
  q.run('DELETE FROM title_genres WHERE title_id = ?', titleId);
  for (const slug of [...new Set(slugs || [])]) {
    const g = q.get('SELECT id FROM genres WHERE slug = ?', String(slug));
    if (!g) throw new HttpError(400, `Género desconocido: ${slug}`);
    q.run('INSERT INTO title_genres (title_id, genre_id) VALUES (?,?)', titleId, g.id);
  }
}

function adminTitle(id) {
  const t = getTitle(id);
  if (!t) return null;
  const row = q.get('SELECT video_type, video_url, subtitles, tmdb_id FROM titles WHERE id = ?', id);
  return { ...t, video_type: row.video_type, video_url: row.video_url, subtitles: parseSubs(row.subtitles), tmdb_id: row.tmdb_id };
}

module.exports = (app) => {
  const guard = [auth, admin];

  app.get('/api/admin/stats', ...guard, (req, res) => {
    const n = (sql) => q.get(sql).n;
    res.json({
      users: n('SELECT COUNT(*) n FROM users'),
      movies: n("SELECT COUNT(*) n FROM titles WHERE type='movie'"),
      series: n("SELECT COUNT(*) n FROM titles WHERE type='series'"),
      episodes: n('SELECT COUNT(*) n FROM episodes'),
      featured: n('SELECT COUNT(*) n FROM titles WHERE featured=1'),
      anime: n('SELECT COUNT(*) n FROM titles WHERE anime=1'),
      plays: n('SELECT COALESCE(SUM(views),0) n FROM titles'),
      tmdb: tmdb.enabled(),
      allowedHosts: allowedHosts(),
      videoTypes: TYPES,
    });
  });

  // ---- Títulos -------------------------------------------------------------
  app.get('/api/admin/titles', ...guard, (req, res) => {
    const text = String(req.query.q || '').trim();
    const like = `%${text.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const rows = q.all(
      `SELECT id FROM titles WHERE (? = '' OR title LIKE ? ESCAPE '\\') ${req.query.type ? 'AND type = ?' : ''} ORDER BY id DESC LIMIT 200`,
      ...(req.query.type ? [text, like, String(req.query.type)] : [text, like])
    );
    res.json({ items: rows.map((r) => adminTitle(r.id)) });
  });

  app.get('/api/admin/titles/:id', ...guard, (req, res) => {
    const t = adminTitle(Number(req.params.id));
    if (!t) throw new HttpError(404, 'Título no encontrado');
    res.json({ title: t, episodes: q.all('SELECT * FROM episodes WHERE title_id = ? ORDER BY season, number', t.id).map((e) => ({ ...e, subtitles: parseSubs(e.subtitles) })) });
  });

  function readTitle(b, existing) {
    const type = existing ? existing.type : b.type;
    if (type !== 'movie' && type !== 'series') throw new HttpError(400, 'Tipo inválido');
    const src = validateSource(b.video_type || 'mp4', b.video_url, 'Fuente de video');
    if (type === 'series' && src.url) throw new HttpError(400, 'Las series se reproducen por episodios; agrega la fuente en cada episodio');
    return {
      type,
      title: str(b.title, 150, 'Título', { required: true }),
      overview: str(b.overview, 4000, 'Sinopsis'),
      year: num(b.year, { min: 1888, max: 2100, label: 'Año', int: true }),
      rating: num(b.rating, { min: 0, max: 10, label: 'Calificación' }),
      runtime: num(b.runtime, { min: 1, max: 1000, label: 'Duración', int: true }),
      // En una edición, si la clave no viene se conserva el valor actual (p. ej. el póster generado por defecto)
      poster_url: b.poster_url === undefined && existing ? existing.poster_url : validateImage(b.poster_url, 'Póster'),
      backdrop_url: b.backdrop_url === undefined && existing ? existing.backdrop_url : validateImage(b.backdrop_url, 'Fondo'),
      video_type: src.type,
      video_url: src.url,
      subtitles: JSON.stringify(type === 'movie' ? validateSubtitles(b.subtitles) : []),
      featured: b.featured ? 1 : 0,
      anime: b.anime ? 1 : 0,
      tmdb_id: num(b.tmdb_id, { min: 1, max: 1e9, label: 'TMDB ID', int: true }),
    };
  }

  app.post('/api/admin/titles', ...guard, (req, res) => {
    const t = readTitle(req.body);
    const id = tx(() => {
      const r = q.run(
        `INSERT INTO titles (type, title, overview, year, rating, runtime, poster_url, backdrop_url, video_type, video_url, subtitles, featured, anime, tmdb_id, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        t.type, t.title, t.overview, t.year, t.rating, t.runtime, t.poster_url, t.backdrop_url, t.video_type, t.video_url, t.subtitles, t.featured, t.anime, t.tmdb_id, Date.now()
      );
      setGenres(r.lastInsertRowid, req.body.genres);
      return Number(r.lastInsertRowid);
    });
    res.json({ title: adminTitle(id) }, 201);
  });

  app.put('/api/admin/titles/:id', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const existing = q.get('SELECT * FROM titles WHERE id = ?', id);
    if (!existing) throw new HttpError(404, 'Título no encontrado');
    const t = readTitle(req.body, existing);
    tx(() => {
      q.run(
        `UPDATE titles SET title=?, overview=?, year=?, rating=?, runtime=?, poster_url=?, backdrop_url=?, video_type=?, video_url=?, subtitles=?, featured=?, anime=?, tmdb_id=? WHERE id=?`,
        t.title, t.overview, t.year, t.rating, t.runtime, t.poster_url, t.backdrop_url, t.video_type, t.video_url, t.subtitles, t.featured, t.anime, t.tmdb_id, id
      );
      if (req.body.genres) setGenres(id, req.body.genres);
    });
    res.json({ title: adminTitle(id) });
  });

  app.patch('/api/admin/titles/:id/featured', ...guard, (req, res) => {
    const id = Number(req.params.id);
    if (!q.get('SELECT id FROM titles WHERE id = ?', id)) throw new HttpError(404, 'Título no encontrado');
    q.run('UPDATE titles SET featured = ? WHERE id = ?', req.body.featured ? 1 : 0, id);
    res.json({ featured: !!req.body.featured });
  });

  app.delete('/api/admin/titles/:id', ...guard, (req, res) => {
    q.run('DELETE FROM titles WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Episodios -----------------------------------------------------------
  function readEpisode(b) {
    const src = validateSource(b.video_type || 'mp4', b.video_url, 'Fuente del episodio');
    return {
      season: num(b.season, { min: 1, max: 100, label: 'Temporada', int: true }),
      number: num(b.number, { min: 1, max: 1000, label: 'Episodio', int: true }),
      name: str(b.name, 150, 'Nombre del episodio', { required: true }),
      overview: str(b.overview, 2000, 'Sinopsis'),
      runtime: num(b.runtime, { min: 1, max: 1000, label: 'Duración', int: true }),
      video_type: src.type,
      video_url: src.url,
      subtitles: JSON.stringify(validateSubtitles(b.subtitles)),
    };
  }
  const dup = (e) => new HttpError(409, `Ya existe la temporada ${e.season}, episodio ${e.number}`);

  app.post('/api/admin/titles/:id/episodes', ...guard, (req, res) => {
    const titleId = Number(req.params.id);
    const t = q.get('SELECT type FROM titles WHERE id = ?', titleId);
    if (!t) throw new HttpError(404, 'Título no encontrado');
    if (t.type !== 'series') throw new HttpError(400, 'Solo las series tienen episodios');
    const e = readEpisode(req.body);
    if (!e.season || !e.number) throw new HttpError(400, 'Temporada y episodio son obligatorios');
    if (q.get('SELECT id FROM episodes WHERE title_id=? AND season=? AND number=?', titleId, e.season, e.number)) throw dup(e);
    const r = q.run('INSERT INTO episodes (title_id, season, number, name, overview, runtime, video_type, video_url, subtitles) VALUES (?,?,?,?,?,?,?,?,?)',
      titleId, e.season, e.number, e.name, e.overview, e.runtime, e.video_type, e.video_url, e.subtitles);
    res.json({ episode: q.get('SELECT * FROM episodes WHERE id = ?', r.lastInsertRowid) }, 201);
  });

  app.put('/api/admin/episodes/:id', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const cur = q.get('SELECT * FROM episodes WHERE id = ?', id);
    if (!cur) throw new HttpError(404, 'Episodio no encontrado');
    const e = readEpisode(req.body);
    if (!e.season || !e.number) throw new HttpError(400, 'Temporada y episodio son obligatorios');
    const other = q.get('SELECT id FROM episodes WHERE title_id=? AND season=? AND number=? AND id<>?', cur.title_id, e.season, e.number, id);
    if (other) throw dup(e);
    q.run('UPDATE episodes SET season=?, number=?, name=?, overview=?, runtime=?, video_type=?, video_url=?, subtitles=? WHERE id=?',
      e.season, e.number, e.name, e.overview, e.runtime, e.video_type, e.video_url, e.subtitles, id);
    res.json({ episode: q.get('SELECT * FROM episodes WHERE id = ?', id) });
  });

  app.delete('/api/admin/episodes/:id', ...guard, (req, res) => {
    q.run('DELETE FROM episodes WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- Subida de portadas (JSON con base64; se valida el contenido real del archivo) ----------
  app.post('/api/admin/upload', ...guard, (req, res) => {
    const { filename, data } = req.body;
    if (typeof data !== 'string') throw new HttpError(400, 'Archivo ausente');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length || buf.length > 5 * 1024 * 1024) throw new HttpError(400, 'La imagen debe pesar menos de 5 MB');
    let mime = null;
    if (buf[0] === 0xff && buf[1] === 0xd8) mime = 'image/jpeg';
    else if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mime = 'image/png';
    else if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
    if (!mime && buf.toString('utf8', 0, 12).replace(/^﻿/, '').startsWith('WEBVTT')) mime = 'text/vtt';
    if (!mime) throw new HttpError(400, 'Formato no permitido (usa JPG, PNG, WebP o subtítulos .vtt)');
    const name = `${crypto.randomBytes(12).toString('hex')}${IMG_EXT[mime]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ url: `/uploads/${name}`, original: str(filename, 100, 'Nombre') });
  });

  // ---- TMDB -----------------------------------------------------------------
  app.get('/api/admin/tmdb/search', ...guard, async (req, res) => {
    const text = str(req.query.q, 100, 'Búsqueda', { required: true });
    res.json({ items: await tmdb.search(text, req.query.type === 'series' ? 'series' : 'movie') });
  });
  app.get('/api/admin/tmdb/details', ...guard, async (req, res) => {
    res.json({ item: await tmdb.details(Number(req.query.id), req.query.type === 'series' ? 'series' : 'movie') });
  });
  // Importa los episodios (solo metadatos) de una temporada de una serie ya guardada con tmdb_id
  app.post('/api/admin/titles/:id/import-season', ...guard, async (req, res) => {
    const t = q.get('SELECT id, type, tmdb_id FROM titles WHERE id = ?', Number(req.params.id));
    if (!t || t.type !== 'series') throw new HttpError(404, 'Serie no encontrada');
    if (!t.tmdb_id) throw new HttpError(400, 'La serie no tiene TMDB ID');
    const eps = await tmdb.season(t.tmdb_id, num(req.body.season, { min: 1, max: 100, label: 'Temporada', int: true }));
    let added = 0;
    for (const e of eps) {
      const r = q.run('INSERT OR IGNORE INTO episodes (title_id, season, number, name, overview, runtime) VALUES (?,?,?,?,?,?)', t.id, e.season, e.number, e.name.slice(0, 150), e.overview.slice(0, 2000), e.runtime);
      added += Number(r.changes);
    }
    res.json({ added, total: eps.length });
  });

  // ---- Dominios de fuentes autorizadas (se gestionan desde el panel) -------------------
  app.get('/api/admin/hosts', ...guard, (req, res) => res.json({ hosts: hostList() }));

  app.post('/api/admin/hosts', ...guard, (req, res) => {
    const host = normalizeHost(req.body.host);
    const note = str(req.body.note, 200, 'Nota');
    const existing = hostList().find((x) => x.host === host);
    if (existing && existing.enabled) throw new HttpError(409, 'Ese dominio ya está autorizado');
    if (existing) q.run("DELETE FROM source_hosts WHERE host = ? AND mode = 'block'", host); // reactiva uno desactivado
    else q.run("INSERT INTO source_hosts (host, mode, note, created_at) VALUES (?, 'allow', ?, ?)", host, note, Date.now());
    invalidate();
    res.json({ hosts: hostList() }, 201);
  });

  // Activar/desactivar un dominio por defecto o del .env
  app.patch('/api/admin/hosts/:host', ...guard, (req, res) => {
    const host = normalizeHost(req.params.host);
    const e = hostList().find((x) => x.host === host);
    if (!e) throw new HttpError(404, 'Dominio no encontrado');
    if (e.origin === 'custom') throw new HttpError(400, 'Los dominios que agregaste se eliminan, no se desactivan');
    if (req.body.enabled) q.run("DELETE FROM source_hosts WHERE host = ? AND mode = 'block'", host);
    else q.run("INSERT OR REPLACE INTO source_hosts (host, mode, note, created_at) VALUES (?, 'block', '', ?)", host, Date.now());
    invalidate();
    res.json({ hosts: hostList() });
  });

  app.delete('/api/admin/hosts/:host', ...guard, (req, res) => {
    const host = normalizeHost(req.params.host);
    const e = hostList().find((x) => x.host === host);
    if (!e) throw new HttpError(404, 'Dominio no encontrado');
    if (e.origin !== 'custom') throw new HttpError(400, 'Los dominios por defecto no se eliminan; puedes desactivarlos');
    q.run("DELETE FROM source_hosts WHERE host = ? AND mode = 'allow'", host);
    invalidate();
    res.json({ hosts: hostList() });
  });

  // ---- Internet Archive (importador de fuentes) --------------------------------
  // Importar desde una página o feed de una fuente autorizada (ver server/scrape.js)
  const scrapeLimiter = rateLimit({ name: 'scrape', max: 40, windowMs: 10 * 60_000 });
  app.post('/api/admin/scrape/analyze', ...guard, scrapeLimiter, async (req, res) => {
    res.json(await scrape.analyze(String(req.body.url || '').trim()));
  });
  app.post('/api/admin/scrape/expand', ...guard, scrapeLimiter, async (req, res) => {
    res.json(await scrape.expand(req.body.urls));
  });

  app.get('/api/admin/archive/search', ...guard, async (req, res) => {
    res.json({ items: await archive.search(str(req.query.q, 100, 'Búsqueda'), String(req.query.collection || '')), collections: archive.COLLECTIONS });
  });
  app.get('/api/admin/archive/item', ...guard, async (req, res) => {
    res.json({ item: await archive.item(String(req.query.id || '')) });
  });

  // ---- Usuarios ---------------------------------------------------------------
  app.get('/api/admin/users', ...guard, (req, res) => {
    res.json({
      users: q.all(`SELECT u.id, u.name, u.email, u.role, u.status, u.created_at,
        (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
        (SELECT MAX(h.updated_at) FROM history h JOIN profiles p ON p.id = h.profile_id WHERE p.user_id = u.id) AS last_activity
        FROM users u ORDER BY u.id`),
    });
  });

  app.patch('/api/admin/users/:id', ...guard, (req, res) => {
    const id = Number(req.params.id);
    const u = q.get('SELECT * FROM users WHERE id = ?', id);
    if (!u) throw new HttpError(404, 'Usuario no encontrado');
    const role = req.body.role ?? u.role;
    const status = req.body.status ?? u.status;
    if (!['user', 'admin'].includes(role) || !['active', 'blocked'].includes(status)) throw new HttpError(400, 'Valores inválidos');
    if (id === req.user.id && (role !== 'admin' || status !== 'active')) throw new HttpError(400, 'No puedes quitarte el rol de administrador ni bloquearte a ti mismo');
    // Cambiar rol o bloquear invalida las sesiones activas de ese usuario
    q.run('UPDATE users SET role = ?, status = ?, token_version = token_version + ? WHERE id = ?', role, status, role !== u.role || status !== u.status ? 1 : 0, id);
    res.json({ ok: true });
  });

  app.delete('/api/admin/users/:id', ...guard, (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) throw new HttpError(400, 'No puedes eliminar tu propia cuenta');
    q.run('DELETE FROM users WHERE id = ?', id);
    res.json({ ok: true });
  });
};
