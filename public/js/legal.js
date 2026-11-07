// Política de privacidad y términos y condiciones de FLIXOR (texto en español).
import { h } from './ui.js';

export const CONTACT_EMAIL = 'sm.desarrolladores.pro@gmail.com';
const UPDATED = '6 de noviembre de 2026';

const sec = (title, ...body) => h('section', { class: 'legal-sec' }, h('h3', null, title), ...body);
const ul = (items) => h('ul', null, items.map((t) => h('li', null, t)));
const mail = () => h('a', { href: 'mailto:' + CONTACT_EMAIL }, CONTACT_EMAIL);

export function privacyDoc() {
  return h('article', { class: 'legal' },
    h('p', { class: 'muted' }, `Última actualización: ${UPDATED}`),
    h('p', null, 'En FLIXOR queremos que sepas con claridad qué datos usamos y qué no. Esta política es corta a propósito.'),
    sec('Lo esencial',
      ul([
        'No vendemos, alquilamos ni compartimos tus datos con anunciantes.',
        'No tenemos publicidad ni rastreadores o analíticas de terceros.',
        'Solo guardamos lo mínimo necesario para que tu cuenta funcione.',
        'No accedemos a tus contactos, ubicación, archivos, cámara ni micrófono.',
        'Puedes eliminar tu cuenta y tus datos cuando quieras desde Mi perfil.',
      ])),
    sec('Qué datos guardamos',
      ul([
        'De tu cuenta: nombre, correo electrónico y tu contraseña. La contraseña se guarda cifrada (no podemos verla).',
        'De tus perfiles: el nombre y el color que elijas.',
        'De tu uso: tus favoritos y el historial de reproducción (hasta dónde viste cada título), para que puedas continuar donde lo dejaste.',
        'Si activas las notificaciones: un identificador técnico de tu dispositivo, necesario para enviarte los avisos. Puedes desactivarlas cuando quieras.',
        'Si nos envías una sugerencia o un comentario: el texto que escribas y tu nombre de usuario.',
      ])),
    sec('Para qué los usamos',
      ul([
        'Para que puedas iniciar sesión, mantener tu sesión y usar tus perfiles, favoritos e historial.',
        'Para enviarte correos de seguridad, como el enlace para recuperar tu contraseña.',
        'Para enviarte avisos de novedades, solo si activaste las notificaciones.',
        'Para leer y responder las sugerencias que nos envías.',
      ])),
    sec('Cookies y almacenamiento',
      h('p', null, 'Usamos únicamente una cookie de sesión necesaria para mantenerte conectado, y archivos guardados en tu dispositivo para que la app cargue más rápido. No usamos cookies de publicidad ni de seguimiento.')),
    sec('Servicios de terceros',
      h('p', null, 'Para operar FLIXOR usamos proveedores de alojamiento, de copias de seguridad y de envío de correo; solo procesan los datos necesarios para prestar ese servicio.'),
      h('p', null, 'Los videos pueden reproducirse desde servidores de terceros (por ejemplo Internet Archive, YouTube o Vimeo). Al reproducirlos, ese servicio puede recibir datos técnicos como tu dirección IP, y se aplican sus propias políticas de privacidad.')),
    sec('Conservación y eliminación',
      h('p', null, 'Conservamos tus datos mientras tengas la cuenta. Si la eliminas desde Mi perfil, se borran tu cuenta, perfiles, favoritos, historial y suscripciones de notificaciones. Las copias de seguridad automáticas pueden conservar esa información hasta 30 días más y luego se eliminan.')),
    sec('Menores de edad',
      h('p', null, 'Si eres menor de edad, usa FLIXOR con el permiso y la supervisión de tu madre, padre o tutor.')),
    sec('Cambios y contacto',
      h('p', null, 'Si cambiamos esta política, publicaremos la nueva versión aquí con su fecha. Para cualquier duda o solicitud sobre tus datos, escríbenos a ', mail(), '.')));
}

export function termsDoc() {
  return h('article', { class: 'legal' },
    h('p', { class: 'muted' }, `Última actualización: ${UPDATED}`),
    h('p', null, 'Al crear una cuenta o usar FLIXOR aceptas estos términos. Si no estás de acuerdo, no uses la aplicación.'),
    sec('1. Qué es FLIXOR',
      h('p', null, 'FLIXOR es una plataforma para ver películas, series y anime gratuitos. El catálogo se compone de obras de dominio público, con licencias abiertas o publicadas por fuentes que tienen autorización para hacerlo. El contenido pertenece a sus respectivos titulares.')),
    sec('2. Tu cuenta',
      ul([
        'Debes dar datos verdaderos y mantener tu contraseña en secreto.',
        'Eres responsable de lo que ocurra desde tu cuenta y tus perfiles.',
        'Una cuenta es personal y no puede venderse ni transferirse.',
      ])),
    sec('3. Uso permitido',
      h('p', null, 'No está permitido:'),
      ul([
        'Intentar acceder a cuentas, datos o sistemas que no son tuyos.',
        'Usar programas automáticos para extraer el catálogo o sobrecargar el servicio.',
        'Copiar, redistribuir o vender el contenido o la aplicación.',
        'Usar FLIXOR para algo ilegal o para molestar a otras personas.',
      ])),
    sec('4. Derechos de autor',
      h('p', null, 'Respetamos los derechos de autor. Si crees que algún contenido de FLIXOR infringe tus derechos, escríbenos a ', mail(), ' indicando la obra, el enlace dentro de la app y cómo comprobar que eres el titular o su representante. Lo revisaremos y, si corresponde, lo retiraremos con prontitud.')),
    sec('5. Sugerencias y comentarios',
      h('p', null, 'Puedes sugerirnos títulos para agregar. No garantizamos que se agreguen. Al enviarlas nos autorizas a usar tus ideas sin compensación. No incluyas información personal sensible en ellas.')),
    sec('6. Disponibilidad del servicio',
      h('p', null, 'FLIXOR se ofrece “tal cual”. Puede tener interrupciones, cambios o dejar de ofrecer algún contenido o función sin previo aviso, por ejemplo si una fuente de video deja de estar disponible.')),
    sec('7. Responsabilidad',
      h('p', null, 'En la medida permitida por la ley, no respondemos por daños derivados del uso o de la imposibilidad de usar la aplicación, ni por el contenido o la disponibilidad de sitios de terceros desde los que se reproducen los videos.')),
    sec('8. Suspensión',
      h('p', null, 'Podemos suspender o eliminar cuentas que incumplan estos términos o pongan en riesgo el servicio o a otros usuarios.')),
    sec('9. Cambios y contacto',
      h('p', null, 'Podemos actualizar estos términos; la versión vigente siempre estará en esta página. Si sigues usando FLIXOR después de un cambio, lo aceptas. Contacto: ', mail(), '.')));
}
