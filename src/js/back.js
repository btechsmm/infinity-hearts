// Android back-button / browser back handling.
//  1. Open sheets and dialogs close first (each one owns one history entry).
//  2. Then pages go back through the tabs the person visited.
//  3. On the very first page, back shows "Press back again to exit" and only a second press within 2 seconds leaves.
const stack = [];
let ignorePops = 0, exitArmedAt = 0, onRootHandler = null;

/** Register a closer for something that was opened (a sheet). Adds one history entry. */
export function pushBack(closer) {
    history.pushState({ ih: 'layer' }, '');
    stack.push(closer);
}
/** The sheet was closed by a tap rather than by Back: remove its history entry without reacting to it. */
export function releaseBack(closer) {
    const i = stack.lastIndexOf(closer);
    if (i < 0) return;
    stack.splice(i, 1);
    ignorePops++;
    history.back();
}
export const layersOpen = () => stack.length;

export function initBack(onRoot) {
    onRootHandler = onRoot;
    // Entry 1 is a "guard" so Back from the first page lands on something we control instead of closing the app.
    history.replaceState({ ih: 'guard' }, '', location.href);
    history.pushState({ ih: 'app' }, '', location.href);
    window.addEventListener('popstate', (e) => {
        if (ignorePops > 0) { ignorePops--; return; }
        if (stack.length) { const closer = stack.pop(); closer(); return; }
        if (e.state?.ih === 'guard') {
            const now = Date.now();
            if (now - exitArmedAt < 2000) { exitArmedAt = 0; history.back(); return; }   // second press: really leave
            exitArmedAt = now;
            history.pushState({ ih: 'app' }, '', location.href);                         // stay in the app
            onRootHandler?.();
        }
    });
}