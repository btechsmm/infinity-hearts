// Edge Function: notify-message. Called by the database trigger for every new chat message (header x-cron-secret).
// Sends a Web Push to the RECIPIENT's devices so a notification appears even when the app is closed.
// The push carries a signed "ack" so the phone can report back that it received it (that is what makes the grey double tick).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { buildMessagePush } from '../_shared/messagePush.js';

const env = (k) => Deno.env.get(k) || '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403);
  const { message_id } = await req.json().catch(() => ({}));
  if (!message_id) return json({ error: 'message_id required' }, 400);

  const { data: m } = await admin.from('messages').select('*').eq('id', message_id).maybeSingle();
  if (!m || m.deleted_at) return json({ sent: 0, reason: 'gone' });
  const [{ data: sender }, { data: prefs }, { data: subs }] = await Promise.all([
    admin.from('profiles').select('display_name').eq('id', m.sender_id).maybeSingle(),
    admin.from('notification_preferences').select('partner_nickname').eq('user_id', m.recipient_id).maybeSingle(),
    admin.from('notification_subscriptions').select('*').eq('user_id', m.recipient_id).eq('enabled', true),
  ]);
  const payload = await buildMessagePush({ message: m, senderName: sender?.display_name, nickname: prefs?.partner_nickname, projectUrl: env('SUPABASE_URL'), secret: env('CRON_SECRET') });

  let sent = 0;
  for (const s of subs || []) {
    try {
      // TTL 1 day: a phone that was off still gets it when it comes back. urgency high wakes the device promptly.
      await webpush.sendNotification(s.subscription_data, JSON.stringify(payload), { TTL: 24 * 3600, urgency: 'high', topic: 'ih-chat' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('notification_subscriptions').delete().eq('id', s.id);
      else console.error('chat push failed', e.statusCode, e.body);
    }
  }
  return json({ sent, subscriptions: subs?.length || 0 });
});
