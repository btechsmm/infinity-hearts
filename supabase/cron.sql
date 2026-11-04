-- Scheduler for server-side notifications. Run ONCE in the Supabase SQL editor AFTER deploying the Edge Function.
-- Replace the two placeholders. They are stored in Supabase Vault, never in this repository.
--   <PROJECT_URL>  e.g. https://abcdefghijkl.supabase.co
--   <CRON_SECRET>  a long random string; set the SAME value with:  supabase secrets set CRON_SECRET=<CRON_SECRET>

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<PROJECT_URL>', 'https://utjjzdupdvhyukmsyfbb.supabase.co');
select vault.create_secret('<CRON_SECRET>', 'ih_cron_secret');

-- Every 15 minutes. The function only sends to a user while their local clock is inside their chosen morning window,
-- and the notification_log unique key prevents duplicates, so overlapping or repeated runs are safe.
select cron.schedule(
  'infinity-hearts-notify',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'ih_project_url') || '/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ih_cron_secret')),
    body    := '{}'::jsonb
  );
  $$
);

-- To stop:   select cron.unschedule('infinity-hearts-notify');
