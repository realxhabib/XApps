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

grant usage on schema public, auth, realtime to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function realtime.topic() to anon, authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
