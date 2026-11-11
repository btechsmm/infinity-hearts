// Chat wallpaper: a photo from this device, shown behind the conversation with an adjustable opacity.
// Kept on this device only (nothing is uploaded), so each person can choose their own.
import { h } from './util.js';
import { kv } from './store.js';
import { resizeImage } from './util.js';

const KEY = 'wallpaper', OPACITY_KEY = 'ih.wallOpacity';
let url = null;
const notify = () => document.dispatchEvent(new CustomEvent('ih-wallpaper'));

export const wallOpacity = () => { try { const v = Number(localStorage.getItem(OPACITY_KEY)); return Number.isFinite(v) && localStorage.getItem(OPACITY_KEY) !== null ? Math.min(1, Math.max(0.05, v)) : 0.5; } catch { return 0.5; } };
export function setWallOpacity(v) { try { localStorage.setItem(OPACITY_KEY, String(Math.min(1, Math.max(0.05, v)))); } catch { /* ignore */ } notify(); }

export async function wallpaperUrl() {
    if (url) return url;
    const blob = await kv.get(KEY);
    if (!blob) return null;
    url = URL.createObjectURL(blob);
    return url;
}
export async function setWallpaper(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPEG, PNG or WebP photo.');
    const blob = await resizeImage(file, 1600, 0.82);       // downscaled so it stays sharp but light
    await kv.set(KEY, blob);
    if (url) URL.revokeObjectURL(url); url = null;
    notify();
}
export async function clearWallpaper() {
    await kv.del(KEY);
    if (url) URL.revokeObjectURL(url); url = null;
    notify();
}

/** Create/update the wallpaper layer inside a .chat element. */
export async function applyWallpaper(chatEl) {
    let layer = chatEl.querySelector('.chat-wall');
    if (!layer) { layer = h('div', { class: 'chat-wall', 'aria-hidden': 'true' }); chatEl.prepend(layer); }
    const u = await wallpaperUrl();
    layer.style.backgroundImage = u ? `url("${u}")` : 'none';
    layer.style.opacity = String(wallOpacity());
    chatEl.classList.toggle('has-wall', !!u);
}