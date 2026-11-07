// Panel de administración (solo accesible con rol admin; el servidor vuelve a verificarlo en cada petición).
import { h, icon, toast, modal, confirmBox, clear, spinner, fmtDate } from './ui.js';
import { S, get, post, put, patch, del } from './api.js';

const fld = (label, input, hint) => h('div', { class: 'field' }, h('label', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
const TYPE_LABEL = { mp4: 'Archivo de video (MP4/WebM)', hls: 'HLS (.m3u8)', youtube: 'YouTube (canal autorizado)', embed: 'Reproductor embebido (iframe)' };

// Si el servidor rechaza un enlace porque su sitio no está autorizado, ofrece autorizarlo y reintenta.
async function withHostRetry(fn) {
  try { return await fn(); } catch (e) {
    if (!e.data || e.data.code !== 'host_not_allowed') throw e;
    const host = e.data.host;
    const ok = await confirmBox(`El sitio “${host}” no está en tu lista de fuentes autorizadas. ¿Quieres autorizarlo y guardar? Hazlo solo si el contenido es de dominio público, tiene licencia abierta o tienes permiso del titular.`, { okText: 'Autorizar y guardar' });
    if (!ok) throw e;
    try { await post('/api/admin/hosts', { host, note: 'Autorizado al guardar un título' }); } catch (x) { if (x.status !== 409) throw x; }
    return fn();
  }
}

// Modal para enviar una notificación a todos los usuarios suscritos.
function notifyModal({ title = '', body = '', titleId = null } = {}) {
  modal((box, close) => {
    const t = h('input', { maxlength: '60', value: title, required: true });
    const b = h('textarea', { maxlength: '160' }, body);
    const err = h('div', { class: 'error', hidden: true, role: 'alert' });
    const send = h('button', { class: 'btn primary', type: 'submit' }, icon('bell'), 'Enviar a todos');
    box.append(h('h2', null, 'Enviar notificación'),
      h('form', { onsubmit: async (ev) => {
        ev.preventDefault(); err.hidden = true; send.disabled = true;
        try {
          const r = await post('/api/admin/push/send', { title: t.value, body: b.value, titleId });
          toast(r.total ? `Enviada a ${r.sent} de ${r.total} dispositivos` : 'Nadie tiene las notificaciones activadas todavía', r.total ? 'ok' : '');
          close();
        } catch (x) { err.textContent = x.message; err.hidden = false; } finally { send.disabled = false; }
      } }, err, fld('Título', t, 'Máximo 60 caracteres'), fld('Mensaje', b, 'Máximo 160 caracteres'),
      h('div', { class: 'foot' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancelar'), send)));
  });
}

function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(file);
  });
}

async function uploadInto(input, accept) {
  const picker = h('input', { type: 'file', accept });
  picker.onchange = async () => {
    const file = picker.files[0];
    if (!file) return;
    try {
      const data = await readFileB64(file);
      const r = await post('/api/admin/upload', { filename: file.name, data });
      input.value = r.url;
      input.dispatchEvent(new Event('input'));
      toast('Archivo subido', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  picker.click();
}

function urlWithUpload(label, value, { accept = 'image/jpeg,image/png,image/webp', hint } = {}) {
  const input = h('input', { type: 'text', value: value || '', placeholder: 'https://… o sube un archivo', maxlength: '2000' });
  const preview = h('img', { alt: '', style: 'height:64px;border-radius:6px;display:none;margin-top:6px;background:#222' });
  const upd = () => { const v = input.value.trim(); preview.style.display = v && accept.startsWith('image') ? 'block' : 'none'; if (v) preview.src = v; };
  input.addEventListener('input', upd);
  upd();
  return { input, el: h('div', { class: 'field' }, h('label', null, label),
    h('div', { class: 'row-flex', style: 'flex-wrap:nowrap' }, input, h('button', { type: 'button', class: 'btn small', onclick: () => uploadInto(input, accept) }, 'Subir')),
    accept.startsWith('image') ? preview : null, hint ? h('div', { class: 'hint' }, hint) : null) };
}

function subsEditor(initial) {
  const rows = h('div');
  const list = [];
  const add = (s = {}) => {
    const lang = h('input', { value: s.lang || 'es', placeholder: 'es', maxlength: '10', 'aria-label': 'Idioma' });
    const label = h('input', { value: s.label || 'Español', placeholder: 'Etiqueta', maxlength: '40', 'aria-label': 'Etiqueta' });
    const url = h('input', { value: s.url || '', placeholder: 'URL del .vtt o sube un archivo', 'aria-label': 'URL del subtítulo' });
    const row = h('div', { class: 'sub-row' }, lang, label,
      h('div', { class: 'row-flex', style: 'flex-wrap:nowrap' }, url, h('button', { type: 'button', class: 'btn small', onclick: () => uploadInto(url, '.vtt,text/vtt') }, 'Subir .vtt')),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Quitar subtítulo', onclick: () => { row.remove(); list.splice(list.indexOf(item), 1); } }, icon('close')));
    const item = { lang, label, url };
    list.push(item); rows.append(row);
  };
  (initial || []).forEach(add);
  return {
    el: h('div', { class: 'field' }, h('label', null, 'Subtítulos (WebVTT)'), rows,
      h('button', { type: 'button', class: 'btn small', onclick: () => add() }, icon('plus'), 'Añadir subtítulo')),
    get: () => list.map((i) => ({ lang: i.lang.value.trim(), label: i.label.value.trim(), url: i.url.value.trim() })).filter((s) => s.url),
  };
}

function sourceFields(src, stats) {
  const type = h('select', null, stats.videoTypes.map((t) => h('option', { value: t, selected: t === (src.video_type || 'mp4') }, TYPE_LABEL[t] || t)));
  const url = h('input', { type: 'text', value: src.video_url || '', placeholder: 'https://…', maxlength: '2000' });
  return { type, url, el: h('div', null,
    h('div', { class: 'form-grid' }, fld('Tipo de fuente', type), fld('URL de la fuente autorizada', url)),
    h('div', { class: 'hint', style: 'margin:-6px 0 14px;font-size:12px;color:var(--muted)' }, 'Pega el enlace del video. Si su sitio aún no está autorizado, al guardar te preguntaremos si quieres autorizarlo. Autorizados ahora: ' + stats.allowedHosts.join(', ') + '.')) };
}

/* -------------------------------------------------------------- Episodios */
function episodeModal(titleId, ep, stats, onDone) {
  modal((box, close) => {
    const e = ep || {};
    const season = h('input', { type: 'number', min: '1', max: '100', value: e.season || 1, required: true });
    const number = h('input', { type: 'number', min: '1', max: '1000', value: e.number || 1, required: true });
    const name = h('input', { value: e.name || '', maxlength: '150', required: true });
    const runtime = h('input', { type: 'number', min: '1', max: '1000', value: e.runtime || '' });
    const overview = h('textarea', { maxlength: '2000' }, e.overview || '');
    const src = sourceFields(e, stats);
    const subs = subsEditor(e.subtitles);
    const err = h('div', { class: 'error', hidden: true, role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'submit' }, 'Guardar episodio');
    const archBtn = h('button', { type: 'button', class: 'btn small', onclick: () => archiveModal((it) => {
      src.type.value = 'mp4'; src.url.value = it.video_url;
      if (!name.value.trim()) name.value = it.title;
      if (!runtime.value && it.runtime) runtime.value = it.runtime;
      toast('Fuente importada de Internet Archive', 'ok');
    }) }, 'Elegir de Internet Archive');
    box.append(h('h3', null, ep ? 'Editar episodio' : 'Nuevo episodio'), h('form', { onsubmit: async (ev) => {
      ev.preventDefault(); err.hidden = true; save.disabled = true;
      const body = { season: season.value, number: number.value, name: name.value, runtime: runtime.value, overview: overview.value, video_type: src.type.value, video_url: src.url.value.trim() || null, subtitles: subs.get() };
      try {
        await withHostRetry(() => (ep ? put('/api/admin/episodes/' + ep.id, body) : post(`/api/admin/titles/${titleId}/episodes`, body)));
        toast('Episodio guardado', 'ok'); close(); onDone();
      } catch (x) { err.textContent = x.message; err.hidden = false; } finally { save.disabled = false; }
    } }, err,
    h('div', { class: 'form-grid' }, fld('Temporada', season), fld('Episodio', number), fld('Duración (min)', runtime)),
    fld('Nombre', name), fld('Sinopsis', overview), h('div', { class: 'row-flex', style: 'margin-bottom:14px' }, archBtn), src.el, subs.el,
    h('div', { class: 'foot' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cancelar'), save)));
  });
}

function episodesManager(titleId, episodes, stats, reload, hasTmdb) {
  const wrap = h('div', { class: 'panel', style: 'margin-top:8px' });
  const bySeason = new Map();
  episodes.forEach((e) => { if (!bySeason.has(e.season)) bySeason.set(e.season, []); bySeason.get(e.season).push(e); });
  wrap.append(h('div', { class: 'toolbar', style: 'margin-bottom:12px' }, h('h3', { style: 'margin:0' }, `Temporadas y episodios (${episodes.length})`),
    h('div', { class: 'row-flex' },
      h('button', { type: 'button', class: 'btn small', onclick: () => episodeModal(titleId, null, stats, reload) }, icon('plus'), 'Añadir episodio'),
      hasTmdb ? h('button', { type: 'button', class: 'btn small', onclick: async () => {
        const n = Number(prompt('¿Qué temporada quieres importar desde TMDB? (solo metadatos)'));
        if (!n) return;
        try { const r = await post(`/api/admin/titles/${titleId}/import-season`, { season: n }); toast(`Importados ${r.added} de ${r.total} episodios`, 'ok'); reload(); } catch (e) { toast(e.message, 'err'); }
      } }, 'Importar temporada (TMDB)') : null)));
  if (!episodes.length) wrap.append(h('p', { class: 'muted' }, 'Aún no hay episodios. Añade el primero.'));
  [...bySeason].forEach(([s, eps]) => {
    wrap.append(h('h4', { style: 'margin:14px 0 6px' }, 'Temporada ' + s));
    eps.forEach((e) => wrap.append(h('div', { class: 'prof-row' },
      h('b', { style: 'width:44px' }, 'E' + e.number),
      h('div', { class: 'grow' }, e.name, h('div', { class: 'muted', style: 'font-size:12px' }, e.video_url ? 'Fuente: ' + e.video_type : 'Sin fuente (no disponible)')),
      h('button', { type: 'button', class: 'btn small', onclick: () => episodeModal(titleId, e, stats, reload) }, icon('edit'), 'Editar'),
      h('button', { type: 'button', class: 'btn small danger', 'aria-label': 'Eliminar episodio', onclick: async () => {
        if (!(await confirmBox(`¿Eliminar el episodio ${e.number} “${e.name}”?`, { okText: 'Eliminar', danger: true }))) return;
        try { await del('/api/admin/episodes/' + e.id); reload(); } catch (x) { toast(x.message, 'err'); }
      } }, icon('trash')))));
  });
  return wrap;
}

/* ------------------------------------------------------------------ TMDB */
function tmdbModal(type, onPick) {
  modal((box, close) => {
    const q = h('input', { placeholder: 'Título a buscar', maxlength: '100' });
    const res = h('div', { class: 'tmdb-results' });
    const run = async () => {
      if (!q.value.trim()) return;
      clear(res); res.append(spinner());
      try {
        const d = await get(`/api/admin/tmdb/search?type=${type}&q=${encodeURIComponent(q.value.trim())}`);
        clear(res);
        if (!d.items.length) res.append(h('p', { class: 'muted' }, 'Sin resultados.'));
        d.items.forEach((it) => res.append(h('button', { type: 'button', class: 'tmdb-item', onclick: async () => {
          try { const full = (await get(`/api/admin/tmdb/details?type=${type}&id=${it.tmdb_id}`)).item; close(); onPick(full); } catch (e) { toast(e.message, 'err'); }
        } }, h('img', { src: it.poster_url || '', alt: '' }), h('div', null, h('b', null, `${it.title} ${it.year ? '(' + it.year + ')' : ''}`), h('p', null, it.overview)))));
      } catch (e) { clear(res); res.append(h('div', { class: 'error' }, e.message)); }
    };
    box.append(h('h3', null, 'Buscar en TMDB'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' }, 'TMDB solo aporta información (sinopsis, póster, calificación). No otorga derechos de reproducción: la fuente de video debe ser una fuente autorizada.'),
      h('form', { class: 'row-flex', style: 'flex-wrap:nowrap;margin-bottom:12px', onsubmit: (e) => { e.preventDefault(); run(); } }, q, h('button', { class: 'btn primary', type: 'submit' }, 'Buscar')),
      res, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Cerrar')));
  });
}


/* ------------------------------------------------------- Internet Archive */
function archiveModal(onPick) {
  modal((box, close) => {
    const q = h('input', { placeholder: 'Título (ej. Nosferatu)', maxlength: '100', 'aria-label': 'Título a buscar' });
    const col = h('select', { 'aria-label': 'Colección' }, [['', 'Todas las colecciones'], ['feature_films', 'Largometrajes'], ['silent_films', 'Cine mudo'], ['SciFi_Horror', 'Ciencia ficción y terror'], ['classic_tv', 'TV clásica'], ['animationandcartoons', 'Animación']].map(([v, l]) => h('option', { value: v }, l)));
    const body = h('div', { class: 'tmdb-results' });
    const MB = (n) => (n ? Math.round(n / 1048576) + ' MB' : '');
    const licenseNote = (lic) => lic ? `Licencia declarada: ${lic}` : 'Sin licencia indicada: confirma en la ficha que sea dominio público o tenga licencia abierta.';

    async function run() {
      if (!q.value.trim() && !col.value) { clear(body); body.append(h('p', { class: 'muted' }, 'Escribe un título o elige una colección.')); return; }
      clear(body); body.append(spinner());
      try {
        const d = await get(`/api/admin/archive/search?q=${encodeURIComponent(q.value.trim())}&collection=${encodeURIComponent(col.value)}`);
        clear(body);
        if (!d.items.length) body.append(h('p', { class: 'muted' }, 'Sin resultados.'));
        d.items.forEach((it) => body.append(h('button', { type: 'button', class: 'tmdb-item', onclick: () => choose(it) },
          h('img', { src: it.poster_url, alt: '', loading: 'lazy' }),
          h('div', null, h('b', null, `${it.title}${it.year ? ' (' + it.year + ')' : ''}`), h('p', null, it.overview || it.identifier)))));
      } catch (e) { clear(body); body.append(h('div', { class: 'error' }, e.message)); }
    }

    async function choose(it) {
      clear(body); body.append(spinner());
      try {
        const { item } = await get('/api/admin/archive/item?id=' + encodeURIComponent(it.identifier));
        clear(body);
        if (!item.files.length) {
          body.append(h('div', { class: 'error' }, 'Este ítem no tiene archivos MP4 reproducibles en el navegador. Prueba con otro.'), h('button', { type: 'button', class: 'btn', onclick: run }, '‹ Volver a los resultados'));
          return;
        }
        const sel = h('select', { 'aria-label': 'Archivo de video' }, item.files.map((f, i) => h('option', { value: i }, `${f.name} · ${f.format}${f.size ? ' · ' + MB(f.size) : ''}`)));
        body.append(
          h('div', { class: 'tmdb-item', style: 'cursor:default' }, h('img', { src: item.poster_url, alt: '' }),
            h('div', null, h('b', null, `${item.title}${item.year ? ' (' + item.year + ')' : ''}`), h('p', null, item.overview))),
          h('p', { class: 'muted', style: 'font-size:13px' }, licenseNote(item.license), ' ', h('a', { href: item.page_url, target: '_blank', rel: 'noopener noreferrer', style: 'text-decoration:underline' }, 'Ver ficha en archive.org')),
          fld('Archivo de video', sel, 'El primero suele ser la mejor opción (H.264).'),
          h('div', { class: 'row-flex' },
            h('button', { type: 'button', class: 'btn', onclick: run }, '‹ Resultados'),
            h('button', { type: 'button', class: 'btn primary', onclick: () => { close(); onPick({ title: item.title, overview: item.overview, year: item.year, runtime: item.runtime, poster_url: item.poster_url, video_url: item.files[Number(sel.value)].url, license: item.license }); } }, 'Usar esta fuente')));
      } catch (e) { clear(body); body.append(h('div', { class: 'error' }, e.message), h('button', { type: 'button', class: 'btn', onclick: run }, '‹ Volver')); }
    }

    box.append(h('h3', null, 'Importar desde Internet Archive'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' }, 'Usa solo contenido de dominio público o con licencia abierta. Internet Archive también aloja material con derechos reservados: tú eres responsable de lo que publiques.'),
      h('form', { class: 'row-flex', style: 'flex-wrap:nowrap;margin-bottom:12px', onsubmit: (e) => { e.preventDefault(); run(); } }, q, col, h('button', { class: 'btn primary', type: 'submit' }, 'Buscar')),
      body, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Cerrar')));
  });
}


/* ------------------------------------------- Importar desde una página / feed */
function pageImportModal(onDone) {
  modal((box, close) => {
    const url = h('input', { type: 'url', placeholder: 'https://sitio-autorizado.com/catalogo', required: true, 'aria-label': 'Dirección de la página o del feed' });
    const out = h('div');
    const go = h('button', { class: 'btn primary', type: 'submit' }, 'Analizar');
    let items = [];           // candidatos encontrados
    const picked = new Set(); // índices elegidos
    let pageLinks = [];

    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const kindName = { mp4: 'MP4', hls: 'HLS', youtube: 'YouTube', embed: 'Reproductor insertado' };

    function show(info) {
      clear(out);
      if (info.skipped && info.skipped.length) {
        out.append(h('p', { class: 'muted', style: 'font-size:13px' }, 'No se importan (dominio no autorizado): ' + info.skipped.map((x) => `${x.host} (${x.count})`).join(', ') + '. Autorízalos en Fuentes solo si tienes permiso para usar ese contenido.'));
      }
      if (info.errors && info.errors.length) out.append(h('p', { class: 'muted', style: 'font-size:13px' }, `${info.errors.length} página(s) no se pudieron leer: ` + info.errors.map((e) => e.message).join(' · ')));
      if (!items.length) {
        out.append(h('p', { class: 'muted' }, 'No se encontraron videos que se puedan importar en esta página. Puede que el sitio no publique su catálogo en un formato estándar; prueba con otra página del sitio o agrega el contenido manualmente.'));
      } else {
        const all = h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { picked.clear(); if (e.target.checked) items.forEach((_, i) => picked.add(i)); out.querySelectorAll('.pi-row input').forEach((c) => { c.checked = e.target.checked; }); updateBtn(); } }), `Seleccionar todo (${items.length})`);
        const list = h('div', { class: 'tmdb-results', style: 'max-height:300px' }, items.map((c, i) => h('label', { class: 'tmdb-item pi-row', style: 'cursor:pointer' },
          h('input', { type: 'checkbox', style: 'flex:none', onchange: (e) => { if (e.target.checked) picked.add(i); else picked.delete(i); updateBtn(); } }),
          c.poster_url ? h('img', { src: c.poster_url, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
          h('div', null, h('b', null, c.title || '(sin título)'), h('p', null, `${kindName[c.video_type] || c.video_type} · ${hostOf(c.video_url)}${c.year ? ' · ' + c.year : ''}${c.runtime ? ' · ' + c.runtime + ' min' : ''}`)))));
        out.append(all, list);
      }
      if (pageLinks.length) {
        const sel = new Set();
        const linkBtn = h('button', { type: 'button', class: 'btn small', disabled: true }, 'Analizar las páginas elegidas');
        const upd = () => { linkBtn.disabled = !sel.size; linkBtn.textContent = sel.size ? `Analizar ${sel.size} página(s)` : 'Analizar las páginas elegidas'; };
        linkBtn.onclick = async () => {
          linkBtn.disabled = true; linkBtn.textContent = 'Leyendo páginas…';
          try {
            const r = await post('/api/admin/scrape/expand', { urls: [...sel] });
            const have = new Set(items.map((c) => c.video_url));
            r.candidates.forEach((c) => { if (!have.has(c.video_url)) items.push(c); });
            show({ skipped: r.skipped, errors: r.errors });
          } catch (e) { toast(e.message, 'err'); upd(); }
        };
        out.append(h('details', { style: 'margin:12px 0' }, h('summary', { style: 'cursor:pointer' }, `Páginas enlazadas de este sitio (${pageLinks.length}) — elige hasta 15 para buscar videos en ellas`),
          h('div', { class: 'tmdb-results', style: 'max-height:200px;margin:8px 0' }, pageLinks.map((l) => h('label', { class: 'check', style: 'padding:4px 0;display:flex;gap:8px' },
            h('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked && sel.size >= 15) { e.target.checked = false; return; } if (e.target.checked) sel.add(l.url); else sel.delete(l.url); upd(); } }),
            h('span', null, l.text || l.url)))), linkBtn));
      }
      if (items.length) out.append(importPanel());
      updateBtn();
    }

    let doBtn;
    const updateBtn = () => { if (doBtn) { doBtn.disabled = !picked.size; doBtn.textContent = picked.size ? `Importar ${picked.size} seleccionado(s)` : 'Elige qué importar'; } };

    function importPanel() {
      const mode = h('select', { 'aria-label': 'Cómo importar' }, [['movie', 'Cada video es una película'], ['series', 'Todos son episodios de una serie nueva']].map(([v, l]) => h('option', { value: v }, l)));
      const sTitle = h('input', { maxlength: '150', placeholder: 'Nombre de la serie' });
      const sBox = h('div', { hidden: true }, fld('Nombre de la serie', sTitle));
      mode.onchange = () => { sBox.hidden = mode.value !== 'series'; };
      const anime = h('input', { type: 'checkbox' });
      doBtn = h('button', { type: 'button', class: 'btn primary', disabled: true }, 'Elige qué importar');
      const status = h('p', { class: 'muted', style: 'font-size:13px' });
      doBtn.onclick = async () => {
        const chosen = [...picked].sort((a, b) => a - b).map((i) => items[i]);
        if (mode.value === 'series' && !sTitle.value.trim()) { toast('Escribe el nombre de la serie', 'err'); sTitle.focus(); return; }
        doBtn.disabled = true; let ok = 0; const fails = [];
        const img = (u) => (u && /^https:/.test(u) ? u : undefined);
        try {
          if (mode.value === 'series') {
            status.textContent = 'Creando la serie…';
            const { title } = await post('/api/admin/titles', { type: 'series', title: sTitle.value.trim(), overview: '', poster_url: img(chosen[0].poster_url), anime: anime.checked, genres: [] });
            for (let i = 0; i < chosen.length; i++) {
              const c = chosen[i]; status.textContent = `Importando episodio ${i + 1} de ${chosen.length}…`;
              try { await post(`/api/admin/titles/${title.id}/episodes`, { season: 1, number: i + 1, name: c.title || `Episodio ${i + 1}`, overview: c.overview || '', runtime: c.runtime || undefined, video_type: c.video_type, video_url: c.video_url }); ok++; } catch (e) { fails.push(`${c.title || i + 1}: ${e.message}`); }
            }
          } else {
            for (let i = 0; i < chosen.length; i++) {
              const c = chosen[i]; status.textContent = `Importando ${i + 1} de ${chosen.length}…`;
              try { await post('/api/admin/titles', { type: 'movie', title: c.title || 'Sin título', overview: c.overview || '', year: c.year || undefined, runtime: c.runtime || undefined, poster_url: img(c.poster_url), video_type: c.video_type, video_url: c.video_url, anime: anime.checked, genres: [] }); ok++; } catch (e) { fails.push(`${c.title || i + 1}: ${e.message}`); }
            }
          }
        } catch (e) { fails.push(e.message); }
        toast(`Importados: ${ok}${fails.length ? ' · con error: ' + fails.length : ''}`, fails.length ? 'err' : 'ok');
        if (fails.length) { status.textContent = fails.slice(0, 4).join(' · '); doBtn.disabled = false; }
        if (ok) onDone();
        if (!fails.length) close();
      };
      return h('div', { class: 'panel', style: 'margin-top:12px' }, fld('Cómo importar', mode), sBox,
        h('label', { class: 'check', style: 'margin:6px 0 12px;display:flex;gap:8px' }, anime, 'Marcar como anime'),
        status, doBtn,
        h('p', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Luego puedes editar cada título: géneros, portada, sinopsis y destacarlo.'));
    }

    box.append(h('h3', null, 'Importar desde una página o feed'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' }, 'Pega la dirección de una página, un feed RSS o un sitemap de video de una fuente autorizada. Se leen solo los datos que el sitio publica en formatos estándar, respetando su robots.txt. Usa únicamente contenido libre o con permiso del titular: tú eres responsable de lo que publiques.'),
      h('form', { class: 'row-flex', style: 'flex-wrap:nowrap;margin-bottom:12px', onsubmit: async (e) => {
        e.preventDefault(); go.disabled = true; clear(out); out.append(spinner()); picked.clear();
        try {
          const r = await withHostRetry(() => post('/api/admin/scrape/analyze', { url: url.value.trim() }));
          items = r.candidates; pageLinks = r.links || []; doBtn = null; show(r);
        } catch (x) { clear(out); out.append(h('div', { class: 'error' }, x.message)); } finally { go.disabled = false; }
      } }, url, go),
      out, h('div', { class: 'foot' }, h('button', { class: 'btn', onclick: close }, 'Cerrar')));
  });
}

/* ------------------------------------------------------- Editor de títulos */
async function openEditor(id, stats, genres, onDone, presetType) {
  let data = null;
  if (id) data = await get('/api/admin/titles/' + id);
  const t = data ? data.title : { type: presetType || 'movie', genres: [], subtitles: [] };
  modal((box, close) => {
    const type = h('select', { disabled: !!id }, [['movie', 'Película'], ['series', 'Serie']].map(([v, l]) => h('option', { value: v, selected: v === t.type }, l)));
    const title = h('input', { value: t.title || '', maxlength: '150', required: true });
    const year = h('input', { type: 'number', min: '1888', max: '2100', value: t.year || '' });
    const rating = h('input', { type: 'number', min: '0', max: '10', step: '0.1', value: t.rating ?? '' });
    const runtime = h('input', { type: 'number', min: '1', max: '1000', value: t.runtime || '' });
    const overview = h('textarea', { maxlength: '4000' }, t.overview || '');
    const tmdbId = h('input', { type: 'number', min: '1', value: t.tmdb_id || '' });
    const featured = h('input', { type: 'checkbox', checked: !!t.featured });
    const anime = h('input', { type: 'checkbox', checked: !!t.anime });
    const poster = urlWithUpload('Póster (vertical 2:3)', t.poster_url && !t.poster_url.startsWith('data:') ? t.poster_url : '', { hint: t.poster_url && t.poster_url.startsWith('data:') ? 'Póster generado por defecto. Pega una URL o sube una imagen para reemplazarlo.' : 'JPG, PNG o WebP hasta 5 MB' });
    const backdrop = urlWithUpload('Imagen de fondo (horizontal 16:9)', t.backdrop_url && !t.backdrop_url.startsWith('data:') ? t.backdrop_url : '');
    const keepPoster = t.poster_url && t.poster_url.startsWith('data:') ? t.poster_url : null;
    const keepBackdrop = t.backdrop_url && t.backdrop_url.startsWith('data:') ? t.backdrop_url : null;
    const checks = genres().map((g) => ({ slug: g.slug, el: h('input', { type: 'checkbox', checked: (t.genres || []).includes(g.slug) }), name: g.name }));
    const src = sourceFields(t, stats);
    const subs = subsEditor(t.subtitles);
    const movieBox = h('div', null, src.el, subs.el);
    const err = h('div', { class: 'error', hidden: true, role: 'alert' });
    const save = h('button', { class: 'btn primary', type: 'submit' }, id ? 'Guardar cambios' : 'Crear título');
    let archBtn = null;
    const sync = () => { movieBox.hidden = type.value !== 'movie'; if (archBtn) archBtn.hidden = type.value !== 'movie'; };
    type.onchange = sync; sync();

    const tmdbBtn = h('button', { type: 'button', class: 'btn small', disabled: !stats.tmdb, title: stats.tmdb ? '' : 'Define TMDB_API_KEY en .env para activarlo', onclick: () => tmdbModal(type.value, (it) => {
      title.value = it.title; overview.value = it.overview; year.value = it.year || ''; rating.value = it.rating ?? ''; runtime.value = it.runtime || '';
      tmdbId.value = it.tmdb_id; poster.input.value = it.poster_url || ''; backdrop.input.value = it.backdrop_url || '';
      poster.input.dispatchEvent(new Event('input')); backdrop.input.dispatchEvent(new Event('input'));
      checks.forEach((c) => { c.el.checked = it.genres.includes(c.slug); });
      toast('Datos importados desde TMDB', 'ok');
    }) }, 'Autocompletar con TMDB');

    archBtn = h('button', { type: 'button', class: 'btn small', onclick: () => archiveModal((it) => {
      if (!title.value.trim()) title.value = it.title;
      if (!overview.value.trim()) overview.value = it.overview;
      if (!year.value && it.year) year.value = it.year;
      if (!runtime.value && it.runtime) runtime.value = it.runtime;
      if (!poster.input.value.trim()) { poster.input.value = it.poster_url; poster.input.dispatchEvent(new Event('input')); }
      src.type.value = 'mp4'; src.url.value = it.video_url;
      toast(stats.tmdb ? 'Fuente importada. Usa “Autocompletar con TMDB” para un mejor póster.' : 'Fuente importada de Internet Archive', 'ok');
    }) }, 'Importar de Internet Archive');
    sync();

    box.append(h('h3', null, id ? 'Editar título' : 'Nuevo título'),
      h('form', { onsubmit: async (ev) => {
        ev.preventDefault(); err.hidden = true; save.disabled = true;
        const body = {
          type: type.value, title: title.value, overview: overview.value, year: year.value, rating: rating.value, runtime: runtime.value,
          poster_url: poster.input.value.trim() || keepPoster, backdrop_url: backdrop.input.value.trim() || keepBackdrop,
          featured: featured.checked, anime: anime.checked, tmdb_id: tmdbId.value || null, genres: checks.filter((c) => c.el.checked).map((c) => c.slug),
        };
        // Los pósteres generados por defecto (data:) no se reenvían: el servidor conserva el actual
        if (body.poster_url && body.poster_url.startsWith('data:')) delete body.poster_url;
        if (body.backdrop_url && body.backdrop_url.startsWith('data:')) delete body.backdrop_url;
        if (type.value === 'movie') { body.video_type = src.type.value; body.video_url = src.url.value.trim() || null; body.subtitles = subs.get(); }
        try {
          const r = await withHostRetry(() => (id ? put('/api/admin/titles/' + id, body) : post('/api/admin/titles', body)));
          toast('Título guardado', 'ok'); close(); onDone();
          if (!id) {
            const label = r.title.type === 'series' ? 'Nueva serie' : 'Nueva película';
            confirmBox(`¿Avisar a los usuarios por notificación de “${r.title.title}”?`, { okText: 'Enviar aviso' })
              .then((yes) => { if (yes) notifyModal({ title: `${label} en FLIXOR`, body: r.title.title, titleId: r.title.id }); });
          }
          if (!id && r.title.type === 'series') openEditor(r.title.id, stats, genres, onDone).catch((e) => toast(e.message, 'err'));
        } catch (x) { err.textContent = x.message; err.hidden = false; } finally { save.disabled = false; }
      } }, err,
      h('div', { class: 'row-flex', style: 'margin-bottom:14px' }, tmdbBtn, archBtn, !stats.tmdb ? h('span', { class: 'muted', style: 'font-size:12px' }, 'TMDB no configurado (TMDB_API_KEY)') : null),
      h('div', { class: 'form-grid' }, fld('Tipo', type), fld('Año', year), fld('Calificación (0-10)', rating), fld('Duración (min)', runtime)),
      fld('Título', title), fld('Sinopsis', overview),
      h('div', { class: 'field' }, h('label', null, 'Géneros'), h('div', { class: 'genre-checks' }, checks.map((c) => h('label', { class: 'check' }, c.el, c.name)))),
      h('div', { class: 'form-grid' }, poster.el, backdrop.el),
      h('div', { class: 'form-grid' }, fld('TMDB ID (opcional)', tmdbId), h('div', { class: 'field' }, h('label', null, 'Pantalla principal'), h('label', { class: 'check', style: 'min-height:44px' }, featured, 'Destacar en el inicio')),
        h('div', { class: 'field' }, h('label', null, 'Categoría'), h('label', { class: 'check', style: 'min-height:44px' }, anime, 'Es anime (aparece en la sección Anime)'))),
      movieBox,
      h('div', { class: 'foot' }, h('button', { type: 'button', class: 'btn', onclick: close }, 'Cerrar'), save)));

    if (id && t.type === 'series') {
      const slot = h('div');
      const reload = async () => {
        try { const d = await get('/api/admin/titles/' + id); clear(slot); slot.append(episodesManager(id, d.episodes, stats, reload, stats.tmdb && !!d.title.tmdb_id)); onDone(); } catch (e) { toast(e.message, 'err'); }
      };
      slot.append(episodesManager(id, data.episodes, stats, reload, stats.tmdb && !!t.tmdb_id));
      box.append(slot);
    }
  });
}

/* ------------------------------------------------------------------ Pestañas */
async function contentTab(pane, stats, genres) {
  const q = h('input', { type: 'search', placeholder: 'Buscar por título', 'aria-label': 'Buscar' });
  const typeSel = h('select', { 'aria-label': 'Tipo' }, [['', 'Todos'], ['movie', 'Películas'], ['series', 'Series']].map(([v, l]) => h('option', { value: v }, l)));
  const body = h('tbody');
  const load = async () => {
    const d = await get(`/api/admin/titles?q=${encodeURIComponent(q.value.trim())}&type=${typeSel.value}`);
    clear(body);
    if (!d.items.length) body.append(h('tr', null, h('td', { colspan: '6', class: 'muted', style: 'text-align:center;padding:30px' }, 'No hay títulos.')));
    d.items.forEach((t) => {
      const star = h('button', { class: 'icon-btn' + (t.featured ? ' star-on' : ''), 'aria-label': t.featured ? 'Quitar de destacados' : 'Destacar en inicio', 'aria-pressed': String(t.featured), title: t.featured ? 'Quitar de destacados' : 'Destacar en inicio',
        onclick: async () => { try { await patch(`/api/admin/titles/${t.id}/featured`, { featured: !t.featured }); toast(t.featured ? 'Quitado de destacados' : 'Destacado en el inicio', 'ok'); load(); } catch (e) { toast(e.message, 'err'); } } }, icon('star', t.featured));
      body.append(h('tr', null,
        h('td', null, t.poster_url ? h('img', { src: t.poster_url, alt: '' }) : h('div', { class: 'noimg' })),
        h('td', null, h('b', null, t.title), h('div', { class: 'muted', style: 'font-size:12px' }, t.genres.join(', '))),
        h('td', null, t.type === 'series' ? 'Serie' : 'Película'),
        h('td', null, t.year || '—'),
        h('td', null, star),
        h('td', null, h('div', { class: 'actions-cell' },
          h('button', { class: 'btn small', onclick: () => openEditor(t.id, stats, genres, load).catch((e) => toast(e.message, 'err')) }, icon('edit'), 'Editar'),
          h('button', { class: 'icon-btn', 'aria-label': 'Avisar a los usuarios de ' + t.title, title: 'Avisar a los usuarios', onclick: () => notifyModal({ title: (t.type === 'series' ? 'Serie' : 'Película') + ' en FLIXOR', body: t.title, titleId: t.id }) }, icon('bell')),
          h('button', { class: 'btn small danger', 'aria-label': 'Eliminar ' + t.title, onclick: async () => {
            if (!(await confirmBox(`¿Eliminar “${t.title}”${t.type === 'series' ? ' y todos sus episodios' : ''}? También se quitará de favoritos e historiales.`, { okText: 'Eliminar', danger: true }))) return;
            try { await del('/api/admin/titles/' + t.id); toast('Título eliminado', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          } }, icon('trash'))))));
    });
  };
  let tm; q.oninput = () => { clearTimeout(tm); tm = setTimeout(load, 300); };
  typeSel.onchange = load;
  pane.append(h('div', { class: 'toolbar', style: 'margin-bottom:14px' },
    h('div', { class: 'row-flex' }, q, typeSel),
    h('div', { class: 'row-flex' },
      h('button', { class: 'btn', onclick: () => pageImportModal(load) }, 'Importar de una página'),
      h('button', { class: 'btn primary', onclick: () => openEditor(null, stats, genres, load).catch((e) => toast(e.message, 'err')) }, icon('plus'), 'Nuevo título'))),
  h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['', 'Título', 'Tipo', 'Año', 'Destacado', 'Acciones'].map((x) => h('th', null, x)))), body)));
  await load();
}

async function suggestionsTab(pane) {
  const { items } = await get('/api/admin/suggestions');
  const kinds = { movie: 'Película', series: 'Serie', anime: 'Anime', comment: 'Comentario' };
  if (!items.length) return pane.append(h('div', { class: 'empty' }, icon('chat'), h('p', null, 'Todavía no hay sugerencias.')));
  const list = h('div');
  items.forEach((s) => {
    const row = h('div', { class: 'list-item', style: s.done ? 'opacity:.55' : '' },
      h('div', { style: 'grid-column:1/-1;display:flex;gap:12px;align-items:flex-start' },
        h('div', { class: 'grow' },
          h('div', null, h('span', { class: 'badge-red', style: 'margin-right:8px' }, kinds[s.kind] || s.kind), h('b', null, s.title || '(comentario)')),
          s.note ? h('p', { style: 'margin:6px 0 0;white-space:pre-wrap' }, s.note) : null,
          h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `${s.user_name || 'Usuario eliminado'} · ${new Date(s.created_at).toLocaleString('es')}`)),
        h('button', { class: 'btn small', onclick: async () => { try { await patch('/api/admin/suggestions/' + s.id, { done: !s.done }); s.done = !s.done; row.style.opacity = s.done ? '.55' : ''; b1.textContent = s.done ? 'Reabrir' : 'Hecho'; } catch (e) { toast(e.message, 'err'); } } }, ''),
        h('button', { class: 'icon-btn', 'aria-label': 'Eliminar sugerencia', onclick: async () => { try { await del('/api/admin/suggestions/' + s.id); row.remove(); } catch (e) { toast(e.message, 'err'); } } }, icon('trash'))));
    const b1 = row.querySelector('.btn.small');
    b1.textContent = s.done ? 'Reabrir' : 'Hecho';
    list.append(row);
  });
  pane.append(h('p', { class: 'muted', style: 'margin-bottom:12px' }, 'Lo que piden los usuarios. También llega a sm.desarrolladores.pro@gmail.com cuando el correo está configurado.'), list);
}

async function usersTab(pane) {
  const body = h('tbody');
  const load = async () => {
    const { users } = await get('/api/admin/users');
    clear(body);
    users.forEach((u) => {
      const me = u.id === S.user.id;
      const role = h('select', { disabled: me, 'aria-label': 'Rol de ' + u.name, onchange: async () => {
        try { await patch('/api/admin/users/' + u.id, { role: role.value }); toast('Rol actualizado', 'ok'); load(); } catch (e) { toast(e.message, 'err'); load(); }
      } }, [['user', 'Usuario'], ['admin', 'Administrador']].map(([v, l]) => h('option', { value: v, selected: v === u.role }, l)));
      body.append(h('tr', null,
        h('td', null, h('b', null, u.name), me ? h('span', { class: 'badge-red', style: 'margin-left:8px' }, 'TÚ') : null),
        h('td', null, u.email), h('td', null, role),
        h('td', null, h('span', { style: `color:${u.status === 'active' ? 'var(--green)' : '#ff6b6b'}` }, u.status === 'active' ? 'Activo' : 'Bloqueado')),
        h('td', null, u.profiles), h('td', null, fmtDate(u.created_at)),
        h('td', null, u.last_activity ? fmtDate(u.last_activity) : '—'),
        h('td', null, h('div', { class: 'actions-cell' },
          h('button', { class: 'btn small', disabled: me, onclick: async () => {
            try { await patch('/api/admin/users/' + u.id, { status: u.status === 'active' ? 'blocked' : 'active' }); toast(u.status === 'active' ? 'Usuario bloqueado' : 'Usuario reactivado', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          } }, u.status === 'active' ? 'Bloquear' : 'Reactivar'),
          h('button', { class: 'btn small danger', disabled: me, 'aria-label': 'Eliminar usuario ' + u.name, onclick: async () => {
            if (!(await confirmBox(`¿Eliminar la cuenta de ${u.name} (${u.email})? Se borrarán sus perfiles, favoritos e historial.`, { okText: 'Eliminar', danger: true }))) return;
            try { await del('/api/admin/users/' + u.id); toast('Usuario eliminado', 'ok'); load(); } catch (e) { toast(e.message, 'err'); }
          } }, icon('trash'))))));
    });
  };
  pane.append(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Nombre', 'Correo', 'Rol', 'Estado', 'Perfiles', 'Registro', 'Última actividad', 'Acciones'].map((x) => h('th', null, x)))), body)));
  await load();
}

async function sourcesTab(pane) {
  const host = h('input', { placeholder: 'archive.org  (o pega un enlace completo)', maxlength: '300' });
  const note = h('input', { placeholder: 'Ej.: películas de dominio público', maxlength: '200' });
  const sure = h('input', { type: 'checkbox' });
  const body = h('tbody');
  const ORIGIN = { default: 'Por defecto', env: 'Archivo .env', custom: 'Agregado por ti' };
  const draw = (hosts) => {
    clear(body);
    hosts.forEach((x) => body.append(h('tr', null,
      h('td', null, h('b', null, x.host)),
      h('td', null, ORIGIN[x.origin] || x.origin),
      h('td', { class: 'muted' }, x.note || '—'),
      h('td', null, h('span', { style: `color:${x.enabled ? 'var(--green)' : '#ff6b6b'}` }, x.enabled ? 'Autorizado' : 'Desactivado')),
      h('td', null, x.origin === 'custom'
        ? h('button', { class: 'btn small danger', onclick: async () => {
          if (!(await confirmBox(`¿Quitar ${x.host} de las fuentes autorizadas? Los títulos que lo usan dejarán de reproducirse.`, { okText: 'Quitar', danger: true }))) return;
          try { draw((await del('/api/admin/hosts/' + encodeURIComponent(x.host))).hosts); toast('Dominio quitado', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, icon('trash'), 'Quitar')
        : h('button', { class: 'btn small', onclick: async () => {
          try { draw((await patch('/api/admin/hosts/' + encodeURIComponent(x.host), { enabled: !x.enabled })).hosts); toast(x.enabled ? 'Dominio desactivado' : 'Dominio activado', 'ok'); } catch (e) { toast(e.message, 'err'); }
        } }, x.enabled ? 'Desactivar' : 'Activar')))));
  };
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!sure.checked) return toast('Confirma que tienes derecho a usar ese sitio', 'err');
    try {
      draw((await post('/api/admin/hosts', { host: host.value, note: note.value })).hosts);
      host.value = ''; note.value = ''; sure.checked = false;
      toast('Dominio autorizado', 'ok');
    } catch (x) { toast(x.message, 'err'); }
  } },
  h('div', { class: 'form-grid' }, fld('Sitio a autorizar', host), fld('Nota (opcional)', note)),
  h('label', { class: 'check', style: 'margin-bottom:14px' }, sure, 'Confirmo que el contenido de este sitio es de dominio público, tiene licencia abierta o cuento con permiso del titular.'),
  h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Autorizar sitio'));
  pane.append(
    h('div', { class: 'panel' }, h('h3', null, 'Autorizar un sitio nuevo'),
      h('p', { class: 'muted', style: 'font-size:13px;margin-bottom:14px' }, 'Solo se pueden usar enlaces de estos sitios (HTTPS). También puedes autorizar un sitio directamente al guardar una película o episodio con un enlace nuevo.'), form),
    h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['Sitio', 'Origen', 'Nota', 'Estado', 'Acciones'].map((x) => h('th', null, x)))), body)));
  draw((await get('/api/admin/hosts')).hosts);
}

async function systemPanel() {
  const box = h('div', { class: 'panel' }, h('h3', null, 'Sistema'), spinner());
  try {
    const sys = await get('/api/admin/system');
    const when = (ms) => (ms ? new Date(ms).toLocaleString('es') : 'todavía no');
    const line = (ok, text) => h('p', { style: 'margin:0 0 6px' }, (ok ? '✔ ' : '⚠ ') + text);
    const bBtn = h('button', { class: 'btn small', onclick: async () => {
      bBtn.disabled = true;
      try { const r = await post('/api/admin/backup/run'); toast('Copia guardada', 'ok'); bTxt.textContent = '✔ Última copia: ' + when(r.lastAt); } catch (e) { toast(e.message, 'err'); } finally { bBtn.disabled = false; }
    } }, 'Hacer copia ahora');
    const bTxt = h('span', null, sys.backup.enabled
      ? (sys.backup.lastError ? '⚠ Error en la última copia: ' + sys.backup.lastError : '✔ Última copia: ' + when(sys.backup.lastAt))
      : '⚠ Sin copias de seguridad: si el servidor se reinicia en un plan gratuito, se pierden los datos (ver DEPLOY.md).');
    const mBtn = h('button', { class: 'btn small', onclick: async () => {
      mBtn.disabled = true;
      try { const r = await post('/api/admin/mail/test'); toast('Correo de prueba enviado a ' + r.to, 'ok'); } catch (e) { toast(e.message, 'err'); } finally { mBtn.disabled = false; }
    } }, 'Enviar correo de prueba');
    clear(box);
    box.append(h('h3', null, 'Sistema'),
      h('div', { class: 'row-flex', style: 'align-items:center;margin-bottom:10px' }, h('div', { class: 'grow' }, h('b', null, 'Copias de seguridad'), h('div', null, bTxt)), sys.backup.enabled ? bBtn : null),
      h('div', { class: 'row-flex', style: 'align-items:center;margin-bottom:10px' }, h('div', { class: 'grow' }, h('b', null, 'Correo'), h('div', null, sys.mail.provider ? `✔ ${sys.mail.provider} · remitente ${sys.mail.from}` : '⚠ Sin proveedor: los correos de recuperación de contraseña no se envían (ver DEPLOY.md).')), sys.mail.provider ? mBtn : null),
      h('div', { class: 'row-flex', style: 'align-items:center' }, h('div', { class: 'grow' }, h('b', null, 'Notificaciones'), h('div', null, `${sys.push.subscriptions} dispositivo(s) de ${sys.push.users} usuario(s) las tienen activadas`)),
        h('button', { class: 'btn small', onclick: () => notifyModal() }, icon('bell'), 'Enviar aviso')));
  } catch (e) { clear(box); box.append(h('h3', null, 'Sistema'), h('p', { class: 'muted' }, e.message)); }
  return box;
}

function overviewTab(pane, stats) {
  systemPanel().then((el) => pane.append(el));
  pane.append(h('div', { class: 'stats' }, [['Usuarios', stats.users], ['Películas', stats.movies], ['Series', stats.series], ['Anime', stats.anime], ['Episodios', stats.episodes], ['Destacados', stats.featured], ['Reproducciones', stats.plays]].map(([l, v]) => h('div', { class: 'stat' }, h('b', null, v), h('span', null, l)))),
    h('div', { class: 'panel' }, h('h3', null, 'Fuentes de video autorizadas'),
      h('p', { class: 'muted', style: 'margin-bottom:10px' }, 'El servidor rechaza cualquier fuente que no sea HTTPS de uno de estos dominios (o un archivo subido). Gestiona la lista en la pestaña Fuentes.'),
      h('div', { class: 'chips' }, stats.allowedHosts.map((x) => h('span', { class: 'chip' }, x)))),
    h('div', { class: 'panel' }, h('h3', null, 'TMDB'),
      h('p', null, stats.tmdb ? '✔ Conectado: puedes autocompletar sinopsis, pósteres y calificaciones al crear o editar títulos.' : 'No configurado. Define TMDB_API_KEY en .env para autocompletar datos. TMDB solo aporta metadatos; no otorga derechos de reproducción.')));
}

export async function renderAdmin({ box, alive }, { genres, refreshGenres }) {
  const stats = await get('/api/admin/stats');
  if (!alive()) return;
  const tabs = [['overview', 'Resumen'], ['content', 'Contenido'], ['sources', 'Fuentes'], ['suggestions', 'Sugerencias'], ['users', 'Usuarios']];
  const pane = h('div');
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  let current = sessionStorage.getItem('cp_admin_tab') || 'overview';
  const show = async (key) => {
    current = key;
    try { sessionStorage.setItem('cp_admin_tab', key); } catch { /* ignorar */ }
    [...bar.children].forEach((b) => { b.classList.toggle('on', b.dataset.k === key); b.setAttribute('aria-selected', String(b.dataset.k === key)); });
    clear(pane); pane.append(spinner());
    const fresh = await get('/api/admin/stats');
    if (current !== key || !alive()) return;
    Object.assign(stats, fresh);
    await refreshGenres();
    clear(pane);
    if (key === 'overview') overviewTab(pane, stats);
    else if (key === 'content') await contentTab(pane, stats, genres);
    else if (key === 'sources') await sourcesTab(pane);
    else if (key === 'suggestions') await suggestionsTab(pane);
    else await usersTab(pane);
  };
  tabs.forEach(([k, l]) => bar.append(h('button', { role: 'tab', 'data-k': k, onclick: () => show(k).catch((e) => toast(e.message, 'err')) }, l)));
  clear(box);
  box.append(h('div', { class: 'page' }, h('h1', null, 'Panel de administración'), h('p', { class: 'sub' }, 'Gestiona el catálogo, los episodios y los usuarios'), bar, pane));
  await show(tabs.some(([k]) => k === current) ? current : 'overview');
}
