'use strict';
// Datos iniciales: géneros, administrador y un catálogo de contenido legal y gratuito:
// películas abiertas de la Blender Foundation (licencia Creative Commons) y cortos/películas
// de dominio público del Internet Archive. Los pósteres se generan localmente (SVG) para no
// depender de terceros ni usar material protegido.
const crypto = require('crypto');
const { q, tx, getSetting, setSetting } = require('./db');
const { hashPassword } = require('./lib/security');
const { ADMIN_EMAIL, ADMIN_PASSWORD, IS_PROD } = require('./config');

const GENRES = [
  ['accion', 'Acción'], ['terror', 'Terror'], ['comedia', 'Comedia'], ['romance', 'Romance'],
  ['ciencia-ficcion', 'Ciencia ficción'], ['drama', 'Drama'], ['animacion', 'Animación'], ['documentales', 'Documentales'],
];

const BLENDER = 'https://download.blender.org';
const IA = 'https://archive.org/download';

// Cada elemento: datos + fuente. Si una URL llegara a cambiar, el administrador puede
// corregirla desde el panel sin tocar el código.
const CATALOG = [
  { type: 'movie', title: 'Big Buck Bunny', year: 2008, rating: 7.2, runtime: 10, genres: ['animacion', 'comedia'], featured: 1,
    overview: 'Un enorme y amable conejo se enfrenta a tres roedores traviesos que arruinan su tranquila mañana en el bosque. Cortometraje abierto de la Blender Foundation (CC BY 3.0).',
    video: ['mp4', `${BLENDER}/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4`] },
  { type: 'movie', title: 'Sintel', year: 2010, rating: 7.4, runtime: 15, genres: ['animacion', 'accion', 'drama'], featured: 1,
    overview: 'Una joven guerrera busca a su dragón perdido en un viaje que la llevará hasta los confines del mundo. Cortometraje abierto de la Blender Foundation (CC BY 3.0).',
    video: ['mp4', `${IA}/Sintel/sintel-2048-surround_512kb.mp4`] },
  { type: 'movie', title: 'Tears of Steel', year: 2012, rating: 6.9, runtime: 12, genres: ['ciencia-ficcion', 'accion'], featured: 1,
    overview: 'En un Ámsterdam futurista, un grupo de guerreros y científicos intenta salvar el mundo de los robots que lo amenazan. Película abierta de la Blender Foundation (CC BY 3.0).',
    video: ['mp4', `${BLENDER}/demo/movies/ToS/tears_of_steel_720p.mov`] },
  { type: 'movie', title: 'Elephants Dream', year: 2006, rating: 6.1, runtime: 11, genres: ['ciencia-ficcion', 'animacion'], featured: 0,
    overview: 'Dos hombres exploran una extraña y laberíntica máquina surrealista. Primera película abierta del mundo, de la Blender Foundation (CC BY 2.5).',
    video: ['mp4', `${IA}/ElephantsDream/ed_1024_512kb.mp4`] },
  { type: 'movie', title: 'Cosmos Laundromat', year: 2015, rating: 7.0, runtime: 12, genres: ['animacion', 'comedia', 'ciencia-ficcion'], featured: 0,
    overview: 'Un ovino con ganas de acabar con todo conoce a un vendedor misterioso que le ofrece una nueva vida. Película abierta de la Blender Foundation (CC BY 4.0).',
    video: ['mp4', `${BLENDER}/film/cosmoslaundromat/cosmoslaundromat_1080p.mp4`] },
  { type: 'movie', title: 'La noche de los muertos vivientes', year: 1968, rating: 7.8, runtime: 96, genres: ['terror'], featured: 1,
    overview: 'Un grupo de desconocidos se refugia en una casa rural mientras los muertos regresan a la vida. Clásico del cine de terror, en dominio público.',
    video: ['mp4', `${IA}/Night.Of.The.Living.Dead_1080p/Night.Of.The.Living.Dead_1080p.mp4`] },
  { type: 'movie', title: 'Nosferatu', year: 1922, rating: 7.9, runtime: 94, genres: ['terror', 'drama'], featured: 0,
    overview: 'Un conde misterioso viaja desde Transilvania hasta Wisborg, sembrando muerte a su paso. Obra maestra del expresionismo alemán, en dominio público.',
    video: ['mp4', `${IA}/Nosferatu_201701/Nosferatu.mp4`] },
  { type: 'movie', title: 'Metrópolis', year: 1927, rating: 8.0, runtime: 153, genres: ['ciencia-ficcion', 'drama'], featured: 0,
    overview: 'En una ciudad futurista dividida en clases, el hijo del gobernante descubre la vida de los obreros. Clásico de la ciencia ficción, en dominio público en EE. UU.',
    video: ['mp4', `${IA}/Metropolis1927/Metropolis1927.mp4`] },
  { type: 'movie', title: 'El gabinete del doctor Caligari', year: 1920, rating: 8.0, runtime: 76, genres: ['terror', 'drama'], featured: 0,
    overview: 'Un siniestro doctor exhibe a un sonámbulo que predice el futuro y comete crímenes. Hito del expresionismo alemán, en dominio público.',
    video: ['mp4', `${IA}/TheCabinetOfDrCaligari1920/TheCabinetOfDrCaligari1920.mp4`] },
  { type: 'movie', title: 'El chico', year: 1921, rating: 8.2, runtime: 68, genres: ['comedia', 'drama'], featured: 0,
    overview: 'Un vagabundo cría a un niño abandonado hasta que las autoridades intentan separarlos. Obra de Charles Chaplin, en dominio público en EE. UU.',
    video: ['mp4', `${IA}/TheKid_201801/TheKid.mp4`] },
  { type: 'movie', title: 'Un viaje a la Luna', year: 1902, rating: 8.0, runtime: 14, genres: ['ciencia-ficcion', 'comedia'], featured: 0,
    overview: 'Un grupo de astrónomos viaja a la Luna en una cápsula disparada por un cañón. Clásico de Georges Méliès, en dominio público.',
    video: ['mp4', `${IA}/levoyagedanslalune/levoyagedanslalune.mp4`] },
  { type: 'movie', title: 'Nanook, el esquimal', year: 1922, rating: 7.4, runtime: 79, genres: ['documentales'], featured: 0,
    overview: 'Retrato de la vida cotidiana de una familia inuit en el Ártico canadiense. Documental pionero de Robert Flaherty, en dominio público.',
    video: ['mp4', `${IA}/NanookOfTheNorth1922/NanookOfTheNorth1922.mp4`] },
  { type: 'series', title: 'Mini Serie Abierta (Demo)', year: 2024, rating: 7.0, genres: ['animacion', 'comedia'], featured: 1,
    overview: 'Serie de demostración que reúne cortos abiertos de la Blender Foundation como episodios, para mostrar el soporte de temporadas y episodios. Reemplázala o amplíala desde el panel de administración.',
    episodes: [
      [1, 1, 'Big Buck Bunny', 10, ['mp4', `${BLENDER}/peach/bigbuckbunny_movies/BigBuckBunny_320x180.mp4`]],
      [1, 2, 'Sintel', 15, ['mp4', `${IA}/Sintel/sintel-2048-surround_512kb.mp4`]],
      [2, 1, 'Tears of Steel', 12, ['mp4', `${BLENDER}/demo/movies/ToS/tears_of_steel_720p.mov`]],
      [2, 2, 'Cosmos Laundromat', 12, ['mp4', `${BLENDER}/film/cosmoslaundromat/cosmoslaundromat_1080p.mp4`]],
    ] },
];

function posterSvg(title, hue, w, h, sub) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const words = title.split(' ');
  const lines = [];
  let cur = '';
  const maxChars = w > h ? 28 : 14;
  for (const wd of words) {
    if ((cur + ' ' + wd).trim().length > maxChars) { lines.push(cur.trim()); cur = wd; } else cur += ' ' + wd;
  }
  if (cur.trim()) lines.push(cur.trim());
  const size = w > h ? 56 : 44;
  const startY = h / 2 - ((lines.length - 1) * size * 1.1) / 2;
  const text = lines.map((l, i) => `<text x="${w / 2}" y="${startY + i * size * 1.1}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="${size}" fill="#fff">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},70%,28%)"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
<radialGradient id="r" cx=".3" cy=".2" r=".8"><stop offset="0" stop-color="hsl(${hue},90%,55%)" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#r)"/>
<rect x="0" y="${h - 8}" width="${w}" height="8" fill="#e50914"/>${w > h ? '' : text}
<text x="${w / 2}" y="${h - 36}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${w > h ? 20 : 17}" letter-spacing="4" fill="#fff" fill-opacity=".7">${w > h ? '' : esc(sub)}</text></svg>`;
}
const svgUri = (s) => 'data:image/svg+xml;base64,' + Buffer.from(s).toString('base64');

async function seed() {
  const now = Date.now();
  tx(() => {
    GENRES.forEach(([slug, name], i) => q.run('INSERT OR IGNORE INTO genres (slug, name, position) VALUES (?,?,?)', slug, name, i));
  });

  // Administrador inicial
  if (!q.get("SELECT id FROM users WHERE role = 'admin'")) {
    let pwd = ADMIN_PASSWORD;
    let generated = false;
    if (!pwd) { pwd = crypto.randomBytes(9).toString('base64url') + '9a'; generated = true; }
    const hash = await hashPassword(pwd);
    tx(() => {
      const r = q.run("INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?,?,?,'admin',?)", 'Administrador', ADMIN_EMAIL, hash, now);
      q.run("INSERT INTO profiles (user_id, name, avatar_color, created_at) VALUES (?,?,?,?)", r.lastInsertRowid, 'Administrador', '#e50914', now);
    });
    console.log('\n=== Administrador creado ===');
    console.log(`  Correo:     ${ADMIN_EMAIL}`);
    if (generated) console.log(`  Contraseña: ${pwd}   (generada; guárdala, no se volverá a mostrar)`);
    else console.log('  Contraseña: la definida en ADMIN_PASSWORD');
    console.log('============================\n');
  }

  // Catálogo inicial: se carga UNA sola vez (con la base vacía). Después queda marcado, para que
  // lo que el administrador borre o edite no reaparezca al reiniciar el servidor.
  const firstTime = getSetting('catalog_seeded') === null;
  if (firstTime) setSetting('catalog_seeded', String(now));
  if (firstTime && q.get('SELECT COUNT(*) n FROM titles').n === 0 && process.env.SEED_CATALOG !== '0') {
    tx(() => {
      CATALOG.forEach((c, i) => {
        const hue = (i * 47 + 350) % 360;
        const sub = c.type === 'series' ? 'SERIE' : 'PELÍCULA';
        const r = q.run(
          `INSERT INTO titles (type, title, overview, year, rating, runtime, poster_url, backdrop_url, video_type, video_url, featured, views, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          c.type, c.title, c.overview, c.year, c.rating, c.runtime || null,
          svgUri(posterSvg(c.title, hue, 400, 600, `${sub} · ${c.year}`)),
          svgUri(posterSvg(c.title, hue, 1280, 720, `${sub} · ${c.year}`)),
          c.video ? c.video[0] : 'mp4', c.video ? c.video[1] : null, c.featured, Math.round(Math.random() * 500), now - i * 86_400_000
        );
        for (const slug of c.genres) q.run('INSERT INTO title_genres (title_id, genre_id) SELECT ?, id FROM genres WHERE slug = ?', r.lastInsertRowid, slug);
        for (const [season, number, name, runtime, video] of c.episodes || []) {
          q.run('INSERT INTO episodes (title_id, season, number, name, runtime, video_type, video_url) VALUES (?,?,?,?,?,?,?)', r.lastInsertRowid, season, number, name, runtime, video[0], video[1]);
        }
      });
    });
    console.log(`Catálogo inicial cargado (${CATALOG.length} títulos de fuentes abiertas).`);
  }
}

module.exports = { seed };
