// Static, trusted SVG icon strings (24x24, stroke style). Not built from user input.
const P = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  journey: '<path d="M4 18c3-9 6 3 9-6s5-5 7-8"/><circle cx="4" cy="18" r="1.6"/><circle cx="20" cy="4" r="1.6"/>',
  quotes: '<path d="M7 17.5c-2-.5-3-2-3-4.5 0-3 2-5.2 5-5.8M16 17.5c-2-.5-3-2-3-4.5 0-3 2-5.2 5-5.8"/><path d="M7 17.5h2v-4H5M16 17.5h2v-4h-4"/>',
  dates: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  messages: '<path d="M21 4 3 11l7 2.5L12.5 21 21 4Z"/><path d="m10 13.5 5-5"/>',
  memories: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3M11 12h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/><circle cx="9" cy="12" r="0.01"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20Z"/>',
  plane: '<path d="M21 3 3 10.5l6.5 2.5L12 20l9-17Z"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M12 9v11M3.5 13h17M12 9c-3 0-4.5-1-4.5-2.5S9 4 10.5 5 12 9 12 9Zm0 0c3 0 4.5-1 4.5-2.5S15 4 13.5 5 12 9 12 9Z"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  share: '<circle cx="6" cy="12" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="m8 11 8-4M8 13l8 4"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17Z"/><path d="M10 21h4"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  cloudoff: '<path d="M4 4l16 16"/><path d="M8 8.2A5 5 0 0 0 6.5 18H17a3.5 3.5 0 0 0 1.2-.2M18.5 12.6A4.5 4.5 0 0 0 12.4 7"/>',
};
export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
  return t.content.firstChild;
}
export const HEART_ART = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 88S10 63 10 35a22 22 0 0 1 40-12 22 22 22 0 0 1 40 12C90 63 50 88 50 88Z" fill="none" stroke="#e0112b" stroke-width="6"/></svg>';
export function heartArt() {
  const t = document.createElement('template');
  t.innerHTML = HEART_ART;
  return t.content.firstChild;
}
