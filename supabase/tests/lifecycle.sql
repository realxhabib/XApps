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

\echo 'All database lifecycle checks passed ✔'
