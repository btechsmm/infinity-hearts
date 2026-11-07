// Notification sounds.
//   'chat'   (in-chat.mp3): a message arrives while you are inside the conversation
//   'notify' (notify.mp3) : every other in-app notification (message elsewhere in the app, milestones, reminders)
// Browsers only allow audio after the person has touched the page once, so playback is unlocked on the first tap.
// Sounds only play while the app is open and visible. Phone/OS push notifications use the system's own sound.
const FILES = { chat: '/assets/sounds/in-chat.mp3', notify: '/assets/sounds/notify.mp3' };
const K = { on: 'ih.sound', vol: 'ih.volume' };

const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export const soundEnabled = () => read(K.on, 'on') !== 'off';
export const setSoundEnabled = (v) => write(K.on, v ? 'on' : 'off');
export const soundVolume = () => Math.min(1, Math.max(0, Number(read(K.vol, '0.8'))));
export const setSoundVolume = (v) => write(K.vol, String(Math.min(1, Math.max(0, v))));

let ctx = null, master = null, unlocked = false;
const buffers = {}, fallback = {}, lastPlayed = {};
window.__ihSoundLog = window.__ihSoundLog || [];   // small log, used by the automated tests

async function loadBuffer(name) {
    if (buffers[name] || !ctx) return buffers[name];
    try {
        const res = await fetch(FILES[name]);
        const data = await res.arrayBuffer();
        buffers[name] = await new Promise((ok, no) => ctx.decodeAudioData(data, ok, no));
    } catch (e) {
        console.warn('sound decode failed, using the plain audio player', name, e);
        fallback[name] = new Audio(FILES[name]); fallback[name].preload = 'auto';
    }
    return buffers[name];
}

/** Call from a user gesture. Safe to call repeatedly. */
export function unlockAudio() {
    if (unlocked) { ctx?.state === 'suspended' && ctx.resume?.(); return; }
    unlocked = true;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
            ctx = new AC();
            master = ctx.createGain();
            master.connect(ctx.destination);
            ctx.resume?.();
            Object.keys(FILES).forEach(loadBuffer);
            return;
        }
    } catch (e) { console.warn('WebAudio unavailable', e); }
    for (const [n, src] of Object.entries(FILES)) { const a = new Audio(src); a.preload = 'auto'; fallback[n] = a; }
}

export function initSound() {
    const once = () => { unlockAudio(); };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, once, { passive: true });
}

/** Returns true if a sound was started. `force` is used by the Settings "test" buttons. */
export function playSound(name, { force = false } = {}) {
    if (!FILES[name]) return false;
    if (!force && (!soundEnabled() || document.hidden)) return false;
    const now = Date.now();
    if (now - (lastPlayed[name] || 0) < 600) return false;          // never stack the same sound
    lastPlayed[name] = now;
    window.__ihSoundLog.push(name); if (window.__ihSoundLog.length > 50) window.__ihSoundLog.shift();
    try {
        if (ctx && buffers[name]) {
            if (ctx.state === 'suspended') ctx.resume?.();
            master.gain.value = soundVolume();
            const src = ctx.createBufferSource();
            src.buffer = buffers[name]; src.connect(master); src.start(0);
            return true;
        }
        const a = fallback[name] || new Audio(FILES[name]);
        a.volume = soundVolume(); a.currentTime = 0;
        a.play().catch(() => { });
        return true;
    } catch (e) { console.warn('sound play failed', e); return false; }
}