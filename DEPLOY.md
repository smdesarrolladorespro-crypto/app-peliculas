# Publicar CINEPLUS en Internet (GitHub + Render)

## 1. Subir el proyecto a GitHub (sin usar comandos)
1. Descomprime `cineplus.zip`.
2. En GitHub: **New repository** → nombre `cineplus` → **Private** (recomendado) → *Create repository*.
3. En la página del repositorio vacío pulsa **uploading an existing file**.
4. Abre la carpeta descomprimida, selecciona **todo su contenido** (carpetas `server`, `public`, `test` y los archivos
   sueltos, incluidos los ocultos como `.gitignore` y `.node-version`; en Windows activa *Ver → Mostrar → Elementos
   ocultos*) y arrástralo a GitHub.
5. Pulsa **Commit changes**.

Nunca subas tu archivo `.env` ni la carpeta `data/` (ya están excluidos en `.gitignore`).

## 2. Crear o actualizar el servicio en Render
Puedes reutilizar tu servicio actual o crear uno nuevo: **New → Web Service → conecta tu repositorio de GitHub**.

| Campo | Valor |
|---|---|
| Runtime / Language | Node |
| Build Command | `echo sin-dependencias` (o `npm install`, da igual) |
| Start Command | `npm start` |
| Health Check Path | `/api/health` |

En **Environment** agrega estas variables:

| Variable | Valor |
|---|---|
| `NODE_VERSION` | `22.14.0` (la app necesita Node 22.13 o superior) |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | una cadena larga y aleatoria (en Render: *Generate*) |
| `ADMIN_EMAIL` | tu correo (será el administrador) |
| `ADMIN_PASSWORD` | una contraseña fuerte que elijas tú |
| `APP_URL` | la dirección de tu servicio, por ejemplo `https://app-peliculas-backend-uyvt.onrender.com` |
| `TRUST_PROXY` | `1` (imprescindible detrás de Render: si no, todos los usuarios comparten la misma IP y se activan los límites de intentos) |
| `DATA_DIR` | `/var/data` (solo si agregas el disco, ver abajo) |
| `TMDB_API_KEY` | opcional, para autocompletar pósteres |

> `ADMIN_EMAIL` y `ADMIN_PASSWORD` solo se usan **la primera vez**, cuando la base de datos aún no tiene administrador.

## 3. IMPORTANTE: guardar los datos (disco persistente)
CINEPLUS guarda usuarios, películas y las imágenes subidas en la carpeta de datos. En el plan **gratuito** de Render el
disco se borra en cada reinicio o despliegue, así que **perderías cuentas y catálogo**. Opciones:

- **Recomendado:** usa una instancia de pago (por ejemplo *Starter*) y en **Disks → Add Disk** crea un disco con
  *Mount Path* `/var/data` (1 GB sobra) y define `DATA_DIR=/var/data`. Consulta los precios vigentes en Render.
- **Solo para probar:** el plan gratuito sirve, pero todo se reinicia (el catálogo de ejemplo vuelve a cargarse) y el
  servicio se "duerme" tras unos 15 minutos sin visitas, por lo que la primera carga tarda.

## 4. Recuperar contraseña por correo
En producción el enlace de recuperación **no se muestra en pantalla** y todavía no hay envío real de correos
(`server/mailer.js` solo lo escribe en el registro de Render). Hasta conectar un servicio de correo, quien olvide su
contraseña no podrá restablecerla por sí mismo.

## 5. Después de publicar
1. Abre tu dirección de Render e inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Panel de administración → **Fuentes** y **Contenido** para agregar películas y series.
3. Para la APK, usa esa misma dirección (PWABuilder o Bubblewrap piden la URL y los íconos que ya incluye la app).
