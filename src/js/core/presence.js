// Pure wording helpers for the chat: "last seen ..." lines and iMessage-style time stamps.
import { zonedParts, localDayNumber, MS } from './time.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const hhmm = (p) => `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;

function dayLabel(then, now, tz) {
    const diff = localDayNumber(now, tz) - localDayNumber(then, tz);
    const p = zonedParts(then, tz);
    if (diff === 0) return { word: 'today', short: 'Today' };
    if (diff === 1) return { word: 'yesterday', short: 'Yesterday' };
    if (diff > 1 && diff < 7) { const wd = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]; return { word: wd, short: wd }; }
    const d = `${p.day} ${MONTHS[p.month - 1]}${zonedParts(now, tz).year !== p.year ? ` ${p.year}` : ''}`;
    return { word: d, short: d };
}

/** "last seen today at 14:05". Empty string when unknown. */
export function formatLastSeen(iso, now, tz) {
    if (!iso) return '';
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return '';
    const ago = now.getTime() - then.getTime();
    if (ago < 60 * 1000) return 'last seen just now';
    return `last seen ${dayLabel(then, now, tz).word} at ${hhmm(zonedParts(then, tz))}`;
}

/** Centered conversation time stamp: "Today 14:05", "Yesterday 09:20", "Mon 18:10", "3 Nov 18:10". */
export function formatStamp(iso, now, tz) {
    const then = new Date(iso);
    return `${dayLabel(then, now, tz).short} ${hhmm(zonedParts(then, tz))}`;
}

/**
 * What the chat header shows under the name.
 * typing beats online beats last seen. Nothing is shown while we are offline ourselves (we cannot know).
 */
export function statusLine({ online, typing, lastSeen, now, tz, offline = false }) {
    if (offline) return { kind: 'none', text: '' };
    if (typing) return { kind: 'typing', text: 'typing…' };
    if (online) return { kind: 'online', text: 'Online' };
    const t = formatLastSeen(lastSeen, now, tz);
    return t ? { kind: 'seen', text: t } : { kind: 'none', text: '' };
}

/** iMessage shows a time stamp when the gap to the previous message is large. */
export const needsStamp = (prevIso, iso, gapMs = 30 * 60 * 1000) => !prevIso || new Date(iso) - new Date(prevIso) > gapMs;
export { MS };