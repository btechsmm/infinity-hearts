import { h, $ } from './util.js';

/** Bottom-sheet modal. Pushes a history entry so the Android back button closes it instead of leaving the app. */
export function openModal(build, { title = '' } = {}) {
  const root = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const sheet = h('div', { class: 'sheet' });
  root.append(sheet);
  let closed = false;
  const close = (fromPop = false) => {
    if (closed) return; closed = true;
    window.removeEventListener('popstate', onPop);
    root.remove();
    if (!fromPop && history.state?.ihModal) history.back();
    prev?.focus?.();
  };
  const onPop = () => close(true);
  const prev = document.activeElement;
  history.pushState({ ihModal: true }, '');
  window.addEventListener('popstate', onPop);
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  sheet.append(build(close));
  document.body.append(root);
  (sheet.querySelector('input,textarea,select,button') || sheet).focus?.();
  return close;
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openModal((close) => {
      const done = (v) => { answered = true; resolve(v); close(); };
      return h('div', { class: 'stack' },
        h('h2', { class: 'title' }, title),
        body ? h('p', { class: 'sub' }, body) : null,
        h('div', { class: 'row', style: 'justify-content:flex-end' },
          h('button', { class: 'btn ghost', onclick: () => done(false) }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, confirmLabel)));
    }, { title });
    // resolves false if dismissed by backdrop / back button
    const mo = new MutationObserver(() => { if (!document.querySelector('.modal') && !answered) { answered = true; resolve(false); mo.disconnect(); } });
    mo.observe(document.body, { childList: true });
  });
}

export function counter(labels = ['Days', 'Hours', 'Minutes', 'Seconds'], big = false) {
  const els = labels.map((l) => h('b', {}, '0'));
  const root = h('div', { class: `counter${big ? ' big' : ''}`, role: 'timer', 'aria-live': 'off' },
    labels.map((l, i) => h('div', {}, els[i], h('span', {}, l))));
  return {
    root,
    set(d, hh, m, s) {
      const vals = [String(d), String(hh).padStart(2, '0'), String(m).padStart(2, '0'), String(s).padStart(2, '0')];
      vals.forEach((v, i) => { if (els[i].textContent !== v) els[i].textContent = v; });
    },
  };
}

export function emptyState(iconEl, title, text, action) {
  return h('div', { class: 'empty' }, iconEl, h('p', { class: 'title', style: 'font-size:1.1rem;color:var(--text)' }, title), h('p', {}, text), action || null);
}

export function field(label, input, hint) {
  return h('label', { class: 'f' }, h('span', {}, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}
export function setBusy(btn, busy, label) {
  btn.disabled = busy;
  if (label) btn.textContent = busy ? 'Please wait…' : label;
}
export const q = $;
