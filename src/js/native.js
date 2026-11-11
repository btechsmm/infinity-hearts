// Edge Function: send-notifications  (plain JavaScript, valid in Deno / Supabase Edge Runtime)
// Called every 15 minutes by pg_cron (header x-cron-secret) and, for a real server-side test, by a signed-in user ({ test: true }).
// Secrets live ONLY in function environment variables (supabase secrets set ...). Nothing secret is in the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { planNotifications } from '../_shared/plan.js';
import { parseServiceAccount, sendFcm, CHAT_CHANNEL, DAILY_CHANNEL } from '../_shared/fcm.js';

const env = (k) => Deno.env.get(k) || '';
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

const fcmAccount = parseServiceAccount(env('FCM_SERVICE_ACCOUNT'));   // optional: only needed for the Android app
const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

function cfgFrom(r) {
  return {
    departureAt: r.departure_at, expectedReturnAt: r.expected_return_at, actualReunionAt: r.actual_reunion_at,
    homeTimezone: r.home_timezone, destinationTimezone: r.destination_timezone,
    dailyNotificationEnabled: r.daily_notification_enabled, defaultNotificationTime: String(r.default_notification_time).slice(0, 5),
    customRules: r.custom_milestone_rules || [],
  };
}

async function pushTo(subs, payload) {
  let sent = 0;
  for (const s of subs) {
    try {
      if (s.platform === 'android') {          // the Android app: Firebase push
        if (!fcmAccount) continue;
        const r = await sendFcm(fcmAccount, s.subscription_data?.fcm, { title: payload.title, body: payload.body, url: payload.url || '/#/home', tag: (payload.tag || 'ih').slice(0, 60), channelId: payload.tag === 'ih-test' ? CHAT_CHANNEL : DAILY_CHANNEL, kind: 'daily' });
        if (r.gone) await admin.from('notification_subscriptions').delete().eq('id', s.id); else if (r.ok) sent++; else console.error('fcm failed', r.status, r.code);
        continue;
      }
      await webpush.sendNotification(s.subscription_data, JSON.stringify(payload), { TTL: 6 * 3600, urgency: 'normal', topic: (payload.tag || 'ih').slice(0, 32) });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await admin.from('notification_subscriptions').delete().eq('id', s.id);   // expired subscription
      else console.error('push failed', e.statusCode, e.body);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => ({}));

  // ---- real test push for the signed-in caller
  const auth = req.headers.get('Authorization');
  if (body.test && auth) {
    const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: 'Not signed in' }, 401);
    const { data: subs } = await admin.from('notification_subscriptions').select('*').eq('user_id', user.id).eq('enabled', true);
    const sent = await pushTo(subs || [], { title: 'Infinity Hearts', body: 'This is a real test message sent from the server. It works.', tag: 'ih-test', url: '/#/settings' });
    return json({ sent, subscriptions: subs?.length || 0 });
  }

  // ---- scheduled run
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403);
  const now = new Date();
  const [{ data: settings }, { data: members }, { data: profiles }, { data: prefs }, { data: subs }, { data: events }, { data: quotes }] = await Promise.all([
    admin.from('couple_settings').select('*'),
    admin.from('couple_members').select('*'),
    admin.from('profiles').select('id,display_name'),
    admin.from('notification_preferences').select('*'),
    admin.from('notification_subscriptions').select('*').eq('enabled', true),
    admin.from('special_dates').select('*'),
    admin.from('quotes').select('id,couple_id,frequency,audience,message,is_active').eq('is_active', true),
  ]);

  const summary = { sent: 0, claimed: 0, users: 0 };
  for (const s of settings || []) {
    const cfg = cfgFrom(s);
    for (const m of (members || []).filter((x) => x.couple_id === s.couple_id)) {
      summary.users++;
      const name = (profiles || []).find((p) => p.id === m.user_id)?.display_name || (m.partner_role === 'faith' ? 'Faith' : 'Becam');
      const plan = planNotifications({
        now, cfg, member: { role: m.partner_role, name },
        prefs: (prefs || []).find((p) => p.user_id === m.user_id) || null,
        quotes: (quotes || []).filter((q) => !q.couple_id || q.couple_id === s.couple_id),
        events: (events || []).filter((e) => e.couple_id === s.couple_id),
      });
      for (const n of plan) {
        // Claim the key first. A unique (user, kind, key) row makes reruns and overlapping runs harmless.
        const { error: claimErr } = await admin.from('notification_log').insert({ user_id: m.user_id, kind: n.kind, dedupe_key: n.key });
        if (claimErr) continue;                                        // already sent (unique violation) or transient error
        summary.claimed++;
        if (n.milestone) {
          const { id: _i, key: _k, significant: _s, ...row } = n.milestone;
          await admin.from('milestones').upsert({ ...row, couple_id: s.couple_id }, { onConflict: 'couple_id,milestone_date', ignoreDuplicates: true });
        }
        const mine = (subs || []).filter((x) => x.user_id === m.user_id);
        const sent = await pushTo(mine, { title: n.title, body: n.body, url: n.url, tag: n.key });
        summary.sent += sent;
        await admin.from('notification_log').update({ status: sent ? 'sent' : 'no_subscription' }).eq('user_id', m.user_id).eq('kind', n.kind).eq('dedupe_key', n.key);
      }
    }
  }
  return json(summary);
});