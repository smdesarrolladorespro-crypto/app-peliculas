'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PORT, PUBLIC_DIR, UPLOAD_DIR, IS_PROD, TRUST_PROXY } = require('./config');
const { createApp, HttpError } = require('./lib/http');
const { seed } = require('./seed');
const { allowedHosts } = require('./sources');

function build() {
  const app = createApp({ trustProxy: TRUST_PROXY });

  // Cabeceras de seguridad. Los reproductores embebidos y los videos directos requieren permitir
  // esos orígenes: frame-src se calcula con los dominios autorizados vigentes en cada petición.
  const FRAME_BASE = ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://archive.org'];
  app.setHeaders(() => ({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "media-src 'self' https: blob:",
      "connect-src 'self' https:",
      `frame-src ${[...new Set([...FRAME_BASE, ...allowedHosts().flatMap((h) => [`https://${h}`, `https://*.${h}`])])].join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
  }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Verificación de la app Android (Digital Asset Links). El administrador sube el archivo
  // assetlinks.json (el que entrega PWABuilder) a public/ y se publica en /.well-known/assetlinks.json.
  app.get('/.well-known/assetlinks.json', (req, res) => {
    let body;
    try { body = fs.readFileSync(path.join(PUBLIC_DIR, 'assetlinks.json')); } catch { throw new HttpError(404, 'No encontrado'); }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  });

  require('./routes/auth')(app);
  require('./routes/catalog')(app);
  require('./routes/me')(app);
  require('./routes/admin')(app);

  app.static('/uploads', UPLOAD_DIR);
  app.static('/', PUBLIC_DIR, { spa: true });
  return app;
}

async function start() {
  await seed();
  const app = build();
  app.listen(PORT, () => console.log(`CINEPLUS en http://localhost:${PORT}`));
}

if (require.main === module) start().catch((e) => { console.error(e); process.exit(1); });

module.exports = { build, start };
