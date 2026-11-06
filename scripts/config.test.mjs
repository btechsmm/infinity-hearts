import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { configJs } from '../scripts/lib.mjs';

test('generated config.js runs as a browser script and defines the settings (not swallowed by a comment)', () => {
  const env = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_test', VAPID_PUBLIC_KEY: '' };
  const src = configJs(env);
  assert.ok(!src.includes('\\n'), 'must not contain a literal backslash-n');
  assert.ok(!src.trimStart().startsWith('//'), 'must not start with a comment');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.window.IH_CONFIG.SUPABASE_URL, env.SUPABASE_URL);
  assert.equal(sandbox.window.IH_CONFIG.SUPABASE_ANON_KEY, env.SUPABASE_ANON_KEY);
});
