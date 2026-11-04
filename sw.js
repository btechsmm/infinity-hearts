/* Infinity Hearts service worker.
 * - App shell is precached (cache-first) so the app starts with no connection.
 * - CDN libraries and map tiles are cached as they are used (stale-while-revalidate / cache-first with a cap).
 * - Supabase API, auth and storage responses are NEVER cached here: private data lives only in the app's IndexedDB,
 *   which is cleared on sign-out. Nothing authenticated is placed in Cache Storage.
 * - Handles Web Push display and notification clicks.
 */
const VERSION = '__BUILD_VERSION__';
const SHELL = `ih-shell-${VERSION}`;
const RUNTIME = 'ih-runtime-v1';
const TILES = 'ih-tiles-v1';
const PRECACHE = __PRECACHE_LIST__;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ih-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'CLEAR_DATA_CACHES') e.waitUntil(Promise.all([caches.delete(TILES)]));
});

const isSupabase = (u) => /\.supabase\.(co|in)$/.test(u.hostname);
const isTile = (u) => u.hostname.endsWith('tile.openstreetmap.org');
const isLib = (u) => u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'unpkg.com';

async function trim(name, max) {
  const c = await caches.open(name); const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (isSupabase(url)) return;                                   // never intercept private API traffic

  if (req.mode === 'navigate') {                                  // SPA: always serve the cached shell, refresh in background
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      try {
        const res = await fetch(req);
        if (res.ok && url.origin === location.origin) cache.put('/index.html', res.clone());
        return res;
      } catch { return (await cache.match('/index.html')) || (await cache.match('/offline.html')) || Response.error(); }
    })());
    return;
  }

  if (isTile(url)) {                                              // tiles: cache what the couple has viewed (capped)
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') { c.put(req, res.clone()); trim(TILES, 300); } return res; }
      catch { return hit || Response.error(); }
    })());
    return;
  }

  if (isLib(url)) {                                               // pinned library files: stale-while-revalidate
    e.respondWith((async () => {
      const c = await caches.open(RUNTIME); const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  if (url.origin === location.origin) {                           // same-origin assets: cache first, then network
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && /\.(js|css|svg|png|json|webmanifest|ico)$/.test(url.pathname)) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch { return Response.error(); }
    })());
  }
});

// ---------------------------------------------------------------- Web Push
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  const title = data.title || 'Infinity Hearts';
  e.waitUntil(self.registration.showNotification(title, {
    body: data.body || 'Good morning, my love.',
    icon: '/assets/icons/icon-192.png',
    badge: '/assets/icons/favicon-48.png',
    tag: data.tag || 'infinity-hearts',            // same tag replaces, so duplicates collapse into one
    renotify: false,
    data: { url: data.url || '/#/home' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/#/home';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { await c.focus(); if ('navigate' in c) try { await c.navigate(target); } catch { /* ignore */ } return; } }
    await self.clients.openWindow(target);
  })());
});
