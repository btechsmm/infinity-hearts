import { h, toast, fmtDate } from '../util.js';
import { icon, heartArt } from '../icons.js';
import { state, on, toggleFavorite, sendMessage, recordQuoteShown } from '../api.js';
import { dailyQuote, weeklyQuote, monthlyQuote, quoteAuthor, partnerName, tz } from '../selectors.js';
import { copyText, shareText, shareQuoteImage } from '../share.js';
import { localDateISO } from '../core/time.js';
import { emptyState } from '../ui.js';

const CATS = [
  ['daily_love', 'Daily Love'], ['weekly_motivation', 'Weekly Motivation'], ['monthly_reflection', 'Monthly Reflections'],
  ['long_distance', 'Long-Distance Love'], ['missing_you', 'Missing You'], ['patience_trust', 'Patience and Trust'],
  ['encouragement', 'Encouragement'], ['reunion_countdown', 'Reunion Countdown'], ['anniversary', 'Relationship Anniversary'], ['special_occasions', 'Special Occasions'],
];
const catName = Object.fromEntries(CATS);

export function quoteCard(q, { label } = {}) {
  const fav = state.favorites.has(q.id);
  const card = h('div', { class: 'qcard' },
    h('div', { class: 'bgheart' }, heartArt()),
    label ? h('div', { class: 'eyebrow' }, label) : null,
    h('div', { class: 'qm', 'aria-hidden': 'true' }, '“'),
    h('blockquote', {}, q.message),
    h('p', { class: 'by' }, `— ${quoteAuthor(q)}`),
    h('div', { class: 'qactions' },
      h('button', { class: 'btn small', 'aria-pressed': String(fav), 'aria-label': fav ? 'Remove from favourites' : 'Add to favourites', onclick: () => toggleFavorite(q.id) }, icon('heart'), fav ? 'Saved' : 'Save'),
      h('button', { class: 'btn small', onclick: () => copyText(q.message) }, icon('copy'), 'Copy'),
      h('button', { class: 'btn small', onclick: () => shareText(q.message) }, icon('share'), 'Share'),
      h('button', { class: 'btn small', onclick: () => shareQuoteImage(q.message, quoteAuthor(q)).catch(() => toast('Could not create the image', 'error')) }, icon('image'), 'As image'),
      state.mode === 'cloud' ? h('button', { class: 'btn small primary', onclick: async () => { try { await sendMessage({ content: q.message, type: 'quote', quoteId: q.id }); toast(`Sent to ${partnerName()}`, 'ok'); } catch (e) { toast(e.message, 'error'); } } }, icon('messages'), `Send to ${partnerName()}`) : null));
  const svgs = card.querySelectorAll('svg'); svgs.forEach((s) => s.setAttribute('aria-hidden', 'true'));
  return card;
}

export function mount(root) {
  let tab = 'today', period = 'daily', cat = 'all', query = '';
  const host = h('div', { class: 'stack' });
  const seg = (items, cur, set, label) => h('div', { class: 'seg', role: 'tablist', 'aria-label': label },
    items.map(([k, t]) => h('button', { role: 'tab', 'aria-selected': String(cur === k), onclick: () => { set(k); render(); } }, t)));

  function render() {
    const now = new Date();
    host.replaceChildren(
      h('header', {}, h('h1', { class: 'title' }, 'Love Quotes'), h('p', { class: 'sub' }, 'Words to carry across the miles.')),
      seg([['today', 'Today'], ['library', 'Library'], ['favs', 'Saved'], ['history', 'History']], tab, (k) => { tab = k; }, 'Quotes sections'));
    if (tab === 'today') {
      host.append(seg([['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], period, (k) => { period = k; }, 'Message period'));
      const q = period === 'daily' ? dailyQuote(now) : period === 'weekly' ? weeklyQuote(now) : monthlyQuote(now);
      if (q) {
        if (period === 'daily') recordQuoteShown(q, localDateISO(now, tz()));
        host.append(quoteCard(q, { label: period === 'daily' ? 'Today' : period === 'weekly' ? 'This week' : 'This month' }));
      } else host.append(emptyState(icon('quotes'), 'No messages yet', 'Messages appear here once the library has loaded.'));
    } else if (tab === 'library') {
      const search = h('input', { type: 'text', placeholder: 'Search messages', 'aria-label': 'Search messages', value: query, oninput: (e) => { query = e.target.value; list(); } });
      const chips = h('div', { class: 'row wrap' }, [['all', 'All'], ...CATS].map(([k, t]) => h('button', { class: 'chip', 'aria-pressed': String(cat === k), onclick: () => { cat = k; render(); } }, t)));
      const out = h('div', { class: 'card' });
      const list = () => {
        const items = state.quotes.filter((x) => (cat === 'all' || x.category === cat) && (!query || x.message.toLowerCase().includes(query.toLowerCase())));
        out.replaceChildren(...(items.length ? items.slice(0, 80).map(row) : [h('p', { class: 'empty' }, 'No matches.')]));
      };
      host.append(search, chips, out); list();
    } else if (tab === 'favs') {
      const favs = state.quotes.filter((x) => state.favorites.has(x.id));
      host.append(favs.length ? h('div', { class: 'card' }, favs.map(row)) : emptyState(icon('heart'), 'Nothing saved yet', 'Tap Save on any message and it will wait for you here, even offline.'));
    } else {
      const byId = new Map(state.quotes.map((x) => [x.id, x]));
      const hist = [...state.history].sort((a, b) => b.display_date.localeCompare(a.display_date)).filter((x) => byId.has(x.quote_id));
      host.append(hist.length ? h('div', { class: 'card' }, hist.slice(0, 120).map((x) => row(byId.get(x.quote_id), fmtDate(x.display_date, 'UTC')))) : emptyState(icon('clock'), 'No history yet', 'Each day’s message is remembered here.'));
    }
  }
  function row(q, when) {
    return h('div', { class: 'qrow' },
      h('div', { class: 'meta' }, when || catName[q.category] || '', ' · ', `— ${quoteAuthor(q)}`),
      h('p', {}, q.message),
      h('div', { class: 'row wrap', style: 'margin-top:8px' },
        h('button', { class: 'btn small ghost', 'aria-pressed': String(state.favorites.has(q.id)), onclick: () => toggleFavorite(q.id) }, icon('heart'), state.favorites.has(q.id) ? 'Saved' : 'Save'),
        h('button', { class: 'btn small ghost', onclick: () => copyText(q.message) }, icon('copy'), 'Copy'),
        h('button', { class: 'btn small ghost', onclick: () => shareText(q.message) }, icon('share'), 'Share')));
  }
  root.append(host);
  render();
  const off = on('data', () => { const y = scrollY; render(); scrollTo(0, y); });
  return off;
}
