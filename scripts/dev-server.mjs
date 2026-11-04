// Zero-dependency dev server: node scripts/dev-server.mjs [port]. Serves the project root; SPA fallback; no caching.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { ROOT, MIME, shellFiles, configJs, injectSw } from './lib.mjs';

const port = Number(process.argv[2] || process.env.PORT || 5173);

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let path = normalize(decodeURIComponent(url.pathname));
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  const headers = { 'Cache-Control': 'no-store' };
  if (path === '/config.js' && (process.env.SUPABASE_URL || process.env.DEV_ENV_CONFIG)) { res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'] }).end(configJs()); return; }
  if (path === '/sw.js') { res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'], 'Service-Worker-Allowed': '/' }).end(injectSw(readFileSync(join(ROOT, 'sw.js'), 'utf8'), 'dev-' + Date.now(), shellFiles())); return; }
  let file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = extname(path) ? null : join(ROOT, 'index.html');
  if (!file || !existsSync(file)) { res.writeHead(404, headers).end('Not found'); return; }
  res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }).end(readFileSync(file));
}).listen(port, () => console.log(`Infinity Hearts dev server: http://localhost:${port}`));
