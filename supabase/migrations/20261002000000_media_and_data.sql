-- =============================================================================
-- Platform v2, stage 3: Media & data (docs/platform-v2.md)
--
--  * Media: public bucket `app-media`, objects at <app_slug>/<user_id>/<file>.
--    The insert policy checks the folder, the app and a rolling 24 h quota per
--    user per app (media_quota_ok: 60 uploads, 200 MB). The host records each
--    upload with record_media_upload (verifies the object exists, is the
--    caller's and fits the per-kind limits) into `media_uploads`.
--  * Storage: app_storage gains `scope` ('user' | 'app'; app-scope rows have
--    no user). Values ≤ 64 KB, ≤ 200 keys per user per app (and per app for
--    the app scope). RPCs storage_get/set/delete/list for players and
--    app_api_storage_* for app servers (the only writers of the app scope).
--    v1 direct table upserts from the web client keep working.
--  * Manifest: apps.stats / apps.achievements (validated JSON arrays).
--  * Stats: app_user_stats with max/min/sum/last aggregates, per-stat
--    leaderboards, report_stats (client apps) / app_api_report_stats.
--  * Achievements: user_achievements; XP added to the profile once;
--    unlock_achievement (client apps) / app_api_unlock_achievement; apps with
--    a webhook get an `achievement.unlocked` event.
--
-- Errors: 28000 not signed in / 'invalid_secret', P0002 app/player/upload not
-- found, 42501 not yours / server-authoritative app, 22023 invalid input,
-- 54000 limit reached (keys, reports per minute).
--
-- Additive: v1/stage 1/stage 2 behaviour is unchanged. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Rate limiting (fixed one-minute windows per bucket and user)
-- ---------------------------------------------------------------------------

create table if not exists public.rate_limit_hits (
  bucket text not null,
  user_id uuid not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, user_id, window_start)
);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;

-- Counts a hit; false once the bucket is over p_limit this minute. Callers
-- raise on false, which also rolls the hit back.
create or replace function public.rate_limit_hit(p_bucket text, p_user uuid, p_limit integer)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_hits integer;
begin
  delete from public.rate_limit_hits
   where bucket = p_bucket and user_id = p_user and window_start < v_window;
  insert into public.rate_limit_hits as r (bucket, user_id, window_start, hits)
  values (p_bucket, p_user, v_window, 1)
  on conflict (bucket, user_id, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

-- LIMITS.media in @xapps/sdk. Pure helpers (also used by the storage policy).
create or replace function public.media_mime_types()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['image/jpeg', 'image/png', 'image/webp', 'image/gif',
               'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav',
               'video/mp4', 'video/webm', 'video/quicktime'];
$$;

-- Max bytes for a mime type (null = not allowed).
create or replace function public.media_max_bytes(p_mime text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when p_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif') then 8388608
    when p_mime in ('audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/webm', 'audio/wav') then 10485760
    when p_mime in ('video/mp4', 'video/webm', 'video/quicktime') then 26214400
  end::bigint;
$$;

-- 'image/PNG; foo=bar' -> 'image/png'
create or replace function public.media_normalize_mime(p_mime text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(split_part(coalesce(p_mime, ''), ';', 1))), '');
$$;

-- storage.objects.metadata->'size' as bytes (null when absent or malformed).
create or replace function public.media_meta_size(p_metadata jsonb)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_metadata->>'size' ~ '^[0-9]{1,15}$' then (p_metadata->>'size')::bigint end;
$$;

-- An object's metadata fits the per-kind limits. Metadata the storage API
-- hasn't filled in yet passes (record_media_upload checks again).
create or replace function public.media_object_ok(p_metadata jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when public.media_normalize_mime(p_metadata->>'mimetype') is null then true
    when public.media_max_bytes(public.media_normalize_mime(p_metadata->>'mimetype')) is null then false
    else coalesce(public.media_meta_size(p_metadata), 0)
         <= public.media_max_bytes(public.media_normalize_mime(p_metadata->>'mimetype'))
  end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-media', 'app-media', true, 26214400, public.media_mime_types())
on conflict (id) do update
   set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.media_uploads (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  bytes bigint not null check (bytes between 1 and 26214400),
  mime text not null,
  created_at timestamptz not null default now()
);
create index if not exists media_uploads_quota_idx on public.media_uploads (app_slug, user_id, created_at desc);
alter table public.media_uploads enable row level security;
revoke insert, update, delete, truncate on public.media_uploads from public, anon, authenticated;
drop policy if exists "players see their own uploads" on public.media_uploads;
create policy "players see their own uploads" on public.media_uploads
  for select to authenticated using (user_id = (select auth.uid()));

-- Rolling 24 h quota per user per app: at most 60 uploads and 200 MB,
-- counting this upload (p_metadata: the new object's metadata, if known).
-- Counts both the bucket's objects and recorded uploads and takes the larger,
-- so an upload that was never recorded still counts. Only answers for the
-- caller (it is evaluated by the storage insert policy).
create or replace function public.media_quota_ok(p_user uuid, p_app text, p_metadata jsonb default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_since timestamptz := now() - interval '24 hours';
  v_objects bigint;
  v_object_bytes bigint;
  v_recorded bigint;
  v_recorded_bytes bigint;
begin
  if p_user is null or p_app is null or p_user is distinct from auth.uid() then
    return false;
  end if;
  if p_app !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' then
    return false;
  end if;
  v_prefix := p_app || '/' || p_user::text || '/';

  select count(*), coalesce(sum(coalesce(public.media_meta_size(o.metadata), mu.bytes, 0)), 0)
    into v_objects, v_object_bytes
    from storage.objects o
    left join public.media_uploads mu on mu.path = o.name
   where o.bucket_id = 'app-media' and o.name like v_prefix || '%' and o.created_at > v_since;

  select count(*), coalesce(sum(mu.bytes), 0)
    into v_recorded, v_recorded_bytes
    from public.media_uploads mu
   where mu.app_slug = p_app and mu.user_id = p_user and mu.created_at > v_since;

  return greatest(v_objects, v_recorded) + 1 <= 60
     and greatest(v_object_bytes, v_recorded_bytes) + coalesce(public.media_meta_size(p_metadata), 0) <= 209715200;
end;
$$;

-- Uploads land in <app_slug>/<own user id>/<file> of an app the uploader can
-- play (published, or their own pending app), within the quota.
drop policy if exists "app media: upload into own folder" on storage.objects;
create policy "app media: upload into own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'app-media'
    and name ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    -- (qualified: apps has a `name` column too)
    and exists (
      select 1 from public.apps a
       where a.slug = (storage.foldername(objects.name))[1]
         and (a.status = 'published' or a.developer_id = (select auth.uid()))
    )
    and public.media_object_ok(metadata)
    and public.media_quota_ok((select auth.uid()), (storage.foldername(name))[1], metadata)
  );

create or replace function public.media_upload_json(u public.media_uploads)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('path', u.path, 'bytes', u.bytes, 'mime', u.mime, 'createdAt', u.created_at);
$$;

-- Called by the host right after the storage upload. Idempotent per path.
-- Size and type come from the stored object's metadata when present.
create or replace function public.record_media_upload(p_app text, p_path text, p_bytes bigint, p_mime text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
  v_path text := btrim(coalesce(p_path, ''));
  v_found boolean;
  v_owner text;
  v_meta jsonb;
  v_mime text;
  v_bytes bigint;
  u public.media_uploads;
begin
  if v_path !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
    raise exception 'Invalid media path' using errcode = '22023';
  end if;
  if split_part(v_path, '/', 1) <> a.slug or split_part(v_path, '/', 2) <> v_me::text then
    raise exception 'That upload isn''t yours' using errcode = '42501';
  end if;

  select * into u from public.media_uploads where path = v_path;
  if found then
    return public.media_upload_json(u);
  end if;

  select true, coalesce(o.owner_id, o.owner::text), o.metadata
    into v_found, v_owner, v_meta
    from storage.objects o
   where o.bucket_id = 'app-media' and o.name = v_path;
  if v_found is null then
    raise exception 'Upload not found' using errcode = 'P0002';
  end if;
  if v_owner is distinct from v_me::text then
    raise exception 'That upload isn''t yours' using errcode = '42501';
  end if;

  v_mime := coalesce(public.media_normalize_mime(v_meta->>'mimetype'), public.media_normalize_mime(p_mime));
  v_bytes := coalesce(public.media_meta_size(v_meta), p_bytes);
  if v_mime is null or public.media_max_bytes(v_mime) is null then
    raise exception 'Unsupported media type' using errcode = '22023';
  end if;
  if v_bytes is null or v_bytes < 1 then
    raise exception 'Invalid media size' using errcode = '22023';
  end if;
  if v_bytes > public.media_max_bytes(v_mime) then
    raise exception 'That file is too large' using errcode = '22023';
  end if;

  insert into public.media_uploads (app_slug, user_id, path, bytes, mime)
  values (a.slug, v_me, v_path, v_bytes, v_mime)
  on conflict (path) do nothing;
  select * into u from public.media_uploads where path = v_path;
  return public.media_upload_json(u);
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: user + app scope
-- ---------------------------------------------------------------------------

alter table public.app_storage
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists scope text not null default 'user';

do $$
begin
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.app_storage'::regclass and c.contype = 'p'
                and cardinality(c.conkey) > 1) then
    alter table public.app_storage drop constraint app_storage_pkey;
    alter table public.app_storage add constraint app_storage_pkey primary key (id);
  end if;
end $$;

alter table public.app_storage alter column user_id drop not null;
alter table public.app_storage drop constraint if exists app_storage_scope_check;
alter table public.app_storage add constraint app_storage_scope_check
  check (scope in ('user', 'app') and (scope = 'user') = (user_id is not null));
alter table public.app_storage drop constraint if exists app_storage_value_check;
alter table public.app_storage add constraint app_storage_value_check check (octet_length(value::text) <= 65536);

create unique index if not exists app_storage_user_key on public.app_storage (app_slug, user_id, key) where scope = 'user';
create unique index if not exists app_storage_app_key on public.app_storage (app_slug, key) where scope = 'app';

-- The app scope is public to read (as through storage_get) for apps the
-- reader can see; only app servers write it.
drop policy if exists "app-scope storage is public" on public.app_storage;
create policy "app-scope storage is public" on public.app_storage
  for select using (scope = 'app' and exists (select 1 from public.apps a where a.slug = app_slug));

-- Direct client writes (the v1 web client upserts rows itself): only the
-- caller's own user-scope keys; an insert of an existing key updates it (the
-- primary key is now a surrogate id), and new keys respect the 200 key limit.
create or replace function public.app_storage_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if v_me is null or new.user_id is distinct from v_me or new.scope is distinct from 'user' then
    raise exception 'You can only write your own storage' using errcode = '42501';
  end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    return new;
  end if;
  update public.app_storage set value = new.value, updated_at = now()
   where app_slug = new.app_slug and scope = 'user' and user_id = v_me and key = new.key;
  if found then
    return null;
  end if;
  if (select count(*) from public.app_storage
       where app_slug = new.app_slug and scope = 'user' and user_id = v_me) >= 200 then
    raise exception 'Storage is full (200 keys)' using errcode = '54000';
  end if;
  return new;
end;
$$;

drop trigger if exists app_storage_client_write on public.app_storage;
create trigger app_storage_client_write
  before insert or update on public.app_storage
  for each row execute function public.app_storage_client_write();

-- Internal: upsert one key (p_user null = app scope).
create or replace function public.storage_write(p_app text, p_user uuid, p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := case when p_user is null then 'app' else 'user' end;
begin
  if p_key is null or char_length(p_key) not between 1 and 64 then
    raise exception 'Storage keys are 1–64 characters' using errcode = '22023';
  end if;
  if p_value is null then
    raise exception 'A value is required (use delete to remove a key)' using errcode = '22023';
  end if;
  if octet_length(p_value::text) > 65536 then
    raise exception 'Storage values are limited to 64 KB' using errcode = '22023';
  end if;

  update public.app_storage set value = p_value, updated_at = now()
   where app_slug = p_app and scope = v_scope and user_id is not distinct from p_user and key = p_key;
  if found then
    return;
  end if;
  if (select count(*) from public.app_storage
       where app_slug = p_app and scope = v_scope and user_id is not distinct from p_user) >= 200 then
    raise exception 'Storage is full (200 keys)' using errcode = '54000';
  end if;
  if p_user is null then
    insert into public.app_storage (app_slug, scope, user_id, key, value)
    values (p_app, 'app', null, p_key, p_value)
    on conflict (app_slug, key) where scope = 'app' do update set value = excluded.value, updated_at = now();
  else
    insert into public.app_storage (app_slug, scope, user_id, key, value)
    values (p_app, 'user', p_user, p_key, p_value)
    on conflict (app_slug, user_id, key) where scope = 'user' do update set value = excluded.value, updated_at = now();
  end if;
end;
$$;

create or replace function public.storage_scope_user(p_scope text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_scope is null or p_scope not in ('user', 'app') then
    raise exception 'Storage scope is user or app' using errcode = '22023';
  end if;
  if p_scope = 'app' then
    return null;
  end if;
  return public.require_user();
end;
$$;

-- User scope: the caller's value; app scope: the app's public value (anyone).
-- null when the key is unset.
create or replace function public.storage_get(p_app text, p_key text, p_scope text default 'user')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.storage_scope_user(p_scope);
  a public.apps := public.playable_app(p_app);
  v_value jsonb;
begin
  select s.value into v_value
    from public.app_storage s
   where s.app_slug = a.slug and s.scope = p_scope and s.user_id is not distinct from v_user and s.key = p_key;
  return v_value;
end;
$$;

create or replace function public.storage_set(p_app text, p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
begin
  perform public.storage_write(a.slug, v_me, p_key, p_value);
end;
$$;

-- true when the key existed.
create or replace function public.storage_delete(p_app text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
begin
  delete from public.app_storage
   where app_slug = a.slug and scope = 'user' and user_id = v_me and key = p_key;
  return found;
end;
$$;

-- Keys (sorted), optionally only those starting with p_prefix.
create or replace function public.storage_list(p_app text, p_prefix text default null, p_scope text default 'user')
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := public.storage_scope_user(p_scope);
  a public.apps := public.playable_app(p_app);
  v_keys text[];
begin
  select coalesce(array_agg(s.key order by s.key), '{}') into v_keys
    from public.app_storage s
   where s.app_slug = a.slug and s.scope = p_scope and s.user_id is not distinct from v_user
     and (p_prefix is null or starts_with(s.key, p_prefix));
  return v_keys;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manifest: stats + achievements
-- ---------------------------------------------------------------------------

-- null when valid, else a message. Used by check constraints (so executable
-- by clients) and by the validation trigger (for a readable 22023).
create or replace function public.app_stats_error(p_stats jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  i integer := 0;
  v_key text;
  v_keys text[] := '{}';
begin
  if p_stats is null or jsonb_typeof(p_stats) <> 'array' then
    return 'Stats must be a list';
  end if;
  if jsonb_array_length(p_stats) > 8 then
    return 'At most 8 stats';
  end if;
  if octet_length(p_stats::text) > 16384 then
    return 'Stats are too large';
  end if;
  for e in select x from jsonb_array_elements(p_stats) x loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      return 'Stat ' || i || ' must be an object';
    end if;
    v_key := case when jsonb_typeof(e->'key') = 'string' then e->>'key' end;
    if v_key is null or v_key !~ '^[a-z][a-z0-9_]{0,31}$' then
      return 'Stat ' || i || ': key must be lowercase letters, digits or _ (starting with a letter, ≤ 32)';
    end if;
    if v_key = any (v_keys) then
      return 'Duplicate stat key ' || v_key;
    end if;
    v_keys := v_keys || v_key;
    if jsonb_typeof(e->'label') is distinct from 'string' or char_length(e->>'label') not between 1 and 40
       or btrim(e->>'label') = '' then
      return 'Stat ' || v_key || ': label must be 1–40 characters';
    end if;
    if jsonb_typeof(e->'aggregate') is distinct from 'string' or e->>'aggregate' not in ('max', 'min', 'sum', 'last') then
      return 'Stat ' || v_key || ': aggregate must be max, min, sum or last';
    end if;
    if coalesce(jsonb_typeof(e->'format'), 'null') <> 'null'
       and (jsonb_typeof(e->'format') <> 'string' or e->>'format' not in ('number', 'ms', 'percent')) then
      return 'Stat ' || v_key || ': format must be number, ms or percent';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.app_achievements_error(p_achievements jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  e jsonb;
  i integer := 0;
  v_id text;
  v_ids text[] := '{}';
  v_xp numeric;
  v_total numeric := 0;
begin
  if p_achievements is null or jsonb_typeof(p_achievements) <> 'array' then
    return 'Achievements must be a list';
  end if;
  if jsonb_array_length(p_achievements) > 30 then
    return 'At most 30 achievements';
  end if;
  if octet_length(p_achievements::text) > 32768 then
    return 'Achievements are too large';
  end if;
  for e in select x from jsonb_array_elements(p_achievements) x loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      return 'Achievement ' || i || ' must be an object';
    end if;
    v_id := case when jsonb_typeof(e->'id') = 'string' then e->>'id' end;
    if v_id is null or v_id !~ '^[a-z][a-z0-9_]{0,31}$' then
      return 'Achievement ' || i || ': id must be lowercase letters, digits or _ (starting with a letter, ≤ 32)';
    end if;
    if v_id = any (v_ids) then
      return 'Duplicate achievement id ' || v_id;
    end if;
    v_ids := v_ids || v_id;
    if jsonb_typeof(e->'name') is distinct from 'string' or char_length(e->>'name') not between 1 and 40
       or btrim(e->>'name') = '' then
      return 'Achievement ' || v_id || ': name must be 1–40 characters';
    end if;
    if coalesce(jsonb_typeof(e->'description'), 'null') <> 'null'
       and (jsonb_typeof(e->'description') <> 'string' or char_length(e->>'description') > 140) then
      return 'Achievement ' || v_id || ': description must be at most 140 characters';
    end if;
    if jsonb_typeof(e->'icon') is distinct from 'string' or char_length(e->>'icon') not between 1 and 16
       or btrim(e->>'icon') = '' then
      return 'Achievement ' || v_id || ': icon must be one emoji';
    end if;
    if jsonb_typeof(e->'xp') is distinct from 'number' then
      return 'Achievement ' || v_id || ': xp must be a whole number from 0 to 100';
    end if;
    v_xp := (e->>'xp')::numeric;
    if v_xp <> trunc(v_xp) or v_xp not between 0 and 100 then
      return 'Achievement ' || v_id || ': xp must be a whole number from 0 to 100';
    end if;
    v_total := v_total + v_xp;
    if coalesce(jsonb_typeof(e->'secret'), 'null') not in ('null', 'boolean') then
      return 'Achievement ' || v_id || ': secret must be true or false';
    end if;
  end loop;
  if v_total > 500 then
    return 'Achievements can award at most 500 XP in total';
  end if;
  return null;
end;
$$;

alter table public.apps
  add column if not exists stats jsonb not null default '[]'::jsonb,
  add column if not exists achievements jsonb not null default '[]'::jsonb;
alter table public.apps drop constraint if exists apps_stats_check;
alter table public.apps add constraint apps_stats_check check (public.app_stats_error(stats) is null);
alter table public.apps drop constraint if exists apps_achievements_check;
alter table public.apps add constraint apps_achievements_check check (public.app_achievements_error(achievements) is null);

-- Owners set both through the normal (direct) insert/update of their app;
-- null means none, and invalid lists fail with a readable 22023.
create or replace function public.apps_validate_manifest_data()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_error text;
begin
  new.stats := coalesce(new.stats, '[]'::jsonb);
  new.achievements := coalesce(new.achievements, '[]'::jsonb);
  v_error := coalesce(public.app_stats_error(new.stats), public.app_achievements_error(new.achievements));
  if v_error is not null then
    raise exception '%', v_error using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists apps_validate_manifest_data on public.apps;
create trigger apps_validate_manifest_data
  before insert or update on public.apps
  for each row execute function public.apps_validate_manifest_data();

-- ---------------------------------------------------------------------------
-- Stats
-- ---------------------------------------------------------------------------

create table if not exists public.app_user_stats (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  value double precision not null,
  updated_at timestamptz not null default now(),
  primary key (app_slug, user_id, key)
);
create index if not exists app_user_stats_board_idx on public.app_user_stats (app_slug, key, value);
create index if not exists app_user_stats_user_idx on public.app_user_stats (user_id);
alter table public.app_user_stats enable row level security;
revoke insert, update, delete, truncate on public.app_user_stats from public, anon, authenticated;
drop policy if exists "player stats are public" on public.app_user_stats;
create policy "player stats are public" on public.app_user_stats for select using (true);

-- Internal: applies each reported value with its stat's aggregate; returns
-- { key: new value } for the reported keys. updated_at moves only when the
-- value changes (earlier holders of a tied value rank first on boards).
create or replace function public.apply_stats(p_app public.apps, p_user uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_agg text;
  v_num numeric;
  v_new double precision;
  result jsonb := '{}'::jsonb;
begin
  if p_values is null or jsonb_typeof(p_values) <> 'object' then
    raise exception 'Stats must be an object of numbers' using errcode = '22023';
  end if;
  for r in select key, value from jsonb_each(p_values) order by key loop
    select e->>'aggregate' into v_agg
      from jsonb_array_elements(p_app.stats) e
     where e->>'key' = r.key;
    if v_agg is null then
      raise exception 'Unknown stat %', r.key using errcode = '22023';
    end if;
    if jsonb_typeof(r.value) <> 'number' then
      raise exception 'Stat % must be a finite number', r.key using errcode = '22023';
    end if;
    v_num := (r.value #>> '{}')::numeric;
    if abs(v_num) > 1e15 then
      raise exception 'Stat % is out of range', r.key using errcode = '22023';
    end if;
    insert into public.app_user_stats as s (app_slug, user_id, key, value)
    values (p_app.slug, p_user, r.key, v_num::double precision)
    on conflict (app_slug, user_id, key) do update
       set value = case v_agg
                     when 'max' then greatest(s.value, excluded.value)
                     when 'min' then least(s.value, excluded.value)
                     when 'sum' then least(greatest(s.value + excluded.value, -1e15), 1e15)
                     else excluded.value
                   end,
           updated_at = case
                          when s.value is distinct from (case v_agg
                            when 'max' then greatest(s.value, excluded.value)
                            when 'min' then least(s.value, excluded.value)
                            when 'sum' then least(greatest(s.value + excluded.value, -1e15), 1e15)
                            else excluded.value end)
                          then now() else s.updated_at
                        end
    returning s.value into v_new;
    result := result || jsonb_build_object(r.key, v_new);
  end loop;
  return result;
end;
$$;

-- Client-authoritative apps: the signed-in player reports their own stats
-- (≤ 120 reports a minute per app).
create or replace function public.report_stats(p_app text, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
begin
  if a.authority = 'server' then
    raise exception '% reports stats from its server', a.name using errcode = '42501';
  end if;
  if not public.rate_limit_hit('stats:' || a.slug, v_me, 120) then
    raise exception 'Too many stat reports — slow down' using errcode = '54000';
  end if;
  return public.apply_stats(a, v_me, p_values);
end;
$$;

-- Internal: a real (non-bot) player for the server API.
create or replace function public.app_api_player(p_user uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.profiles p where p.id = p_user and not p.is_bot;
  if v_id is null then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

create or replace function public.app_api_report_stats(p_secret text, p_user uuid, p_values jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
  v_user uuid := public.app_api_player(p_user);
  a public.apps;
begin
  select * into a from public.apps where slug = v_app;
  return public.apply_stats(a, v_user, p_values);
end;
$$;

-- [{ rank, profile, value }] best first (min stats ascending, others
-- descending); equal values share a rank (1, 2, 2, 4).
create or replace function public.app_stat_leaderboard(p_app text, p_key text, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.playable_app(p_app);
  v_agg text;
  result jsonb;
begin
  select e->>'aggregate' into v_agg from jsonb_array_elements(a.stats) e where e->>'key' = p_key;
  if v_agg is null then
    raise exception 'Unknown stat %', p_key using errcode = '22023';
  end if;
  with ranked as (
    select s.user_id, s.value, s.updated_at,
           rank() over (order by case when v_agg = 'min' then s.value else -s.value end) as rank
      from public.app_user_stats s
      join public.profiles p on p.id = s.user_id
     where s.app_slug = a.slug and s.key = p_key and not p.is_bot
     order by rank, s.updated_at, s.user_id
     limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select coalesce(jsonb_agg(jsonb_build_object('rank', r.rank, 'profile', public.profile_json(p), 'value', r.value)
                            order by r.rank, r.updated_at, r.user_id), '[]'::jsonb)
    into result
    from ranked r
    join public.profiles p on p.id = r.user_id;
  return result;
end;
$$;

-- A player's stats in apps the viewer can see, in manifest order:
-- [{ appSlug, key, value, updatedAt }]. Stats no longer declared are hidden.
create or replace function public.user_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('appSlug', s.app_slug, 'key', s.key, 'value', s.value,
                                               'updatedAt', s.updated_at)
                            order by s.app_slug, d.ord), '[]'::jsonb)
    from public.app_user_stats s
    join public.apps a on a.slug = s.app_slug
    cross join lateral (
      select x.ord from jsonb_array_elements(a.stats) with ordinality x(e, ord) where x.e->>'key' = s.key
    ) d
   where s.user_id = p_user
     and (a.status = 'published' or a.developer_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Achievements
-- ---------------------------------------------------------------------------

create table if not exists public.user_achievements (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_id text not null check (achievement_id ~ '^[a-z][a-z0-9_]{0,31}$'),
  unlocked_at timestamptz not null default now(),
  primary key (app_slug, user_id, achievement_id)
);
create index if not exists user_achievements_user_idx on public.user_achievements (user_id, unlocked_at desc);
alter table public.user_achievements enable row level security;
revoke insert, update, delete, truncate on public.user_achievements from public, anon, authenticated;
drop policy if exists "unlocked achievements are public" on public.user_achievements;
create policy "unlocked achievements are public" on public.user_achievements for select using (true);

-- Webhook event for apps with a webhook URL.
alter table public.webhook_deliveries drop constraint if exists webhook_deliveries_event_check;
alter table public.webhook_deliveries add constraint webhook_deliveries_event_check
  check (event in ('match.created', 'match.started', 'match.state', 'match.turn',
                   'match.submitted', 'match.ended', 'ping', 'achievement.unlocked'));

-- Internal: unlocks a declared achievement once and adds its XP to the
-- profile once. { unlocked: false } when the player already had it.
create or replace function public.grant_achievement(p_app public.apps, p_user uuid, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def jsonb;
  v_xp integer;
begin
  select e into v_def from jsonb_array_elements(p_app.achievements) e where e->>'id' = p_id;
  if v_def is null then
    raise exception 'Unknown achievement %', coalesce(p_id, 'null') using errcode = '22023';
  end if;
  insert into public.user_achievements (app_slug, user_id, achievement_id)
  values (p_app.slug, p_user, p_id)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('unlocked', false);
  end if;
  v_xp := coalesce((v_def->>'xp')::integer, 0);
  if v_xp > 0 then
    update public.profiles set xp = xp + v_xp, updated_at = now() where id = p_user;
  end if;
  begin
    perform public.enqueue_webhook(p_app.slug, 'achievement.unlocked', null,
      jsonb_build_object('userId', p_user, 'achievementId', p_id));
  exception when others then
    raise warning 'xapps: could not enqueue achievement.unlocked for %: %', p_app.slug, sqlerrm;
  end;
  return jsonb_build_object('unlocked', true);
end;
$$;

create or replace function public.unlock_achievement(p_app text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
begin
  if a.authority = 'server' then
    raise exception '% unlocks achievements from its server', a.name using errcode = '42501';
  end if;
  if not public.rate_limit_hit('achievements:' || a.slug, v_me, 120) then
    raise exception 'Too many unlocks — slow down' using errcode = '54000';
  end if;
  return public.grant_achievement(a, v_me, p_id);
end;
$$;

create or replace function public.app_api_unlock_achievement(p_secret text, p_user uuid, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
  v_user uuid := public.app_api_player(p_user);
  a public.apps;
begin
  select * into a from public.apps where slug = v_app;
  return public.grant_achievement(a, v_user, p_id);
end;
$$;

-- A player's unlocked achievements (newest first) in apps the viewer can
-- see: [{ appSlug, achievementId, unlockedAt }]. Unlocked secret achievements
-- are listed too; ids no longer declared are hidden.
create or replace function public.list_user_achievements(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('appSlug', u.app_slug, 'achievementId', u.achievement_id,
                                               'unlockedAt', u.unlocked_at)
                            order by u.unlocked_at desc, u.app_slug, u.achievement_id), '[]'::jsonb)
    from public.user_achievements u
    join public.apps a on a.slug = u.app_slug
   where u.user_id = p_user
     and (a.status = 'published' or a.developer_id = auth.uid())
     and exists (select 1 from jsonb_array_elements(a.achievements) e where e->>'id' = u.achievement_id);
$$;

-- ---------------------------------------------------------------------------
-- Server API: app-scope storage
-- ---------------------------------------------------------------------------

create or replace function public.app_api_storage_get(p_secret text, p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
  v_value jsonb;
begin
  select s.value into v_value from public.app_storage s
   where s.app_slug = v_app and s.scope = 'app' and s.key = p_key;
  return v_value;
end;
$$;

create or replace function public.app_api_storage_set(p_secret text, p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
begin
  perform public.storage_write(v_app, null, p_key, p_value);
end;
$$;

create or replace function public.app_api_storage_delete(p_secret text, p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
begin
  delete from public.app_storage where app_slug = v_app and scope = 'app' and key = p_key;
  return found;
end;
$$;

create or replace function public.app_api_storage_list(p_secret text, p_prefix text default null)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
  v_keys text[];
begin
  select coalesce(array_agg(s.key order by s.key), '{}') into v_keys
    from public.app_storage s
   where s.app_slug = v_app and s.scope = 'app' and (p_prefix is null or starts_with(s.key, p_prefix));
  return v_keys;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Internal helpers.
revoke execute on function public.rate_limit_hit(text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.media_upload_json(public.media_uploads) from public, anon, authenticated;
revoke execute on function public.app_storage_client_write() from public, anon, authenticated;
revoke execute on function public.storage_write(text, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.storage_scope_user(text) from public, anon, authenticated;
revoke execute on function public.apps_validate_manifest_data() from public, anon, authenticated;
revoke execute on function public.apply_stats(public.apps, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.app_api_player(uuid) from public, anon, authenticated;
revoke execute on function public.grant_achievement(public.apps, uuid, text) from public, anon, authenticated;
-- Pure validators stay executable: check constraints and the storage policy
-- run them as the caller (media_mime_types, media_max_bytes,
-- media_normalize_mime, media_meta_size, media_object_ok, app_stats_error,
-- app_achievements_error). The quota check is evaluated by the policy.
revoke execute on function public.media_quota_ok(uuid, text, jsonb) from public, anon;
grant execute on function public.media_quota_ok(uuid, text, jsonb) to authenticated;

-- Players (signed in).
revoke execute on function public.record_media_upload(text, text, bigint, text) from public, anon;
revoke execute on function public.storage_set(text, text, jsonb) from public, anon;
revoke execute on function public.storage_delete(text, text) from public, anon;
revoke execute on function public.report_stats(text, jsonb) from public, anon;
revoke execute on function public.unlock_achievement(text, text) from public, anon;
grant execute on function public.record_media_upload(text, text, bigint, text) to authenticated;
grant execute on function public.storage_set(text, text, jsonb) to authenticated;
grant execute on function public.storage_delete(text, text) to authenticated;
grant execute on function public.report_stats(text, jsonb) to authenticated;
grant execute on function public.unlock_achievement(text, text) to authenticated;

-- Reads (anyone; user-scope storage still needs a signed-in user).
grant execute on function public.storage_get(text, text, text) to anon, authenticated;
grant execute on function public.storage_list(text, text, text) to anon, authenticated;
grant execute on function public.app_stat_leaderboard(text, text, integer) to anon, authenticated;
grant execute on function public.user_stats(uuid) to anon, authenticated;
grant execute on function public.list_user_achievements(uuid) to anon, authenticated;

-- Server API (authenticated by the app secret).
grant execute on function public.app_api_report_stats(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.app_api_unlock_achievement(text, uuid, text) to anon, authenticated;
grant execute on function public.app_api_storage_get(text, text) to anon, authenticated;
grant execute on function public.app_api_storage_set(text, text, jsonb) to anon, authenticated;
grant execute on function public.app_api_storage_delete(text, text) to anon, authenticated;
grant execute on function public.app_api_storage_list(text, text) to anon, authenticated;
