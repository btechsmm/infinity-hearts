import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
export const ROOT_FILES = ['index.html', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'sw.js'];
export const DIRS = ['src', 'assets'];

export function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    statSync(p).isDirectory() ? out.push(...walk(p)) : out.push(p);
  }
  return out;
}

export const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

/** Public URLs of everything the service worker should precache. */
export function shellFiles() {
  const urls = ['/', '/config.js'];
  for (const f of ROOT_FILES) if (f !== 'sw.js') urls.push('/' + f);
  for (const d of DIRS) for (const f of walk(join(ROOT, d))) urls.push('/' + relative(ROOT, f).split(sep).join('/'));
  return [...new Set(urls)];
}

export function configJs(env = process.env) {
  const cfg = { SUPABASE_URL: env.SUPABASE_URL || '', SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY || '', VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY || '' };
  // No escape sequences and no comment line: the output cannot be turned into a comment or a syntax error.
  return 'window.IH_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';' + String.fromCharCode(10);
}

export function injectSw(source, buildVersion, list) {
  return source.replace('__BUILD_VERSION__', buildVersion).replace('__PRECACHE_LIST__', JSON.stringify(list, null, 1));
}

export function versionHash(files, extra = '') {
  const h = createHash('sha256').update(extra);
  for (const f of files) if (existsSync(f)) h.update(readFileSync(f));
  return h.digest('hex').slice(0, 12);
}

/** Every JS module the app needs at start-up (static imports from main.js) plus the screens, so the browser fetches them all in
 *  parallel instead of discovering them one level at a time (a slow chain on phones). */
export function modulePreloads() {
  const seen = new Set(); const queue = ['/src/js/main.js'];
  const viewDir = join(ROOT, 'src/js/views');
  if (existsSync(viewDir)) for (const f of readdirSync(viewDir)) if (f.endsWith('.js')) queue.push('/src/js/views/' + f);
  while (queue.length) {
    const url = queue.shift(); if (seen.has(url)) continue; seen.add(url);
    const file = join(ROOT, url); if (!existsSync(file)) continue;
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"\n]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g)) {
      const rel = m[1] || m[2];
      const next = '/' + relative(ROOT, join(dirname(file), rel)).split(sep).join('/');
      if (!seen.has(next)) queue.push(next);
    }
  }
  return [...seen].filter((u) => existsSync(join(ROOT, u)));
}
export function injectPreloads(html) {
  const tags = modulePreloads().map((u) => `  <link rel="modulepreload" href="${u}">`).join('\n');
  return html.replace('</head>', tags + '\n</head>');
}
