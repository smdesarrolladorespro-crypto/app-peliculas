'use strict';
// Notificaciones push (usuarios) y utilidades de sistema del administrador: aviso a todos los
// usuarios, estado/ejecución de copias de seguridad y prueba de correo.
const { q } = require('../db');
const { HttpError } = require('../lib/http');
const { auth, admin } = require('../middleware');
const push = require('../push');
const backup = require('../backup');
const { sendMail, mailStatus } = require('../mailer');

module.exports = (app) => {
  const guard = [auth, admin];

  app.get('/api/push/key', auth, (req, res) => res.json({ key: push.publicKey() }));

  app.post('/api/push/subscribe', auth, (req, res) => {
    const s = req.body || {};
    const endpoint = String(s.endpoint || '');
    const p256dh = String(s.keys?.p256dh || '');
    const authKey = String(s.keys?.auth || '');
    if (!push.validEndpoint(endpoint) || endpoint.length > 1000) throw new HttpError(400, 'Suscripción no válida');
    if (Buffer.from(p256dh, 'base64url').length !== 65 || Buffer.from(authKey, 'base64url').length !== 16) throw new HttpError(400, 'Suscripción no válida');
    q.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      req.user.id, endpoint, p256dh, authKey, Date.now()
    );
    res.json({ ok: true });
  });

  app.post('/api/push/unsubscribe', auth, (req, res) => {
    q.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  // ---- Administrador ----
  app.post('/api/admin/push/send', ...guard, async (req, res) => {
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();
    if (!title || title.length > 60) throw new HttpError(400, 'El título del aviso es obligatorio (máximo 60 caracteres)');
    if (body.length > 160) throw new HttpError(400, 'El mensaje admite máximo 160 caracteres');
    let url = '/';
    if (req.body.titleId) {
      const t = q.get('SELECT id FROM titles WHERE id = ?', Number(req.body.titleId));
      if (!t) throw new HttpError(404, 'Título no encontrado');
      url = `/#/title/${t.id}`;
    }
    res.json(await push.broadcast({ title, body, url }));
  });

  app.get('/api/admin/system', ...guard, (req, res) => {
    res.json({
      backup: backup.status(),
      mail: mailStatus(),
      push: { subscriptions: q.get('SELECT COUNT(*) n FROM push_subscriptions').n, users: q.get('SELECT COUNT(DISTINCT user_id) n FROM push_subscriptions').n },
    });
  });

  app.post('/api/admin/backup/run', ...guard, async (req, res) => {
    if (!backup.enabled()) throw new HttpError(400, 'Las copias de seguridad no están configuradas en el servidor');
    try { res.json(await backup.backupNow()); } catch (e) { throw new HttpError(502, `No se pudo guardar la copia: ${e.message}`); }
  });

  app.post('/api/admin/mail/test', ...guard, async (req, res) => {
    if (!mailStatus().provider) throw new HttpError(400, 'No hay proveedor de correo configurado (BREVO_API_KEY o RESEND_API_KEY)');
    const ok = await sendMail({ to: req.user.email, subject: 'Prueba de correo de FLIXOR', text: 'Si lees este mensaje, el envío de correo de FLIXOR funciona correctamente.' });
    if (!ok) throw new HttpError(502, 'El proveedor rechazó el envío. Revisa la clave, el remitente (MAIL_FROM) y los logs del servidor.');
    res.json({ ok: true, to: req.user.email });
  });
};
