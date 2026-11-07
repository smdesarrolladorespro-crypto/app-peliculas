'use strict';
// Sugerencias y comentarios de los usuarios ("quiero que agreguen esta película / serie / anime").
// Se guardan en la base de datos (el administrador las ve en su panel) y además se envían por correo.
const { q } = require('../db');
const { HttpError, rateLimit } = require('../lib/http');
const { auth, admin } = require('../middleware');
const { sendMail } = require('../mailer');

const KINDS = { movie: 'Película', series: 'Serie', anime: 'Anime', comment: 'Comentario' };
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

module.exports = (app) => {
  const guard = [auth, admin];
  const limiter = rateLimit({ name: 'suggest', max: 8, windowMs: 60 * 60_000 });

  app.post('/api/suggestions', auth, limiter, (req, res) => {
    const kind = String(req.body.kind || '');
    if (!KINDS[kind]) throw new HttpError(400, 'Elige qué quieres sugerir');
    const title = clean(req.body.title, 120);
    const note = clean(req.body.note, 600);
    if (kind !== 'comment' && !title) throw new HttpError(400, 'Escribe el nombre de lo que quieres que agreguemos');
    if (kind === 'comment' && note.length < 3) throw new HttpError(400, 'Escribe tu comentario');
    q.run('INSERT INTO suggestions (user_id, user_name, kind, title, note, created_at) VALUES (?,?,?,?,?,?)', req.user.id, req.user.name, kind, title, note, Date.now());
    // Aviso por correo al equipo (si hay proveedor configurado). No espera ni falla la petición.
    const to = process.env.SUGGESTIONS_EMAIL || 'sm.desarrolladores.pro@gmail.com';
    sendMail({
      to,
      subject: `Sugerencia en FLIXOR: ${KINDS[kind]}${title ? ' — ' + title : ''}`,
      text: `Tipo: ${KINDS[kind]}\n${title ? `Título: ${title}\n` : ''}${note ? `\nMensaje:\n${note}\n` : ''}\nEnviado por: ${req.user.name}`,
    });
    res.json({ ok: true });
  });

  app.get('/api/admin/suggestions', ...guard, (req, res) => {
    res.json({ items: q.all('SELECT id, user_name, kind, title, note, done, created_at FROM suggestions ORDER BY done, id DESC LIMIT 300').map((r) => ({ ...r, done: !!r.done })) });
  });
  app.patch('/api/admin/suggestions/:id', ...guard, (req, res) => {
    q.run('UPDATE suggestions SET done = ? WHERE id = ?', req.body.done ? 1 : 0, Number(req.params.id));
    res.json({ ok: true });
  });
  app.delete('/api/admin/suggestions/:id', ...guard, (req, res) => {
    q.run('DELETE FROM suggestions WHERE id = ?', Number(req.params.id));
    res.json({ ok: true });
  });
};
