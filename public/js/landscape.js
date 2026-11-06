// Mantiene el reproductor SIEMPRE en horizontal.
//  1) Intenta bloquear la orientación del dispositivo (Android: pantalla completa + screen.orientation.lock).
//  2) Si el dispositivo no lo permite (o el usuario sale de pantalla completa), gira el reproductor con CSS
//     para que nunca se vea vertical. Solo en pantallas táctiles: en escritorio no se gira nada.
export function enforceLandscape(el) {
  const ori = screen.orientation;
  const touch = matchMedia('(pointer: coarse)').matches;
  let enteredFs = false;
  let stopped = false;

  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;

  const apply = () => {
    if (stopped) return;
    const portrait = window.innerHeight > window.innerWidth;
    const rotate = touch && portrait;
    el.classList.toggle('rot', rotate);
    if (rotate) {
      el.style.width = window.innerHeight + 'px';
      el.style.height = window.innerWidth + 'px';
      el.style.left = window.innerWidth + 'px';
    } else {
      el.style.width = el.style.height = el.style.left = '';
    }
  };

  const tryLock = async () => {
    if (!touch || !ori || !ori.lock) return false;
    try { await ori.lock('landscape'); return true; } catch { return false; }
  };

  const start = async () => {
    apply();
    if (!touch) return;
    if (await tryLock()) return apply();
    // Muchos Android solo permiten bloquear en pantalla completa.
    try {
      if (!fsEl()) {
        const f = el.requestFullscreen || el.webkitRequestFullscreen;
        if (f) { await f.call(el); enteredFs = true; }
      }
    } catch { /* sin gesto del usuario: se reintenta al primer toque */ }
    await tryLock();
    apply();
  };

  // Si el navegador exigió un toque del usuario, se reintenta una vez con el primer toque.
  const onTap = async () => { el.removeEventListener('pointerdown', onTap); if (!stopped) await start(); };
  el.addEventListener('pointerdown', onTap);
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  start();

  return () => {
    stopped = true;
    el.removeEventListener('pointerdown', onTap);
    window.removeEventListener('resize', apply);
    window.removeEventListener('orientationchange', apply);
    try { if (ori && ori.unlock) ori.unlock(); } catch { /* ignorar */ }
    try { if (enteredFs && fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch { /* ignorar */ }
  };
}
