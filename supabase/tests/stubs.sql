-- Minimal stand-ins for the Supabase platform schemas so the migrations can
-- be verified against a plain PostgreSQL (no Docker needed).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema realtime;
create table realtime.messages (
  id bigserial primary key,
  topic text not null,
  extension text not null,
  payload jsonb,
  event text,
  private boolean default true
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;

create publication supabase_realtime;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid()
);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema public, auth, realtime, storage to anon, authenticated;
grant select, insert on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
