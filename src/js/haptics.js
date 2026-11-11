// Light vibration feedback (Android Chrome and most Android browsers). iPhone Safari does not support web vibration;
// the setting is still stored and the app simply does nothing there.
const PATTERNS = { tap: 8, select: 12, send: 14, receive: [18, 40, 18], success: [14, 40, 14], warn: [30, 50, 30] };
const KEY = 'ih.haptics';

export const hapticsSupported = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
export const hapticsEnabled = () => { try { return (localStorage.getItem(KEY) ?? 'on') !== 'off'; } catch { return true; } };
export const setHapticsEnabled = (v) => { try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* ignore */ } };

window.__ihHapticLog = window.__ihHapticLog || [];

export function haptic(kind = 'tap', { force = false } = {}) {
    if (!force && !hapticsEnabled()) return false;
    window.__ihHapticLog.push(kind); if (window.__ihHapticLog.length > 50) window.__ihHapticLog.shift();
    if (!hapticsSupported()) return false;
    try { return navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap); } catch { return false; }
}

/** One delegated listener: buttons, tabs, chips and icon buttons give a small tick. `data-haptic="none"` opts out. */
export function initHaptics() {
    document.addEventListener('pointerdown', (e) => {
        const t = e.target.closest?.('[data-haptic], .tab, .btn, .chip, .icon-btn, .seg button, .swatch');
        if (!t || t.disabled || t.dataset.haptic === 'none') return;
        haptic(t.dataset.haptic || 'tap');
    }, { passive: true });
}