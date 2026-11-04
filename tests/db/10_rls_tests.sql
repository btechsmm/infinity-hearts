\set ON_ERROR_STOP on
\set QUIET on

-- ===== provisioning: owner registers two emails, THEN the users sign up =====
do $$ declare cid uuid; begin
  cid := public.provision_couple('becam@example.test', 'faith@example.test');
  insert into t.ids values ('couple', cid);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'becamwilunda15@gmail.com.test'),
  ('00000000-0000-0000-0000-0000000000f1', 'faithlilungya@gmail.com'),
  ('00000000-0000-0000-0000-0000000000e1', 'mallory@example.test');   -- NOT invited
insert into t.ids values ('becam','00000000-0000-0000-0000-0000000000b1'),('faith','00000000-0000-0000-0000-0000000000f1'),('mallory','00000000-0000-0000-0000-0000000000e1');

select t.eq((select count(*) from public.couple_members), 2, 'exactly two members exist');
select t.eq((select count(*) from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'), 0, 'uninvited sign-up gets NO profile');
select t.eq((select count(*) from public.couple_members where user_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'uninvited sign-up gets NO membership');
select t.eq((select count(*) from public.special_dates), 6, 'six default special dates seeded');
select t.eq((select count(*) from public.special_dates where slug='anniversary' and to_char(event_date,'MM-DD')='09-08' and recurrence_type='yearly'), 1, 'anniversary is 8 Sep, yearly');
select t.eq((select count(*) from public.special_dates where slug='return' and recurrence_type='none'), 1, 'reunion date does not repeat');
select t.eq((select count(*) from public.special_dates where to_char(event_date,'MM-DD')='10-20' and recurrence_type='yearly'), 0, 'departure date is not an anniversary');

-- ===== constraints =====
select t.fails($q$update public.couple_settings set expected_return_at = departure_at - interval '1 day'$q$, 'return before departure rejected');
select t.fails($q$insert into public.couple_invites(email,couple_id,partner_role) values ('x@example.test',(select id from t.ids where name='couple'),'becam')$q$, 'third becam seat rejected (unique role)');

-- ===== MALLORY (authenticated stranger) =====
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select t.eq((select count(*) from public.couple_settings), 0, 'stranger cannot read couple settings');
select t.eq((select count(*) from public.messages), 0, 'stranger cannot read messages');
select t.eq((select count(*) from public.special_dates), 0, 'stranger cannot read special dates');
select t.eq((select count(*) from public.couple_photos), 0, 'stranger cannot read photo records');
select t.eq((select count(*) from public.milestones), 0, 'stranger cannot read milestones');
select t.eq((select count(*) from public.profiles), 0, 'stranger cannot read profiles');
select t.fails($q$insert into public.messages(couple_id,client_id,sender_id,recipient_id,content) values ((select id from t.ids where name='couple'), gen_random_uuid(), '00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000f1','hi')$q$, 'stranger cannot message Faith');
select t.fails($q$insert into public.couple_members(couple_id,user_id,partner_role) values ((select id from t.ids where name='couple'),'00000000-0000-0000-0000-0000000000e1','becam')$q$, 'stranger cannot add themselves as a member');
select t.fails($q$select public.provision_couple('a@x.test','b@x.test')$q$, 'stranger cannot call provision_couple');
select t.fails($q$select * from public.couple_invites$q$, 'stranger cannot read invites');
select t.affects($q$update public.couple_settings set couple_name='Hacked'$q$, 0, 'stranger cannot edit settings');
select t.fails($q$insert into storage.objects(bucket_id,name) values ('couple-photos', (select id::text from t.ids where name='couple') || '/evil.jpg')$q$, 'stranger cannot upload to couple photo folder');
reset role;

-- ===== ANON =====
set role anon;
select t.fails($q$select * from public.messages$q$, 'anon has no access to messages');
select t.fails($q$select * from public.couple_settings$q$, 'anon has no access to settings');
reset role;

-- ===== BECAM =====
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select t.eq((select count(*) from public.couple_settings), 1, 'Becam reads couple settings');
select t.eq((select count(*) from public.profiles), 2, 'Becam sees both profiles');
select t.affects($q$insert into public.messages(id,couple_id,client_id,sender_id,recipient_id,content) values ('10000000-0000-0000-0000-000000000001',(select id from t.ids where name='couple'),'20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','I miss you')$q$, 1, 'Becam sends a message to Faith');
select t.fails($q$insert into public.messages(couple_id,client_id,sender_id,recipient_id,content) values ((select id from t.ids where name='couple'),'20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','I miss you')$q$, 'duplicate queued send (same client_id) rejected');
select t.fails($q$insert into public.messages(couple_id,client_id,sender_id,recipient_id,content) values ((select id from t.ids where name='couple'),gen_random_uuid(),'00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000b1','spoofed')$q$, 'cannot send as the other partner');
select t.fails($q$insert into public.messages(couple_id,client_id,sender_id,recipient_id,content) values ((select id from t.ids where name='couple'),gen_random_uuid(),'00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000e1','to stranger')$q$, 'cannot send to a non-member');
select t.fails($q$update public.messages set content='edited' where id='10000000-0000-0000-0000-000000000001'$q$, 'message content cannot be edited');
select t.fails($q$update public.messages set read_at=now() where id='10000000-0000-0000-0000-000000000001'$q$, 'sender cannot mark own message as read');
select t.affects($q$delete from public.messages where id='10000000-0000-0000-0000-000000000001'$q$, 0, 'hard delete is blocked (no DELETE policy)');
select t.affects($q$insert into public.milestones(couple_id,milestone_type,title,message,milestone_date,elapsed_days,remaining_days) values ((select id from t.ids where name='couple'),'every_10','10 days apart','10 days apart. 721 days to go.','2026-10-30',10,721)$q$, 1, 'milestone stored');
select t.fails($q$insert into public.milestones(couple_id,milestone_type,title,message,milestone_date,elapsed_days,remaining_days) values ((select id from t.ids where name='couple'),'daily','dup','dup','2026-10-30',10,721)$q$, 'same-day milestone cannot be stored twice');
select t.affects($q$insert into storage.objects(bucket_id,name) values ('couple-photos', (select id::text from t.ids where name='couple') || '/first.jpg')$q$, 1, 'Becam uploads to own couple folder');
select t.fails($q$insert into storage.objects(bucket_id,name) values ('couple-photos', gen_random_uuid()::text || '/other.jpg')$q$, 'cannot upload into another couple''s folder');
select t.affects($q$insert into public.special_dates(couple_id,title,event_date,recurrence_type,is_builtin) values ((select id from t.ids where name='couple'),'Faith birthday','2000-03-14','yearly',false)$q$, 1, 'custom special date created');
select t.affects($q$delete from public.special_dates where slug='anniversary'$q$, 0, 'built-in events cannot be deleted');
select t.affects($q$delete from public.special_dates where title='Faith birthday'$q$, 1, 'custom events can be deleted');
select t.fails($q$update public.profiles set partner_role='faith' where id='00000000-0000-0000-0000-0000000000b1'$q$, 'profile partner_role is not self-editable');
select t.affects($q$update public.profiles set display_name='Becam K' where id='00000000-0000-0000-0000-0000000000b1'$q$, 1, 'own display name is editable');
select t.fails($q$update public.special_dates set is_builtin=false where slug='anniversary'$q$, 'built-in flag is not editable');
select t.fails($q$update public.couple_settings set couple_id=gen_random_uuid()$q$, 'couple_id on settings is not editable');
select t.affects($q$update public.couple_settings set expected_return_at='2028-12-19T21:00:00Z'$q$, 1, 'return date can be updated by a member');
reset role;

-- ===== FAITH =====
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000f1',false);
set role authenticated;
select t.eq((select count(*) from public.messages), 1, 'Faith receives the message');
select t.fails($q$update public.messages set deleted_at=now() where id='10000000-0000-0000-0000-000000000001'$q$, 'recipient cannot delete the sender''s message');
select t.affects($q$update public.messages set read_at=now() where id='10000000-0000-0000-0000-000000000001'$q$, 1, 'Faith marks message read');
select t.eq((select count(*) from storage.objects), 1, 'Faith can see the couple photo object');
select t.eq((select count(*) from public.notification_preferences), 1, 'Faith sees only her own notification prefs');
reset role;

-- ===== BECAM soft-deletes own message =====
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select t.affects($q$update public.messages set deleted_at=now() where id='10000000-0000-0000-0000-000000000001'$q$, 1, 'sender soft-deletes own message');
reset role;

-- ===== seed loads and is idempotent =====
\i supabase/seed.sql
\i supabase/seed.sql
select t.eq((select count(*) from public.quotes where couple_id is null), 73, 'seed loaded 73 quotes, re-run created no duplicates');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000e1',false);
set role authenticated;
select t.fails($q$insert into public.quotes(couple_id,category,frequency,message) values ((select id from t.ids where name='couple'),'daily_love','daily','planted')$q$, 'stranger cannot plant quotes in the couple library');
reset role;

\echo
\echo ALL DATABASE SECURITY TESTS PASSED
