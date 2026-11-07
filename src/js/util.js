export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript helper. Text is always inserted as text nodes (no innerHTML) to avoid injection. */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') throw new Error('html attribute is not allowed');
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function toast(msg, kind = 'info', { onClick } = {}) {
  const root = $('#toasts');
  if (!root) return;
  const t = h(onClick ? 'button' : 'div', { class: `toast ${kind}`, role: 'status', type: onClick ? 'button' : null, onclick: onClick ? () => { t.remove(); onClick(); } : null }, msg);
  root.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3600);
}

export function fmtDate(iso, tz, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  const d = typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00Z') : new Date(iso);
  return new Intl.DateTimeFormat('en-GB', { timeZone: iso.length === 10 ? 'UTC' : tz, ...opts }).format(d);
}
export const fmtTime = (d, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(d));
export const fmtNum = (n) => new Intl.NumberFormat('en-GB').format(n);

export async function blobToDataUrl(b) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
}

/** Downscale a user photo for storage. Only resizes and re-encodes; never alters the people in it. */
export async function resizeImage(file, max = 1600, quality = 0.86) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), hh = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = hh;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hh);
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }