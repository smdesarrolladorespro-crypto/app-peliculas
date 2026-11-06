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
| `BACKUP_S3_*` | copias de seguridad automáticas (sección 3, opción B) |
| `BREVO_API_KEY`, `MAIL_FROM` | envío real de correo (sección 4) |
| `TMDB_API_KEY` | opcional, para autocompletar pósteres |

> `ADMIN_EMAIL` y `ADMIN_PASSWORD` solo se usan **la primera vez**, cuando la base de datos aún no tiene administrador.

## 3. IMPORTANTE: que no se borren los datos
CINEPLUS guarda usuarios, perfiles, favoritos, historial, películas, series e imágenes subidas en la carpeta de datos.
En el plan **gratuito** de Render ese disco se borra cada vez que el servicio se reinicia o se "duerme". Hay dos formas de
protegerlos (usa una, o ambas):

### Opción A: disco persistente de Render (de pago, lo más simple)
Usa una instancia de pago (por ejemplo *Starter*), entra a **Disks → Add Disk** con *Mount Path* `/var/data` (1 GB sobra)
y define `DATA_DIR=/var/data`. Consulta los precios vigentes en Render. Con esto el servicio además no se duerme.

### Opción B: copia de seguridad automática en un almacenamiento gratuito (funciona en el plan gratis)
CINEPLUS sube sola una copia a un almacenamiento compatible con S3 y la restaura al arrancar:
- cada 2 minutos, **si hubo cambios** (también cuando el servidor se apaga o se duerme);
- guarda la base de datos, las imágenes subidas y una copia diaria en la carpeta `daily/`;
- si la copia no se puede leer al arrancar, el servidor **no arranca** (así nunca se sobrescribe una copia buena con una base vacía).

Servicios que sirven (revisa sus planes gratuitos vigentes; algunos piden tarjeta aunque no cobren):
- **Backblaze B2** (10 GB gratis): crea un *Bucket* privado y una *Application Key* con acceso a ese bucket. Endpoint
  `https://s3.<región>.backblazeb2.com` (por ejemplo `https://s3.us-west-004.backblazeb2.com`; la región aparece en los
  datos del bucket) y `BACKUP_S3_REGION` igual a esa región (`us-west-004`).
- **Cloudflare R2** (10 GB gratis): crea un bucket y un token de API con permiso de lectura y escritura. Endpoint
  `https://<ID-de-cuenta>.r2.cloudflarestorage.com` y `BACKUP_S3_REGION=auto`.

Variables en Render:

| Variable | Valor |
|---|---|
| `BACKUP_S3_ENDPOINT` | el endpoint de tu servicio (ver arriba) |
| `BACKUP_S3_BUCKET` | nombre del bucket |
| `BACKUP_S3_KEY_ID` | el *Key ID* / *Access Key ID* |
| `BACKUP_S3_SECRET` | la clave secreta |
| `BACKUP_S3_REGION` | región (`auto` en R2) |

Después de guardar, en el panel de administración → **Resumen → Sistema** debe decir "✔ Última copia: …". Ahí mismo
tienes **Hacer copia ahora**. Límite honesto: si el servidor se cayera de golpe (no un apagado normal), podrías perder
los cambios de los últimos 2 minutos. La primera carga tras dormirse tarda unos segundos más porque restaura la copia.

## 4. Correo de recuperación de contraseña
La app envía el correo por la API de un proveedor (los puertos SMTP están bloqueados en el plan gratis de Render).
Opción recomendada, **Brevo** (plan gratis con unos 300 correos al día):
1. Crea una cuenta en brevo.com.
2. **Senders** (remitentes) → agrega **tu correo** y confirma el mensaje de verificación que te llega.
3. **SMTP & API → API Keys** → crea una clave (empieza por `xkeysib-`).
4. En Render agrega:

| Variable | Valor |
|---|---|
| `BREVO_API_KEY` | la clave de Brevo |
| `MAIL_FROM` | `CINEPLUS <tu-correo-verificado@gmail.com>` |

5. Entra al panel → **Resumen → Sistema** → **Enviar correo de prueba**. Debe llegarte un mensaje.

Si el correo cae en *spam*, es lo normal al enviar desde una dirección de Gmail; la solución definitiva es usar un
dominio propio verificado en Brevo. Alternativa: `RESEND_API_KEY` (Resend), que necesita un dominio propio verificado
para escribirle a cualquier persona. Sin proveedor, el mensaje solo aparece en los registros de Render.

## 4b. Notificaciones
Los usuarios las activan en **Mi perfil → Notificaciones**. El administrador envía avisos desde **Resumen → Sistema →
Enviar aviso**, con la campana junto a cada título, o con la pregunta que aparece al crear un título nuevo. Las claves
VAPID se generan solas y se guardan en la base de datos (viajan con las copias de seguridad). En la APK de Android,
al generar el paquete en PWABuilder deja activada la opción de **notificaciones** (*Notification delegation*).

## 5. Después de publicar
1. Abre tu dirección de Render e inicia sesión con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. Panel de administración → **Fuentes** y **Contenido** para agregar películas y series.
3. Para la APK, usa esa misma dirección (PWABuilder o Bubblewrap piden la URL y los íconos que ya incluye la app).
