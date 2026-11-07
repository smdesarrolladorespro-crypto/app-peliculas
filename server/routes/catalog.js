'use strict';
const { q } = require('../db');
const { HttpError } = require('../lib/http');
const { auth } = require('../middleware');
const { listTitles, getTitle, parseSubs } = require('../catalog');
const { isUrlAllowed } = require('../sources');

module.exports = (app) => {
  app.get('/api/genres', auth, (req, res) => {
    res.json({ genres: q.all('SELECT g.slug, g.name, (SELECT COUNT(*) FROM title_genres tg WHERE tg.genre_id = g.id) AS count FROM genres g ORDER BY g.position') });
  });

  // Datos de la pantalla de inicio
  app.get('/api/home', auth, (req, res) => {
    let featured = listTitles({ featured: true, limit: 6 }).items;
    if (!featured.length) featured = listTitles({ sort: 'rating', limit: 5 }).items;
    const genres = q.all('SELECT slug, name FROM genres ORDER BY position');
    const rows = genres
      .map((g) => ({ ...g, items: listTitles({ genre: g.slug, sort: 'popular', limit: 20 }).items }))
      .filter((r) => r.items.length);
    res.json({
      featured,
      popular: listTitles({ sort: 'popular', limit: 20 }).items,
      latest: listTitles({ sort: 'recent', limit: 20 }).items,
      movies: listTitles({ type: 'movie', anime: '0', sort: 'rating', limit: 20 }).items,
      series: listTitles({ type: 'series', anime: '0', sort: 'rating', limit: 20 }).items,
      anime: listTitles({ anime: '1', sort: 'recent', limit: 20 }).items,
      genres: rows,
    });
  });

  // Catálogo con filtros y búsqueda
  app.get('/api/titles', auth, (req, res) => {
    const { type, genre, q: text, sort, limit, offset, anime } = req.query;
    res.json(listTitles({ type, genre, anime, text: text && String(text).slice(0, 100), sort, limit, offset }));
  });

  // Detalle (sin exponer las URLs de video; esas se piden con /api/watch)
  app.get('/api/titles/:id', auth, (req, res) => {
    const title = getTitle(Number(req.params.id));
    if (!title) throw new HttpError(404, 'Título no encontrado');
    let seasons = [];
    if (title.type === 'series') {
      const eps = q.all('SELECT id, season, number, name, overview, runtime, (video_url IS NOT NULL) AS playable FROM episodes WHERE title_id = ? ORDER BY season, number', title.id);
      const map = new Map();
      for (const e of eps) {
        if (!map.has(e.season)) map.set(e.season, []);
        map.get(e.season).push({ ...e, playable: !!e.playable });
      }
      seasons = [...map].map(([season, episodes]) => ({ season, episodes }));
    }
    const primary = title.genres[0];
    const similar = primary ? listTitles({ genre: primary, sort: 'popular', limit: 13 }).items.filter((t) => t.id !== title.id).slice(0, 12) : [];
    res.json({ title, seasons, similar });
  });

  // Fuente de reproducción de una película o de un episodio
  app.get('/api/watch/:id', auth, (req, res) => {
    const id = Number(req.params.id);
    const row = q.get('SELECT * FROM titles WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Título no encontrado');
    const title = getTitle(id);
    let src;
    let episode = null;
    let next = null;
    if (row.type === 'movie') {
      src = row;
    } else {
      const eps = q.all('SELECT * FROM episodes WHERE title_id = ? ORDER BY season, number', id);
      const wanted = Number(req.query.episode);
      const idx = wanted ? eps.findIndex((e) => e.id === wanted) : eps.findIndex((e) => e.video_url);
      if (idx < 0) throw new HttpError(404, 'Episodio no encontrado');
      src = eps[idx];
      episode = { id: src.id, season: src.season, number: src.number, name: src.name };
      const nx = eps.slice(idx + 1).find((e) => e.video_url);
      if (nx) next = { id: nx.id, season: nx.season, number: nx.number, name: nx.name };
    }
    if (!src.video_url) throw new HttpError(404, 'Este contenido aún no tiene una fuente de reproducción autorizada');
    if (!isUrlAllowed(src.video_url)) throw new HttpError(403, 'La fuente de este contenido ya no está autorizada. Contacta al administrador.');
    res.json({
      title: { id: title.id, type: title.type, title: title.title, backdrop_url: title.backdrop_url },
      episode,
      next,
      source: { type: src.video_type, url: src.video_url },
      subtitles: parseSubs(src.subtitles),
    });
  });

  // Contador de reproducciones (para "Populares")
  app.post('/api/titles/:id/view', auth, (req, res) => {
    q.run('UPDATE titles SET views = views + 1 WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  });
};
