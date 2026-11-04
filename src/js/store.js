// Tiny IndexedDB wrapper. Structured offline storage for settings, quotes, milestones, events, photos, messages, outbox.
const DB_NAME = 'infinity-hearts';
const DB_VERSION = 1;
export const STORES = ['kv', 'quotes', 'milestones', 'special_dates', 'photos', 'messages', 'outbox', 'quote_history', 'favorites'];

let dbp = null;
export function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await openDb();
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

export const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => wrap(s.get(key))),
  all: (store) => tx(store, 'readonly', (s) => wrap(s.getAll())),
  put: (store, value, key) => tx(store, 'readwrite', (s) => wrap(key === undefined ? s.put(value) : s.put(value, key))),
  putMany: (store, values) => tx(store, 'readwrite', (s) => Promise.all(values.map((v) => wrap(s.put(v))))),
  del: (store, key) => tx(store, 'readwrite', (s) => wrap(s.delete(key))),
  clear: (store) => tx(store, 'readwrite', (s) => wrap(s.clear())),
  /** Replace the full contents of a store with a fresh server snapshot. */
  replaceAll: (store, values) => tx(store, 'readwrite', async (s) => { await wrap(s.clear()); await Promise.all(values.map((v) => wrap(s.put(v)))); }),
};

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
