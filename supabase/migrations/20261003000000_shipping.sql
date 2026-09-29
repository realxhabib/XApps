-- =============================================================================
-- Platform v2, stage 4: Shipping (docs/platform-v2.md)
--
--  * Versions: `app_versions` (semver, url, validated manifest, status
--    draft → in_review → approved/rejected → published → retired).
--    `apps.published_version_id` points at the live one; publishing copies the
--    version's url + manifest onto the apps row (what players see) and retires
--    the previous published version. Registering a community app (the
--    existing direct insert into `apps`) creates version 1.0.0 in review via
--    a trigger. Official apps are managed in code: their version RPCs say 42501.
--  * Testers: `app_testers`. The developer and testers can play a
--    non-published version (a "test build"): create_challenge / quick_match /
--    start_practice take `p_version`; `matches.version_id` records it and
--    match_json exposes `versionId` + `versionUrl`. Test builds use the
--    version's manifest (players, teams, modes, scoring, turns, spectators),
--    only testers can join/spectate/judge them, they never change XP, rank,
--    stats or the app's play count, and they're left out of public feeds.
--  * Review: `profiles.is_admin` (already a column, never client-writable)
--    gates list_review_queue / review_app_version. Decisions reach the
--    developer as `developer_notices` (list_my_notices / mark_notices_read).
--  * Analytics: app_analytics (owner or admin), every match except test builds.
--  * Logs: `app_logs` (7 days, cleaned daily by pg_cron job
--    `xapps-logs-cleanup`), log_app_event (≤ 60 a minute per user per app,
--    past that silently dropped) and list_app_logs (owner or admin).
--
-- Errors: 28000 not signed in, P0002 app/version/player not found, 42501 not
-- yours / official app / not a tester / not an admin, 22023 invalid input,
-- 55000 wrong version status, 54000 limits, 23505 duplicate version.
--
-- Additive: earlier behaviour is unchanged for published apps. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Manifest validation (shared by versions; mirrors the apps table rules)
-- ---------------------------------------------------------------------------

-- An integral JSON number as integer, else null.
create or replace function public.manifest_int(p jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then
    return null;
  end if;
  v := (p #>> '{}')::numeric;
  if v <> trunc(v) or abs(v) > 2147483647 then
    return null;
  end if;
  return v::integer;
end;
$$;

-- null when p is a complete, valid version manifest, else a message. The
-- same rules as the apps columns + checks (and app_stats_error /
-- app_achievements_error). Used by the app_versions check constraint.
create or replace function public.app_version_manifest_error(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys constant text[] := array['name', 'tagline', 'description', 'category', 'icon', 'accent', 'modes',
                                  'players', 'teams', 'spectators', 'setup', 'turnBased', 'scoring',
                                  'votesToWin', 'howTo', 'stats', 'achievements'];
  v_extra text;
  v_min integer;
  v_max integer;
  v_teams integer;
  v_votes integer;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'The manifest must be an object';
  end if;
  select k into v_extra from jsonb_object_keys(p) k where not (k = any (v_keys)) limit 1;
  if v_extra is not null then
    return 'Unknown manifest field ' || v_extra;
  end if;
  if jsonb_typeof(p->'name') is distinct from 'string' or char_length(p->>'name') not between 2 and 40 then
    return 'Name must be 2–40 characters';
  end if;
  if jsonb_typeof(p->'tagline') is distinct from 'string' or char_length(p->>'tagline') > 90 then
    return 'Tagline must be at most 90 characters';
  end if;
  if jsonb_typeof(p->'description') is distinct from 'string' or char_length(p->>'description') > 1200 then
    return 'Description must be at most 1200 characters';
  end if;
  if jsonb_typeof(p->'category') is distinct from 'string'
     or p->>'category' not in ('games', 'contests', 'debates', 'trivia', 'creative', 'social') then
    return 'Category must be games, contests, debates, trivia, creative or social';
  end if;
  if jsonb_typeof(p->'icon') is distinct from 'string' or char_length(p->>'icon') not between 1 and 16 then
    return 'Icon must be one emoji';
  end if;
  if jsonb_typeof(p->'accent') is distinct from 'array' or jsonb_array_length(p->'accent') <> 2
     or exists (select 1 from jsonb_array_elements(p->'accent') e
                 where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^#[0-9a-fA-F]{6}$') then
    return 'Accent must be two #rrggbb colors';
  end if;
  if jsonb_typeof(p->'modes') is distinct from 'array' or jsonb_array_length(p->'modes') = 0
     or exists (select 1 from jsonb_array_elements(p->'modes') e
                 where jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('live', 'async', 'practice')) then
    return 'Modes must be a non-empty list of live, async and practice';
  end if;
  if jsonb_typeof(p->'players') is distinct from 'object' then
    return 'Players must be { min, max }';
  end if;
  v_min := public.manifest_int(p->'players'->'min');
  v_max := public.manifest_int(p->'players'->'max');
  if v_min is null or v_max is null or v_min not between 2 and 8 or v_max not between 2 and 8 or v_min > v_max then
    return 'Players must satisfy 2 ≤ min ≤ max ≤ 8';
  end if;
  if exists (select 1 from jsonb_object_keys(p->'players') k where k not in ('min', 'max')) then
    return 'Players must be { min, max }';
  end if;
  v_teams := public.manifest_int(p->'teams');
  if v_teams is null or not (v_teams = 0 or (v_teams between 2 and 4 and v_max % v_teams = 0)) then
    return 'Teams must be 0, or 2–4 dividing the max players';
  end if;
  if jsonb_typeof(p->'spectators') is distinct from 'boolean' or jsonb_typeof(p->'setup') is distinct from 'boolean'
     or jsonb_typeof(p->'turnBased') is distinct from 'boolean' then
    return 'spectators, setup and turnBased must be true or false';
  end if;
  if jsonb_typeof(p->'scoring') is distinct from 'string' or p->>'scoring' not in ('high', 'low', 'votes') then
    return 'Scoring must be high, low or votes';
  end if;
  v_votes := public.manifest_int(p->'votesToWin');
  if v_votes is null or v_votes not between 1 and 101 then
    return 'votesToWin must be a whole number from 1 to 101';
  end if;
  if jsonb_typeof(p->'howTo') is distinct from 'array' or jsonb_array_length(p->'howTo') > 6
     or exists (select 1 from jsonb_array_elements(p->'howTo') e where jsonb_typeof(e) <> 'string') then
    return 'How to play must be at most 6 lines of text';
  end if;
  return coalesce(public.app_stats_error(p->'stats'), public.app_achievements_error(p->'achievements'));
end;
$$;

-- Normalizes what a client sent: unknown fields are dropped, missing (or
-- null) optional fields take the apps defaults, numbers become integers.
-- Raises 22023 with a readable message when invalid.
create or replace function public.app_version_manifest(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb;
  v_error text;
  v_null constant jsonb := 'null'::jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'The manifest must be an object' using errcode = '22023';
  end if;
  v := jsonb_build_object(
    'name', coalesce(nullif(p->'name', v_null), v_null),
    'tagline', coalesce(nullif(p->'tagline', v_null), '""'::jsonb),
    'description', coalesce(nullif(p->'description', v_null), '""'::jsonb),
    'category', coalesce(nullif(p->'category', v_null), v_null),
    'icon', coalesce(nullif(p->'icon', v_null), '"✨"'::jsonb),
    'accent', coalesce(nullif(p->'accent', v_null), '["#5b74ff", "#a35cff"]'::jsonb),
    'modes', coalesce(nullif(p->'modes', v_null), '["live", "practice"]'::jsonb),
    'players', coalesce(nullif(p->'players', v_null), '{"min": 2, "max": 2}'::jsonb),
    'teams', coalesce(nullif(p->'teams', v_null), '0'::jsonb),
    'spectators', coalesce(nullif(p->'spectators', v_null), 'true'::jsonb),
    'setup', coalesce(nullif(p->'setup', v_null), 'false'::jsonb),
    'turnBased', coalesce(nullif(p->'turnBased', v_null), 'false'::jsonb),
    'scoring', coalesce(nullif(p->'scoring', v_null), '"high"'::jsonb),
    'votesToWin', coalesce(nullif(p->'votesToWin', v_null), '5'::jsonb),
    'howTo', coalesce(nullif(p->'howTo', v_null), '[]'::jsonb),
    'stats', coalesce(nullif(p->'stats', v_null), '[]'::jsonb),
    'achievements', coalesce(nullif(p->'achievements', v_null), '[]'::jsonb)
  );
  v_error := public.app_version_manifest_error(v);
  if v_error is not null then
    raise exception '%', v_error using errcode = '22023';
  end if;
  return v || jsonb_build_object(
    'players', jsonb_build_object('min', public.manifest_int(v->'players'->'min'),
                                  'max', public.manifest_int(v->'players'->'max')),
    'teams', public.manifest_int(v->'teams'),
    'votesToWin', public.manifest_int(v->'votesToWin'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.apps (slug) on delete cascade,
  version text not null check (version ~ '^\d+\.\d+\.\d+$' and char_length(version) <= 32),
  -- Community apps are served over https; relative URLs are official-only.
  url text not null check (url ~ '^https://[^/\s]+(/\S*)?$' or url ~ '^/\S*$'),
  manifest jsonb not null check (public.app_version_manifest_error(manifest) is null),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'rejected', 'published', 'retired')),
  notes text not null default '' check (char_length(notes) <= 2000),
  review_notes text check (char_length(review_notes) <= 2000),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  unique (app_slug, version)
);
create index if not exists app_versions_app_idx on public.app_versions (app_slug, created_at desc);
create index if not exists app_versions_queue_idx on public.app_versions (submitted_at) where status = 'in_review';
create unique index if not exists app_versions_one_published on public.app_versions (app_slug) where status = 'published';
alter table public.app_versions enable row level security;
revoke all on public.app_versions from public, anon, authenticated;

-- No referential action: versions are only ever deleted with their app.
alter table public.apps
  add column if not exists published_version_id uuid references public.app_versions (id);

create table if not exists public.app_testers (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (app_slug, user_id)
);
create index if not exists app_testers_user_idx on public.app_testers (user_id);
alter table public.app_testers enable row level security;
revoke all on public.app_testers from public, anon, authenticated;

-- version_id: a test build (non-published version). published_version_id:
-- the app's live version when the match was created (analytics breakdown).
alter table public.matches
  add column if not exists version_id uuid references public.app_versions (id),
  add column if not exists published_version_id uuid references public.app_versions (id);
create index if not exists matches_version_idx on public.matches (version_id) where version_id is not null;
create index if not exists matches_app_created_idx on public.matches (app_slug, created_at);

create table if not exists public.developer_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('version_approved', 'version_rejected', 'version_published')),
  app_slug text not null references public.apps (slug) on delete cascade,
  version_id uuid references public.app_versions (id),
  message text not null check (char_length(message) <= 2400),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists developer_notices_user_idx on public.developer_notices (user_id, created_at desc);
alter table public.developer_notices enable row level security;
revoke all on public.developer_notices from public, anon, authenticated;
grant select on public.developer_notices to authenticated;
drop policy if exists "developers read their notices" on public.developer_notices;
create policy "developers read their notices" on public.developer_notices
  for select to authenticated using (user_id = auth.uid());

create table if not exists public.app_logs (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.apps (slug) on delete cascade,
  version_id uuid references public.app_versions (id),
  match_id uuid references public.matches (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  message text not null check (char_length(message) between 1 and 500),
  data jsonb check (data is null or octet_length(data::text) <= 4096),
  source text not null default 'app' check (source in ('app', 'host')),
  created_at timestamptz not null default now()
);
create index if not exists app_logs_app_idx on public.app_logs (app_slug, created_at desc);
create index if not exists app_logs_match_idx on public.app_logs (match_id, created_at desc) where match_id is not null;
create index if not exists app_logs_created_idx on public.app_logs (created_at);
alter table public.app_logs enable row level security;
revoke all on public.app_logs from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Manifest <-> apps row
-- ---------------------------------------------------------------------------

create or replace function public.app_row_manifest(a public.apps)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', a.name, 'tagline', a.tagline, 'description', a.description, 'category', a.category,
    'icon', a.icon, 'accent', jsonb_build_array(a.accent_from, a.accent_to), 'modes', to_jsonb(a.modes),
    'players', jsonb_build_object('min', a.min_players, 'max', a.max_players), 'teams', a.team_count,
    'spectators', a.allow_spectators, 'setup', a.has_setup, 'turnBased', a.turn_based,
    'scoring', a.scoring, 'votesToWin', a.votes_to_win, 'howTo', to_jsonb(a.how_to),
    'stats', a.stats, 'achievements', a.achievements
  );
$$;

-- The app as a version describes it (a valid manifest + url).
create or replace function public.app_with_manifest(a public.apps, p jsonb, p_url text)
returns public.apps
language plpgsql
stable
set search_path = ''
as $$
begin
  a.name := p->>'name';
  a.tagline := p->>'tagline';
  a.description := p->>'description';
  a.category := p->>'category';
  a.icon := p->>'icon';
  a.accent_from := p->'accent'->>0;
  a.accent_to := p->'accent'->>1;
  a.modes := array(select jsonb_array_elements_text(p->'modes'));
  a.min_players := public.manifest_int(p->'players'->'min');
  a.max_players := public.manifest_int(p->'players'->'max');
  a.team_count := public.manifest_int(p->'teams');
  a.allow_spectators := (p->>'spectators')::boolean;
  a.has_setup := (p->>'setup')::boolean;
  a.turn_based := (p->>'turnBased')::boolean;
  a.scoring := p->>'scoring';
  a.votes_to_win := public.manifest_int(p->'votesToWin');
  a.how_to := array(select jsonb_array_elements_text(p->'howTo'));
  a.stats := p->'stats';
  a.achievements := p->'achievements';
  if p_url is not null then
    a.url := p_url;
  end if;
  return a;
end;
$$;

create or replace function public.app_version_json(v public.app_versions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when v.id is null then null else jsonb_build_object(
    'id', v.id, 'appSlug', v.app_slug, 'version', v.version, 'url', v.url, 'manifest', v.manifest,
    'status', v.status, 'notes', v.notes, 'reviewNotes', v.review_notes, 'createdAt', v.created_at,
    'submittedAt', v.submitted_at, 'reviewedAt', v.reviewed_at, 'publishedAt', v.published_at
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Triggers: guard published_version_id, register version 1.0.0, stamp matches
-- ---------------------------------------------------------------------------

-- Only publishing (a SECURITY DEFINER path) moves published_version_id.
create or replace function public.apps_guard_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.published_version_id := null;
  else
    new.published_version_id := old.published_version_id;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_guard_versions on public.apps;
create trigger apps_guard_versions
  before insert or update on public.apps
  for each row execute function public.apps_guard_versions();

-- Registering a community app (direct insert from the developer portal)
-- creates version 1.0.0 from its fields: in review for a pending app;
-- rows inserted already published/rejected (seeds, admins) get a
-- matching published/rejected version.
create or replace function public.apps_register_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := case new.status when 'published' then 'published' when 'rejected' then 'rejected' else 'in_review' end;
  v_id uuid;
begin
  if new.official or exists (select 1 from public.app_versions where app_slug = new.slug) then
    return null;
  end if;
  insert into public.app_versions (app_slug, version, url, manifest, status, notes, submitted_at, published_at)
  values (new.slug, '1.0.0', new.url, public.app_row_manifest(new), v_status, 'First version', now(),
          case when v_status = 'published' then now() end)
  returning id into v_id;
  if v_status = 'published' then
    update public.apps set published_version_id = v_id where slug = new.slug;
  end if;
  return null;
end;
$$;

drop trigger if exists apps_register_version on public.apps;
create trigger apps_register_version
  after insert on public.apps
  for each row execute function public.apps_register_version();

create or replace function public.matches_set_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.published_version_id := case
    when new.version_id is null then (select a.published_version_id from public.apps a where a.slug = new.app_slug)
  end;
  return new;
end;
$$;

drop trigger if exists matches_set_version on public.matches;
create trigger matches_set_version
  before insert on public.matches
  for each row execute function public.matches_set_version();

-- Existing community apps get their 1.0.0.
insert into public.app_versions (app_slug, version, url, manifest, status, notes, created_at, submitted_at, published_at)
select a.slug, '1.0.0', a.url, public.app_row_manifest(a),
       case a.status when 'published' then 'published' when 'rejected' then 'rejected' else 'in_review' end,
       'First version', a.created_at, a.created_at, case when a.status = 'published' then a.created_at end
  from public.apps a
 where not a.official and not exists (select 1 from public.app_versions v where v.app_slug = a.slug);
update public.apps a
   set published_version_id = v.id
  from public.app_versions v
 where v.app_slug = a.slug and v.status = 'published' and a.published_version_id is null;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_admin_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = p_user), false);
$$;

create or replace function public.can_test_app(p_app text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and (
    exists (select 1 from public.apps a where a.slug = p_app and a.developer_id = p_user)
    or exists (select 1 from public.app_testers t where t.app_slug = p_app and t.user_id = p_user)
  );
$$;

-- For RLS policies (run as the viewer).
create or replace function public.is_app_tester(p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_testers t where t.app_slug = p_app and t.user_id = auth.uid());
$$;

create or replace function public.can_view_test_match(p_match uuid, p_app text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_test_app(p_app, auth.uid()) or public.is_match_player(p_match, auth.uid());
$$;

-- The caller's community app (versions + testers).
create or replace function public.managed_app(p_app text)
returns public.apps
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
begin
  select * into a from public.apps where slug = p_app;
  if not found then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  if a.official then
    raise exception 'Official apps are managed in code' using errcode = '42501';
  end if;
  if a.developer_id is distinct from v_me then
    raise exception 'Only the app''s developer can manage its versions' using errcode = '42501';
  end if;
  return a;
end;
$$;

-- The caller's app, or any app for an admin (analytics, logs, versions list).
create or replace function public.insight_app(p_app text)
returns public.apps
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
begin
  select * into a from public.apps where slug = p_app;
  if not found then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  if a.developer_id is distinct from v_me and not public.is_admin_user(v_me) then
    raise exception 'Only the app''s developer can see this' using errcode = '42501';
  end if;
  return a;
end;
$$;

-- A version of the caller's community app (locked for update).
create or replace function public.managed_version(p_version_id uuid)
returns public.app_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions;
begin
  perform public.require_user();
  select * into v from public.app_versions where id = p_version_id for update;
  if not found then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  perform public.managed_app(v.app_slug);
  return v;
end;
$$;

-- The app to play: the published app (playable_app), or for a test build
-- the app as that version describes it (owner/testers, non-published only).
create or replace function public.play_app(p_app text, p_version uuid)
returns public.apps
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
  v public.app_versions;
begin
  if p_version is null then
    return public.playable_app(p_app);
  end if;
  select * into v from public.app_versions where id = p_version;
  if not found or v.app_slug is distinct from p_app then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if not public.can_test_app(p_app, v_me) then
    raise exception 'Only the developer and testers can play test builds' using errcode = '42501';
  end if;
  if v.status = 'published' then
    raise exception 'That version is live — play the app itself' using errcode = '22023';
  end if;
  select * into a from public.apps where slug = p_app;
  return public.app_with_manifest(a, v.manifest, v.url);
end;
$$;

-- ---------------------------------------------------------------------------
-- Versions (owner)
-- ---------------------------------------------------------------------------

create or replace function public.version_input_check(p_version text, p_url text, p_notes text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_version is not null and (p_version !~ '^\d+\.\d+\.\d+$' or char_length(p_version) > 32) then
    raise exception 'Versions look like 1.2.3' using errcode = '22023';
  end if;
  if p_url is not null and p_url !~ '^https://[^/\s]+(/\S*)?$' then
    raise exception 'The app URL must be https' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'Notes must be at most 2000 characters' using errcode = '22023';
  end if;
end;
$$;

-- Crowd-judged apps can't be server-authoritative (apps_authority_scoring_check).
create or replace function public.version_authority_check(a public.apps, p_manifest jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if a.authority = 'server' and p_manifest->>'scoring' = 'votes' then
    raise exception 'Crowd-judged apps can''t be server-authoritative' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_app_version(
  p_app text,
  p_version text,
  p_url text default null,
  p_manifest jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.managed_app(p_app);
  v_version text := btrim(coalesce(p_version, ''));
  v_url text := coalesce(nullif(btrim(coalesce(p_url, '')), ''), a.url);
  v_notes text := btrim(coalesce(p_notes, ''));
  v_manifest jsonb;
  v public.app_versions;
begin
  perform public.version_input_check(v_version, v_url, v_notes);
  v_manifest := public.app_version_manifest(coalesce(p_manifest, public.app_row_manifest(a)));
  if (select count(*) from public.app_versions where app_slug = a.slug) >= 200 then
    raise exception 'An app can have at most 200 versions' using errcode = '54000';
  end if;
  if exists (select 1 from public.app_versions where app_slug = a.slug and version = v_version) then
    raise exception 'Version % already exists', v_version using errcode = '23505';
  end if;
  insert into public.app_versions (app_slug, version, url, manifest, status, notes)
  values (a.slug, v_version, v_url, v_manifest, 'draft', v_notes)
  returning * into v;
  return public.app_version_json(v);
end;
$$;

-- null arguments keep the current value.
create or replace function public.update_app_version(
  p_version_id uuid,
  p_url text default null,
  p_manifest jsonb default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_notes text := btrim(p_notes);
begin
  if v.status not in ('draft', 'rejected') then
    raise exception 'Only drafts and rejected versions can be edited' using errcode = '55000';
  end if;
  perform public.version_input_check(null, v_url, v_notes);
  update public.app_versions
     set url = coalesce(v_url, url),
         manifest = case when p_manifest is null then manifest else public.app_version_manifest(p_manifest) end,
         notes = coalesce(v_notes, notes)
   where id = v.id
  returning * into v;
  return public.app_version_json(v);
end;
$$;

create or replace function public.submit_app_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
  a public.apps;
begin
  if v.status not in ('draft', 'rejected') then
    raise exception 'Only drafts and rejected versions can be submitted' using errcode = '55000';
  end if;
  select * into a from public.apps where slug = v.app_slug for update;
  perform public.version_authority_check(a, v.manifest);
  update public.app_versions set status = 'in_review', submitted_at = now() where id = v.id
  returning * into v;
  -- A new app that was turned down is back in review.
  if a.published_version_id is null and a.status = 'rejected' then
    update public.apps set status = 'pending', updated_at = now() where slug = a.slug;
  end if;
  return public.app_version_json(v);
end;
$$;

create or replace function public.withdraw_app_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
begin
  if v.status <> 'in_review' then
    raise exception 'Only versions in review can be withdrawn' using errcode = '55000';
  end if;
  update public.app_versions set status = 'draft', submitted_at = null where id = v.id
  returning * into v;
  return public.app_version_json(v);
end;
$$;

-- Internal: makes a version live. Copies its url + manifest onto the apps row,
-- retires the previous published version and publishes the app.
create or replace function public.publish_version(p_version_id uuid)
returns public.app_versions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions;
  a public.apps;
begin
  select * into v from public.app_versions where id = p_version_id for update;
  select * into a from public.apps where slug = v.app_slug for update;
  perform public.version_authority_check(a, v.manifest);
  update public.app_versions set status = 'retired' where app_slug = v.app_slug and status = 'published' and id <> v.id;
  update public.app_versions set status = 'published', published_at = now() where id = v.id
  returning * into v;
  a := public.app_with_manifest(a, v.manifest, v.url);
  update public.apps
     set name = a.name, tagline = a.tagline, description = a.description, category = a.category,
         icon = a.icon, accent_from = a.accent_from, accent_to = a.accent_to, url = a.url, modes = a.modes,
         min_players = a.min_players, max_players = a.max_players, team_count = a.team_count,
         allow_spectators = a.allow_spectators, has_setup = a.has_setup, turn_based = a.turn_based,
         scoring = a.scoring, votes_to_win = a.votes_to_win, how_to = a.how_to,
         stats = a.stats, achievements = a.achievements,
         published_version_id = v.id, status = 'published', updated_at = now()
   where slug = a.slug;
  return v;
end;
$$;

create or replace function public.publish_app_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.app_versions := public.managed_version(p_version_id);
begin
  if v.status <> 'approved' then
    raise exception 'Only approved versions can be published' using errcode = '55000';
  end if;
  return public.app_version_json(public.publish_version(v.id));
end;
$$;

-- Newest first. The developer, or an admin.
create or replace function public.list_app_versions(p_app text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.insight_app(p_app);
  result jsonb;
begin
  select coalesce(jsonb_agg(public.app_version_json(v) order by v.created_at desc, v.id), '[]'::jsonb)
    into result
    from public.app_versions v
   where v.app_slug = a.slug;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Testers (owner)
-- ---------------------------------------------------------------------------

create or replace function public.app_testers_json(p_app text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.profile_json(p) order by t.added_at, p.handle), '[]'::jsonb)
    from public.app_testers t
    join public.profiles p on p.id = t.user_id
   where t.app_slug = p_app;
$$;

create or replace function public.list_app_testers(p_app text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.managed_app(p_app);
begin
  return public.app_testers_json(a.slug);
end;
$$;

create or replace function public.add_app_tester(p_app text, p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.managed_app(p_app);
  v_handle text := lower(ltrim(btrim(coalesce(p_handle, '')), '@'));
  v_user uuid;
begin
  if v_handle = '' then
    raise exception 'Enter a handle' using errcode = '22023';
  end if;
  select id into v_user from public.profiles where handle = v_handle and not is_bot;
  if v_user is null then
    raise exception '@% hasn''t joined XApps yet', v_handle using errcode = 'P0002';
  end if;
  if v_user = a.developer_id then
    raise exception 'You can already test your own app' using errcode = '22023';
  end if;
  if not exists (select 1 from public.app_testers where app_slug = a.slug and user_id = v_user)
     and (select count(*) from public.app_testers where app_slug = a.slug) >= 50 then
    raise exception 'An app can have at most 50 testers' using errcode = '54000';
  end if;
  insert into public.app_testers (app_slug, user_id) values (a.slug, v_user) on conflict do nothing;
  return public.app_testers_json(a.slug);
end;
$$;

-- Idempotent: removing someone who isn't a tester just returns the list.
create or replace function public.remove_app_tester(p_app text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.managed_app(p_app);
begin
  delete from public.app_testers where app_slug = a.slug and user_id = p_user;
  return public.app_testers_json(a.slug);
end;
$$;

-- Testers can read the apps row of an app they test (e.g. still in review).
drop policy if exists "testers see apps they test" on public.apps;
create policy "testers see apps they test" on public.apps
  for select using (public.is_app_tester(slug));

-- ---------------------------------------------------------------------------
-- Review queue (admins) + developer notices
-- ---------------------------------------------------------------------------

-- The apps row as the web reads it (select *, developer:profiles(handle, name)).
create or replace function public.app_row_json(a public.apps)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(a) || jsonb_build_object('developer', (
    select jsonb_build_object('handle', p.handle, 'name', p.name) from public.profiles p where p.id = a.developer_id
  ));
$$;

create or replace function public.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
begin
  if not public.is_admin_user(v_me) then
    raise exception 'Only reviewers can do that' using errcode = '42501';
  end if;
  return v_me;
end;
$$;

-- In-review versions, oldest submission first:
-- [{ version, app (apps row + developer), developer (profile|null), published (version|null) }].
create or replace function public.list_review_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_admin();
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'version', public.app_version_json(v),
           'app', public.app_row_json(a),
           'developer', (select public.profile_json(p) from public.profiles p where p.id = a.developer_id),
           'published', (select public.app_version_json(pv) from public.app_versions pv where pv.id = a.published_version_id)
         ) order by v.submitted_at, v.created_at, v.id), '[]'::jsonb)
    into result
    from public.app_versions v
    join public.apps a on a.slug = v.app_slug
   where v.status = 'in_review';
  return result;
end;
$$;

create or replace function public.notify_developer(a public.apps, v public.app_versions, p_kind text, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if a.developer_id is null then
    return;
  end if;
  insert into public.developer_notices (user_id, kind, app_slug, version_id, message)
  values (a.developer_id, p_kind, a.slug, v.id, left(p_message, 2400));
end;
$$;

-- approve: in_review -> approved (and, for an app with nothing published yet,
-- straight to published: the app goes live). reject: -> rejected, notes
-- required (an app with nothing published is marked rejected).
create or replace function public.review_app_version(p_version_id uuid, p_decision text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_admin();
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v public.app_versions;
  a public.apps;
  v_label text;
begin
  select * into v from public.app_versions where id = p_version_id for update;
  if not found then
    raise exception 'Version not found' using errcode = 'P0002';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Decide approve or reject' using errcode = '22023';
  end if;
  if v.status <> 'in_review' then
    raise exception 'This version isn''t in review' using errcode = '55000';
  end if;
  if p_decision = 'reject' and v_notes is null then
    raise exception 'Tell the developer why' using errcode = '22023';
  end if;
  if char_length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Notes must be at most 2000 characters' using errcode = '22023';
  end if;

  select * into a from public.apps where slug = v.app_slug for update;
  v_label := a.name || ' ' || v.version;
  update public.app_versions
     set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
         reviewed_at = now(), reviewed_by = v_me, review_notes = v_notes
   where id = v.id
  returning * into v;

  if p_decision = 'approve' then
    if a.published_version_id is null then
      v := public.publish_version(v.id);
      perform public.notify_developer(a, v, 'version_published',
        v_label || ' was approved and is now live.' || coalesce(' Reviewer notes: ' || v_notes, ''));
    else
      perform public.notify_developer(a, v, 'version_approved',
        v_label || ' was approved. Publish it when you''re ready.' || coalesce(' Reviewer notes: ' || v_notes, ''));
    end if;
  else
    if a.published_version_id is null then
      update public.apps set status = 'rejected', updated_at = now() where slug = a.slug;
    end if;
    perform public.notify_developer(a, v, 'version_rejected', v_label || ' was not approved: ' || v_notes);
  end if;
  return public.app_version_json(v);
end;
$$;

-- Newest first: [{ id, kind, appSlug, versionId, version, message, createdAt, readAt }].
create or replace function public.list_my_notices(p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  result jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id), '[]'::jsonb) into result
    from (
      select n.id, n.created_at, jsonb_build_object(
               'id', n.id, 'kind', n.kind, 'appSlug', n.app_slug, 'versionId', n.version_id,
               'version', v.version, 'message', n.message, 'createdAt', n.created_at, 'readAt', n.read_at) as j
        from public.developer_notices n
        left join public.app_versions v on v.id = n.version_id
       where n.user_id = v_me
       order by n.created_at desc, n.id
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) x;
  return result;
end;
$$;

-- Marks the given notices (default: all unread) read; returns how many changed.
create or replace function public.mark_notices_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  n integer;
begin
  update public.developer_notices
     set read_at = now()
   where user_id = v_me and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test builds: match JSON
-- ---------------------------------------------------------------------------

create or replace function public.match_json(m public.matches, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'appSlug', m.app_slug, 'mode', m.mode, 'status', m.status, 'scoring', m.scoring,
    'seed', m.seed, 'createdBy', m.created_by, 'createdAt', m.created_at,
    'startedAt', m.started_at, 'endedAt', m.ended_at, 'winnerId', m.winner_id,
    'isOpen', m.is_open, 'settings', m.settings, 'votes', m.votes,
    'votesNeeded', m.votes_needed, 'votingEndsAt', m.voting_ends_at,
    'simulatedVotes', m.simulated_votes,
    'minPlayers', m.min_players, 'maxPlayers', m.max_players, 'teams', m.team_count,
    'state', m.state, 'stateVersion', m.state_version,
    'turnUserId', m.turn_user, 'turnDeadline', m.turn_deadline,
    'round', m.round, 'winnerTeam', m.winner_team,
    'versionId', m.version_id,
    'versionUrl', (select v.url from public.app_versions v where v.id = m.version_id),
    'spectatorCount', (
      select count(*) from public.match_players sp where sp.match_id = m.id and sp.role = 'spectator'
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', mp.user_id, 'seat', mp.seat, 'team', mp.team, 'role', mp.role, 'rank', mp.rank,
        'state', mp.state, 'isBot', mp.is_bot,
        'score', mp.score, 'result', mp.result, 'xpDelta', mp.xp_delta, 'lastSeenAt', mp.last_seen_at,
        'submission', case
          when s.match_id is null then null
          when mp.user_id = p_viewer
            or m.status in ('voting', 'completed')
            or (m.mode = 'practice' and m.created_by = p_viewer)
            then jsonb_build_object('data', s.data, 'display', s.display)
          else null
        end,
        'profile', public.profile_json(p)
      ) order by mp.seat nulls last)
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.submissions s on s.match_id = mp.match_id and s.user_id = mp.user_id
      where mp.match_id = m.id and (mp.role = 'player' or mp.user_id = p_viewer)
    ), '[]'::jsonb)
  );
$$;

-- The app server's view gains versionId/versionUrl too (test builds reach
-- webhooks and the server API like any match; they just never touch rank).
create or replace function public.app_match_json(m public.matches)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'appSlug', m.app_slug, 'mode', m.mode, 'status', m.status, 'scoring', m.scoring,
    'seed', m.seed, 'createdBy', m.created_by, 'createdAt', m.created_at,
    'startedAt', m.started_at, 'endedAt', m.ended_at, 'winnerId', m.winner_id,
    'isOpen', m.is_open, 'settings', m.settings, 'votes', m.votes,
    'votesNeeded', m.votes_needed, 'votingEndsAt', m.voting_ends_at,
    'simulatedVotes', m.simulated_votes,
    'minPlayers', m.min_players, 'maxPlayers', m.max_players, 'teams', m.team_count,
    'state', m.state, 'stateVersion', m.state_version,
    'turnUserId', m.turn_user, 'turnDeadline', m.turn_deadline,
    'round', m.round, 'winnerTeam', m.winner_team,
    'authority', m.authority, 'endReason', m.end_reason,
    'versionId', m.version_id,
    'versionUrl', (select v.url from public.app_versions v where v.id = m.version_id),
    'spectatorCount', (
      select count(*) from public.match_players sp where sp.match_id = m.id and sp.role = 'spectator'
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', mp.user_id, 'seat', mp.seat, 'team', mp.team, 'role', mp.role, 'rank', mp.rank,
        'state', mp.state, 'isBot', mp.is_bot,
        'score', mp.score, 'claimedScore', mp.claimed_score,
        'result', mp.result, 'xpDelta', mp.xp_delta, 'lastSeenAt', mp.last_seen_at,
        'submission', case
          when s.match_id is null then null
          else jsonb_build_object('data', s.data, 'display', s.display)
        end,
        'profile', public.profile_json(p)
      ) order by mp.seat)
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.submissions s on s.match_id = mp.match_id and s.user_id = mp.user_id
      where mp.match_id = m.id and mp.role = 'player'
    ), '[]'::jsonb)
  );
$$;

-- Test builds are private to the developer, testers and their players.
drop policy if exists "test builds are private" on public.matches;
create policy "test builds are private" on public.matches
  as restrictive for select
  using (version_id is null or public.can_view_test_match(id, app_slug));

-- ---------------------------------------------------------------------------
-- Test builds: settlement never touches XP, rank, stats or play count
-- ---------------------------------------------------------------------------

-- As stage 2, plus: test builds (version_id set) award nothing (0 XP, no
-- profile/app stats, no play_count) but still get ranks and results.
create or replace function public.award_placements(p_match uuid, p_draw boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  r record;
  v_winner uuid;
  v_winner_team integer;
  v_top integer;
  v_maxrank integer;
  v_result text;
  v_xp integer;
  v_ranked boolean;
  v_test boolean;
begin
  select * into m from public.matches where id = p_match;
  v_test := m.version_id is not null;

  if m.team_count > 0 then
    select count(distinct mp.team) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 and not p_draw then
      select mp.team into v_winner_team
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1
       limit 1;
    end if;
  else
    select count(*) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 and not p_draw then
      select mp.user_id into v_winner
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    end if;
  end if;

  select max(mp.rank) into v_maxrank
    from public.match_players mp
   where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined';

  update public.matches
     set status = 'completed', winner_id = v_winner, winner_team = v_winner_team,
         turn_deadline = null, ended_at = now(), updated_at = now()
   where id = p_match;
  if not v_test then
    update public.apps set play_count = play_count + 1 where slug = m.app_slug;
  end if;

  v_ranked := m.mode <> 'practice' and not v_test;
  for r in
    select * from public.match_players
     where match_id = p_match and role = 'player' and state <> 'declined'
  loop
    v_result := case when r.rank = 1 and v_top = 1 and not p_draw then 'win' when r.rank = 1 then 'draw' else 'loss' end;
    v_xp := case
      when r.is_bot or v_test then 0
      when not v_ranked then 3
      when p_draw then case when r.rank = 1 then 15 else 8 end
      when coalesce(v_maxrank, 1) <= 1 then 15
      else round(30 - (r.rank - 1) * 22.0 / (v_maxrank - 1))::integer
    end;
    update public.match_players set result = v_result, xp_delta = v_xp
     where match_id = p_match and user_id = r.user_id;
    continue when r.is_bot or v_test;

    update public.profiles
       set xp = xp + v_xp,
           wins = wins + (v_ranked and v_result = 'win')::integer,
           losses = losses + (v_ranked and v_result = 'loss')::integer,
           draws = draws + (v_ranked and v_result = 'draw')::integer,
           streak = case when not v_ranked then streak when v_result = 'win' then streak + 1 when v_result = 'loss' then 0 else streak end,
           best_streak = greatest(best_streak, case when v_ranked and v_result = 'win' then streak + 1 else 0 end),
           updated_at = now()
     where id = r.user_id;

    if v_ranked then
      insert into public.app_player_stats as s (app_slug, user_id, played, wins, losses, draws, xp)
      values (m.app_slug, r.user_id, 1, (v_result = 'win')::integer, (v_result = 'loss')::integer,
              (v_result = 'draw')::integer, v_xp)
      on conflict (app_slug, user_id) do update
         set played = s.played + 1, wins = s.wins + excluded.wins, losses = s.losses + excluded.losses,
             draws = s.draws + excluded.draws, xp = s.xp + excluded.xp;
    end if;
  end loop;
end;
$$;

-- Turn-based per the test build's manifest when there is one.
create or replace function public.set_first_turn(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_first uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.turn_user is not null
     or not coalesce(
       (select (v.manifest->>'turnBased')::boolean from public.app_versions v where v.id = m.version_id),
       (select a.turn_based from public.apps a where a.slug = m.app_slug),
       false) then
    return;
  end if;
  select mp.user_id into v_first
    from public.match_players mp
   where mp.match_id = p_match and mp.role = 'player' and mp.state in ('joined', 'submitted')
   order by mp.seat
   limit 1;
  if v_first is null then
    return;
  end if;
  update public.matches
     set turn_user = v_first,
         turn_deadline = case when mode = 'async' then now() + interval '3 days' end
   where id = p_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test builds: creating matches (p_version)
-- ---------------------------------------------------------------------------

drop function if exists public.create_challenge(text, text, text, jsonb, text[], integer);

-- As stage 1, plus p_version: a test build of that app (developer/testers
-- only, every invitee must be a tester too).
create or replace function public.create_challenge(
  p_app text,
  p_mode text,
  p_opponent text default null,
  p_settings jsonb default '{}'::jsonb,
  p_opponents text[] default null,
  p_max_players integer default null,
  p_version uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.play_app(p_app, p_version);
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_teams integer := coalesce(a.team_count, 0);
  v_raw text;
  v_handle text;
  v_handles text[] := '{}';
  v_ids uuid[] := '{}';
  v_opp uuid;
  v_k integer;
  v_max integer;
  v_min integer;
  v_id uuid;
  i integer;
begin
  if p_mode not in ('live', 'async') or not (p_mode = any (a.modes)) then
    raise exception '% doesn''t support % play', a.name, p_mode using errcode = '22023';
  end if;
  if jsonb_typeof(v_settings) <> 'object' then
    raise exception 'Challenge settings must be an object' using errcode = '22023';
  end if;
  if octet_length(v_settings::text) > 4096 then
    raise exception 'Challenge settings are too large' using errcode = '22023';
  end if;
  -- Reserved for the platform.
  v_settings := v_settings - 'quick';

  if cardinality(coalesce(p_opponents, '{}')) > 16 then
    raise exception 'Too many invites' using errcode = '22023';
  end if;
  foreach v_raw in array array_prepend(p_opponent, coalesce(p_opponents, '{}'::text[])) loop
    v_handle := lower(ltrim(btrim(coalesce(v_raw, '')), '@'));
    continue when v_handle = '' or v_handle = any (v_handles);
    v_handles := v_handles || v_handle;
    select id into v_opp from public.profiles where handle = v_handle and not is_bot;
    if v_opp is null then
      raise exception '@% hasn''t joined XApps yet', v_handle using errcode = 'P0002';
    end if;
    if v_opp = v_me then
      raise exception 'You can''t challenge yourself' using errcode = '22023';
    end if;
    if p_version is not null and not public.can_test_app(a.slug, v_opp) then
      raise exception '@% isn''t a tester of this app', v_handle using errcode = '22023';
    end if;
    if not (v_opp = any (v_ids)) then
      v_ids := v_ids || v_opp;
    end if;
  end loop;
  v_k := cardinality(v_ids);
  if v_k > a.max_players - 1 then
    raise exception 'You can invite up to % % to %', a.max_players - 1,
      case when a.max_players = 2 then 'person' else 'people' end, a.name using errcode = '22023';
  end if;

  if p_max_players is not null then
    if p_max_players < a.min_players or p_max_players > a.max_players then
      raise exception '% is played by % to % players', a.name, a.min_players, a.max_players using errcode = '22023';
    end if;
    if v_teams > 0 and p_max_players % v_teams <> 0 then
      raise exception 'Pick a table size that splits into % teams', v_teams using errcode = '22023';
    end if;
    if p_max_players < v_k + 1 then
      raise exception 'That table is too small for everyone you invited' using errcode = '22023';
    end if;
    v_max := p_max_players;
  elsif v_k = 0 then
    v_max := a.max_players;
  else
    v_max := greatest(v_k + 1, a.min_players);
    if v_teams > 0 then
      v_max := least(a.max_players, ((v_max + v_teams - 1) / v_teams) * v_teams);
    end if;
  end if;
  v_min := least(v_max, greatest(a.min_players, v_teams));

  if (select count(*) from public.matches
       where created_by = v_me and status in ('open', 'pending')
         and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many open challenges — finish a few first' using errcode = '54000';
  end if;

  insert into public.matches
    (app_slug, mode, status, scoring, created_by, is_open, votes_needed, settings,
     min_players, max_players, team_count, version_id)
  values (a.slug, p_mode, case when v_k + 1 >= v_max then 'pending' else 'open' end, a.scoring, v_me,
          v_k + 1 < v_max, a.votes_to_win, v_settings, v_min, v_max, v_teams, p_version)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, team, state)
  values (v_id, v_me, 0, case when v_teams > 0 then 0 end, 'joined');
  for i in 1 .. v_k loop
    insert into public.match_players (match_id, user_id, seat, team, state)
    values (v_id, v_ids[i], i, case when v_teams > 0 then i % v_teams end, 'invited');
  end loop;
  return v_id;
end;
$$;

drop function if exists public.quick_match(text);

-- Quick lobbies only pair people on the same version (null = the live app).
create or replace function public.quick_match(p_app text, p_version uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.play_app(p_app, p_version);
  v_id uuid;
begin
  -- Already waiting in a lobby with company.
  select m.id into v_id
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.user_id = v_me and mp.role = 'player'
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick
     and m.version_id is not distinct from p_version
     and m.created_at > now() - interval '10 minutes'
     and (select count(*) from public.match_players x where x.match_id = m.id and x.role = 'player') >= 2
   order by m.created_at
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- Join someone else's lobby with a free seat.
  select m.id into v_id
    from public.matches m
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick and m.is_open
     and m.version_id is not distinct from p_version
     and m.created_at > now() - interval '10 minutes'
     and not exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = v_me)
     and (select count(*) from public.match_players mp where mp.match_id = m.id and mp.role = 'player') < m.max_players
   order by m.created_at
   limit 1
   for update skip locked;
  if v_id is not null then
    -- My own empty lobby is no longer needed.
    update public.matches m set status = 'cancelled', updated_at = now()
     where m.app_slug = a.slug and m.status = 'open' and m.is_quick and m.created_by = v_me
       and m.version_id is not distinct from p_version
       and (select count(*) from public.match_players mp where mp.match_id = m.id and mp.role = 'player') < 2;
    perform public.seat_player(v_id, v_me);
    perform public.try_activate(v_id);
    update public.matches set updated_at = now() where id = v_id;
    return v_id;
  end if;

  select m.id into v_id
    from public.matches m
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick and m.created_by = v_me
     and m.version_id is not distinct from p_version
     and m.created_at > now() - interval '10 minutes'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.matches
    (app_slug, mode, status, scoring, created_by, is_open, is_quick, votes_needed,
     min_players, max_players, team_count, version_id)
  values (a.slug, case when 'live' = any (a.modes) then 'live' else 'async' end, 'open', a.scoring, v_me,
          true, true, a.votes_to_win,
          least(a.max_players, greatest(a.min_players, a.team_count)), a.max_players, a.team_count, p_version)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, team, state)
  values (v_id, v_me, 0, case when a.team_count > 0 then 0 end, 'joined');
  return v_id;
end;
$$;

drop function if exists public.start_practice(text, integer);

create or replace function public.start_practice(p_app text, p_players integer default null, p_version uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.play_app(p_app, p_version);
  v_bots uuid[] := array[
    '00000000-0000-4000-8000-00000000b075', '00000000-0000-4000-8000-00000000b076',
    '00000000-0000-4000-8000-00000000b077', '00000000-0000-4000-8000-00000000b078',
    '00000000-0000-4000-8000-00000000b079', '00000000-0000-4000-8000-00000000b07a',
    '00000000-0000-4000-8000-00000000b07b'
  ]::uuid[];
  v_n integer := coalesce(p_players, least(a.max_players, greatest(a.min_players, a.team_count)));
  v_id uuid;
  i integer;
begin
  if v_n < a.min_players or v_n > a.max_players or v_n < a.team_count then
    raise exception '% is played by % to % players', a.name, a.min_players, a.max_players using errcode = '22023';
  end if;
  if (select count(*) from public.matches where created_by = v_me and mode = 'practice'
        and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Take a breather — practice limit reached' using errcode = '54000';
  end if;
  insert into public.matches
    (app_slug, mode, status, scoring, created_by, votes_needed, simulated_votes,
     min_players, max_players, team_count, version_id)
  values (a.slug, 'practice', 'active', a.scoring, v_me, 5, a.scoring = 'votes',
          least(v_n, greatest(a.min_players, a.team_count)), v_n, a.team_count, p_version)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, team, state)
  values (v_id, v_me, 0, case when a.team_count > 0 then 0 end, 'joined');
  for i in 1 .. v_n - 1 loop
    insert into public.match_players (match_id, user_id, seat, team, state, is_bot)
    values (v_id, v_bots[i], i, case when a.team_count > 0 then i % a.team_count end, 'joined', true);
  end loop;
  perform public.set_first_turn(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Test builds: joining, inviting, watching, judging, reading
-- ---------------------------------------------------------------------------

create or replace function public.join_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_row public.match_players;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or (m.mode = 'practice' and m.created_by <> v_me) then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if m.version_id is not null and not public.can_test_app(m.app_slug, v_me) then
    raise exception 'Only testers can join test builds' using errcode = '42501';
  end if;
  select * into v_row from public.match_players where match_id = p_match and user_id = v_me;
  if v_row.user_id is not null and v_row.role = 'player' then
    if v_row.state = 'invited' then
      if not (m.status in ('open', 'pending') or (m.status = 'active' and m.mode = 'async')) then
        raise exception 'This challenge is no longer open' using errcode = '55000';
      end if;
      update public.match_players set state = 'joined', joined_at = now()
       where match_id = p_match and user_id = v_me;
    end if;
  elsif m.is_open and m.mode <> 'practice'
        and (m.status = 'open' or (m.status = 'active' and m.mode = 'async'))
        and (select count(*) from public.match_players where match_id = p_match and role = 'player') < m.max_players then
    perform public.seat_player(p_match, v_me);
  else
    raise exception 'This challenge is no longer open' using errcode = '55000';
  end if;

  perform public.try_activate(p_match);
  update public.matches set updated_at = now() where id = p_match;
end;
$$;

create or replace function public.invite_to_match(p_match uuid, p_handles text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_raw text;
  v_handle text;
  v_handles text[] := '{}';
  v_ids uuid[] := '{}';
  v_opp uuid;
  v_free integer;
  v_seat integer;
  i integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.mode = 'practice' then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state in ('joined', 'submitted')
  ) then
    raise exception 'Only seated players can invite' using errcode = '42501';
  end if;
  if not (m.status in ('open', 'pending') or (m.status = 'active' and m.mode = 'async')) then
    raise exception 'This match has already started' using errcode = '55000';
  end if;
  if cardinality(coalesce(p_handles, '{}')) > 16 then
    raise exception 'Too many invites' using errcode = '22023';
  end if;

  foreach v_raw in array coalesce(p_handles, '{}'::text[]) loop
    v_handle := lower(ltrim(btrim(coalesce(v_raw, '')), '@'));
    continue when v_handle = '' or v_handle = any (v_handles);
    v_handles := v_handles || v_handle;
    select id into v_opp from public.profiles where handle = v_handle and not is_bot;
    if v_opp is null then
      raise exception '@% hasn''t joined XApps yet', v_handle using errcode = 'P0002';
    end if;
    if v_opp = v_me then
      raise exception 'You can''t challenge yourself' using errcode = '22023';
    end if;
    if m.version_id is not null and not public.can_test_app(m.app_slug, v_opp) then
      raise exception '@% isn''t a tester of this app', v_handle using errcode = '22023';
    end if;
    if exists (select 1 from public.match_players
                where match_id = p_match and user_id = v_opp and role = 'player') then
      raise exception '@% is already in this match', v_handle using errcode = '22023';
    end if;
    if not (v_opp = any (v_ids)) then
      v_ids := v_ids || v_opp;
    end if;
  end loop;
  if cardinality(v_ids) = 0 then
    raise exception 'Nobody to invite' using errcode = '22023';
  end if;
  v_free := m.max_players - (select count(*) from public.match_players where match_id = p_match and role = 'player');
  if cardinality(v_ids) > v_free then
    raise exception 'Only % free % left', v_free, case when v_free = 1 then 'seat' else 'seats' end
      using errcode = '22023';
  end if;

  for i in 1 .. cardinality(v_ids) loop
    select min(s) into v_seat
      from generate_series(0, m.max_players - 1) s
     where not exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.seat = s);
    insert into public.match_players (match_id, user_id, seat, team, role, state)
    values (p_match, v_ids[i], v_seat, case when m.team_count > 0 then v_seat % m.team_count end, 'player', 'invited')
    on conflict (match_id, user_id) do update
       set seat = excluded.seat, team = excluded.team, role = 'player', state = 'invited', joined_at = now();
  end loop;
  update public.matches
     set is_open = is_open and cardinality(v_ids) < v_free, updated_at = now()
   where id = p_match;
end;
$$;

create or replace function public.spectate_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or (m.mode = 'practice' and m.created_by <> v_me) then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.match_players where match_id = p_match and user_id = v_me) then
    return;
  end if;
  if m.mode = 'practice' then
    raise exception 'Practice matches can''t be watched' using errcode = '42501';
  end if;
  if m.version_id is not null and not public.can_test_app(m.app_slug, v_me) then
    raise exception 'Only testers can watch test builds' using errcode = '42501';
  end if;
  if not coalesce(
       (select (v.manifest->>'spectators')::boolean from public.app_versions v where v.id = m.version_id),
       (select allow_spectators from public.apps where slug = m.app_slug),
       false) then
    raise exception 'This app doesn''t allow spectators' using errcode = '42501';
  end if;
  if m.status not in ('open', 'pending', 'active', 'voting') then
    raise exception 'This match is over' using errcode = '55000';
  end if;
  insert into public.match_players (match_id, user_id, seat, role, state)
  values (p_match, v_me, null, 'spectator', 'joined');
end;
$$;

-- Test builds: only testers judge, and judging earns no XP.
create or replace function public.cast_vote(p_match uuid, p_choice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_count integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'voting' or m.mode = 'practice' then
    raise exception 'Voting is closed' using errcode = '55000';
  end if;
  if exists (select 1 from public.match_players where match_id = p_match and user_id = v_me and role = 'player') then
    raise exception 'You can''t judge your own match' using errcode = '42501';
  end if;
  if m.version_id is not null and not public.can_test_app(m.app_slug, v_me) then
    raise exception 'Only testers can judge test builds' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = p_choice and role = 'player' and state = 'submitted'
  ) then
    raise exception 'Invalid choice' using errcode = '22023';
  end if;
  begin
    insert into public.votes (match_id, voter_id, choice_id) values (p_match, v_me, p_choice);
  exception when unique_violation then
    raise exception 'You already voted' using errcode = '55000';
  end;
  v_count := coalesce((m.votes ->> p_choice::text)::integer, 0) + 1;
  update public.matches
     set votes = jsonb_set(votes, array[p_choice::text], to_jsonb(v_count)), updated_at = now()
   where id = p_match;
  if m.version_id is null then
    update public.profiles set xp = xp + 2 where id = v_me;
  end if;
  if v_count >= m.votes_needed then
    perform public.settle_match(p_match);
  end if;
end;
$$;

create or replace function public.get_match(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if not found then
    return null;
  end if;
  if m.version_id is not null and not public.can_view_test_match(m.id, m.app_slug) then
    return null;
  end if;
  if m.status = 'voting' and m.voting_ends_at < now() then
    perform public.settle_match(p_match);
    select * into m from public.matches where id = p_match;
  elsif m.status = 'active' and m.turn_deadline < now() then
    perform public.expire_turn(p_match);
    select * into m from public.matches where id = p_match;
  end if;
  if m.mode = 'practice' and m.created_by is distinct from auth.uid() then
    return null;
  end if;
  return public.match_json(m, auth.uid());
end;
$$;

-- Public feeds leave test builds out (list_my_matches keeps them, labelled
-- by versionId).
create or replace function public.list_voting_matches()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  result jsonb;
begin
  perform public.finalize_due_matches();
  select coalesce(jsonb_agg(public.match_json(m, v_me) order by m.updated_at desc), '[]'::jsonb) into result
    from (
      select m.* from public.matches m
       where m.status = 'voting' and m.mode <> 'practice' and m.version_id is null
         and (v_me is null or not exists (select 1 from public.match_players mp
                                           where mp.match_id = m.id and mp.user_id = v_me and mp.role = 'player'))
         and (v_me is null or not exists (select 1 from public.votes v where v.match_id = m.id and v.voter_id = v_me))
       order by m.updated_at desc
       limit 30
    ) m;
  return result;
end;
$$;

create or replace function public.list_recent_activity()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.match_json(m, auth.uid()) order by m.updated_at desc), '[]'::jsonb)
    from (
      select m.* from public.matches m
       where m.mode <> 'practice' and m.version_id is null and m.status in ('completed', 'voting', 'active')
         and (select count(*) from public.match_players mp where mp.match_id = m.id and mp.role = 'player') >= 2
       order by m.updated_at desc
       limit 30
    ) m;
$$;

create or replace function public.list_user_matches(p_user uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.match_json(m, auth.uid()) order by m.updated_at desc), '[]'::jsonb)
    from (
      select m.* from public.matches m
       where m.mode <> 'practice' and m.version_id is null and m.status in ('completed', 'voting', 'active')
         and exists (select 1 from public.match_players mp
                      where mp.match_id = m.id and mp.user_id = p_user and mp.role = 'player')
       order by m.updated_at desc
       limit 20
    ) m;
$$;

-- ---------------------------------------------------------------------------
-- Analytics (owner or admin)
-- ---------------------------------------------------------------------------

-- AppAnalytics for the last p_days UTC days (1–365, today included). Every
-- match of the app counts (live, async, practice) except test builds.
--  * series: per day, matchesCreated (by created_at), matchesCompleted (by
--    ended_at), matchesAbandoned (created that day and now cancelled/
--    declined/expired), players (distinct humans seated in matches created
--    that day; not bots, open invites or declines), newPlayers (humans whose
--    first match of the app was created that day). Missing days are zeros.
--  * totals: matches/completed/newPlayers = sums of the series, players =
--    distinct humans over the window.
--  * completionRate: of matches created in the window, the share completed
--    (0 when none).
--  * medianDurationSec: of matches completed in the window that were
--    started, ended_at − started_at in whole seconds; null when none.
--  * modes / tableSizes (max_players) of matches created in the window.
--  * retention (UTC days): of players whose first match falls in the window
--    and is at least 1 (7) days back, the share who played again on a day
--    1+ (7+) days after it; null when nobody qualifies.
--  * topPlayers: top 10 humans by matches in the window (then wins, handle).
--  * versions: matches created in the window by the version live at the
--    time (versionId null = before versioning).
create or replace function public.app_analytics(p_app text, p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.insight_app(p_app);
  v_days integer := coalesce(p_days, 30);
  v_today date := (now() at time zone 'utc')::date;
  v_from date;
  v_start timestamptz;
  result jsonb;
begin
  if v_days < 1 or v_days > 365 then
    raise exception 'Pick 1 to 365 days' using errcode = '22023';
  end if;
  v_from := v_today - (v_days - 1);
  v_start := v_from::timestamp at time zone 'utc';

  with m as (
    select x.id, x.mode, x.status, x.created_at, x.started_at, x.ended_at, x.updated_at, x.max_players,
           x.published_version_id
      from public.matches x
     where x.app_slug = a.slug and x.version_id is null
  ),
  -- Humans who took a seat (bots, spectators, open invites and declines don't count).
  s as (
    select mp.match_id, mp.user_id, mp.result, m.created_at
      from public.match_players mp
      join m on m.id = mp.match_id
     where mp.role = 'player' and not mp.is_bot and mp.state in ('joined', 'submitted', 'left')
  ),
  firsts as (
    select s.user_id, min(s.created_at) as first_at, min((s.created_at at time zone 'utc')::date) as first_day
      from s group by s.user_id
  ),
  days as (
    select d::date as day from generate_series(v_from::timestamp, v_today::timestamp, interval '1 day') d
  ),
  created as (
    select (m.created_at at time zone 'utc')::date as day, count(*) as n
      from m where m.created_at >= v_start group by 1
  ),
  completed as (
    select (m.ended_at at time zone 'utc')::date as day, count(*) as n
      from m where m.status = 'completed' and m.ended_at >= v_start group by 1
  ),
  abandoned as (
    select (m.created_at at time zone 'utc')::date as day, count(*) as n
      from m
     where m.status in ('cancelled', 'declined', 'expired') and m.created_at >= v_start
     group by 1
  ),
  players as (
    select (s.created_at at time zone 'utc')::date as day, count(distinct s.user_id) as n
      from s where s.created_at >= v_start group by 1
  ),
  newcomers as (
    select (f.first_at at time zone 'utc')::date as day, count(*) as n
      from firsts f where f.first_at >= v_start group by 1
  ),
  series as (
    select d.day, coalesce(c.n, 0) as created, coalesce(k.n, 0) as completed, coalesce(x.n, 0) as abandoned,
           coalesce(p.n, 0) as players, coalesce(nw.n, 0) as newcomers
      from days d
      left join created c on c.day = d.day
      left join completed k on k.day = d.day
      left join abandoned x on x.day = d.day
      left join players p on p.day = d.day
      left join newcomers nw on nw.day = d.day
  ),
  sums as (
    select sum(created) as created, sum(completed) as completed, sum(newcomers) as newcomers,
           (select count(*) from m where m.created_at >= v_start and m.status = 'completed') as created_completed
      from series
  ),
  -- UTC days: eligible once the first day is at least N days back; back =
  -- played on a day at least N days after it.
  cohort as (
    select f.first_day,
           exists (select 1 from s where s.user_id = f.user_id
                    and (s.created_at at time zone 'utc')::date >= f.first_day + 1) as back1,
           exists (select 1 from s where s.user_id = f.user_id
                    and (s.created_at at time zone 'utc')::date >= f.first_day + 7) as back7
      from firsts f
     where f.first_at >= v_start
  ),
  top as (
    select s.user_id, p.handle, count(*) as n, count(*) filter (where s.result = 'win') as w
      from s
      join public.profiles p on p.id = s.user_id
     where s.created_at >= v_start
     group by s.user_id, p.handle
     order by count(*) desc, count(*) filter (where s.result = 'win') desc, p.handle
     limit 10
  ),
  versions as (
    select m.published_version_id as vid, count(*) as n
      from m where m.created_at >= v_start group by m.published_version_id
  )
  select jsonb_build_object(
    'days', v_days,
    'series', (
      select jsonb_agg(jsonb_build_object(
               'date', to_char(x.day, 'YYYY-MM-DD'), 'matchesCreated', x.created, 'matchesCompleted', x.completed,
               'matchesAbandoned', x.abandoned, 'players', x.players, 'newPlayers', x.newcomers
             ) order by x.day)
        from series x
    ),
    'totals', jsonb_build_object(
      'matches', t.created, 'completed', t.completed,
      'players', (select count(distinct s.user_id) from s where s.created_at >= v_start),
      'newPlayers', t.newcomers
    ),
    'completionRate', case when t.created > 0 then round(t.created_completed::numeric / t.created, 4) else 0 end,
    'medianDurationSec', (
      select percentile_cont(0.5) within group (
               order by greatest(0, round(extract(epoch from m.ended_at - m.started_at))))
        from m where m.status = 'completed' and m.ended_at >= v_start and m.started_at is not null
    ),
    'modes', (
      select coalesce(jsonb_agg(jsonb_build_object('mode', x.mode, 'matches', x.n) order by x.n desc, x.mode), '[]'::jsonb)
        from (select m.mode, count(*) as n from m where m.created_at >= v_start group by m.mode) x
    ),
    'tableSizes', (
      select coalesce(jsonb_agg(jsonb_build_object('players', x.size, 'matches', x.n) order by x.size), '[]'::jsonb)
        from (select m.max_players as size, count(*) as n from m where m.created_at >= v_start group by m.max_players) x
    ),
    'retention', (
      select jsonb_build_object(
               'd1', round(avg(case when c.back1 then 1 else 0 end) filter (where c.first_day + 1 <= v_today), 4),
               'd7', round(avg(case when c.back7 then 1 else 0 end) filter (where c.first_day + 7 <= v_today), 4))
        from cohort c
    ),
    'topPlayers', (
      select coalesce(jsonb_agg(jsonb_build_object('profile', public.profile_json(p), 'matches', x.n, 'wins', x.w)
                                order by x.n desc, x.w desc, x.handle), '[]'::jsonb)
        from top x join public.profiles p on p.id = x.user_id
    ),
    'versions', (
      select coalesce(jsonb_agg(jsonb_build_object('versionId', x.vid, 'version', v.version, 'matches', x.n)
                                order by x.n desc, v.created_at desc nulls last), '[]'::jsonb)
        from versions x left join public.app_versions v on v.id = x.vid
    )
  )
    into result
    from sums t;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Logs
-- ---------------------------------------------------------------------------

create or replace function public.app_log_json(l public.app_logs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'appSlug', l.app_slug, 'versionId', l.version_id, 'matchId', l.match_id, 'userId', l.user_id,
    'level', l.level, 'message', l.message, 'data', l.data, 'source', l.source, 'createdAt', l.created_at
  );
$$;

-- A player or spectator of p_match (a match of p_app), or the app's
-- developer/testers (with or without a match). Messages are trimmed to 500
-- characters. Past 60 a minute per user per app, entries are dropped
-- silently: returns false (true when stored).
create or replace function public.log_app_event(
  p_app text,
  p_match uuid,
  p_level text,
  p_message text,
  p_data jsonb default null,
  p_source text default 'app'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
  m public.matches;
  v_message text := left(btrim(coalesce(p_message, '')), 500);
  v_data jsonb := nullif(p_data, 'null'::jsonb);
  v_source text := coalesce(p_source, 'app');
begin
  select * into a from public.apps where slug = p_app;
  if not found then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  if p_level is null or p_level not in ('debug', 'info', 'warn', 'error') then
    raise exception 'Level is debug, info, warn or error' using errcode = '22023';
  end if;
  if v_source not in ('app', 'host') then
    raise exception 'Source is app or host' using errcode = '22023';
  end if;
  if v_message = '' then
    raise exception 'A log message is required' using errcode = '22023';
  end if;
  if v_data is not null and octet_length(v_data::text) > 4096 then
    raise exception 'Log data must be at most 4 KB' using errcode = '22023';
  end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found or m.app_slug <> a.slug then
      raise exception 'Match not found' using errcode = 'P0002';
    end if;
    if not public.is_match_player(m.id, v_me) and not public.can_test_app(a.slug, v_me) then
      raise exception 'Not your match' using errcode = '42501';
    end if;
  elsif not public.can_test_app(a.slug, v_me) then
    raise exception 'Only the developer and testers can log outside a match' using errcode = '42501';
  end if;
  if not public.rate_limit_hit('logs:' || a.slug, v_me, 60) then
    return false;
  end if;
  insert into public.app_logs (app_slug, version_id, match_id, user_id, level, message, data, source)
  values (a.slug, coalesce(m.version_id, m.published_version_id, a.published_version_id), m.id, v_me,
          p_level, v_message, v_data, v_source);
  return true;
end;
$$;

-- Newest first, the last 7 days. p_level is a minimum (warn = warn + error);
-- p_before pages (created_at < p_before); p_limit 1–500 (default 100).
create or replace function public.list_app_logs(
  p_app text,
  p_level text default null,
  p_match uuid default null,
  p_before timestamptz default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.insight_app(p_app);
  result jsonb;
begin
  if p_level is not null and p_level not in ('debug', 'info', 'warn', 'error') then
    raise exception 'Level is debug, info, warn or error' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(public.app_log_json(l) order by l.created_at desc, l.id desc), '[]'::jsonb)
    into result
    from (
      select * from public.app_logs l
       where l.app_slug = a.slug
         and l.created_at > now() - interval '7 days'
         and (p_level is null or array_position(array['debug', 'info', 'warn', 'error'], l.level)
                                  >= array_position(array['debug', 'info', 'warn', 'error'], p_level))
         and (p_match is null or l.match_id = p_match)
         and (p_before is null or l.created_at < p_before)
       order by l.created_at desc, l.id desc
       limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) l;
  return result;
end;
$$;

-- Keeps 7 days of logs; scheduled daily (pg_cron job xapps-logs-cleanup).
create or replace function public.cleanup_app_logs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.app_logs where created_at < now() - interval '7 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'cron' and p.proname = 'schedule') then
    raise notice 'pg_cron is not available: run public.cleanup_app_logs() daily';
    return;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'cron' and c.relname = 'job') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''xapps-logs-cleanup''';
  end if;
  execute $cmd$select cron.schedule('xapps-logs-cleanup', '17 3 * * *', 'select public.cleanup_app_logs()')$cmd$;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

-- Internal helpers. Pure validators (manifest_int, app_version_manifest_error)
-- stay executable: the app_versions check constraint runs them. Functions
-- used by RLS policies (is_app_tester, can_view_test_match) stay executable too.
revoke execute on function public.app_version_manifest(jsonb) from public, anon, authenticated;
revoke execute on function public.app_row_manifest(public.apps) from public, anon, authenticated;
revoke execute on function public.app_with_manifest(public.apps, jsonb, text) from public, anon, authenticated;
revoke execute on function public.app_version_json(public.app_versions) from public, anon, authenticated;
revoke execute on function public.apps_guard_versions() from public, anon, authenticated;
revoke execute on function public.apps_register_version() from public, anon, authenticated;
revoke execute on function public.matches_set_version() from public, anon, authenticated;
revoke execute on function public.is_admin_user(uuid) from public, anon, authenticated;
revoke execute on function public.can_test_app(text, uuid) from public, anon, authenticated;
revoke execute on function public.managed_app(text) from public, anon, authenticated;
revoke execute on function public.insight_app(text) from public, anon, authenticated;
revoke execute on function public.managed_version(uuid) from public, anon, authenticated;
revoke execute on function public.play_app(text, uuid) from public, anon, authenticated;
revoke execute on function public.version_input_check(text, text, text) from public, anon, authenticated;
revoke execute on function public.version_authority_check(public.apps, jsonb) from public, anon, authenticated;
revoke execute on function public.publish_version(uuid) from public, anon, authenticated;
revoke execute on function public.app_testers_json(text) from public, anon, authenticated;
revoke execute on function public.app_row_json(public.apps) from public, anon, authenticated;
revoke execute on function public.require_admin() from public, anon, authenticated;
revoke execute on function public.notify_developer(public.apps, public.app_versions, text, text) from public, anon, authenticated;
revoke execute on function public.app_log_json(public.app_logs) from public, anon, authenticated;
revoke execute on function public.cleanup_app_logs() from public, anon, authenticated;
grant execute on function public.cleanup_app_logs() to service_role;
-- Redefined stage 1/2 helpers keep their privileges; restated for clarity.
revoke execute on function public.match_json(public.matches, uuid) from public, anon, authenticated;
revoke execute on function public.app_match_json(public.matches) from public, anon, authenticated;
revoke execute on function public.award_placements(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.set_first_turn(uuid) from public, anon, authenticated;

-- Signed-in developers, testers and reviewers.
revoke execute on function public.create_app_version(text, text, text, jsonb, text) from public, anon;
revoke execute on function public.update_app_version(uuid, text, jsonb, text) from public, anon;
revoke execute on function public.submit_app_version(uuid) from public, anon;
revoke execute on function public.withdraw_app_version(uuid) from public, anon;
revoke execute on function public.publish_app_version(uuid) from public, anon;
revoke execute on function public.list_app_versions(text) from public, anon;
revoke execute on function public.list_app_testers(text) from public, anon;
revoke execute on function public.add_app_tester(text, text) from public, anon;
revoke execute on function public.remove_app_tester(text, uuid) from public, anon;
revoke execute on function public.list_review_queue() from public, anon;
revoke execute on function public.review_app_version(uuid, text, text) from public, anon;
revoke execute on function public.list_my_notices(integer) from public, anon;
revoke execute on function public.mark_notices_read(uuid[]) from public, anon;
revoke execute on function public.app_analytics(text, integer) from public, anon;
revoke execute on function public.log_app_event(text, uuid, text, text, jsonb, text) from public, anon;
revoke execute on function public.list_app_logs(text, text, uuid, timestamptz, integer) from public, anon;
grant execute on function public.create_app_version(text, text, text, jsonb, text) to authenticated;
grant execute on function public.update_app_version(uuid, text, jsonb, text) to authenticated;
grant execute on function public.submit_app_version(uuid) to authenticated;
grant execute on function public.withdraw_app_version(uuid) to authenticated;
grant execute on function public.publish_app_version(uuid) to authenticated;
grant execute on function public.list_app_versions(text) to authenticated;
grant execute on function public.list_app_testers(text) to authenticated;
grant execute on function public.add_app_tester(text, text) to authenticated;
grant execute on function public.remove_app_tester(text, uuid) to authenticated;
grant execute on function public.list_review_queue() to authenticated;
grant execute on function public.review_app_version(uuid, text, text) to authenticated;
grant execute on function public.list_my_notices(integer) to authenticated;
grant execute on function public.mark_notices_read(uuid[]) to authenticated;
grant execute on function public.app_analytics(text, integer) to authenticated;
grant execute on function public.log_app_event(text, uuid, text, text, jsonb, text) to authenticated;
grant execute on function public.list_app_logs(text, text, uuid, timestamptz, integer) to authenticated;
