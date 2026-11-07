// Chat colour themes. The colours themselves live in CSS (.chat[data-theme="..."]) so they can be tuned in one place.
export const CHAT_THEMES = [
    { id: 'crimson', name: 'Crimson', swatch: '#b30d22' },
    { id: 'plum', name: 'Plum', swatch: '#7a3a86' },
    { id: 'ocean', name: 'Ocean', swatch: '#1f66b3' },
    { id: 'forest', name: 'Forest', swatch: '#1f7a52' },
];
const KEY = 'ih.chatTheme';

export function chatTheme() {
    try { const v = localStorage.getItem(KEY); if (CHAT_THEMES.some((t) => t.id === v)) return v; } catch { /* ignore */ }
    return 'crimson';
}
export function setChatTheme(id) {
    if (!CHAT_THEMES.some((t) => t.id === id)) return;
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
    document.querySelectorAll('.chat').forEach((el) => { el.dataset.theme = id; });
    document.dispatchEvent(new CustomEvent('ih-chat-theme', { detail: id }));
}