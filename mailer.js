'use strict';
// Punto de extensión para el envío de correo. Sin proveedor configurado, el mensaje se imprime
// en la consola del servidor. Para producción, implementa aquí el envío (SMTP/API) y listo:
// el resto de la aplicación solo llama a sendMail().
async function sendMail({ to, subject, text }) {
  console.log(`\n[correo] Para: ${to}\n[correo] Asunto: ${subject}\n${text}\n`);
}
module.exports = { sendMail };
