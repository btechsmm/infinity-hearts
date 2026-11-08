// Controls shared by the chat "Chat style" sheet and the Settings page: profile picture, chat colour, wallpaper.
import { h, toast } from './util.js';
import { state, on, setAvatar, removeAvatar } from './api.js';
import { avatarNode, paintAvatar } from './avatar.js';
import { CHAT_THEMES, chatTheme, setChatTheme } from './chatTheme.js';
import { setWallpaper, clearWallpaper, wallpaperUrl, wallOpacity, setWallOpacity } from './wallpaper.js';
import { haptic } from './haptics.js';
import { myName } from './selectors.js';

function picker(accept, onFile) {
    const input = h('input', { type: 'file', accept, hidden: true, onchange: async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await onFile(f); } });
    return { input, open: () => input.click() };
}

export function avatarControls() {
    const av = avatarNode([], 'avatar big');
    const paint = () => paintAvatar(av, state.user?.id, myName());
    const busy = (btn, on_) => { btn.disabled = on_; };
    const choose = h('button', { class: 'btn small', type: 'button' }, 'Choose photo');
    const remove = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { try { await removeAvatar(); toast('Picture removed', 'ok'); } catch (e) { toast(e.message, 'error'); } } }, 'Remove');
    const pk = picker('image/jpeg,image/png,image/webp', async (f) => {
        busy(choose, true); try { await setAvatar(f); haptic('success'); toast('Profile picture updated', 'ok'); } catch (e) { toast(e.message || 'Could not change the picture', 'error'); } finally { busy(choose, false); }
    });
    choose.onclick = pk.open;
    let offA = () => { }, offB = () => { };
    const sync = () => { if (!box.isConnected && box.dataset.shown) { offA(); offB(); return; } paint(); remove.hidden = !state.profile?.avatar_url; };
    const box = h('div', { class: 'ctl-row' }, av, h('div', { class: 'stack tight' }, h('div', { class: 'row wrap' }, choose, remove), h('p', { class: 'hint' }, 'Shown to your partner in the chat. Only the two of you can see it.')), pk.input);
    sync();
    offA = on('avatars', sync); offB = on('data', sync);
    setTimeout(() => { box.dataset.shown = '1'; }, 0);
    return box;
}

export function colourControls() {
    return h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Chat colour' }, CHAT_THEMES.map((t) =>
        h('button', {
            class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(chatTheme() === t.id), 'aria-label': t.name, style: `--sw:${t.swatch}`,
            onclick: (e) => { setChatTheme(t.id); haptic('select'); e.currentTarget.parentElement.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); }
        },
            h('span', { class: 'sw' }), h('span', {}, t.name))));
}

export function wallpaperControls() {
    const preview = h('div', { class: 'wall-preview', role: 'img', 'aria-label': 'Wallpaper preview' }, h('div', { class: 'wall-preview-img' }), h('span', { class: 'wall-bubble them' }, 'Hello'), h('span', { class: 'wall-bubble me' }, 'Hi love'));
    const pct = h('output', {}, '');
    const range = h('input', { type: 'range', min: '5', max: '100', step: '1', 'aria-label': 'Wallpaper opacity', oninput: (e) => { setWallOpacity(Number(e.target.value) / 100); } });
    const choose = h('button', { class: 'btn small', type: 'button' }, 'Choose photo');
    const remove = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { await clearWallpaper(); toast('Wallpaper removed', 'ok'); } }, 'Remove');
    const pk = picker('image/jpeg,image/png,image/webp', async (f) => {
        choose.disabled = true;
        try { await setWallpaper(f); haptic('success'); toast('Wallpaper set', 'ok'); } catch (e) { toast(e.message || 'Could not use that photo', 'error'); } finally { choose.disabled = false; }
    });
    choose.onclick = pk.open;
    async function paint() {
        const u = await wallpaperUrl(); const o = wallOpacity();
        const img = preview.firstChild;
        img.style.backgroundImage = u ? `url("${u}")` : 'none'; img.style.opacity = String(o);
        range.value = String(Math.round(o * 100)); pct.textContent = `${Math.round(o * 100)}%`;
        range.disabled = !u; remove.hidden = !u;
        preview.classList.toggle('empty', !u);
    }
    const onWall = () => { if (!box.isConnected && box.dataset.shown) { document.removeEventListener('ih-wallpaper', onWall); return; } paint(); };
    document.addEventListener('ih-wallpaper', onWall);
    const box = h('div', { class: 'stack' },
        h('div', { class: 'ctl-row' }, preview, h('div', { class: 'stack tight' }, h('div', { class: 'row wrap' }, choose, remove), h('p', { class: 'hint' }, 'Pick any photo from this device. It fills the chat. Kept on this device only.'))),
        h('label', { class: 'range-row' }, h('span', {}, 'Photo opacity'), range, pct), pk.input);
    paint();
    setTimeout(() => { box.dataset.shown = '1'; }, 0);
    return box;
}