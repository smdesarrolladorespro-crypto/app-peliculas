'use strict';
const { q } = require('./db');

const CARD_COLS = `t.id, t.type, t.title, t.overview, t.year, t.rating, t.runtime, t.poster_url, t.backdrop_url,
  t.featured, t.views, t.created_at,
  (SELECT group_concat(g.slug) FROM title_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.title_id = t.id) AS genre_slugs,
  CASE WHEN t.type = 'movie' THEN (t.video_url IS NOT NULL)
       ELSE EXISTS (SELECT 1 FROM episodes e WHERE e.title_id = t.id AND e.video_url IS NOT NULL) END AS playable`;

function shape(r) {
  const { genre_slugs, ...rest } = r;
  return { ...rest, featured: !!r.featured, playable: !!r.playable, genres: genre_slugs ? genre_slugs.split(',') : [] };
}

const ORDERS = {
  recent: 't.id DESC',
  popular: 't.views DESC, t.rating DESC, t.id DESC',
  rating: 't.rating DESC, t.id DESC',
  year: 't.year DESC, t.id DESC',
  az: 't.title COLLATE NOCASE ASC',
};

function listTitles({ type, genre, text, sort = 'recent', limit = 40, offset = 0, featured, ids } = {}) {
  const where = [];
  const params = [];
  if (type === 'movie' || type === 'series') { where.push('t.type = ?'); params.push(type); }
  if (genre) { where.push('EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id = tg.genre_id WHERE tg.title_id = t.id AND g.slug = ?)'); params.push(genre); }
  if (text) {
    const like = `%${String(text).replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.overview LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }
  if (featured) where.push('t.featured = 1');
  if (ids) { where.push(`t.id IN (${ids.map(() => '?').join(',') || 'NULL'})`); params.push(...ids); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = q.get(`SELECT COUNT(*) AS n FROM titles t ${w}`, ...params).n;
  const items = q.all(
    `SELECT ${CARD_COLS} FROM titles t ${w} ORDER BY ${ORDERS[sort] || ORDERS.recent} LIMIT ? OFFSET ?`,
    ...params, Math.min(Number(limit) || 40, 100), Math.max(Number(offset) || 0, 0)
  ).map(shape);
  return { items, total };
}

function getTitle(id) {
  const r = q.get(`SELECT ${CARD_COLS} FROM titles t WHERE t.id = ?`, id);
  return r ? shape(r) : null;
}

function parseSubs(s) {
  try { return JSON.parse(s || '[]'); } catch { return []; }
}

module.exports = { listTitles, getTitle, shape, CARD_COLS, parseSubs };
