const base = 'https://api.themoviedb.org/3';
const language = process.env.TMDB_LANGUAGE ?? 'es-ES';

export class TmdbService {
  async request(path, params = {}) {
    if (!process.env.TMDB_API_KEY && !process.env.TMDB_BEARER_TOKEN) {
      const e = new Error('Configura TMDB_API_KEY o TMDB_BEARER_TOKEN'); e.status = 503; throw e;
    }
    const url = new URL(`${base}${path}`);
    url.searchParams.set('language', language);
    Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
    if (process.env.TMDB_API_KEY) url.searchParams.set('api_key', process.env.TMDB_API_KEY);
    const headers = process.env.TMDB_BEARER_TOKEN ? { Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}` } : {};
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
    if (!response.ok) { const e = new Error(`Proveedor de metadatos respondió ${response.status}`); e.status = 502; throw e; }
    return response.json();
  }

  map(item, type) {
    const posterBase = process.env.TMDB_POSTER_BASE ?? 'https://image.tmdb.org/t/p/w500';
    const backdropBase = process.env.TMDB_BACKDROP_BASE ?? 'https://image.tmdb.org/t/p/w780';
    return {
      id: item.id, type, title: item.title ?? item.name ?? '',
      overview: item.overview ?? '', posterUrl: item.poster_path ? `${posterBase}${item.poster_path}` : null,
      backdropUrl: item.backdrop_path ? `${backdropBase}${item.backdrop_path}` : null,
      rating: item.vote_average ?? null, releaseDate: item.release_date ?? item.first_air_date ?? null
    };
  }

  async list(type, category, page = 1) {
    const route = category === 'trending' ? `/trending/${type}/week` : `/${type}/popular`;
    const data = await this.request(route, { page });
    return { page: data.page, totalPages: data.total_pages, items: (data.results ?? []).map(x => this.map(x, type)) };
  }
  async search(query, page = 1) {
    const data = await this.request('/search/multi', { query, page, include_adult: false });
    return { page: data.page, totalPages: data.total_pages, items: (data.results ?? []).filter(x => ['movie','tv'].includes(x.media_type)).map(x => this.map(x, x.media_type)) };
  }
  async details(type, id) {
    const data = await this.request(`/${type}/${encodeURIComponent(id)}`);
    return this.map(data, type);
  }
}
export const tmdb = new TmdbService();