-- =============================================================================
-- Platform v2, stage 2: Trust (docs/platform-v2.md)
--
--  * App credentials (owner only): an app secret `xas_…` (stored as a SHA-256
--    hash + 8-char display prefix), a webhook URL and its signing secret
--    `whsec_…`. Table `app_credentials` has RLS on and no client policies;
--    everything goes through SECURITY DEFINER RPCs.
--  * Server API: `app_api_*` RPCs take the app secret, read and write matches
--    of that app and report results (settling through the same ranking/XP
--    code as settle_match).
--  * `apps.authority = 'server'`: players' clients can no longer settle a
--    match by submitting; the app server reports the result. Matches snapshot
--    the app's authority when they're created. Safety valve: 24 h after
--    everyone submitted without a report, the match settles as a draw
--    (end_reason 'server_timeout').
--  * Webhooks: deferred triggers enqueue events into `webhook_deliveries`;
--    `deliver_webhooks()` signs and sends them with pg_net, reconciles
--    responses and retries with backoff; pg_cron runs it every minute.
--
-- v1/stage 1 behaviour is unchanged for client-authoritative apps. Safe to re-run.
-- =============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- pg_net + pg_cron are enabled when the platform has them (Supabase does);
-- plain PostgreSQL (local tests) skips them.
do $$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception when others then
    begin
      create extension if not exists pg_net;
    exception when others then
      raise notice 'pg_net is not available (%); webhooks stay queued until it is enabled', sqlerrm;
    end;
  end;
end $$;

do $$
begin
  begin
    create extension if not exists pg_cron with schema pg_catalog;
  exception when others then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is not available (%); schedule public.deliver_webhooks() yourself', sqlerrm;
    end;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

alter table public.apps
  add column if not exists authority text not null default 'client';
alter table public.apps drop constraint if exists apps_authority_check;
alter table public.apps add constraint apps_authority_check check (authority in ('client', 'server'));
-- Crowd-judged apps are settled by votes, never by an app server.
alter table public.apps drop constraint if exists apps_authority_scoring_check;
alter table public.apps add constraint apps_authority_scoring_check check (authority = 'client' or scoring <> 'votes');

-- Owners change authority only through set_app_authority (which checks that a
-- secret exists); direct client writes keep the current value.
create or replace function public.apps_guard_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.authority := 'client';
  else
    new.authority := old.authority;
  end if;
  return new;
end;
$$;

drop trigger if exists apps_guard_authority on public.apps;
create trigger apps_guard_authority
  before insert or update on public.apps
  for each row execute function public.apps_guard_authority();

-- Matches: the authority they were created under, when every seated player
-- was done (server-authoritative matches wait for a report from then on), and
-- why the platform ended them ('server_timeout').
alter table public.matches
  add column if not exists authority text not null default 'client',
  add column if not exists all_submitted_at timestamptz,
  add column if not exists end_reason text;
alter table public.matches drop constraint if exists matches_authority_check;
alter table public.matches add constraint matches_authority_check check (authority in ('client', 'server'));

create index if not exists matches_awaiting_report_idx on public.matches (all_submitted_at)
  where status = 'active' and authority = 'server' and all_submitted_at is not null;

create or replace function public.matches_set_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Practice never touches rank and the app's server may not know about it,
  -- so practice matches always settle on the client.
  new.authority := case
    when new.mode = 'practice' then 'client'
    else coalesce((select a.authority from public.apps a where a.slug = new.app_slug), 'client')
  end;
  return new;
end;
$$;

drop trigger if exists matches_set_authority on public.matches;
create trigger matches_set_authority
  before insert on public.matches
  for each row execute function public.matches_set_authority();

-- A server-authoritative player's submitted score is only a claim; the app
-- server reports the real one.
alter table public.match_players
  add column if not exists claimed_score double precision;

-- ---------------------------------------------------------------------------
-- Credentials + deliveries
-- ---------------------------------------------------------------------------

create table if not exists public.app_credentials (
  app_slug text primary key references public.apps (slug) on delete cascade,
  secret_hash text,
  secret_prefix text,
  webhook_url text,
  webhook_secret text,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  check ((secret_hash is null) = (secret_prefix is null)),
  check ((webhook_url is null) = (webhook_secret is null))
);
create unique index if not exists app_credentials_secret_hash_key on public.app_credentials (secret_hash)
  where secret_hash is not null;
alter table public.app_credentials enable row level security;
revoke all on public.app_credentials from public, anon, authenticated;

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.apps (slug) on delete cascade,
  event text not null check (event in ('match.created', 'match.started', 'match.state', 'match.turn',
                                       'match.submitted', 'match.ended', 'ping')),
  match_id uuid references public.matches (id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  -- null once delivered or given up
  next_attempt_at timestamptz default now(),
  request_id bigint,
  sent_at timestamptz,
  delivered_at timestamptz,
  last_status integer,
  last_error text
);
create index if not exists webhook_deliveries_app_idx on public.webhook_deliveries (app_slug, created_at desc);
create index if not exists webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at)
  where delivered_at is null and request_id is null and next_attempt_at is not null;
create index if not exists webhook_deliveries_inflight_idx on public.webhook_deliveries (request_id)
  where request_id is not null and delivered_at is null;
create index if not exists webhook_deliveries_pending_match_idx on public.webhook_deliveries (match_id, event)
  where delivered_at is null;
create index if not exists webhook_deliveries_created_idx on public.webhook_deliveries (created_at);
alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- App-view match JSON: match_json's shape with every seated player's
-- submission (data + display) visible, plus claimedScore, authority and
-- endReason. For the app's server only (server API + webhooks).
-- ---------------------------------------------------------------------------

create or replace function public.app_match_json(m public.matches)
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
    'authority', m.authority, 'endReason', m.end_reason,
    'spectatorCount', (
      select count(*) from public.match_players sp where sp.match_id = m.id and sp.role = 'spectator'
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', mp.user_id, 'seat', mp.seat, 'team', mp.team, 'role', mp.role, 'rank', mp.rank,
        'state', mp.state, 'isBot', mp.is_bot,
        'score', mp.score, 'claimedScore', mp.claimed_score,
        'result', mp.result, 'xpDelta', mp.xp_delta, 'lastSeenAt', mp.last_seen_at,
        'submission', case
          when s.match_id is null then null
          else jsonb_build_object('data', s.data, 'display', s.display)
        end,
        'profile', public.profile_json(p)
      ) order by mp.seat)
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.submissions s on s.match_id = mp.match_id and s.user_id = mp.user_id
      where mp.match_id = m.id and mp.role = 'player'
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Settlement, split so reported results reuse it
-- ---------------------------------------------------------------------------

-- Placements from scores (p_scoring 'high'/'low') or crowd votes ('votes'):
-- ties share a rank, players who left share last place; in team play the
-- team total is ranked and members take their team's placement.
create or replace function public.place_players(p_match uuid, p_scoring text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match;
  if m.team_count > 0 then
    with p as (
      select mp.user_id, coalesce(mp.team, mp.seat % m.team_count) as team, (mp.state = 'left') as gone,
             case when p_scoring = 'votes' then coalesce((m.votes ->> mp.user_id::text)::double precision, 0)
                  when p_scoring = 'low' then -mp.score
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
  else
    with p as (
      select mp.user_id, (mp.state = 'left') as gone,
             coalesce(case when p_scoring = 'votes' then coalesce((m.votes ->> mp.user_id::text)::double precision, 0)
                           when p_scoring = 'low' then -mp.score
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
  end if;
end;
$$;

-- Completes a match whose players already carry ranks: winner (unique first
-- place, or winner team), XP by placement (1st = 30, last = 8, others
-- interpolated; everyone tied = 15), results (unique 1st = win, tied 1st =
-- draw, else loss) and stats. Practice: 3 XP, no stat changes.
-- p_draw: everyone at rank 1 draws with the draw XP (15), the rest lose (8).
create or replace function public.award_placements(p_match uuid, p_draw boolean default false)
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
  select * into m from public.matches where id = p_match;

  if m.team_count > 0 then
    select count(distinct mp.team) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 and not p_draw then
      select mp.team into v_winner_team
        from public.match_players mp
       where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1
       limit 1;
    end if;
  else
    select count(*) into v_top
      from public.match_players mp
     where mp.match_id = p_match and mp.role = 'player' and mp.state <> 'declined' and mp.rank = 1;
    if v_top = 1 and not p_draw then
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
    v_result := case when r.rank = 1 and v_top = 1 and not p_draw then 'win' when r.rank = 1 then 'draw' else 'loss' end;
    v_xp := case
      when r.is_bot then 0
      when not v_ranked then 3
      when p_draw then case when r.rank = 1 then 15 else 8 end
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

-- Same behaviour as before, now built from place_players + award_placements.
create or replace function public.settle_match(p_match uuid, p_forfeit_by uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status in ('completed', 'cancelled', 'declined', 'expired') then
    return;
  end if;

  if p_forfeit_by is not null then
    update public.match_players set state = 'left'
     where match_id = p_match and user_id = p_forfeit_by and role = 'player' and state not in ('left', 'declined');
  end if;

  -- Multiplayer invites nobody answered are withdrawn, not ranked.
  if m.max_players > 2 then
    delete from public.match_players
     where match_id = p_match and role = 'player' and state = 'invited';
  end if;

  perform public.place_players(p_match, m.scoring);
  perform public.award_placements(p_match);
end;
$$;

-- Server-authoritative match nobody reported within 24 h of everyone
-- submitting: a draw for everyone still in (draw XP only), leavers lose.
create or replace function public.settle_server_timeout(p_match uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' then
    return false;
  end if;
  if m.max_players > 2 then
    delete from public.match_players
     where match_id = p_match and role = 'player' and state = 'invited';
  end if;
  update public.match_players
     set rank = case when state = 'left' then 2 else 1 end
   where match_id = p_match and role = 'player' and state <> 'declined';
  update public.matches set end_reason = 'server_timeout' where id = p_match;
  perform public.award_placements(p_match, true);
  return true;
end;
$$;

-- Settles (or opens voting) once play is over. Server-authoritative matches
-- where everyone is done wait for the app server instead (all_submitted_at).
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

  -- Forfeits (too few left) settle whatever the authority.
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

  if m.authority = 'server' then
    update public.matches set all_submitted_at = now() where id = p_match;
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

-- Server-authoritative matches: the score is optional and stored as a claim
-- (claimed_score); submitting never settles. Otherwise unchanged.
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
  v_server boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  v_server := m.authority = 'server';
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
  if m.scoring <> 'votes' and p_score is null and not v_server then
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
     set state = 'submitted',
         score = case when v_server then score else p_score end,
         claimed_score = case when v_server then p_score else claimed_score end,
         last_seen_at = now()
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

-- Voting deadlines, async turn deadlines, stale invites and lobbies, and
-- server-authoritative matches the app server never reported (24 h).
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
  -- The app server never reported: a draw.
  for r in
    select m.id from public.matches m
     where m.status = 'active' and m.authority = 'server'
       and m.all_submitted_at is not null and m.all_submitted_at < now() - interval '24 hours'
       and not exists (select 1 from public.match_players mp
                        where mp.match_id = m.id and mp.role = 'player' and mp.state in ('invited', 'joined'))
     limit 200
  loop
    if public.settle_server_timeout(r.id) then
      n := n + 1;
    end if;
  end loop;
  -- Stale lobbies and invites expire quietly.
  update public.matches set status = 'expired', updated_at = now()
   where status in ('open', 'pending') and created_at < now() - interval '7 days';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner RPCs
-- ---------------------------------------------------------------------------

create or replace function public.owned_app(p_app text)
returns public.apps
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps;
begin
  select * into a from public.apps where slug = p_app;
  if not found then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  if a.developer_id is distinct from v_me then
    raise exception 'Only the app''s developer can manage its server settings' using errcode = '42501';
  end if;
  return a;
end;
$$;

create or replace function public.new_secret(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || encode(extensions.gen_random_bytes(24), 'hex');
$$;

create or replace function public.get_app_server_config(p_app text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
  c public.app_credentials;
begin
  select * into c from public.app_credentials where app_slug = a.slug;
  return jsonb_build_object(
    'secretPrefix', c.secret_prefix,
    'hasSecret', c.secret_hash is not null,
    'webhookUrl', c.webhook_url,
    'hasWebhook', c.webhook_url is not null,
    'authority', a.authority
  );
end;
$$;

-- Returns the new secret; only its hash and prefix are kept.
create or replace function public.rotate_app_secret(p_app text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
  v_secret text := public.new_secret('xas_');
begin
  insert into public.app_credentials (app_slug, secret_hash, secret_prefix)
  values (a.slug, encode(extensions.digest(v_secret, 'sha256'), 'hex'), left(v_secret, 8))
  on conflict (app_slug) do update
     set secret_hash = excluded.secret_hash, secret_prefix = excluded.secret_prefix, rotated_at = now();
  return v_secret;
end;
$$;

-- https only, a public host name (no credentials, localhost or private IPs).
-- Returns a new signing secret when the URL is set or changed, null when it
-- is cleared or unchanged.
create or replace function public.set_app_webhook(p_app text, p_url text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_host text;
  v_old text;
  v_secret text;
begin
  select webhook_url into v_old from public.app_credentials where app_slug = a.slug;

  if v_url is null then
    update public.app_credentials set webhook_url = null, webhook_secret = null, rotated_at = now()
     where app_slug = a.slug and webhook_url is not null;
    -- Nothing left to deliver to.
    update public.webhook_deliveries
       set next_attempt_at = null, last_error = 'Webhook removed'
     where app_slug = a.slug and delivered_at is null and request_id is null and next_attempt_at is not null;
    return null;
  end if;

  if char_length(v_url) > 2000 then
    raise exception 'Webhook URL is too long' using errcode = '22023';
  end if;
  if v_url !~* '^https://' then
    raise exception 'Webhook URLs must use https://' using errcode = '22023';
  end if;
  if v_url !~ '^https://[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$' then
    raise exception 'That isn''t a valid webhook URL' using errcode = '22023';
  end if;
  v_host := lower(substring(v_url from '^https://([^/:?#]+)'));
  if v_host = 'localhost' or v_host like '%.localhost' or v_host like '%.local' or v_host like '%.internal'
     or v_host ~ '^(0|10|127)\.' or v_host ~ '^169\.254\.' or v_host ~ '^192\.168\.'
     or v_host ~ '^172\.(1[6-9]|2[0-9]|3[01])\.' or v_host ~ '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' then
    raise exception 'Webhooks must point to a public host' using errcode = '22023';
  end if;

  if v_old is not distinct from v_url then
    return null;
  end if;
  v_secret := public.new_secret('whsec_');
  insert into public.app_credentials (app_slug, webhook_url, webhook_secret)
  values (a.slug, v_url, v_secret)
  on conflict (app_slug) do update
     set webhook_url = excluded.webhook_url, webhook_secret = excluded.webhook_secret, rotated_at = now();
  return v_secret;
end;
$$;

create or replace function public.rotate_webhook_secret(p_app text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
  v_secret text := public.new_secret('whsec_');
begin
  update public.app_credentials set webhook_secret = v_secret, rotated_at = now()
   where app_slug = a.slug and webhook_url is not null;
  if not found then
    raise exception 'Set a webhook URL first' using errcode = '55000';
  end if;
  return v_secret;
end;
$$;

-- 'server' needs an app secret (someone has to be able to report results)
-- and a score-based app. Applies to matches created from now on.
create or replace function public.set_app_authority(p_app text, p_authority text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
begin
  if p_authority is null or p_authority not in ('client', 'server') then
    raise exception 'Authority is either client or server' using errcode = '22023';
  end if;
  if p_authority = 'server' then
    if a.scoring = 'votes' then
      raise exception 'Crowd-judged apps can''t be server-authoritative' using errcode = '22023';
    end if;
    if not exists (select 1 from public.app_credentials where app_slug = a.slug and secret_hash is not null) then
      raise exception 'Create an app secret first' using errcode = '55000';
    end if;
  end if;
  update public.apps set authority = p_authority where slug = a.slug;
end;
$$;

create or replace function public.list_webhook_deliveries(p_app text, p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
  result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'event', d.event, 'matchId', d.match_id, 'createdAt', d.created_at,
           'attempts', d.attempts, 'deliveredAt', d.delivered_at, 'lastStatus', d.last_status,
           'lastError', d.last_error, 'nextAttemptAt', d.next_attempt_at
         ) order by d.created_at desc), '[]'::jsonb)
    into result
    from (
      select * from public.webhook_deliveries
       where app_slug = a.slug
       order by created_at desc
       limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) d;
  return result;
end;
$$;

create or replace function public.send_test_webhook(p_app text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.apps := public.owned_app(p_app);
begin
  if not exists (select 1 from public.app_credentials where app_slug = a.slug and webhook_url is not null) then
    raise exception 'Set a webhook URL first' using errcode = '55000';
  end if;
  perform public.enqueue_webhook(a.slug, 'ping', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server API (callable by anon/authenticated with the app secret)
--
-- Errors: 28000 'invalid_secret' (missing/unknown secret), P0002 no match,
-- 42501 match of another app, 40001 'state_conflict', 55000 wrong match
-- status (already settled, not running), 22023 invalid input.
-- ---------------------------------------------------------------------------

create or replace function public.app_for_secret(p_secret text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_app text;
begin
  if p_secret is not null and p_secret ~ '^xas_[0-9a-f]{48}$' then
    select c.app_slug into v_app
      from public.app_credentials c
     where c.secret_hash = encode(extensions.digest(p_secret, 'sha256'), 'hex');
  end if;
  if v_app is null then
    raise exception 'invalid_secret' using errcode = '28000',
      hint = 'Send the app secret as Authorization: Bearer xas_…';
  end if;
  return v_app;
end;
$$;

create or replace function public.app_api_match(p_secret text, p_match uuid, p_lock boolean default false)
returns public.matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text := public.app_for_secret(p_secret);
  m public.matches;
begin
  if p_lock then
    select * into m from public.matches where id = p_match for update;
  else
    select * into m from public.matches where id = p_match;
  end if;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if m.app_slug <> v_app then
    raise exception 'This match belongs to another app' using errcode = '42501';
  end if;
  return m;
end;
$$;

create or replace function public.app_api_get_match(p_secret text, p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches := public.app_api_match(p_secret, p_match);
begin
  if m.status = 'voting' and m.voting_ends_at < now() then
    perform public.settle_match(p_match);
    select * into m from public.matches where id = p_match;
  elsif m.status = 'active' and m.turn_deadline < now() then
    perform public.expire_turn(p_match);
    select * into m from public.matches where id = p_match;
  end if;
  return public.app_match_json(m);
end;
$$;

-- Compare-and-set like update_match_state; returns the new version.
create or replace function public.app_api_set_state(p_secret text, p_match uuid, p_state jsonb, p_expected_version integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches := public.app_api_match(p_secret, p_match, true);
begin
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
  end if;
  if p_expected_version is null then
    raise exception 'expectedVersion is required' using errcode = '22023';
  end if;
  if p_state is not null and octet_length(p_state::text) > 65536 then
    raise exception 'Match state is too large (max 64 KB)' using errcode = '22023';
  end if;
  if p_expected_version <> m.state_version then
    raise exception 'state_conflict' using errcode = '40001',
      detail = format('expected version %s, current version %s', p_expected_version, m.state_version);
  end if;
  update public.matches
     set state = p_state, state_version = state_version + 1, updated_at = now()
   where id = p_match;
  return m.state_version + 1;
end;
$$;

-- Passes the turn (the server may pass anyone's). Default next: the next
-- seated player who hasn't left. Returns the app-view match.
create or replace function public.app_api_end_turn(p_secret text, p_match uuid, p_next uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches := public.app_api_match(p_secret, p_match, true);
  v_next uuid;
begin
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
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
    v_next := public.next_turn_user(p_match, m.turn_user);
  end if;
  update public.matches
     set turn_user = v_next,
         turn_deadline = case when v_next is not null and mode = 'async' then now() + interval '3 days' end,
         updated_at = now()
   where id = p_match
  returning * into m;
  return public.app_match_json(m);
end;
$$;

create or replace function public.app_api_set_round(p_secret text, p_match uuid, p_round integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches := public.app_api_match(p_secret, p_match, true);
begin
  if m.status <> 'active' then
    raise exception 'This match isn''t running' using errcode = '55000';
  end if;
  if p_round is null or p_round < m.round or p_round > 1000000 then
    raise exception 'Rounds only go forward' using errcode = '22023';
  end if;
  if p_round <> m.round then
    update public.matches set round = p_round, updated_at = now() where id = p_match
    returning * into m;
  end if;
  return public.app_match_json(m);
end;
$$;

-- Settles an active (or voting) match with the app server's result:
--   { "scores": { "<userId>": number, … } }   ranked by the app's scoring
--                                             (high for crowd-judged apps)
--   { "ranks":  { "<userId>": integer ≥ 1, … } } placements as given (ties
--                                             share; normalised to
--                                             competition ranking 1,1,3…)
--   optional "leavers": ["<userId>", …]      marked left, placed last
-- ranks win when both are given. Every seated player who joined must have a
-- score/rank or be a leaver; players who already left stay last; unanswered
-- invites are withdrawn (1v1: count as leavers). Reported scores become the
-- players' final scores. XP/stats as settle_match. Returns the app-view match.
create or replace function public.app_api_report_result(p_secret text, p_match uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.matches := public.app_api_match(p_secret, p_match, true);
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_map jsonb;
  v_by_rank boolean;
  v_kind text;
  v_leavers_json jsonb;
  v_leavers uuid[] := '{}';
  v_uids uuid[] := '{}';
  v_vals double precision[] := '{}';
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_uid uuid;
  v_alive integer;
begin
  if m.status = 'completed' then
    raise exception 'This match is already settled' using errcode = '55000';
  end if;
  if m.status in ('cancelled', 'declined', 'expired') then
    raise exception 'This match is over' using errcode = '55000';
  end if;
  if m.status not in ('active', 'voting') then
    raise exception 'This match hasn''t started' using errcode = '55000';
  end if;

  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'The result must be a JSON object' using errcode = '22023';
  end if;
  v_by_rank := jsonb_typeof(p_result->'ranks') is distinct from 'null' and p_result ? 'ranks';
  v_map := case when v_by_rank then p_result->'ranks' else nullif(p_result->'scores', 'null'::jsonb) end;
  v_kind := case when v_by_rank then 'rank' else 'score' end;
  if v_map is null then
    raise exception 'Report either scores or ranks' using errcode = '22023';
  end if;
  if jsonb_typeof(v_map) <> 'object' then
    raise exception '% must be an object keyed by user id', v_kind || 's' using errcode = '22023';
  end if;
  v_leavers_json := coalesce(nullif(p_result->'leavers', 'null'::jsonb), '[]'::jsonb);
  if jsonb_typeof(v_leavers_json) <> 'array' then
    raise exception 'leavers must be an array of user ids' using errcode = '22023';
  end if;

  for v_val in select value from jsonb_array_elements(v_leavers_json) loop
    if jsonb_typeof(v_val) <> 'string' or (v_val #>> '{}') !~ v_uuid_re then
      raise exception 'leavers must be an array of user ids' using errcode = '22023';
    end if;
    v_uid := (v_val #>> '{}')::uuid;
    if not exists (select 1 from public.match_players
                    where match_id = p_match and user_id = v_uid and role = 'player' and state <> 'declined') then
      raise exception '% isn''t a player in this match', v_uid using errcode = '22023';
    end if;
    if not (v_uid = any (v_leavers)) then
      v_leavers := v_leavers || v_uid;
    end if;
  end loop;

  for v_key, v_val in select key, value from jsonb_each(v_map) loop
    if v_key !~ v_uuid_re then
      raise exception '% isn''t a player in this match', v_key using errcode = '22023';
    end if;
    v_uid := v_key::uuid;
    if not exists (select 1 from public.match_players
                    where match_id = p_match and user_id = v_uid and role = 'player' and state <> 'declined') then
      raise exception '% isn''t a player in this match', v_uid using errcode = '22023';
    end if;
    if v_uid = any (v_leavers) then
      raise exception '% is listed as a leaver and has a %', v_uid, v_kind using errcode = '22023';
    end if;
    if jsonb_typeof(v_val) <> 'number' then
      raise exception 'The % for % must be a number', v_kind, v_uid using errcode = '22023';
    end if;
    v_num := (v_val #>> '{}')::numeric;
    if v_by_rank and (v_num <> trunc(v_num) or v_num < 1 or v_num > 1000) then
      raise exception 'Ranks are whole numbers from 1 (got % for %)', v_num, v_uid using errcode = '22023';
    end if;
    if not v_by_rank and abs(v_num) > 1e9 then
      raise exception 'Invalid score for %', v_uid using errcode = '22023';
    end if;
    v_uids := v_uids || v_uid;
    v_vals := v_vals || v_num::double precision;
  end loop;

  select mp.user_id into v_uid
    from public.match_players mp
   where mp.match_id = p_match and mp.role = 'player' and mp.state in ('joined', 'submitted')
     and not (mp.user_id = any (v_uids)) and not (mp.user_id = any (v_leavers))
   order by mp.seat
   limit 1;
  if found then
    raise exception 'Missing a % for %', v_kind, v_uid using errcode = '22023';
  end if;

  update public.match_players set state = 'left'
   where match_id = p_match and user_id = any (v_leavers) and role = 'player' and state not in ('left', 'declined');
  -- Unanswered invites: withdrawn (multiplayer) or count as leavers (1v1).
  if m.max_players > 2 then
    delete from public.match_players
     where match_id = p_match and role = 'player' and state = 'invited' and not (user_id = any (v_uids));
  else
    update public.match_players set state = 'left'
     where match_id = p_match and role = 'player' and state = 'invited' and not (user_id = any (v_uids));
  end if;

  if v_by_rank then
    select count(*) into v_alive
      from public.match_players
     where match_id = p_match and role = 'player' and state not in ('left', 'declined');
    update public.match_players set rank = v_alive + 1
     where match_id = p_match and role = 'player' and state = 'left';
    with g as (
      select u.uid, u.r
        from unnest(v_uids, v_vals) as u (uid, r)
        join public.match_players q on q.match_id = p_match and q.user_id = u.uid
       where q.state not in ('left', 'declined')
    )
    update public.match_players mp
       set rank = 1 + (select count(*) from g g2 where g2.r < g.r)
      from g
     where mp.match_id = p_match and mp.user_id = g.uid;
  else
    update public.match_players mp
       set score = u.s
      from unnest(v_uids, v_vals) as u (uid, s)
     where mp.match_id = p_match and mp.user_id = u.uid;
    perform public.place_players(p_match, case when m.scoring = 'votes' then 'high' else m.scoring end);
  end if;
  perform public.award_placements(p_match);

  select * into m from public.matches where id = p_match;
  return public.app_match_json(m);
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhooks: enqueue
-- ---------------------------------------------------------------------------

-- Payload: { id, type, createdAt, app: { slug }, match: <app-view match JSON
-- or null for ping>, …p_extra (userId for match.submitted, reason for
-- match.ended) }. match.state is debounced: a queued, not-yet-sent
-- match.state delivery of the same match gets the fresh payload instead.
create or replace function public.enqueue_webhook(p_app text, p_event text, p_match uuid, p_extra jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_at timestamptz := clock_timestamp();
  v_match jsonb;
  m public.matches;
begin
  if not exists (select 1 from public.app_credentials c where c.app_slug = p_app and c.webhook_url is not null) then
    return null;
  end if;
  if p_match is not null then
    select * into m from public.matches where id = p_match;
    if not found then
      return null;
    end if;
    v_match := public.app_match_json(m);
  end if;

  if p_event = 'match.state' then
    select d.id into v_id
      from public.webhook_deliveries d
     where d.match_id = p_match and d.event = 'match.state'
       and d.delivered_at is null and d.request_id is null and d.next_attempt_at is not null
     order by d.created_at desc
     limit 1
     for update;
  end if;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into public.webhook_deliveries (id, app_slug, event, match_id, payload, created_at, next_attempt_at)
    values (v_id, p_app, p_event, p_match, '{}'::jsonb, v_at, now());
  end if;
  update public.webhook_deliveries
     set payload = jsonb_build_object(
           'id', v_id, 'type', p_event, 'createdAt', v_at,
           'app', jsonb_build_object('slug', p_app), 'match', v_match
         ) || coalesce(p_extra, '{}'::jsonb)
   where id = v_id;
  return v_id;
end;
$$;

-- Deferred to commit so the payload shows the match as the transaction left
-- it (e.g. match.created with its players seated). Never blocks gameplay.
create or replace function public.matches_webhook_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_final constant text[] := array['completed', 'cancelled', 'declined', 'expired'];
  v_reason text;
begin
  if not exists (select 1 from public.app_credentials c where c.app_slug = new.app_slug and c.webhook_url is not null) then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      perform public.enqueue_webhook(new.app_slug, 'match.created', new.id);
      if new.status = 'active' then
        perform public.enqueue_webhook(new.app_slug, 'match.started', new.id);
      end if;
      return null;
    end if;
    if old.status in ('open', 'pending') and new.status = 'active' then
      perform public.enqueue_webhook(new.app_slug, 'match.started', new.id);
    end if;
    if new.state_version is distinct from old.state_version then
      perform public.enqueue_webhook(new.app_slug, 'match.state', new.id);
    end if;
    if new.turn_user is distinct from old.turn_user and new.turn_user is not null and new.status = 'active' then
      perform public.enqueue_webhook(new.app_slug, 'match.turn', new.id);
    end if;
    if new.status = any (v_final) and not (old.status = any (v_final)) then
      select m.end_reason into v_reason from public.matches m where m.id = new.id;
      perform public.enqueue_webhook(new.app_slug, 'match.ended', new.id,
        case when v_reason is not null then jsonb_build_object('reason', v_reason) end);
    end if;
  exception when others then
    raise warning 'xapps: could not enqueue a webhook for match %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create or replace function public.match_players_webhook_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app text;
begin
  select m.app_slug into v_app from public.matches m where m.id = new.match_id;
  if v_app is null then
    return null;
  end if;
  begin
    perform public.enqueue_webhook(v_app, 'match.submitted', new.match_id, jsonb_build_object('userId', new.user_id));
  exception when others then
    raise warning 'xapps: could not enqueue a webhook for match %: %', new.match_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists matches_webhooks_insert on public.matches;
create constraint trigger matches_webhooks_insert
  after insert on public.matches
  deferrable initially deferred
  for each row execute function public.matches_webhook_events();

drop trigger if exists matches_webhooks_update on public.matches;
create constraint trigger matches_webhooks_update
  after update on public.matches
  deferrable initially deferred
  for each row
  when (old.status is distinct from new.status
        or old.state_version is distinct from new.state_version
        or old.turn_user is distinct from new.turn_user)
  execute function public.matches_webhook_events();

drop trigger if exists match_players_webhooks on public.match_players;
create constraint trigger match_players_webhooks
  after update on public.match_players
  deferrable initially deferred
  for each row
  when (new.state = 'submitted' and old.state is distinct from 'submitted')
  execute function public.match_players_webhook_events();

-- ---------------------------------------------------------------------------
-- Webhooks: delivery (pg_net), scheduled every minute (pg_cron)
-- ---------------------------------------------------------------------------

-- 1. Reconciles sent deliveries with net._http_response: 2xx = delivered;
--    anything else (or no response within 10 minutes) = failed: retried
--    after 1, 2, 4 … minutes (from the send), given up after 9 attempts.
-- 2. Sends up to 100 due deliveries: POST <webhook_url> with the payload as
--    body and headers Content-Type, X-XApps-Event, X-XApps-Delivery (the
--    delivery id, stable across retries) and
--    X-XApps-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(webhook secret,
--    t || '.' || body)>. The URL and secret are read at send time.
-- Returns the number of requests sent.
create or replace function public.deliver_webhooks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_failed boolean;
  v_status integer;
  v_error text;
  v_t bigint;
  v_body text;
  v_req bigint;
  n integer := 0;
begin
  for r in
    select d.id, d.event, d.match_id, d.created_at, d.attempts, d.sent_at,
           resp.id as resp_id, resp.status_code, resp.timed_out, resp.error_msg
      from public.webhook_deliveries d
      left join net._http_response resp on resp.id = d.request_id
     where d.request_id is not null and d.delivered_at is null
     for update of d skip locked
  loop
    v_failed := false;
    v_status := r.status_code;
    v_error := null;
    if r.resp_id is null then
      continue when r.sent_at > now() - interval '10 minutes';
      v_failed := true;
      v_error := 'No response';
    elsif r.status_code between 200 and 299 then
      update public.webhook_deliveries
         set delivered_at = now(), last_status = r.status_code, last_error = null, next_attempt_at = null
       where id = r.id;
    else
      v_failed := true;
      v_error := left(coalesce(nullif(r.error_msg, ''),
                               case when r.timed_out then 'Timed out' end,
                               'HTTP ' || r.status_code), 500);
    end if;
    if v_failed then
      update public.webhook_deliveries
         set request_id = null, last_status = v_status, last_error = v_error,
             next_attempt_at = case when attempts >= 9 then null else next_attempt_at end
       where id = r.id;
      -- A newer match.state is queued: this one is stale.
      if r.event = 'match.state' and exists (
        select 1 from public.webhook_deliveries o
         where o.match_id = r.match_id and o.event = 'match.state' and o.id <> r.id
           and o.delivered_at is null and o.next_attempt_at is not null and o.created_at > r.created_at
      ) then
        update public.webhook_deliveries
           set next_attempt_at = null, last_error = v_error || ' (superseded by a newer match.state)'
         where id = r.id;
      end if;
    end if;
  end loop;

  for r in
    select d.id, d.event, d.payload, d.attempts, c.webhook_url, c.webhook_secret
      from public.webhook_deliveries d
      left join public.app_credentials c on c.app_slug = d.app_slug
     where d.delivered_at is null and d.request_id is null and d.next_attempt_at <= now()
     order by d.next_attempt_at, d.created_at
     limit 100
     for update of d skip locked
  loop
    if r.webhook_url is null or r.webhook_secret is null then
      update public.webhook_deliveries set next_attempt_at = null, last_error = 'Webhook removed' where id = r.id;
      continue;
    end if;
    v_t := floor(extract(epoch from now()))::bigint;
    v_body := r.payload::text;
    v_req := net.http_post(
      url := r.webhook_url,
      body := r.payload,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'User-Agent', 'XApps-Webhooks/1',
        'X-XApps-Event', r.event,
        'X-XApps-Delivery', r.id::text,
        'X-XApps-Signature', 't=' || v_t || ',v1='
          || encode(extensions.hmac(v_t::text || '.' || v_body, r.webhook_secret, 'sha256'), 'hex')
      ),
      timeout_milliseconds := 5000
    );
    update public.webhook_deliveries
       set request_id = v_req, attempts = attempts + 1, sent_at = now(),
           next_attempt_at = now() + make_interval(mins => power(2, least(attempts, 8))::integer)
     where id = r.id;
    n := n + 1;
  end loop;

  -- Keep two weeks of history.
  delete from public.webhook_deliveries
   where created_at < now() - interval '14 days' and (delivered_at is not null or next_attempt_at is null);
  return n;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'cron' and p.proname = 'schedule') then
    raise notice 'pg_cron is not available: run public.deliver_webhooks() every minute and public.finalize_due_matches() regularly';
    return;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'cron' and c.relname = 'job') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname in (''xapps-webhooks'', ''xapps-finalize'')';
  end if;
  execute $cmd$select cron.schedule('xapps-webhooks', '* * * * *', 'select public.deliver_webhooks()')$cmd$;
  execute $cmd$select cron.schedule('xapps-finalize', '*/5 * * * *', 'select public.finalize_due_matches()')$cmd$;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.apps_guard_authority() from public, anon, authenticated;
revoke execute on function public.matches_set_authority() from public, anon, authenticated;
revoke execute on function public.app_match_json(public.matches) from public, anon, authenticated;
revoke execute on function public.place_players(uuid, text) from public, anon, authenticated;
revoke execute on function public.award_placements(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.settle_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.settle_server_timeout(uuid) from public, anon, authenticated;
revoke execute on function public.maybe_settle(uuid) from public, anon, authenticated;
revoke execute on function public.finalize_due_matches() from public, anon, authenticated;
revoke execute on function public.owned_app(text) from public, anon, authenticated;
revoke execute on function public.new_secret(text) from public, anon, authenticated;
revoke execute on function public.app_for_secret(text) from public, anon, authenticated;
revoke execute on function public.app_api_match(text, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.enqueue_webhook(text, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.matches_webhook_events() from public, anon, authenticated;
revoke execute on function public.match_players_webhook_events() from public, anon, authenticated;
revoke execute on function public.deliver_webhooks() from public, anon, authenticated;
grant execute on function public.deliver_webhooks() to service_role;

revoke execute on function public.get_app_server_config(text) from public, anon;
revoke execute on function public.rotate_app_secret(text) from public, anon;
revoke execute on function public.set_app_webhook(text, text) from public, anon;
revoke execute on function public.rotate_webhook_secret(text) from public, anon;
revoke execute on function public.set_app_authority(text, text) from public, anon;
revoke execute on function public.list_webhook_deliveries(text, integer) from public, anon;
revoke execute on function public.send_test_webhook(text) from public, anon;
grant execute on function public.get_app_server_config(text) to authenticated;
grant execute on function public.rotate_app_secret(text) to authenticated;
grant execute on function public.set_app_webhook(text, text) to authenticated;
grant execute on function public.rotate_webhook_secret(text) to authenticated;
grant execute on function public.set_app_authority(text, text) to authenticated;
grant execute on function public.list_webhook_deliveries(text, integer) to authenticated;
grant execute on function public.send_test_webhook(text) to authenticated;

grant execute on function public.app_api_get_match(text, uuid) to anon, authenticated;
grant execute on function public.app_api_set_state(text, uuid, jsonb, integer) to anon, authenticated;
grant execute on function public.app_api_end_turn(text, uuid, uuid) to anon, authenticated;
grant execute on function public.app_api_set_round(text, uuid, integer) to anon, authenticated;
grant execute on function public.app_api_report_result(text, uuid, jsonb) to anon, authenticated;
