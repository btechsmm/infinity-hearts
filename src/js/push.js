import { CONFIG } from './config.js';
import { saveSubscription, removeSubscription } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function permissionState() { return pushSupported() ? Notification.permission : 'unsupported'; }

/** Real Web Push: asks permission, subscribes with the VAPID key, stores the subscription server-side. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support push notifications. On iPhone, add the app to your Home Screen first.');
  if (!CONFIG.vapidPublicKey) throw new Error('Push is not configured yet (missing VAPID public key). See the README.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked. Allow them in your browser or phone settings, then try again.' : 'Notification permission was not granted.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(CONFIG.vapidPublicKey) });
  await saveSubscription(sub);
  return sub;
}

export async function disablePush() {
  if (!pushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) { await removeSubscription(sub.endpoint).catch(() => { }); await sub.unsubscribe(); }
}

export async function isSubscribed() {
  if (!pushSupported()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}

/** Remove the system notification for the chat once the person is looking at it. */
export async function clearChatNotifications() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    (await reg?.getNotifications({ tag: 'ih-chat' }))?.forEach((n) => n.close());
  } catch { /* not supported */ }
}

/** Show a system notification from the open app itself when it is running in the background (desktop PWA). */
export async function showLocalNotification(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return false;                                  // same tag as the push notification, so it is replaced, never doubled
    await reg.showNotification(title, { body, tag: 'ih-chat', renotify: true, silent: true, icon: '/assets/icons/icon-192.png', badge: '/assets/icons/favicon-48.png', data: { url: '/#/messages' } });
    return true;
  } catch { return false; }
}