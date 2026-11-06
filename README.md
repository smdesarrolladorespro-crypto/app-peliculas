# CINEPLUS

Plataforma web de películas y series con tema oscuro (negro, rojo y gris), diseño adaptable
(teléfono, tablet y escritorio), cuentas de usuario, perfiles, favoritos, historial, reproductor
propio y panel de administración. Pensada para contenido **gratuito de fuentes legales**
(dominio público y licencias abiertas) con una arquitectura lista para añadir nuevas fuentes autorizadas.

**Sin dependencias externas**: solo Node.js ≥ 22.13 (usa `node:sqlite`, `crypto` y `http` integrados).
No hace falta `npm install`.

## Puesta en marcha

```bash
cp .env.example .env        # opcional en desarrollo
npm start                   # http://localhost:3000
```

La primera vez se crea el administrador (`ADMIN_EMAIL`, por defecto `admin@cineplus.local`). Si no
defines `ADMIN_PASSWORD`, se genera una contraseña aleatoria que **se imprime una sola vez** en la consola.
También se carga un catálogo inicial de ejemplo (películas abiertas de la Blender Foundation y clásicos
de dominio público) que puedes editar o borrar desde el panel.

```bash
npm test                    # 12 pruebas de la API con una base de datos temporal
npm run dev                 # reinicia al cambiar archivos
```

## Estructura

```
server/
  index.js          arranque, cabeceras de seguridad (CSP, etc.) y montaje de rutas
  config.js         .env, rutas de datos, secreto JWT
  db.js             esquema SQLite (users, profiles, titles, genres, episodes, favorites, history…)
  sources.js        ★ fuentes de video autorizadas (lista blanca de dominios y tipos)
  tmdb.js           cliente TMDB opcional (solo metadatos)
  archive.js        importador de Internet Archive (búsqueda y archivos MP4)
  mailer.js         punto de extensión para enviar correo
  seed.js           géneros, administrador y catálogo inicial
  middleware.js     auth (cookie JWT), rol admin, perfil activo
  lib/http.js       mini router, estáticos con Range, límites de tasa, CSRF
  lib/security.js   scrypt para contraseñas y JWT HS256
  routes/           auth.js · catalog.js · me.js (perfiles, favoritos, historial) · admin.js
public/
  index.html, css/styles.css
  js/app.js         SPA: enrutador, bienvenida, acceso, inicio, catálogo, detalle, favoritos, historial, perfil
  js/player.js      reproductor con adaptadores (mp4, hls, youtube, embed)
  js/admin.js       panel de administración
  js/ui.js, api.js  utilidades y cliente de la API
test/smoke.js
```

## Funcionalidades

- **Flujo**: pantalla de bienvenida (splash) → iniciar sesión / crear cuenta → elegir perfil → inicio.
- **Inicio**: héroe con destacados, *Continuar viendo*, *Populares*, *Estrenos*, Películas, Series y una fila por género.
- **Secciones**: Inicio, Películas, Series, Géneros (Acción, Terror, Comedia, Romance, Ciencia ficción, Drama, Animación, Documentales), Favoritos, Mi perfil, Historial. Buscador en la barra superior.
- **Cuentas**: registro (nombre, correo, contraseña), login/logout, recuperación de contraseña por enlace de un solo uso (30 min), sesión persistente (“mantener sesión”: cookie de 30 días), cambio de nombre y contraseña.
- **Perfiles** (hasta 5 por cuenta): cada uno con sus propios favoritos e historial.
- **Reproductor**: pausa, ±10 s, barra de progreso (ratón y táctil), volumen, velocidad, subtítulos WebVTT, pantalla completa, atajos de teclado (espacio/K, ←/→, ↑/↓, M, F, C), reanudar donde quedó, temporadas/episodios y cuenta atrás al siguiente episodio.
- **Administración** (`#/admin`, solo rol admin): alta/edición/baja de películas y series, portadas (URL o subida), temporadas y episodios, subtítulos, destacar en el inicio, autocompletar con TMDB, importar fuentes desde Internet Archive, gestión de usuarios (rol, bloquear, eliminar).

## Fuentes legales y cómo añadir nuevas

CINEPLUS **no aloja ni enlaza contenido protegido**. Cada título/episodio guarda un tipo y una URL de
una fuente autorizada, y el servidor (`server/sources.js`) solo acepta:

- URLs **HTTPS** de dominios de la lista blanca (por defecto: `archive.org`, `download.blender.org`,
  `storage.googleapis.com`, YouTube, Vimeo, Dailymotion) o archivos propios en `data/uploads/`.
- Tipos: `mp4` (archivo directo), `hls` (.m3u8), `youtube`, `embed` (iframe).

Para autorizar **un sitio nuevo** no hace falta tocar archivos: en el panel, pestaña **Fuentes**, escribe el sitio
y confirma que tienes derecho a usar su contenido. También puedes pegar el enlace en una película o episodio:
si su sitio no está autorizado, la app pregunta “¿Autorizar y guardar?”. Desde la misma pestaña puedes desactivar
cualquier sitio (también los de por defecto) y quitar los que agregaste; si desactivas un sitio, los títulos que lo
usan dejan de reproducirse. Si un tipo de fuente necesita otro reproductor, agrega un adaptador en
`public/js/player.js` y el tipo en `TYPES` de `server/sources.js`. `ALLOWED_SOURCE_HOSTS` (.env) sigue disponible como
complemento opcional.

Eres responsable de contar con los derechos o licencias de todo lo que publiques. Los datos de TMDB
(pósteres, sinopsis, calificaciones) **no otorgan derechos de reproducción**.

**Importar desde Internet Archive (panel de administración)**: al crear/editar una película, el botón
“Importar de Internet Archive” busca por título o colección (largometrajes, cine mudo, ciencia ficción y terror,
TV clásica, animación), muestra la licencia declarada por cada ítem y te deja elegir el archivo MP4. Rellena
título, sinopsis, año, duración, miniatura y URL de video; luego puedes mejorar el póster con TMDB. En las series,
cada episodio tiene su propio botón “Elegir de Internet Archive”. Internet Archive también aloja material con
derechos reservados: revisa la ficha y usa solo dominio público o licencias abiertas.

**Video propio autorizado**: copia el archivo a `data/uploads/` (p. ej. `mi-pelicula.mp4`) y usa como
URL `/uploads/mi-pelicula.mp4`; el servidor soporta peticiones Range, por lo que se puede adelantar/retroceder.

**HLS**: Safari lo reproduce de forma nativa. Para el resto de navegadores descarga `hls.min.js`
(hls.js) a `public/vendor/hls.min.js`; el reproductor lo carga solo cuando hace falta (la CSP solo permite scripts propios).

## TMDB (opcional)

Define `TMDB_API_KEY` en `.env`. En el editor del panel aparece “Autocompletar con TMDB” (título,
sinopsis, año, calificación, géneros, póster y fondo) y, para series con TMDB ID, “Importar temporada”
(solo nombres y sinopsis de episodios; las fuentes las añades tú).

## Seguridad

- Contraseñas con **scrypt** + sal; JWT HS256 en cookie `HttpOnly` + `SameSite=Lax` (`Secure` en producción).
- Cambiar contraseña o bloquear/cambiar el rol de un usuario **invalida sus sesiones** (`token_version`).
- Rutas privadas y de administración verificadas **en el servidor** en cada petición (el frontend solo las oculta).
- Protección CSRF con cabecera obligatoria en peticiones que modifican datos; sin CORS.
- Límite de intentos en login/registro/recuperación; mensaje genérico para no revelar si un correo existe.
- CSP estricta (`script-src 'self'`), `X-Frame-Options`, `nosniff`; el DOM se construye sin `innerHTML`.
- Subidas: se valida el contenido real del archivo (JPG/PNG/WebP/VTT, máx. 5 MB) y se sirven con CSP restrictiva.

### Antes de publicarla en Internet
- `NODE_ENV=production` y un `JWT_SECRET` propio (la app no arranca sin él).
- Ponla detrás de HTTPS (nginx/Caddy) y activa `TRUST_PROXY=1`.
- **Correo**: `server/mailer.js` envía por la API de Brevo o Resend (`BREVO_API_KEY`/`RESEND_API_KEY` + `MAIL_FROM`); sin proveedor solo imprime en consola. En producción el enlace de recuperación nunca se muestra en pantalla.
- **Datos**: con disco persistente (`DATA_DIR`) o con copias automáticas a S3 (`BACKUP_S3_*`, `server/backup.js`) que se restauran solas al arrancar.
- **Notificaciones push** (`server/push.js`): Web Push con VAPID y cifrado RFC 8291, sin dependencias.
- Los límites de tasa son en memoria (un proceso). Con varias instancias muévelos a un almacén compartido.
- SQLite es suficiente para una instancia; el acceso a datos está centralizado en `server/db.js` y las rutas
  para migrar a PostgreSQL si el catálogo o el tráfico crecen.

## Publicarla en Internet (GitHub + Render)

Ver **DEPLOY.md** (paso a paso, con `render.yaml` incluido).

## Notas

- Las URLs del catálogo inicial apuntan a servidores públicos de Blender e Internet Archive; si alguna cambia
  o deja de estar disponible, corrígela desde el panel (el reproductor muestra un aviso si una fuente no carga).
- Requiere Node ≥ 22.13 (`node:sqlite`). Muestra una advertencia “experimental” que `npm start` silencia.
