import { state } from './api.js';
import { quoteFor, greeting } from './core/quotes.js';
import { sortUpcoming, nextOccurrence } from './core/specialDates.js';
import { journeySnapshot } from './core/time.js';

export const tz = () => state.cfg.homeTimezone;
export const myRole = () => state.profile?.partner_role || 'becam';
export const myName = () => state.profile?.display_name || (myRole() === 'faith' ? 'Faith' : 'Becam');
export const partnerName = () => state.partner?.display_name || (myRole() === 'becam' ? 'Faith' : 'Becam');
/** Local time for the signed-in user is based on THEIR profile time zone. */
export const myTz = () => state.profile?.timezone || (myRole() === 'faith' ? state.cfg.destinationTimezone : state.cfg.homeTimezone);

export const snap = (now) => journeySnapshot(now, state.cfg);
export const hello = (now) => greeting(now, myTz(), myName());

function pick(freq, now) { return quoteFor(state.quotes, { frequency: freq, now, tz: tz(), audience: myRole() }); }
export const dailyQuote = (now) => pick('daily', now);
export const weeklyQuote = (now) => pick('weekly', now);
export const monthlyQuote = (now) => pick('monthly', now);

export function quoteAuthor(q) {
  if (!q) return '';
  if (q.audience === 'faith') return 'Becam';
  if (q.audience === 'becam') return 'Faith';
  return 'Infinity Hearts';
}

export function nextEvent(now) { return sortUpcoming(state.specialDates, now, tz())[0] || null; }
export { nextOccurrence, sortUpcoming };

export function photoCaptionDate(p) { return p.memory_date || p.created_at?.slice(0, 10) || ''; }
