import { h, fmtDate, fmtNum } from '../util.js';
import { icon } from '../icons.js';
import { subscribe } from '../clock.js';
import { state, on, recordQuoteShown, sendMessage } from '../api.js';
import { elapsedCard, remainingCard, progressCard } from './widgets.js';
import { mapSection } from '../map.js';
import { hello, dailyQuote, quoteAuthor, nextEvent, tz, partnerName } from '../selectors.js';
import { localDateISO } from '../core/time.js';
import { toast } from '../util.js';

const EVENT_ICON = { anniversary: 'heart', valentines: 'heart', christmas: 'gift', nye: 'spark', nyd: 'spark', return: 'plane' };

export function mount(root) {
  const cleanups = [];
  const greet = h('h1', { class: 'title' });
  const el = elapsedCard(); const rem = remainingCard(); const prog = progressCard();
  const quoteHost = h('div'); const eventHost = h('div'); const msHost = h('div');
  const map = mapSection(); cleanups.push(map.destroy);

  root.append(h('div', { class: 'stack' },
    h('header', {},
      greet,
      h('p', { class: 'script', style: 'margin-top:2px' }, 'No distance can break what we have.'),
      h('p', { class: 'eyebrow', style: 'margin-top:8px' }, `${state.cfg.coupleName.toUpperCase()} · INFINITY HEARTS`)),
    el.el, rem.el, prog.el,
    h('section', { class: 'card', 'aria-label': 'Distance map' }, h('h2', {}, `${state.cfg.homeCity.split(',')[0]} ♥ ${state.cfg.destinationCity.split(',')[0]}`), map.el),
    quoteHost, eventHost, msHost));

  function renderQuote(now) {
    const q = dailyQuote(now);
    quoteHost.replaceChildren();
    if (!q) return;
    recordQuoteShown(q, localDateISO(now, tz()));
    quoteHost.append(h('a', { href: '#/quotes', style: 'text-decoration:none;color:inherit;display:block' },
      h('div', { class: 'qcard' },
        h('div', { class: 'eyebrow' }, 'Today’s message'),
        h('blockquote', { style: 'font-size:1.12rem' }, q.message),
        h('p', { class: 'by' }, `— ${quoteAuthor(q)}`))));
  }
  function renderEvent(now) {
    eventHost.replaceChildren();
    const n = nextEvent(now);
    if (!n) return;
    const { event, occ } = n;
    eventHost.append(h('a', { href: '#/dates', style: 'text-decoration:none;color:inherit;display:block' },
      h('div', { class: `item${occ.daysUntil === 0 ? ' today' : ''}` },
        h('div', { class: 'ico' }, icon(EVENT_ICON[event.slug || event.id] || 'heart')),
        h('div', { class: 'txt' }, h('small', { class: 'eyebrow' }, 'Next special date'), h('b', {}, event.title), h('small', {}, fmtDate(`${occ.year}-${String(occ.month).padStart(2, '0')}-${String(occ.day).padStart(2, '0')}`, 'UTC'))),
        h('div', { class: 'when' }, h('b', {}, occ.daysUntil === 0 ? 'Today' : fmtNum(occ.daysUntil)), occ.daysUntil === 0 ? '' : occ.daysUntil === 1 ? 'day' : 'days'))));
  }
  function renderMilestone() {
    msHost.replaceChildren();
    const m = state.milestones[0];
    if (!m) return;
    msHost.append(h('section', { class: 'card' },
      h('h2', {}, 'Latest milestone'),
      h('p', { class: 'title', style: 'font-size:1.1rem;margin-top:8px' }, m.title),
      h('p', { class: 'sub' }, m.message),
      state.mode === 'cloud' ? h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn small', onclick: async () => {
        try { await sendMessage({ content: `${m.title}. ${m.message}`, type: 'milestone' }); toast(`Sent to ${partnerName()}`, 'ok'); } catch (e) { toast(e.message, 'error'); } } }, `Send to ${partnerName()}`)) : null));
  }

  let lastDay = '';
  cleanups.push(subscribe((now) => {
    greet.replaceChildren(hello(now), ' ', h('span', { class: 'heart', 'aria-hidden': 'true' }, '♥'));
    el.update(now); rem.update(now); prog.update(now);
    const day = localDateISO(now, tz());
    if (day !== lastDay) { lastDay = day; renderQuote(now); renderEvent(now); }
  }));
  renderMilestone();
  cleanups.push(on('data', () => { const now = new Date(); lastDay = ''; renderMilestone(); renderEvent(now); }));
  return () => cleanups.forEach((f) => f());
}
