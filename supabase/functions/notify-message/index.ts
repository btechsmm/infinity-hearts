// Edge Function: notify-message. Sends a Web Push to the RECIPIENT's devices so a notification appears even when the app is closed.
// Two callers, both safe to run for the same message (push_sent_at lets only the first one send):
//   1. the sender's app, right after the message is saved (fastest; authenticated with the sender's login token)
//   2. the database trigger (backup; authenticated with the x-cron-secret header)
// The push carries a signed "ack" so the phone can report back that it received it (the grey double tick).
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { buildMessagePush, previewText, pushTitle } from '../_shared/messagePush.js';
import { parseServiceAccount, sendFcm, CHAT_CHANNEL } from '../_shared/fcm.js';

const env = (k) => Deno.env.get(k) || '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const fcmAccount = parseServiceAccount(env('FCM_SERVICE_ACCOUNT'));   // optional: only needed for the Android app
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...cors } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { message_id } = await req.json().catch(() => ({}));
  if (!message_id) return json({ error: 'message_id required' }, 400);

  // Who is calling?
  const trusted = !!env('CRON_SECRET') && req.headers.get('x-cron-secret') === env('CRON_SECRET');
  let callerId: string | null = null;
  if (!trusted) {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Forbidden' }, 403);
    const { data } = await admin.auth.getUser(token);
    callerId = data?.user?.id || null;
    if (!callerId) return json({ error: 'Forbidden' }, 403);
  }

  // Claim the message in one step: only the first caller gets the row back, so the push is never sent twice.
  const { data: m } = await admin.from('messages').update({ push_sent_at: new Date().toISOString() })
    .eq('id', message_id).is('push_sent_at', null).is('deleted_at', null).select('*').maybeSingle();
  if (!m) return json({ sent: 0, reason: 'already sent or gone' });
  if (!trusted && m.sender_id !== callerId) return json({ error: 'Forbidden' }, 403);   // only the sender may trigger it

  const [{ data: sender }, { data: prefs }, { data: subs }] = await Promise.all([
    admin.from('profiles').select('display_name').eq('id', m.sender_id).maybeSingle(),
    admin.from('notification_preferences').select('partner_nickname').eq('user_id', m.recipient_id).maybeSingle(),
    admin.from('notification_subscriptions').select('*').eq('user_id', m.recipient_id).eq('enabled', true),
  ]);
  const payload = JSON.stringify(await buildMessagePush({ message: m, senderName: sender?.display_name, nickname: prefs?.partner_nickname, projectUrl: env('SUPABASE_URL'), secret: env('CRON_SECRET') }));

  // All of the recipient's devices at once. TTL 1 day: a phone that was off still gets it later. High urgency wakes the device.
  const results = await Promise.all((subs || []).map(async (s) => {
    if (s.platform === 'android') {          // the Android app: Firebase push
      if (!fcmAccount) return 0;
      try {
        const r = await sendFcm(fcmAccount, s.subscription_data?.fcm, { title: pushTitle(prefs?.partner_nickname, sender?.display_name), body: previewText(m), tag: 'ih-chat', channelId: CHAT_CHANNEL });
        if (r.gone) await admin.from('notification_subscriptions').delete().eq('id', s.id); else if (!r.ok) console.error('fcm failed', r.status, r.code);
        return r.ok ? 1 : 0;
      } catch (e) { console.error('fcm error', String(e)); return 0; }
    }
    try { await webpush.sendNotification(s.subscription_data, payload, { TTL: 24 * 3600, urgency: 'high', topic: 'ih-chat' }); return 1; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('notification_subscriptions').delete().eq('id', s.id);
      else console.error('chat push failed', e.statusCode, e.body);
      return 0;
    }
  }));
  return json({ sent: results.reduce((a, b) => a + b, 0), subscriptions: subs?.length || 0 });
});