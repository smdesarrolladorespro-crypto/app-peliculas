'use strict';
// Envío de correo por API HTTP (sin SMTP: los hostings gratuitos suelen bloquear esos puertos).
// Proveedores compatibles, según la clave que definas:
//   BREVO_API_KEY   → Brevo (brevo.com), plan gratis de 300 correos/día. Permite usar tu propio
//                     correo (p. ej. Gmail) como remitente verificado, sin comprar un dominio.
//   RESEND_API_KEY  → Resend (resend.com). Para escribir a cualquier persona necesita un dominio propio.
// MAIL_FROM = remitente, por ejemplo:  FLIXOR <micorreo@gmail.com>
// Sin ningún proveedor, el mensaje solo se imprime en la consola del servidor (modo desarrollo).

function provider() {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

function parseFrom() {
  const raw = (process.env.MAIL_FROM || '').trim();
  const m = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || 'FLIXOR', email: m[2].trim() };
  return { name: 'FLIXOR', email: raw };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Devuelve true si se entregó al proveedor. Nunca lanza: un fallo de correo no debe romper la petición
// ni revelar si un correo existe.
async function sendMail({ to, subject, text, button }) {
  const p = provider();
  const from = parseFrom();
  if (!p || !from.email) {
    console.log(`\n[correo] (sin proveedor configurado)\n[correo] Para: ${to}\n[correo] Asunto: ${subject}\n${text}\n`);
    return false;
  }
  const html = `<div style="background:#000;padding:24px;font-family:Arial,sans-serif;color:#e5e5e5">
<div style="max-width:480px;margin:auto;background:#141414;border-radius:12px;padding:28px">
<div style="font-size:22px;font-weight:bold;letter-spacing:2px;color:#fff;margin-bottom:18px"><span style="color:#e50914">&#9654;</span> FLIX<span style="color:#e50914">OR</span></div>
${text.split('\n\n').map((para) => `<p style="line-height:1.5;margin:0 0 14px">${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}
${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p>` : ''}
</div></div>`;
  try {
    let r;
    if (p === 'brevo') {
      r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: from, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
        signal: AbortSignal.timeout(15_000),
      });
    } else {
      r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(15_000),
      });
    }
    if (!r.ok) { console.error(`[correo] ${p} respondió ${r.status}: ${(await r.text()).slice(0, 300)}`); return false; }
    return true;
  } catch (e) {
    console.error('[correo] Error al enviar:', e.message);
    return false;
  }
}

const mailStatus = () => ({ provider: provider(), from: parseFrom().email || null });

module.exports = { sendMail, mailStatus };
