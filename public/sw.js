'use strict';
// Service worker mínimo: hace la app instalable (PWA / APK) y guarda solo la "cáscara" estática.
// Nunca guarda /api ni /uploads ni video: siempre van a la red.
const CACHE = 'cineplus-shell-v1';
const SHELL = ['/', '/css/styles.css', '/js/app.js', '/img/icon-192.png', '/offline.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return;
  if (req.headers.has('range')) return;
  // Red primero; si falla, lo guardado; si es una página, la pantalla sin conexión.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('/offline.html') : Response.error()))),
  );
});
