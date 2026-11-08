// iMessage-style private chat: full-screen, keyboard-aware, with typing, online / last seen and colour themes.
import { h, toast, fmtTime } from '../util.js';
import { icon } from '../icons.js';
import { state, on, sendMessage, flushOutbox, markThreadRead, deleteMessage, discardOutbox, notifyTyping, setPartnerNickname } from '../api.js';
import { chatName, partnerName, dailyQuote, quoteAuthor, tz } from '../selectors.js';
import { milestoneForDay } from '../core/milestones.js';
import { statusLine, formatStamp, needsStamp } from '../core/presence.js';
import { openModal, confirmDialog, emptyState } from '../ui.js';
import { chatTheme } from '../chatTheme.js';
import { avatarNode, paintAvatar } from '../avatar.js';
import { avatarControls, colourControls, wallpaperControls } from '../chatStyle.js';
import { applyWallpaper } from '../wallpaper.js';
import { haptic } from '../haptics.js';
import { clearChatNotifications } from '../push.js';

export function mount(root) {
  if (state.mode !== 'cloud') {
    root.append(emptyState(icon('messages'), 'Private messages need an account', 'Messaging is optional. Sign in with your Infinity Hearts account to use it. Everything else works without it.'));
    return () => { };
  }
  document.body.classList.add('chat-mode');
  const zone = () => state.profile?.timezone || tz();
  let name = chatName();

  // ---------- header
  const dot = h('span', { class: 'presence-dot', 'aria-hidden': 'true' });
  const statusEl = h('p', { class: 'chat-status', 'aria-live': 'polite' });
  const avatar = avatarNode([dot], 'avatar chat-avatar');
  const nameBtn = h('button', { class: 'name-btn', type: 'button', onclick: renamePicker });
  const paintName = () => {
    name = chatName();
    nameBtn.textContent = name; nameBtn.setAttribute('aria-label', `${name}. Change the name shown for ${partnerName()}`);
    paintAvatar(avatar, state.partner?.id, name);
    input.placeholder = 'Message'; input.setAttribute('aria-label', `Message to ${name}`);
    chat.setAttribute('aria-label', `Chat with ${name}`);
  };
  const back = h('button', { class: 'chat-icon', type: 'button', 'aria-label': 'Back', onclick: () => { if (history.length > 2) history.back(); else location.hash = '#/home'; } }, icon('back'));
  const header = h('header', { class: 'chat-head' }, back,
    avatar,
    h('div', { class: 'chat-who' }, h('h1', {}, nameBtn), statusEl),
    h('button', { class: 'chat-icon', type: 'button', 'aria-label': 'Chat style', onclick: stylePicker }, icon('palette')),
    h('button', { class: 'chat-icon', type: 'button', 'aria-label': `Send a saved message to ${name}`, onclick: sendPicker }, icon('heart')));

  // ---------- thread
  const scroller = h('div', { class: 'chat-scroll', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const typingRow = h('div', { class: 'bubble-row them typing-row', hidden: true, 'aria-label': `${name} is typing` }, h('div', { class: 'bubble typing', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')));
  const offlineBar = h('p', { class: 'chat-offline', hidden: true });

  // ---------- composer
  const input = h('textarea', { rows: '1', maxlength: '2000', placeholder: 'Message', 'aria-label': `Message to ${name}`, enterkeyhint: 'send', autocapitalize: 'sentences' });
  const sendBtn = h('button', { class: 'send-btn', type: 'button', 'aria-label': 'Send message', disabled: true, 'data-haptic': 'none', onpointerdown: (e) => e.preventDefault(), onclick: submit }, icon('arrowup'));
  const composer = h('form', { class: 'chat-composer', onsubmit: (e) => { e.preventDefault(); submit(); } }, h('div', { class: 'pill' }, input, sendBtn));

  const chat = h('section', { class: 'chat', dataset: { theme: chatTheme() }, 'aria-label': `Chat with ${name}` }, header, offlineBar, scroller, composer);
  root.append(chat);

  async function send(content, type = 'text', quoteId = null) {
    try { haptic('send'); await sendMessage({ content, type, quoteId }); } catch (e) { toast(e.message, 'error'); }
  }
  function submit() {
    const v = input.value.trim(); if (!v) return;
    input.value = ''; autosize(); notifyTyping(false); send(v);
    input.focus();                                         // keeps the keyboard open between messages
    stickBottom(true);
  }
  const wide = () => matchMedia('(min-width: 860px) and (pointer: fine)').matches;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && wide()) { e.preventDefault(); submit(); } });
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; sendBtn.disabled = !input.value.trim(); sendBtn.classList.toggle('on', !!input.value.trim()); }
  input.addEventListener('input', () => { autosize(); notifyTyping(!!input.value.trim()); });
  input.addEventListener('blur', () => notifyTyping(false));

  // ---------- keyboard: the chat is sized to the *visual* viewport so the composer rides above the keyboard
  const vv = window.visualViewport;
  function fit() {
    const hgt = vv ? vv.height : innerHeight, top = vv ? vv.offsetTop : 0;
    chat.style.setProperty('--vvh', `${Math.round(hgt)}px`);
    chat.style.setProperty('--vvt', `${Math.round(top)}px`);
    chat.classList.toggle('kb', !!vv && innerHeight - vv.height > 120);
    if (atBottom || input === document.activeElement) stickBottom(true);
  }
  let atBottom = true;
  scroller.addEventListener('scroll', () => { atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80; }, { passive: true });
  function stickBottom(force) { if (force || atBottom) requestAnimationFrame(() => { scroller.scrollTop = scroller.scrollHeight; atBottom = true; }); }
  vv?.addEventListener('resize', fit); vv?.addEventListener('scroll', fit); addEventListener('resize', fit);
  const lockScroll = () => { if (document.activeElement === input) scrollTo(0, 0); };   // stop the page jumping under the keyboard
  addEventListener('scroll', lockScroll, { passive: true });

  // ---------- bubbles
  function bubble(m, mine, tail) {
    const deleted = !!m.deleted_at;
    const tick = mine && !deleted ? (m.read_at ? ['read', 'tick2', 'Read'] : m.delivered_at ? ['delivered', 'tick2', 'Delivered'] : ['sent', 'tick1', 'Sent']) : null;
    const el = h('div', { class: `bubble ${mine ? 'me' : 'them'}${tail ? ' tail' : ''}${m.message_type === 'quote' ? ' quote' : ''}${deleted ? ' deleted' : ''}`, dataset: { id: m.id } }, deleted ? 'Message deleted' : m.content,
      deleted ? null : h('span', { class: 'meta' }, fmtTime(m.sent_at, zone()), tick ? h('span', { class: `ticks ${tick[0]}`, role: 'img', 'aria-label': tick[2], dataset: { state: tick[0] } }, icon(tick[1])) : null));
    if (mine && !deleted) {
      el.tabIndex = 0; el.title = 'Press and hold to delete';
      el.setAttribute('aria-label', `${m.content}. Press and hold, or press Delete, to delete.`);
      const del = async () => { haptic('warn'); if (await confirmDialog({ title: 'Delete this message?', body: 'It will disappear for both of you. This cannot be undone.', confirmLabel: 'Delete', danger: true })) { try { await deleteMessage(m.id); } catch (e) { toast(e.message, 'error'); } } };
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); del(); });
      let t; el.addEventListener('touchstart', () => { t = setTimeout(del, 650); }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
      el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') del(); });
    }
    return h('div', { class: `bubble-row ${mine ? 'me' : 'them'}` }, el);
  }
  const queued = (o) => h('div', { class: 'bubble-row me' }, h('div', { class: 'bubble me tail queued' }, o.content, h('span', { class: 'meta' }, h('span', { class: 'ticks pending', role: 'img', 'aria-label': 'Not sent yet' }, icon('clock')))),
    h('div', { class: 'receipt' }, o.status === 'failed' ? 'Not delivered' : state.online ? 'Sending…' : 'Waiting for connection',
      h('button', { class: 'receipt-btn', type: 'button', 'aria-label': 'Discard unsent message', onclick: () => discardOutbox(o.id) }, 'Discard')));

  let lastCount = -1, lastId = null;
  function render() {
    const kids = []; let prev = null;
    const list = state.messages;
    list.forEach((m, i) => {
      if (needsStamp(prev?.sent_at, m.sent_at)) kids.push(h('div', { class: 'stamp' }, formatStamp(m.sent_at, new Date(), zone())));
      const next = list[i + 1];
      const tail = !next || next.sender_id !== m.sender_id || needsStamp(m.sent_at, next.sent_at);
      kids.push(bubble(m, m.sender_id === state.user.id, tail));
      prev = m;
    });
    for (const o of state.outbox) kids.push(queued(o));
    if (!kids.length) kids.push(emptyState(icon('heart'), `Say hello to ${name}`, 'This is a private space for just the two of you.'));
    scroller.replaceChildren(...kids, typingRow);
    offlineBar.hidden = state.online; offlineBar.textContent = state.online ? '' : 'You are offline. Messages you write are sent when you are back online.';
    const newest = list[list.length - 1]?.id || null;
    if (lastCount < 0) stickBottom(true); else if (list.length !== lastCount || newest !== lastId || state.outbox.length) stickBottom(false);
    lastCount = list.length; lastId = newest;
    markThreadRead();
  }

  function paintStatus() {
    const s = statusLine({ online: state.rt.partnerOnline, typing: state.rt.partnerTyping, lastSeen: state.partner?.last_seen_at, now: new Date(), tz: zone(), offline: !state.online });
    if (s.kind === 'none' && state.online && state.rt.error) { s.text = 'Status unavailable'; s.kind = 'none-err'; }
    statusEl.textContent = s.text; statusEl.dataset.kind = s.kind; statusEl.hidden = s.kind === 'none';
    statusEl.title = s.kind === 'none-err' ? 'Online status needs supabase/update-chat-features.sql to be run once in Supabase.' : '';
    dot.hidden = s.kind !== 'online' && s.kind !== 'typing';
    const showTyping = s.kind === 'typing';
    if (typingRow.hidden === showTyping) { typingRow.hidden = !showTyping; if (showTyping) stickBottom(false); }
  }

  // ---------- pickers
  function renamePicker() {
    openModal((close) => {
      const real = partnerName();
      const inp = h('input', { type: 'text', maxlength: '30', value: chatName() === real ? '' : chatName(), placeholder: real, 'aria-label': `Name to show for ${real}`, autocapitalize: 'words', enterkeyhint: 'done' });
      const save = async (v) => {
        const { synced } = await setPartnerNickname(v); close();
        toast(v ? `Chat will show “${v}”` : `Back to ${real}`, 'ok');
        if (!synced) toast('Saved on this device only. Run the nickname SQL to keep it on all your devices.', 'info');
      };
      return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(inp.value); } },
        h('h2', { class: 'title' }, 'Chat name'),
        h('p', { class: 'sub' }, `Choose what you see for ${real} in this chat. Only you see it; ${real} is not told and their own screen does not change.`),
        inp,
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary', type: 'submit' }, 'Save'),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => save('') }, `Use “${real}”`),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel')));
    }, { title: 'Chat name' });
  }
  function stylePicker() {
    openModal((close) => h('div', { class: 'stack' }, h('h2', { class: 'title' }, 'Chat style'),
      h('section', { class: 'stack tight' }, h('h3', { class: 'eyebrow' }, 'My profile picture'), avatarControls()),
      h('section', { class: 'stack tight' }, h('h3', { class: 'eyebrow' }, 'Chat colour'), colourControls()),
      h('section', { class: 'stack tight' }, h('h3', { class: 'eyebrow' }, 'Wallpaper'), wallpaperControls()),
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Done')), { title: 'Chat style' });
  }
  function sendPicker() {
    openModal((close) => {
      const now = new Date();
      const q = dailyQuote(now); const ms = milestoneForDay(now, state.cfg, state.cfg.customRules);
      const favs = state.quotes.filter((x) => state.favorites.has(x.id)).slice(0, 12);
      const opt = (label, text, type, quoteId) => h('button', { class: 'btn', style: 'justify-content:flex-start;text-align:left;height:auto;padding:10px 14px;white-space:normal', onclick: () => { send(text, type, quoteId); close(); } }, h('span', {}, h('b', { style: 'display:block' }, label), h('span', { class: 'sub' }, text)));
      return h('div', { class: 'stack' }, h('h2', { class: 'title' }, `Send to ${name}`),
        h('div', { class: 'stack' },
          ms ? opt('Today’s milestone', `${ms.title}. ${ms.message}`, 'milestone') : null,
          q ? opt('Today’s message', q.message, 'quote', q.id) : null,
          opt('Missing you', 'I miss you so much today.', 'missing_you'),
          opt('Encouragement', 'You are doing so well. I am so proud of you.', 'encouragement'),
          favs.length ? h('p', { class: 'eyebrow' }, 'From your saved messages') : null,
          favs.map((f) => opt(quoteAuthor(f), f.message, 'quote', f.id))),
        h('button', { class: 'btn ghost', onclick: () => close() }, 'Close'));
    }, { title: 'Send' });
  }

  applyWallpaper(chat); paintName(); render(); paintStatus(); fit(); autosize(); clearChatNotifications();
  const onWall = () => applyWallpaper(chat);
  document.addEventListener('ih-wallpaper', onWall);
  const off = [() => document.removeEventListener('ih-wallpaper', onWall), on('avatars', paintName), on('data', paintName), on('messages', render), on('presence', paintStatus), on('net', () => { render(); paintStatus(); flushOutbox(); })];
  const tick = setInterval(paintStatus, 30000);             // keeps "last seen … " wording fresh
  const onVis = () => { if (!document.hidden) { markThreadRead(); clearChatNotifications(); fit(); } };
  document.addEventListener('visibilitychange', onVis);
  return () => {
    off.forEach((f) => f()); clearInterval(tick); document.removeEventListener('visibilitychange', onVis);
    vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); removeEventListener('resize', fit); removeEventListener('scroll', lockScroll);
    notifyTyping(false); document.body.classList.remove('chat-mode');
  };
}