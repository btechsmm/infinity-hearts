import { localDayNumber, localDateISO, MS } from './time.js';

// Deterministic, repeat-free selection so every device shows the same quote for a given day
// and the same message is not reused until the whole pool has been shown.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cycleOrder(n, cycle) {
  const idx = Array.from({ length: n }, (_, i) => i);
  const rnd = mulberry32(0x1f2e3d4c + cycle * 7919);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

/** Pick the item for period index `k` (day / week / month number) from a pool with no repeats within a cycle. */
export function pickForPeriod(pool, k) {
  const n = pool.length;
  if (n === 0) return null;
  if (n === 1) return pool[0];
  const cycle = Math.floor(k / n);
  const pos = k % n;
  let order = cycleOrder(n, cycle);
  if (pos === 0 && cycle > 0) {
    const prevLast = cycleOrder(n, cycle - 1)[n - 1];
    if (order[0] === prevLast) order = [...order.slice(1), order[0]];
  }
  return pool[order[pos]];
}

export function periodIndexes(now, tz, anchorISO = '2026-10-20') {
  const day = localDayNumber(now, tz);
  const anchor = Math.round(new Date(anchorISO + 'T00:00:00Z').getTime() / MS.day);
  const d = Math.max(0, day - anchor);
  const p = new Date(day * MS.day);
  const a = new Date(anchor * MS.day);
  const months = Math.max(0, (p.getUTCFullYear() - a.getUTCFullYear()) * 12 + p.getUTCMonth() - a.getUTCMonth());
  return { day: d, week: Math.floor(d / 7), month: months, dateISO: localDateISO(now, tz) };
}

/**
 * Select the quote of the day / week / month.
 * `audience` filters by who is reading ('becam' | 'faith'), allowing shared and general messages.
 */
export function quoteFor(quotes, { frequency, now, tz, audience = null }) {
  const pool = quotes
    .filter((q) => q.is_active !== false && q.frequency === frequency)
    .filter((q) => !q.audience || q.audience === 'shared' || q.audience === 'general' || !audience || q.audience === audience)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const idx = periodIndexes(now, tz);
  return pickForPeriod(pool, idx[frequency === 'daily' ? 'day' : frequency === 'weekly' ? 'week' : 'month']);
}

export function greeting(now, tz, name) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}
