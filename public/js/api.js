// Estado global de sesión y cliente de la API.
export const S = {
  user: null,
  profiles: [],
  profile: null,
  favs: new Set(),
  onAuthLost: null,
};

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  const headers = { 'X-Requested-With': 'cineplus' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (S.profile) headers['X-Profile-Id'] = String(S.profile.id);
  let r;
  try {
    // keepalive en el historial: el progreso se guarda aunque se cierre la pestaña
    r = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin', keepalive: method === 'POST' && url === '/api/history' });
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0);
  }
  let data = null;
  try { data = await r.json(); } catch { /* sin cuerpo */ }
  if (!r.ok) {
    const isLogin = url.startsWith('/api/auth/login') || url.startsWith('/api/auth/register');
    if (r.status === 401 && !isLogin && S.user && S.onAuthLost) S.onAuthLost();
    const err = new ApiError((data && data.error) || `Error ${r.status}`, r.status);
    err.data = data; // datos extra del servidor (p. ej. code: 'host_not_allowed')
    throw err;
  }
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const put = (u, b = {}) => api('PUT', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u);

export async function loadFavs() {
  if (!S.profile) { S.favs = new Set(); return; }
  const d = await get('/api/favorites');
  S.favs = new Set(d.ids);
}

export async function toggleFav(titleId) {
  const on = S.favs.has(titleId);
  if (on) { await del(`/api/favorites/${titleId}`); S.favs.delete(titleId); }
  else { await put(`/api/favorites/${titleId}`); S.favs.add(titleId); }
  return !on;
}

export function setSession(payload) {
  S.user = payload.user;
  S.profiles = payload.profiles;
  const saved = Number(localStorage.getItem('cp_profile_' + S.user.id));
  S.profile = S.profiles.find((p) => p.id === saved) || (S.profiles.length === 1 ? S.profiles[0] : null);
}

export function selectProfile(p) {
  S.profile = p;
  try { localStorage.setItem('cp_profile_' + S.user.id, String(p.id)); } catch { /* ignorar */ }
}

export function clearSession() {
  S.user = null; S.profiles = []; S.profile = null; S.favs = new Set();
}
