import { localDayNumber, localDateISO, MS, DEFAULTS } from './time.js';

export const DEFAULT_REMINDERS = { daysBefore: [7, 3, 1, 0] };

/** Default events. The anniversary is 8 September and is NOT the departure date. */
export function defaultSpecialDates(cfg = {}) {
  const ret = (cfg.expectedReturnAt ?? DEFAULTS.expectedReturnAt);
  const retDate = localDateISO(new Date(ret), cfg.homeTimezone ?? DEFAULTS.homeTimezone);
  return [
    { id: 'anniversary', title: 'Our Anniversary', event_date: '2000-09-08', recurrence_type: 'yearly', message: 'Another year of us. Distance has not changed a thing.', builtin: true },
    { id: 'valentines', title: "Valentine's Day", event_date: '2000-02-14', recurrence_type: 'yearly', message: 'Across the miles, you are my Valentine.', builtin: true },
    { id: 'christmas', title: 'Christmas Day', event_date: '2000-12-25', recurrence_type: 'yearly', message: 'Merry Christmas, my love. Next time, together.', builtin: true },
    { id: 'nye', title: "New Year's Eve", event_date: '2000-12-31', recurrence_type: 'yearly', message: 'One more year closer to each other.', builtin: true },
    { id: 'nyd', title: "New Year's Day", event_date: '2000-01-01', recurrence_type: 'yearly', message: 'A new year, a smaller distance.', builtin: true },
    { id: 'return', title: "Faith's Expected Return", event_date: retDate, recurrence_type: 'none', message: 'The day we have been counting down to.', builtin: true },
  ];
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Date of the occurrence in `year`. A 29 Feb event is observed on 28 Feb in non-leap years. */
function occurrenceInYear(month, day, year) {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

const toDayNum = (o) => Math.round(Date.UTC(o.year, o.month - 1, o.day) / MS.day);

/**
 * Next occurrence on or after today (in tz).
 * recurrence 'yearly' repeats; 'none' occurs once (and may be in the past).
 */
export function nextOccurrence(event, now, tz = DEFAULTS.homeTimezone) {
  const today = localDayNumber(now, tz);
  const [y0, m0, d0] = event.event_date.split('-').map(Number);
  if (event.recurrence_type === 'yearly') {
    const thisYear = new Date(today * MS.day).getUTCFullYear();
    for (const y of [thisYear, thisYear + 1]) {
      const o = occurrenceInYear(m0, d0, y);
      if (toDayNum(o) >= today) return { ...o, dayNumber: toDayNum(o), daysUntil: toDayNum(o) - today, past: false };
    }
  }
  const dn = Math.round(Date.UTC(y0, m0 - 1, d0) / MS.day);
  return { year: y0, month: m0, day: d0, dayNumber: dn, daysUntil: dn - today, past: dn < today };
}

export function isoOf(o) {
  return `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`;
}

/** Reminder lead times that fall exactly today for this event. */
export function remindersDueToday(event, now, tz = DEFAULTS.homeTimezone) {
  const occ = nextOccurrence(event, now, tz);
  if (occ.past) return [];
  const offsets = event.reminder_settings?.daysBefore ?? DEFAULT_REMINDERS.daysBefore;
  return offsets.includes(occ.daysUntil) ? [{ daysBefore: occ.daysUntil, date: isoOf(occ) }] : [];
}

export function sortUpcoming(events, now, tz) {
  return events
    .map((e) => ({ event: e, occ: nextOccurrence(e, now, tz) }))
    .filter((x) => !x.occ.past)
    .sort((a, b) => a.occ.dayNumber - b.occ.dayNumber);
}
