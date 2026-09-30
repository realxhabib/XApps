-- =============================================================================
-- Standalone apps: a second kind of app next to games.
--
--  * apps.kind: 'game' (default: people play matches against each other) or
--    'app' (a news reader, dashboard, trading tool, meme maker… that people
--    simply open: no challenges, lobbies, scoring or results). Manifests carry
--    it as `kind` (absent = game), so a version can switch kind and goes
--    through review like every other field.
--  * New categories: news, tools, finance.
--  * open_app(p_app, p_version): opens a standalone app. Counts toward
--    play_count (except test builds) and returns the app to run. Anonymous
--    viewers may open published apps; test builds need sign-in.
--  * Everything that creates a match (create_challenge, quick_match,
--    start_practice) refuses apps: they all resolve the app through play_app,
--    which now calls require_game.
--  * log_app_event: viewers of a standalone app may log outside a match
--    (games still need a match unless you're the developer or a tester).
-- Mirrors the demo backend and src/platform/shipping.ts. Safe to re-run.
-- =============================================================================

alter table public.apps
  add column if not exists kind text not null default 'game';
alter table public.apps drop constraint if exists apps_kind_check;
alter table public.apps add constraint apps_kind_check check (kind in ('game', 'app'));

-- The core migration's inline category check (auto-named apps_category_check).
alter table public.apps drop constraint if exists apps_category_check;
alter table public.apps add constraint apps_category_check
  check (category in ('games', 'contests', 'debates', 'trivia', 'creative', 'social', 'news', 'tools', 'finance'));

-- ---------------------------------------------------------------------------
-- Games only
-- ---------------------------------------------------------------------------

-- Matches are for games: standalone apps are opened (open_app), never played.
create or replace function public.require_game(a public.apps)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if a.kind = 'app' then
    raise exception '% is an app you open, not a game: there are no matches', a.name using errcode = '22023';
  end if;
end;
$$;

-- The app to play: the published app (playable_app), or for a test build
-- the app as that version describes it (owner/testers, non-published only).
-- Only the match-creating RPCs use it, so it refuses standalone apps (a test
-- build counts as what its manifest says).
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
    a := public.playable_app(p_app);
  else
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
    a := public.app_with_manifest(a, v.manifest, v.url);
  end if;
  perform public.require_game(a);
  return a;
end;
$$;

-- ---------------------------------------------------------------------------
-- Manifests carry kind (optional; absent = game) and the new categories
-- ---------------------------------------------------------------------------

create or replace function public.app_version_manifest_error(p jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys constant text[] := array['name', 'tagline', 'description', 'category', 'icon', 'accent', 'modes',
                                  'players', 'teams', 'spectators', 'setup', 'turnBased', 'scoring',
                                  'votesToWin', 'howTo', 'stats', 'achievements', 'iconImage', 'coverImage',
                                  'kind'];
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
     or p->>'category' not in ('games', 'contests', 'debates', 'trivia', 'creative', 'social', 'news', 'tools', 'finance') then
    return 'Category must be games, contests, debates, trivia, creative, social, news, tools or finance';
  end if;
  -- Kind is optional (absent in manifests from before standalone apps: a game).
  if p ? 'kind' and (jsonb_typeof(p->'kind') is distinct from 'string' or p->>'kind' not in ('game', 'app')) then
    return 'Kind must be game or app';
  end if;
  if jsonb_typeof(p->'icon') is distinct from 'string' or char_length(p->>'icon') not between 1 and 16 then
    return 'Icon must be one emoji';
  end if;
  -- Listing images are optional (absent in manifests from before them).
  if (p ? 'iconImage' and p->'iconImage' <> 'null'::jsonb
      and (jsonb_typeof(p->'iconImage') <> 'string' or not public.app_image_key_ok(p->>'iconImage')))
     or (p ? 'coverImage' and p->'coverImage' <> 'null'::jsonb
      and (jsonb_typeof(p->'coverImage') <> 'string' or not public.app_image_key_ok(p->>'coverImage'))) then
    return 'Images must be uploaded through XApps';
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
    'kind', coalesce(nullif(p->'kind', v_null), '"game"'::jsonb),
    'icon', coalesce(nullif(p->'icon', v_null), '"✨"'::jsonb),
    'iconImage', coalesce(p->'iconImage', v_null),
    'coverImage', coalesce(p->'coverImage', v_null),
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

-- Also what apps_register_version stores as 1.0.0, so registrations carry kind.
create or replace function public.app_row_manifest(a public.apps)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', a.name, 'tagline', a.tagline, 'description', a.description, 'category', a.category, 'kind', a.kind,
    'icon', a.icon, 'iconImage', a.icon_image, 'coverImage', a.cover_image, 'accent', jsonb_build_array(a.accent_from, a.accent_to), 'modes', to_jsonb(a.modes),
    'players', jsonb_build_object('min', a.min_players, 'max', a.max_players), 'teams', a.team_count,
    'spectators', a.allow_spectators, 'setup', a.has_setup, 'turnBased', a.turn_based,
    'scoring', a.scoring, 'votesToWin', a.votes_to_win, 'howTo', to_jsonb(a.how_to),
    'stats', a.stats, 'achievements', a.achievements
  );
$$;

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
  a.kind := coalesce(p->>'kind', 'game');
  a.icon := p->>'icon';
  a.icon_image := p->>'iconImage';
  a.cover_image := p->>'coverImage';
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
     set name = a.name, tagline = a.tagline, description = a.description, category = a.category, kind = a.kind,
         icon = a.icon, icon_image = a.icon_image, cover_image = a.cover_image, accent_from = a.accent_from, accent_to = a.accent_to, url = a.url, modes = a.modes,
         min_players = a.min_players, max_players = a.max_players, team_count = a.team_count,
         allow_spectators = a.allow_spectators, has_setup = a.has_setup, turn_based = a.turn_based,
         scoring = a.scoring, votes_to_win = a.votes_to_win, how_to = a.how_to,
         stats = a.stats, achievements = a.achievements,
         published_version_id = v.id, status = 'published', updated_at = now()
   where slug = a.slug;
  return v;
end;
$$;

-- ---------------------------------------------------------------------------
-- Opening a standalone app
-- ---------------------------------------------------------------------------

-- The app to run, as app_row_json gives it, plus versionId (the test build,
-- or null). The live app: published, or unpublished for its developer (like
-- playable_app); anyone may open it, signed in or not, and each open counts
-- toward play_count. A test build (p_version): signed in, developer/testers
-- only, not the live version; it doesn't count. Games are refused.
create or replace function public.open_app(p_app text, p_version uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  a public.apps;
  v public.app_versions;
begin
  if p_version is null then
    a := public.playable_app(p_app);
  else
    if auth.uid() is null then
      raise exception 'Sign in to open test builds' using errcode = '28000';
    end if;
    v_me := auth.uid();
    select * into v from public.app_versions where id = p_version;
    if not found or v.app_slug is distinct from p_app then
      raise exception 'Version not found' using errcode = 'P0002';
    end if;
    if not public.can_test_app(p_app, v_me) then
      raise exception 'Only the developer and testers can open test builds' using errcode = '42501';
    end if;
    if v.status = 'published' then
      raise exception 'That version is live — open the app itself' using errcode = '22023';
    end if;
    select * into a from public.apps where slug = p_app;
    a := public.app_with_manifest(a, v.manifest, v.url);
  end if;
  if a.kind is distinct from 'app' then
    raise exception '% is a game: play it in a match', a.name using errcode = '22023';
  end if;
  if p_version is null then
    update public.apps set play_count = play_count + 1 where slug = a.slug
    returning play_count into a.play_count;
  end if;
  return public.app_row_json(a) || jsonb_build_object('versionId', p_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Logs: a standalone app has no matches, so its viewers log outside one
-- ---------------------------------------------------------------------------

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
  elsif not public.can_test_app(a.slug, v_me)
        and not (a.kind = 'app' and (a.status = 'published' or a.developer_id = v_me)) then
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

revoke execute on function public.require_game(public.apps) from public, anon, authenticated;
revoke execute on function public.play_app(text, uuid) from public, anon, authenticated;
revoke execute on function public.app_row_manifest(public.apps) from public, anon, authenticated;
revoke execute on function public.app_with_manifest(public.apps, jsonb, text) from public, anon, authenticated;
revoke execute on function public.app_version_manifest(jsonb) from public, anon, authenticated;
revoke execute on function public.publish_version(uuid) from public, anon, authenticated;
revoke execute on function public.open_app(text, uuid) from public;
grant execute on function public.open_app(text, uuid) to anon, authenticated;
revoke execute on function public.log_app_event(text, uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.log_app_event(text, uuid, text, text, jsonb, text) to authenticated;
