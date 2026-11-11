import test from 'node:test';
import assert from 'node:assert/strict';
import { journeySnapshot, zonedTimeToUtc, localDateISO, DEFAULTS } from '../src/js/core/time.js';
import { milestoneForDay, missedMilestones } from '../src/js/core/milestones.js';
import { nextOccurrence, remindersDueToday, defaultSpecialDates } from '../src/js/core/specialDates.js';
import { greatCircleKm, CITIES } from '../src/js/core/geo.js';
import { pickForPeriod, quoteFor, greeting } from '../src/js/core/quotes.js';

const cfg = {};
const dep = new Date(DEFAULTS.departureAt);
const at = (days, extraMs = 0) => new Date(dep.getTime() + days * 86400000 + extraMs);

test('default timestamps are 00:00 Nairobi on the stated dates', () => {
  assert.equal(localDateISO(dep, 'Africa/Nairobi'), '2026-10-20');
  assert.equal(localDateISO(new Date(DEFAULTS.expectedReturnAt), 'Africa/Nairobi'), '2028-10-20');
});

test('1. departure in the past: elapsed positive, phase apart', () => {
  const s = journeySnapshot(at(13, 7 * 3600e3 + 42 * 60e3 + 18e3), cfg);
  assert.equal(s.phase, 'apart');
  assert.deepEqual(
    [s.live.elapsed.days, s.live.elapsed.hours, s.live.elapsed.minutes, s.live.elapsed.seconds],
    [13, 7, 42, 18],
  );
  assert.equal(s.calendar.elapsedDays, 13);
});

test('2. departure in the future: no negative elapsed, pre-departure state', () => {
  const s = journeySnapshot(new Date('2026-10-01T09:00:00Z'), cfg);
  assert.equal(s.phase, 'before');
  assert.equal(s.live.elapsed.totalMs, 0);
  assert.equal(s.calendar.elapsedDays, 0);
  assert.equal(s.progress.percent, 0);
  assert.ok(s.live.untilDeparture.days > 0);
  assert.equal(milestoneForDay(new Date('2026-10-01T09:00:00Z'), cfg), null);
});

test('3. exactly one day elapsed', () => {
  const s = journeySnapshot(at(1), cfg);
  assert.equal(s.live.elapsed.days, 1);
  assert.equal(s.live.elapsed.hours, 0);
  assert.equal(s.calendar.elapsedDays, 1);
});

test('4/5. thirty and one hundred days elapsed', () => {
  assert.equal(journeySnapshot(at(30), cfg).calendar.elapsedDays, 30);
  assert.equal(journeySnapshot(at(100), cfg).calendar.elapsedDays, 100);
  assert.equal(milestoneForDay(at(100), cfg).milestone_type, 'every_100');
  assert.equal(milestoneForDay(at(30), cfg).milestone_type, 'every_10');
  assert.equal(milestoneForDay(at(31), cfg).milestone_type, 'monthly'); // 20 Nov = one month (October has 31 days)
});

test('6/7. one year elapsed, and the leap-year span is 731 days', () => {
  const s = journeySnapshot(at(365), cfg);
  assert.equal(s.calendar.totalDays, 731); // 2028-02-29 falls inside the journey
  assert.equal(s.calendar.elapsedDays, 365);
  assert.equal(s.calendar.remainingDays, 366);
  assert.equal(milestoneForDay(at(365), cfg).milestone_type, 'one_year');
});

test('progress percent uses timestamps and clamps', () => {
  const half = new Date((dep.getTime() + new Date(DEFAULTS.expectedReturnAt).getTime()) / 2);
  assert.ok(Math.abs(journeySnapshot(half, cfg).progress.percent - 50) < 1e-9);
  assert.equal(journeySnapshot(new Date('2030-01-01T00:00:00Z'), cfg).progress.percent, 100);
});

test('8. return date changed by the user recalculates everything', () => {
  const changed = { expectedReturnAt: '2028-12-19T21:00:00.000Z' };
  const a = journeySnapshot(at(100), cfg);
  const b = journeySnapshot(at(100), changed);
  assert.equal(b.calendar.totalDays, a.calendar.totalDays + 61);
  assert.ok(b.progress.percent < a.progress.percent);
});

test('9. countdown reaches zero and never goes negative', () => {
  const ret = new Date(DEFAULTS.expectedReturnAt);
  const s = journeySnapshot(new Date(ret.getTime() + 5000), cfg);
  assert.equal(s.phase, 'reunited');
  assert.equal(s.live.remaining.totalMs, 0);
  assert.equal(s.progress.percent, 100);
  const m = milestoneForDay(ret, cfg);
  assert.equal(m.milestone_type, 'reunion_day');
});

test('actual reunion stops the elapsed counter and keeps history', () => {
  const actual = at(300).toISOString();
  const s = journeySnapshot(at(400), { actualReunionAt: actual });
  assert.equal(s.phase, 'reunited');
  assert.equal(s.live.elapsed.days, 300);
});

test('invalid config is rejected', () => {
  assert.throws(() => journeySnapshot(new Date(), { departureAt: '2028-01-01T00:00:00Z', expectedReturnAt: '2027-01-01T00:00:00Z' }), RangeError);
});

test('remaining milestones use real values', () => {
  const ret = new Date(DEFAULTS.expectedReturnAt);
  const day = (n) => new Date(ret.getTime() - n * 86400000 + 3600e3);
  assert.equal(milestoneForDay(day(365), cfg).milestone_type, 'remaining_365');
  assert.equal(milestoneForDay(day(180), cfg).milestone_type, 'remaining_180');
  assert.equal(milestoneForDay(day(100), cfg).milestone_type, 'remaining_100');
  assert.equal(milestoneForDay(day(30), cfg).milestone_type, 'remaining_30');
  assert.equal(milestoneForDay(day(14), cfg).milestone_type, 'remaining_14');
  assert.equal(milestoneForDay(day(7), cfg).milestone_type, 'remaining_7');
  assert.equal(milestoneForDay(day(1), cfg).milestone_type, 'final_24h');
  const m = milestoneForDay(at(20), cfg);
  assert.equal(m.elapsed_days, 20);
  assert.equal(m.remaining_days, 711);
  assert.match(m.message, /20 days apart\. 711 days to go\./);
});

test('custom milestone rules are supported', () => {
  const rule = { kind: 'elapsed', days: 77, title: 'Day {elapsed}', message: '{elapsed} days. {remaining} left.', priority: 99 };
  const m = milestoneForDay(at(77), cfg, [rule]);
  assert.equal(m.title, 'Day 77');
  assert.equal(m.message, '77 days. 654 left.');
});

test('10. milestone generated only once (dedupe by key)', () => {
  const now = at(50, 3600e3);
  const first = missedMilestones(now, cfg, new Set(), null);
  assert.equal(first.length, 1);
  const again = missedMilestones(now, cfg, new Set(first.map((m) => m.key)), null);
  assert.equal(again.length, 0);
});

test('missed milestones are caught up after being offline', () => {
  const now = at(12, 3600e3);
  const list = missedMilestones(now, cfg, new Set(), localDateISO(at(8), 'Africa/Nairobi'));
  assert.deepEqual(list.map((m) => m.elapsed_days), [9, 10, 11, 12]);
  assert.equal(new Set(list.map((m) => m.key)).size, 4);
});

test('14. special dates across a year boundary', () => {
  const ev = { event_date: '2000-01-01', recurrence_type: 'yearly' };
  const n = nextOccurrence(ev, new Date('2026-12-31T12:00:00Z'), 'Africa/Nairobi');
  assert.equal(n.daysUntil, 1);
  assert.equal(n.year, 2027);
  const nye = nextOccurrence({ event_date: '2000-12-31', recurrence_type: 'yearly' }, new Date('2026-12-31T12:00:00Z'), 'Africa/Nairobi');
  assert.equal(nye.daysUntil, 0);
});

test('anniversary repeats yearly; reunion does not; departure is not the anniversary', () => {
  const list = defaultSpecialDates(cfg);
  const anniv = list.find((e) => e.id === 'anniversary');
  assert.equal(anniv.event_date.slice(5), '09-08');
  assert.notEqual(anniv.event_date.slice(5), '10-20');
  assert.equal(nextOccurrence(anniv, new Date('2026-11-02T10:00:00Z'), 'Africa/Nairobi').year, 2027);
  const ret = list.find((e) => e.id === 'return');
  assert.equal(ret.recurrence_type, 'none');
  assert.equal(nextOccurrence(ret, new Date('2029-01-01T00:00:00Z'), 'Africa/Nairobi').past, true);
});

test('leap-day events are observed on 28 Feb in non-leap years', () => {
  const ev = { event_date: '2000-02-29', recurrence_type: 'yearly' };
  assert.equal(nextOccurrence(ev, new Date('2027-02-01T12:00:00Z'), 'Africa/Nairobi').day, 28);
  assert.equal(nextOccurrence(ev, new Date('2028-02-01T12:00:00Z'), 'Africa/Nairobi').day, 29);
});

test('reminders fire at 7, 3, 1 and 0 days before', () => {
  const ev = { event_date: '2000-09-08', recurrence_type: 'yearly' };
  for (const [iso, off] of [['2027-09-01', 7], ['2027-09-05', 3], ['2027-09-07', 1], ['2027-09-08', 0]]) {
    const r = remindersDueToday(ev, new Date(iso + 'T09:00:00Z'), 'Africa/Nairobi');
    assert.equal(r[0]?.daysBefore, off, iso);
  }
  assert.equal(remindersDueToday(ev, new Date('2027-09-02T09:00:00Z'), 'Africa/Nairobi').length, 0);
});

test('15. time zones: local date depends on zone; Nairobi and Bahrain are both UTC+3', () => {
  const instant = new Date('2026-11-02T22:30:00Z');
  assert.equal(localDateISO(instant, 'Africa/Nairobi'), '2026-11-03');
  assert.equal(localDateISO(instant, 'UTC'), '2026-11-02');
  assert.equal(localDateISO(instant, 'Asia/Bahrain'), '2026-11-03');
  assert.equal(localDateISO(instant, 'America/New_York'), '2026-11-02');
  // 08:00 recipient-local converts correctly, including a DST zone
  assert.equal(zonedTimeToUtc(2026, 11, 3, 8, 0, 'Africa/Nairobi').toISOString(), '2026-11-03T05:00:00.000Z');
  assert.equal(zonedTimeToUtc(2026, 7, 1, 8, 0, 'America/New_York').toISOString(), '2026-07-01T12:00:00.000Z');
  assert.equal(zonedTimeToUtc(2026, 1, 1, 8, 0, 'America/New_York').toISOString(), '2026-01-01T13:00:00.000Z');
});

test('great-circle distance Nairobi to Manama is about 3,400 km (computed, not hardcoded)', () => {
  const km = greatCircleKm(CITIES.nairobi, CITIES.manama);
  console.log('    computed distance km:', km.toFixed(1));
  assert.ok(km > 3380 && km < 3420);
  assert.equal(Math.round(greatCircleKm(CITIES.nairobi, CITIES.nairobi)), 0);
});

test('quotes: no repeats within a cycle, same pick for the same day, audience filter', () => {
  const pool = Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, frequency: 'daily', is_active: true }));
  const seen = Array.from({ length: 7 }, (_, k) => pickForPeriod(pool, k).id);
  assert.equal(new Set(seen).size, 7);
  assert.equal(pickForPeriod(pool, 3).id, pickForPeriod(pool, 3).id);
  const a = quoteFor(pool, { frequency: 'daily', now: new Date('2026-11-02T10:00:00Z'), tz: 'Africa/Nairobi' });
  const b = quoteFor(pool, { frequency: 'daily', now: new Date('2026-11-02T20:00:00Z'), tz: 'Africa/Nairobi' });
  assert.equal(a.id, b.id); // 10:00Z and 20:00Z are both 2 Nov in Nairobi
  assert.equal(quoteFor([], { frequency: 'daily', now: new Date(), tz: 'UTC' }), null);
});

test('greeting follows local time of the signed-in user', () => {
  assert.equal(greeting(new Date('2026-11-02T05:00:00Z'), 'Africa/Nairobi', 'Becam'), 'Good morning, Becam');
  assert.equal(greeting(new Date('2026-11-02T13:00:00Z'), 'Africa/Nairobi', 'Faith'), 'Good afternoon, Faith');
  assert.equal(greeting(new Date('2026-11-02T18:00:00Z'), 'Africa/Nairobi', 'Faith'), 'Good evening, Faith');
});
