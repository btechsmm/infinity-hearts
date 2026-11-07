// Data layer. Cloud mode = Supabase (auth + RLS). Local mode = IndexedDB only (no account, no messaging).
// Everything the UI shows is derived from `state`; views re-render on bus events.
import { CONFIG, CLOUD } from './config.js';
import { idb, kv, wipeAll } from './store.js';
import { uuid, resizeImage } from './util.js';
import { DEFAULTS, localDateISO } from './core/time.js';
import { missedMilestones } from './core/milestones.js';
import { defaultSpecialDates } from './core/specialDates.js';

export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => { bus.addEventListener(name, fn); return () => bus.removeEventListener(name, fn); };

export const state = {
  mode: CLOUD ? 'cloud' : 'local',
  ready: false,
  authed: false,
  recovery: false,
  notMember: false,
  online: navigator.onLine,
  user: null, profile: null, partner: null, coupleId: null,
  cfg: normalizeSettings({}),
  quotes: [], favorites: new Set(), history: [],
  milestones: [], specialDates: [], photos: [],
  messages: [], outbox: [], prefs: null,
  rt: { partnerOnline: false, partnerTyping: false, connected: false, error: '' },
  lastSync: null, sessionExpired: false,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID_RE.test(s || '');

export function normalizeSettings(r) {
  return {
    id: r.id ?? null,
    coupleName: r.couple_name ?? 'Becam & Faith',
    departureAt: r.departure_at ?? DEFAULTS.departureAt,
    expectedReturnAt: r.expected_return_at ?? DEFAULTS.expectedReturnAt,
    actualReunionAt: r.actual_reunion_at ?? null,
    homeCity: r.home_city ?? 'Nairobi, Kenya',
    destinationCity: r.destination_city ?? 'Manama, Bahrain',
    homeTimezone: r.home_timezone ?? DEFAULTS.homeTimezone,
    destinationTimezone: r.destination_timezone ?? DEFAULTS.destinationTimezone,
    home: { lat: r.home_lat ?? -1.2921, lon: r.home_lon ?? 36.8219 },
    destination: { lat: r.destination_lat ?? 26.2235, lon: r.destination_lon ?? 50.5876 },
    dailyNotificationEnabled: r.daily_notification_enabled ?? true,
    defaultNotificationTime: (r.default_notification_time ?? '08:00').slice(0, 5),
    customRules: r.custom_milestone_rules ?? [],
  };
}
const settingsToRow = (p) => {
  const map = { coupleName: 'couple_name', departureAt: 'departure_at', expectedReturnAt: 'expected_return_at', actualReunionAt: 'actual_reunion_at', homeTimezone: 'home_timezone', destinationTimezone: 'destination_timezone', dailyNotificationEnabled: 'daily_notification_enabled', defaultNotificationTime: 'default_notification_time', customRules: 'custom_milestone_rules', homeCity: 'home_city', destinationCity: 'destination_city' };
  const o = {};
  for (const [k, v] of Object.entries(p)) if (map[k]) o[map[k]] = v;
  return o;
};

// ------------------------------------------------------------------ Supabase client
let sb = null;
export async function client() {
  if (!CLOUD) return null;
  if (sb) return sb;
  const { createClient } = await import(CONFIG.supabaseLib);
  sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') { state.recovery = true; emit('auth'); return; }
    if (event === 'SIGNED_OUT' && state.authed && !state._signingOut) {
      // Refresh token rejected or session revoked elsewhere: lock the app, keep nothing sensitive reachable.
      state.sessionExpired = true;
      await lockLocally();
      emit('auth');
    }
    if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') state.sessionExpired = false;
  });
  return sb;
}

// ------------------------------------------------------------------ boot
export async function init() {
  window.addEventListener('online', () => { state.online = true; emit('net'); if (state.authed) { syncAll().catch(() => { }); } });
  window.addEventListener('offline', () => { state.online = false; emit('net'); });

  if (state.mode === 'local') {
    await loadLocal();
    state.authed = true;
    state.profile = { display_name: (await kv.get('localName')) || 'Becam', partner_role: 'becam', timezone: 'Africa/Nairobi' };
    state.ready = true;
    await syncMilestones();
    return;
  }

  const c = await client();
  const { data } = await c.auth.getSession();
  if (data.session) await adoptSession(data.session.user);
  state.ready = true;
}

async function loadLocal() {
  const [cfg, sd, photos, quotesCache, fav, ms, hist] = await Promise.all([
    kv.get('settings'), idb.all('special_dates'), idb.all('photos'), idb.all('quotes'), idb.all('favorites'), idb.all('milestones'), idb.all('quote_history'),
  ]);
  state.cfg = normalizeSettings(cfg || {});
  state.specialDates = sd.length ? sd : defaultSpecialDates(state.cfg).map((e) => ({ ...e }));
  if (!sd.length) await idb.putMany('special_dates', state.specialDates);
  state.photos = photos.sort((a, b) => a.display_order - b.display_order);
  state.favorites = new Set(fav.map((f) => f.id));
  state.milestones = ms.sort((a, b) => b.milestone_date.localeCompare(a.milestone_date));
  state.history = hist.sort((a, b) => b.display_date.localeCompare(a.display_date));
  state.quotes = quotesCache.length ? quotesCache : await bundledQuotes();
}

let bundled = null;
export async function bundledQuotes() {
  if (bundled) return bundled;
  const raw = await (await fetch('/src/data/quotes.json')).json();
  bundled = raw.map((q, i) => ({ id: `b-${String(i).padStart(3, '0')}`, category: q.c, frequency: q.f, audience: q.a, message: q.m, is_active: true }));
  return bundled;
}

async function adoptSession(user) {
  // A different account on a shared device must never see the previous account's cache.
  const owner = await kv.get('ownerId');
  if (owner && owner !== user.id) await wipeAll();
  await kv.set('ownerId', user.id);
  state.user = user;
  state.authed = true;
  state.sessionExpired = false;
  await loadCachedCloud();
  if (state.online) { try { await loadCloud(); } catch (e) { console.warn('cloud load failed, using cache', e); } }
  subscribeRealtime();
}

async function loadCachedCloud() {
  const [cfg, sd, photos, quotes, fav, ms, msgs, outbox, hist, profile, prefs] = await Promise.all([
    kv.get('settings'), idb.all('special_dates'), idb.all('photos'), idb.all('quotes'), idb.all('favorites'),
    idb.all('milestones'), idb.all('messages'), idb.all('outbox'), idb.all('quote_history'), kv.get('profile'), kv.get('prefs'),
  ]);
  if (cfg) state.cfg = normalizeSettings(cfg);
  state.coupleId = (await kv.get('coupleId')) || null;
  state.profile = profile || null;
  state.partner = (await kv.get('partner')) || null;
  state.prefs = prefs || null;
  state.specialDates = sd.length ? sd : defaultSpecialDates(state.cfg).map((e) => ({ ...e }));
  state.photos = photos.sort((a, b) => a.display_order - b.display_order);
  state.quotes = quotes.length ? quotes : await bundledQuotes();
  state.favorites = new Set(fav.map((f) => f.id));
  state.milestones = ms.sort((a, b) => b.milestone_date.localeCompare(a.milestone_date));
  state.messages = msgs.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  state.outbox = outbox.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  state.history = hist;
}

export async function loadCloud() {
  const c = await client();
  const uid = state.user.id;
  const { data: mem } = await c.from('couple_members').select('couple_id, partner_role').eq('user_id', uid).maybeSingle();
  if (!mem) { state.notMember = true; emit('auth'); return; }
  state.notMember = false;
  state.coupleId = mem.couple_id;
  const [settings, profiles, quotes, favs, ms, sd, photos, msgs, prefs, hist] = await Promise.all([
    c.from('couple_settings').select('*').eq('couple_id', mem.couple_id).maybeSingle(),
    c.from('profiles').select('*'),
    c.from('quotes').select('id,category,frequency,audience,message,is_active,title').eq('is_active', true),
    c.from('quote_favorites').select('quote_id'),
    c.from('milestones').select('*').order('milestone_date', { ascending: false }).limit(1000),
    c.from('special_dates').select('*').order('event_date'),
    c.from('couple_photos').select('*').order('display_order').order('created_at'),
    c.from('messages').select('*').order('sent_at', { ascending: false }).limit(300),
    c.from('notification_preferences').select('*').eq('user_id', uid).maybeSingle(),
    c.from('daily_quote_history').select('*').eq('recipient_id', uid).order('display_date', { ascending: false }).limit(120),
  ]);
  for (const r of [settings, profiles, quotes, favs, ms, sd, photos, msgs, prefs, hist]) if (r.error) throw r.error;

  if (settings.data) { state.cfg = normalizeSettings(settings.data); await kv.set('settings', settings.data); }
  state.profile = profiles.data.find((p) => p.id === uid) || null;
  state.partner = profiles.data.find((p) => p.id !== uid) || null;
  await kv.set('profile', state.profile); await kv.set('partner', state.partner); await kv.set('coupleId', mem.couple_id);
  if (quotes.data.length) { state.quotes = quotes.data; await idb.replaceAll('quotes', quotes.data); }
  state.favorites = new Set(favs.data.map((f) => f.quote_id));
  await idb.replaceAll('favorites', [...state.favorites].map((id) => ({ id })));
  state.milestones = ms.data; await idb.replaceAll('milestones', ms.data);
  state.specialDates = sd.data.map((e) => ({ ...e, id: e.id })); await idb.replaceAll('special_dates', state.specialDates);
  state.photos = photos.data; await idb.replaceAll('photos', await mergePhotoBlobs(photos.data));
  // merge: keep anything still in the outbox out of the server list so it is not shown twice
  state.messages = msgs.data.reverse(); await idb.replaceAll('messages', state.messages);
  state.prefs = prefs.data; if (prefs.data) await kv.set('prefs', prefs.data);
  state.history = hist.data.map((x) => ({ ...x, id: x.id })); await idb.replaceAll('quote_history', state.history);
  state.lastSync = new Date().toISOString(); await kv.set('lastSync', state.lastSync);
  emit('data');
  markDelivered();
  await flushOutbox();
  await syncMilestones();
}

async function mergePhotoBlobs(rows) {
  const old = await idb.all('photos');
  const blobs = new Map(old.map((p) => [p.id, p.blob]));
  return rows.map((r) => ({ ...r, blob: blobs.get(r.id) || null }));
}

export async function syncAll() { if (state.mode === 'cloud' && state.authed) await loadCloud(); else await syncMilestones(); }

// ------------------------------------------------------------------ auth
export async function signIn(email, password) {
  const c = await client();
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  await adoptSession(data.user);
  emit('auth');
}
export async function resetPassword(email) {
  const c = await client();
  const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + '/' });
  if (error) throw error;
}
export async function setNewPassword(password) {
  const c = await client();
  const { error } = await c.auth.updateUser({ password });
  if (error) throw error;
  state.recovery = false;
  const { data } = await c.auth.getSession();
  if (data.session) await adoptSession(data.session.user);
  emit('auth');
}
async function lockLocally() {
  state.authed = false; state.user = null; state.profile = null; state.messages = []; state.outbox = [];
  unsubscribeRealtime();
}
/** Safe sign-out: clears this device's private cache. Unsent messages are reported first by the UI. */
export async function signOut() {
  state._signingOut = true;
  try { const c = await client(); await c?.auth.signOut(); } catch { /* offline: local sign-out below still applies */ }
  try { const c = await client(); c?.auth && localStorage.removeItem(Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')) || ''); } catch { /* ignore */ }
  await wipeAll();
  navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_DATA_CACHES' });
  await lockLocally();
  state._signingOut = false;
  state.cfg = normalizeSettings({}); state.specialDates = []; state.photos = []; state.milestones = []; state.favorites = new Set();
  state.notMember = false; state.recovery = false; state.sessionExpired = false; state.coupleId = null; state.partner = null; state.prefs = null;
  emit('auth');
}

// ------------------------------------------------------------------ settings
export async function updateSettings(patch) {
  const next = { ...state.cfg, ...patch };
  if (new Date(next.expectedReturnAt) <= new Date(next.departureAt)) throw new Error('The return time must be after the departure time.');
  if (state.mode === 'cloud') {
    const c = await client();
    const { data, error } = await c.from('couple_settings').update(settingsToRow(patch)).eq('couple_id', state.coupleId).select().single();
    if (error) throw error;
    state.cfg = normalizeSettings(data); await kv.set('settings', data);
  } else {
    state.cfg = next;
    await kv.set('settings', { couple_name: next.coupleName, departure_at: next.departureAt, expected_return_at: next.expectedReturnAt, actual_reunion_at: next.actualReunionAt, home_timezone: next.homeTimezone, destination_timezone: next.destinationTimezone, home_city: next.homeCity, destination_city: next.destinationCity, daily_notification_enabled: next.dailyNotificationEnabled, default_notification_time: next.defaultNotificationTime, custom_milestone_rules: next.customRules });
  }
  emit('data');
}

export async function updateProfile(patch) {
  if (state.mode === 'cloud') {
    const c = await client();
    const { data, error } = await c.from('profiles').update(patch).eq('id', state.user.id).select().single();
    if (error) throw error;
    state.profile = data; await kv.set('profile', data);
  } else {
    state.profile = { ...state.profile, ...patch };
    if (patch.display_name) await kv.set('localName', patch.display_name);
  }
  emit('data');
}

// ------------------------------------------------------------------ quotes
export async function toggleFavorite(quoteId) {
  const has = state.favorites.has(quoteId);
  has ? state.favorites.delete(quoteId) : state.favorites.add(quoteId);
  if (has) await idb.del('favorites', quoteId); else await idb.put('favorites', { id: quoteId });
  if (state.mode === 'cloud' && isUuid(quoteId) && state.online) {
    const c = await client();
    const r = has ? await c.from('quote_favorites').delete().eq('quote_id', quoteId).eq('user_id', state.user.id)
      : await c.from('quote_favorites').upsert({ quote_id: quoteId, user_id: state.user.id });
    if (r.error) console.warn('favorite sync failed', r.error);
  }
  emit('data');
}

/** Remember which quote was shown today (history screen + avoids repeats across devices). */
export async function recordQuoteShown(quote, dateISO) {
  if (!quote) return;
  const id = `${dateISO}:${quote.id}`;
  if (state.history.some((h) => h.id === id || (h.quote_id === quote.id && h.display_date === dateISO))) return;
  const rec = { id, quote_id: quote.id, display_date: dateISO };
  state.history.unshift(rec);
  await idb.put('quote_history', rec);
  if (state.mode === 'cloud' && state.online && isUuid(quote.id)) {
    const c = await client();
    await c.from('daily_quote_history').upsert({ quote_id: quote.id, display_date: dateISO, recipient_id: state.user.id }, { onConflict: 'recipient_id,display_date,quote_id', ignoreDuplicates: true });
  }
}

// ------------------------------------------------------------------ milestones
export async function syncMilestones(now = new Date()) {
  const have = new Set(state.milestones.map((m) => `ms:${m.milestone_date}`));
  const last = state.milestones.length ? state.milestones.map((m) => m.milestone_date).sort().pop() : null;
  const fresh = missedMilestones(now, state.cfg, have, last, state.cfg.customRules);
  if (!fresh.length) return [];
  if (state.mode === 'cloud') {
    if (!state.online) return [];   // generated again on reconnect; the unique (couple, date) key prevents duplicates
    const c = await client();
    const rows = fresh.map(({ key, significant, ...r }) => ({ ...r, couple_id: state.coupleId }));
    const { data, error } = await c.from('milestones').upsert(rows, { onConflict: 'couple_id,milestone_date', ignoreDuplicates: true }).select();
    if (error) { console.warn('milestone sync', error); return []; }
    if (data?.length) {
      await c.from('milestone_deliveries').upsert(data.map((m) => ({ milestone_id: m.id, recipient_id: state.user.id, delivery_channel: 'in_app', delivery_status: 'delivered', delivered_at: new Date().toISOString() })), { onConflict: 'milestone_id,recipient_id,delivery_channel', ignoreDuplicates: true });
      state.milestones = [...data, ...state.milestones].sort((a, b) => b.milestone_date.localeCompare(a.milestone_date));
      await idb.replaceAll('milestones', state.milestones);
      emit('data'); emit('milestone', data[data.length - 1]);
    }
    return data || [];
  }
  const rows = fresh.map(({ key, significant, ...r }) => ({ ...r, id: `ms:${r.milestone_date}`, created_at: new Date().toISOString(), delivery_status: 'delivered' }));
  await idb.putMany('milestones', rows);
  state.milestones = [...rows, ...state.milestones].sort((a, b) => b.milestone_date.localeCompare(a.milestone_date));
  emit('data'); emit('milestone', rows[rows.length - 1]);
  return rows;
}

// ------------------------------------------------------------------ special dates
export async function saveSpecialDate(ev) {
  const payload = { title: ev.title, event_date: ev.event_date, recurrence_type: ev.recurrence_type, reminder_settings: ev.reminder_settings, message: ev.message ?? null, photo_path: ev.photo_path ?? null };
  if (state.mode === 'cloud') {
    const c = await client();
    const r = ev.id && isUuid(ev.id)
      ? await c.from('special_dates').update(payload).eq('id', ev.id).select().single()
      : await c.from('special_dates').insert({ ...payload, couple_id: state.coupleId, created_by: state.user.id, is_builtin: false }).select().single();
    if (r.error) throw r.error;
    const i = state.specialDates.findIndex((e) => e.id === r.data.id);
    i >= 0 ? (state.specialDates[i] = r.data) : state.specialDates.push(r.data);
    await idb.replaceAll('special_dates', state.specialDates);
  } else {
    const rec = { ...ev, ...payload, id: ev.id || uuid() };
    const i = state.specialDates.findIndex((e) => e.id === rec.id);
    i >= 0 ? (state.specialDates[i] = rec) : state.specialDates.push(rec);
    await idb.put('special_dates', rec);
  }
  emit('data');
}
export async function deleteSpecialDate(id) {
  if (state.mode === 'cloud') { const c = await client(); const { error } = await c.from('special_dates').delete().eq('id', id); if (error) throw error; }
  state.specialDates = state.specialDates.filter((e) => e.id !== id);
  await idb.del('special_dates', id);
  emit('data');
}

// ------------------------------------------------------------------ photos (private bucket, cached as blobs for offline)
export async function addPhoto(file, caption = '', memoryDate = null) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Please choose a JPEG, PNG or WebP photo.');
  const blob = await resizeImage(file);
  const id = uuid();
  const order = state.photos.length ? Math.max(...state.photos.map((p) => p.display_order || 0)) + 1 : 0;
  if (state.mode === 'cloud') {
    if (!state.online) throw new Error('Connect to the internet to upload photos.');
    const c = await client();
    const path = `${state.coupleId}/${id}.jpg`;
    const up = await c.storage.from('couple-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await c.from('couple_photos').insert({ id, couple_id: state.coupleId, storage_path: path, caption: caption || null, memory_date: memoryDate || null, display_order: order, uploaded_by: state.user.id }).select().single();
    if (error) { await c.storage.from('couple-photos').remove([path]); throw error; }
    state.photos.push({ ...data, blob });
    await idb.put('photos', { ...data, blob });
  } else {
    const rec = { id, storage_path: `local/${id}`, caption: caption || null, memory_date: memoryDate || null, is_active: true, display_order: order, created_at: new Date().toISOString(), blob };
    state.photos.push(rec); await idb.put('photos', rec);
  }
  emit('data');
}
export async function updatePhoto(id, patch) {
  const p = state.photos.find((x) => x.id === id);
  if (!p) return;
  if (state.mode === 'cloud') { const c = await client(); const { error } = await c.from('couple_photos').update(patch).eq('id', id); if (error) throw error; }
  Object.assign(p, patch);
  await idb.put('photos', p);
  emit('data');
}
export async function deletePhoto(id) {
  const p = state.photos.find((x) => x.id === id);
  if (!p) return;
  if (state.mode === 'cloud') {
    const c = await client();
    const { error } = await c.from('couple_photos').delete().eq('id', id); if (error) throw error;
    await c.storage.from('couple-photos').remove([p.storage_path]);
  }
  state.photos = state.photos.filter((x) => x.id !== id);
  await idb.del('photos', id);
  emit('data');
}
const urlCache = new Map();
/** Returns an object URL for a photo, fetching a short-lived signed URL once and caching the bytes in IndexedDB. */
export async function photoUrl(p) {
  if (!p) return null;
  if (urlCache.has(p.id)) return urlCache.get(p.id);
  let blob = p.blob;
  if (!blob && state.mode === 'cloud' && state.online) {
    try {
      const c = await client();
      const { data, error } = await c.storage.from('couple-photos').createSignedUrl(p.storage_path, 300);
      if (error) throw error;
      const res = await fetch(data.signedUrl);
      if (res.ok) { blob = await res.blob(); p.blob = blob; await idb.put('photos', p); }
    } catch (e) { console.warn('photo fetch failed', e); }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(p.id, url);
  return url;
}
export function eligiblePhotos() { return state.photos.filter((p) => p.is_active !== false && (p.blob || state.online)); }

// ------------------------------------------------------------------ messages (cloud only; queued offline)
let channel = null;
function subscribeRealtime() {
  subscribePresence();
  if (channel || !state.coupleId || !state.online) return;
  client().then((c) => {
    channel = c.channel(`couple-${state.coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `couple_id=eq.${state.coupleId}` }, (payload) => {
        const row = payload.new;
        if (!row?.id) return;
        mergeMessage(row, true);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'couple_settings', filter: `couple_id=eq.${state.coupleId}` }, (payload) => {
        state.cfg = normalizeSettings(payload.new); kv.set('settings', payload.new); emit('data');
      })
      .subscribe();
  });
}
function unsubscribeRealtime() {
  if (channel && sb) sb.removeChannel(channel); channel = null;
  if (rtChannel && sb) sb.removeChannel(rtChannel); rtChannel = null;
  clearInterval(seenTimer); clearTimeout(typingStopTimer); clearTimeout(partnerTypingTimer);
  state.rt = { partnerOnline: false, partnerTyping: false, connected: false, error: '' };
}

// ------------------------------------------------------------------ presence, typing, last seen
// Private realtime channel `couple:<id>` (authorised by RLS on realtime.messages, see migration 20261107000001).
let rtRetry = 0, rtChannel = null, seenTimer = null, typingStopTimer = null, partnerTypingTimer = null, lastTypingSent = 0, typingNow = false;

function setRt(patch) { Object.assign(state.rt, patch); emit('presence'); }
function syncPartnerOnline() {
  if (!rtChannel || !state.partner) return;
  const st = rtChannel.presenceState();
  const online = Object.keys(st).some((k) => k === state.partner.id && st[k]?.length);
  setRt({ partnerOnline: online, ...(online ? {} : { partnerTyping: false }) });
}
export async function touchLastSeen() {
  if (state.mode !== 'cloud' || !state.online || !state.authed || !state.user) return;
  try {
    const c = await client();
    const at = new Date().toISOString();
    const { error } = await c.from('profiles').update({ last_seen_at: at }).eq('id', state.user.id);
    if (error) console.warn('last seen not saved (run update-chat-features.sql):', error.message);
    else if (state.profile) state.profile.last_seen_at = at;
  } catch { /* best effort */ }
}
function subscribePresence() {
  if (rtChannel || !state.coupleId || !state.online || !state.user) return;
  client().then((c) => {
    if (rtChannel) return;
    rtChannel = c.channel(`couple:${state.coupleId}`, { config: { private: true, presence: { key: state.user.id }, broadcast: { self: false } } })
      .on('presence', { event: 'sync' }, syncPartnerOnline)
      .on('presence', { event: 'join' }, syncPartnerOnline)
      .on('presence', { event: 'leave' }, () => { syncPartnerOnline(); refreshPartnerSeen(); })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (!payload || payload.from !== state.partner?.id) return;
        clearTimeout(partnerTypingTimer);
        if (payload.typing) { setRt({ partnerTyping: true }); partnerTypingTimer = setTimeout(() => setRt({ partnerTyping: false }), 5000); }
        else setRt({ partnerTyping: false });
      })
      .subscribe((status, err) => {
        const ok = status === 'SUBSCRIBED';
        setRt({ connected: ok, error: ok ? '' : (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status) ? status : state.rt.error) });
        if (ok) { rtRetry = 0; rtChannel.track({ at: Date.now(), visible: !document.hidden }); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Usually: the chat-features SQL has not been run (the private channel is refused), or the network dropped.
          console.warn('Realtime presence channel failed:', status, err?.message || err || '');
          const ch = rtChannel; rtChannel = null; if (ch && sb) sb.removeChannel(ch);
          if (rtRetry < 3) setTimeout(subscribePresence, 4000 * ++rtRetry);
        }
      });
    touchLastSeen();
    clearInterval(seenTimer);
    seenTimer = setInterval(() => { if (!document.hidden) touchLastSeen(); }, 45000);
  });
}
async function refreshPartnerSeen() {
  try {
    const c = await client();
    const { data } = await c.from('profiles').select('id,last_seen_at').eq('id', state.partner.id).maybeSingle();
    if (data) { state.partner = { ...state.partner, last_seen_at: data.last_seen_at }; await kv.set('partner', state.partner); emit('presence'); }
  } catch { /* ignore */ }
}
/** Called by the composer. Sends at most one "typing" ping per 2.5s and a "stopped" ping 3s after the last key. */
export function notifyTyping(isTyping) {
  if (!rtChannel || !state.rt.connected) return;
  const send = (typing) => { typingNow = typing; rtChannel.send({ type: 'broadcast', event: 'typing', payload: { from: state.user.id, typing } }); };
  clearTimeout(typingStopTimer);
  if (!isTyping) { if (typingNow) send(false); return; }
  const now = Date.now();
  if (!typingNow || now - lastTypingSent > 2500) { lastTypingSent = now; send(true); }
  typingStopTimer = setTimeout(() => { if (typingNow) send(false); }, 3000);
}
/** Re-announce presence/last seen when the app returns to the foreground. */
export function presenceVisibility() {
  if (!rtChannel) return;
  rtChannel.track({ at: Date.now(), visible: !document.hidden });
  if (!document.hidden) touchLastSeen();
}

async function mergeMessage(row, fromRealtime = false) {
  const i = state.messages.findIndex((m) => m.id === row.id || (m.client_id && m.client_id === row.client_id && m.sender_id === row.sender_id));
  i >= 0 ? (state.messages[i] = row) : state.messages.push(row);
  state.messages.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  await idb.put('messages', row);
  state.outbox = state.outbox.filter((o) => o.id !== row.client_id);
  await idb.del('outbox', row.client_id);
  const incoming = fromRealtime && row.recipient_id === state.user?.id && i < 0;
  emit('messages', { incoming });
  if (incoming) markDelivered();
}

/** Tell the sender this device has the messages (grey double tick). Reading later upgrades it to blue. */
export async function markDelivered() {
  if (state.mode !== 'cloud' || !state.online || !state.user) return;
  const pending = state.messages.filter((m) => m.recipient_id === state.user.id && !m.delivered_at);
  if (!pending.length) return;
  try {
    const c = await client();
    const now = new Date().toISOString();
    const { error } = await c.from('messages').update({ delivered_at: now }).eq('recipient_id', state.user.id).is('delivered_at', null);
    if (!error) { pending.forEach((m) => { m.delivered_at = now; }); await idb.putMany('messages', pending); emit('messages'); }
  } catch { /* retried on next open */ }
}

export function partnerId() { return state.partner?.id ?? null; }
export function unreadCount() { return state.messages.filter((m) => m.recipient_id === state.user?.id && !m.read_at && !m.deleted_at).length; }

export async function sendMessage({ content, type = 'text', quoteId = null }) {
  content = (content || '').trim();
  if (!content) return;
  if (content.length > 2000) throw new Error('Messages can be up to 2,000 characters.');
  if (state.mode !== 'cloud') throw new Error('Messaging needs a signed-in account.');
  const item = { id: uuid(), type, content, quote_id: quoteId && isUuid(quoteId) ? quoteId : null, sent_at: new Date().toISOString(), status: 'queued' };
  state.outbox.push(item);
  await idb.put('outbox', item);
  emit('messages');
  await flushOutbox();
}

let flushing = false;
export async function flushOutbox() {
  if (flushing || state.mode !== 'cloud' || !state.online || !state.authed || !state.partner) return;
  flushing = true;
  try {
    const c = await client();
    for (const item of [...state.outbox].sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
      const row = { couple_id: state.coupleId, client_id: item.id, sender_id: state.user.id, recipient_id: state.partner.id, message_type: item.type, content: item.content, quote_id: item.quote_id, sent_at: item.sent_at };
      const { data, error } = await c.from('messages').insert(row).select().single();
      if (!error) { await mergeMessage(data); continue; }
      if (error.code === '23505') {
        // Already delivered earlier (retry after a dropped response): fetch it and clear the queue entry.
        const { data: existing } = await c.from('messages').select('*').eq('sender_id', state.user.id).eq('client_id', item.id).maybeSingle();
        if (existing) await mergeMessage(existing);
        continue;
      }
      if (error.code === '42501' || error.status === 401 || error.status === 403) { item.status = 'failed'; item.error = 'Not allowed'; await idb.put('outbox', item); emit('messages'); continue; }
      break; // network or transient: keep the rest queued, in order
    }
  } finally { flushing = false; }
}
export async function discardOutbox(id) { state.outbox = state.outbox.filter((o) => o.id !== id); await idb.del('outbox', id); emit('messages'); }

export async function markThreadRead() {
  if (state.mode !== 'cloud' || !state.online) return;
  const unread = state.messages.filter((m) => m.recipient_id === state.user.id && !m.read_at);
  if (!unread.length) return;
  const c = await client();
  const now = new Date().toISOString();
  const { error } = await c.from('messages').update({ read_at: now }).eq('recipient_id', state.user.id).is('read_at', null);
  if (!error) { unread.forEach((m) => { m.read_at = now; m.delivered_at = m.delivered_at || now; }); await idb.putMany('messages', unread); emit('messages'); }
}
export async function deleteMessage(id) {
  const c = await client();
  const { data, error } = await c.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single();
  if (error) throw error;
  await mergeMessage(data);
}

// ------------------------------------------------------------------ notification preferences / push
export async function savePrefs(patch) {
  const base = state.prefs || { user_id: state.user?.id, timezone: state.profile?.timezone || 'Africa/Nairobi' };
  const next = { ...base, ...patch };
  if (state.mode === 'cloud') {
    const c = await client();
    const { id, created_at, updated_at, ...row } = next;
    const { data, error } = await c.from('notification_preferences').upsert({ ...row, user_id: state.user.id }, { onConflict: 'user_id' }).select().single();
    if (error) throw error;
    state.prefs = data; await kv.set('prefs', data);
  } else { state.prefs = next; await kv.set('prefs', next); }
  emit('data');
}
/** Set (or clear with '') the private nickname for the partner. Always kept on this device; synced to the account when the database has the column. */
export async function setPartnerNickname(name) {
  const v = String(name || '').trim().slice(0, 30);
  try { v ? localStorage.setItem('ih.nick', v) : localStorage.removeItem('ih.nick'); } catch { /* ignore */ }
  let synced = state.mode !== 'cloud';
  if (state.mode === 'cloud' && state.online) {
    try { await savePrefs({ partner_nickname: v || null }); synced = true; } catch (e) { console.warn('nickname not synced', e); }
  }
  emit('data');
  return { synced };
}
export async function saveSubscription(sub) {
  if (state.mode !== 'cloud') return;
  const c = await client();
  const json = sub.toJSON();
  const { error } = await c.from('notification_subscriptions').upsert({ user_id: state.user.id, platform: 'web', endpoint: json.endpoint, subscription_data: json, enabled: true }, { onConflict: 'user_id,endpoint' });
  if (error) throw error;
}
export async function removeSubscription(endpoint) {
  if (state.mode !== 'cloud') return;
  const c = await client();
  await c.from('notification_subscriptions').delete().eq('user_id', state.user.id).eq('endpoint', endpoint);
}
export async function requestTestPush() {
  const c = await client();
  const { data, error } = await c.functions.invoke('send-notifications', { body: { test: true } });
  if (error) throw error;
  return data;
}
export const todayISO = () => localDateISO(new Date(), state.cfg.homeTimezone);