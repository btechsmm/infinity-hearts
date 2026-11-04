import { h, toast, fmtDate } from '../util.js';
import { icon } from '../icons.js';
import { state, on, addPhoto, updatePhoto, deletePhoto, photoUrl } from '../api.js';
import { openModal, confirmDialog, emptyState, field } from '../ui.js';

export function mount(root) {
  const host = h('div', { class: 'stack' });
  const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, class: 'sr', 'aria-label': 'Choose photos' });
  file.addEventListener('change', async () => {
    const files = [...file.files]; file.value = '';
    for (const f of files) {
      try { await addPhoto(f); toast('Photo added', 'ok'); } catch (e) { toast(e.message, 'error'); }
    }
  });

  function editCaption(p) {
    openModal((close) => {
      const cap = h('input', { type: 'text', maxlength: '140', value: p.caption || '' });
      const date = h('input', { type: 'date', value: p.memory_date || '' });
      return h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); try { await updatePhoto(p.id, { caption: cap.value.trim() || null, memory_date: date.value || null }); close(); } catch (x) { toast(x.message, 'error'); } } },
        h('h2', { class: 'title' }, 'Photo details'), field('Caption', cap), field('Memory date (optional)', date),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Cancel'), h('button', { class: 'btn primary', type: 'submit' }, 'Save')));
    });
  }

  function render() {
    host.replaceChildren(
      h('header', { class: 'row between' }, h('div', {}, h('h1', { class: 'title' }, 'Memories'), h('p', { class: 'sub' }, 'Photos of us. Shown on the welcome screen, one at a time.')),
        h('button', { class: 'btn primary', onclick: () => file.click() }, icon('plus'), 'Add photos')),
      file,
      state.photos.length ? h('div', { class: 'gallery' }, state.photos.map((p) => {
        const img = h('img', { alt: p.caption || 'Our photo', loading: 'lazy', decoding: 'async' });
        photoUrl(p).then((u) => { if (u) img.src = u; });
        return h('figure', { class: 'ph', style: 'margin:0' }, img,
          h('figcaption', { class: 'cap' }, p.caption || 'No caption', p.memory_date ? h('small', {}, fmtDate(p.memory_date, 'UTC')) : null),
          h('div', { class: 'tools' },
            h('button', { class: 'btn small', 'aria-pressed': String(p.is_active !== false), title: 'Include on the welcome screen', onclick: () => updatePhoto(p.id, { is_active: p.is_active === false }).catch((e) => toast(e.message, 'error')) }, p.is_active === false ? 'Hidden' : 'In rotation'),
            h('button', { class: 'icon-btn', style: 'width:36px;height:36px', 'aria-label': 'Edit caption', onclick: () => editCaption(p) }, icon('edit')),
            h('button', { class: 'icon-btn', style: 'width:36px;height:36px', 'aria-label': 'Delete photo', onclick: async () => { if (await confirmDialog({ title: 'Delete this photo?', body: 'It will be removed for both of you.', confirmLabel: 'Delete', danger: true })) deletePhoto(p.id).catch((e) => toast(e.message, 'error')); } }, icon('trash'))));
      })) : emptyState(icon('image'), 'No photos yet', 'Add your favourite photos of the two of you. They are kept private and used on the welcome screen. Photos are only resized, never edited.'),
      h('p', { class: 'hint' }, state.mode === 'cloud' ? 'Photos are stored in a private bucket and copied to this device so they still show offline.' : 'Local mode: photos stay on this device only.'));
  }
  root.append(host); render();
  return on('data', render);
}
