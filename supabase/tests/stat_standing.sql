-- Stat standings (20261006000300_stat_standing.sql). Runs after lifecycle.sql, on its own app and people.
\set ON_ERROR_STOP on
\set QUIET on

create function pg_temp.login(p_handle text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce((select id::text from public.profiles where handle = p_handle), ''), false);
$$;
create function pg_temp.expect(p_sql text, p_state text, p_like text default null) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected %', p_state;
exception when others then
  assert sqlstate = p_state, format('%s -> %s %s (expected %s)', p_sql, sqlstate, sqlerrm, p_state);
  assert p_like is null or sqlerrm like p_like, format('%s -> message %s', p_sql, sqlerrm);
end $$;
-- [[rank, handle, value], …] of a standing's top rows.
create function pg_temp.board(s jsonb) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(e->'rank', e->'profile'->>'handle', e->'value') order by o), '[]'::jsonb)
    from jsonb_array_elements(s->'top') with ordinality x(e, o);
$$;
grant execute on function pg_temp.login(text), pg_temp.expect(text, text, text), pg_temp.board(jsonb) to anon, authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('51000000-0000-4000-8000-000000000001', null, '{"user_name":"st_ann","full_name":"Ann"}'),
  ('51000000-0000-4000-8000-000000000002', null, '{"user_name":"st_ben","full_name":"Ben"}'),
  ('51000000-0000-4000-8000-000000000003', null, '{"user_name":"st_cat","full_name":"Cat"}'),
  ('51000000-0000-4000-8000-000000000004', null, '{"user_name":"st_dan","full_name":"Dan"}'),
  ('51000000-0000-4000-8000-000000000005', null, '{"user_name":"st_eve","full_name":"Eve"}');

-- A published standalone app (kind app) with a max, a min and an unused stat; and one still in review.
insert into public.apps (slug, name, tagline, category, url, kind, developer_id, status, stats)
values ('standing-app', 'Standing App', 'Where do I stand?', 'tools', 'https://standing.example.com/', 'app',
        '51000000-0000-4000-8000-000000000001', 'published',
        '[{"key":"best","label":"Best","aggregate":"max","format":"percent"},
          {"key":"fastest","label":"Fastest","aggregate":"min","format":"ms"},
          {"key":"streak","label":"Streak","aggregate":"max"}]'),
       ('standing-review', 'Standing Review', 'Not yet', 'tools', 'https://standing.example.com/review', 'app',
        '51000000-0000-4000-8000-000000000001', 'pending',
        '[{"key":"best","label":"Best","aggregate":"max"}]');

-- best: ben 90, cat 80, dan 80 (dan reached it later), eve 70; ann never played.
-- fastest: cat 400, ben 650.5, eve 650.5.
insert into public.app_user_stats (app_slug, user_id, key, value, updated_at) values
  ('standing-app', '51000000-0000-4000-8000-000000000002', 'best', 90, now() - interval '4 minutes'),
  ('standing-app', '51000000-0000-4000-8000-000000000003', 'best', 80, now() - interval '3 minutes'),
  ('standing-app', '51000000-0000-4000-8000-000000000004', 'best', 80, now() - interval '2 minutes'),
  ('standing-app', '51000000-0000-4000-8000-000000000005', 'best', 70, now() - interval '1 minute'),
  ('standing-app', '51000000-0000-4000-8000-000000000003', 'fastest', 400, now()),
  ('standing-app', '51000000-0000-4000-8000-000000000002', 'fastest', 650.5, now()),
  ('standing-app', '51000000-0000-4000-8000-000000000005', 'fastest', 650.5, now()),
  -- Bots never count (not on the board, not in the total).
  ('standing-app', '00000000-0000-4000-8000-00000000b075', 'best', 1000, now());

-- Signed in: the board, my place on it and how many people have a value.
set role authenticated;
select pg_temp.login('st_dan');
do $$
declare s jsonb := public.app_stat_standing('standing-app', 'best');
begin
  assert s ?& array['key', 'top', 'me', 'total'], s::text;
  assert s->>'key' = 'best', 'key';
  assert pg_temp.board(s) = '[[1,"st_ben",90],[2,"st_cat",80],[2,"st_dan",80],[4,"st_eve",70]]'::jsonb, 'max board ' || s::text;
  assert s->'top' = public.app_stat_leaderboard('standing-app', 'best', 10), 'top is exactly the leaderboard';
  assert s->'me' = '{"rank":2,"value":80}'::jsonb, 'ties share the rank ' || (s->'me')::text;
  assert (s->>'total')::int = 4, 'bots excluded from the total';
  s := public.app_stat_standing('standing-app', 'best', 1);
  assert pg_temp.board(s) = '[[1,"st_ben",90]]'::jsonb, 'limit';
  assert s->'me' = '{"rank":2,"value":80}'::jsonb and (s->>'total')::int = 4, 'me and total ignore the limit';
  assert jsonb_array_length(public.app_stat_standing('standing-app', 'best', 0)->'top') = 1, 'limit at least 1';
  assert jsonb_array_length(public.app_stat_standing('standing-app', 'best', null)->'top') = 4, 'null = default';
end $$;
select pg_temp.login('st_eve');
do $$
declare s jsonb := public.app_stat_standing('standing-app', 'fastest');
begin
  assert pg_temp.board(s) = '[[1,"st_cat",400],[2,"st_ben",650.5],[2,"st_eve",650.5]]'::jsonb, 'min board ' || s::text;
  assert s->'me' = '{"rank":2,"value":650.5}'::jsonb, 'min: lower is better ' || (s->'me')::text;
  assert (s->>'total')::int = 3, 'total';
  s := public.app_stat_standing('standing-app', 'best');
  assert s->'me' = '{"rank":4,"value":70}'::jsonb, 'last ' || (s->'me')::text;
end $$;
select pg_temp.login('st_ann');
do $$
declare s jsonb := public.app_stat_standing('standing-app', 'best');
begin
  assert s->'me' = 'null'::jsonb and (s->>'total')::int = 4, 'no value yet: me is null ' || s::text;
  s := public.app_stat_standing('standing-app', 'streak');
  assert s = '{"key":"streak","top":[],"me":null,"total":0}'::jsonb, 'nobody yet ' || s::text;
  -- The developer reads their own app in review.
  s := public.app_stat_standing('standing-review', 'best');
  assert s = '{"key":"best","top":[],"me":null,"total":0}'::jsonb, 'own app in review ' || s::text;
end $$;
select pg_temp.expect($q$select public.app_stat_standing('standing-app', 'nope')$q$, '22023', 'Unknown stat nope');
select pg_temp.login('st_ben');
select pg_temp.expect($q$select public.app_stat_standing('standing-review', 'best')$q$, 'P0002');
select pg_temp.expect($q$select public.app_stat_standing('no-such-app', 'best')$q$, 'P0002');
do $$
begin
  -- Reporting a better value moves you up, ranked the same way.
  perform public.report_stats('standing-app', '{"fastest":300}');
  assert public.app_stat_standing('standing-app', 'fastest')->'me' = '{"rank":1,"value":300}'::jsonb, 'new best';
end $$;
reset role;

-- Signed out: the board and the total, never a standing.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare s jsonb := public.app_stat_standing('standing-app', 'best', 2);
begin
  assert pg_temp.board(s) = '[[1,"st_ben",90],[2,"st_cat",80]]'::jsonb and s->'me' = 'null'::jsonb and (s->>'total')::int = 4, s::text;
end $$;
reset role;
do $$
begin
  assert has_function_privilege('anon', 'public.app_stat_standing(text, text, integer)', 'execute'), 'anon reads boards';
  assert has_function_privilege('authenticated', 'public.app_stat_standing(text, text, integer)', 'execute'), 'users read boards';
end $$;

-- Re-runnable.
set client_min_messages = warning;
\ir ../migrations/20261006000300_stat_standing.sql
reset client_min_messages;

delete from public.apps where slug in ('standing-app', 'standing-review');
delete from public.profiles where handle like 'st\_%';
drop function pg_temp.board(jsonb);

\echo 'Stat standing checks passed ✔'
