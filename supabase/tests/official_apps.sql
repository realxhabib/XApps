-- Official app sync (apps/web/scripts/sync-apps.mjs) against the migrated schema.
--
-- run.sh passes the rows the script would write (`sync-apps --dry-run`) as
-- :rows. PostgREST isn't available locally, so this replays what the script's
-- `from('apps').upsert(rows, { onConflict: 'slug' })` sends: one
-- `insert … on conflict (slug) do update` of exactly the JSON keys (plus
-- updated_at), as the service_role, through every trigger and check on
-- public.apps. Runs right after the migrations, so lifecycle.sql then runs on
-- the synced catalog, like a deployed database.

create temp table sync_rows as select (:'rows')::jsonb as rows;
grant select on sync_rows to service_role;

-- What a freshly migrated database differs in from the catalog (informational:
-- the catalog may move on without migrations; the first sync fills these in).
do $$
declare
  r record;
  v_diff text := '';
begin
  for r in
    select e->>'slug' as slug, k
      from sync_rows, jsonb_array_elements(rows) e, jsonb_object_keys(e) k, public.apps a
     where a.slug = e->>'slug' and to_jsonb(a)->k is distinct from e->k
     order by 1, 2
  loop
    v_diff := v_diff || format(E'\n  %s.%s', r.slug, r.k);
  end loop;
  raise notice 'official apps: catalog vs migrations — %', coalesce(nullif(v_diff, ''), ' identical');
end $$;

-- The script's upsert, replayed: pg_temp.sync_upsert() returns the rows written.
create function pg_temp.sync_upsert() returns integer
language plpgsql as $$
declare
  v_rows jsonb := (select rows from sync_rows);
  v_cols text;
  v_set text;
  v_count integer;
begin
  select string_agg(quote_ident(k), ', ' order by k),
         string_agg(format('%1$I = excluded.%1$I', k), ', ' order by k)
    into v_cols, v_set
    from (select distinct jsonb_object_keys(e) k from jsonb_array_elements(v_rows) e) keys;
  execute format(
    'insert into public.apps (%1$s, updated_at) '
    'select %1$s, now() from jsonb_populate_recordset(null::public.apps, $1) '
    'on conflict (slug) do update set %2$s, updated_at = excluded.updated_at',
    v_cols, v_set)
  using v_rows;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function pg_temp.sync_upsert() to service_role;

-- Every synced column of every row equals the catalog row, key for key.
create function pg_temp.sync_drift() returns text
language sql as $$
  select string_agg(e->>'slug', ', ')
    from sync_rows, jsonb_array_elements(rows) e
   where not exists (
     select 1 from public.apps a
      where a.slug = e->>'slug'
        and (select jsonb_object_agg(k, to_jsonb(a)->k) from jsonb_object_keys(e) k) = e
   );
$$;
grant execute on function pg_temp.sync_drift() to service_role;

create temp table before_sync as
  select slug, play_count, upvotes, created_at, developer_id, authority, published_version_id, official from public.apps;
-- A player has already played (and upvoted) one of them: the sync must not
-- reset it (restored below; lifecycle.sql counts plays from zero).
update public.apps set play_count = 42, upvotes = 7 where slug = 'quick-draw';
update before_sync set play_count = 42, upvotes = 7 where slug = 'quick-draw';

do $$
begin
  assert jsonb_array_length((select rows from sync_rows)) >= 1, 'the dry run produced rows';
  assert not exists (
    select 1 from sync_rows, jsonb_array_elements(rows) e
     where e ?| array['play_count', 'upvotes', 'created_at', 'developer_id', 'authority', 'published_version_id', 'updated_at']
  ), 'the sync never sends platform-owned columns';
  assert (select bool_and((e->>'official')::boolean) from sync_rows, jsonb_array_elements(rows) e), 'only official apps';
end $$;

-- 1. Update path: the existing seeded rows.
set role service_role;
select pg_temp.sync_upsert() \gset
reset role;
do $$
begin
  assert pg_temp.sync_drift() is null, 'rows differ from the catalog after the sync: ' || pg_temp.sync_drift();
  assert not exists (
    select 1 from public.apps a join before_sync b using (slug)
     where (a.play_count, a.upvotes, a.created_at, a.developer_id, a.authority, a.published_version_id, a.official)
           is distinct from (b.play_count, b.upvotes, b.created_at, b.developer_id, b.authority, b.published_version_id, b.official)
  ), 'the sync kept play counts, upvotes, created_at, developer, authority and published version';
  -- Catalog apps no migration seeded (first-party apps added since) are inserted; nothing else changes.
  assert (select count(*) from public.apps) = (select count(*) from before_sync)
         + (select count(*) from sync_rows, jsonb_array_elements(rows) e where not exists (select 1 from before_sync b where b.slug = e->>'slug')),
         'no rows lost, and only unseeded catalog apps added';
end $$;

-- 2. Idempotent: a second sync changes nothing.
set role service_role;
select pg_temp.sync_upsert() \gset
reset role;
do $$
begin
  assert pg_temp.sync_drift() is null, 'second sync drifted';
end $$;

-- 3. Insert path: a first-party app that no migration seeded (Wedge Wars
--    removed, then synced back) lands official + published with no versions.
delete from public.apps where slug = 'wedge-wars';
set role service_role;
select pg_temp.sync_upsert() \gset
reset role;
do $$
declare
  a public.apps;
begin
  select * into a from public.apps where slug = 'wedge-wars';
  assert found, 'inserted';
  assert a.official and a.status = 'published', 'official + published';
  assert a.developer_id is null and a.play_count = 0 and a.upvotes = 0 and a.authority = 'client', 'platform defaults';
  assert a.published_version_id is null, 'no published version';
  assert pg_temp.sync_drift() is null, 'inserted row matches the catalog';
end $$;

-- Official apps are managed in code: no app_versions for any synced app.
do $$
begin
  assert not exists (
    select 1 from public.app_versions v join sync_rows s on s.rows @> jsonb_build_array(jsonb_build_object('slug', v.app_slug))
  ), 'official apps get no app_versions';
  assert (select official from public.apps where slug = 'rps-showdown'), 'apps outside the sync are left alone';
end $$;

-- 4. Retirement: official rows the catalog no longer has (run.sh passes every
--    catalog slug, official or not, as :slugs) are retired, replaying the
--    script: `update apps set status = 'rejected'` for them, then cancel their
--    open, pending and active matches. Trivia Royale, Hot Takes and Emoji
--    Decode were seeded by migrations and have since left the catalog.
create temp table sync_slugs as select (:'slugs')::jsonb as slugs;
grant select on sync_slugs to service_role;

create function pg_temp.sync_retire() returns integer
language plpgsql as $$
declare
  v_keep text[] := array(select jsonb_array_elements_text(slugs) from sync_slugs);
  v_gone text[];
  n integer;
begin
  select coalesce(array_agg(slug), '{}') into v_gone from public.apps where official and slug <> all (v_keep);
  update public.apps set status = 'rejected', updated_at = now()
   where slug = any (v_gone) and official and status <> 'rejected';
  update public.matches set status = 'cancelled', updated_at = now()
   where app_slug = any (v_gone) and status in ('open', 'pending', 'active');
  get diagnostics n = row_count;
  return n;
end;
$$;
grant execute on function pg_temp.sync_retire() to service_role;

-- A player with history in a retired app: matches in every state, stats, a badge, XP, plays.
insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-4999-8999-999999999999', null, '{"user_name":"retiree","full_name":"Retiree"}');
create temp table retiree_matches (k text primary key, id uuid);
grant select on retiree_matches to authenticated;
do $$
declare
  v_me uuid := '99999999-9999-4999-8999-999999999999';
  v_status text;
  v_id uuid;
begin
  foreach v_status in array array['open', 'pending', 'active', 'voting', 'completed'] loop
    insert into public.matches (app_slug, mode, status, scoring, created_by, max_players, winner_id)
    values (case when v_status = 'voting' then 'hot-takes' else 'trivia-royale' end, 'live', v_status,
            case when v_status = 'voting' then 'votes' else 'high' end, v_me, 4,
            case when v_status = 'completed' then v_me end)
    returning id into v_id;
    insert into public.match_players (match_id, user_id, seat, state, score, result)
    values (v_id, v_me, 0, case when v_status in ('voting', 'completed') then 'submitted' else 'joined' end,
            case when v_status = 'completed' then 7420 end, case when v_status = 'completed' then 'win' end);
    insert into retiree_matches values (v_status, v_id);
  end loop;
  insert into public.app_user_stats (app_slug, user_id, key, value) values ('trivia-royale', v_me, 'crowns', 1);
  insert into public.user_achievements (app_slug, user_id, achievement_id) values ('trivia-royale', v_me, 'crowned');
  update public.profiles set xp = 140 where id = v_me;
  update public.apps set play_count = 9 where slug = 'trivia-royale';
end $$;

set role service_role;
select set_config('sync.cancelled', pg_temp.sync_retire()::text, false) as retire_result \gset
reset role;
do $$
begin
  assert current_setting('sync.cancelled')::int = 3, 'open, pending and active matches cancelled';
  assert (select array_agg(slug order by slug) from public.apps where status = 'rejected' and official)
         = '{emoji-decode,hot-takes,trivia-royale}', 'retired exactly the official apps the catalog dropped';
  assert (select official and status = 'published' from public.apps where slug = 'rps-showdown'),
         'catalog apps outside the sync (not official there) are left alone';
  assert pg_temp.sync_drift() is null, 'catalog apps untouched';
  -- Nothing is deleted: the row (plays, progress definitions) and the history stay.
  assert (select play_count = 9 and jsonb_array_length(stats) = 4 and jsonb_array_length(achievements) = 9
            from public.apps where slug = 'trivia-royale'), 'the row keeps its plays and progress definitions';
  assert (select jsonb_object_agg(k, m.status) from retiree_matches r join public.matches m on m.id = r.id)
         = '{"open":"cancelled","pending":"cancelled","active":"cancelled","voting":"voting","completed":"completed"}',
         'unfinished matches cancelled; voting ones settle at their deadline; finished ones stay';
  assert (select xp from public.profiles where handle = 'retiree') = 140, 'XP stays';
  assert exists (select 1 from public.app_user_stats where app_slug = 'trivia-royale'), 'stats rows stay';
  assert exists (select 1 from public.user_achievements where app_slug = 'trivia-royale'), 'badges stay';
end $$;

-- Retiring again changes nothing.
set role service_role;
select set_config('sync.cancelled', pg_temp.sync_retire()::text, false) as retire_result \gset
reset role;
do $$
begin
  assert current_setting('sync.cancelled')::int = 0, 'idempotent';
end $$;

-- Players: the app is gone from listings and play, but their history still opens.
set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', false) as jwt \gset
do $$
declare
  v_done uuid := (select id from retiree_matches where k = 'completed');
begin
  assert not exists (select 1 from public.apps where slug in ('trivia-royale', 'hot-takes', 'emoji-decode')), 'not listed';
  assert exists (select 1 from public.apps where slug = 'quick-draw'), 'catalog apps still listed';
  assert (public.get_match(v_done)->>'status') = 'completed', 'a finished match still opens';
  assert (public.get_match(v_done)->>'appSlug') = 'trivia-royale', 'and still names its app';
  assert jsonb_path_exists(public.list_my_matches(), '$[*] ? (@.id == $id)', jsonb_build_object('id', v_done)), 'in my matches';
end $$;
do $$
declare
  v_sql text;
  v_state text;
begin
  foreach v_sql in array array[
    'select public.quick_match(''trivia-royale'')',
    'select public.create_challenge(''emoji-decode'', ''async'', null)',
    'select public.start_practice(''hot-takes'')',
    'select public.report_stats(''trivia-royale'', ''{"crowns":1}'')',
    'select public.unlock_achievement(''trivia-royale'', ''crowned'')',
    'select public.open_app(''emoji-decode'', null)'
  ] loop
    begin
      execute v_sql;
      raise exception 'expected P0002';
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      assert v_state = 'P0002', format('%s -> %s %s', v_sql, v_state, sqlerrm);
    end;
  end loop;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false) as jwt \gset

-- Back in the catalog, the next sync republishes it (the upsert sends status).
update public.apps set status = 'published' where slug = 'trivia-royale';
set role service_role;
select set_config('sync.cancelled', pg_temp.sync_retire()::text, false) as retire_result \gset
reset role;
do $$
begin
  assert (select status from public.apps where slug = 'trivia-royale') = 'rejected', 're-retired while still missing from the catalog';
end $$;

-- Leave lifecycle.sql the retired catalog, without this player.
delete from public.matches where id in (select id from retiree_matches);
delete from public.app_user_stats where user_id = '99999999-9999-4999-8999-999999999999';
delete from public.user_achievements where user_id = '99999999-9999-4999-8999-999999999999';
delete from public.profiles where id = '99999999-9999-4999-8999-999999999999';
delete from auth.users where id = '99999999-9999-4999-8999-999999999999';
update public.apps set play_count = 0 where slug = 'trivia-royale';
drop table retiree_matches;
drop function pg_temp.sync_retire();
drop table sync_slugs;

update public.apps set play_count = 0, upvotes = 0 where slug = 'quick-draw';
drop function pg_temp.sync_upsert();
drop function pg_temp.sync_drift();
drop table before_sync;
drop table sync_rows;

\echo 'Official app sync checks passed ✔'
