'use strict';
// Service worker: hace la app instalable (PWA / APK), abre la "cáscara" al instante desde el dispositivo
// (así, si el servidor gratuito está dormido, se ve la animación de CINEPLUS y no la página de espera del
// hosting) y recibe notificaciones push. Nunca guarda /api, /uploads ni video: siempre van a la red.
const CACHE = 'cineplus-shell-v3';
const SHELL = [
  '/', '/css/styles.css',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/player.js', '/js/landscape.js', '/js/push.js', '/js/admin.js',
  '/img/icon.svg', '/img/icon-192.png', '/img/icon-512.png', '/manifest.webmanifest', '/offline.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Lo guardado se sirve al instante y se actualiza en segundo plano (la nueva versión se ve en la siguiente apertura).
// Solo se guardan respuestas que llevan la marca X-App de CINEPLUS: así nunca se guarda la página de espera del hosting.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|uploads|\.well-known)\//.test(url.pathname) || url.pathname === '/sw.js') return;
  if (req.headers.has('range')) return;
  const nav = req.mode === 'navigate';
  const key = nav ? '/' : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    const refresh = fetch(req).then(async (res) => {
      if (res.ok && res.headers.get('x-app') === 'cineplus') await cache.put(key, res.clone());
      return res;
    });
    if (cached) { e.waitUntil(refresh.catch(() => {})); return cached; }
    try { return await refresh; } catch { return (nav && (await cache.match('/offline.html'))) || Response.error(); }
  })());
});

// Notificaciones push
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CINEPLUS', {
    body: d.body || '', icon: d.icon || '/img/icon-192.png', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.startsWith(self.location.origin) && 'focus' in c) { if ('navigate' in c) c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
