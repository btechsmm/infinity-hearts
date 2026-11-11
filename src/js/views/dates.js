import { h, toast, fmtDate, fmtNum, uuid } from '../util.js';
import { icon } from '../icons.js';
import { state, on, saveSpecialDate, deleteSpecialDate, photoUrl } from '../api.js';
import { openModal, confirmDialog, field } from '../ui.js';
import { nextOccurrence, isoOf } from '../core/specialDates.js';
import { tz } from '../selectors.js';

const ICONS = { anniversary: 'heart', valentines: 'heart', christmas: 'gift', nye: 'spark', nyd: 'spark', return: 'plane' };
const key = (e) => e.slug || e.id;

function editor(ev) {
  const isNew = !ev;
  const e = ev || { title: '', event_date: '', recurrence_type: 'yearly', reminder_settings: { daysBefore: [7, 3, 1, 0] }, message: '' };
  const builtinYearly = e.is_builtin || e.builtin;
  openModal((close) => {
    const title = h('input', { type: 'text', value: e.title, maxlength: '80', required: true });
    // yearly events store a placeholder year; the picker shows the real month/day
    const date = h('input', { type: 'date', value: e.event_date });
    const rec = h('select', {}, h('option', { value: 'yearly' }, 'Repeats every year'), h('option', { value: 'none' }, 'One time only'));
    rec.value = e.recurrence_type;
    const msg = h('textarea', { maxlength: '300', placeholder: 'A short personal message' }, e.message || '');
    const days = [7, 3, 1, 0];
    const sel = new Set(e.reminder_settings?.daysBefore ?? [7, 3, 1, 0]);
    const checks = days.map((d) => { const i = h('input', { type: 'checkbox', checked: sel.has(d) || null, id: `rem${d}` }); return { d, i, el: h('label', { class: 'check' }, i, d === 0 ? 'On the morning of the day' : `${d} day${d > 1 ? 's' : ''} before`) }; });
    const photoSel = h('select', {}, h('option', { value: '' }, 'No photo'), state.photos.map((p) => h('option', { value: p.storage_path }, p.caption || `Photo ${p.display_order + 1}`)));
    photoSel.value = e.photo_path || '';
    const err = h('p', { class: 'err', role: 'alert' });
    const save = async () => {
      err.textContent = '';
      if (!title.value.trim()) { err.textContent = 'Please add a title.'; return; }
      if (!date.value) { err.textContent = 'Please choose a date.'; return; }
      try {
        await saveSpecialDate({ ...e, title: title.value.trim(), event_date: date.value, recurrence_type: rec.value, message: msg.value.trim(), photo_path: photoSel.value || null, reminder_settings: { daysBefore: checks.filter((c) => c.i.checked).map((c) => c.d) } });
        toast('Saved', 'ok'); close();
      } catch (x) { err.textContent = x.message; }
    };
    return h('form', { class: 'stack', onsubmit: (ev2) => { ev2.preventDefault(); save(); } },
      h('h2', { class: 'title' }, isNew ? 'New special date' : 'Edit special date'),
      field('Title', title), field(builtinYearly && e.recurrence_type === 'yearly' ? 'Date (the year is only a placeholder; it repeats yearly)' : 'Date', date), field('Repeats', rec),
      field('Personal message', msg),
      h('fieldset', { style: 'border:1px solid var(--line);border-radius:8px;padding:8px 12px' }, h('legend', { class: 'hint' }, 'Remind us'), checks.map((c) => c.el)),
      field('Photo (optional)', photoSel), err,
      h('div', { class: 'row', style: 'justify-content:flex-end' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'),
        h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  }, { title: 'Special date' });
}

export function mount(root) {
  const host = h('div', { class: 'stack' });
  function render() {
    const now = new Date();
    const items = state.specialDates.map((e) => ({ e, occ: nextOccurrence(e, now, tz()) }));
    const upcoming = items.filter((x) => !x.occ.past).sort((a, b) => a.occ.dayNumber - b.occ.dayNumber);
    const past = items.filter((x) => x.occ.past).sort((a, b) => b.occ.dayNumber - a.occ.dayNumber);
    const card = ({ e, occ }) => {
      const thumb = h('img', { alt: '', width: '40', height: '40', style: 'width:40px;height:40px;object-fit:cover;border-radius:8px', hidden: true, loading: 'lazy' });
      const p = e.photo_path && state.photos.find((x) => x.storage_path === e.photo_path);
      if (p) photoUrl(p).then((u) => { if (u) { thumb.src = u; thumb.hidden = false; } });
      const custom = !(e.is_builtin || e.builtin);
      return h('div', { class: `item${occ.daysUntil === 0 ? ' today' : ''}` },
        h('div', { class: 'ico' }, thumb, h('span', {}, icon(ICONS[key(e)] || 'heart'))),
        h('div', { class: 'txt' },
          h('b', {}, e.title),
          h('small', {}, fmtDate(isoOf(occ), 'UTC'), e.recurrence_type === 'yearly' ? ' · every year' : ' · one time'),
          e.message ? h('small', { style: 'display:block;font-style:italic' }, e.message) : null,
          h('small', { style: 'display:block' }, (e.reminder_settings?.daysBefore || []).length ? `Reminders: ${[...e.reminder_settings.daysBefore].sort((a, b) => b - a).map((d) => (d === 0 ? 'on the day' : `${d}d before`)).join(', ')}` : 'No reminders')),
        h('div', { class: 'when' }, occ.past ? h('b', {}, 'Past') : h('b', {}, occ.daysUntil === 0 ? 'Today' : fmtNum(occ.daysUntil)), occ.past ? '' : occ.daysUntil === 0 ? '' : occ.daysUntil === 1 ? 'day' : 'days',
          h('div', { class: 'row', style: 'justify-content:flex-end;margin-top:4px;gap:2px' },
            h('button', { class: 'icon-btn', style: 'width:36px;height:36px', 'aria-label': `Edit ${e.title}`, onclick: () => editor(e) }, icon('edit')),
            custom ? h('button', { class: 'icon-btn', style: 'width:36px;height:36px', 'aria-label': `Delete ${e.title}`, onclick: async () => { if (await confirmDialog({ title: `Delete “${e.title}”?`, confirmLabel: 'Delete', danger: true })) { try { await deleteSpecialDate(e.id); } catch (x) { toast(x.message, 'error'); } } } }, icon('trash')) : null)));
    };
    host.replaceChildren(
      h('header', { class: 'row between' }, h('div', {}, h('h1', { class: 'title' }, 'Special Dates'), h('p', { class: 'sub' }, 'The days that matter to us.')),
        h('button', { class: 'btn primary', onclick: () => editor(null) }, icon('plus'), 'Add')),
      upcoming.length ? h('div', {}, upcoming.map(card)) : h('p', { class: 'empty' }, 'No upcoming dates.'),
      past.length ? h('details', {}, h('summary', { class: 'sub', style: 'min-height:44px;display:flex;align-items:center' }, `Past dates (${past.length})`), h('div', {}, past.map(card))) : null,
      h('p', { class: 'hint' }, 'Yearly dates repeat automatically (a 29 February date is kept on 28 February in non-leap years). The reunion date is one-time and never repeats.'));
  }
  root.append(host); render();
  return on('data', render);
}
export { uuid };
