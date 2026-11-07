// Notificaciones push en el navegador / app instalada.
import { get, post } from './api.js';

const b64uToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

// 'unsupported' | 'denied' | 'on' | 'off'
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try { return (await currentSub()).sub ? 'on' : 'off'; } catch { return 'unsupported'; }
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Este dispositivo no admite notificaciones');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No diste permiso para las notificaciones. Puedes activarlo en los ajustes de Android > Aplicaciones > FLIXOR > Notificaciones.');
  const { reg, sub: existing } = await currentSub();
  const { key } = await get('/api/push/key');
  const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  await post('/api/push/subscribe', sub.toJSON());
}

export async function disablePush() {
  const { sub } = await currentSub();
  if (!sub) return;
  try { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch { /* ignorar */ }
  await sub.unsubscribe();
}

// Al cerrar sesión, este dispositivo deja de recibir los avisos de esa cuenta.
export async function detachPush() {
  try {
    if (!pushSupported()) return;
    const { sub } = await currentSub();
    if (sub) { await post('/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
  } catch { /* ignorar */ }
}
