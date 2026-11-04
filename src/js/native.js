// Bridge to the OPTIONAL native Android app (Capacitor + @capacitor/local-notifications).
// In a normal browser/PWA these functions do nothing. NOTE: this code has not been built or run on a device yet.
import { state } from './api.js';
import { dailyQuote, weeklyQuote, monthlyQuote, myTz } from './selectors.js';
import { zonedTimeToUtc, zonedParts, MS } from './core/time.js';
import { milestoneForDay } from './core/milestones.js';

const plugin = () => window.Capacitor?.Plugins?.LocalNotifications;
export const isNative = () => !!window.Capacitor?.isNativePlatform?.();

export async function nativeStatus() {
  const p = plugin();
  if (!isNative() || !p) return { available: false };
  try { const perm = await p.checkPermissions(); return { available: true, permission: perm.display }; } catch { return { available: true, permission: 'unknown' }; }
}

/**
 * Schedules the next `days` mornings as local notifications (works with no connection, survives reboot via the plugin's boot receiver).
 * Content comes from the same engine as the in-app screens. Android caps pending alarms, so we keep a rolling 45-day window and
 * re-run this each time the app opens.
 */
export async function scheduleNativeReminders(days = 45) {
  const p = plugin();
  if (!isNative() || !p) return { scheduled: 0 };
  const perm = await p.requestPermissions();
  if (perm.display !== 'granted') return { scheduled: 0, reason: 'permission-denied' };
  await p.createChannel?.({ id: 'infinity-hearts-daily', name: 'Daily love messages', importance: 3, visibility: 0 });
  const pending = await p.getPending();
  if (pending.notifications?.length) await p.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });

  const [hh, mm] = (state.prefs?.preferred_time || state.cfg.defaultNotificationTime || '08:00').split(':').map(Number);
  const zone = state.prefs?.timezone || myTz();
  const notifications = [];
  const today = zonedParts(new Date(), zone);
  for (let i = 0; i < days; i++) {
    const base = new Date(Date.UTC(today.year, today.month - 1, today.day) + i * MS.day);
    const at = zonedTimeToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), hh, mm, zone);
    if (at <= new Date()) continue;
    const m = milestoneForDay(at, state.cfg, state.cfg.customRules);
    const body = (state.prefs?.milestone_enabled !== false && m && m.significant) ? `${m.title}. ${m.message}` : dailyQuote(at)?.message || 'Good morning, my love.';
    notifications.push({ id: 1000 + i, title: 'Infinity Hearts', body, schedule: { at, allowWhileIdle: true }, channelId: 'infinity-hearts-daily' });
  }
  if (notifications.length) await p.schedule({ notifications });
  return { scheduled: notifications.length };
}
export { weeklyQuote, monthlyQuote };
