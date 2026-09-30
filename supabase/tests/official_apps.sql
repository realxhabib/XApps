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

update public.apps set play_count = 0, upvotes = 0 where slug = 'quick-draw';
drop function pg_temp.sync_upsert();
drop function pg_temp.sync_drift();
drop table before_sync;
drop table sync_rows;

\echo 'Official app sync checks passed ✔'
