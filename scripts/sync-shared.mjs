// Copies the pure engine modules into the Edge Function folder so server and client always use identical logic.
// Run after editing src/js/core/*.js (tests fail if the copies drift).   node scripts/sync-shared.mjs
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib.mjs';

const from = join(ROOT, 'src/js/core');
const to = join(ROOT, 'supabase/functions/_shared');
mkdirSync(to, { recursive: true });
for (const f of readdirSync(from)) if (f.endsWith('.js')) cpSync(join(from, f), join(to, f));
console.log('Synced core modules to supabase/functions/_shared');
