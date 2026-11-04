import { h, fmtDate } from '../util.js';
import { subscribe } from '../clock.js';
import { state, on, sendMessage } from '../api.js';
import { elapsedCard, remainingCard, progressCard } from './widgets.js';
import { milestoneForDay } from '../core/milestones.js';
import { MS, localDateISO } from '../core/time.js';
import { tz, partnerName } from '../selectors.js';
import { toast } from '../util.js';

const MINOR = new Set(['daily', 'weekly', 'every_10']);

function upcomingKeyMilestones(now, limit = 8) {
  const out = [];
  for (let i = 1; i <= 800 && out.length < limit; i++) {
    const d = new Date(now.getTime() + i * MS.day);
    const m = milestoneForDay(d, state.cfg, state.cfg.customRules);
    if (m && !MINOR.has(m.milestone_type)) out.push(m);
    if (!m && i > 1 && new Date(d) > new Date(state.cfg.expectedReturnAt)) break;
  }
  return out;
}

export function mount(root) {
  const el = elapsedCard({ big: true }); const rem = remainingCard({ big: true }); const prog = progressCard();
  const listHost = h('div');
  let showAll = false, shown = 40;

  function renderLists() {
    const now = new Date();
    const hist = state.milestones.filter((m) => showAll || !MINOR.has(m.milestone_type));
    const up = upcomingKeyMilestones(now);
    const row = (m, future) => h('div', { class: `ev${future ? ' future' : ''}` },
      h('b', {}, m.title), h('br'), h('span', { class: 'sub' }, m.message), h('br'),
      h('small', {}, fmtDate(m.milestone_date, 'UTC')),
      !future && state.mode === 'cloud' ? h('div', { style: 'margin-top:6px' }, h('button', { class: 'btn small ghost', onclick: async () => { try { await sendMessage({ content: `${m.title}. ${m.message}`, type: 'milestone' }); toast(`Sent to ${partnerName()}`, 'ok'); } catch (e) { toast(e.message, 'error'); } } }, `Send to ${partnerName()}`)) : null);
    listHost.replaceChildren(
      h('section', { class: 'card' },
        h('h2', {}, 'Coming up'),
        up.length ? h('div', { class: 'tl', style: 'margin-top:12px' }, up.map((m) => row(m, true))) : h('p', { class: 'sub', style: 'margin-top:8px' }, 'No further key milestones before the reunion.')),
      h('section', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'row between' },
          h('h2', {}, 'Milestone history'),
          h('button', { class: 'chip', 'aria-pressed': String(showAll), onclick: () => { showAll = !showAll; shown = 40; renderLists(); } }, showAll ? 'Showing every day' : 'Key moments')),
        hist.length
          ? h('div', { class: 'tl', style: 'margin-top:12px' }, hist.slice(0, shown).map((m) => row(m, false)))
          : h('p', { class: 'sub', style: 'margin-top:8px' }, state.cfg && new Date() < new Date(state.cfg.departureAt) ? 'Milestones begin on departure day.' : 'Milestones will appear here as we reach them.'),
        hist.length > shown ? h('button', { class: 'btn small', style: 'margin-top:8px', onclick: () => { shown += 40; renderLists(); } }, 'Show more') : null),
      h('section', { class: 'card', style: 'margin-top:14px' },
        h('h2', {}, 'The two ends of the journey'),
        h('div', { class: 'tl', style: 'margin-top:12px' },
          h('div', { class: 'ev' }, h('b', {}, 'Departure'), h('br'), h('small', {}, fmtDate(state.cfg.departureAt, state.cfg.homeTimezone))),
          h('div', { class: `ev${new Date() < new Date(state.cfg.expectedReturnAt) ? ' future' : ''}` }, h('b', {}, state.cfg.actualReunionAt ? 'Reunited' : 'Planned reunion'), h('br'),
            h('small', {}, fmtDate(state.cfg.actualReunionAt || state.cfg.expectedReturnAt, state.cfg.homeTimezone)),
            state.cfg.actualReunionAt ? null : h('p', { class: 'hint' }, 'A plan, not a promise: dates can change and that is okay.')))));
  }

  root.append(h('div', { class: 'stack' }, h('header', {}, h('h1', { class: 'title' }, 'Our Journey'), h('p', { class: 'sub' }, 'Every day, counted together.')), el.el, rem.el, prog.el, listHost));
  renderLists();
  const un1 = subscribe((now) => { el.update(now); rem.update(now); prog.update(now); });
  const un2 = on('data', renderLists);
  let lastDay = localDateISO(new Date(), tz());
  const un3 = subscribe((now) => { const d = localDateISO(now, tz()); if (d !== lastDay) { lastDay = d; renderLists(); } });
  return () => { un1(); un2(); un3(); };
}
