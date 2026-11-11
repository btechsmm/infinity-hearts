import { h, fmtDate, fmtNum } from '../util.js';
import { counter } from '../ui.js';
import { snap } from '../selectors.js';
import { state, updateSettings } from '../api.js';
import { plural } from '../core/time.js';
import { toast } from '../util.js';
import { confirmDialog } from '../ui.js';

/** "Time apart" card. Live values derive from timestamps each tick; calendar-day text is separate. */
export function elapsedCard({ big = false } = {}) {
  const c = counter(['Days', 'Hours', 'Minutes', 'Seconds'], big);
  const title = h('h2', {}, 'Time apart');
  const msg = h('p', { class: 'script', style: 'margin-top:10px;text-align:center' });
  const el = h('section', { class: 'card maroon', 'aria-label': 'Time apart' }, h('div', { class: 'counter-title' }, title), c.root, msg);
  return {
    el,
    update(now) {
      const s = snap(now);
      if (s.phase === 'before') {
        const u = s.live.untilDeparture;
        title.textContent = 'Our journey begins in';
        c.set(u.days, u.hours, u.minutes, u.seconds);
        msg.textContent = `Departure is on ${fmtDate(s.departure.toISOString(), s.timezone)}. Until then, every moment together counts.`;
        return;
      }
      const e = s.live.elapsed;
      title.textContent = s.phase === 'reunited' ? 'Time we were apart' : 'Time apart';
      c.set(e.days, e.hours, e.minutes, e.seconds);
      const d = s.calendar.elapsedDays;
      msg.textContent = s.phase === 'reunited'
        ? `We made it through ${plural(d, 'day')} apart, and now we are together.`
        : d === 0 ? 'Day one of our journey. We have already begun.' : `We have already made it through ${plural(d, 'day')} together, even from a distance.`;
    },
  };
}

export function remainingCard({ big = false } = {}) {
  const c = counter(['Days', 'Hours', 'Minutes', 'Seconds'], big);
  const title = h('h2', {}, 'Until we meet again');
  const heart = h('span', { class: 'heart', 'aria-hidden': 'true' }, '♥');
  const msg = h('p', { class: 'script', style: 'margin-top:10px;text-align:center' });
  const actions = h('div', { class: 'row', style: 'justify-content:center;margin-top:12px' });
  const el = h('section', { class: 'card maroon', 'aria-label': 'Countdown to reunion' }, h('div', { class: 'counter-title' }, title, heart), c.root, msg, actions);
  let shownPhase = '';
  return {
    el,
    update(now) {
      const s = snap(now);
      const r = s.live.remaining;
      c.set(r.days, r.hours, r.minutes, r.seconds);
      if (s.phase === 'reunited') {
        title.textContent = s.actualReunion ? 'Together again' : 'Reunion day';
        msg.textContent = s.actualReunion ? `Reunited on ${fmtDate(s.actualReunion.toISOString(), s.timezone)}.` : 'Today is the day we have been counting down to.';
      } else {
        title.textContent = 'Until we meet again';
        msg.textContent = s.phase === 'before' ? 'The whole journey is still ahead of us.' : 'Every second brings us closer.';
      }
      const want = s.phase === 'reunited' && !s.actualReunion ? 'confirm' : s.actualReunion ? 'done' : 'none';
      if (want !== shownPhase) {
        shownPhase = want; actions.replaceChildren();
        if (want === 'confirm') actions.append(h('button', { class: 'btn primary', onclick: confirmReunion }, 'We are together'));
      }
    },
  };
}

async function confirmReunion() {
  if (!(await confirmDialog({ title: 'Confirm our reunion?', body: 'This records today as the day we were reunited. The time apart will stop counting and stay saved as part of our story.', confirmLabel: 'Yes, we are together' }))) return;
  try { await updateSettings({ actualReunionAt: new Date().toISOString() }); toast('Welcome home, my love.', 'ok'); }
  catch (e) { toast(e.message, 'error'); }
}

export function progressCard() {
  const bar = h('i', { style: 'width:0%' });
  const track = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Journey progress', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar);
  const pct = h('b', { style: 'font-size:1.6rem;font-variant-numeric:tabular-nums' }, '0%');
  const mk = () => h('b', {}, '0');
  const stats = { el: mk(), rem: mk(), tot: mk(), done: mk(), left: mk() };
  const stat = (label, node) => h('div', {}, node, label);
  const el = h('section', { class: 'card', 'aria-label': 'Journey progress' },
    h('div', { class: 'counter-title' }, h('h2', {}, 'Our journey'), pct),
    track,
    h('div', { class: 'stats' }, stat('Days elapsed', stats.el), stat('Days remaining', stats.rem), stat('Total expected', stats.tot)),
    h('div', { class: 'stats', style: 'margin-top:10px' }, stat('Completed', stats.done), stat('Remaining', stats.left), h('div')));
  return {
    el,
    update(now) {
      const s = snap(now);
      const p = s.progress.percent;
      const w = `${p.toFixed(3)}%`;
      if (bar.style.width !== w) bar.style.width = w;
      track.setAttribute('aria-valuenow', p.toFixed(1));
      pct.textContent = `${p.toFixed(1)}%`;
      stats.el.textContent = fmtNum(s.calendar.elapsedDays);
      stats.rem.textContent = fmtNum(s.calendar.remainingDays);
      stats.tot.textContent = `${fmtNum(s.calendar.totalDays)} days`;
      stats.done.textContent = `${p.toFixed(1)}%`;
      stats.left.textContent = `${s.progress.percentRemaining.toFixed(1)}%`;
    },
  };
}
export const journeyCfgReady = () => state.cfg;
