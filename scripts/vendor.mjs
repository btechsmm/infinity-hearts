// Optional: download Leaflet and supabase-js into /vendor so the app does not depend on a CDN at runtime.
// Run on YOUR machine (needs internet):  node scripts/vendor.mjs
// Then change the three URLs in src/js/config.js to '/vendor/...' and run `node scripts/build.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const files = {
  'supabase-js.js': 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm',
  'leaflet.js': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'leaflet.css': 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
};
const out = join(ROOT, 'vendor');
mkdirSync(out, { recursive: true });
for (const [name, url] of Object.entries(files)) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  writeFileSync(join(out, name), Buffer.from(await res.arrayBuffer()));
  console.log('saved', name);
}
console.log('NOTE: the supabase-js "+esm" bundle imports helper modules from jsDelivr. For a fully self-contained copy, bundle it with esbuild instead.');
