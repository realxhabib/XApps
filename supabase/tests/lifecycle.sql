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

reset role;
\echo 'All database lifecycle checks passed ✔'
