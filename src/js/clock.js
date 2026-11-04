// ONE controlled timer for the whole app. Subscribers receive the real current time each tick, so nothing
// drifts: values are always recomputed from timestamps, never incremented. Resyncs after sleep / background.
const subs = new Set();
let timer = null;

function fire() {
  const now = new Date();
  for (const fn of subs) { try { fn(now); } catch (e) { console.error(e); } }
}
function schedule() {
  clearTimeout(timer);
  if (document.hidden || !subs.size) return;           // no work while hidden
  const delay = 1000 - (Date.now() % 1000) + 5;        // align to the next whole second
  timer = setTimeout(() => { fire(); schedule(); }, delay);
}
export function subscribe(fn) {
  subs.add(fn);
  fn(new Date());
  schedule();
  return () => { subs.delete(fn); if (!subs.size) clearTimeout(timer); };
}
function resync() { fire(); schedule(); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); else clearTimeout(timer); });
window.addEventListener('pageshow', resync);
window.addEventListener('focus', resync);
window.addEventListener('online', resync);
