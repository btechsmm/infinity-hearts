// Edge Function: ack-delivery. The phone's service worker calls this the moment a chat push arrives, even if the app is closed.
// No login is possible there, so the request is authenticated by an HMAC token that only notify-message can create for that message.
// Effect: messages.delivered_at is set once (the sender then sees two grey ticks).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyAck } from '../_shared/messagePush.js';

const env = (k) => Deno.env.get(k) || '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...cors } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { id, token } = await req.json().catch(() => ({}));
  if (!(await verifyAck(id, token, env('CRON_SECRET')))) return json({ error: 'Forbidden' }, 403);
  const { error } = await admin.from('messages').update({ delivered_at: new Date().toISOString() }).eq('id', id).is('delivered_at', null);
  return error ? json({ error: 'failed' }, 500) : json({ ok: true });
});
