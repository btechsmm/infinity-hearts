import { h, toast, fmtDate } from '../util.js';
import { state, on, updateSettings, updateProfile, savePrefs, syncAll, signOut, requestTestPush } from '../api.js';
import { kv, wipeAll } from '../store.js';
import { confirmDialog, field } from '../ui.js';
import { zonedParts, zonedTimeToUtc } from '../core/time.js';
import { enablePush, disablePush, isSubscribed, permissionState, pushSupported } from '../push.js';
import { CLOUD } from '../config.js';
import { nativeStatus } from '../native.js';
import { soundEnabled, setSoundEnabled, soundVolume, setSoundVolume, playSound, unlockAudio } from '../sound.js';
import { hapticsEnabled, setHapticsEnabled, hapticsSupported, haptic } from '../haptics.js';
import { CHAT_THEMES, chatTheme, setChatTheme } from '../chatTheme.js';

const ZONES = ['Africa/Nairobi', 'Asia/Bahrain', 'UTC', 'Europe/London', 'Asia/Dubai', 'Asia/Riyadh', 'America/New_York', 'America/Los_Angeles', 'Europe/Paris', 'Asia/Kolkata'];

function toLocalInput(iso, tz) {
    const p = zonedParts(new Date(iso), tz);
    const z = (n) => String(n).padStart(2, '0');
    return `${p.year}-${z(p.month)}-${z(p.day)}T${z(p.hour)}:${z(p.minute)}`;
}
function fromLocalInput(v, tz) {
    const [d, t] = v.split('T'); const [y, m, dd] = d.split('-').map(Number); const [hh, mm] = t.split(':').map(Number);
    return zonedTimeToUtc(y, m, dd, hh, mm, tz).toISOString();
}
const tzSelect = (value) => { const s = h('select', {}, [...new Set([value, ...ZONES])].map((z) => h('option', { value: z }, z))); s.value = value; return s; };

export function mount(root) {
    const host = h('div', { class: 'stack' });

    async function render() {
        const cfg = state.cfg;
        const subscribed = await isSubscribed();
        const perm = permissionState();
        const native = await nativeStatus();

        // --- profile
        const name = h('input', { type: 'text', value: state.profile?.display_name || '', maxlength: '40' });
        const ptz = tzSelect(state.profile?.timezone || 'Africa/Nairobi');
        const profile = h('section', { class: 'card stack' }, h('h2', {}, 'Profile'),
            field('Your name', name), field('Your time zone', ptz, 'Greetings and 8:00 AM reminders follow this.'),
            h('button', { class: 'btn primary', onclick: async () => { try { await updateProfile({ display_name: name.value.trim() || state.profile.display_name, timezone: ptz.value }); toast('Profile saved', 'ok'); } catch (e) { toast(e.message, 'error'); } } }, 'Save profile'));

        // --- couple + dates
        const homeTz = tzSelect(cfg.homeTimezone); const destTz = tzSelect(cfg.destinationTimezone);
        const dep = h('input', { type: 'datetime-local', value: toLocalInput(cfg.departureAt, cfg.homeTimezone) });
        const ret = h('input', { type: 'datetime-local', value: toLocalInput(cfg.expectedReturnAt, cfg.homeTimezone) });
        const err = h('p', { class: 'err', role: 'alert' });
        const couple = h('section', { class: 'card stack' }, h('h2', {}, 'Couple details'),
            h('p', { class: 'sub' }, `${cfg.coupleName} · ${cfg.homeCity} ♥ ${cfg.destinationCity}`),
            field('Departure date and time', dep, `Entered in ${cfg.homeTimezone}. Until the exact time is known, 00:00 is used.`),
            field('Expected reunion date and time', ret, 'A plan, not a promise. Changing it recalculates everything instantly.'),
            field('Home time zone (used for day counting)', homeTz), field('Faith’s time zone', destTz), err,
            h('button', {
                class: 'btn primary', onclick: async () => {
                    err.textContent = '';
                    try {
                        const tzHome = homeTz.value;
                        await updateSettings({ homeTimezone: tzHome, destinationTimezone: destTz.value, departureAt: fromLocalInput(dep.value, tzHome), expectedReturnAt: fromLocalInput(ret.value, tzHome) });
                        toast('Dates saved', 'ok');
                    } catch (e) { err.textContent = e.message; }
                }
            }, 'Save dates'),
            cfg.actualReunionAt ? h('div', {}, h('p', { class: 'sub' }, `Reunion recorded: ${fmtDate(cfg.actualReunionAt, cfg.homeTimezone)}`), h('button', { class: 'btn small ghost', onclick: async () => { if (await confirmDialog({ title: 'Undo recorded reunion?', body: 'The countdown will resume from the planned reunion date.', confirmLabel: 'Undo' })) updateSettings({ actualReunionAt: null }).catch((e) => toast(e.message, 'error')); } }, 'Undo recorded reunion')) : null);

        // --- notifications
        const p = state.prefs || { daily_enabled: true, weekly_enabled: true, monthly_enabled: true, milestone_enabled: true, special_dates_enabled: true, preferred_time: '08:00', timezone: state.profile?.timezone || 'Africa/Nairobi' };
        const tog = (label, k) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: p[k] ? '' : null, onchange: (e) => savePrefs({ [k]: e.target.checked }).catch((x) => toast(x.message, 'error')) }), label);
        const time = h('input', { type: 'time', value: (p.preferred_time || '08:00').slice(0, 5), onchange: (e) => savePrefs({ preferred_time: e.target.value }).catch((x) => toast(x.message, 'error')) });
        const permText = perm === 'unsupported' ? 'This browser cannot receive push notifications.' : perm === 'denied' ? 'Notifications are blocked for this app. Allow them in your browser or phone settings.' : subscribed ? 'Push notifications are on for this device.' : 'Push notifications are off for this device.';
        const notif = h('section', { class: 'card stack' }, h('h2', {}, 'Notifications'),
            h('p', { class: 'sub' }, permText),
            h('div', { class: 'row wrap' },
                !subscribed && pushSupported() && perm !== 'denied' && CLOUD ? h('button', { class: 'btn primary', onclick: async () => { try { await enablePush(); toast('Push notifications enabled', 'ok'); render(); } catch (e) { toast(e.message, 'error'); } } }, 'Turn on notifications') : null,
                subscribed ? h('button', { class: 'btn', onclick: async () => { await disablePush(); toast('Notifications turned off for this device', 'ok'); render(); } }, 'Turn off') : null,
                subscribed ? h('button', { class: 'btn', onclick: async () => { try { const r = await requestTestPush(); toast(r?.sent ? 'Test notification sent from the server' : 'Server ran, but nothing was delivered. Check the logs.', r?.sent ? 'ok' : 'error'); } catch (e) { toast(`Test failed: ${e.message}`, 'error'); } } }, 'Send a real test from the server') : null),
            !CLOUD ? h('p', { class: 'hint' }, 'Notifications need the Supabase backend. See the README.') : null,
            tog('Daily morning love message', 'daily_enabled'), tog('Weekly motivation', 'weekly_enabled'), tog('Monthly reflection', 'monthly_enabled'),
            tog('Milestone alerts', 'milestone_enabled'), tog('Special-date reminders', 'special_dates_enabled'),
            field('Morning time (your time zone)', time),
            h('p', { class: 'hint' }, 'Web push needs an internet connection on the phone when the message is sent, and some phones delay or hold background notifications to save battery. Guaranteed offline reminders need the native Android app. ', native.available ? 'This is the native app: local reminders are available.' : 'See docs/NOTIFICATIONS.md.'));

        // --- sounds, vibration, chat colour (stored on this device)
        const vol = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(soundVolume()), 'aria-label': 'Sound volume', oninput: (e) => setSoundVolume(Number(e.target.value)) });
        const themeRow = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Chat colour' }, CHAT_THEMES.map((t) =>
            h('button', {
                class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(chatTheme() === t.id), 'aria-label': t.name, style: `--sw:${t.swatch}`,
                onclick: (e) => { setChatTheme(t.id); e.currentTarget.parentElement.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-checked', String(b === e.currentTarget))); }
            }, h('span', { class: 'sw' }), h('span', {}, t.name))));
        const sounds = h('section', { class: 'card stack' }, h('h2', {}, 'Sounds, vibration & chat'),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: soundEnabled() ? '' : null, onchange: (e) => { setSoundEnabled(e.target.checked); unlockAudio(); } }), 'Play notification sounds while the app is open'),
            field('Volume', vol),
            h('div', { class: 'row wrap' },
                h('button', { class: 'btn small', type: 'button', onclick: () => { unlockAudio(); setTimeout(() => playSound('chat', { force: true }), 80); } }, 'Test in-chat sound'),
                h('button', { class: 'btn small', type: 'button', onclick: () => { unlockAudio(); setTimeout(() => playSound('notify', { force: true }), 80); } }, 'Test notification sound')),
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: hapticsEnabled() ? '' : null, onchange: (e) => { setHapticsEnabled(e.target.checked); if (e.target.checked) haptic('success', { force: true }); } }), 'Vibrate on touch'),
            !hapticsSupported() ? h('p', { class: 'hint' }, 'This browser does not allow vibration (iPhone Safari never does). The setting is saved but has no effect here.') : null,
            h('p', { class: 'eyebrow' }, 'Chat colour'), themeRow,
            h('p', { class: 'hint' }, 'Sounds play only while the app is open. Notifications that arrive when the app is closed use your phone’s own notification sound.'));

        // --- appearance
        const text = h('select', { onchange: (e) => { document.documentElement.dataset.text = e.target.value; localStorage.setItem('ih.text', e.target.value); } }, h('option', { value: 'normal' }, 'Standard'), h('option', { value: 'large' }, 'Larger'));
        text.value = localStorage.getItem('ih.text') || 'normal';
        const motion = h('select', { onchange: (e) => { document.documentElement.dataset.motion = e.target.value; localStorage.setItem('ih.motion', e.target.value); } }, h('option', { value: 'on' }, 'Follow my device'), h('option', { value: 'off' }, 'Reduce motion'));
        motion.value = localStorage.getItem('ih.motion') || 'on';
        const look = h('section', { class: 'card stack' }, h('h2', {}, 'Appearance'), field('Text size', text), field('Animations', motion));

        // --- photos & sync & privacy
        const photos = h('section', { class: 'card stack' }, h('h2', {}, 'Photos'), h('p', { class: 'sub' }, `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}. ${state.photos.filter((x) => x.is_active !== false).length} in the welcome rotation.`), h('a', { class: 'btn', href: '#/memories' }, 'Manage photos'));
        const last = await kv.get('lastSync');
        const sync = h('section', { class: 'card stack' }, h('h2', {}, 'Data & sync'),
            h('p', { class: 'sub' }, state.mode === 'cloud' ? `Last synced: ${last ? new Date(last).toLocaleString() : 'not yet'}${state.online ? '' : ' (offline)'}. Unsent messages: ${state.outbox.length}.` : 'Local mode: data is stored on this device only.'),
            h('div', { class: 'row wrap' }, h('button', { class: 'btn', disabled: !state.online, onclick: async () => { try { await syncAll(); toast('Up to date', 'ok'); render(); } catch (e) { toast(e.message, 'error'); } } }, 'Sync now'),
                h('button', { class: 'btn danger', onclick: async () => { if (await confirmDialog({ title: 'Clear data stored on this device?', body: state.outbox.length ? `You have ${state.outbox.length} unsent message(s) that will be lost.` : 'It will be downloaded again when you are online.', confirmLabel: 'Clear', danger: true })) { await wipeAll(); toast('Cleared. Reloading…', 'ok'); setTimeout(() => location.reload(), 600); } } }, 'Clear local data')));
        const privacy = h('section', { class: 'card stack' }, h('h2', {}, 'Privacy'),
            h('p', { class: 'sub' }, 'Your messages and photos are private to the two of you: they are protected by sign-in and database access rules, stored in a private bucket, and never shown on public pages. They are not end-to-end encrypted, which means the service host that runs the database could technically access them.'),
            h('p', { class: 'sub' }, 'Shared quote images only ever contain library quotes, never your private messages.'));
        const out = CLOUD ? h('section', { class: 'card stack' }, h('h2', {}, 'Account'), state.user?.email ? h('p', { class: 'sub' }, state.user.email) : null,
            h('button', {
                class: 'btn danger', onclick: async () => {
                    const n = state.outbox.length;
                    if (await confirmDialog({ title: 'Sign out?', body: n ? `${n} unsent message(s) will be lost. This also clears photos and messages stored on this device.` : 'This also clears photos and messages stored on this device.', confirmLabel: 'Sign out', danger: true })) signOut();
                }
            }, 'Sign out')) : null;

        host.replaceChildren(h('header', {}, h('h1', { class: 'title' }, 'Settings')), profile, couple, notif, sounds, photos, look, sync, privacy, install(), out);
    }
    function install() {
        return h('section', { class: 'card stack' }, h('h2', {}, 'Install the app'),
            h('p', { class: 'sub' }, 'Android (Chrome): menu ⋮ → Install app. iPhone (Safari): Share → Add to Home Screen. Desktop: use the install icon in the address bar.'));
    }
    root.append(host); render();
    return on('data', () => { if (!host.contains(document.activeElement) || document.activeElement.tagName === 'BODY') render(); });
}