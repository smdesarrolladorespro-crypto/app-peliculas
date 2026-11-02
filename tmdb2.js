import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { cached } from './cache.js';

const allowedTypes = new Set(['movie', 'tv']);

export class TmdbService {
  async request(path, params = {}) {
    if (!config.tmdbApiKey && !config.tmdbBearerToken) {
      throw new HttpError(503, 'El servicio de metadatos no está configurado', 'METADATA_NOT_CONFIGURED');
    }
    const base = `${config.tmdbApiBase.replace(/\/+$/, '')}/`;
    const url = new URL(path.replace(/^\/+/, ''), base);
    url.searchParams.set('language', config.language);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    if (config.tmdbApiKey) url.searchParams.set('api_key', config.tmdbApiKey);

    return cached(`tmdb:${url.pathname}?${url.searchParams}`, config.cacheTtlMs, async () => {
      let response;
      try {
        response = await fetch(url, {
          headers: config.tmdbBearerToken ? { Authorization: `Bearer ${config.tmdbBearerToken}` } : {},
          signal: AbortSignal.timeout(8000)
        });
      } catch (cause) {
        const error = new HttpError(502, 'No fue posible consultar el proveedor de metadatos', 'METADATA_UPSTREAM_ERROR');
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        throw new HttpError(502, `El proveedor de metadatos respondió ${response.status}`, 'METADATA_UPSTREAM_ERROR');
      }
      try {
        return await response.json();
      } catch (cause) {
        const error = new HttpError(502, 'Respuesta JSON inválida del proveedor de metadatos', 'METADATA_INVALID_RESPONSE');
        error.cause = cause;
        throw error;
      }
    });
  }

  mapTitle(item, type) {
    return {
      id: item.id,
      type,
      title: item.title ?? item.name ?? '',
      overview: item.overview ?? '',
      posterUrl: item.poster_path ? `${config.posterBase}${item.poster_path}` : null,
      backdropUrl: item.backdrop_path ? `${config.backdropBase}${item.backdrop_path}` : null,
      rating: Number.isFinite(item.vote_average) ? item.vote_average : null,
      releaseDate: item.release_date ?? item.first_air_date ?? null
    };
  }

  mapEpisode(item) {
    return {
      id: item.id,
      episodeNumber: item.episode_number,
      seasonNumber: item.season_number,
      title: item.name ?? '',
      overview: item.overview ?? '',