-- =============================================================================
-- App images: developers upload a square icon and a 16:9 cover for listings.
--
--  * Public bucket `app-images`: objects at <uploader id>/<32 hex>.webp|jpg|png.
--    Insert only (no overwrite, no delete), so an image that passed review
--    can't change afterwards. At most 40 uploads per user per 24 h.
--  * Manifests and `apps` store the object key (never a URL), in iconImage /
--    coverImage and icon_image / cover_image. Versions carry them like every
--    other listing field, so images go through review.
-- Mirrors src/lib/app-images.ts. Safe to re-run.
-- =============================================================================

create or replace function public.app_image_key_ok(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_key is null
      or p_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{32}\.(webp|jpg|png)$';
$$;

alter table public.apps
  add column if not exists icon_image text,
  add column if not exists cover_image text;
alter table public.apps drop constraint if exists apps_icon_image_check;
alter table public.apps add constraint apps_icon_image_check check (public.app_image_key_ok(icon_image));
alter table public.apps drop constraint if exists apps_cover_image_check;
alter table public.apps add constraint apps_cover_image_check check (public.app_image_key_ok(cover_image));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-images', 'app-images', true, 1500000, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
   set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Rolling 24 h: at most 40 listing images per user, counting this one.
create or replace function public.app_image_quota_ok(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and p_user = auth.uid()
     and (select count(*) from storage.objects o
           where o.bucket_id = 'app-images' and o.name like p_user::text || '/%'
             and o.created_at > now() - interval '24 hours') < 40;
$$;

drop policy if exists "app images: upload into own folder" on storage.objects;
create policy "app images: upload into own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'app-images'
    and public.app_image_key_ok(name)
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.app_image_quota_ok((select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Manifests carry iconImage / coverImage (optional; null when unset)
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
                                  'votesToWin', 'howTo', 'stats', 'achievements', 'iconImage', 'coverImage'];
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

create or replace function public.app_row_manifest(a public.apps)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', a.name, 'tagline', a.tagline, 'description', a.description, 'category', a.category,
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
     set name = a.name, tagline = a.tagline, description = a.description, category = a.category,
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

revoke execute on function public.app_image_quota_ok(uuid) from public, anon;
grant execute on function public.app_image_quota_ok(uuid) to authenticated;
