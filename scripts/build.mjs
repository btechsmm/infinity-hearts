// Static build: copies the app to dist/, writes config.js from environment variables, stamps the service worker.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... VAPID_PUBLIC_KEY=... node scripts/build.mjs
import { rmSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, ROOT_FILES, DIRS, walk, shellFiles, configJs, injectSw, versionHash } from './lib.mjs';

// Optional local .env (git-ignored) so `node scripts/build.mjs` works without exporting variables by hand.
import { existsSync } from 'node:fs';
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*([^#\s]*)/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

// Fall back to values pasted into the root config.js (public values only).
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  try {
    const raw = readFileSync(join(ROOT, 'config.js'), 'utf8');
    for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VAPID_PUBLIC_KEY']) {
      const m = raw.match(new RegExp(k + "\\s*:\\s*'([^']+)'"));
      if (m && !process.env[k]) process.env[k] = m[1];
    }
  } catch { /* no config.js */ }
}
if (process.env.RENDER && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)) {
  console.error('\nBUILD STOPPED: SUPABASE_URL and SUPABASE_ANON_KEY are not set.\nIn Render: your service -> Environment -> add both, then Manual Deploy -> Clear build cache & deploy.\n');
  process.exit(1);
}

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of ROOT_FILES) cpSync(join(ROOT, f), join(dist, f));
for (const d of DIRS) cpSync(join(ROOT, d), join(dist, d), { recursive: true });

const cfg = configJs();
writeFileSync(join(dist, 'config.js'), cfg);

const files = [...ROOT_FILES.map((f) => join(ROOT, f)), ...DIRS.flatMap((d) => walk(join(ROOT, d)))];
const version = versionHash(files, cfg);
writeFileSync(join(dist, 'sw.js'), injectSw(readFileSync(join(ROOT, 'sw.js'), 'utf8'), version, shellFiles()));

const configured = /SUPABASE_URL": "https?:/.test(cfg);
console.log(`Built dist/ (version ${version}). Supabase configured: ${configured ? 'yes' : 'NO - the app will run in local mode'}.`);
if (!/VAPID_PUBLIC_KEY": "\S/.test(cfg)) console.log('Note: VAPID_PUBLIC_KEY is empty, so push notifications are disabled.');
