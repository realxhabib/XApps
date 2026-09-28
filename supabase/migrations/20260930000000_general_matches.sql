-- =============================================================================
-- Platform v2, stage 1: general matches (docs/platform-v2.md)
--
--  * 2–8 seats per match, optional teams (seat s plays for team s % teams).
--  * Spectators: a match_players row with role 'spectator' and no seat. They
--    join the realtime room and see the match, but can't submit, vote for
--    themselves (they have no entry) or change state/turns/rounds.
--  * Lobbies: a match waits in `open`/`pending` until full (live) or until
--    `min_players` are seated (async); the creator can start early.
--  * Shared match state (≤ 64 KB) written compare-and-set on `state_version`.
--  * Turns (optionally with a 3-day deadline in async play) and rounds.
--  * Settlement ranks N players (or teams); ties share a rank.
--
-- v1 (2-player) behaviour is unchanged. Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Apps: manifest fields
-- ---------------------------------------------------------------------------

alter table public.apps
  add column if not exists team_count integer not null default 0,
  add column if not exists allow_spectators boolean not null default true,
  add column if not exists has_setup boolean not null default false,
  add column if not exists turn_based boolean not null default false;

alter table public.apps drop constraint if exists apps_player_range_check;
alter table public.apps add constraint apps_player_range_check
  check (min_players between 2 and 8 and max_players between 2 and 8 and min_players <= max_players);
alter table public.apps drop constraint if exists apps_team_count_check;
alter table public.apps add constraint apps_team_count_check
  check (team_count = 0 or (team_count between 2 and 4 and max_players % team_count = 0));

-- ---------------------------------------------------------------------------
-- Matches: table size, teams, shared state, turns, rounds
-- ---------------------------------------------------------------------------

alter table public.matches
  add column if not exists min_players integer not null default 2,
  add column if not exists max_players integer not null default 2,
  add column if not exists team_count integer not null default 0,
  add column if not exists state jsonb,
  add column if not exists state_version integer not null default 0,
  add column if not exists turn_user uuid references public.profiles (id) on delete set null,
  add column if not exists turn_deadline timestamptz,
  add column if not exists round integer not null default 0,
  add column if not exists winner_team integer;

alter table public.matches drop constraint if exists matches_player_range_check;
alter table public.matches add constraint matches_player_range_check
  check (min_players between 2 and 8 and max_players between 2 and 8 and min_players <= max_players);
alter table public.matches drop constraint if exists matches_team_count_check;
alter table public.matches add constraint matches_team_count_check
  check (team_count = 0 or team_count between 2 and 4);
alter table public.matches drop constraint if exists matches_state_size_check;
alter table public.matches add constraint matches_state_size_check
  check (state is null or octet_length(state::text) <= 65536);
alter table public.matches drop constraint if exists matches_round_check;
alter table public.matches add constraint matches_round_check check (round >= 0);

create index if not exists matches_turn_deadline_idx on public.matches (turn_deadline)
  where status = 'active' and turn_deadline is not null;

-- ---------------------------------------------------------------------------
-- Match players: teams, roles (player/spectator), placements
-- ---------------------------------------------------------------------------

alter table public.match_players
  add column if not exists team integer,
  add column if not exists role text not null default 'player',
  add column if not exists rank integer;
alter table public.match_players alter column seat drop not null;

alter table public.match_players drop constraint if exists match_players_role_check;
alter table public.match_players add constraint match_players_role_check
  check (role in ('player', 'spectator'));
-- Players have a seat, spectators don't. unique (match_id, seat) still holds
-- for seats (NULLs never collide).
alter table public.match_players drop constraint if exists match_players_role_seat_check;
alter table public.match_players add constraint match_players_role_seat_check
  check ((role = 'player') = (seat is not null));

-- v1 matches were 1v1: the winner (or both, on a draw) placed first.
update public.match_players
   set rank = case result when 'loss' then 2 else 1 end
 where rank is null and result is not null and role = 'player';

-- ---------------------------------------------------------------------------
-- Practice bots: one per extra seat (a user can hold only one seat).
-- ---------------------------------------------------------------------------

do $$
declare
  v_ids uuid[] := array[
    '00000000-0000-4000-8000-00000000b076', '00000000-0000-4000-8000-00000000b077',
    '00000000-0000-4000-8000-00000000b078', '00000000-0000-4000-8000-00000000b079',
    '00000000-0000-4000-8000-00000000b07a', '00000000-0000-4000-8000-00000000b07b'
  ]::uuid[];
  v_handle text;
  i integer;
begin
  for i in 1 .. array_length(v_ids, 1) loop
    continue when exists (select 1 from public.profiles where id = v_ids[i]);
    v_handle := 'xapps_bot' || (i + 1);
    if exists (select 1 from public.profiles where handle = v_handle) then
      v_handle := 'xbot_' || left(md5(v_ids[i]::text), 8);
    end if;
    insert into public.profiles (id, handle, name, bio, is_bot)
    values (v_ids[i], v_handle, 'XApps Bot ' || (i + 1), 'Practice partner. Never tired, never tilted.', true);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- JSON shape
-- ---------------------------------------------------------------------------

-- `players` lists seated players by seat, plus the viewer's own spectator row
-- (so the client knows its role). Other spectators are only counted.
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

-- ---------------------------------------------------------------------------
-- Internal helpers (callers hold the match row lock)
-- ---------------------------------------------------------------------------

-- Every team has at least one seated (joined/submitted) player.
create or replace function public.teams_ready(p_match uuid, p_team_count integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_team_count, 0) = 0 or not exists (
    select 1 from generate_series(0, p_team_count - 1) g(t)
     where not exists (
       select 1 from public.match_players mp
        where mp.match_id = p_match and mp.role = 'player' and mp.team = g.t
          and mp.state in ('joined', 'submitted')
     )
  );
$$;

-- Seats a user in the lowest free seat (turning a spectator row into a player).
create or replace function public.seat_player(p_match uuid, p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_seat integer;
begin
  select * into m from public.matches where id = p_match;
  select min(s) into v_seat
    from generate_series(0, m.max_players - 1) s
   where not exists (select 1 from public.match_players mp where mp.match_id = p_match and mp.seat = s);
  if v_seat is null then
    raise exception 'This challenge is no longer open' using errcode = '55000';
  end if;
  insert into public.match_players (match_id, user_id, seat, team, role, state)
  values (p_match, p_user, v_seat, case when m.team_count > 0 then v_seat % m.team_count end, 'player', 'joined')
  on conflict (match_id, user_id) do update
     set seat = excluded.seat, team = excluded.team, role = 'player', state = 'joined', joined_at = now();
  if (select count(*) from public.match_players where match_id = p_match and role = 'player') >= m.max_players then
    update public.matches set is_open = false where id = p_match;
  end if;
  return v_seat;
end;
$$;

-- Turn-based apps: the seated player at the lowest seat moves first (async
-- turns get a 3-day deadline). Other apps keep turn_user null.
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
     or not coalesce((select a.turn_based from public.apps a where a.slug = m.app_slug), false) then
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

-- open/pending -> active: live once every seat is taken and no invite is
-- outstanding (or no one else can come); async as soon as min are seated.
create or replace function public.try_activate(p_match uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_seated integer;
  v_invited integer;
  v_taken integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status not in ('open', 'pending') then
    return false;
  end if;
  select count(*) filter (where state in ('joined', 'submitted')),
         count(*) filter (where state = 'invited'),
         count(*)
    into v_seated, v_invited, v_taken
    from public.match_players where match_id = p_match and role = 'player';
  if v_seated < m.min_players or not public.teams_ready(p_match, m.team_count) then
    return false;
  end if;
  if m.mode <> 'async' and (v_invited > 0 or (v_taken < m.max_players and m.is_open)) then
    return false;
  end if;
  update public.matches
     set status = 'active', is_open = is_open and v_taken < max_players, updated_at = now()
   where id = p_match;
  perform public.set_first_turn(p_match);
  return true;
end;
$$;

-- Next seated player who hasn't left, after p_after's seat (wrapping around).
create or replace function public.next_turn_user(p_match uuid, p_after uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select mp.user_id
    from public.match_players mp
   where mp.match_id = p_match and mp.role = 'player' and mp.state in ('joined', 'submitted')
   order by mp.seat <= coalesce((select x.seat from public.match_players x
                                  where x.match_id = p_match and x.user_id = p_after), -1),
            mp.seat
   limit 1;
$$;

-- Settles (or opens voting) once play is over: every seated player still in
-- has submitted, fewer than two remain, a team is empty, or only bots remain.
create or replace function public.maybe_settle(p_match uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_alive integer;
  v_humans integer;
  v_pending integer;
  v_winner uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then
    return false;
  end if;
  select count(*) filter (where state in ('invited', 'joined', 'submitted')),
         count(*) filter (where state in ('invited', 'joined', 'submitted') and not is_bot),
         count(*) filter (where state in ('invited', 'joined'))
    into v_alive, v_humans, v_pending
    from public.match_players where match_id = p_match and role = 'player';

  if v_alive < 2 or v_humans = 0
     or (m.team_count > 0 and exists (
           select 1 from generate_series(0, m.team_count - 1) g(t)
            where not exists (
              select 1 from public.match_players mp
               where mp.match_id = p_match and mp.role = 'player' and mp.team = g.t
                 and mp.state in ('invited', 'joined', 'submitted')))) then
    perform public.settle_match(p_match);
    return true;
  end if;
  if v_pending > 0 then
    return false;
  end if;

  if m.scoring = 'votes' then
    if m.mode = 'practice' then
      -- A simulated crowd judges practice contests instantly.
      select user_id into v_winner from public.match_players
       where match_id = p_match and role = 'player' and state = 'submitted'
       order by random() limit 1;
      update public.matches
         set votes = (
               select coalesce(jsonb_object_agg(mp.user_id::text,
                        case when mp.user_id = v_winner then m.votes_needed
                             else floor(random() * m.votes_needed)::integer end), '{}'::jsonb)
                 from public.match_players mp
                where mp.match_id = p_match and mp.role = 'player' and mp.state = 'submitted'),
             status = 'voting'
       where id = p_match;
      perform public.settle_match(p_match);
    else
      update public.matches
         set status = 'voting', voting_ends_at = now() + interval '24 hours', updated_at = now()
       where id = p_match;
    end if;
  else
    perform public.settle_match(p_match);
  end if;
  return true;
end;
$$;

-- The turn holder missed their deadline: they forfeit (marked left), the turn
-- moves on, and the match settles if too few remain.
create or replace function public.expire_turn(p_match uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
  v_next uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' or m.turn_user is null
     or m.turn_deadline is null or m.turn_deadline >= now() then
    return false;
  end if;
  update public.match_players set state = 'left'
   where match_id = p_match and user_id = m.turn_user and role = 'player' and state <> 'declined';
  v_next := public.next_turn_user(p_match, m.turn_user);
  update public.matches
     set turn_user = v_next,
         turn_deadline = case when v_next is not null and mode = 'async' then now() + interval '3 days' end,
         updated_at = now()
   where id = p_match;
  perform public.maybe_settle(p_match);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlement for N players / teams
-- ---------------------------------------------------------------------------

-- Placements: seated players who are still in are ranked by score (high/low)
-- or votes; ties share a rank; players who left share last place. In team
-- play the team total (sum of its remaining members) is ranked and members
-- take their team's placement. XP by placement: 1st = 30, last = 8, others
-- interpolated; everyone tied = 15 (the v1 draw). Stats: unique 1st = win,
-- tied 1st = draw, everyone else = loss. Practice: 3 XP, no stat changes.
create or replace function public.settle_match(p_match uuid, p_forfeit_by uuid default null)
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
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status in ('completed', 'cancelled', 'declined', 'expired') then
    return;
  end if;

  if p_forfeit_by is not null then
    update public.match_players set state = 'left'
     where match_id = p_match and user_id = p_forfeit_by and role = 'player' and state not in ('left', 'declined');
  end if;

  if m.team_count > 0 then
    with p as (
      select mp.user_id, coalesce(mp.team, mp.seat % m.team_count) as team, (mp.state = 'left') as gone,
             case when m.scoring = 'votes' then coalesce((m.votes ->> mp.user_id::text)::double precision, 0)
                  when m.scoring = 'low' then -mp.score
                  else mp.score end as k
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined'
    ),
    t as (
      select p.team, bool_or(not p.gone) as alive,
             coalesce(sum(p.k) filter (where not p.gone), '-Infinity'::double precision) as k
        from p group by p.team
    ),
    tr as (
      select t.team, t.alive,
             case when t.alive then 1 + (select count(*) from t t2 where t2.alive and t2.k > t.k)
                  else (select count(*) from t t2 where t2.alive) + 1 end as rank
        from t
    )
    update public.match_players mp
       set rank = case when p.gone then (select count(*) from tr where tr.alive) + 1 else tr.rank end
      from p join tr on tr.team = p.team
     where mp.match_id = p_match and mp.user_id = p.user_id;

    select count(distinct mp.team) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 then
      select mp.team into v_winner_team
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1
       limit 1;
    end if;
  else
    with p as (
      select mp.user_id, (mp.state = 'left') as gone,
             coalesce(case when m.scoring = 'votes' then coalesce((m.votes ->> mp.user_id::text)::double precision, 0)
                           when m.scoring = 'low' then -mp.score
                           else mp.score end,
                      '-Infinity'::double precision) as k
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined'
    )
    update public.match_players mp
       set rank = case when p.gone then (select count(*) from p q where not q.gone) + 1
                       else 1 + (select count(*) from p q where not q.gone and q.k > p.k) end
      from p
     where mp.match_id = p_match and mp.user_id = p.user_id;

    select count(*) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 then
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
  update public.apps set play_count = play_count + 1 where slug = m.app_slug;

  v_ranked := m.mode <> 'practice';
  for r in
    select * from public.match_players
     where match_id = p_match and role = 'player' and state <> 'declined'
  loop
    v_result := case when r.rank = 1 and v_top = 1 then 'win' when r.rank = 1 then 'draw' else 'loss' end;
    v_xp := case
      when r.is_bot then 0
      when not v_ranked then 3
      when coalesce(v_maxrank, 1) <= 1 then 15
      else round(30 - (r.rank - 1) * 22.0 / (v_maxrank - 1))::integer
    end;
    update public.match_players set result = v_result, xp_delta = v_xp
     where match_id = p_match and user_id = r.user_id;
    continue when r.is_bot;

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

-- Voting deadlines, async turn deadlines, stale invites and lobbies.
create or replace function public.finalize_due_matches()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.matches
     where status = 'voting' and voting_ends_at is not null and voting_ends_at < now()
     limit 200
  loop
    perform public.settle_match(r.id);
    n := n + 1;
  end loop;
  for r in
    select id from public.matches
     where status = 'active' and turn_deadline is not null and turn_deadline < now()
     limit 200
  loop
    if public.expire_turn(r.id) then
      n := n + 1;
    end if;
  end loop;
  -- Invites nobody answered within a week stop holding up a running async match.
  for r in
    select m.id from public.matches m
     where m.status = 'active' and m.mode = 'async' and m.created_at < now() - interval '7 days'
       and exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.state = 'invited')
     limit 200
  loop
    delete from public.match_players where match_id = r.id and state = 'invited';
    perform public.maybe_settle(r.id);
    n := n + 1;
  end loop;
  -- Stale lobbies and invites expire quietly.
  update public.matches set status = 'expired', updated_at = now()
   where status in ('open', 'pending') and created_at < now() - interval '7 days';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Creating and joining matches
-- ---------------------------------------------------------------------------

drop function if exists public.create_challenge(text, text, text, jsonb);

-- Invites 0..max-1 people (p_opponent and/or p_opponents). Table size
-- p_max_players is within the app's range; by default the app max for open
-- challenges, else invited + 1 (at least the app min, rounded up to whole
-- teams). Seats not covered by invites are open to anyone with the link.
create or replace function public.create_challenge(
  p_app text,
  p_mode text,
  p_opponent text default null,
  p_settings jsonb default '{}'::jsonb,
  p_opponents text[] default null,
  p_max_players integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
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
     min_players, max_players, team_count)
  values (a.slug, p_mode, case when v_k + 1 >= v_max then 'pending' else 'open' end, a.scoring, v_me,
          v_k + 1 < v_max, a.votes_to_win, v_settings, v_min, v_max, v_teams)
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

-- Quick lobbies fill up to the app max; the first joiner (the lobby's
-- creator) can start early with start_match once min are seated.
create or replace function public.quick_match(p_app text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
  v_id uuid;
begin
  -- Already waiting in a lobby with company.
  select m.id into v_id
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.user_id = v_me and mp.role = 'player'
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick
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
       and (select count(*) from public.match_players mp where mp.match_id = m.id and mp.role = 'player') < 2;
    perform public.seat_player(v_id, v_me);
    perform public.try_activate(v_id);
    update public.matches set updated_at = now() where id = v_id;
    return v_id;
  end if;

  select m.id into v_id
    from public.matches m
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick and m.created_by = v_me
     and m.created_at > now() - interval '10 minutes'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.matches
    (app_slug, mode, status, scoring, created_by, is_open, is_quick, votes_needed,
     min_players, max_players, team_count)
  values (a.slug, case when 'live' = any (a.modes) then 'live' else 'async' end, 'open', a.scoring, v_me,
          true, true, a.votes_to_win,
          least(a.max_players, greatest(a.min_players, a.team_count)), a.max_players, a.team_count)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, team, state)
  values (v_id, v_me, 0, case when a.team_count > 0 then 0 end, 'joined');
  return v_id;
end;
$$;

drop function if exists public.start_practice(text);

-- Practice against bots filling up to p_players seats (default: app min).
create or replace function public.start_practice(p_app text, p_players integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
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
     min_players, max_players, team_count)
  values (a.slug, 'practice', 'active', a.scoring, v_me, 5, a.scoring = 'votes',
          least(v_n, greatest(a.min_players, a.team_count)), v_n, a.team_count)
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

-- Takes the next free seat; accepting an invite keeps your seat. Open seats of
-- a running async match stay joinable.
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

-- Creator only: open/pending -> active once min are seated. Unanswered
-- invites are withdrawn and the remaining seats close.
create or replace function public.start_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_seated integer;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or (m.mode = 'practice' and m.created_by <> v_me) then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if m.created_by <> v_me then
    raise exception 'Only the challenger can start the match' using errcode = '42501';
  end if;
  if m.status not in ('open', 'pending') then
    raise exception 'This match has already started' using errcode = '55000';
  end if;
  select count(*) into v_seated from public.match_players
   where match_id = p_match and role = 'player' and state in ('joined', 'submitted');
  if v_seated < m.min_players then
    raise exception 'Waiting for at least % players', m.min_players using errcode = '55000';
  end if;
  if not public.teams_ready(p_match, m.team_count) then
    raise exception 'Every team needs at least one player' using errcode = '55000';
  end if;
  delete from public.match_players where match_id = p_match and role = 'player' and state = 'invited';
  update public.matches set status = 'active', is_open = false, updated_at = now() where id = p_match;
  perform public.set_first_turn(p_match);
end;
$$;

-- Seated players invite more people into free seats of a lobby that hasn't
-- started, or of a running async match. A spectator can be invited (their
-- row becomes an invited seat).
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

-- Watch a match without a seat.
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
  if not coalesce((select allow_spectators from public.apps where slug = m.app_slug), false) then
    raise exception 'This app doesn''t allow spectators' using errcode = '42501';
  end if;
  if m.status not in ('open', 'pending', 'active', 'voting') then
    raise exception 'This match is over' using errcode = '55000';
  end if;
  insert into public.match_players (match_id, user_id, seat, role, state)
  values (p_match, v_me, null, 'spectator', 'joined');
end;
$$;

create or replace function public.decline_match(p_match uuid)
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
  if not found or not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state = 'invited'
  ) then
    raise exception 'Nothing to decline' using errcode = '22023';
  end if;

  if m.max_players <= 2 then
    -- 1v1: declining ends the challenge (v1).
    update public.match_players set state = 'declined' where match_id = p_match and user_id = v_me;
    update public.matches set status = 'declined', updated_at = now() where id = p_match;
    return;
  end if;

  -- Multiplayer: the invite is withdrawn and the seat frees up.
  delete from public.match_players where match_id = p_match and user_id = v_me;
  if m.status in ('open', 'pending') then
    if not m.is_open
       and (select count(*) from public.match_players where match_id = p_match and role = 'player') < m.min_players then
      update public.matches set status = 'declined', updated_at = now() where id = p_match;
      return;
    end if;
    perform public.try_activate(p_match);
  else
    perform public.maybe_settle(p_match);
  end if;
  update public.matches set updated_at = now() where id = p_match;
end;
$$;

-- ---------------------------------------------------------------------------
-- Playing
-- ---------------------------------------------------------------------------

create or replace function public.mark_started(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
begin
  if not exists (select 1 from public.match_players where match_id = p_match and user_id = v_me and role = 'player') then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  update public.matches set started_at = coalesce(started_at, now())
   where id = p_match and started_at is null;
end;
$$;

-- Shared match state, compare-and-set on the version.
create or replace function public.update_match_state(p_match uuid, p_state jsonb, p_expected_version integer)
returns integer
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
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state in ('joined', 'submitted')
  ) then
    raise exception 'Only seated players can change the match state' using errcode = '42501';
  end if;
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
  end if;
  if p_state is not null and octet_length(p_state::text) > 65536 then
    raise exception 'Match state is too large (max 64 KB)' using errcode = '22023';
  end if;
  if p_expected_version is distinct from m.state_version then
    raise exception 'state_conflict' using errcode = '40001',
      detail = format('expected version %s, current version %s', p_expected_version, m.state_version);
  end if;
  update public.matches
     set state = p_state, state_version = state_version + 1, updated_at = now()
   where id = p_match;
  return m.state_version + 1;
end;
$$;

-- Pass the turn: by the holder (or anyone seated when no turn is set; in
-- practice, where the app drives the bots, the human may pass a bot's turn).
-- Default next: the next seated player
-- who hasn't left. Async turns get a 3-day deadline.
create or replace function public.end_turn(p_match uuid, p_next uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_next uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or (m.mode = 'practice' and m.created_by <> v_me) then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state in ('joined', 'submitted')
  ) then
    raise exception 'Only seated players can pass the turn' using errcode = '42501';
  end if;
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
  end if;
  if m.turn_user is not null and m.turn_user <> v_me
     and not (m.mode = 'practice' and exists (select 1 from public.match_players
                                               where match_id = p_match and user_id = m.turn_user and is_bot)) then
    raise exception 'It''s not your turn' using errcode = '42501';
  end if;
  if p_next is not null then
    if not exists (
      select 1 from public.match_players
       where match_id = p_match and user_id = p_next and role = 'player' and state in ('joined', 'submitted')
    ) then
      raise exception 'The next turn must go to a seated player' using errcode = '22023';
    end if;
    v_next := p_next;
  else
    v_next := public.next_turn_user(p_match, coalesce(m.turn_user, v_me));
  end if;
  update public.matches
     set turn_user = v_next,
         turn_deadline = case when mode = 'async' then now() + interval '3 days' end,
         updated_at = now()
   where id = p_match;
end;
$$;

-- App-controlled round counter (never goes backwards).
create or replace function public.set_round(p_match uuid, p_round integer)
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
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state in ('joined', 'submitted')
  ) then
    raise exception 'Only seated players can set the round' using errcode = '42501';
  end if;
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
  end if;
  if p_round is null or p_round < m.round or p_round > 1000000 then
    raise exception 'Rounds only go forward' using errcode = '22023';
  end if;
  if p_round <> m.round then
    update public.matches set round = p_round, updated_at = now() where id = p_match;
  end if;
end;
$$;

-- A player gone quiet (45 s live, 3 days async) is marked left. The match
-- goes on while ≥ 2 players (≥ 1 per team) remain, else it settles.
create or replace function public.claim_forfeit(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_opp public.match_players;
  v_quiet interval;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' or m.started_at is null then
    raise exception 'Match isn''t running' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.match_players
     where match_id = p_match and user_id = v_me and role = 'player' and state in ('joined', 'submitted')
  ) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  v_quiet := case when m.mode = 'async' then interval '3 days' else interval '45 seconds' end;
  select * into v_opp from public.match_players
   where match_id = p_match and user_id <> v_me and role = 'player' and not is_bot and state = 'joined'
     and coalesce(last_seen_at, m.started_at) <= now() - v_quiet
   order by coalesce(last_seen_at, m.started_at), seat
   limit 1;
  if v_opp.user_id is null then
    if exists (select 1 from public.match_players
                where match_id = p_match and user_id <> v_me and role = 'player' and not is_bot and state = 'joined') then
      raise exception 'Your opponent is still connected' using errcode = '55000';
    end if;
    raise exception 'No opponent to claim against' using errcode = '22023';
  end if;

  update public.match_players set state = 'left' where match_id = p_match and user_id = v_opp.user_id;
  if m.turn_user = v_opp.user_id then
    update public.matches
       set turn_user = public.next_turn_user(p_match, v_opp.user_id),
           turn_deadline = case when mode = 'async' then now() + interval '3 days' end
     where id = p_match;
  end if;
  if not public.maybe_settle(p_match) then
    update public.matches set updated_at = now() where id = p_match;
  end if;
end;
$$;

-- Leave a match. 1v1 (and practice) settle with the other side winning, as
-- in v1; bigger matches go on without you while enough players remain.
-- Leaving a lobby frees your seat (the creator leaving cancels it);
-- spectators just stop watching.
create or replace function public.forfeit_match(p_match uuid)
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
  if not found or m.status not in ('active', 'pending', 'open') then
    raise exception 'Match already over' using errcode = '55000';
  end if;
  select * into v_row from public.match_players where match_id = p_match and user_id = v_me;
  if v_row.user_id is null then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  if v_row.role = 'spectator' then
    delete from public.match_players where match_id = p_match and user_id = v_me;
    return;
  end if;
  if (select count(*) from public.match_players where match_id = p_match and role = 'player') < 2 then
    update public.matches set status = 'cancelled', updated_at = now() where id = p_match;
    return;
  end if;
  if m.max_players <= 2 or m.mode = 'practice' then
    perform public.settle_match(p_match, v_me);
    return;
  end if;

  if m.status in ('open', 'pending') then
    if m.created_by = v_me then
      update public.matches set status = 'cancelled', updated_at = now() where id = p_match;
      return;
    end if;
    delete from public.match_players where match_id = p_match and user_id = v_me;
    update public.matches set is_open = is_open or status = 'open', updated_at = now() where id = p_match;
    if not (select is_open from public.matches where id = p_match)
       and (select count(*) from public.match_players where match_id = p_match and role = 'player') < m.min_players then
      update public.matches set status = 'cancelled' where id = p_match;
      return;
    end if;
    perform public.try_activate(p_match);
    return;
  end if;

  update public.match_players set state = 'left' where match_id = p_match and user_id = v_me;
  if m.turn_user = v_me then
    update public.matches
       set turn_user = public.next_turn_user(p_match, v_me),
           turn_deadline = case when mode = 'async' then now() + interval '3 days' end
     where id = p_match;
  end if;
  if not public.maybe_settle(p_match) then
    update public.matches set updated_at = now() where id = p_match;
  end if;
end;
$$;

create or replace function public.submit_entry(
  p_match uuid,
  p_player uuid default null,
  p_score double precision default null,
  p_data jsonb default null,
  p_display jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  v_target uuid := coalesce(p_player, v_me);
  m public.matches;
  v_self public.match_players;
  t public.match_players;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  select * into v_self from public.match_players where match_id = p_match and user_id = v_me;
  if v_self.user_id is null then
    raise exception 'Not in this match' using errcode = '42501';
  end if;
  if v_self.role <> 'player' then
    raise exception 'Spectators can''t submit' using errcode = '42501';
  end if;
  select * into t from public.match_players where match_id = p_match and user_id = v_target;
  if t.user_id is null or t.role <> 'player' then
    raise exception 'Not in this match' using errcode = '42501';
  end if;
  if v_target <> v_me and not t.is_bot then
    raise exception 'You can only submit for yourself or a bot' using errcode = '42501';
  end if;
  if m.status not in ('active', 'open', 'pending') then
    raise exception 'This match is already decided' using errcode = '55000';
  end if;
  if m.status in ('open', 'pending') and m.mode <> 'async' then
    raise exception 'This match hasn''t started' using errcode = '55000';
  end if;
  if t.state = 'submitted' then
    raise exception 'Already submitted' using errcode = '55000';
  end if;
  if t.state in ('left', 'declined') or v_self.state in ('left', 'declined') then
    raise exception 'You''re out of this match' using errcode = '55000';
  end if;
  if m.scoring <> 'votes' and p_score is null then
    raise exception 'A score is required' using errcode = '22023';
  end if;
  if p_score is not null and (p_score = 'NaN'::double precision or abs(p_score) > 1e9) then
    raise exception 'Invalid score' using errcode = '22023';
  end if;
  if p_display is not null and coalesce(p_display->>'kind', '') not in ('text', 'svg', 'image') then
    raise exception 'Unknown display kind' using errcode = '22023';
  end if;
  if p_display->>'kind' = 'image' and coalesce(p_display->>'url', '') !~ '^https://' then
    raise exception 'Images must be https' using errcode = '22023';
  end if;

  update public.match_players
     set state = 'submitted', score = p_score, last_seen_at = now()
   where match_id = p_match and user_id = v_target;
  insert into public.submissions (match_id, user_id, data, display)
  values (p_match, v_target, p_data, p_display)
  on conflict (match_id, user_id) do update set data = excluded.data, display = excluded.display;
  update public.matches set updated_at = now() where id = p_match;

  -- An invitee playing an async match counts as having joined.
  perform public.try_activate(p_match);
  perform public.maybe_settle(p_match);
end;
$$;

-- Crowd judging works for any number of entries. Anyone but the match's
-- players may vote (spectators included); choices are submitted players.
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
  update public.profiles set xp = xp + 2 where id = v_me;
  if v_count >= m.votes_needed then
    perform public.settle_match(p_match);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read RPCs
-- ---------------------------------------------------------------------------

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

create or replace function public.list_my_matches()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  result jsonb;
begin
  if v_me is null then
    return '[]'::jsonb;
  end if;
  perform public.expire_turn(m.id)
     from public.matches m
    where m.status = 'active' and m.turn_deadline < now()
      and exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = v_me)
    limit 20;
  select coalesce(jsonb_agg(public.match_json(m, v_me) order by m.updated_at desc), '[]'::jsonb) into result
    from (
      select m.* from public.matches m
       where exists (select 1 from public.match_players mp
                      where mp.match_id = m.id and mp.user_id = v_me and mp.role = 'player')
       order by m.updated_at desc
       limit 60
    ) m;
  return result;
end;
$$;

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
       where m.status = 'voting' and m.mode <> 'practice'
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
       where m.mode <> 'practice' and m.status in ('completed', 'voting', 'active')
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
       where m.mode <> 'practice' and m.status in ('completed', 'voting', 'active')
         and exists (select 1 from public.match_players mp
                      where mp.match_id = m.id and mp.user_id = p_user and mp.role = 'player')
       order by m.updated_at desc
       limit 20
    ) m;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: players and spectators share the `match:<id>` room.
-- ---------------------------------------------------------------------------

create or replace function public.is_room_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_topic !~ '^match:[0-9a-f-]{36}$' then
    return false;
  end if;
  v_id := substring(p_topic from 7)::uuid;
  return exists (
    select 1 from public.match_players mp
     where mp.match_id = v_id and mp.user_id = auth.uid()
       and (mp.role = 'spectator' or mp.state <> 'declined')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers are not part of the public API.
-- ---------------------------------------------------------------------------

revoke execute on function public.teams_ready(uuid, integer) from public, anon, authenticated;
revoke execute on function public.set_first_turn(uuid) from public, anon, authenticated;
revoke execute on function public.seat_player(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.try_activate(uuid) from public, anon, authenticated;
revoke execute on function public.next_turn_user(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.maybe_settle(uuid) from public, anon, authenticated;
revoke execute on function public.expire_turn(uuid) from public, anon, authenticated;
revoke execute on function public.match_json(public.matches, uuid) from public, anon, authenticated;
revoke execute on function public.settle_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_due_matches() from public, anon, authenticated;
