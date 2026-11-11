// Pure date/time engine. No DOM, no network: safe to unit test in Node.
// All values derive from timestamps; nothing is hardcoded in the UI.

export const MS = { sec: 1000, min: 60000, hour: 3600000, day: 86400000 };

// Documented defaults, used only until real times are saved in couple_settings.
// 00:00 in Africa/Nairobi (UTC+3, no DST) on the stated dates.
export const DEFAULTS = {
  departureAt: '2026-10-19T21:00:00.000Z', // 20 Oct 2026 00:00 Nairobi
  expectedReturnAt: '2028-10-19T21:00:00.000Z', // 20 Oct 2028 00:00 Nairobi
  homeTimezone: 'Africa/Nairobi',
  destinationTimezone: 'Asia/Bahrain',
};

const fmtCache = new Map();
function dtf(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(
      tz,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    );
  }
  return fmtCache.get(tz);
}

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(date, tz) {
  const o = {};
  for (const p of dtf(tz).formatToParts(date)) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: o.minute, second: o.second };
}

/** Offset (ms) of tz from UTC at a given instant. */
export function tzOffsetMs(date, tz) {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in tz to a UTC Date (handles DST via two passes). */
export function zonedTimeToUtc(y, m, d, hh, mm, tz, ss = 0) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  t = guess - tzOffsetMs(new Date(t), tz);
  return new Date(t);
}

/** Calendar date (as a UTC-midnight day number) of an instant in tz. */
export function localDayNumber(date, tz) {
  const p = zonedParts(date, tz);
  return Math.round(Date.UTC(p.year, p.month - 1, p.day) / MS.day);
}

export function localDateISO(date, tz) {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function splitDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(t / 86400),
    hours: Math.floor((t % 86400) / 3600),
    minutes: Math.floor((t % 3600) / 60),
    seconds: t % 60,
    totalMs: t * 1000,
  };
}

/**
 * Full journey snapshot at `now`.
 * - phase: 'before' | 'apart' | 'reunited'
 * - live{} : exact d/h/m/s from timestamps (never negative)
 * - calendar{} : whole calendar days in the home time zone (separate from live h/m/s)
 */
export function journeySnapshot(now, cfg = {}) {
  const departure = new Date(cfg.departureAt ?? DEFAULTS.departureAt);
  const ret = new Date(cfg.expectedReturnAt ?? DEFAULTS.expectedReturnAt);
  const tz = cfg.homeTimezone ?? DEFAULTS.homeTimezone;
  const actualReunion = cfg.actualReunionAt ? new Date(cfg.actualReunionAt) : null;
  if (!(ret > departure)) throw new RangeError('Return time must be after departure time');

  const t = now.getTime();
  const end = actualReunion && actualReunion <= now ? actualReunion : ret;
  const phase = t < departure.getTime() ? 'before' : actualReunion && actualReunion <= now ? 'reunited' : t >= ret.getTime() ? 'reunited' : 'apart';

  const elapsedMs = Math.min(Math.max(0, t - departure.getTime()), end.getTime() - departure.getTime());
  const remainingMs = Math.max(0, ret.getTime() - Math.max(t, departure.getTime()));
  const toDepartureMs = Math.max(0, departure.getTime() - t);
  const expectedMs = ret.getTime() - departure.getTime();
  const pct = Math.min(100, Math.max(0, (elapsedMs / expectedMs) * 100));

  const depDay = localDayNumber(departure, tz);
  const retDay = localDayNumber(ret, tz);
  const today = localDayNumber(now, tz);
  const totalDays = retDay - depDay;
  const elapsedDays = Math.min(totalDays, Math.max(0, today - depDay));
  const remainingDays = Math.max(0, retDay - Math.max(today, depDay));

  return {
    phase,
    live: { elapsed: splitDuration(elapsedMs), remaining: splitDuration(phase === 'before' ? expectedMs : remainingMs), untilDeparture: splitDuration(toDepartureMs) },
    calendar: { elapsedDays, remainingDays, totalDays },
    progress: { percent: pct, percentRemaining: 100 - pct },
    departure, expectedReturn: ret, actualReunion, timezone: tz,
  };
}

export function formatPad(n) { return String(n).padStart(2, '0'); }
export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
