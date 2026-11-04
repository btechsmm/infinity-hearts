import { journeySnapshot, localDateISO, MS, plural } from './time.js';

// Priority: higher wins when several rules match the same day.
// Exactly one primary milestone is produced per calendar day, keyed by date,
// so reopening the app never creates a duplicate.

const MONTH_NAMES = ['One month', 'Two months', 'Three months', 'Four months', 'Five months', 'Six months', 'Seven months', 'Eight months', 'Nine months', 'Ten months', 'Eleven months'];

function addMonthsUTC(date, n) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

/** Whole months elapsed on calendar day `elapsedDays` if that day is a month-anniversary, else 0. */
export function monthAnniversary(departureDay, elapsedDays) {
  const base = new Date(departureDay * MS.day);
  for (let m = 1; m <= 60; m++) {
    const dayNum = Math.round(addMonthsUTC(base, m).getTime() / MS.day) - departureDay;
    if (dayNum === elapsedDays) return m;
    if (dayNum > elapsedDays) return 0;
  }
  return 0;
}

function fill(tpl, ctx) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(ctx[k] ?? ''));
}

/** Placeholders available to custom rule templates: {elapsed} {remaining} {total} {months}. */
function templateVars(c) {
  return { elapsed: c.elapsedDays, remaining: c.remainingDays, total: c.totalDays, months: c.monthsApart };
}

/** Built-in rules. Extra rules can be supplied via `customRules` (see README). */
export function builtInRules() {
  return [
    { type: 'reunion_day', priority: 100, match: (c) => c.phase === 'reunited' && c.remainingDays === 0 && c.elapsedDays === c.totalDays, title: 'Reunion day', message: () => 'Today is the day we have been counting down to.' },
    { type: 'final_24h', priority: 95, match: (c) => c.phase === 'apart' && c.remainingDays === 1, title: 'Tomorrow', message: () => 'Tomorrow is the day. One more sleep until we are together again.' },
    { type: 'remaining_7', priority: 90, match: (c) => c.phase === 'apart' && c.remainingDays === 7, title: '7 days left', message: () => '7 days left. Nearly there, my love.' },
    { type: 'remaining_14', priority: 88, match: (c) => c.phase === 'apart' && c.remainingDays === 14, title: '14 days left', message: () => 'Two weeks to go. The finish line is in sight.' },
    { type: 'remaining_30', priority: 86, match: (c) => c.phase === 'apart' && c.remainingDays === 30, title: '30 days left', message: () => '30 days left. One more month and we are together.' },
    { type: 'remaining_100', priority: 84, match: (c) => c.phase === 'apart' && c.remainingDays === 100, title: '100 days to go', message: () => '100 days to our reunion. The end of the distance is closer than the start.' },
    { type: 'remaining_180', priority: 82, match: (c) => c.phase === 'apart' && c.remainingDays === 180, title: 'About six months to go', message: () => '180 days left. We are on the final stretch.' },
    { type: 'remaining_365', priority: 80, match: (c) => c.phase === 'apart' && c.remainingDays === 365, title: 'One year to go', message: () => 'Only 365 days until we can hug again.' },
    { type: 'one_year', priority: 78, match: (c) => c.phase === 'apart' && c.elapsedDays === 365, title: 'One year apart', message: (c) => `One year of loving each other across the distance. ${plural(c.remainingDays, 'day')} to go.` },
    { type: 'every_100', priority: 70, match: (c) => c.phase === 'apart' && c.elapsedDays > 0 && c.elapsedDays % 100 === 0, title: (c) => `${c.elapsedDays} days`, message: (c) => `${plural(c.elapsedDays, 'day')} of loving each other across the distance. ${c.remainingDays} to go.` },
    { type: 'every_50', priority: 60, match: (c) => c.phase === 'apart' && c.elapsedDays > 0 && c.elapsedDays % 50 === 0, title: (c) => `${c.elapsedDays} days`, message: (c) => `${plural(c.elapsedDays, 'day')} behind us. Our reunion is getting closer.` },
    { type: 'monthly', priority: 55, match: (c) => c.phase === 'apart' && c.monthsApart > 0, title: (c) => (c.monthsApart % 12 === 0 ? `${c.monthsApart / 12} year${c.monthsApart === 12 ? '' : 's'}` : `${c.monthsApart} month${c.monthsApart === 1 ? '' : 's'} down`), message: (c) => `${c.monthsApart <= 11 ? MONTH_NAMES[c.monthsApart - 1] : `${c.monthsApart} months`} down, and every day brings us closer. ${plural(c.remainingDays, 'day')} to go.` },
    { type: 'every_25', priority: 50, match: (c) => c.phase === 'apart' && c.elapsedDays > 0 && c.elapsedDays % 25 === 0, title: (c) => `${c.elapsedDays} days`, message: (c) => `${plural(c.elapsedDays, 'day')} apart, ${c.remainingDays} to go. Still choosing each other.` },
    { type: 'every_10', priority: 40, match: (c) => c.phase === 'apart' && c.elapsedDays > 0 && c.elapsedDays % 10 === 0, title: (c) => `${c.elapsedDays} days apart`, message: (c) => `${c.elapsedDays} days apart. ${c.remainingDays} days to go.` },
    { type: 'weekly', priority: 30, match: (c) => c.phase === 'apart' && c.elapsedDays > 0 && c.elapsedDays % 7 === 0, title: (c) => `${c.elapsedDays / 7} week${c.elapsedDays === 7 ? '' : 's'} done`, message: (c) => `Another week completed. ${plural(c.remainingDays, 'day')} left.` },
    { type: 'daily', priority: 10, match: (c) => c.phase === 'apart', title: (c) => `Day ${c.elapsedDays}`, message: (c) => `Another day is behind us. ${plural(c.remainingDays, 'day')} to go.` },
  ];
}

function customToRule(r) {
  const key = r.kind === 'remaining' ? 'remainingDays' : 'elapsedDays';
  return {
    type: r.type ?? `custom_${r.kind}_${r.days}`,
    priority: r.priority ?? 75,
    match: (c) => c.phase === 'apart' && c[key] === r.days,
    title: (c) => fill(r.title, templateVars(c)),
    message: (c) => fill(r.message, templateVars(c)),
  };
}

export function contextFor(now, cfg) {
  const snap = journeySnapshot(now, cfg);
  const depDay = Math.round(new Date(localDateISO(snap.departure, snap.timezone) + 'T00:00:00Z').getTime() / MS.day);
  return {
    snap,
    ctx: {
      phase: snap.phase,
      elapsedDays: snap.calendar.elapsedDays,
      remainingDays: snap.calendar.remainingDays,
      totalDays: snap.calendar.totalDays,
      monthsApart: snap.phase === 'apart' ? monthAnniversary(depDay, snap.calendar.elapsedDays) : 0,
    },
  };
}

/** The single primary milestone for the calendar day containing `now`, or null (before departure). */
export function milestoneForDay(now, cfg, customRules = []) {
  const { snap, ctx } = contextFor(now, cfg);
  if (snap.phase === 'before') return null;
  const rules = [...builtInRules(), ...customRules.map(customToRule)].sort((a, b) => b.priority - a.priority);
  const rule = rules.find((r) => r.match(ctx));
  if (!rule) return null;
  const date = localDateISO(now, snap.timezone);
  const val = (v) => (typeof v === 'function' ? v(ctx) : v);
  return {
    key: `ms:${date}`,
    milestone_type: rule.type,
    title: val(rule.title),
    message: val(rule.message),
    milestone_date: date,
    elapsed_days: ctx.elapsedDays,
    remaining_days: ctx.remainingDays,
    significant: rule.priority >= 30,
  };
}

/** Walk every day from `sinceISO` (exclusive) to now to catch up after being offline. Skips keys already recorded. */
export function missedMilestones(now, cfg, existingKeys = new Set(), sinceISO = null, customRules = []) {
  const tz = cfg.homeTimezone ?? 'Africa/Nairobi';
  const out = [];
  const endDay = Math.round(new Date(localDateISO(now, tz) + 'T00:00:00Z').getTime() / MS.day);
  let startDay = sinceISO ? Math.round(new Date(sinceISO + 'T00:00:00Z').getTime() / MS.day) + 1 : endDay;
  startDay = Math.max(startDay, endDay - 400); // sanity cap
  for (let d = startDay; d <= endDay; d++) {
    const noonUtc = new Date(d * MS.day + 9 * MS.hour); // ~noon in UTC+3 zones; day number is what matters
    const probe = d === endDay ? now : noonUtc;
    const m = milestoneForDay(probe, cfg, customRules);
    if (m && !existingKeys.has(m.key) && m.milestone_date === localDateISO(probe, tz)) out.push(m);
  }
  return out;
}
