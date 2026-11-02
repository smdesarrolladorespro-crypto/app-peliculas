import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const csv = value => (value ?? '').split(',').map(x => x.trim()).filter(Boolean);

export const config = Object.freeze({
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  host: '0.0.0.0',
  language: process.env.TMDB_LANGUAGE ?? 'es-ES',
  tmdbApiKey: process.env.TMDB_API_KEY ?? '',
  tmdbBearerToken: process.env.TMDB_BEARER_TOKEN ?? '',
  tmdbApiBase: process.env.TMDB_API_BASE ?? 'https://api.themoviedb.org/3',
  posterBase: process.env.TMDB_POSTER_BASE ?? 'https://image.tmdb.org/t/p/w500',
  backdropBase: process.env.TMDB_BACKDROP_BASE ?? 'https://image.tmdb.org/t/p/w780',
  corsOrigins: csv(process.env.CORS_ORIGINS),
  mediaSourceHosts: csv(process.env.MEDIA_SOURCE_HOSTS).map(x => x.toLowerCase()),
  catalogPath: resolve(process.env.CATALOG_PATH ?? resolve(here, 'data/catalog.json')),
  cacheTtlMs: Number.parseInt(process.env.CACHE_TTL_MS ?? '300000', 10),
  rateLimitWindowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX ?? '120', 10)
});