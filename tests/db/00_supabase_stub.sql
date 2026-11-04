-- Minimal stand-ins for the parts of Supabase that the migration references.
-- ONLY for local testing against plain PostgreSQL. Real Supabase already provides all of this.
do $$ begin
  begin create role anon nologin; exception when duplicate_object then null; end;
  begin create role authenticated nologin; exception when duplicate_object then null; end;
  begin create role service_role nologin bypassrls; exception when duplicate_object then null; end;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

create publication supabase_realtime;

-- test helpers (run as the calling role so RLS applies)
create schema t;
create table t.ids (name text primary key, id uuid);
grant usage on schema t to anon, authenticated;
grant select on t.ids to anon, authenticated;

create function t.fails(q text, label text) returns void language plpgsql as $$
declare allowed boolean := false;
begin
  begin execute q; allowed := true;
  exception when others then raise notice 'PASS  blocked: % (%)', label, sqlerrm; end;
  if allowed then raise exception 'FAIL  was allowed: %', label; end if;
end $$;

create function t.affects(q text, expected int, label text) returns void language plpgsql as $$
declare n int;
begin
  execute q; get diagnostics n = row_count;
  if n <> expected then raise exception 'FAIL  % : expected % rows, got %', label, expected, n; end if;
  raise notice 'PASS  % (% rows)', label, n;
end $$;

create function t.eq(actual bigint, expected bigint, label text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then raise exception 'FAIL  % : expected %, got %', label, expected, actual; end if;
  raise notice 'PASS  %', label;
end $$;
grant execute on all functions in schema t to anon, authenticated;
