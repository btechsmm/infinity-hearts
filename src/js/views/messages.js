import { h, toast, fmtTime, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { state, on, sendMessage, flushOutbox, markThreadRead, deleteMessage, discardOutbox } from '../api.js';
import { partnerName, dailyQuote, quoteAuthor, tz } from '../selectors.js';
import { milestoneForDay } from '../core/milestones.js';
import { openModal, confirmDialog, emptyState } from '../ui.js';

export function mount(root) {
  if (state.mode !== 'cloud') {
    root.append(emptyState(icon('messages'), 'Private messages need an account', 'Messaging is optional. Sign in with your Infinity Hearts account to use it. Everything else works without it.'));
    return () => {};
  }
  const thread = h('div', { class: 'thread', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const input = h('textarea', { rows: '1', maxlength: '2000', placeholder: `Write to ${partnerName()}…`, 'aria-label': 'Message' });
  const status = h('p', { class: 'hint', style: 'text-align:center' });

  async function send(content, type = 'text', quoteId = null) {
    try { await sendMessage({ content, type, quoteId }); }
    catch (e) { toast(e.message, 'error'); }
  }
  const submit = () => { const v = input.value.trim(); if (!v) return; input.value = ''; input.style.height = ''; send(v); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width: 860px)').matches) { e.preventDefault(); submit(); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });

  function bubble(m, mine) {
    const deleted = !!m.deleted_at;
    const el = h('div', { class: `msg ${mine ? 'me' : 'them'}${m.message_type === 'quote' ? ' quote' : ''}${deleted ? ' deleted' : ''}` },
      deleted ? 'Message deleted' : m.content,
      h('div', { class: 'meta' }, fmtTime(m.sent_at, state.profile?.timezone || tz()), mine && !deleted ? (m.read_at ? 'Read' : 'Sent') : ''));
    if (mine && !deleted) {
      el.tabIndex = 0;
      el.setAttribute('aria-label', `${m.content}. Press to delete.`);
      const del = async () => { if (await confirmDialog({ title: 'Delete this message?', body: `It will disappear for both of you. This cannot be undone.`, confirmLabel: 'Delete', danger: true })) { try { await deleteMessage(m.id); } catch (e) { toast(e.message, 'error'); } } };
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); del(); });
      let t; el.addEventListener('touchstart', () => { t = setTimeout(del, 650); }, { passive: true });
      ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
      el.addEventListener('keydown', (e) => { if (e.key === 'Delete' || e.key === 'Backspace') del(); });
    }
    return el;
  }
  function queued(o) {
    return h('div', { class: 'msg me queued' }, o.content,
      h('div', { class: 'meta' }, o.status === 'failed' ? 'Not sent' : state.online ? 'Sending…' : 'Waiting for connection',
        h('button', { class: 'btn small ghost', style: 'min-height:28px;padding:0 8px', 'aria-label': 'Discard unsent message', onclick: () => discardOutbox(o.id) }, 'Discard')));
  }

  let lastCount = -1;
  function render() {
    const stick = innerHeight + scrollY >= document.body.scrollHeight - 140;
    const kids = []; let day = '';
    for (const m of state.messages) {
      const d = m.sent_at.slice(0, 10);
      if (d !== day) { day = d; kids.push(h('div', { class: 'eyebrow', style: 'text-align:center;margin:8px 0' }, fmtDate(m.sent_at, state.profile?.timezone || tz(), { weekday: 'short', day: 'numeric', month: 'short' }))); }
      kids.push(bubble(m, m.sender_id === state.user.id));
    }
    for (const o of state.outbox) kids.push(queued(o));
    thread.replaceChildren(...(kids.length ? kids : [emptyState(icon('heart'), `Say hello to ${partnerName()}`, 'This is a private space for just the two of you.')]));
    status.textContent = !state.online ? 'You are offline. Messages you write will be sent when you are back online.' : state.outbox.length ? 'Sending queued messages…' : '';
    if (state.messages.length !== lastCount || state.outbox.length) { if (stick || lastCount < 0) setTimeout(() => scrollTo(0, document.body.scrollHeight), 30); }
    lastCount = state.messages.length;
    markThreadRead();
  }

  function sendPicker() {
    openModal((close) => {
      const now = new Date();
      const q = dailyQuote(now); const ms = milestoneForDay(now, state.cfg, state.cfg.customRules);
      const favs = state.quotes.filter((x) => state.favorites.has(x.id)).slice(0, 12);
      const opt = (label, text, type, quoteId) => h('button', { class: 'btn', style: 'justify-content:flex-start;text-align:left;height:auto;padding:10px 14px;white-space:normal', onclick: () => { send(text, type, quoteId); close(); } }, h('span', {}, h('b', { style: 'display:block' }, label), h('span', { class: 'sub' }, text)));
      return h('div', { class: 'stack' }, h('h2', { class: 'title' }, `Send to ${partnerName()}`),
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

  root.append(h('div', {}, h('header', { class: 'row between' }, h('div', {}, h('h1', { class: 'title' }, partnerName()), h('p', { class: 'sub' }, 'Private messages. Only the two of you can read them.')),
    h('button', { class: 'btn small', onclick: sendPicker }, icon('heart'), 'Send…')), thread, status,
    h('div', { class: 'composer' }, input, h('button', { class: 'btn primary', 'aria-label': 'Send message', onclick: submit }, icon('messages')))));
  render();
  const o1 = on('messages', render); const o2 = on('net', () => { render(); flushOutbox(); });
  return () => { o1(); o2(); };
}
