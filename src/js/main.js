import { h, $, toast } from './util.js';
import { icon } from './icons.js';
import { APP, CLOUD } from './config.js';
import * as api from './api.js';
import { state, on } from './api.js';
import { field, setBusy } from './ui.js';
import { scheduleNativeReminders, isNative } from './native.js';
import { chatName } from './selectors.js';
import { storageDegraded } from './store.js';
import { initBack } from './back.js';
import { initSound, playSound } from './sound.js';
import { initHaptics, haptic } from './haptics.js';

const ROUTES = {
  home: () => import('./views/home.js'),
  journey: () => import('./views/journey.js'),
  quotes: () => import('./views/quotes.js'),
  dates: () => import('./views/dates.js'),
  messages: () => import('./views/messages.js'),
  memories: () => import('./views/memories.js'),
  settings: () => import('./views/settings.js'),
};
const TABS = [['home', 'Home'], ['journey', 'Journey'], ['quotes', 'Quotes'], ['dates', 'Dates'], ['messages', 'Messages']];

const app = $('#app');
let cleanup = null, welcomed = false, shell = null;

// ------------------------------------------------------------------ service worker
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) toast('A new version is ready. Reopen the app to update.', 'ok'); });
    });
  } catch (e) { console.warn('SW registration failed', e); }
}

// ------------------------------------------------------------------ auth screens
function authScreen() {
  cleanup?.(); cleanup = null; shell = null; welcomed = false;
  const mark = h('img', { class: 'mark', src: '/assets/logo-mark.svg', alt: '' });
  let body;
  if (state.recovery) body = recoveryForm();
  else if (state.notMember) body = notMember();
  else body = loginForm();
  app.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'panel stack', style: 'text-align:center' },
    mark, h('h1', { class: 'title' }, 'Infinity ', h('span', { class: 'heart' }, 'Hearts')), h('p', { class: 'eyebrow' }, 'BECAM & FAITH'), body)));
}
function loginForm() {
  const email = h('input', { type: 'email', autocomplete: 'email', required: true, inputmode: 'email' });
  const pw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary', type: 'submit', style: 'width:100%' }, 'Sign in');
  const msg = state.sessionExpired ? h('p', { class: 'banner warn' }, 'Your session has ended. Please sign in again.') : null;
  return h('form', {
    class: 'stack', style: 'text-align:left', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; setBusy(btn, true);
      try { await api.signIn(email.value, pw.value); } catch (x) { err.textContent = /Invalid login/i.test(x.message) ? 'That email or password is not right.' : navigator.onLine ? x.message : 'You are offline. Connect to sign in.'; setBusy(btn, false, 'Sign in'); }
    }
  },
    msg, field('Email', email), field('Password', pw), err, btn,
    h('button', {
      type: 'button', class: 'btn ghost', style: 'width:100%', onclick: async () => {
        if (!email.value) { err.textContent = 'Enter your email above first.'; return; }
        try { await api.resetPassword(email.value); toast('If that email is registered, a reset link is on its way.', 'ok'); } catch (x) { err.textContent = x.message; }
      }
    }, 'Forgot password'),
    h('p', { class: 'hint', style: 'text-align:center' }, 'This is a private space for two. Accounts are set up by the app owner.'));
}
function recoveryForm() {
  const pw = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const err = h('p', { class: 'err', role: 'alert' });
  return h('form', { class: 'stack', style: 'text-align:left', onsubmit: async (e) => { e.preventDefault(); try { await api.setNewPassword(pw.value); toast('Password updated', 'ok'); } catch (x) { err.textContent = x.message; } } },
    h('p', { class: 'sub', style: 'text-align:center' }, 'Choose a new password.'), field('New password (8+ characters)', pw), err, h('button', { class: 'btn primary', type: 'submit' }, 'Save password'));
}
function notMember() {
  return h('div', { class: 'stack' }, h('p', { class: 'banner warn' }, 'This account is not part of this couple’s space, so there is nothing to show. If this is a mistake, ask the app owner to add your email.'),
    h('button', { class: 'btn', onclick: () => api.signOut() }, 'Sign out'));
}

// ------------------------------------------------------------------ welcome
async function chooseWelcomePhoto() {
  const pool = api.eligiblePhotos();
  if (!pool.length) return null;
  let last = null; try { last = localStorage.getItem('ih.lastPhoto'); } catch { /* ignore */ }
  const choices = pool.length > 1 ? pool.filter((p) => p.id !== last) : pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  try { localStorage.setItem('ih.lastPhoto', pick.id); } catch { /* ignore */ }
  return pick;
}
async function showWelcome() {
  const photo = await chooseWelcomePhoto();
  const bg = h('div', { class: `bg${photo ? '' : ' art on'}`, 'aria-hidden': 'true' });
  const enter = h('button', { class: 'btn primary', style: 'width:100%;max-width:320px', onclick: dismiss }, 'Enter');
  const el = h('div', { class: 'welcome', role: 'dialog', 'aria-label': 'Welcome' }, bg,
    h('div', { class: 'inner' },
      h('img', { class: 'mark', src: '/assets/logo-mark.svg', alt: '' }),
      h('h1', {}, 'INFINITY ', h('b', {}, 'HEARTS')),
      h('p', { class: 'names' }, 'BECAM & FAITH'),
      h('p', { class: 'tag' }, APP.tagline),
      h('p', { class: 'support' }, APP.support),
      enter,
      h('p', { class: 'credit' }, 'BTECH STUDIOS')));
  function dismiss() { clearTimeout(auto); el.classList.add('leave'); setTimeout(() => el.remove(), 420); welcomed = true; setTimeout(flushMilestone, 500); }
  document.body.append(el);
  enter.focus();
  if (photo) {
    const url = await api.photoUrl(photo);
    if (url) { bg.style.backgroundImage = `url("${url}")`; requestAnimationFrame(() => bg.classList.add('on')); } else bg.classList.add('art', 'on');
  }
  const auto = setTimeout(dismiss, 9000);
}

// ------------------------------------------------------------------ shell + router
function buildShell() {
  const net = h('span', { class: 'netpill', hidden: true }, icon('cloudoff'), ' Offline');
  net.firstChild.style.cssText = 'width:12px;height:12px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:2';
  const badge = h('span', { class: 'badge', hidden: true });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Main' },
    TABS.map(([k, t]) => h('a', { class: 'tab', href: `#/${k}`, dataset: { route: k } }, icon(k), t, k === 'messages' ? badge : null)),
    h('a', { class: 'tab only-wide', href: '#/memories', dataset: { route: 'memories' } }, icon('memories'), 'Memories'),
    h('a', { class: 'tab only-wide', href: '#/settings', dataset: { route: 'settings' } }, icon('settings'), 'Settings'));
  const main = h('main', { id: 'main', tabindex: '-1' });
  const top = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', style: 'text-decoration:none;color:inherit' }, h('img', { src: '/assets/logo-mark.svg', alt: '' }), h('span', {}, 'Infinity ', h('b', {}, 'Hearts'))),
    net,
    h('a', { class: 'icon-btn only-narrow', href: '#/memories', 'aria-label': 'Memories' }, icon('memories')),
    h('a', { class: 'icon-btn only-narrow', href: '#/settings', 'aria-label': 'Settings' }, icon('settings')));
  const root = h('div', { class: 'shell' }, top, tabs, main);
  const updNet = () => { net.hidden = state.online; };
  const updBadge = () => { const n = api.unreadCount(); badge.hidden = n === 0 || state.mode !== 'cloud'; badge.textContent = n > 9 ? '9+' : String(n); badge.setAttribute('aria-label', `${n} unread`); };
  on('net', updNet); on('messages', updBadge); on('data', updBadge);
  updNet(); updBadge();
  return { root, main, tabs };
}

async function route() {
  if (!state.authed || !shell) return;
  const name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'home';
  const key = ROUTES[name] ? name : 'home';
  scrollMemo[curRoute] = scrollY; curRoute = key;
  cleanup?.(); cleanup = null;
  shell.tabs.querySelectorAll('.tab').forEach((a) => (a.dataset.route === key ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  shell.main.replaceChildren();
  try {
    const mod = await ROUTES[key]();
    cleanup = mod.mount(shell.main) || null;
  } catch (e) {
    console.error(e);
    // The technical reason is shown in small print so a problem can be reported and fixed quickly.
    const why = `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 160)}`;
    shell.main.replaceChildren(h('div', { class: 'banner warn' }, navigator.onLine ? 'Something went wrong loading this page.' : 'This page has not been saved for offline use yet. Reconnect once to load it.', h('small', { style: 'display:block;margin-top:8px;opacity:.75;word-break:break-word' }, why)));
  }
  scrollTo(0, scrollMemo[key] || 0);
}
const scrollMemo = {}; let curRoute = '';
window.addEventListener('hashchange', route);

let backReady = false, warnedStorage = false;
async function showApp() {
  if (!backReady) { backReady = true; initBack(() => toast('Press back again to exit')); }   // also after a fresh sign-in
  shell = buildShell();
  if (storageDegraded() && !warnedStorage) { warnedStorage = true; toast('Your browser cannot save data on this device (storage is full or blocked). The app works, but offline copies are not kept.', 'error'); }
  app.replaceChildren(shell.root);
  if (!location.hash) history.replaceState(null, '', '#/home');
  await route();
  if (!welcomed) showWelcome();
}

on('auth', () => { if (!state.authed || state.recovery || state.notMember) authScreen(); else if (!shell) showApp(); });
// Milestone toasts wait until the welcome screen is gone so they never cover its button.
let pendingMilestone = null;
const flushMilestone = () => { if (pendingMilestone && state.authed) { toast(`${pendingMilestone.title}: ${pendingMilestone.message}`, 'ok'); } pendingMilestone = null; };
// Sounds: Teams tone when a message lands while you are inside the chat, WhatsApp tone for everything else in the app.
const inChat = () => (location.hash.replace(/^#\/?/, '').split('?')[0]) === 'messages';
on('messages', (e) => {
  if (!e.detail?.incoming || !state.authed) return;
  if (inChat() && !document.hidden) { playSound('chat'); haptic('receive'); return; }
  playSound('notify'); haptic('receive');
  const last = state.messages[state.messages.length - 1];
  if (!document.hidden) toast(`${chatName()}: ${last?.content?.slice(0, 80) || 'New message'}`, 'ok', { onClick: () => { location.hash = '#/messages'; } });
});
on('milestone', (e) => { playSound('notify'); pendingMilestone = e.detail; if (welcomed) flushMilestone(); });

// ------------------------------------------------------------------ boot
const isDevHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
function setupMessage() {
  app.replaceChildren(h('main', { class: 'auth' }, h('div', { class: 'panel stack', style: 'text-align:center' },
    h('img', { class: 'mark', src: '/assets/logo-mark.svg', alt: '' }),
    h('h1', { class: 'title' }, 'Infinity ', h('span', { class: 'heart' }, 'Hearts')),
    h('p', { class: 'banner warn', style: 'text-align:left' }, 'This site is not connected to its database yet, so sign-in is switched off. The owner needs to set SUPABASE_URL and SUPABASE_ANON_KEY in the hosting settings and redeploy. Nothing private is shown here.'))));
}
(async function boot() {
  document.documentElement.dataset.text = localStorage.getItem('ih.text') || 'normal';
  document.documentElement.dataset.motion = localStorage.getItem('ih.motion') || 'on';
  if (!CLOUD && !isDevHost) { setupMessage(); return; }
  registerSW(); initSound(); initHaptics();
  try {
    await api.init();
  } catch (e) { console.error('init failed', e); }
  if (!state.authed || state.recovery || state.notMember) { authScreen(); return; }
  await showApp();
  if (isNative()) scheduleNativeReminders().catch((e) => console.warn('native schedule', e));
  // Re-check milestones when the app returns to the foreground (e.g., after midnight)
  document.addEventListener('visibilitychange', () => { api.presenceVisibility(); if (!document.hidden && state.authed) api.syncMilestones().catch(() => { }); });
  if (CLOUD && state.online) api.flushOutbox();
})();