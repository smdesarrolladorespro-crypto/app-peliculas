'use strict';
// Cliente TMDB opcional. Solo aporta METADATOS (título, sinopsis, póster, calificación, géneros,
// temporadas y episodios). TMDB no otorga derechos de reproducción: la fuente de video siempre
// la define el administrador y debe ser una fuente autorizada (ver sources.js).
const { TMDB_API_KEY } = require('./config');
const { HttpError } = require('./lib/http');

const API = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

const GENRE_MAP = {
  28: 'accion', 12: 'accion', 53: 'accion', 10759: 'accion', 10752: 'accion', 37: 'accion',
  27: 'terror', 9648: 'terror',
  35: 'comedia', 10751: 'comedia',
  10749: 'romance',
  878: 'ciencia-ficcion', 14: 'ciencia-ficcion', 10765: 'ciencia-ficcion',
  18: 'drama', 80: 'drama', 36: 'drama', 10768: 'drama', 10766: 'drama',
  16: 'animacion',
  99: 'documentales',
};

const enabled = () => !!TMDB_API_KEY;

async function call(path, params = {}) {
  if (!enabled()) throw new HttpError(503, 'TMDB no está configurado. Define TMDB_API_KEY en el archivo .env');
  const url = new URL(API + path);
  url.searchParams.set('language', 'es-ES');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (TMDB_API_KEY.length > 40) headers.Authorization = `Bearer ${TMDB_API_KEY}`; // token v4
  else url.searchParams.set('api_key', TMDB_API_KEY);
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) }); } catch { throw new HttpError(502, 'No se pudo conectar con TMDB'); }
  if (r.status === 401) throw new HttpError(502, 'La clave de TMDB no es válida');
  if (!r.ok) throw new HttpError(502, `TMDB respondió con error ${r.status}`);
  return r.json();
}

const poster = (p) => (p ? `${IMG}/w500${p}` : null);
const backdrop = (p) => (p ? `${IMG}/w1280${p}` : null);
const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) || null : null);

function slugsFromIds(ids) {
  return [...new Set((ids || []).map((id) => GENRE_MAP[id]).filter(Boolean))];
}

async function search(query, type) {
  const kind = type === 'series' ? 'tv' : 'movie';
  const data = await call(`/search/${kind}`, { query, include_adult: 'false' });
  return (data.results || []).slice(0, 12).map((r) => ({
    tmdb_id: r.id,
    type,
    title: r.title || r.name,
    overview: r.overview || '',
    year: yearOf(r.release_date || r.first_air_date),
    rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    poster_url: poster(r.poster_path),
    backdrop_url: backdrop(r.backdrop_path),
    genres: slugsFromIds(r.genre_ids),
  }));
}

async function details(tmdbId, type) {
  const kind = type === 'series' ? 'tv' : 'movie';
  const d = await call(`/${kind}/${Number(tmdbId)}`);
  const out = {
    tmdb_id: d.id,
    type,
    title: d.title || d.name,
    overview: d.overview || '',
    year: yearOf(d.release_date || d.first_air_date),
    rating: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
    runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || null,
    poster_url: poster(d.poster_path),
    backdrop_url: backdrop(d.backdrop_path),
    genres: slugsFromIds((d.genres || []).map((g) => g.id)),
  };
  if (type === 'series') {
    out.seasons = (d.seasons || []).filter((s) => s.season_number > 0).map((s) => ({ season: s.season_number, episodes: s.episode_count }));
  }
  return out;
}

async function season(tmdbId, seasonNumber) {
  const d = await call(`/tv/${Number(tmdbId)}/season/${Number(seasonNumber)}`);
  return (d.episodes || []).map((e) => ({ season: d.season_number, number: e.episode_number, name: e.name || `Episodio ${e.episode_number}`, overview: e.overview || '', runtime: e.runtime || null }));
}

module.exports = { enabled, search, details, season };
