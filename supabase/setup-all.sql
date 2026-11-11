-- INFINITY HEARTS: one-paste setup for the Supabase SQL editor.
-- Step 1 of 2: schema, security rules, private photo bucket, quotes. Run this whole file once.
-- Step 2 is the provision_couple line at the very bottom: edit the two emails, then run it.

-- Infinity Hearts: Becam & Faith
-- Full schema, couple-membership security, RLS, storage policies.
-- Contains NO secrets. Apply with `supabase db push` (see README).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- ---------------------------------------------------------------
-- Couple + membership. Access is decided here, server-side, never by a browser variable.
-- ---------------------------------------------------------------
create table public.couples (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Owner pre-registers exactly two emails (see provision_couple below).
create table public.couple_invites (
  email text primary key check (email = lower(email)),
  couple_id uuid not null references public.couples(id) on delete cascade,
  partner_role text not null check (partner_role in ('becam','faith')),
  claimed_by uuid,
  created_at timestamptz not null default now(),
  unique (couple_id, partner_role)
);

create table public.couple_members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  partner_role text not null check (partner_role in ('becam','faith')),
  created_at timestamptz not null default now(),
  primary key (couple_id, user_id),
  unique (couple_id, partner_role),
  unique (user_id) -- one couple per account
);

create or replace function public.is_couple_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.couple_members m where m.couple_id = cid and m.user_id = auth.uid());
$$;

create or replace function public.my_couple_id() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid() limit 1;
$$;

-- ---------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  partner_role text not null check (partner_role in ('becam','faith')),
  timezone text not null default 'Africa/Nairobi',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- couple_settings
-- ---------------------------------------------------------------
create table public.couple_settings (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null unique references public.couples(id) on delete cascade,
  couple_name text not null default 'Becam & Faith',
  departure_at timestamptz not null default '2026-10-19T21:00:00Z',        -- 20 Oct 2026 00:00 Africa/Nairobi (documented default)
  expected_return_at timestamptz not null default '2028-10-19T21:00:00Z',  -- 20 Oct 2028 00:00 Africa/Nairobi (documented default)
  actual_reunion_at timestamptz,
  anniversary_month smallint not null default 9 check (anniversary_month between 1 and 12),
  anniversary_day smallint not null default 8 check (anniversary_day between 1 and 31),
  home_city text not null default 'Nairobi, Kenya',
  destination_city text not null default 'Manama, Bahrain',
  home_lat double precision not null default -1.2921,
  home_lon double precision not null default 36.8219,
  destination_lat double precision not null default 26.2235,
  destination_lon double precision not null default 50.5876,
  home_timezone text not null default 'Africa/Nairobi',
  destination_timezone text not null default 'Asia/Bahrain',
  daily_notification_enabled boolean not null default true,
  default_notification_time time not null default '08:00',
  custom_milestone_rules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_return_at > departure_at),
  check (actual_reunion_at is null or actual_reunion_at >= departure_at)
);
create trigger trg_settings_updated before update on public.couple_settings for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- couple_photos (files live in the PRIVATE bucket `couple-photos`)
-- ---------------------------------------------------------------
create table public.couple_photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  storage_path text not null unique,
  caption text,
  memory_date date,
  is_active boolean not null default true,
  display_order integer not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index couple_photos_couple_idx on public.couple_photos (couple_id, is_active, display_order);

-- ---------------------------------------------------------------
-- quotes (couple_id null = shared library shipped with the app)
-- ---------------------------------------------------------------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references public.couples(id) on delete cascade,
  title text,
  message text not null,
  category text not null check (category in (
    'daily_love','weekly_motivation','monthly_reflection','long_distance','missing_you',
    'patience_trust','encouragement','reunion_countdown','anniversary','special_occasions')),
  frequency text not null check (frequency in ('daily','weekly','monthly','any')),
  audience text not null default 'general' check (audience in ('becam','faith','shared','general')), -- who reads it
  language text not null default 'en',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index quotes_unique_message on public.quotes (coalesce(couple_id, '00000000-0000-0000-0000-000000000000'::uuid), message);
create index quotes_pick_idx on public.quotes (frequency, is_active);

create table public.quote_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, quote_id)
);

create table public.daily_quote_history (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  display_date date not null,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (recipient_id, display_date, quote_id)
);
create index dqh_recipient_idx on public.daily_quote_history (recipient_id, display_date desc);

-- ---------------------------------------------------------------
-- milestones: only stored when a real milestone occurs (one primary per couple per day)
-- ---------------------------------------------------------------
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  milestone_type text not null,
  title text not null,
  message text not null,
  milestone_date date not null,
  elapsed_days integer not null check (elapsed_days >= 0),
  remaining_days integer not null check (remaining_days >= 0),
  created_at timestamptz not null default now(),
  unique (couple_id, milestone_date)
);
create index milestones_couple_date_idx on public.milestones (couple_id, milestone_date desc);

create table public.milestone_deliveries (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.milestones(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  delivery_channel text not null check (delivery_channel in ('in_app','web_push','local')),
  delivery_status text not null default 'pending' check (delivery_status in ('pending','sent','delivered','failed','skipped')),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (milestone_id, recipient_id, delivery_channel)
);

-- ---------------------------------------------------------------
-- special_dates
-- ---------------------------------------------------------------
create table public.special_dates (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  slug text,                                  -- stable key for built-in events
  title text not null,
  event_date date not null,
  recurrence_type text not null default 'yearly' check (recurrence_type in ('yearly','none')),
  reminder_settings jsonb not null default '{"daysBefore":[7,3,1,0]}'::jsonb,
  message text,
  photo_path text,
  is_builtin boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, slug)
);
create trigger trg_special_updated before update on public.special_dates for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- messages (private; client_id makes offline retries idempotent)
-- ---------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  client_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text','quote','milestone','encouragement','missing_you')),
  content text not null check (char_length(content) between 1 and 2000),
  quote_id uuid references public.quotes(id) on delete set null,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  deleted_at timestamptz,
  unique (sender_id, client_id),
  check (sender_id <> recipient_id)
);
create index messages_thread_idx on public.messages (couple_id, sent_at desc);
create index messages_unread_idx on public.messages (recipient_id) where read_at is null and deleted_at is null;

-- Recipients may only mark read; senders may only soft-delete their own message. Nothing else is editable.
create or replace function public.messages_guard_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id <> old.id or new.couple_id <> old.couple_id or new.client_id <> old.client_id
     or new.sender_id <> old.sender_id or new.recipient_id <> old.recipient_id
     or new.content <> old.content or new.message_type <> old.message_type
     or new.quote_id is distinct from old.quote_id or new.sent_at <> old.sent_at then
    raise exception 'Messages cannot be edited';
  end if;
  if new.read_at is distinct from old.read_at and auth.uid() <> old.recipient_id then
    raise exception 'Only the recipient can mark a message read';
  end if;
  if new.deleted_at is distinct from old.deleted_at and auth.uid() <> old.sender_id then
    raise exception 'Only the sender can delete a message';
  end if;
  return new;
end $$;
create trigger trg_messages_guard before update on public.messages for each row execute function public.messages_guard_update();

-- ---------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------
create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'web' check (platform in ('web','android')),
  endpoint text not null,
  subscription_data jsonb not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create trigger trg_subs_updated before update on public.notification_subscriptions for each row execute function public.set_updated_at();

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  daily_enabled boolean not null default true,
  weekly_enabled boolean not null default true,
  monthly_enabled boolean not null default true,
  milestone_enabled boolean not null default true,
  special_dates_enabled boolean not null default true,
  preferred_time time not null default '08:00',
  timezone text not null default 'Africa/Nairobi',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_prefs_updated before update on public.notification_preferences for each row execute function public.set_updated_at();

-- Scheduler dedupe: one row per (user, kind, key). Written only by the Edge Function (service role).
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  dedupe_key text not null,
  status text not null default 'sent',
  created_at timestamptz not null default now(),
  unique (user_id, kind, dedupe_key)
);

-- ---------------------------------------------------------------
-- New user -> profile + membership, ONLY if the email was pre-registered by the owner.
-- Any other sign-up gets no profile and no access.
-- ---------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.couple_invites%rowtype;
begin
  select * into inv from public.couple_invites where email = lower(new.email) and claimed_by is null;
  if not found then return new; end if;
  insert into public.profiles (id, display_name, partner_role, timezone)
  values (new.id, initcap(inv.partner_role), inv.partner_role,
          case inv.partner_role when 'becam' then 'Africa/Nairobi' else 'Asia/Bahrain' end);
  insert into public.couple_members (couple_id, user_id, partner_role) values (inv.couple_id, new.id, inv.partner_role);
  insert into public.notification_preferences (user_id, timezone)
  values (new.id, case inv.partner_role when 'becam' then 'Africa/Nairobi' else 'Asia/Bahrain' end);
  update public.couple_invites set claimed_by = new.id where email = inv.email;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Owner-only provisioning. Run once in the SQL editor (postgres role). Not callable from the browser.
create or replace function public.provision_couple(becam_email text, faith_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if lower(becam_email) = lower(faith_email) then raise exception 'Emails must differ'; end if;
  insert into public.couples default values returning id into cid;
  insert into public.couple_invites (email, couple_id, partner_role) values (lower(becam_email), cid, 'becam'), (lower(faith_email), cid, 'faith');
  insert into public.couple_settings (couple_id) values (cid);
  insert into public.special_dates (couple_id, slug, title, event_date, recurrence_type, message, is_builtin) values
    (cid,'anniversary','Our Anniversary','2000-09-08','yearly','Another year of us. Distance has not changed a thing.',true),
    (cid,'valentines','Valentine''s Day','2000-02-14','yearly','Across the miles, you are my Valentine.',true),
    (cid,'christmas','Christmas Day','2000-12-25','yearly','Merry Christmas, my love. Next time, together.',true),
    (cid,'nye','New Year''s Eve','2000-12-31','yearly','One more year closer to each other.',true),
    (cid,'nyd','New Year''s Day','2000-01-01','yearly','A new year, a smaller distance.',true),
    (cid,'return','Faith''s Expected Return','2028-10-20','none','The day we have been counting down to.',true);
  -- If either account already exists (created before provisioning), attach it now.
  insert into public.profiles (id, display_name, partner_role, timezone)
    select u.id, initcap(i.partner_role), i.partner_role, case i.partner_role when 'becam' then 'Africa/Nairobi' else 'Asia/Bahrain' end
    from auth.users u join public.couple_invites i on i.email = lower(u.email) and i.couple_id = cid on conflict do nothing;
  insert into public.couple_members (couple_id, user_id, partner_role)
    select cid, u.id, i.partner_role from auth.users u join public.couple_invites i on i.email = lower(u.email) and i.couple_id = cid on conflict do nothing;
  insert into public.notification_preferences (user_id, timezone)
    select u.id, case i.partner_role when 'becam' then 'Africa/Nairobi' else 'Asia/Bahrain' end
    from auth.users u join public.couple_invites i on i.email = lower(u.email) and i.couple_id = cid on conflict do nothing;
  update public.couple_invites i set claimed_by = u.id from auth.users u where i.email = lower(u.email) and i.couple_id = cid;
  return cid;
end $$;
revoke all on function public.provision_couple(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------
alter table public.couples enable row level security;
alter table public.couple_invites enable row level security;         -- no policies: service role / owner only
alter table public.couple_members enable row level security;
alter table public.profiles enable row level security;
alter table public.couple_settings enable row level security;
alter table public.couple_photos enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_favorites enable row level security;
alter table public.daily_quote_history enable row level security;
alter table public.milestones enable row level security;
alter table public.milestone_deliveries enable row level security;
alter table public.special_dates enable row level security;
alter table public.messages enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_log enable row level security;       -- no policies: service role only

create policy couples_read on public.couples for select to authenticated using (public.is_couple_member(id));
create policy members_read on public.couple_members for select to authenticated using (public.is_couple_member(couple_id));

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or exists (select 1 from public.couple_members a join public.couple_members b on a.couple_id = b.couple_id
                                    where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy settings_read on public.couple_settings for select to authenticated using (public.is_couple_member(couple_id));
create policy settings_update on public.couple_settings for update to authenticated
  using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));

create policy photos_read on public.couple_photos for select to authenticated using (public.is_couple_member(couple_id));
create policy photos_insert on public.couple_photos for insert to authenticated
  with check (public.is_couple_member(couple_id) and uploaded_by = auth.uid());
create policy photos_update on public.couple_photos for update to authenticated
  using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
create policy photos_delete on public.couple_photos for delete to authenticated using (public.is_couple_member(couple_id));

create policy quotes_read on public.quotes for select to authenticated
  using (couple_id is null or public.is_couple_member(couple_id));
create policy quotes_insert_own on public.quotes for insert to authenticated
  with check (couple_id is not null and public.is_couple_member(couple_id));
create policy quotes_update_own on public.quotes for update to authenticated
  using (couple_id is not null and public.is_couple_member(couple_id)) with check (couple_id is not null and public.is_couple_member(couple_id));
create policy quotes_delete_own on public.quotes for delete to authenticated
  using (couple_id is not null and public.is_couple_member(couple_id));

create policy favs_all on public.quote_favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dqh_all on public.daily_quote_history for all to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy milestones_read on public.milestones for select to authenticated using (public.is_couple_member(couple_id));
create policy milestones_insert on public.milestones for insert to authenticated with check (public.is_couple_member(couple_id));

create policy deliveries_read on public.milestone_deliveries for select to authenticated using (recipient_id = auth.uid());
create policy deliveries_insert on public.milestone_deliveries for insert to authenticated with check (recipient_id = auth.uid());
create policy deliveries_update on public.milestone_deliveries for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

create policy special_read on public.special_dates for select to authenticated using (public.is_couple_member(couple_id));
create policy special_insert on public.special_dates for insert to authenticated
  with check (public.is_couple_member(couple_id) and is_builtin = false);
create policy special_update on public.special_dates for update to authenticated
  using (public.is_couple_member(couple_id)) with check (public.is_couple_member(couple_id));
create policy special_delete on public.special_dates for delete to authenticated
  using (public.is_couple_member(couple_id) and is_builtin = false);

-- Messages: only the two members, only between each other.
create policy messages_read on public.messages for select to authenticated
  using (public.is_couple_member(couple_id) and (sender_id = auth.uid() or recipient_id = auth.uid()));
create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_couple_member(couple_id)
    and exists (select 1 from public.couple_members m where m.couple_id = messages.couple_id and m.user_id = messages.recipient_id)
  );
create policy messages_update on public.messages for update to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid())
  with check (sender_id = auth.uid() or recipient_id = auth.uid());
-- No DELETE policy: removal is a soft delete (deleted_at) by the sender, enforced by the trigger above.

create policy subs_all on public.notification_subscriptions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy prefs_all on public.notification_preferences for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Table privileges: nothing for anon.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.couples, public.couple_members, public.couple_invites, public.notification_log from authenticated;
revoke all on public.couple_invites, public.notification_log from authenticated;

-- Column-level limits: identity and ownership fields are not user-editable.
revoke update on public.profiles from authenticated;
grant update (display_name, timezone, avatar_url) on public.profiles to authenticated;
revoke update on public.special_dates from authenticated;
grant update (title, event_date, recurrence_type, reminder_settings, message, photo_path) on public.special_dates to authenticated;
revoke update on public.couple_settings from authenticated;
grant update (couple_name, departure_at, expected_return_at, actual_reunion_at, anniversary_month, anniversary_day,
              home_city, destination_city, home_lat, home_lon, destination_lat, destination_lon,
              home_timezone, destination_timezone, daily_notification_enabled, default_notification_time,
              custom_milestone_rules) on public.couple_settings to authenticated;

-- ---------------------------------------------------------------
-- Realtime (RLS still applies to what each subscriber receives)
-- ---------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.couple_settings;
alter publication supabase_realtime add table public.milestones;

-- ---------------------------------------------------------------
-- Storage: PRIVATE bucket. Objects live under "<couple_id>/<file>". Served via short-lived signed URLs.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('couple-photos', 'couple-photos', false, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

create policy photos_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'couple-photos' and public.is_couple_member(((storage.foldername(name))[1])::uuid));
create policy photos_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'couple-photos' and public.is_couple_member(((storage.foldername(name))[1])::uuid));
create policy photos_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'couple-photos' and public.is_couple_member(((storage.foldername(name))[1])::uuid));
create policy photos_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'couple-photos' and public.is_couple_member(((storage.foldername(name))[1])::uuid));

-- ---------------- quote library ----------------
insert into public.quotes (couple_id, category, frequency, audience, message) values
  (null, 'daily_love', 'daily', 'general', 'Distance has changed our routine, but it has not changed what you mean to me.'),
  (null, 'daily_love', 'daily', 'general', 'Another day has passed. We are one day closer to the moment we can hold each other again.'),
  (null, 'daily_love', 'daily', 'general', 'One more day completed. One less day to wait.'),
  (null, 'daily_love', 'daily', 'faith', 'Faith, even on the difficult days, remember that this distance is part of our journey, not the end of our story.'),
  (null, 'daily_love', 'daily', 'faith', 'Every sunrise in Nairobi reminds me that somewhere in Bahrain, you are also looking toward a future we are building together.'),
  (null, 'daily_love', 'daily', 'becam', 'Becam, I woke up thinking of you again. Some habits are too good to break.'),
  (null, 'daily_love', 'daily', 'becam', 'Whatever your day looks like, know that someone far away is cheering for you quietly and loudly at the same time.'),
  (null, 'daily_love', 'daily', 'faith', 'I do not need the whole map to know where home is. It is wherever you are.'),
  (null, 'daily_love', 'daily', 'shared', 'We are not waiting for our life to begin. We are building it, one ordinary day at a time.'),
  (null, 'daily_love', 'daily', 'general', 'Love does not shrink with the miles. It just learns to travel.'),
  (null, 'daily_love', 'daily', 'faith', 'Today I am grateful for you. Not for anything you did, just for the fact of you.'),
  (null, 'daily_love', 'daily', 'becam', 'Thank you for being patient with me, for believing in us, and for loving me from so far away.'),
  (null, 'daily_love', 'daily', 'general', 'Two time zones, two skies, one heart that keeps finding its way back.'),
  (null, 'daily_love', 'daily', 'shared', 'Good morning. Whatever happens today, we are still us.'),
  (null, 'missing_you', 'daily', 'general', 'Missing you is the quiet proof of how much you matter.'),
  (null, 'missing_you', 'daily', 'faith', 'I miss your laugh most in the small moments, when something funny happens and you are not there to hear about it.'),
  (null, 'missing_you', 'daily', 'becam', 'If missing me feels heavy today, let it be a reminder that what we have is real.'),
  (null, 'missing_you', 'daily', 'general', 'Some nights the phone feels too small to hold everything I want to say to you.'),
  (null, 'missing_you', 'daily', 'shared', 'I miss you. That is the whole message. Everything else is just details.'),
  (null, 'missing_you', 'daily', 'faith', 'I keep saving little things to tell you. By the time we meet I will have a lifetime of stories.'),
  (null, 'long_distance', 'daily', 'general', 'Long distance is not a sign that something is missing. It is proof that something is strong enough to wait.'),
  (null, 'long_distance', 'daily', 'general', 'We measure distance in kilometres, but we measure love in days that we choose each other again.'),
  (null, 'long_distance', 'daily', 'shared', 'Different cities, same sky, same promise.'),
  (null, 'long_distance', 'daily', 'general', 'Every call, every message, every little good morning is another brick in the bridge we are building.'),
  (null, 'long_distance', 'daily', 'faith', 'Being apart taught me how much I notice you, even when you are not in the room.'),
  (null, 'patience_trust', 'daily', 'general', 'Some journeys test patience. Ours is teaching us how strong love can be.'),
  (null, 'patience_trust', 'daily', 'shared', 'Trust is built in the days when nobody is watching. We are getting very good at it.'),
  (null, 'patience_trust', 'daily', 'general', 'Patience is not just waiting. It is loving someone well while you wait.'),
  (null, 'patience_trust', 'daily', 'faith', 'You do not have to be strong every day. You only have to keep going, and I will keep going with you.'),
  (null, 'encouragement', 'daily', 'becam', 'Becam, you are doing better than you think. Keep going, and take care of yourself today.'),
  (null, 'encouragement', 'daily', 'faith', 'Faith, you are braver than you feel. I am proud of you every single day.'),
  (null, 'encouragement', 'daily', 'general', 'Hard days still count as progress. You showed up, and that matters.'),
  (null, 'encouragement', 'daily', 'general', 'Drink some water, take a breath, and remember that you are loved from a long way away.'),
  (null, 'reunion_countdown', 'daily', 'general', 'Every second brings us closer to the day we meet again.'),
  (null, 'reunion_countdown', 'daily', 'shared', 'One day I will look back at this countdown and smile, because it ended in your arms.'),
  (null, 'reunion_countdown', 'daily', 'general', 'The calendar is on our side. Each page turned is one step nearer.'),
  (null, 'reunion_countdown', 'daily', 'faith', 'I already know what I will say when I see you. I have rehearsed it for months, and I will probably forget it all.'),
  (null, 'daily_love', 'daily', 'general', 'You are my favourite hello, even through a screen.'),
  (null, 'daily_love', 'daily', 'shared', 'Love is a decision we keep making, and we make it gladly.'),
  (null, 'daily_love', 'daily', 'general', 'Not every love story gets a straight road. Ours has a bend in it, and a long way home.'),
  (null, 'weekly_motivation', 'weekly', 'general', 'This week, be gentle with the waiting. Distance cannot erase the memories we are building.'),
  (null, 'weekly_motivation', 'weekly', 'shared', 'Another week behind us. Look at how far we have already come together.'),
  (null, 'weekly_motivation', 'weekly', 'faith', 'Faith, this week, remember that every small thing you do today is part of the life we will share.'),
  (null, 'weekly_motivation', 'weekly', 'becam', 'Becam, this week, put your energy into what you can control, and trust the rest to time and to us.'),
  (null, 'weekly_motivation', 'weekly', 'general', 'A week is just seven chances to show up for each other. Make a few of them count.'),
  (null, 'weekly_motivation', 'weekly', 'shared', 'Plan something small to look forward to this week. A call, a song, a shared photo. Joy is built in pieces.'),
  (null, 'weekly_motivation', 'weekly', 'general', 'If this week felt long, remember that the weeks add up, and so does the love.'),
  (null, 'weekly_motivation', 'weekly', 'shared', 'Write down one thing you are proud of this week, and one thing you are looking forward to. Then tell each other.'),
  (null, 'weekly_motivation', 'weekly', 'general', 'Progress is quiet. It looks like another ordinary week that brought us nearer to the reunion.'),
  (null, 'weekly_motivation', 'weekly', 'shared', 'This week, send something unexpected: a voice note, a photo of your day, a silly memory.'),
  (null, 'weekly_motivation', 'weekly', 'general', 'Be kind to yourself this week. Missing someone is a sign of a big heart, not a weak one.'),
  (null, 'weekly_motivation', 'weekly', 'shared', 'One week closer. One week stronger. One week more certain that we are worth the wait.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'A month ago feels like a different chapter. We have grown more patient, more honest, and more sure of each other.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'Distance asks a lot of us: patience, communication, trust. Look at how much we have already given, and how much we have gained.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'This month, think about what you have learned about yourself while we have been apart. That growth will come home with you.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'The future we are working toward is not abstract. It is a table for two, a door that opens, a long hug that does not need to end.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'Commitment is not only the big promises. It is the daily choice to keep caring, keep talking, keep believing.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'Some seasons are for waiting and some for becoming. This one is doing both.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'Take a moment this month to name three things we are building: a habit, a dream, a memory. They will all be waiting for us.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'Love across distance is a slow craft. It is made patiently, by hand, and it lasts.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'When this is over, we will not remember every hard day. We will remember that we chose each other through all of them.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'Look back at where you were a month ago and be a little proud. Time has not been wasted. It has been lived.'),
  (null, 'monthly_reflection', 'monthly', 'shared', 'What do we want our first week together to look like? Dream about it this month, out loud.'),
  (null, 'monthly_reflection', 'monthly', 'general', 'Patience, growth, and love are not separate things. This month they have been the same thing.'),
  (null, 'anniversary', 'any', 'shared', 'Happy anniversary. Every year with you is one I would choose again.'),
  (null, 'anniversary', 'any', 'general', 'Another year of us, and the distance has not won a single argument.'),
  (null, 'anniversary', 'any', 'shared', 'Today I am thinking about where we started and how far our love has travelled since.'),
  (null, 'special_occasions', 'any', 'shared', 'Happy Valentine''s Day across the miles. You are the love I carry everywhere.'),
  (null, 'special_occasions', 'any', 'shared', 'Merry Christmas, my love. Let us make the next one a shared one.'),
  (null, 'special_occasions', 'any', 'shared', 'Happy New Year. May this one carry us closer to each other, one day at a time.'),
  (null, 'special_occasions', 'any', 'shared', 'On the last night of the year, I am grateful for every day we chose each other.'),
  (null, 'special_occasions', 'any', 'shared', 'Happy birthday. I wish I could be there, but my whole heart is.'),
  (null, 'reunion_countdown', 'any', 'shared', 'Today is the day we have been counting down to. Welcome home, my love.')
on conflict do nothing;

-- ---------------- STEP 2: edit both emails, then run just this line ----------------
-- select public.provision_couple('BECAM_EMAIL_HERE', 'FAITH_EMAIL_HERE');
