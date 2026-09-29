-- End-to-end checks of the match lifecycle, RLS and settlement rules.
\set ON_ERROR_STOP on
\set QUIET on

-- Users sign in with X
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', null, '{"user_name":"Alice_X","full_name":"Alice","avatar_url":"https://pbs.twimg.com/profile_images/1/a_normal.jpg","provider_id":"101"}'),
  ('22222222-2222-4222-8222-222222222222', null, '{"user_name":"bob","name":"Bob"}'),
  ('33333333-3333-4333-8333-333333333333', null, '{"user_name":"carol","full_name":"Carol"}'),
  ('44444444-4444-4444-8444-444444444444', null, '{"user_name":"alice_x","full_name":"Alice clone"}');

do $$
begin
  assert (select handle from public.profiles where id = '11111111-1111-4111-8111-111111111111') = 'alice_x', 'handle lowercased';
  assert (select avatar_url from public.profiles where id = '11111111-1111-4111-8111-111111111111') like '%_400x400.jpg', 'avatar upscaled';
  assert (select handle from public.profiles where id = '44444444-4444-4444-8444-444444444444') = 'alice_x1', 'handle de-duplicated';
end $$;

create temporary table ctx (k text primary key, v text);
grant all on ctx to authenticated, anon;

-- ---------------------------------------------------------------- Alice challenges Bob (live)
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
insert into ctx values ('live', (select public.create_challenge('quick-draw', 'live', '@Bob')::text));

do $$
declare m jsonb := public.get_match((select v from ctx where k = 'live')::uuid);
begin
  assert m->>'status' = 'pending', 'challenge pending';
  assert jsonb_array_length(m->'players') = 2, 'two players';
  assert m->'players'->1->>'state' = 'invited', 'bob invited';
end $$;

-- Alice can't submit before Bob accepts (live)
do $$
begin
  perform public.submit_entry((select v from ctx where k = 'live')::uuid, null, 3);
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%hasn''t started%', sqlerrm;
end $$;

-- Tables are not directly writable
do $$
begin
  update public.matches set status = 'completed' where id = (select v from ctx where k = 'live')::uuid;
  assert not found, 'direct update must not affect rows';
end $$;

-- Bob accepts
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select public.join_match((select v from ctx where k = 'live')::uuid);
select public.mark_started((select v from ctx where k = 'live')::uuid);
select public.submit_entry((select v from ctx where k = 'live')::uuid, null, 1);

-- Bob cannot submit twice or for Alice
do $$
begin
  perform public.submit_entry((select v from ctx where k = 'live')::uuid, '11111111-1111-4111-8111-111111111111', 0);
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%only submit for yourself%', sqlerrm;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.submit_entry((select v from ctx where k = 'live')::uuid, null, 3);

do $$
declare m jsonb := public.get_match((select v from ctx where k = 'live')::uuid);
begin
  assert m->>'status' = 'completed', 'settled';
  assert m->>'winnerId' = '11111111-1111-4111-8111-111111111111', 'alice wins with the higher score';
  assert (m->'players'->0->>'xpDelta')::int = 30, 'winner xp';
  assert (m->'players'->1->>'xpDelta')::int = 8, 'loser xp';
end $$;

reset role;
do $$
begin
  assert (select wins from public.profiles where handle = 'alice_x') = 1, 'alice win recorded';
  assert (select losses from public.profiles where handle = 'bob') = 1, 'bob loss recorded';
  assert (select played from public.app_player_stats where app_slug = 'quick-draw' and user_id = '22222222-2222-4222-8222-222222222222') = 1, 'stats';
  assert (select play_count from public.apps where slug = 'quick-draw') = 1, 'play count';
end $$;

-- ---------------------------------------------------------------- Meme Duel, async, crowd judged
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
insert into ctx values ('meme', (select public.create_challenge('meme-duel', 'async', 'bob')::text));
-- Async: challenger can play before the invite is accepted
select public.submit_entry((select v from ctx where k = 'meme')::uuid, null, null,
  '{"templateId":"pov"}', '{"kind":"text","body":"alice caption"}');

-- Bob can't see Alice's entry before voting
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'meme')::uuid);
begin
  assert m->'players'->0->'submission' = 'null'::jsonb, 'entry hidden from opponent';
  assert (select count(*) from public.submissions where match_id = (select v from ctx where k = 'meme')::uuid) = 0, 'rls hides entries';
end $$;
select public.join_match((select v from ctx where k = 'meme')::uuid);
select public.submit_entry((select v from ctx where k = 'meme')::uuid, null, null,
  '{"templateId":"pov"}', '{"kind":"text","body":"bob caption"}');

do $$
declare m jsonb := public.get_match((select v from ctx where k = 'meme')::uuid);
begin
  assert m->>'status' = 'voting', 'voting';
  assert m->'players'->0->'submission'->'display'->>'body' = 'alice caption', 'entries visible during voting';
end $$;

-- Players can't vote on their own match
do $$
begin
  perform public.cast_vote((select v from ctx where k = 'meme')::uuid, '22222222-2222-4222-8222-222222222222');
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%own match%', sqlerrm;
end $$;

-- Carol judges; can't vote twice
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
do $$
begin
  assert jsonb_array_length(public.list_voting_matches()) = 1, 'carol sees one contest to judge';
end $$;
select public.cast_vote((select v from ctx where k = 'meme')::uuid, '22222222-2222-4222-8222-222222222222');
do $$
begin
  perform public.cast_vote((select v from ctx where k = 'meme')::uuid, '22222222-2222-4222-8222-222222222222');
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%already voted%', sqlerrm;
end $$;
do $$
begin
  assert jsonb_array_length(public.list_voting_matches()) = 0, 'judged contests disappear';
end $$;

-- Deadline passes -> settles with the leader
reset role;
update public.matches set voting_ends_at = now() - interval '1 minute' where id = (select v from ctx where k = 'meme')::uuid;
set role authenticated;
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'meme')::uuid);
begin
  assert m->>'status' = 'completed', 'settled after deadline';
  assert m->>'winnerId' = '22222222-2222-4222-8222-222222222222', 'bob leads on votes';
end $$;

-- ---------------------------------------------------------------- Practice vs bot
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
insert into ctx values ('practice', (select public.start_practice('hot-takes')::text));
select public.submit_entry((select v from ctx where k = 'practice')::uuid, null, null, '{}', '{"kind":"text","body":"mine"}');
select public.submit_entry((select v from ctx where k = 'practice')::uuid, '00000000-0000-4000-8000-00000000b075', null, '{}', '{"kind":"text","body":"bot"}');
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'practice')::uuid);
begin
  assert m->>'status' = 'completed', 'practice contests settle instantly';
  assert (m->>'simulatedVotes')::boolean, 'flagged as simulated';
end $$;
-- Others can't see practice matches
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
begin
  assert public.get_match((select v from ctx where k = 'practice')::uuid) is null, 'practice is private';
  assert (select count(*) from public.matches where mode = 'practice') = 0, 'rls hides practice';
end $$;

-- ---------------------------------------------------------------- Quick match pairing
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
insert into ctx values ('q1', (select public.quick_match('four-in-a-row')::text));
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
insert into ctx values ('q2', (select public.quick_match('four-in-a-row')::text));
do $$
begin
  assert (select v from ctx where k = 'q1') = (select v from ctx where k = 'q2'), 'bob joins alice''s lobby';
  assert public.get_match((select v from ctx where k = 'q1')::uuid)->>'status' = 'active', 'lobby became active';
end $$;

-- Claiming a forfeit needs a silent opponent
select public.mark_started((select v from ctx where k = 'q1')::uuid);
select public.heartbeat((select v from ctx where k = 'q1')::uuid);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select public.heartbeat((select v from ctx where k = 'q1')::uuid);
do $$
begin
  perform public.claim_forfeit((select v from ctx where k = 'q1')::uuid);
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%still connected%', sqlerrm;
end $$;
reset role;
update public.match_players set last_seen_at = now() - interval '2 minutes'
 where match_id = (select v from ctx where k = 'q1')::uuid and user_id = '22222222-2222-4222-8222-222222222222';
set role authenticated;
select public.claim_forfeit((select v from ctx where k = 'q1')::uuid);
do $$
begin
  assert public.get_match((select v from ctx where k = 'q1')::uuid)->>'winnerId' = '11111111-1111-4111-8111-111111111111', 'forfeit claimed';
end $$;

-- ---------------------------------------------------------------- Open challenge links
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
insert into ctx values ('open', (select public.create_challenge('emoji-decode', 'async', null)::text));
select public.submit_entry((select v from ctx where k = 'open')::uuid, null, 900);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'open')::uuid);
begin
  assert (m->>'isOpen')::boolean, 'open';
  assert (m->'players'->0->>'score')::numeric = 900, 'score to beat is visible';
end $$;
select public.join_match((select v from ctx where k = 'open')::uuid);
select public.submit_entry((select v from ctx where k = 'open')::uuid, null, 1200);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
do $$
begin
  perform public.join_match((select v from ctx where k = 'open')::uuid);
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%no longer open%', sqlerrm;
end $$;
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'open')::uuid);
begin
  assert m->>'winnerId' = '22222222-2222-4222-8222-222222222222', 'bob beat the score';
end $$;

-- ---------------------------------------------------------------- Apps from the developer portal
insert into public.apps (slug, name, category, url, official, status, developer_id)
values ('my-game', 'My Game', 'games', 'https://my-game.dev/play', true, 'published', '22222222-2222-4222-8222-222222222222');
do $$
begin
  assert (select status from public.apps where slug = 'my-game') = 'pending', 'submissions start pending';
  assert not (select official from public.apps where slug = 'my-game'), 'cannot self-promote to official';
  assert (select developer_id from public.apps where slug = 'my-game') = '11111111-1111-4111-8111-111111111111', 'owner forced to caller';
end $$;
do $$
begin
  insert into public.apps (slug, name, category, url) values ('bad-url', 'Bad', 'games', 'javascript:alert(1)');
  raise exception 'expected failure';
exception when check_violation then
  null;
end $$;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
do $$
begin
  assert (select count(*) from public.apps where slug = 'my-game') = 0, 'pending apps hidden from others';
  assert jsonb_array_length(public.leaderboard(null)) >= 2, 'global leaderboard';
  assert (public.leaderboard('quick-draw')->0->'profile'->>'handle') = 'alice_x', 'per-app leaderboard';
end $$;

-- ---------------------------------------------------------------- Realtime room authorization
select set_config('realtime.topic', 'match:' || (select v from ctx where k = 'live'), false);
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
do $$
begin
  insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}');
  raise exception 'expected failure';
exception when insufficient_privilege then
  null;
end $$;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}');

-- Internal functions are not callable by clients
do $$
begin
  perform public.settle_match((select v from ctx where k = 'live')::uuid, null);
  raise exception 'expected failure';
exception when insufficient_privilege then
  null;
end $$;

-- ---------------------------------------------------------------- Challenge settings + meme drops
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
insert into ctx values ('drop', (select public.create_challenge('meme-duel', 'async', null,
  '{"topic":"Monday mornings","drop":{"src":"https://x.supabase.co/storage/v1/object/public/meme-drops/a.jpg","width":800,"height":600},"quick":true}')::text));
do $$
declare m jsonb := public.get_match((select v from ctx where k = 'drop')::uuid);
begin
  assert m->'settings'->>'topic' = 'Monday mornings', 'settings stored';
  assert (m->'settings'->'drop'->>'width')::int = 800, 'drop stored';
  assert not (m->'settings' ? 'quick'), 'reserved keys stripped';
end $$;
do $$
begin
  perform public.create_challenge('meme-duel', 'async', null, '"nope"');
  raise exception 'expected failure';
exception when invalid_parameter_value then
  null;
end $$;
do $$
begin
  perform public.create_challenge('meme-duel', 'async', null, jsonb_build_object('topic', repeat('x', 5000)));
  raise exception 'expected failure';
exception when invalid_parameter_value then
  null;
end $$;
-- Uploads only land in your own folder
insert into storage.objects (bucket_id, name) values ('meme-drops', '11111111-1111-4111-8111-111111111111/one.jpg');
do $$
begin
  insert into storage.objects (bucket_id, name) values ('meme-drops', '22222222-2222-4222-8222-222222222222/nope.jpg');
  raise exception 'expected failure';
exception when insufficient_privilege then
  null;
end $$;

reset role;
do $$
begin
  assert (select name from public.apps where slug = 'quick-draw') = 'Reflexes', 'Reflexes rename';
end $$;

-- ================================================================ v2: general matches
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-4555-8555-555555555555', null, '{"user_name":"dave","full_name":"Dave"}'),
  ('66666666-6666-4666-8666-666666666666', null, '{"user_name":"erin","full_name":"Erin"}');

-- Test helpers: sign in by handle, read a saved match id, a player's row in a match.
create function pg_temp.login(p_handle text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', (select id::text from public.profiles where handle = p_handle), false);
$$;
create function pg_temp.mid(p_key text) returns uuid language sql as $$
  select v::uuid from ctx where k = p_key;
$$;
create function pg_temp.uid(p_handle text) returns uuid language sql as $$
  select id from public.profiles where handle = p_handle;
$$;
-- The player object for a handle inside match JSON.
create function pg_temp.pl(m jsonb, p_handle text) returns jsonb language sql as $$
  select e from jsonb_array_elements(m->'players') e where e->'profile'->>'handle' = p_handle;
$$;

insert into public.apps
  (slug, name, category, url, modes, min_players, max_players, team_count, scoring, votes_to_win,
   official, status, turn_based, allow_spectators, has_setup)
values
  ('party-four', 'Party Four', 'games', '/embed/party-four', '{live,async,practice}', 2, 4, 0, 'high', 5, true, 'published', true, true, false),
  ('golf-four', 'Golf Four', 'games', '/embed/golf-four', '{live,async,practice}', 2, 4, 0, 'low', 5, true, 'published', false, true, false),
  ('trio-async', 'Trio', 'games', '/embed/trio', '{async,practice}', 3, 4, 0, 'high', 5, true, 'published', true, true, false),
  ('duo-teams', 'Duo Teams', 'games', '/embed/duo-teams', '{live,practice}', 4, 4, 2, 'high', 5, true, 'published', false, true, true),
  ('crowd-four', 'Crowd Four', 'contests', '/embed/crowd-four', '{async,live}', 2, 4, 0, 'votes', 2, true, 'published', false, true, false),
  ('no-watch', 'No Watch', 'games', '/embed/no-watch', '{live}', 2, 2, 0, 'high', 5, true, 'published', false, false, false);

-- Manifest constraints
do $$
begin
  begin
    insert into public.apps (slug, name, category, url, official, status, min_players, max_players, team_count)
    values ('bad-teams', 'Bad', 'games', '/x', true, 'published', 2, 4, 3);
    raise exception 'expected failure';
  exception when check_violation then null;
  end;
  begin
    insert into public.apps (slug, name, category, url, official, status, min_players, max_players)
    values ('bad-range', 'Bad', 'games', '/x', true, 'published', 5, 4);
    raise exception 'expected failure';
  exception when check_violation then null;
  end;
end $$;

-- v1 rows were backfilled
do $$
begin
  assert not exists (select 1 from public.match_players where role <> 'player' or (result is not null and rank is null)), 'v1 players backfilled';
  assert (select rank from public.match_players mp join public.matches m on m.id = mp.match_id
           where m.app_slug = 'quick-draw' and mp.user_id = pg_temp.uid('bob') and m.status = 'completed' limit 1) = 2, 'v1 loser ranked 2nd';
  assert (select count(*) from public.profiles where is_bot) = 7, 'seven practice bots';
end $$;

-- ---------------------------------------------------------------- 4 seats: invites + open seat + early start
set role authenticated;
select pg_temp.login('alice_x');
do $$
begin
  perform public.create_challenge('party-four', 'live', null, '{}', array['bob', 'carol', 'dave', 'erin']);
  raise exception 'expected failure';
exception when invalid_parameter_value then
  assert sqlerrm like '%invite up to 3%', sqlerrm;
end $$;
do $$
begin
  perform public.create_challenge('party-four', 'live', p_opponents => array['bob', 'carol'], p_max_players => 2);
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;
do $$
begin
  perform public.create_challenge('party-four', 'live', p_max_players => 5);
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;

insert into ctx values ('p4', public.create_challenge('party-four', 'live', '@Bob', '{"topic":"x"}', array['carol', 'bob'], 4)::text);
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'status' = 'open', 'open seat keeps the lobby open';
  assert (m->>'isOpen')::boolean, 'joinable by link';
  assert (m->>'minPlayers')::int = 2 and (m->>'maxPlayers')::int = 4 and (m->>'teams')::int = 0, 'table size';
  assert (m->>'stateVersion')::int = 0 and m->'state' = 'null'::jsonb and (m->>'round')::int = 0, 'fresh state';
  assert m->'turnUserId' = 'null'::jsonb and m->'winnerTeam' = 'null'::jsonb and (m->>'spectatorCount')::int = 0, 'no turn yet';
  assert jsonb_array_length(m->'players') = 3, 'creator + two invites (deduplicated)';
  assert pg_temp.pl(m, 'bob')->>'seat' = '1' and pg_temp.pl(m, 'bob')->>'state' = 'invited', 'bob invited to seat 1';
  assert pg_temp.pl(m, 'carol')->>'seat' = '2', 'carol seat 2';
  assert pg_temp.pl(m, 'alice_x')->>'role' = 'player' and pg_temp.pl(m, 'alice_x')->'team' = 'null'::jsonb, 'roles';
end $$;

-- Dave takes the open seat, Bob accepts; Carol hasn't answered yet.
select pg_temp.login('dave');
select public.join_match(pg_temp.mid('p4'));
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('p4'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'status' = 'open', 'still waiting on carol';
  assert not (m->>'isOpen')::boolean, 'every seat is taken';
  assert pg_temp.pl(m, 'dave')->>'seat' = '3', 'dave took the free seat';
end $$;
do $$
begin
  perform public.start_match(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
select pg_temp.login('erin');
do $$
begin
  perform public.join_match(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%no longer open%', sqlerrm;
end $$;
select pg_temp.login('alice_x');
select public.start_match(pg_temp.mid('p4'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'status' = 'active', 'started early';
  assert jsonb_array_length(m->'players') = 3, 'carol''s invite withdrawn';
  assert pg_temp.pl(m, 'carol') is null, 'carol gone';
end $$;
do $$
begin
  perform public.start_match(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%already started%', sqlerrm;
end $$;

-- ---------------------------------------------------------------- Spectators
select pg_temp.login('erin');
select public.spectate_match(pg_temp.mid('p4'));
select public.spectate_match(pg_temp.mid('p4')); -- idempotent
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert jsonb_array_length(m->'players') = 4, 'viewer sees own spectator row';
  assert m->'players'->3->'profile'->>'handle' = 'erin', 'spectator row last';
  assert m->'players'->3->>'role' = 'spectator' and m->'players'->3->'seat' = 'null'::jsonb, 'no seat';
  assert (m->>'spectatorCount')::int = 1, 'counted';
end $$;
do $$
begin
  perform public.submit_entry(pg_temp.mid('p4'), null, 1);
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.submit_entry(pg_temp.mid('p4'), pg_temp.uid('bob'), 1);
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.update_match_state(pg_temp.mid('p4'), '{"hack":true}', 0);
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.end_turn(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.set_round(pg_temp.mid('p4'), 3);
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.mark_started(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
-- Spectators share the realtime room
select set_config('realtime.topic', 'match:' || pg_temp.mid('p4'), false);
insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{"reaction":"🔥"}');
select pg_temp.login('carol');
do $$
begin
  insert into realtime.messages (topic, extension, payload) values (realtime.topic(), 'broadcast', '{}');
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
select pg_temp.login('bob');
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert jsonb_array_length(m->'players') = 3, 'players see seated players only';
  assert (m->>'spectatorCount')::int = 1, 'players see the spectator count';
end $$;
-- Apps can opt out; practice is private
select pg_temp.login('alice_x');
insert into ctx values ('nowatch', public.create_challenge('no-watch', 'live', 'bob')::text);
insert into ctx values ('p4practice', public.start_practice('party-four')::text);
select pg_temp.login('erin');
do $$
begin
  perform public.spectate_match(pg_temp.mid('nowatch'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.spectate_match(pg_temp.mid('p4practice'));
  raise exception 'expected failure';
exception when no_data_found then null;
end $$;

-- ---------------------------------------------------------------- Shared state: compare-and-set, 64 KB
select pg_temp.login('alice_x');
do $$
begin
  assert public.update_match_state(pg_temp.mid('p4'), '{"board":[1]}', 0) = 1, 'first write';
end $$;
select pg_temp.login('bob');
do $$
begin
  perform public.update_match_state(pg_temp.mid('p4'), '{"board":[2]}', 0);
  raise exception 'expected failure';
exception when serialization_failure then
  assert sqlstate = '40001' and sqlerrm = 'state_conflict', sqlerrm;
end $$;
do $$
begin
  assert public.update_match_state(pg_temp.mid('p4'), '{"board":[1,2]}', 1) = 2, 'retry on the new version';
end $$;
do $$
begin
  perform public.update_match_state(pg_temp.mid('p4'), jsonb_build_object('blob', repeat('x', 70000)), 2);
  raise exception 'expected failure';
exception when invalid_parameter_value then
  assert sqlerrm like '%too large%', sqlerrm;
end $$;
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->'state' = '{"board":[1,2]}'::jsonb and (m->>'stateVersion')::int = 2, 'state persisted';
end $$;

-- ---------------------------------------------------------------- Turns + rounds (seats: alice 0, bob 1, dave 3)
-- Turn-based app: the lowest seat moves first once the match starts.
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'turnUserId' = pg_temp.uid('alice_x')::text, 'seat 0 moves first';
  assert m->'turnDeadline' = 'null'::jsonb, 'live turns have no deadline';
end $$;
do $$
begin
  perform public.end_turn(pg_temp.mid('p4'));
  raise exception 'expected failure';
exception when insufficient_privilege then
  assert sqlerrm like '%not your turn%', sqlerrm;
end $$;
select pg_temp.login('alice_x');
select public.end_turn(pg_temp.mid('p4'));
select pg_temp.login('bob');
select public.end_turn(pg_temp.mid('p4'));
do $$
begin
  assert public.get_match(pg_temp.mid('p4'))->>'turnUserId' = pg_temp.uid('dave')::text, 'alice -> bob -> dave (skips the empty seat)';
end $$;
select pg_temp.login('dave');
do $$
begin
  perform public.end_turn(pg_temp.mid('p4'), pg_temp.uid('erin'));
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;
select public.end_turn(pg_temp.mid('p4'));
do $$
begin
  assert public.get_match(pg_temp.mid('p4'))->>'turnUserId' = pg_temp.uid('alice_x')::text, 'wraps around to seat 0';
end $$;
select pg_temp.login('alice_x');
select public.end_turn(pg_temp.mid('p4'), pg_temp.uid('bob'));
select public.set_round(pg_temp.mid('p4'), 2);
select public.set_round(pg_temp.mid('p4'), 2);
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'turnUserId' = pg_temp.uid('bob')::text, 'explicit next';
  assert (m->>'round')::int = 2, 'round set';
end $$;
do $$
begin
  perform public.set_round(pg_temp.mid('p4'), 1);
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;

-- ---------------------------------------------------------------- N-player ranking: tie for first (high)
select public.submit_entry(pg_temp.mid('p4'), null, 10);
select pg_temp.login('dave');
select public.submit_entry(pg_temp.mid('p4'), null, 5);
do $$
begin
  assert public.get_match(pg_temp.mid('p4'))->>'status' = 'active', 'waits for every seated player';
end $$;
select pg_temp.login('bob');
select public.submit_entry(pg_temp.mid('p4'), null, 10);
do $$
declare m jsonb := public.get_match(pg_temp.mid('p4'));
begin
  assert m->>'status' = 'completed', 'settled';
  assert m->'winnerId' = 'null'::jsonb, 'tied first: no winner';
  assert (pg_temp.pl(m, 'alice_x')->>'rank')::int = 1 and (pg_temp.pl(m, 'bob')->>'rank')::int = 1, 'shared first';
  assert (pg_temp.pl(m, 'dave')->>'rank')::int = 3, 'third after a two-way tie';
  assert pg_temp.pl(m, 'alice_x')->>'result' = 'draw' and pg_temp.pl(m, 'dave')->>'result' = 'loss', 'results';
  assert (pg_temp.pl(m, 'alice_x')->>'xpDelta')::int = 30 and (pg_temp.pl(m, 'dave')->>'xpDelta')::int = 8, 'xp by placement';
end $$;
reset role;
do $$
begin
  assert (select draws from public.app_player_stats where app_slug = 'party-four' and user_id = pg_temp.uid('alice_x')) = 1, 'alice draw';
  assert (select losses from public.app_player_stats where app_slug = 'party-four' and user_id = pg_temp.uid('dave')) = 1, 'dave loss';
  assert (select result from public.match_players where match_id = pg_temp.mid('p4') and user_id = pg_temp.uid('erin')) is null, 'spectators unranked';
end $$;
set role authenticated;

-- ---------------------------------------------------------------- N-player ranking: tie for last (low scoring)
select pg_temp.login('alice_x');
insert into ctx values ('golf', public.create_challenge('golf-four', 'live', p_opponents => array['bob', 'carol'])::text);
do $$
declare m jsonb := public.get_match(pg_temp.mid('golf'));
begin
  assert m->>'status' = 'pending' and (m->>'maxPlayers')::int = 3, 'table sized to the invites';
end $$;
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('golf'));
do $$
begin
  assert public.get_match(pg_temp.mid('golf'))->>'status' = 'pending', 'live waits for everyone';
end $$;
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('golf'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('golf'));
begin
  assert m->>'status' = 'active' and m->'turnUserId' = 'null'::jsonb, 'non-turn-based apps start without a turn';
end $$;
-- No turn set: anyone seated may pass; default is the next seat (wrapping).
select public.end_turn(pg_temp.mid('golf'));
do $$
begin
  assert public.get_match(pg_temp.mid('golf'))->>'turnUserId' = pg_temp.uid('alice_x')::text, 'carol (seat 2) -> alice (seat 0)';
end $$;
select public.submit_entry(pg_temp.mid('golf'), null, 5);
select pg_temp.login('bob');
select public.submit_entry(pg_temp.mid('golf'), null, 5);
select pg_temp.login('alice_x');
select public.submit_entry(pg_temp.mid('golf'), null, 3);
do $$
declare m jsonb := public.get_match(pg_temp.mid('golf'));
begin
  assert m->>'status' = 'completed', 'settled';
  assert m->>'winnerId' = pg_temp.uid('alice_x')::text, 'lowest wins';
  assert (pg_temp.pl(m, 'bob')->>'rank')::int = 2 and (pg_temp.pl(m, 'carol')->>'rank')::int = 2, 'shared second';
  assert (pg_temp.pl(m, 'bob')->>'xpDelta')::int = 8 and (pg_temp.pl(m, 'alice_x')->>'xpDelta')::int = 30, 'last gets loss xp';
  assert pg_temp.pl(m, 'alice_x')->>'result' = 'win' and pg_temp.pl(m, 'carol')->>'result' = 'loss', 'results';
end $$;

-- ---------------------------------------------------------------- Async: activates at min; turn deadline forfeits
insert into ctx values ('trio', public.create_challenge('trio-async', 'async', null, '{}', array['bob', 'carol', 'dave'])::text);
select public.submit_entry(pg_temp.mid('trio'), null, 50);
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('trio'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('trio'));
begin
  assert m->>'status' = 'pending' and (m->>'minPlayers')::int = 3, 'two seated, needs three';
end $$;
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('trio'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('trio'));
begin
  assert m->>'status' = 'active', 'async activates at min';
  assert pg_temp.pl(m, 'dave')->>'state' = 'invited', 'dave can still accept';
  assert m->>'turnUserId' = pg_temp.uid('alice_x')::text, 'async first turn: seat 0';
  assert (m->>'turnDeadline')::timestamptz > now() + interval '71 hours', 'async first turn has a deadline';
end $$;
select pg_temp.login('alice_x');
select public.end_turn(pg_temp.mid('trio'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('trio'));
begin
  assert m->>'turnUserId' = pg_temp.uid('bob')::text, 'bob''s turn';
  assert (m->>'turnDeadline')::timestamptz between now() + interval '71 hours' and now() + interval '73 hours', '3-day deadline';
end $$;
reset role;
update public.matches set turn_deadline = now() - interval '1 minute' where id = pg_temp.mid('trio');
do $$
begin
  assert public.finalize_due_matches() >= 1, 'deadline processed';
  assert (select state from public.match_players where match_id = pg_temp.mid('trio') and user_id = pg_temp.uid('bob')) = 'left', 'late turn holder forfeits';
  assert (select turn_user from public.matches where id = pg_temp.mid('trio')) = pg_temp.uid('carol'), 'turn moves on';
  assert (select turn_deadline from public.matches where id = pg_temp.mid('trio')) > now() + interval '2 days', 'new deadline';
  assert (select status from public.matches where id = pg_temp.mid('trio')) = 'active', 'three remain, match continues';
end $$;
set role authenticated;
select pg_temp.login('bob');
do $$
begin
  perform public.submit_entry(pg_temp.mid('trio'), null, 999);
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%out of this match%', sqlerrm;
end $$;
select pg_temp.login('dave');
select public.join_match(pg_temp.mid('trio'));
do $$
begin
  assert pg_temp.pl(public.get_match(pg_temp.mid('trio')), 'dave')->>'seat' = '3', 'accepting keeps the invited seat';
end $$;
select public.submit_entry(pg_temp.mid('trio'), null, 60);
select pg_temp.login('carol');
select public.submit_entry(pg_temp.mid('trio'), null, 70);
do $$
declare m jsonb := public.get_match(pg_temp.mid('trio'));
begin
  assert m->>'status' = 'completed', 'settled once everyone still in submitted';
  assert m->>'winnerId' = pg_temp.uid('carol')::text, 'carol first';
  assert (pg_temp.pl(m, 'dave')->>'rank')::int = 2 and (pg_temp.pl(m, 'alice_x')->>'rank')::int = 3, 'placements';
  assert (pg_temp.pl(m, 'bob')->>'rank')::int = 4 and pg_temp.pl(m, 'bob')->>'result' = 'loss', 'forfeiter placed last';
  assert (pg_temp.pl(m, 'dave')->>'xpDelta')::int = 23 and (pg_temp.pl(m, 'alice_x')->>'xpDelta')::int = 15
     and (pg_temp.pl(m, 'bob')->>'xpDelta')::int = 8, 'interpolated xp';
  assert m->'turnDeadline' = 'null'::jsonb, 'deadline cleared';
end $$;

-- ---------------------------------------------------------------- Teams: 2v2
select pg_temp.login('alice_x');
insert into ctx values ('teams', public.create_challenge('duo-teams', 'live', null, '{}', array['bob', 'carol', 'dave'])::text);
do $$
declare m jsonb := public.get_match(pg_temp.mid('teams'));
begin
  assert (m->>'teams')::int = 2 and (m->>'maxPlayers')::int = 4 and m->>'status' = 'pending', 'team table';
  assert (select array_agg((e->>'team')::int order by (e->>'seat')::int) from jsonb_array_elements(m->'players') e) = array[0, 1, 0, 1], 'seat % teams';
end $$;
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('teams'));
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('teams'));
select pg_temp.login('dave');
select public.join_match(pg_temp.mid('teams'));
select public.submit_entry(pg_temp.mid('teams'), null, 9);
select pg_temp.login('carol');
select public.submit_entry(pg_temp.mid('teams'), null, 5);
select pg_temp.login('bob');
select public.submit_entry(pg_temp.mid('teams'), null, 8);
select pg_temp.login('alice_x');
select public.submit_entry(pg_temp.mid('teams'), null, 10);
do $$
declare m jsonb := public.get_match(pg_temp.mid('teams'));
begin
  assert m->>'status' = 'completed', 'settled';
  assert (m->>'winnerTeam')::int = 1, 'team 1 (8 + 9) beats team 0 (10 + 5)';
  assert m->'winnerId' = 'null'::jsonb, 'no single winner in team play';
  assert (pg_temp.pl(m, 'bob')->>'rank')::int = 1 and (pg_temp.pl(m, 'dave')->>'rank')::int = 1, 'winners share first';
  assert (pg_temp.pl(m, 'alice_x')->>'rank')::int = 2 and (pg_temp.pl(m, 'carol')->>'rank')::int = 2, 'team placement';
  assert pg_temp.pl(m, 'dave')->>'result' = 'win' and pg_temp.pl(m, 'alice_x')->>'result' = 'loss', 'team results';
  assert (pg_temp.pl(m, 'bob')->>'xpDelta')::int = 30 and (pg_temp.pl(m, 'carol')->>'xpDelta')::int = 8, 'team xp';
end $$;

-- ---------------------------------------------------------------- Crowd votes with three entries
insert into ctx values ('crowd', public.create_challenge('crowd-four', 'async', null, '{}', array['bob', 'carol'])::text);
select public.submit_entry(pg_temp.mid('crowd'), null, null, '{}', '{"kind":"text","body":"alice entry"}');
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('crowd'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('crowd'));
begin
  assert m->>'status' = 'active', 'async activates at min 2';
  assert pg_temp.pl(m, 'alice_x')->'submission' = 'null'::jsonb, 'entries hidden until voting';
end $$;
select public.submit_entry(pg_temp.mid('crowd'), null, null, '{}', '{"kind":"text","body":"bob entry"}');
do $$
begin
  assert public.get_match(pg_temp.mid('crowd'))->>'status' = 'active', 'carol''s invite still open';
end $$;
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('crowd'));
select public.submit_entry(pg_temp.mid('crowd'), null, null, '{}', '{"kind":"text","body":"carol entry"}');
select pg_temp.login('erin');
select public.spectate_match(pg_temp.mid('crowd'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('crowd'));
begin
  assert m->>'status' = 'voting', 'voting';
  assert pg_temp.pl(m, 'carol')->'submission'->'display'->>'body' = 'carol entry', 'entries visible during voting';
  assert (select count(*) from jsonb_array_elements(m->'players') e where e->>'role' = 'player') = 3, 'three entries';
end $$;
do $$
begin
  perform public.cast_vote(pg_temp.mid('crowd'), pg_temp.uid('erin'));
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;
select public.cast_vote(pg_temp.mid('crowd'), pg_temp.uid('carol'));
select pg_temp.login('alice_x');
do $$
begin
  perform public.cast_vote(pg_temp.mid('crowd'), pg_temp.uid('carol'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
select pg_temp.login('dave');
select public.cast_vote(pg_temp.mid('crowd'), pg_temp.uid('carol'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('crowd'));
begin
  assert m->>'status' = 'completed', 'settles at the vote target';
  assert m->>'winnerId' = pg_temp.uid('carol')::text, 'crowd picks carol';
  assert (pg_temp.pl(m, 'alice_x')->>'rank')::int = 2 and (pg_temp.pl(m, 'bob')->>'rank')::int = 2, 'no votes share second';
end $$;

-- ---------------------------------------------------------------- Practice with four seats
select pg_temp.login('carol');
do $$
begin
  perform public.start_practice('party-four', 9);
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;
insert into ctx values ('prac4', public.start_practice('party-four', 4)::text);
do $$
declare m jsonb := public.get_match(pg_temp.mid('prac4'));
begin
  assert m->>'status' = 'active' and (m->>'maxPlayers')::int = 4, 'practice table';
  assert m->>'turnUserId' = pg_temp.uid('carol')::text and m->'turnDeadline' = 'null'::jsonb, 'practice first turn';
  assert jsonb_array_length(m->'players') = 4, 'four seats';
  assert (select count(distinct e->>'userId') from jsonb_array_elements(m->'players') e where (e->>'isBot')::boolean) = 3, 'three distinct bots';
  assert jsonb_array_length(public.get_match(public.start_practice('party-four'))->'players') = 2, 'default: app min';
end $$;
-- A human passes a bot's turn in practice
select public.end_turn(pg_temp.mid('prac4'));
select public.end_turn(pg_temp.mid('prac4'));
do $$
begin
  assert public.get_match(pg_temp.mid('prac4'))->>'turnUserId' = '00000000-0000-4000-8000-00000000b076', 'bot turns rotate';
end $$;
select public.end_turn(pg_temp.mid('prac4'), pg_temp.uid('carol'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('prac4'));
begin
  assert m->>'turnUserId' = pg_temp.uid('carol')::text, 'the human hands a bot''s turn back to herself';
  assert m->'turnDeadline' = 'null'::jsonb, 'practice turns have no deadline';
end $$;
select public.submit_entry(pg_temp.mid('prac4'), null, 5);
select public.submit_entry(pg_temp.mid('prac4'), '00000000-0000-4000-8000-00000000b075', 3);
select public.submit_entry(pg_temp.mid('prac4'), '00000000-0000-4000-8000-00000000b076', 7);
select public.submit_entry(pg_temp.mid('prac4'), '00000000-0000-4000-8000-00000000b077', 1);
do $$
declare
  m jsonb := public.get_match(pg_temp.mid('prac4'));
  me jsonb := pg_temp.pl(public.get_match(pg_temp.mid('prac4')), 'carol');
begin
  assert m->>'status' = 'completed', 'practice settled';
  assert m->>'winnerId' = '00000000-0000-4000-8000-00000000b076', 'bot 2 won';
  assert (me->>'rank')::int = 2 and (me->>'xpDelta')::int = 3, 'practice xp';
end $$;

-- ---------------------------------------------------------------- Quick lobbies + claim_forfeit with three players
select pg_temp.login('alice_x');
insert into ctx values ('qa', public.quick_match('party-four')::text);
select pg_temp.login('bob');
insert into ctx values ('qb', public.quick_match('party-four')::text);
select pg_temp.login('carol');
insert into ctx values ('qc', public.quick_match('party-four')::text);
select pg_temp.login('bob');
do $$
declare m jsonb := public.get_match(pg_temp.mid('qa'));
begin
  assert pg_temp.mid('qa') = pg_temp.mid('qb') and pg_temp.mid('qa') = pg_temp.mid('qc'), 'one lobby fills up';
  assert public.quick_match('party-four') = pg_temp.mid('qa'), 'already waiting';
  assert m->>'status' = 'open' and jsonb_array_length(m->'players') = 3, 'three of four seats';
end $$;
do $$
begin
  perform public.start_match(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
select pg_temp.login('alice_x');
select public.start_match(pg_temp.mid('qa'));
select public.mark_started(pg_temp.mid('qa'));
select public.heartbeat(pg_temp.mid('qa'));
select pg_temp.login('bob');
select public.heartbeat(pg_temp.mid('qa'));
reset role;
update public.match_players set last_seen_at = now() - interval '2 minutes'
 where match_id = pg_temp.mid('qa') and user_id = pg_temp.uid('carol');
set role authenticated;
select pg_temp.login('alice_x');
select public.claim_forfeit(pg_temp.mid('qa'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('qa'));
begin
  assert m->>'status' = 'active', 'two remain: match goes on';
  assert pg_temp.pl(m, 'carol')->>'state' = 'left', 'carol marked left';
end $$;
do $$
begin
  perform public.claim_forfeit(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when others then
  assert sqlerrm like '%still connected%', sqlerrm;
end $$;
select public.submit_entry(pg_temp.mid('qa'), null, 5);
select pg_temp.login('bob');
select public.submit_entry(pg_temp.mid('qa'), null, 7);
do $$
declare m jsonb := public.get_match(pg_temp.mid('qa'));
begin
  assert m->>'status' = 'completed', 'settled';
  assert m->>'winnerId' = pg_temp.uid('bob')::text, 'bob first';
  assert (pg_temp.pl(m, 'alice_x')->>'rank')::int = 2, 'alice second';
  assert (pg_temp.pl(m, 'carol')->>'rank')::int = 3 and pg_temp.pl(m, 'carol')->>'result' = 'loss', 'carol forfeited';
end $$;

-- ---------------------------------------------------------------- Inviting more people
select pg_temp.login('alice_x');
insert into ctx values ('inv', public.create_challenge('party-four', 'live', p_max_players => 3)::text);
select public.invite_to_match(pg_temp.mid('inv'), array['@Bob']);
do $$
declare m jsonb := public.get_match(pg_temp.mid('inv'));
begin
  assert pg_temp.pl(m, 'bob')->>'state' = 'invited' and pg_temp.pl(m, 'bob')->>'seat' = '1', 'bob invited into seat 1';
  assert (m->>'isOpen')::boolean and m->>'status' = 'open', 'one seat still open';
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['bob']);
  raise exception 'expected failure';
exception when invalid_parameter_value then
  assert sqlerrm like '%already in%', sqlerrm;
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['alice_x']);
  raise exception 'expected failure';
exception when invalid_parameter_value then null;
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['nobody_here']);
  raise exception 'expected failure';
exception when no_data_found then null;
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['xapps_bot2']);
  raise exception 'expected failure';
exception when no_data_found then null;
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['carol', 'dave']);
  raise exception 'expected failure';
exception when invalid_parameter_value then
  assert sqlerrm like '%1 free seat%', sqlerrm;
end $$;
select pg_temp.login('erin');
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['carol']);
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
select pg_temp.login('alice_x');
select public.invite_to_match(pg_temp.mid('inv'), array['carol']);
do $$
begin
  assert not (public.get_match(pg_temp.mid('inv'))->>'isOpen')::boolean, 'no open seats left';
end $$;
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('inv'));
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('inv'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('inv'));
begin
  assert m->>'status' = 'active', 'full live lobby starts';
  assert m->>'turnUserId' = pg_temp.uid('alice_x')::text, 'first turn on activation';
end $$;
do $$
begin
  perform public.invite_to_match(pg_temp.mid('inv'), array['dave']);
  raise exception 'expected failure';
exception when object_not_in_prerequisite_state then null;
end $$;
-- Running async matches with free seats can still invite (spectators too)
select pg_temp.login('alice_x');
insert into ctx values ('inv2', public.create_challenge('party-four', 'async', 'bob', '{}', null, 4)::text);
select pg_temp.login('erin');
select public.spectate_match(pg_temp.mid('inv2'));
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('inv2'));
select public.invite_to_match(pg_temp.mid('inv2'), array['erin']);
select pg_temp.login('erin');
do $$
declare m jsonb := public.get_match(pg_temp.mid('inv2'));
begin
  assert m->>'status' = 'active', 'async started at min';
  assert pg_temp.pl(m, 'erin')->>'role' = 'player' and pg_temp.pl(m, 'erin')->>'state' = 'invited', 'spectator invited to a seat';
  assert pg_temp.pl(m, 'erin')->>'seat' = '2' and (m->>'spectatorCount')::int = 0, 'seat 2';
end $$;
select public.join_match(pg_temp.mid('inv2'));
do $$
declare m jsonb := public.get_match(pg_temp.mid('inv2'));
begin
  assert pg_temp.pl(m, 'erin')->>'state' = 'joined', 'erin accepted';
  assert m->>'turnUserId' = pg_temp.uid('alice_x')::text, 'turn unchanged by joins';
end $$;

-- Settling withdraws multiplayer invites nobody answered (they aren't ranked)
set role authenticated;
select pg_temp.login('alice_x');
insert into ctx values ('unanswered', (select public.create_challenge('golf-four', 'async', null, '{}', array['bob', 'carol'], 4)::text));
select pg_temp.login('bob');
select public.join_match(pg_temp.mid('unanswered'));
select pg_temp.login('alice_x');
select public.submit_entry(pg_temp.mid('unanswered'), null, 40);
select pg_temp.login('bob');
select public.submit_entry(pg_temp.mid('unanswered'), null, 55);
reset role;
select public.settle_match(pg_temp.mid('unanswered'));
do $$
begin
  assert (select status from public.matches where id = pg_temp.mid('unanswered')) = 'completed', 'settled';
  assert not exists (select 1 from public.match_players where match_id = pg_temp.mid('unanswered') and user_id = pg_temp.uid('carol')),
    'unanswered invite withdrawn';
  assert (select rank from public.match_players where match_id = pg_temp.mid('unanswered') and user_id = pg_temp.uid('alice_x')) = 1, 'low score first';
  assert (select rank from public.match_players where match_id = pg_temp.mid('unanswered') and user_id = pg_temp.uid('bob')) = 2, 'second';
end $$;
set role authenticated;

-- Internal v2 helpers are not callable by clients
do $$
begin
  perform public.maybe_settle(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.expire_turn(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.set_first_turn(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.try_activate(pg_temp.mid('qa'));
  raise exception 'expected failure';
exception when insufficient_privilege then null;
end $$;
reset role;

-- ================================================================ v2 stage 2: trust
reset role;

-- Runs p_sql and asserts it fails with SQLSTATE p_state (and a message like p_like).
create function pg_temp.expect(p_sql text, p_state text, p_like text default null) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected %', p_state;
exception when others then
  assert sqlstate = p_state, format('%s -> %s %s (expected %s)', p_sql, sqlstate, sqlerrm, p_state);
  assert p_like is null or sqlerrm like p_like, format('%s -> message %s', p_sql, sqlerrm);
end $$;
create function pg_temp.cv(p_key text) returns text language sql as $$
  select v from ctx where k = p_key;
$$;
-- Per handle: [xp, wins, losses, draws, app played, app xp, app wins, app losses, app draws]
create function pg_temp.stats(p_app text, p_handles text[]) returns jsonb language sql as $$
  select jsonb_object_agg(p.handle, jsonb_build_array(p.xp, p.wins, p.losses, p.draws,
           coalesce(s.played, 0), coalesce(s.xp, 0), coalesce(s.wins, 0), coalesce(s.losses, 0), coalesce(s.draws, 0)))
    from public.profiles p
    left join public.app_player_stats s on s.user_id = p.id and s.app_slug = p_app
   where p.handle = any (p_handles);
$$;
create function pg_temp.delta(a jsonb, b jsonb) returns jsonb language sql as $$
  select jsonb_object_agg(k, (select jsonb_agg((b->k->>i)::int - (a->k->>i)::int order by i)
                                from generate_series(0, jsonb_array_length(a->k) - 1) i))
    from jsonb_object_keys(a) k;
$$;
-- Per handle: [rank, result, xpDelta, state]
create function pg_temp.placements(p_match uuid) returns jsonb language sql as $$
  select jsonb_object_agg(p.handle, jsonb_build_array(mp.rank, mp.result, mp.xp_delta, mp.state))
    from public.match_players mp join public.profiles p on p.id = mp.user_id
   where mp.match_id = p_match and mp.role = 'player';
$$;
-- A full, active live table on ref-party (first handle creates it).
create function pg_temp.party(p_key text, p_handles text[]) returns uuid language plpgsql as $$
declare
  v uuid;
  h text;
begin
  perform pg_temp.login(p_handles[1]);
  v := public.create_challenge('ref-party', 'live', null, '{}', p_handles[2:], cardinality(p_handles));
  foreach h in array p_handles[2:] loop
    perform pg_temp.login(h);
    perform public.join_match(v);
  end loop;
  insert into ctx values (p_key, v::text);
  return v;
end $$;
create function pg_temp.submit(p_key text, p_handle text, p_score double precision) returns void language plpgsql as $$
begin
  perform pg_temp.login(p_handle);
  perform public.submit_entry(pg_temp.mid(p_key), null, p_score);
end $$;
create function pg_temp.report(p_secret_key text, p_key text, p_result jsonb) returns jsonb language sql as $$
  select public.app_api_report_result(pg_temp.cv(p_secret_key), pg_temp.mid(p_key), p_result);
$$;
-- {"<uid of handle>": value, …} from {"<handle>": value, …}
create function pg_temp.by_uid(p jsonb) returns jsonb language sql as $$
  select jsonb_object_agg(pg_temp.uid(key)::text, value) from jsonb_each(p);
$$;

insert into public.apps
  (slug, name, category, url, modes, min_players, max_players, scoring, turn_based, official, status, developer_id)
values
  ('ref-duel', 'Ref Duel', 'games', 'https://ref-duel.example.com/play', '{live,async,practice}', 2, 2, 'high', true, false, 'published', pg_temp.uid('bob')),
  ('ref-party', 'Ref Party', 'games', 'https://ref-party.example.com/play', '{live,async,practice}', 2, 4, 'high', false, false, 'published', pg_temp.uid('bob')),
  ('ref-crowd', 'Ref Crowd', 'contests', 'https://ref-crowd.example.com/play', '{async}', 2, 2, 'votes', false, false, 'published', pg_temp.uid('bob')),
  ('ref-other', 'Ref Other', 'games', 'https://ref-other.example.com/play', '{live}', 2, 2, 'high', false, false, 'published', pg_temp.uid('carol'));

do $$
begin
  assert (select bool_and(authority = 'client') from public.apps), 'apps default to client authority';
  assert (select bool_and(authority = 'client') from public.matches), 'existing matches are client-authoritative';
  assert not exists (select 1 from public.webhook_deliveries), 'no webhooks without a webhook URL';
end $$;

-- ---------------------------------------------------------------- Owner RPCs: access
set role authenticated;
select pg_temp.login('carol');
select pg_temp.expect($q$select public.get_app_server_config('ref-duel')$q$, '42501');
select pg_temp.expect($q$select public.rotate_app_secret('ref-duel')$q$, '42501');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://evil.example.com/hook')$q$, '42501');
select pg_temp.expect($q$select public.rotate_webhook_secret('ref-duel')$q$, '42501');
select pg_temp.expect($q$select public.set_app_authority('ref-duel', 'client')$q$, '42501');
select pg_temp.expect($q$select public.list_webhook_deliveries('ref-duel')$q$, '42501');
select pg_temp.expect($q$select public.send_test_webhook('ref-duel')$q$, '42501');
select pg_temp.expect($q$select public.get_app_server_config('no-such-app')$q$, 'P0002');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect($q$select public.get_app_server_config('ref-duel')$q$, '28000');
set role anon;
select pg_temp.expect($q$select public.rotate_app_secret('ref-duel')$q$, '42501');
set role authenticated;

-- ---------------------------------------------------------------- App secret: format, hashing, rotation
select pg_temp.login('bob');
do $$
begin
  assert public.get_app_server_config('ref-duel')
    = '{"secretPrefix":null,"hasSecret":false,"webhookUrl":null,"hasWebhook":false,"authority":"client"}'::jsonb, 'fresh config';
end $$;
select pg_temp.expect($q$select public.set_app_authority('ref-duel', 'server')$q$, '55000', '%secret first%');
insert into ctx values ('sec_old', public.rotate_app_secret('ref-duel'));
insert into ctx values ('sec_duel', public.rotate_app_secret('ref-duel'));
do $$
declare c jsonb := public.get_app_server_config('ref-duel');
begin
  assert pg_temp.cv('sec_duel') ~ '^xas_[0-9a-f]{48}$' and pg_temp.cv('sec_old') ~ '^xas_[0-9a-f]{48}$', 'secret format';
  assert pg_temp.cv('sec_old') <> pg_temp.cv('sec_duel'), 'rotation makes a new secret';
  assert (c->>'hasSecret')::boolean and c->>'secretPrefix' = left(pg_temp.cv('sec_duel'), 8)
     and char_length(c->>'secretPrefix') = 8, c::text;
end $$;
-- The old secret stops working at once; the new one authenticates.
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', pg_temp.cv('sec_old'), gen_random_uuid()), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', pg_temp.cv('sec_duel'), gen_random_uuid()), 'P0002');
-- Credentials and deliveries are never readable by clients.
select pg_temp.expect('select * from public.app_credentials', '42501');
select pg_temp.expect('select * from public.webhook_deliveries', '42501');
select pg_temp.expect('update public.app_credentials set webhook_url = null', '42501');
reset role;
do $$
begin
  assert (select secret_hash from public.app_credentials where app_slug = 'ref-duel')
       = encode(extensions.digest(pg_temp.cv('sec_duel'), 'sha256'), 'hex'), 'stored as a SHA-256 hash';
  assert not exists (select 1 from public.app_credentials c
                      where c::text like '%' || substr(pg_temp.cv('sec_duel'), 5) || '%'
                         or c::text like '%' || substr(pg_temp.cv('sec_old'), 5) || '%'), 'secrets never stored in clear';
end $$;

-- ---------------------------------------------------------------- Webhook URL + signing secret
set role authenticated;
select pg_temp.login('bob');
select pg_temp.expect($q$select public.rotate_webhook_secret('ref-duel')$q$, '55000');
select pg_temp.expect($q$select public.send_test_webhook('ref-duel')$q$, '55000');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'http://hooks.example.com/x')$q$, '22023', '%https%');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://localhost:3000/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://api.localhost/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://192.168.1.10/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://127.0.0.1/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://user:pw@hooks.example.com/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://intranet/x')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'https://hooks.example.com/a b')$q$, '22023');
select pg_temp.expect($q$select public.set_app_webhook('ref-duel', 'javascript:alert(1)')$q$, '22023');
insert into ctx values ('wh1', public.set_app_webhook('ref-duel', 'https://hooks.example.com/xapps'));
do $$
declare c jsonb := public.get_app_server_config('ref-duel');
begin
  assert pg_temp.cv('wh1') ~ '^whsec_[0-9a-f]{48}$', 'signing secret format';
  assert c->>'webhookUrl' = 'https://hooks.example.com/xapps' and (c->>'hasWebhook')::boolean, c::text;
  assert not (c ? 'webhookSecret'), 'signing secret is never readable';
  assert public.set_app_webhook('ref-duel', ' https://hooks.example.com/xapps ') is null, 'same URL: no new secret';
end $$;
insert into ctx values ('wh2', public.set_app_webhook('ref-duel', 'https://hooks.example.com:8443/v2?app=ref-duel'));
insert into ctx values ('wh3', public.rotate_webhook_secret('ref-duel'));
reset role;
do $$
begin
  assert pg_temp.cv('wh2') ~ '^whsec_[0-9a-f]{48}$' and pg_temp.cv('wh2') <> pg_temp.cv('wh1'), 'changed URL: new secret';
  assert pg_temp.cv('wh3') ~ '^whsec_[0-9a-f]{48}$' and pg_temp.cv('wh3') <> pg_temp.cv('wh2'), 'rotated';
  assert (select webhook_secret from public.app_credentials where app_slug = 'ref-duel') = pg_temp.cv('wh3'), 'rotation replaces the secret';
  assert (select webhook_url from public.app_credentials where app_slug = 'ref-duel') = 'https://hooks.example.com:8443/v2?app=ref-duel', 'url stored';
end $$;
set role authenticated;
select pg_temp.login('bob');
do $$
declare c jsonb;
begin
  assert public.set_app_webhook('ref-duel', null) is null, 'clearing returns null';
  c := public.get_app_server_config('ref-duel');
  assert not (c->>'hasWebhook')::boolean and c->'webhookUrl' = 'null'::jsonb and (c->>'hasSecret')::boolean, c::text;
  assert public.set_app_webhook('ref-duel', '') is null, 'clearing twice is fine';
end $$;
select pg_temp.expect($q$select public.rotate_webhook_secret('ref-duel')$q$, '55000');
insert into ctx values ('wh_duel', public.set_app_webhook('ref-duel', 'https://duel.example.com/webhooks'));
insert into ctx values ('sec_party', public.rotate_app_secret('ref-party'));
insert into ctx values ('wh_party', public.set_app_webhook('ref-party', 'https://party.example.com/webhooks'));
select pg_temp.login('carol');
insert into ctx values ('sec_other', public.rotate_app_secret('ref-other'));

-- ---------------------------------------------------------------- Authority
select pg_temp.login('bob');
select pg_temp.expect($q$select public.set_app_authority('ref-duel', 'referee')$q$, '22023');
select pg_temp.expect($q$select public.set_app_authority('ref-duel', null)$q$, '22023');
insert into ctx values ('sec_crowd', public.rotate_app_secret('ref-crowd'));
select pg_temp.expect($q$select public.set_app_authority('ref-crowd', 'server')$q$, '22023', '%Crowd-judged%');
select public.set_app_authority('ref-duel', 'server');
do $$
begin
  assert public.get_app_server_config('ref-duel')->>'authority' = 'server', 'server authority';
end $$;
-- Direct writes can't change authority (it needs the RPC's checks).
select pg_temp.login('alice_x');
update public.apps set authority = 'server' where slug = 'my-game';
insert into public.apps (slug, name, category, url, authority)
values ('my-server-app', 'My Server App', 'games', 'https://my-server.example.com/', 'server');
reset role;
do $$
begin
  assert (select authority from public.apps where slug = 'my-game') = 'client', 'client update ignored';
  assert (select authority from public.apps where slug = 'my-server-app') = 'client', 'client insert forced to client';
  assert (select status from public.apps where slug = 'ref-duel') = 'published', 'set_app_authority keeps the app published';
end $$;
do $$
begin
  update public.apps set authority = 'server' where slug = 'ref-crowd';
  raise exception 'expected failure';
exception when check_violation then null;
end $$;

-- ---------------------------------------------------------------- Server-authoritative 1v1: server API
set role authenticated;
select pg_temp.login('alice_x');
insert into ctx values ('sa', public.create_challenge('ref-duel', 'live', 'carol')::text);
select pg_temp.login('carol');
select public.join_match(pg_temp.mid('sa'));
select pg_temp.login('carol');
insert into ctx values ('om', public.create_challenge('ref-other', 'live', 'alice_x')::text);
reset role;
do $$
declare d public.webhook_deliveries;
begin
  assert (select authority from public.matches where id = pg_temp.mid('sa')) = 'server', 'matches snapshot the app authority';
  select * into d from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.created';
  assert d.payload->>'type' = 'match.created' and d.payload->>'id' = d.id::text, d.payload::text;
  assert d.payload->'app' = '{"slug":"ref-duel"}'::jsonb and d.app_slug = 'ref-duel', 'app';
  assert (d.payload->>'createdAt')::timestamptz = d.created_at, 'createdAt';
  assert d.payload->'match'->>'id' = pg_temp.mid('sa')::text and d.payload->'match'->>'status' = 'pending', 'match at enqueue time';
  assert jsonb_array_length(d.payload->'match'->'players') = 2, 'enqueued at commit: players already seated';
  assert d.attempts = 0 and d.request_id is null and d.delivered_at is null and d.next_attempt_at <= now(), 'queued';
  assert not (d.payload ? 'reason'), 'no reason';
  assert (select array_agg(event order by created_at) from public.webhook_deliveries where match_id = pg_temp.mid('sa'))
       = array['match.created', 'match.started', 'match.turn'], 'created, then started + first turn on join';
  assert (select payload->'match'->>'turnUserId' from public.webhook_deliveries
           where match_id = pg_temp.mid('sa') and event = 'match.turn') = pg_temp.uid('alice_x')::text, 'turn payload';
  assert not exists (select 1 from public.webhook_deliveries where match_id = pg_temp.mid('om')), 'apps without a webhook get none';
end $$;

-- The routes call the server API with the anon key and no user session.
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare m jsonb := public.app_api_get_match(pg_temp.cv('sec_duel'), pg_temp.mid('sa'));
begin
  assert m->>'id' = pg_temp.mid('sa')::text and m->>'status' = 'active' and m->>'authority' = 'server', m::text;
  assert m->>'appSlug' = 'ref-duel' and (m->>'maxPlayers')::int = 2 and m ? 'stateVersion' and m ? 'spectatorCount', 'match shape';
  assert jsonb_array_length(m->'players') = 2 and pg_temp.pl(m, 'carol')->>'role' = 'player', 'players';
  assert pg_temp.pl(m, 'carol') ? 'claimedScore', 'claims visible to the app server';
end $$;
-- Bad, missing or foreign credentials
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', 'xas_' || repeat('0', 48), pg_temp.mid('sa')), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_get_match(null, %L)', pg_temp.mid('sa')), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', 'Bearer nope', pg_temp.mid('sa')), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 0)', 'xas_nope', pg_temp.mid('sa'), '{}'), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_end_turn(%L, %L)', 'xas_nope', pg_temp.mid('sa')), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, 1)', 'xas_nope', pg_temp.mid('sa')), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', 'xas_nope', pg_temp.mid('sa'), '{}'), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', pg_temp.cv('sec_other'), pg_temp.mid('sa')), '42501');
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('om')), '42501');
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 0)', pg_temp.cv('sec_other'), pg_temp.mid('sa'), '{}'), '42501');
select pg_temp.expect(format('select public.app_api_end_turn(%L, %L)', pg_temp.cv('sec_other'), pg_temp.mid('sa')), '42501');
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, 1)', pg_temp.cv('sec_other'), pg_temp.mid('sa')), '42501');
select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', pg_temp.cv('sec_other'), pg_temp.mid('sa'), '{}'), '42501');
select pg_temp.expect(format('select public.app_api_get_match(%L, %L)', pg_temp.cv('sec_duel'), gen_random_uuid()), 'P0002');
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 0)', pg_temp.cv('sec_duel'), gen_random_uuid(), '{}'), 'P0002');
select pg_temp.expect(format('select public.app_api_end_turn(%L, %L)', pg_temp.cv('sec_duel'), gen_random_uuid()), 'P0002');
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, 1)', pg_temp.cv('sec_duel'), gen_random_uuid()), 'P0002');
select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', pg_temp.cv('sec_duel'), gen_random_uuid(), '{}'), 'P0002');

-- Shared state: compare-and-set (two writes -> one debounced match.state webhook)
select public.app_api_set_state(pg_temp.cv('sec_duel'), pg_temp.mid('sa'), '{"board":[1]}', 0);
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 0)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'), '{"board":[2]}'),
  '40001', 'state_conflict');
do $$
begin
  assert public.app_api_set_state(pg_temp.cv('sec_duel'), pg_temp.mid('sa'), '{"board":[1,2]}', 1) = 2, 'second write';
end $$;
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, null)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'), '{}'), '22023');
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 2)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'),
  jsonb_build_object('blob', repeat('x', 70000))), '22023', '%too large%');
-- Turns + rounds: the server can pass anyone's turn
select pg_temp.expect(format('select public.app_api_end_turn(%L, %L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'), pg_temp.uid('erin')), '22023');
do $$
declare m jsonb := public.app_api_end_turn(pg_temp.cv('sec_duel'), pg_temp.mid('sa'));
begin
  assert m->>'turnUserId' = pg_temp.uid('carol')::text, 'alice -> carol';
  assert m->'turnDeadline' = 'null'::jsonb, 'live: no deadline';
end $$;
do $$
declare m jsonb := public.app_api_end_turn(pg_temp.cv('sec_duel'), pg_temp.mid('sa'), pg_temp.uid('alice_x'));
begin
  assert m->>'turnUserId' = pg_temp.uid('alice_x')::text, 'explicit next';
  assert (public.app_api_set_round(pg_temp.cv('sec_duel'), pg_temp.mid('sa'), 3)->>'round')::int = 3, 'round';
  assert (public.app_api_set_round(pg_temp.cv('sec_duel'), pg_temp.mid('sa'), 3)->>'round')::int = 3, 'same round is fine';
end $$;
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, 1)', pg_temp.cv('sec_duel'), pg_temp.mid('sa')), '22023');
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, null)', pg_temp.cv('sec_duel'), pg_temp.mid('sa')), '22023');

-- Players submit: stored + marked submitted, but never settled; scores are claims.
set role authenticated;
select pg_temp.login('alice_x');
select public.submit_entry(pg_temp.mid('sa'), null, 99, '{"moves":[3,4]}', '{"kind":"text","body":"gg"}');
select pg_temp.login('carol');
do $$
declare m jsonb := public.get_match(pg_temp.mid('sa'));
begin
  assert pg_temp.pl(m, 'alice_x')->'submission' = 'null'::jsonb, 'players still can''t peek';
  assert pg_temp.pl(m, 'alice_x')->>'state' = 'submitted' and pg_temp.pl(m, 'alice_x')->'score' = 'null'::jsonb, 'claim is not a score';
  assert m->'state' = '{"board":[1,2]}'::jsonb and (m->>'stateVersion')::int = 2 and (m->>'round')::int = 3, 'server writes visible to players';
end $$;
-- The score is optional when the server referees.
select public.submit_entry(pg_temp.mid('sa'), null, null, '{"moves":[1]}');
do $$
declare m jsonb := public.get_match(pg_temp.mid('sa'));
begin
  assert m->>'status' = 'active' and m->'winnerId' = 'null'::jsonb, 'server-authoritative: submitting never settles';
end $$;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare m jsonb := public.app_api_get_match(pg_temp.cv('sec_duel'), pg_temp.mid('sa'));
begin
  assert pg_temp.pl(m, 'alice_x')->'submission' = '{"data":{"moves":[3,4]},"display":{"kind":"text","body":"gg"}}'::jsonb, 'app server sees every entry';
  assert pg_temp.pl(m, 'carol')->'submission'->'data' = '{"moves":[1]}'::jsonb, 'both entries';
  assert (pg_temp.pl(m, 'alice_x')->>'claimedScore')::numeric = 99 and pg_temp.pl(m, 'alice_x')->'score' = 'null'::jsonb, 'claim';
  assert pg_temp.pl(m, 'carol')->'claimedScore' = 'null'::jsonb, 'no claim';
end $$;
reset role;
do $$
begin
  assert (select all_submitted_at from public.matches where id = pg_temp.mid('sa')) > now() - interval '1 minute', 'waiting for the report';
  perform public.finalize_due_matches();
  assert (select status from public.matches where id = pg_temp.mid('sa')) = 'active', 'no timeout before 24 h';
end $$;

-- report_result: invalid bodies (nothing changes)
set role anon;
create function pg_temp.bad_report(p_body jsonb, p_like text default null) returns void language sql as $$
  select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'), p_body),
    '22023', p_like);
$$;
select pg_temp.bad_report('[]');
select pg_temp.bad_report('{}', '%scores or ranks%');
select pg_temp.bad_report('{"scores":null,"ranks":null}');
select pg_temp.bad_report('{"scores":[1,2]}');
select pg_temp.bad_report('{"scores":{"not-a-uuid":1}}');
select pg_temp.bad_report(jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":1,"carol":2,"erin":3}')), '%isn''t a player%');
select pg_temp.bad_report(jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":1}')), 'Missing a score%');
select pg_temp.bad_report(jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":"1","carol":2}')));
select pg_temp.bad_report(jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":1e12,"carol":2}')));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1}')), 'Missing a rank%');
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":0,"carol":1}')));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1.5,"carol":1}')));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1,"carol":2}'), 'leavers', 'x'));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1}'), 'leavers', jsonb_build_array(pg_temp.uid('erin'))));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1}'), 'leavers', jsonb_build_array(42)));
select pg_temp.bad_report(jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1,"carol":2}'), 'leavers', jsonb_build_array(pg_temp.uid('carol'))));
reset role;
do $$
begin
  assert (select status from public.matches where id = pg_temp.mid('sa')) = 'active', 'invalid reports change nothing';
  assert (select count(*) from public.match_players where match_id = pg_temp.mid('sa') and (state <> 'submitted' or rank is not null)) = 0, 'untouched';
end $$;

-- report_result with ranks: honored over the players' claims (alice claimed 99).
set role anon;
do $$
declare m jsonb := pg_temp.report('sec_duel', 'sa', jsonb_build_object('ranks', pg_temp.by_uid('{"carol":1,"alice_x":2}')));
begin
  assert m->>'status' = 'completed' and m->>'winnerId' = pg_temp.uid('carol')::text, 'server decides';
  assert (pg_temp.pl(m, 'carol')->>'rank')::int = 1 and pg_temp.pl(m, 'carol')->>'result' = 'win'
     and (pg_temp.pl(m, 'carol')->>'xpDelta')::int = 30, 'winner';
  assert (pg_temp.pl(m, 'alice_x')->>'rank')::int = 2 and pg_temp.pl(m, 'alice_x')->>'result' = 'loss'
     and (pg_temp.pl(m, 'alice_x')->>'xpDelta')::int = 8, 'loser';
  assert pg_temp.pl(m, 'alice_x')->'score' = 'null'::jsonb, 'a ranks-only report sets no scores';
end $$;
select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'),
  jsonb_build_object('ranks', pg_temp.by_uid('{"carol":1,"alice_x":2}'))), '55000', '%already settled%');
select pg_temp.expect(format('select public.app_api_set_state(%L, %L, %L, 2)', pg_temp.cv('sec_duel'), pg_temp.mid('sa'), '{}'), '55000');
select pg_temp.expect(format('select public.app_api_end_turn(%L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('sa')), '55000');
select pg_temp.expect(format('select public.app_api_set_round(%L, %L, 4)', pg_temp.cv('sec_duel'), pg_temp.mid('sa')), '55000');
reset role;
do $$
begin
  assert (select wins from public.app_player_stats where app_slug = 'ref-duel' and user_id = pg_temp.uid('carol')) = 1, 'stats';
  assert (select array_agg(event order by created_at) from public.webhook_deliveries where match_id = pg_temp.mid('sa'))
       = array['match.created', 'match.started', 'match.turn', 'match.state', 'match.turn', 'match.turn',
               'match.submitted', 'match.submitted', 'match.ended'], 'event log';
  assert (select count(*) from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.state') = 1,
    'match.state debounced to one pending delivery';
  assert (select payload->'match' from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.state')
         @> '{"state":{"board":[1,2]},"stateVersion":2}'::jsonb, 'debounced payload carries the latest state';
  assert (select array_agg(payload->>'userId' order by created_at) from public.webhook_deliveries
           where match_id = pg_temp.mid('sa') and event = 'match.submitted')
       = array[pg_temp.uid('alice_x')::text, pg_temp.uid('carol')::text], 'match.submitted names the player';
  assert (select payload->'match'->>'status' from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.ended') = 'completed', 'ended';
  assert not (select payload ? 'reason' from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.ended'), 'reported: no reason';
  assert (select payload->'match'->'players'->0->'submission' from public.webhook_deliveries
           where match_id = pg_temp.mid('sa') and event = 'match.ended') is not null, 'app-view match in payloads';
end $$;

-- ---------------------------------------------------------------- Server timeout: a draw after 24 h
set role authenticated;
select pg_temp.login('dave');
insert into ctx values ('st', public.create_challenge('ref-duel', 'async', 'erin')::text);
select public.submit_entry(pg_temp.mid('st'), null, 5);
set role anon;
select pg_temp.expect(format('select public.app_api_report_result(%L, %L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('st'),
  jsonb_build_object('ranks', pg_temp.by_uid('{"dave":1,"erin":2}'))), '55000', '%hasn''t started%');
set role authenticated;
select pg_temp.login('erin');
select public.join_match(pg_temp.mid('st'));
reset role;
-- Someone still has to play: an old timestamp doesn't matter.
update public.matches set all_submitted_at = now() - interval '2 days' where id = pg_temp.mid('st');
do $$
begin
  perform public.finalize_due_matches();
  assert (select status from public.matches where id = pg_temp.mid('st')) = 'active', 'no timeout while players are pending';
end $$;
set role authenticated;
select pg_temp.login('erin');
select public.submit_entry(pg_temp.mid('st'), null, 7);
reset role;
insert into ctx values ('st_before', pg_temp.stats('ref-duel', array['dave', 'erin'])::text);
do $$
begin
  assert (select all_submitted_at from public.matches where id = pg_temp.mid('st')) > now() - interval '1 minute', 'clock restarts at the last submit';
  perform public.finalize_due_matches();
  assert (select status from public.matches where id = pg_temp.mid('st')) = 'active', 'still waiting';
end $$;
update public.matches set all_submitted_at = now() - interval '25 hours' where id = pg_temp.mid('st');
do $$
begin
  assert public.finalize_due_matches() >= 1, 'timeout processed';
end $$;
do $$
declare
  m jsonb := public.app_match_json((select x from public.matches x where x.id = pg_temp.mid('st')));
  d public.webhook_deliveries;
begin
  assert m->>'status' = 'completed' and m->'winnerId' = 'null'::jsonb and m->>'endReason' = 'server_timeout', m::text;
  assert (pg_temp.pl(m, 'dave')->>'rank')::int = 1 and (pg_temp.pl(m, 'erin')->>'rank')::int = 1, 'shared first';
  assert pg_temp.pl(m, 'dave')->>'result' = 'draw' and (pg_temp.pl(m, 'erin')->>'xpDelta')::int = 15, 'draw xp';
  assert pg_temp.delta(pg_temp.cv('st_before')::jsonb, pg_temp.stats('ref-duel', array['dave', 'erin']))
       = '{"dave":[15,0,0,1,1,15,0,0,1],"erin":[15,0,0,1,1,15,0,0,1]}'::jsonb, 'only the draw';
  select * into d from public.webhook_deliveries where match_id = pg_temp.mid('st') and event = 'match.ended';
  assert d.payload->>'reason' = 'server_timeout' and d.payload->'match'->>'endReason' = 'server_timeout', d.payload::text;
end $$;

-- ---------------------------------------------------------------- report_result = settle_match (client-authoritative ref-party)
-- 2 players, scores: twin A settles from submissions, twin B from the report.
set role authenticated;
select pg_temp.party('r2a', array['alice_x', 'bob']);
insert into ctx values ('s0', pg_temp.stats('ref-party', array['alice_x', 'bob'])::text);
select pg_temp.submit('r2a', 'alice_x', 10);
select pg_temp.submit('r2a', 'bob', 5);
insert into ctx values ('s1', pg_temp.stats('ref-party', array['alice_x', 'bob'])::text);
select pg_temp.party('r2b', array['alice_x', 'bob']);
select pg_temp.submit('r2b', 'bob', 700);
set role anon;
select pg_temp.report('sec_party', 'r2b', jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":10,"bob":5}')))->>'status';
insert into ctx values ('s2', pg_temp.stats('ref-party', array['alice_x', 'bob'])::text);
do $$
begin
  assert pg_temp.placements(pg_temp.mid('r2a')) = '{"alice_x":[1,"win",30,"submitted"],"bob":[2,"loss",8,"submitted"]}'::jsonb,
    pg_temp.placements(pg_temp.mid('r2a'))::text;
  assert (pg_temp.placements(pg_temp.mid('r2b'))->'alice_x') = '[1,"win",30,"joined"]'::jsonb
     and (pg_temp.placements(pg_temp.mid('r2b'))->'bob') = '[2,"loss",8,"submitted"]'::jsonb, 'same placements';
  assert pg_temp.delta(pg_temp.cv('s0')::jsonb, pg_temp.cv('s1')::jsonb) = pg_temp.delta(pg_temp.cv('s1')::jsonb, pg_temp.cv('s2')::jsonb),
    'same XP/stats as settle_match';
  assert (select array_agg(score order by seat) from public.match_players where match_id = pg_temp.mid('r2b')) = array[10, 5]::float8[],
    'reported scores are final (bob''s 700 replaced)';
  assert (select winner_id from public.matches where id = pg_temp.mid('r2b')) = pg_temp.uid('alice_x'), 'winner';
end $$;

-- 2 players, ranks win over scores: a draw.
set role authenticated;
select pg_temp.party('r2c', array['alice_x', 'bob']);
select pg_temp.submit('r2c', 'alice_x', 5);
select pg_temp.submit('r2c', 'bob', 5);
insert into ctx values ('s3', pg_temp.stats('ref-party', array['alice_x', 'bob'])::text);
select pg_temp.party('r2d', array['alice_x', 'bob']);
set role anon;
select pg_temp.report('sec_party', 'r2d', jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":100,"bob":0}'),
                                                             'ranks', pg_temp.by_uid('{"alice_x":1,"bob":1}')))->>'status';
insert into ctx values ('s4', pg_temp.stats('ref-party', array['alice_x', 'bob'])::text);
do $$
begin
  assert pg_temp.placements(pg_temp.mid('r2d')) = '{"alice_x":[1,"draw",15,"joined"],"bob":[1,"draw",15,"joined"]}'::jsonb,
    pg_temp.placements(pg_temp.mid('r2d'))::text;
  assert pg_temp.delta(pg_temp.cv('s2')::jsonb, pg_temp.cv('s3')::jsonb) = pg_temp.delta(pg_temp.cv('s3')::jsonb, pg_temp.cv('s4')::jsonb),
    'draw XP/stats as settle_match';
  assert (select winner_id from public.matches where id = pg_temp.mid('r2d')) is null, 'no winner';
end $$;

-- 4 players, scores (tie for first).
set role authenticated;
select pg_temp.party('r4a', array['alice_x', 'bob', 'carol', 'dave']);
insert into ctx values ('s5', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
select pg_temp.submit('r4a', 'alice_x', 10);
select pg_temp.submit('r4a', 'bob', 30);
select pg_temp.submit('r4a', 'carol', 30);
select pg_temp.submit('r4a', 'dave', 5);
insert into ctx values ('s6', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
select pg_temp.party('r4b', array['alice_x', 'bob', 'carol', 'dave']);
select pg_temp.submit('r4b', 'alice_x', 1000);
set role anon;
select pg_temp.report('sec_party', 'r4b', jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":10,"bob":30,"carol":30,"dave":5}')))->>'status';
insert into ctx values ('s7', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
do $$
declare a jsonb := pg_temp.placements(pg_temp.mid('r4a')); b jsonb := pg_temp.placements(pg_temp.mid('r4b'));
begin
  assert a = '{"alice_x":[3,"loss",15,"submitted"],"bob":[1,"draw",30,"submitted"],"carol":[1,"draw",30,"submitted"],"dave":[4,"loss",8,"submitted"]}'::jsonb, a::text;
  assert (select jsonb_object_agg(k, jsonb_path_query_array(a->k, '$[0 to 2]')) from jsonb_object_keys(a) k)
       = (select jsonb_object_agg(k, jsonb_path_query_array(b->k, '$[0 to 2]')) from jsonb_object_keys(b) k), 'same placements';
  assert pg_temp.delta(pg_temp.cv('s5')::jsonb, pg_temp.cv('s6')::jsonb) = pg_temp.delta(pg_temp.cv('s6')::jsonb, pg_temp.cv('s7')::jsonb),
    '4p XP/stats as settle_match';
end $$;

-- 4 players, ranks (normalised to competition ranking: 1, 3, 3, 7 -> 1, 2, 2, 4).
set role authenticated;
select pg_temp.party('r4c', array['alice_x', 'bob', 'carol', 'dave']);
select pg_temp.submit('r4c', 'alice_x', 40);
select pg_temp.submit('r4c', 'bob', 20);
select pg_temp.submit('r4c', 'carol', 20);
select pg_temp.submit('r4c', 'dave', 1);
insert into ctx values ('s8', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
select pg_temp.party('r4d', array['alice_x', 'bob', 'carol', 'dave']);
select pg_temp.submit('r4d', 'dave', 999);
set role anon;
select pg_temp.report('sec_party', 'r4d', jsonb_build_object('ranks', pg_temp.by_uid('{"alice_x":1,"bob":3,"carol":3,"dave":7}')))->>'status';
insert into ctx values ('s9', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
do $$
declare a jsonb := pg_temp.placements(pg_temp.mid('r4c')); b jsonb := pg_temp.placements(pg_temp.mid('r4d'));
begin
  assert a = '{"alice_x":[1,"win",30,"submitted"],"bob":[2,"loss",23,"submitted"],"carol":[2,"loss",23,"submitted"],"dave":[4,"loss",8,"submitted"]}'::jsonb, a::text;
  assert (select jsonb_object_agg(k, jsonb_path_query_array(a->k, '$[0 to 2]')) from jsonb_object_keys(a) k)
       = (select jsonb_object_agg(k, jsonb_path_query_array(b->k, '$[0 to 2]')) from jsonb_object_keys(b) k), b::text;
  assert (select winner_id from public.matches where id = pg_temp.mid('r4d')) = pg_temp.uid('alice_x'), 'winner from ranks';
end $$;
do $$
begin
  -- s7 -> s8 is twin r4c (settle_match), s8 -> s9 is r4d (report)
  assert pg_temp.delta(pg_temp.cv('s7')::jsonb, pg_temp.cv('s8')::jsonb) = pg_temp.delta(pg_temp.cv('s8')::jsonb, pg_temp.cv('s9')::jsonb),
    '4p ranks XP/stats as settle_match';
end $$;

-- 4 players, scores + a leaver (placed last) vs. the same match where dave forfeits.
set role authenticated;
select pg_temp.party('r4e', array['alice_x', 'bob', 'carol', 'dave']);
select pg_temp.submit('r4e', 'alice_x', 5);
select pg_temp.submit('r4e', 'bob', 6);
select pg_temp.submit('r4e', 'carol', 7);
select pg_temp.login('dave');
select public.forfeit_match(pg_temp.mid('r4e'));
insert into ctx values ('s10', pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])::text);
select pg_temp.party('r4f', array['alice_x', 'bob', 'carol', 'dave']);
set role anon;
select pg_temp.report('sec_party', 'r4f', jsonb_build_object('scores', pg_temp.by_uid('{"alice_x":5,"bob":6,"carol":7}'),
                                                             'leavers', jsonb_build_array(pg_temp.uid('dave'))))->>'status';
do $$
declare a jsonb := pg_temp.placements(pg_temp.mid('r4e')); b jsonb := pg_temp.placements(pg_temp.mid('r4f'));
begin
  assert a->'dave' = '[4,"loss",8,"left"]'::jsonb and a->'carol' = '[1,"win",30,"submitted"]'::jsonb
     and a->'bob' = '[2,"loss",23,"submitted"]'::jsonb and a->'alice_x' = '[3,"loss",15,"submitted"]'::jsonb, a::text;
  assert b->'dave' = '[4,"loss",8,"left"]'::jsonb, 'leaver placed last';
  assert (select jsonb_object_agg(k, jsonb_path_query_array(a->k, '$[0 to 2]')) from jsonb_object_keys(a) k)
       = (select jsonb_object_agg(k, jsonb_path_query_array(b->k, '$[0 to 2]')) from jsonb_object_keys(b) k), b::text;
  assert pg_temp.delta(pg_temp.cv('s9')::jsonb, pg_temp.cv('s10')::jsonb)
       = pg_temp.delta(pg_temp.cv('s10')::jsonb, pg_temp.stats('ref-party', array['alice_x', 'bob', 'carol', 'dave'])), 'leaver XP/stats';
end $$;

-- ---------------------------------------------------------------- Test pings + the deliveries log
set role authenticated;
select pg_temp.login('bob');
select public.send_test_webhook('ref-duel');
do $$
declare l jsonb := public.list_webhook_deliveries('ref-duel', 3);
begin
  assert jsonb_array_length(l) = 3, 'limit';
  assert l->0->>'event' = 'ping' and l->0->'matchId' = 'null'::jsonb and (l->0->>'attempts')::int = 0
     and l->0->'deliveredAt' = 'null'::jsonb and l->0->'lastStatus' = 'null'::jsonb, l->0;
  assert l->0 ?& array['id', 'event', 'matchId', 'createdAt', 'attempts', 'deliveredAt', 'lastStatus', 'lastError'], 'shape';
  assert (l->0->>'createdAt')::timestamptz >= (l->1->>'createdAt')::timestamptz, 'newest first';
  assert jsonb_array_length(public.list_webhook_deliveries('ref-duel')) = 16, 'default limit covers them all: sa 9 + st 6 + ping';
end $$;
reset role;
do $$
declare d public.webhook_deliveries;
begin
  select * into d from public.webhook_deliveries where event = 'ping';
  assert d.payload - 'createdAt' = jsonb_build_object('id', d.id, 'type', 'ping', 'app', '{"slug":"ref-duel"}'::jsonb, 'match', null), d.payload::text;
  assert d.match_id is null and d.app_slug = 'ref-duel', 'ping row';
end $$;

-- ---------------------------------------------------------------- deliver_webhooks: signed requests via pg_net
set role authenticated;
select pg_temp.expect('select public.deliver_webhooks()', '42501');
set role anon;
select pg_temp.expect('select public.deliver_webhooks()', '42501');
reset role;
insert into ctx values ('due', (select count(*)::text from public.webhook_deliveries
                                 where delivered_at is null and request_id is null and next_attempt_at <= now()));
grant select on ctx to service_role;
set role service_role;
do $$
begin
  assert pg_temp.cv('due')::int between 20 and 100, pg_temp.cv('due');
  assert public.deliver_webhooks() = pg_temp.cv('due')::int, 'sent every due delivery';
end $$;
reset role;
do $$
declare
  q record;
  v_secret text;
  v_t text;
  v_n integer := 0;
begin
  for q in select r.*, convert_from(r.body, 'UTF8') as b from net.http_request_queue r loop
    v_secret := case q.url when 'https://duel.example.com/webhooks' then pg_temp.cv('wh_duel')
                           when 'https://party.example.com/webhooks' then pg_temp.cv('wh_party') end;
    assert v_secret is not null, q.url;
    assert q.method = 'POST' and q.timeout_milliseconds = 5000, 'post';
    assert q.headers->>'Content-Type' = 'application/json', 'content type';
    assert q.headers->>'X-XApps-Event' = q.b::jsonb->>'type', 'event header';
    assert q.headers->>'X-XApps-Delivery' = q.b::jsonb->>'id', 'delivery header';
    assert q.headers->>'X-XApps-Signature' ~ '^t=[0-9]+,v1=[0-9a-f]{64}$', q.headers->>'X-XApps-Signature';
    v_t := substring(q.headers->>'X-XApps-Signature' from '^t=([0-9]+),');
    assert abs(v_t::bigint - extract(epoch from now())) < 120, 'fresh timestamp';
    assert substring(q.headers->>'X-XApps-Signature' from 'v1=([0-9a-f]{64})$')
         = encode(extensions.hmac(v_t || '.' || q.b, v_secret, 'sha256'), 'hex'), 'signature verifies';
    assert substring(q.headers->>'X-XApps-Signature' from 'v1=([0-9a-f]{64})$')
        <> encode(extensions.hmac(v_t || '.' || q.b || ' ', v_secret, 'sha256'), 'hex'), 'tampered body fails';
    assert q.b = (select payload::text from public.webhook_deliveries where id = (q.b::jsonb->>'id')::uuid), 'body is the payload';
    v_n := v_n + 1;
  end loop;
  assert v_n = pg_temp.cv('due')::int, 'one request per delivery';
  assert not exists (select 1 from public.webhook_deliveries where delivered_at is null and request_id is null and next_attempt_at is not null),
    'everything in flight';
  assert (select bool_and(attempts = 1 and sent_at is not null and next_attempt_at between now() + interval '50 seconds' and now() + interval '70 seconds')
            from public.webhook_deliveries), 'attempt 1, retry in a minute if it fails';
end $$;

-- Reconcile: most answer 200, the ping 500, sa's match.ended times out, sa's match.created never answers.
insert into ctx values ('d500', (select id::text from public.webhook_deliveries where event = 'ping'));
insert into ctx values ('dto', (select id::text from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.ended'));
insert into ctx values ('dnr', (select id::text from public.webhook_deliveries where match_id = pg_temp.mid('sa') and event = 'match.created'));
insert into net._http_response (id, status_code, content_type, content, timed_out)
select request_id, case when id::text = pg_temp.cv('d500') then 500 else 200 end, 'text/plain', 'ok', false
  from public.webhook_deliveries where id::text not in (pg_temp.cv('dto'), pg_temp.cv('dnr'));
insert into net._http_response (id, status_code, timed_out, error_msg)
select request_id, null, true, 'Timeout of 5000 ms reached' from public.webhook_deliveries where id::text = pg_temp.cv('dto');
do $$
declare d public.webhook_deliveries;
begin
  assert public.deliver_webhooks() = 0, 'failed deliveries wait for their backoff';
  assert (select count(*) from public.webhook_deliveries where delivered_at is not null) = pg_temp.cv('due')::int - 3, '2xx delivered';
  assert (select bool_and(last_status = 200 and next_attempt_at is null and last_error is null)
            from public.webhook_deliveries where delivered_at is not null), 'delivered rows';
  select * into d from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
  assert d.delivered_at is null and d.request_id is null and d.last_status = 500 and d.last_error = 'HTTP 500' and d.attempts = 1, 'failed';
  assert d.next_attempt_at between now() + interval '50 seconds' and now() + interval '70 seconds', 'retry after 1 minute';
  select * into d from public.webhook_deliveries where id = pg_temp.cv('dto')::uuid;
  assert d.request_id is null and d.last_status is null and d.last_error = 'Timeout of 5000 ms reached', 'timed out';
  select * into d from public.webhook_deliveries where id = pg_temp.cv('dnr')::uuid;
  assert d.request_id is not null and d.last_error is null, 'no response yet: still in flight';
end $$;
-- No response within 10 minutes counts as a failure.
update public.webhook_deliveries set sent_at = now() - interval '11 minutes' where id = pg_temp.cv('dnr')::uuid;
do $$
begin
  perform public.deliver_webhooks();
  assert (select request_id is null and last_error = 'No response' and delivered_at is null
            from public.webhook_deliveries where id = pg_temp.cv('dnr')::uuid), 'lost request failed';
end $$;
-- Backoff: attempt 2 is retried after 2 minutes.
update public.webhook_deliveries set next_attempt_at = now() - interval '1 second' where id = pg_temp.cv('d500')::uuid;
do $$
declare d public.webhook_deliveries;
begin
  assert public.deliver_webhooks() = 1, 'retried';
  select * into d from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
  assert d.attempts = 2 and d.request_id is not null and d.last_status = 500, 'attempt 2 in flight';
  assert d.next_attempt_at between now() + interval '110 seconds' and now() + interval '130 seconds', 'backoff 2 min';
  assert (select headers->>'X-XApps-Delivery' from net.http_request_queue where id = d.request_id) = d.id::text, 'same delivery id on retry';
end $$;
insert into net._http_response (id, status_code) select request_id, 502 from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
do $$
declare d public.webhook_deliveries;
begin
  perform public.deliver_webhooks();
  select * into d from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
  assert d.request_id is null and d.last_status = 502 and d.next_attempt_at > now() + interval '1 minute', 'waits out the backoff';
end $$;
-- The 9th failed attempt gives up.
update public.webhook_deliveries set attempts = 7, next_attempt_at = now() - interval '1 second' where id = pg_temp.cv('d500')::uuid;
do $$
begin
  assert public.deliver_webhooks() = 1;
  assert (select attempts = 8 and next_attempt_at between now() + interval '127 minutes' and now() + interval '129 minutes'
            from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid), 'attempt 8 backs off 128 min';
end $$;
insert into net._http_response (id, status_code) select request_id, 500 from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
update public.webhook_deliveries set next_attempt_at = now() - interval '1 second' where id = pg_temp.cv('d500')::uuid;
do $$
begin
  assert public.deliver_webhooks() = 1, 'reconciled and, being due, resent in the same run (attempt 9)';
  assert (select attempts = 9 and request_id is not null and last_status = 500
            from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid), 'attempt 9 in flight';
end $$;
insert into net._http_response (id, status_code) select request_id, 503 from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
insert into ctx values ('requests', (select count(*)::text from net.http_request_queue));
do $$
declare d public.webhook_deliveries;
begin
  perform public.deliver_webhooks();
  select * into d from public.webhook_deliveries where id = pg_temp.cv('d500')::uuid;
  assert d.attempts = 9 and d.last_status = 503 and d.delivered_at is null and d.request_id is null and d.next_attempt_at is null, 'given up';
  perform public.deliver_webhooks();
  assert (select count(*) from net.http_request_queue) = pg_temp.cv('requests')::int, 'never sent again';
end $$;
set role authenticated;
select pg_temp.login('bob');
do $$
declare l jsonb := (select e from jsonb_array_elements(public.list_webhook_deliveries('ref-duel')) e where e->>'id' = pg_temp.cv('d500'));
begin
  assert (l->>'attempts')::int = 9 and (l->>'lastStatus')::int = 503 and l->>'lastError' = 'HTTP 503' and l->'deliveredAt' = 'null'::jsonb, l::text;
  assert (select count(*) from jsonb_array_elements(public.list_webhook_deliveries('ref-duel')) e where e->'deliveredAt' <> 'null'::jsonb) = 13, 'delivered: all but the three failures';
end $$;

-- A state change after the pending one was sent queues a new one.
set role authenticated;
select pg_temp.party('wh', array['alice_x', 'bob']);
select public.update_match_state(pg_temp.mid('wh'), '{"n":1}', 0);
reset role;
select public.deliver_webhooks();
set role authenticated;
select pg_temp.login('alice_x');
select public.update_match_state(pg_temp.mid('wh'), '{"n":2}', 1);
select public.update_match_state(pg_temp.mid('wh'), '{"n":3}', 2);
reset role;
do $$
begin
  assert (select count(*) from public.webhook_deliveries where match_id = pg_temp.mid('wh') and event = 'match.state') = 2,
    'one in flight + one pending';
  assert (select (payload->'match'->>'stateVersion')::int from public.webhook_deliveries
           where match_id = pg_temp.mid('wh') and event = 'match.state' and request_id is null) = 3, 'pending one has the latest';
end $$;

-- Removing the webhook stops deliveries and new events.
set role authenticated;
select pg_temp.login('bob');
select public.send_test_webhook('ref-party');
select public.set_app_webhook('ref-party', null);
reset role;
do $$
begin
  assert (select next_attempt_at is null and last_error = 'Webhook removed' from public.webhook_deliveries
           where app_slug = 'ref-party' and event = 'ping'), 'pending deliveries dropped';
end $$;
set role authenticated;
select pg_temp.party('nowh', array['alice_x', 'bob']);
reset role;
do $$
begin
  assert not exists (select 1 from public.webhook_deliveries where match_id = pg_temp.mid('nowh')), 'no URL, no events';
  assert not exists (select 1 from public.webhook_deliveries where app_slug not in ('ref-duel', 'ref-party')), 'only apps with webhooks';
end $$;

-- Internal stage 2 helpers are not callable by clients
set role authenticated;
select pg_temp.expect(format('select public.settle_server_timeout(%L)', pg_temp.mid('nowh')), '42501');
select pg_temp.expect(format('select public.award_placements(%L)', pg_temp.mid('nowh')), '42501');
select pg_temp.expect(format('select public.place_players(%L, %L)', pg_temp.mid('nowh'), 'high'), '42501');
select pg_temp.expect($q$select public.enqueue_webhook('ref-duel', 'ping', null)$q$, '42501');
select pg_temp.expect($q$select public.app_for_secret('xas_x')$q$, '42501');
select pg_temp.expect(format('select public.app_api_match(%L, %L)', pg_temp.cv('sec_duel'), pg_temp.mid('sa')), '42501');
reset role;

-- Practice matches of server-authoritative apps settle on the client
update public.apps set authority = 'server' where slug = 'ref-duel';
set role authenticated;
select pg_temp.login('alice_x');
insert into ctx values ('ref-practice', (select public.start_practice('ref-duel')::text));
reset role;
do $$
begin
  assert (select authority from public.matches where id = pg_temp.mid('ref-practice')) = 'client', 'practice is client-authoritative';
  assert (select authority from public.matches where id = pg_temp.mid('sa')) = 'server', 'real matches keep server authority';
end $$;

-- ================================================================ v2 stage 3: media & data
reset role;

-- An object path in the app-media bucket: <app>/<uid of handle>/<file>.
create function pg_temp.mpath(p_app text, p_handle text, p_file text) returns text language sql as $$
  select p_app || '/' || pg_temp.uid(p_handle)::text || '/' || p_file;
$$;
-- Inserts an app-media object as the signed-in user (goes through the insert policy).
create function pg_temp.upload(p_app text, p_handle text, p_file text, p_meta jsonb) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata) values ('app-media', pg_temp.mpath(p_app, p_handle, p_file), p_meta);
$$;
-- Owner edit of stat-game's manifest data that must fail with 22023.
create function pg_temp.bad_manifest(p_stats jsonb, p_achievements jsonb, p_like text) returns void language sql as $$
  select pg_temp.expect(format('update public.apps set stats = %L, achievements = %L where slug = %L',
                               p_stats, p_achievements, 'stat-game'), '22023', p_like);
$$;
create function pg_temp.xp(p_handle text) returns integer language sql as $$
  select xp from public.profiles where handle = p_handle;
$$;

do $$
begin
  assert (select public and file_size_limit = 26214400 and allowed_mime_types = array[
            'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
            'audio/webm', 'audio/wav', 'video/mp4', 'video/webm', 'video/quicktime']
            from storage.buckets where id = 'app-media'), 'app-media bucket';
  assert (select bool_and(stats = '[]'::jsonb and achievements = '[]'::jsonb) from public.apps), 'existing apps declare nothing';
  assert not exists (select 1 from public.app_storage where scope <> 'user' or user_id is null), 'v1 storage rows are user scope';
end $$;

-- ---------------------------------------------------------------- Manifest: owners register stats + achievements
set role authenticated;
select pg_temp.login('bob');
insert into public.apps (slug, name, category, url, stats, achievements) values
  ('stat-game', 'Stat Game', 'games', 'https://stat-game.example.com/play',
   '[{"key":"best","label":"Best score","aggregate":"max"},
     {"key":"fastest","label":"Fastest","aggregate":"min","format":"ms"},
     {"key":"total","label":"Total","aggregate":"sum","format":"number"},
     {"key":"level","label":"Level","aggregate":"last","format":null}]',
   '[{"id":"first_win","name":"First win","description":"Win once","icon":"🏆","xp":50},
     {"id":"secret_move","name":"???","description":"","icon":"🤫","xp":100,"secret":true},
     {"id":"zero","name":"Zero","icon":"🥚","xp":0,"secret":false}]');
update public.apps set stats = stats || '[{"key":"streak","label":"Streak","aggregate":"max","format":"percent"}]'
 where slug = 'stat-game';
update public.apps set stats = null, achievements = null where slug = 'stat-game';
do $$
begin
  assert (select stats = '[]'::jsonb and achievements = '[]'::jsonb from public.apps where slug = 'stat-game'), 'null means none';
end $$;
update public.apps set
  stats = '[{"key":"best","label":"Best score","aggregate":"max"},
            {"key":"fastest","label":"Fastest","aggregate":"min","format":"ms"},
            {"key":"total","label":"Total","aggregate":"sum","format":"number"},
            {"key":"level","label":"Level","aggregate":"last","format":null},
            {"key":"streak","label":"Streak","aggregate":"max","format":"percent"}]',
  achievements = '[{"id":"first_win","name":"First win","description":"Win once","icon":"🏆","xp":50},
                   {"id":"secret_move","name":"???","description":"","icon":"🤫","xp":100,"secret":true},
                   {"id":"zero","name":"Zero","icon":"🥚","xp":0,"secret":false}]'
 where slug = 'stat-game';
do $$
begin
  assert (select status = 'pending' and developer_id = pg_temp.uid('bob') and jsonb_array_length(stats) = 5
                 and jsonb_array_length(achievements) = 3 from public.apps where slug = 'stat-game'), 'owner set both';
end $$;

-- Validation (readable 22023 from the trigger; check constraints back it up)
select pg_temp.bad_manifest('{}', '[]', 'Stats must be a list');
select pg_temp.bad_manifest((select jsonb_agg(jsonb_build_object('key', 's' || i, 'label', 'S', 'aggregate', 'max'))
                               from generate_series(1, 9) i), '[]', 'At most 8 stats');
select pg_temp.bad_manifest('[1]', '[]', '%must be an object');
select pg_temp.bad_manifest('[{"key":"Best","label":"B","aggregate":"max"}]', '[]', '%key must be%');
select pg_temp.bad_manifest('[{"key":"1best","label":"B","aggregate":"max"}]', '[]', '%key must be%');
select pg_temp.bad_manifest(jsonb_build_array(jsonb_build_object('key', repeat('a', 33), 'label', 'B', 'aggregate', 'max')), '[]', '%key must be%');
select pg_temp.bad_manifest('[{"key":"best-score","label":"B","aggregate":"max"}]', '[]', '%key must be%');
select pg_temp.bad_manifest('[{"label":"B","aggregate":"max"}]', '[]', '%key must be%');
select pg_temp.bad_manifest('[{"key":"a","label":"A","aggregate":"max"},{"key":"a","label":"B","aggregate":"min"}]', '[]', 'Duplicate stat key a');
select pg_temp.bad_manifest('[{"key":"a","label":"","aggregate":"max"}]', '[]', '%label%');
select pg_temp.bad_manifest('[{"key":"a","label":"   ","aggregate":"max"}]', '[]', '%label%');
select pg_temp.bad_manifest(jsonb_build_array(jsonb_build_object('key', 'a', 'label', repeat('l', 41), 'aggregate', 'max')), '[]', '%label%');
select pg_temp.bad_manifest('[{"key":"a","label":"A"}]', '[]', '%aggregate%');
select pg_temp.bad_manifest('[{"key":"a","label":"A","aggregate":"avg"}]', '[]', '%aggregate%');
select pg_temp.bad_manifest('[{"key":"a","label":"A","aggregate":"max","format":"seconds"}]', '[]', '%format%');
select pg_temp.bad_manifest('[{"key":"a","label":"A","aggregate":"max","format":1}]', '[]', '%format%');
select pg_temp.bad_manifest('[]', '"x"', 'Achievements must be a list');
select pg_temp.bad_manifest('[]', (select jsonb_agg(jsonb_build_object('id', 'a' || i, 'name', 'A', 'icon', '⭐', 'xp', 1))
                                     from generate_series(1, 31) i), 'At most 30 achievements');
select pg_temp.bad_manifest('[]', '[{"id":"A1","name":"A","icon":"⭐","xp":1}]', '%id must be%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":1},{"id":"a","name":"B","icon":"⭐","xp":1}]', 'Duplicate achievement id a');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"","icon":"⭐","xp":1}]', '%name%');
select pg_temp.bad_manifest('[]', jsonb_build_array(jsonb_build_object('id', 'a', 'name', repeat('n', 41), 'icon', '⭐', 'xp', 1)), '%name%');
select pg_temp.bad_manifest('[]', jsonb_build_array(jsonb_build_object('id', 'a', 'name', 'A', 'description', repeat('d', 141), 'icon', '⭐', 'xp', 1)), '%description%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","description":7,"icon":"⭐","xp":1}]', '%description%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"","xp":1}]', '%icon%');
select pg_temp.bad_manifest('[]', jsonb_build_array(jsonb_build_object('id', 'a', 'name', 'A', 'icon', repeat('⭐', 17), 'xp', 1)), '%icon%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐"}]', '%xp%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":101}]', '%xp%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":-1}]', '%xp%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":1.5}]', '%xp%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":"10"}]', '%xp%');
select pg_temp.bad_manifest('[]', '[{"id":"a","name":"A","icon":"⭐","xp":1,"secret":"yes"}]', '%secret%');
select pg_temp.bad_manifest('[]', (select jsonb_agg(jsonb_build_object('id', 'a' || i, 'name', 'A', 'icon', '⭐', 'xp', 100))
                                     from generate_series(1, 6) i), '%500 XP%');
do $$
begin
  -- The limits themselves are fine: 8 stats, 30 achievements, 500 XP.
  assert public.app_stats_error((select jsonb_agg(jsonb_build_object('key', 's' || i, 'label', repeat('l', 40), 'aggregate', 'sum'))
                                   from generate_series(1, 8) i)) is null, '8 stats';
  assert public.app_achievements_error((select jsonb_agg(jsonb_build_object('id', 'a' || i, 'name', repeat('n', 40),
                                          'description', repeat('d', 140), 'icon', '⭐', 'xp', case when i <= 5 then 100 else 0 end))
                                        from generate_series(1, 30) i)) is null, '30 achievements, 500 XP';
  assert (select jsonb_array_length(stats) from public.apps where slug = 'stat-game') = 5, 'failed edits changed nothing';
end $$;
reset role;
-- The check constraints hold even without the trigger.
alter table public.apps disable trigger apps_validate_manifest_data;
select pg_temp.expect($q$update public.apps set stats = '[{"key":"x"}]' where slug = 'stat-game'$q$, '23514');
select pg_temp.expect($q$update public.apps set achievements = '[{"id":"x"}]' where slug = 'stat-game'$q$, '23514');
alter table public.apps enable trigger apps_validate_manifest_data;

-- A server-authoritative app (carol) with its own stats/achievements.
set role authenticated;
select pg_temp.login('carol');
insert into public.apps (slug, name, category, url, stats, achievements) values
  ('stat-server', 'Stat Server', 'games', 'https://stat-server.example.com/play',
   '[{"key":"wins","label":"Wins","aggregate":"sum"}]',
   '[{"id":"boss","name":"Boss","description":"Beat the boss","icon":"👑","xp":100}]');
insert into ctx values ('sec_srv', public.rotate_app_secret('stat-server'));
select public.set_app_authority('stat-server', 'server');
select pg_temp.login('bob');
insert into ctx values ('sec_stat', public.rotate_app_secret('stat-game'));
reset role;
update public.apps set status = 'published' where slug in ('stat-game', 'stat-server');

-- ---------------------------------------------------------------- Storage: user scope
set role authenticated;
select pg_temp.login('alice_x');
select public.storage_set('stat-game', 'save', '{"level":1}');
select public.storage_set('stat-game', 'save', '{"level":2}');
select public.storage_set('stat-game', 'daily/2026-09-29', '"mine"');
select public.storage_set('stat-game', 'daily/2026-09-30', '[1,2]');
select public.storage_set('stat-game', 'daily_x', 'null');
do $$
begin
  assert public.storage_get('stat-game', 'save') = '{"level":2}'::jsonb, 'overwritten';
  assert public.storage_get('stat-game', 'save', 'user') = '{"level":2}'::jsonb, 'explicit user scope';
  assert public.storage_get('stat-game', 'daily_x') = 'null'::jsonb, 'json null is a value';
  assert public.storage_get('stat-game', 'nope') is null, 'unset key';
  assert public.storage_list('stat-game') = array['daily/2026-09-29', 'daily/2026-09-30', 'daily_x', 'save'], 'sorted keys';
  assert public.storage_list('stat-game', 'daily/') = array['daily/2026-09-29', 'daily/2026-09-30'], 'prefix (no LIKE wildcards)';
  assert public.storage_list('stat-game', 'zzz') = '{}'::text[], 'no match';
  assert public.storage_list('stat-game', null, 'app') = '{}'::text[], 'user keys are not app keys';
  assert public.storage_get('stat-game', 'save', 'app') is null, 'scopes are separate';
  assert public.storage_delete('stat-game', 'daily_x'), 'deleted';
  assert not public.storage_delete('stat-game', 'daily_x'), 'already gone';
  assert public.storage_get('stat-game', 'daily_x') is null, 'gone';
  -- 64 KB values (jsonb text size)
  perform public.storage_set('stat-game', 'big', jsonb_build_object('s', repeat('x', 65520)));
  assert octet_length(public.storage_get('stat-game', 'big')::text) = 65529, '64 KB fits';
end $$;
select pg_temp.expect($q$select public.storage_set('stat-game', 'big', jsonb_build_object('s', repeat('x', 65600)))$q$, '22023', '%64 KB%');
select pg_temp.expect($q$select public.storage_set('stat-game', '', '1')$q$, '22023');
select pg_temp.expect(format('select public.storage_set(%L, %L, %L)', 'stat-game', repeat('k', 65), '1'), '22023');
select pg_temp.expect($q$select public.storage_set('stat-game', null, '1')$q$, '22023');
select pg_temp.expect($q$select public.storage_set('stat-game', 'k', null)$q$, '22023', '%delete%');
select pg_temp.expect($q$select public.storage_get('stat-game', 'save', 'global')$q$, '22023');
select pg_temp.expect($q$select public.storage_list('stat-game', null, null)$q$, '22023');
select pg_temp.expect($q$select public.storage_set('no-such-app', 'k', '1')$q$, 'P0002');
-- Pending apps are only visible to their developer (my-game belongs to alice).
select public.storage_set('my-game', 'k', '1');
select pg_temp.login('carol');
select pg_temp.expect($q$select public.storage_get('my-game', 'k')$q$, 'P0002');
select pg_temp.expect($q$select public.storage_set('my-game', 'k', '1')$q$, 'P0002');
do $$
begin
  assert public.storage_get('stat-game', 'save') is null, 'user scope is private';
  assert public.storage_list('stat-game') = '{}'::text[], 'carol has no keys';
  assert not public.storage_delete('stat-game', 'save'), 'can''t delete alice''s key';
end $$;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect($q$select public.storage_get('stat-game', 'save')$q$, '28000');
select pg_temp.expect($q$select public.storage_set('stat-game', 'save', '1')$q$, '28000');
set role anon;
select pg_temp.expect($q$select public.storage_get('stat-game', 'save')$q$, '28000');
select pg_temp.expect($q$select public.storage_list('stat-game')$q$, '28000');
select pg_temp.expect($q$select public.storage_set('stat-game', 'save', '1')$q$, '42501');
select pg_temp.expect($q$select public.storage_delete('stat-game', 'save')$q$, '42501');

-- 200 keys per user per app (overwrites still work when full)
set role authenticated;
select pg_temp.login('dave');
do $$
begin
  for i in 1..200 loop
    perform public.storage_set('quick-draw', 'k' || lpad(i::text, 3, '0'), to_jsonb(i));
  end loop;
  perform public.storage_set('quick-draw', 'k001', '"again"');
  assert cardinality(public.storage_list('quick-draw')) = 200, '200 keys';
end $$;
select pg_temp.expect($q$select public.storage_set('quick-draw', 'k201', '1')$q$, '54000', '%200 keys%');
select public.storage_set('four-in-a-row', 'k201', '1');

-- v1 clients write the table directly (PostgREST upsert on the primary key)
select pg_temp.login('alice_x');
insert into public.app_storage (app_slug, user_id, key, value, updated_at)
values ('stat-game', pg_temp.uid('alice_x'), 'v1', '{"n":1}', now())
on conflict (id) do update set value = excluded.value, updated_at = excluded.updated_at;
insert into public.app_storage (app_slug, user_id, key, value, updated_at)
values ('stat-game', pg_temp.uid('alice_x'), 'v1', '{"n":2}', now())
on conflict (id) do update set value = excluded.value, updated_at = excluded.updated_at;
do $$
begin
  assert (select value from public.app_storage where app_slug = 'stat-game' and user_id = auth.uid() and key = 'v1') = '{"n":2}'::jsonb,
    'v1 read path sees the upserted value';
  assert (select count(*) from public.app_storage where app_slug = 'stat-game' and key = 'v1') = 1, 'one row';
  assert public.storage_get('stat-game', 'v1') = '{"n":2}'::jsonb, 'same row through the RPC';
end $$;
select pg_temp.expect(format('insert into public.app_storage (app_slug, user_id, key, value) values (%L, %L, %L, %L)',
                             'stat-game', pg_temp.uid('bob'), 'x', '1'), '42501');
select pg_temp.expect($q$insert into public.app_storage (app_slug, scope, user_id, key, value) values ('stat-game', 'app', null, 'x', '1')$q$, '42501');
select pg_temp.expect(format('insert into public.app_storage (app_slug, user_id, key, value) values (%L, %L, %L, %L)',
                             'stat-game', pg_temp.uid('alice_x'), 'huge', jsonb_build_object('s', repeat('x', 70000))), '23514');
select pg_temp.expect(format('update public.app_storage set scope = %L, user_id = null where user_id = %L', 'app', pg_temp.uid('alice_x')), '42501');
select pg_temp.login('dave');
select pg_temp.expect(format('insert into public.app_storage (app_slug, user_id, key, value) values (%L, %L, %L, %L)',
                             'quick-draw', pg_temp.uid('dave'), 'k999', '1'), '54000');
insert into public.app_storage (app_slug, user_id, key, value) values ('quick-draw', pg_temp.uid('dave'), 'k002', '"direct"');
do $$
begin
  assert public.storage_get('quick-draw', 'k002') = '"direct"'::jsonb, 'direct overwrite when full';
end $$;

-- ---------------------------------------------------------------- Storage: app scope (server writes, anyone reads)
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.app_api_storage_set(pg_temp.cv('sec_stat'), 'daily/2026-09-29', '{"puzzle":42}');
select public.app_api_storage_set(pg_temp.cv('sec_stat'), 'daily/2026-09-29', '{"puzzle":43}');
select public.app_api_storage_set(pg_temp.cv('sec_stat'), 'config', '{"season":3}');
select public.app_api_storage_set(pg_temp.cv('sec_stat'), 'tmp', '1');
do $$
begin
  assert public.storage_get('stat-game', 'daily/2026-09-29', 'app') = '{"puzzle":43}'::jsonb, 'anon reads the app scope';
  assert public.storage_list('stat-game', null, 'app') = array['config', 'daily/2026-09-29', 'tmp'], 'app keys';
  assert public.storage_list('stat-game', 'daily/', 'app') = array['daily/2026-09-29'], 'app prefix';
  assert public.app_api_storage_get(pg_temp.cv('sec_stat'), 'config') = '{"season":3}'::jsonb, 'server reads';
  assert public.app_api_storage_get(pg_temp.cv('sec_stat'), 'nope') is null, 'server reads unset';
  assert public.app_api_storage_list(pg_temp.cv('sec_stat')) = array['config', 'daily/2026-09-29', 'tmp'], 'server lists';
  assert public.app_api_storage_list(pg_temp.cv('sec_stat'), 'co') = array['config'], 'server prefix';
  assert public.app_api_storage_delete(pg_temp.cv('sec_stat'), 'tmp'), 'server deletes';
  assert not public.app_api_storage_delete(pg_temp.cv('sec_stat'), 'tmp'), 'already gone';
  assert public.app_api_storage_list(pg_temp.cv('sec_srv')) = '{}'::text[], 'other app''s space is separate';
end $$;
select pg_temp.expect($q$select public.app_api_storage_set('xas_nope', 'k', '1')$q$, '28000', 'invalid_secret');
select pg_temp.expect($q$select public.app_api_storage_delete(null, 'k')$q$, '28000', 'invalid_secret');
select pg_temp.expect($q$select public.app_api_storage_get('nope', 'k')$q$, '28000');
select pg_temp.expect($q$select public.app_api_storage_list('nope')$q$, '28000');
select pg_temp.expect(format('select public.app_api_storage_set(%L, %L, %L)', pg_temp.cv('sec_stat'), '', '1'), '22023');
select pg_temp.expect(format('select public.app_api_storage_set(%L, %L, %L)', pg_temp.cv('sec_stat'), 'big',
                             jsonb_build_object('s', repeat('x', 65600))), '22023');
-- Pending apps' app scope isn't public.
select pg_temp.expect($q$select public.storage_get('my-game', 'k', 'app')$q$, 'P0002');
set role authenticated;
select pg_temp.login('alice_x');
do $$
begin
  assert public.storage_get('stat-game', 'daily/2026-09-29') = '"mine"'::jsonb, 'user scope unaffected by the app key';
  assert public.storage_get('stat-game', 'daily/2026-09-29', 'app') = '{"puzzle":43}'::jsonb, 'players read the app scope';
  assert (select count(*) from public.app_storage where scope = 'app' and app_slug = 'stat-game') = 2, 'app rows readable directly';
end $$;
reset role;
do $$
begin
  assert (select user_id is null from public.app_storage where scope = 'app' and key = 'config'), 'app rows have no user';
  for i in 1..198 loop
    perform public.storage_write('stat-game', null, 'fill' || i, '1');
  end loop;
end $$;
set role anon;
select pg_temp.expect(format('select public.app_api_storage_set(%L, %L, %L)', pg_temp.cv('sec_stat'), 'one-more', '1'), '54000');
select public.app_api_storage_set(pg_temp.cv('sec_stat'), 'config', '{"season":4}');
reset role;
delete from public.app_storage where scope = 'app' and key like 'fill%';

-- ---------------------------------------------------------------- Media: the storage insert policy
set role authenticated;
select pg_temp.login('alice_x');
select pg_temp.upload('stat-game', 'alice_x', 'a.png', '{"size":1000,"mimetype":"image/png"}');
select pg_temp.upload('stat-game', 'alice_x', 'b.png', '{"size":2000,"mimetype":"image/png"}');
select pg_temp.upload('stat-game', 'alice_x', 'c.webm', null);
select pg_temp.upload('stat-game', 'alice_x', 'clip.mp4', '{"size":20971520,"mimetype":"video/mp4"}');
select pg_temp.upload('my-game', 'alice_x', 'own-pending.png', '{"size":10,"mimetype":"image/png"}');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'bob', 'x.png', null)$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'alice_x', 'dir/x.png', null)$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'alice_x', '.hidden', null)$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('no-such-app', 'alice_x', 'x.png', null)$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'alice_x', 'big.png', '{"size":8388609,"mimetype":"image/png"}')$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'alice_x', 'big.wav', '{"size":10485761,"mimetype":"audio/wav"}')$q$, '42501');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'alice_x', 'x.html', '{"size":10,"mimetype":"text/html"}')$q$, '42501');
select pg_temp.expect(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'app-media', 'stat-game/' || pg_temp.uid('alice_x')), '42501');
select pg_temp.login('carol');
select pg_temp.expect($q$select pg_temp.upload('my-game', 'carol', 'x.png', null)$q$, '42501');
-- Only the caller's own quota can be asked about.
do $$
begin
  assert public.media_quota_ok(pg_temp.uid('carol'), 'stat-game'), 'own quota';
  assert not public.media_quota_ok(pg_temp.uid('alice_x'), 'stat-game'), 'not someone else''s';
end $$;
set role anon;
select pg_temp.expect(format('select public.media_quota_ok(%L, %L)', pg_temp.uid('carol'), 'stat-game'), '42501');

-- Quota: 60 uploads per rolling 24 h per user per app (older ones don't count).
reset role;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata, created_at)
select 'app-media', pg_temp.mpath('stat-game', 'alice_x', 'old' || i || '.png'), pg_temp.uid('alice_x'), pg_temp.uid('alice_x')::text,
       '{"size":100000000,"mimetype":"image/png"}', now() - interval '25 hours'
  from generate_series(1, 5) i;
set role authenticated;
select pg_temp.login('alice_x');
do $$
declare n integer := 0;
begin
  loop
    begin
      perform pg_temp.upload('stat-game', 'alice_x', 'q' || n || '.png', '{"size":10,"mimetype":"image/png"}');
      n := n + 1;
    exception when insufficient_privilege then
      exit;
    end;
    exit when n > 100;
  end loop;
  insert into ctx values ('quota_n', n::text);
  -- Other apps have their own quota.
  perform pg_temp.upload('four-in-a-row', 'alice_x', 'q.png', '{"size":10,"mimetype":"image/png"}');
end $$;
reset role;
do $$
begin
  assert pg_temp.cv('quota_n')::int = 56, 'uploads until 60 in 24 h (4 earlier): ' || pg_temp.cv('quota_n');
  assert (select count(*) from storage.objects where name like 'stat-game/' || pg_temp.uid('alice_x') || '/%'
           and created_at > now() - interval '24 hours') = 60, '60 recent';
end $$;

-- Quota: 200 MB per rolling 24 h (8 × 25 MB videos fill it exactly).
set role authenticated;
select pg_temp.login('bob');
do $$
begin
  for i in 1..8 loop
    perform pg_temp.upload('stat-game', 'bob', 'v' || i || '.mp4', '{"size":26214400,"mimetype":"video/mp4"}');
  end loop;
end $$;
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'bob', 'one-byte.png', '{"size":1,"mimetype":"image/png"}')$q$, '42501');
-- Recorded uploads count even when the bucket shows fewer objects.
reset role;
insert into public.media_uploads (app_slug, user_id, path, bytes, mime)
select 'stat-game', pg_temp.uid('dave'), pg_temp.mpath('stat-game', 'dave', 'gone' || i || '.mp4'), 26214400, 'video/mp4'
  from generate_series(1, 8) i;
set role authenticated;
select pg_temp.login('dave');
select pg_temp.expect($q$select pg_temp.upload('stat-game', 'dave', 'one-byte.png', '{"size":1,"mimetype":"image/png"}')$q$, '42501');
select pg_temp.upload('quick-draw', 'dave', 'ok.png', '{"size":1,"mimetype":"image/png"}');

-- ---------------------------------------------------------------- Media: record_media_upload
select pg_temp.login('alice_x');
insert into ctx values ('rec_a', public.record_media_upload('stat-game', pg_temp.mpath('stat-game', 'alice_x', 'a.png'), 1000, 'image/png')::text);
do $$
declare
  r jsonb := pg_temp.cv('rec_a')::jsonb;
  again jsonb := public.record_media_upload('stat-game', pg_temp.mpath('stat-game', 'alice_x', 'a.png'), 1000, 'image/png');
  b jsonb := public.record_media_upload('stat-game', pg_temp.mpath('stat-game', 'alice_x', 'b.png'), 5, 'image/gif');
  c jsonb := public.record_media_upload('stat-game', pg_temp.mpath('stat-game', 'alice_x', 'c.webm'), 2000, 'audio/webm; codecs=opus');
begin
  assert r - 'createdAt' = jsonb_build_object('path', pg_temp.mpath('stat-game', 'alice_x', 'a.png'), 'bytes', 1000, 'mime', 'image/png'), r::text;
  assert r ? 'createdAt', 'createdAt';
  assert again = r, 'idempotent';
  assert (b->>'bytes')::int = 2000 and b->>'mime' = 'image/png', 'stored metadata wins: ' || b::text;
  assert (c->>'bytes')::int = 2000 and c->>'mime' = 'audio/webm', 'claimed size/type when metadata is missing';
  assert (select count(*) from public.media_uploads where user_id = auth.uid()) = 3, 'own uploads readable';
end $$;
-- Claims are checked on objects without metadata; a planted object in alice's folder isn't hers.
reset role;
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'app-media', pg_temp.mpath('stat-game', 'alice_x', f), pg_temp.uid('alice_x'), pg_temp.uid('alice_x')::text
  from unnest(array['n1.bin', 'n2.wav', 'n3.png']) f;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
values ('app-media', pg_temp.mpath('stat-game', 'alice_x', 'planted.png'), pg_temp.uid('carol'), pg_temp.uid('carol')::text,
        '{"size":10,"mimetype":"image/png"}');
set role authenticated;
select pg_temp.login('alice_x');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'n1.bin'), 10, 'application/octet-stream'), '22023', 'Unsupported media type');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'n2.wav'), 10485761, 'audio/wav'), '22023', '%too large%');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'n3.png'), 0, 'image/png'), '22023', '%size%');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'n3.png'), null, 'image/png'), '22023', '%size%');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'missing.png'), 10, 'image/png'), 'P0002');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'alice_x', 'planted.png'), 10, 'image/png'), '42501');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('stat-game', 'bob', 'v1.mp4'), 26214400, 'video/mp4'), '42501');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  pg_temp.mpath('four-in-a-row', 'alice_x', 'q.png'), 10, 'image/png'), '42501');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'stat-game',
  'stat-game/../x.png', 10, 'image/png'), '22023', 'Invalid media path');
select pg_temp.expect(format('select public.record_media_upload(%L, %L, %L, %L)', 'no-such-app',
  pg_temp.mpath('no-such-app', 'alice_x', 'x.png'), 10, 'image/png'), 'P0002');
select public.record_media_upload('stat-game', pg_temp.mpath('stat-game', 'alice_x', 'n3.png'), 300, 'image/png');
select pg_temp.login('bob');
do $$
begin
  assert not exists (select 1 from public.media_uploads where user_id = pg_temp.uid('alice_x')), 'others'' uploads are private';
end $$;
select pg_temp.expect($q$insert into public.media_uploads (app_slug, user_id, path, bytes, mime) values ('stat-game', auth.uid(), 'p', 1, 'image/png')$q$, '42501');
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect($q$select public.record_media_upload('stat-game', 'x', 1, 'image/png')$q$, '28000');
set role anon;
select pg_temp.expect($q$select public.record_media_upload('stat-game', 'x', 1, 'image/png')$q$, '42501');
reset role;
do $$
begin
  assert (select count(*) from public.media_uploads where user_id = pg_temp.uid('alice_x')) = 4, 'a, b, c, n3';
end $$;

-- ---------------------------------------------------------------- Stats: aggregates
set role authenticated;
select pg_temp.login('alice_x');
do $$
declare r jsonb;
begin
  r := public.report_stats('stat-game', '{"best":10,"fastest":900,"total":5,"level":3}');
  assert r = '{"best":10,"fastest":900,"total":5,"level":3}'::jsonb, r::text;
  r := public.report_stats('stat-game', '{"best":7,"fastest":1200,"total":2.5,"level":1}');
  assert r = '{"best":10,"fastest":900,"total":7.5,"level":1}'::jsonb, 'max keeps, min keeps, sum adds, last replaces: ' || r::text;
  r := public.report_stats('stat-game', '{"fastest":850.5}');
  assert r = '{"fastest":850.5}'::jsonb, 'only reported keys come back';
  assert public.report_stats('stat-game', '{}') = '{}'::jsonb, 'nothing reported';
  r := public.report_stats('stat-game', '{"total":-2.5}');
  assert r = '{"total":5}'::jsonb, 'sum accepts negatives';
end $$;
select pg_temp.expect($q$select public.report_stats('stat-game', '{"nope":1}')$q$, '22023', 'Unknown stat nope');
select pg_temp.expect($q$select public.report_stats('stat-game', '{"best":"12"}')$q$, '22023', '%finite number%');
select pg_temp.expect($q$select public.report_stats('stat-game', '{"best":"NaN"}')$q$, '22023');
select pg_temp.expect($q$select public.report_stats('stat-game', '{"best":null}')$q$, '22023');
select pg_temp.expect($q$select public.report_stats('stat-game', '{"best":1e400}')$q$, '22023', '%out of range%');
select pg_temp.expect($q$select public.report_stats('stat-game', '[1]')$q$, '22023');
select pg_temp.expect($q$select public.report_stats('stat-game', null)$q$, '22023');
select pg_temp.expect($q$select public.report_stats('stat-game', '{"best":99,"nope":1}')$q$, '22023');
select pg_temp.expect($q$select public.report_stats('no-such-app', '{"best":1}')$q$, 'P0002');
select pg_temp.expect($q$select public.report_stats('stat-server', '{"wins":1}')$q$, '42501', '%from its server%');
select pg_temp.expect($q$select public.report_stats('quick-draw', '{"best":1}')$q$, '22023', 'Unknown stat best');
do $$
begin
  assert (select value from public.app_user_stats where user_id = auth.uid() and key = 'best') = 10, 'failed report wrote nothing';
end $$;
-- Leaderboards: bob 20, alice 10, carol 10, dave 5 (best); fastest: bob 500, alice 850.5, carol 850.5
select pg_temp.login('bob');
select public.report_stats('stat-game', '{"best":20,"fastest":500}');
select pg_temp.login('carol');
select public.report_stats('stat-game', '{"best":10,"fastest":850.5}');
select pg_temp.login('dave');
select public.report_stats('stat-game', '{"best":5}');
select public.report_stats('stat-game', '{"best":3}');
reset role;
-- Bots never appear on boards.
insert into public.app_user_stats (app_slug, user_id, key, value)
values ('stat-game', '00000000-0000-4000-8000-00000000b075', 'best', 1000);
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare b jsonb := public.app_stat_leaderboard('stat-game', 'best');
declare f jsonb := public.app_stat_leaderboard('stat-game', 'fastest', 10);
begin
  assert jsonb_array_length(b) = 4, b::text;
  assert (select jsonb_agg(jsonb_build_array(e->'rank', e->'profile'->>'handle', e->'value')) from jsonb_array_elements(b) e)
       = '[[1,"bob",20],[2,"alice_x",10],[2,"carol",10],[4,"dave",5]]'::jsonb, 'max: descending, ties share a rank, first to reach it first';
  assert b->0->'profile' ?& array['id', 'handle', 'name', 'avatarUrl', 'xp', 'isBot'], 'profile_json shape';
  assert (select jsonb_agg(jsonb_build_array(e->'rank', e->'profile'->>'handle', e->'value')) from jsonb_array_elements(f) e)
       = '[[1,"bob",500],[2,"alice_x",850.5],[2,"carol",850.5]]'::jsonb, 'min: ascending ' || f::text;
  assert jsonb_array_length(public.app_stat_leaderboard('stat-game', 'best', 1)) = 1, 'limit';
  assert public.app_stat_leaderboard('stat-game', 'streak') = '[]'::jsonb, 'nobody yet';
end $$;
select pg_temp.expect($q$select public.app_stat_leaderboard('stat-game', 'nope')$q$, '22023');
select pg_temp.expect($q$select public.app_stat_leaderboard('my-game', 'best')$q$, 'P0002');
do $$
declare s jsonb := public.user_stats(pg_temp.uid('alice_x'));
begin
  assert (select jsonb_agg(jsonb_build_array(e->>'appSlug', e->>'key', e->'value')) from jsonb_array_elements(s) e)
       = '[["stat-game","best",10],["stat-game","fastest",850.5],["stat-game","total",5],["stat-game","level",1]]'::jsonb,
    'manifest order: ' || s::text;
  assert s->0 ?& array['appSlug', 'key', 'value', 'updatedAt'], 'shape';
  assert public.user_stats(gen_random_uuid()) = '[]'::jsonb, 'unknown user';
end $$;

-- Server API: reports for any player, for client and server apps alike.
select pg_temp.expect(format('select public.report_stats(%L, %L)', 'stat-game', '{"best":1}'), '42501');
do $$
begin
  assert public.app_api_report_stats(pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), '{"wins":1}') = '{"wins":1}'::jsonb, 'server app';
  assert public.app_api_report_stats(pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), '{"wins":2}') = '{"wins":3}'::jsonb, 'sum';
  assert public.app_api_report_stats(pg_temp.cv('sec_stat'), pg_temp.uid('dave'), '{"best":6}') = '{"best":6}'::jsonb, 'client app too';
  assert (public.app_stat_leaderboard('stat-server', 'wins')->0->>'value')::int = 3, 'server app board';
end $$;
select pg_temp.expect(format('select public.app_api_report_stats(%L, %L, %L)', 'xas_nope', pg_temp.uid('alice_x'), '{"wins":1}'), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_report_stats(%L, %L, %L)', pg_temp.cv('sec_srv'), gen_random_uuid(), '{"wins":1}'), 'P0002');
select pg_temp.expect(format('select public.app_api_report_stats(%L, %L, %L)', pg_temp.cv('sec_srv'), '00000000-0000-4000-8000-00000000b075', '{"wins":1}'), 'P0002');
select pg_temp.expect(format('select public.app_api_report_stats(%L, %L, %L)', pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), '{"best":1}'), '22023');
select pg_temp.expect(format('select public.app_api_report_stats(%L, %L, %L)', pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), '{"wins":"x"}'), '22023');
set role authenticated;
select pg_temp.login('alice_x');
select pg_temp.expect($q$insert into public.app_user_stats (app_slug, user_id, key, value) values ('stat-game', auth.uid(), 'best', 1e9)$q$, '42501');
select pg_temp.expect($q$update public.app_user_stats set value = 1e9$q$, '42501');
do $$
begin
  assert (select count(*) from public.app_user_stats where app_slug = 'stat-game' and key = 'best') = 5, 'stats are public to read';
end $$;

-- Rate limit: 120 client reports a minute per user per app.
reset role;
delete from public.rate_limit_hits;
set role authenticated;
select pg_temp.login('erin');
do $$
begin
  for i in 1..120 loop
    perform public.report_stats('stat-game', '{"total":1}');
  end loop;
  begin
    perform public.report_stats('stat-game', '{"total":1}');
    raise exception 'expected 54000';
  exception when sqlstate '54000' then
    null;
  end;
  assert (select value from public.app_user_stats where user_id = auth.uid() and key = 'total') = 120, 'the refused report changed nothing';
end $$;
reset role;
do $$
begin
  assert (select hits from public.rate_limit_hits where user_id = pg_temp.uid('erin')) = 120, 'refusals don''t count';
end $$;
update public.rate_limit_hits set window_start = window_start - interval '1 minute';
set role authenticated;
select pg_temp.login('erin');
select public.report_stats('stat-game', '{"total":1}');
reset role;
do $$
begin
  assert (select count(*) from public.rate_limit_hits where user_id = pg_temp.uid('erin')) = 1, 'old windows cleaned up';
end $$;

-- ---------------------------------------------------------------- Achievements
set role authenticated;
select pg_temp.login('bob');
insert into ctx values ('wh_stat', public.set_app_webhook('stat-game', 'https://stat-game.example.com/hooks'));
select pg_temp.login('alice_x');
insert into ctx values ('xp0', pg_temp.xp('alice_x')::text);
do $$
begin
  assert public.unlock_achievement('stat-game', 'first_win') = '{"unlocked":true}'::jsonb, 'unlocked';
  assert pg_temp.xp('alice_x') = pg_temp.cv('xp0')::int + 50, 'xp awarded';
  assert public.unlock_achievement('stat-game', 'first_win') = '{"unlocked":false}'::jsonb, 'already had it';
  assert pg_temp.xp('alice_x') = pg_temp.cv('xp0')::int + 50, 'xp only once';
  assert public.unlock_achievement('stat-game', 'zero') = '{"unlocked":true}'::jsonb, '0 xp achievement';
  assert pg_temp.xp('alice_x') = pg_temp.cv('xp0')::int + 50, 'no xp';
  assert (select count(*) from public.user_achievements where user_id = auth.uid()) = 2, 'public rows';
end $$;
select pg_temp.expect($q$select public.unlock_achievement('stat-game', 'nope')$q$, '22023', 'Unknown achievement nope');
select pg_temp.expect($q$select public.unlock_achievement('stat-game', null)$q$, '22023');
select pg_temp.expect($q$select public.unlock_achievement('stat-game', 'best')$q$, '22023');
select pg_temp.expect($q$select public.unlock_achievement('stat-server', 'boss')$q$, '42501', '%from its server%');
select pg_temp.expect($q$select public.unlock_achievement('no-such-app', 'boss')$q$, 'P0002');
select pg_temp.expect($q$insert into public.user_achievements (app_slug, user_id, achievement_id) values ('stat-game', auth.uid(), 'secret_move')$q$, '42501');
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare l jsonb := public.list_user_achievements(pg_temp.uid('alice_x'));
begin
  assert jsonb_array_length(l) = 2, l::text;
  assert not (l @> '[{"achievementId":"secret_move"}]'), 'secret not unlocked yet';
  assert l->0 ?& array['appSlug', 'achievementId', 'unlockedAt'] and l->0->>'appSlug' = 'stat-game', 'shape';
  assert (l->0->>'unlockedAt')::timestamptz >= (l->1->>'unlockedAt')::timestamptz, 'newest first';
end $$;
select pg_temp.expect(format('select public.unlock_achievement(%L, %L)', 'stat-game', 'secret_move'), '42501');
-- Server API
insert into ctx values ('xp1', pg_temp.xp('alice_x')::text);
do $$
begin
  assert public.app_api_unlock_achievement(pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), 'boss') = '{"unlocked":true}'::jsonb, 'server unlock';
  assert public.app_api_unlock_achievement(pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), 'boss') = '{"unlocked":false}'::jsonb, 'once';
  assert public.app_api_unlock_achievement(pg_temp.cv('sec_stat'), pg_temp.uid('alice_x'), 'secret_move') = '{"unlocked":true}'::jsonb,
    'client apps too';
  assert pg_temp.xp('alice_x') = pg_temp.cv('xp1')::int + 200, 'boss 100 + secret 100';
  assert public.list_user_achievements(pg_temp.uid('alice_x')) @> '[{"achievementId":"secret_move"},{"achievementId":"boss","appSlug":"stat-server"}]',
    'unlocked secrets are listed';
end $$;
select pg_temp.expect(format('select public.app_api_unlock_achievement(%L, %L, %L)', 'xas_nope', pg_temp.uid('alice_x'), 'boss'), '28000', 'invalid_secret');
select pg_temp.expect(format('select public.app_api_unlock_achievement(%L, %L, %L)', pg_temp.cv('sec_srv'), gen_random_uuid(), 'boss'), 'P0002');
select pg_temp.expect(format('select public.app_api_unlock_achievement(%L, %L, %L)', pg_temp.cv('sec_srv'), pg_temp.uid('alice_x'), 'first_win'), '22023');
reset role;
do $$
declare d public.webhook_deliveries;
begin
  assert (select count(*) from public.webhook_deliveries where event = 'achievement.unlocked') = 3,
    'stat-game: first_win, zero, secret_move (stat-server has no webhook)';
  select * into d from public.webhook_deliveries where event = 'achievement.unlocked' and payload->>'achievementId' = 'first_win';
  assert d.app_slug = 'stat-game' and d.match_id is null and d.next_attempt_at is not null, 'queued';
  assert d.payload - 'createdAt' = jsonb_build_object('id', d.id, 'type', 'achievement.unlocked', 'app', '{"slug":"stat-game"}'::jsonb,
                                                      'match', null, 'userId', pg_temp.uid('alice_x'), 'achievementId', 'first_win'), d.payload::text;
end $$;
-- Achievements/stats dropped from the manifest disappear from profiles.
update public.apps set achievements = achievements - 1, stats = stats - 3 where slug = 'stat-game';
do $$
begin
  assert not (public.list_user_achievements(pg_temp.uid('alice_x')) @> '[{"achievementId":"secret_move"}]'), 'undeclared hidden';
  assert not (public.user_stats(pg_temp.uid('alice_x')) @> '[{"key":"level"}]'), 'undeclared stat hidden';
end $$;

-- Internal stage 3 helpers are not callable by clients
set role authenticated;
select pg_temp.login('alice_x');
select pg_temp.expect($q$select public.rate_limit_hit('x', auth.uid(), 1)$q$, '42501');
select pg_temp.expect($q$select public.storage_write('stat-game', null, 'k', '1')$q$, '42501');
select pg_temp.expect($q$select public.apply_stats((select a from public.apps a where slug = 'stat-game'), auth.uid(), '{}')$q$, '42501');
select pg_temp.expect($q$select public.grant_achievement((select a from public.apps a where slug = 'stat-game'), auth.uid(), 'zero')$q$, '42501');
select pg_temp.expect($q$select public.app_api_player(auth.uid())$q$, '42501');
select pg_temp.expect($q$select * from public.rate_limit_hits$q$, '42501');
reset role;

\echo 'All database lifecycle checks passed ✔'
