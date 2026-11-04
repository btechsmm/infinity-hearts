import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { planNotifications } from '../src/js/core/plan.js';
import { defaultSpecialDates } from '../src/js/core/specialDates.js';

const cfg = { departureAt: '2026-10-19T21:00:00.000Z', expectedReturnAt: '2028-10-19T21:00:00.000Z', homeTimezone: 'Africa/Nairobi', destinationTimezone: 'Asia/Bahrain', dailyNotificationEnabled: true, defaultNotificationTime: '08:00', customRules: [] };
const quotes = JSON.parse(readFileSync(new URL('../src/data/quotes.json', import.meta.url))).map((q, i) => ({ id: `q${i}`, frequency: q.f, audience: q.a, message: q.m, is_active: true }));
const events = defaultSpecialDates(cfg).map((e, i) => ({ ...e, id: `e${i}`, reminder_settings: { daysBefore: [7, 3, 1, 0] } }));
const becam = { role: 'becam', name: 'Becam' };
const faith = { role: 'faith', name: 'Faith' };
const plan = (iso, member = becam, prefs = null) => planNotifications({ now: new Date(iso), cfg, member, prefs, quotes, events });

// 2026-11-04 is a Wednesday, day 15 apart (a plain "daily" day). 08:00 Nairobi = 05:00Z.
test('sends the daily message inside the morning window, with the greeting and a real quote', () => {
  const p = plan('2026-11-04T05:10:00Z');
  const d = p.find((x) => x.kind === 'daily');
  assert.ok(d);
  assert.match(d.body, /^Good morning, Becam\. /);
  assert.equal(d.key, 'daily:2026-11-04');
});

test('does not send before or after the window', () => {
  assert.equal(plan('2026-11-04T04:59:00Z').length, 0);   // 07:59
  assert.equal(plan('2026-11-04T05:30:00Z').length, 0);   // 08:30
  assert.equal(plan('2026-11-04T12:00:00Z').length, 0);
});

test('same day, repeated scheduler runs produce the SAME dedupe key (so the log claim blocks duplicates)', () => {
  const keys = ['05:00', '05:15'].map((t) => plan(`2026-11-04T${t}:00Z`).map((x) => x.key).join('|'));
  assert.equal(keys[0], keys[1]);
});

test('each partner is notified in THEIR time zone', () => {
  const ny = { timezone: 'America/New_York', preferred_time: '08:00' };
  assert.equal(plan('2026-11-04T05:10:00Z', becam, ny).length, 0);      // 00:10 in New York
  assert.ok(plan('2026-11-04T13:10:00Z', becam, ny).length > 0);        // 08:10 EST
  const bh = plan('2026-11-04T05:10:00Z', faith);                        // Bahrain is UTC+3 too
  assert.ok(bh.length > 0 && /Good morning, Faith/.test(bh[0].body));
});

test('custom reminder time is respected', () => {
  assert.equal(plan('2026-11-04T05:10:00Z', becam, { preferred_time: '09:30' }).length, 0);
  assert.ok(plan('2026-11-04T06:40:00Z', becam, { preferred_time: '09:30' }).length > 0);
});

test('disabled categories are not sent', () => {
  assert.equal(plan('2026-11-04T05:10:00Z', becam, { daily_enabled: false }).filter((x) => x.kind === 'daily').length, 0);
  assert.equal(plan('2026-11-04T05:10:00Z', becam, { daily_enabled: false, weekly_enabled: false, monthly_enabled: false, milestone_enabled: false, special_dates_enabled: false }).length, 0);
});

test('a significant milestone day sends the milestone message with real numbers instead of the generic daily', () => {
  const p = plan('2026-11-09T05:10:00Z');                                // day 20 apart
  const m = p.find((x) => x.kind === 'milestone');
  assert.ok(m);
  assert.match(m.body, /20 days apart\. 711 days to go\./);
  assert.equal(p.filter((x) => x.kind === 'daily').length, 0);
  assert.equal(m.key, 'ms:2026-11-09');
});

test('weekly message on Mondays, monthly on the 1st', () => {
  assert.ok(plan('2026-11-09T05:10:00Z').some((x) => x.kind === 'weekly'));         // Monday
  assert.ok(!plan('2026-11-04T05:10:00Z').some((x) => x.kind === 'weekly'));        // Wednesday
  assert.ok(plan('2026-12-01T05:10:00Z').some((x) => x.kind === 'monthly'));
});

test('special-date reminders: 7, 3, 1 days before and on the day', () => {
  const find = (iso) => plan(iso).filter((x) => x.kind === 'special').map((x) => x.body);
  assert.ok(find('2026-12-18T05:10:00Z').some((b) => /Christmas Day is in 7 days/.test(b)));
  assert.ok(find('2026-12-22T05:10:00Z').some((b) => /Christmas Day is in 3 days/.test(b)));
  assert.ok(find('2026-12-24T05:10:00Z').some((b) => /Tomorrow: Christmas Day/.test(b)));
  assert.ok(find('2026-12-25T05:10:00Z').some((b) => /^Today: Christmas Day/.test(b)));
  assert.equal(find('2026-12-20T05:10:00Z').filter((b) => /Christmas/.test(b)).length, 0);
});

test('year boundary: New Year reminders fire on 31 Dec / 1 Jan', () => {
  assert.ok(plan('2026-12-31T05:10:00Z').some((x) => /New Year's Eve/.test(x.body)));
  assert.ok(plan('2027-01-01T05:10:00Z').some((x) => /New Year's Day/.test(x.body)));
});

test('before departure: no milestone or elapsed content is generated', () => {
  const p = planNotifications({ now: new Date('2026-10-01T05:10:00Z'), cfg, member: becam, prefs: null, quotes, events });
  assert.equal(p.filter((x) => x.kind === 'milestone').length, 0);
});

test('server copy of the engine is identical to the app copy (run `node scripts/sync-shared.mjs` if this fails)', () => {
  const src = new URL('../src/js/core/', import.meta.url), dst = new URL('../supabase/functions/_shared/', import.meta.url);
  for (const f of readdirSync(src).filter((n) => n.endsWith('.js'))) {
    assert.equal(readFileSync(new URL(f, dst), 'utf8'), readFileSync(new URL(f, src), 'utf8'), f);
  }
});
