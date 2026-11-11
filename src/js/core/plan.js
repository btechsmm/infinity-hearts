// Pure notification planner, used by the Supabase Edge Function (server) and unit tests.
// Given "now" and a recipient's preferences it returns the notifications due in this scheduler run.
// Every item has a dedupe `key`; the function claims keys in notification_log so reruns never send twice.
import { zonedParts, localDateISO } from './time.js';
import { milestoneForDay } from './milestones.js';
import { remindersDueToday } from './specialDates.js';
import { quoteFor, greeting } from './quotes.js';

const toMin = (t) => { const [h, m] = String(t || '08:00').split(':').map(Number); return h * 60 + (m || 0); };

/**
 * @param {object} a
 * @param {Date} a.now
 * @param {object} a.cfg      normalized couple settings (departureAt, expectedReturnAt, homeTimezone, customRules, ...)
 * @param {{role:string,name:string}} a.member
 * @param {object|null} a.prefs  notification_preferences row (null = defaults)
 * @param {object[]} a.quotes
 * @param {object[]} a.events    special_dates rows
 * @param {number} [a.windowMin] scheduler window; a run sends only if local time is within [preferred, preferred+window)
 */
export function planNotifications({ now, cfg, member, prefs, quotes, events, windowMin = 30 }) {
  const p = {
    daily_enabled: true, weekly_enabled: true, monthly_enabled: true, milestone_enabled: true, special_dates_enabled: true,
    preferred_time: cfg.defaultNotificationTime || '08:00', timezone: member.role === 'faith' ? cfg.destinationTimezone : cfg.homeTimezone,
    ...(prefs || {}),
  };
  const tz = p.timezone;
  const local = zonedParts(now, tz);
  const minutes = local.hour * 60 + local.minute;
  const start = toMin(p.preferred_time);
  if (minutes < start || minutes >= start + windowMin) return [];       // not this user's morning slot

  const date = localDateISO(now, tz);
  const out = [];
  const hello = greeting(now, tz, member.name);

  // Milestones are computed on the couple's home calendar (the same day number for both partners).
  const ms = milestoneForDay(now, cfg, cfg.customRules || []);
  const bigMilestone = ms && ms.significant && p.milestone_enabled;
  if (bigMilestone) out.push({ kind: 'milestone', key: `ms:${ms.milestone_date}`, title: 'Infinity Hearts', body: `${ms.title}. ${ms.message}`, url: '/#/journey', milestone: ms });

  if (p.daily_enabled && cfg.dailyNotificationEnabled !== false && !bigMilestone) {
    const q = quoteFor(quotes, { frequency: 'daily', now, tz: cfg.homeTimezone, audience: member.role });
    const body = ms ? `${hello}. ${ms.message}` : hello;
    out.push({ kind: 'daily', key: `daily:${date}`, title: 'Infinity Hearts', body: q ? `${hello}. ${q.message}` : body, url: '/#/home', quoteId: q?.id });
  }
  if (p.weekly_enabled && local.hour != null) {
    const dow = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    if (dow === 1) {                                                    // Mondays
      const q = quoteFor(quotes, { frequency: 'weekly', now, tz: cfg.homeTimezone, audience: member.role });
      if (q) out.push({ kind: 'weekly', key: `weekly:${date}`, title: 'Your weekly reminder', body: q.message, url: '/#/quotes', quoteId: q.id });
    }
  }
  if (p.monthly_enabled && local.day === 1) {
    const q = quoteFor(quotes, { frequency: 'monthly', now, tz: cfg.homeTimezone, audience: member.role });
    if (q) out.push({ kind: 'monthly', key: `monthly:${date}`, title: 'A reflection for this month', body: q.message, url: '/#/quotes', quoteId: q.id });
  }
  if (p.special_dates_enabled) {
    for (const e of events || []) {
      for (const r of remindersDueToday(e, now, tz)) {
        const body = r.daysBefore === 0 ? `Today: ${e.title}. ${e.message || ''}`.trim()
          : r.daysBefore === 1 ? `Tomorrow: ${e.title}.` : `${e.title} is in ${r.daysBefore} days.`;
        out.push({ kind: 'special', key: `sd:${e.id}:${r.daysBefore}:${r.date}`, title: 'Infinity Hearts', body, url: '/#/dates' });
      }
    }
  }
  return out;
}
