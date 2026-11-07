// Tiny IndexedDB wrapper. Structured offline storage for settings, quotes, milestones, events, photos, messages, outbox.
const DB_NAME = 'infinity-hearts';
const DB_VERSION = 1;
export const STORES = ['kv', 'quotes', 'milestones', 'special_dates', 'photos', 'messages', 'outbox', 'quote_history', 'favorites'];

// If the browser cannot open its storage (a full disk, a blocked or damaged profile: "Internal error opening backing store"),
// the app must still let you sign in and use it. It then keeps data in memory for this visit only.
let useMem = false;
const mem = Object.fromEntries(STORES.map((n) => [n, new Map()]));
export const storageDegraded = () => useMem;

let dbp = null;
export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { console.warn('IndexedDB unavailable', e); useMem = true; resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.warn('IndexedDB failed to open', req.error); useMem = true; resolve(null); };
    req.onblocked = () => { useMem = true; resolve(null); };
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  if (!db) throw new Error('storage unavailable');
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

const keyOf = (store, v) => (store === 'kv' ? undefined : v.id);
const memApi = {
  get: async (st, k) => mem[st].get(k),
  all: async (st) => [...mem[st].values()],
  put: async (st, v, k) => { mem[st].set(k === undefined ? keyOf(st, v) : k, v); },
  putMany: async (st, vs) => { vs.forEach((v) => mem[st].set(keyOf(st, v), v)); },
  del: async (st, k) => { mem[st].delete(k); },
  clear: async (st) => { mem[st].clear(); },
  replaceAll: async (st, vs) => { mem[st].clear(); vs.forEach((v) => mem[st].set(keyOf(st, v), v)); },
};
const real = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  put: (store, value, key) => tx(store, 'readwrite', (s) => wrap(key === undefined ? s.put(value) : s.put(value, key))),
  putMany: (store, values) => tx(store, 'readwrite', (s) => Promise.all(values.map((v) => wrap(s.put(v))))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  /** Replace the full contents of a store with a fresh server snapshot. */
  replaceAll: (store, values) => tx(store, 'readwrite', async (s) => { await wrap(s.clear()); await Promise.all(values.map((v) => wrap(s.put(v)))); }),
};
export const idb = Object.fromEntries(Object.keys(real).map((name) => [name, async (...args) => {
  await openDb();
  if (!useMem) {
    try { return await real[name](...args); } catch (e) { console.warn(`IndexedDB ${name} failed, using memory`, e); }   // e.g. disk full
  }
  return memApi[name](...args);
}]));

export const kv = {
  get: (k) => idb.get('kv', k),
  set: (k, v) => idb.put('kv', v, k),
  del: (k) => idb.del('kv', k),
};

/** Remove everything private from this device (used on sign-out and when a different account signs in). */
export async function wipeAll() {
  for (const s of STORES) await idb.clear(s);
  try { localStorage.removeItem('ih.lastPhoto'); } catch { /* ignore */ }
}