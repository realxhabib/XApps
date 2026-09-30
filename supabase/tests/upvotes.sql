-- App upvotes (20261006000200_app_upvotes.sql). Runs after lifecycle.sql, on its users.
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
create function pg_temp.ups(p_app text) returns integer language sql as $$
  select upvotes from public.apps where slug = p_app;
$$;
grant execute on function pg_temp.login(text), pg_temp.expect(text, text, text), pg_temp.ups(text) to anon, authenticated;

-- Bob's published app, Bob's app in review, and Dave (who'll delete his account).
insert into public.apps (slug, name, tagline, category, url, modes, min_players, max_players, how_to, developer_id, status)
values ('up-live', 'Up Live', 'Upvote me', 'games', 'https://up.example.com/live', '{live,practice}', 2, 2, '{Play}',
        (select id from public.profiles where handle = 'bob'), 'published'),
       ('up-review', 'Up Review', 'Not yet', 'games', 'https://up.example.com/review', '{live,practice}', 2, 2, '{Play}',
        (select id from public.profiles where handle = 'bob'), 'pending');
insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-4999-8999-999999999999', null, '{"user_name":"dave","full_name":"Dave"}');
delete from public.rate_limit_hits where bucket = 'upvotes';

do $$
begin
  assert (select bool_and(upvotes = 0) from public.apps), 'everything starts at zero';
end $$;

-- Carol upvotes; again is a no-op.
set role authenticated;
select pg_temp.login('carol');
do $$
declare r jsonb;
begin
  r := public.set_app_upvote('up-live', true);
  assert r = '{"upvotes": 1, "upvoted": true}'::jsonb, r::text;
  r := public.set_app_upvote('up-live', true);
  assert r = '{"upvotes": 1, "upvoted": true}'::jsonb, 'idempotent: ' || r::text;
  assert (select count(*) from public.app_upvotes) = 1, 'carol reads her upvote';
  assert pg_temp.ups('up-live') = 1, 'counted';
end $$;

-- The table is read-only for clients, and people only see their own rows.
select pg_temp.expect($q$insert into public.app_upvotes (app_slug, user_id) values ('up-live', auth.uid())$q$, '42501');
select pg_temp.expect($q$delete from public.app_upvotes$q$, '42501');
select pg_temp.login('alice_x');
do $$
declare r jsonb;
begin
  assert not exists (select 1 from public.app_upvotes), 'alice sees none of carol''s upvotes';
  r := public.set_app_upvote('up-live', true);
  assert (r->>'upvotes')::int = 2 and (r->>'upvoted')::boolean, r::text;
  r := public.set_app_upvote('quick-draw', true);
  assert (r->>'upvotes')::int = 1, 'official apps take upvotes';
end $$;

-- No self-upvotes; unpublished apps can't be upvoted (and stay hidden from others).
select pg_temp.login('bob');
select pg_temp.expect($q$select public.set_app_upvote('up-live', true)$q$, '42501', 'You can''t upvote your own app');
select pg_temp.expect($q$select public.set_app_upvote('up-review', true)$q$, '42501', 'You can''t upvote your own app');
do $$
begin
  assert (public.set_app_upvote('up-live', false)->>'upvotes')::int = 2, 'taking back an upvote you never gave is a no-op';
end $$;
-- Developers can't set the count on their own rows (the guard keeps it; the edit still goes through).
update public.apps set upvotes = 999, tagline = 'Edited' where slug = 'up-live';
do $$
begin
  assert pg_temp.ups('up-live') = 2, 'count kept';
  assert (select tagline from public.apps where slug = 'up-live') = 'Edited', 'the edit went through';
end $$;
reset role;
update public.apps set status = 'published' where slug = 'up-live';
set role authenticated;
select pg_temp.login('carol');
select pg_temp.expect($q$select public.set_app_upvote('up-review', true)$q$, 'P0002', 'App not found');
select pg_temp.expect($q$select public.set_app_upvote('nope', true)$q$, 'P0002', 'App not found');
select pg_temp.expect($q$select public.set_app_upvote('up-live', null)$q$, '22023');

-- Testers see an app in review but still can't upvote it before it's published.
reset role;
insert into public.app_testers (app_slug, user_id) values ('up-review', (select id from public.profiles where handle = 'tess'))
on conflict do nothing;
set role authenticated;
select pg_temp.login('tess');
select pg_temp.expect($q$select public.set_app_upvote('up-review', true)$q$, '22023', 'Only published apps%');

-- The viewer's upvote rides along in app_row_json.
reset role;
select pg_temp.login('carol');
do $$
begin
  assert (select public.app_row_json(a) from public.apps a where slug = 'up-live')->>'viewer_upvoted' = 'true', 'carol upvoted';
  assert ((select public.app_row_json(a) from public.apps a where slug = 'up-live')->>'upvotes')::int = 2, 'count in the json';
end $$;
select pg_temp.login('bob');
do $$
begin
  assert (select public.app_row_json(a) from public.apps a where slug = 'up-live')->>'viewer_upvoted' = 'false', 'bob did not';
end $$;

-- Taking it back; an app that went back to review keeps upvotes but can still be un-upvoted.
set role authenticated;
select pg_temp.login('carol');
do $$
declare r jsonb;
begin
  r := public.set_app_upvote('up-live', false);
  assert r = '{"upvotes": 1, "upvoted": false}'::jsonb, r::text;
  r := public.set_app_upvote('up-live', false);
  assert r = '{"upvotes": 1, "upvoted": false}'::jsonb, 'idempotent: ' || r::text;
end $$;
reset role;
update public.apps set status = 'pending' where slug = 'up-live';
set role authenticated;
select pg_temp.login('carol');
select pg_temp.expect($q$select public.set_app_upvote('up-live', true)$q$, 'P0002');
select pg_temp.login('alice_x');
do $$
begin
  assert public.set_app_upvote('up-live', false) = '{"upvotes": 0, "upvoted": false}'::jsonb, 'alice takes hers back';
end $$;
reset role;
update public.apps set status = 'published' where slug = 'up-live';

-- Signed out: no upvoting.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect($q$select public.set_app_upvote('up-live', true)$q$, '42501');
select pg_temp.expect($q$select * from public.app_upvotes$q$, '42501');
reset role;
do $$
begin
  assert not has_function_privilege('anon', 'public.set_app_upvote(text, boolean)', 'execute'), 'anon can''t upvote';
  assert has_function_privilege('authenticated', 'public.set_app_upvote(text, boolean)', 'execute'), 'users upvote';
  assert not has_function_privilege('authenticated', 'public.app_upvotes_count()', 'execute'), 'internal';
end $$;

-- Rate limit: 30 calls a minute (now() is fixed within the transaction, so one window).
delete from public.rate_limit_hits where bucket = 'upvotes';
set role authenticated;
select pg_temp.login('dave');
do $$
begin
  for i in 1..30 loop
    perform public.set_app_upvote('up-live', i % 2 = 1);
  end loop;
  perform pg_temp.expect($q$select public.set_app_upvote('up-live', true)$q$, '54000', 'Too many upvotes%');
  perform public.set_app_upvote('quick-draw', true);
  raise exception 'expected 54000';
exception when others then
  assert sqlstate = '54000', sqlerrm;
end $$;
do $$
begin
  perform public.set_app_upvote('up-live', true);
  perform public.set_app_upvote('quick-draw', true);
end $$;
reset role;

-- Deleting a person or an app keeps the counts right.
do $$
begin
  assert pg_temp.ups('up-live') = 1 and pg_temp.ups('quick-draw') = 2, format('%s %s', pg_temp.ups('up-live'), pg_temp.ups('quick-draw'));
  delete from public.profiles where handle = 'dave';
  assert pg_temp.ups('up-live') = 0 and pg_temp.ups('quick-draw') = 1, 'dave''s upvotes went with him';
  assert (select count(*) from public.app_upvotes) = 1, 'only alice''s quick-draw upvote left';
  delete from public.apps where slug = 'up-live';
  -- A drifted count is recounted by re-running the migration.
  update public.apps set upvotes = 7 where slug = 'quick-draw';
end $$;

set client_min_messages = warning;
\ir ../migrations/20261006000200_app_upvotes.sql
reset client_min_messages;
do $$
begin
  assert pg_temp.ups('quick-draw') = 1, 'recounted on re-run';
end $$;
update public.apps set upvotes = 0 where slug = 'quick-draw';
delete from public.app_upvotes;
do $$
begin
  assert (select bool_and(upvotes = 0) from public.apps), 'all clear';
end $$;

\echo 'Upvote checks passed ✔'
