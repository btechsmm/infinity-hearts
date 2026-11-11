// Round profile picture with the person's initial as the fallback.
import { h, } from './util.js';
import { avatarUrlFor } from './api.js';

export function avatarNode(extra = [], cls = 'avatar') {
    return h('div', { class: cls, 'aria-hidden': 'true' }, h('span', { class: 'avatar-letter' }), h('img', { class: 'avatar-img', alt: '', hidden: true }), ...extra);
}
/** Fill an avatarNode for a person. Safe to call again whenever the picture or name changes. */
export async function paintAvatar(el, userId, name) {
    el.querySelector('.avatar-letter').textContent = (name || '?').trim().slice(0, 1).toUpperCase();
    const img = el.querySelector('.avatar-img');
    const url = userId ? await avatarUrlFor(userId) : null;
    if (url) { if (img.getAttribute('src') !== url) img.src = url; img.hidden = false; el.classList.add('has-img'); }
    else { img.hidden = true; img.removeAttribute('src'); el.classList.remove('has-img'); }
}