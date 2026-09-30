-- =============================================================================
-- Dead lobbies expire.
--
-- A quick-match lobby nobody else joined within 10 minutes, and any live table
-- or invite that hasn't started within 2 hours, is expired. It runs when a
-- player lists their matches or presses Quick match (so it works without
-- pg_cron), and every 5 minutes for everyone when pg_cron is available.
-- Before this, a new Quick match press after 10 minutes left the old empty
-- lobby sitting in "Waiting" for 7 days. Mirrors expireIdleLobbies in the
-- demo backend. Safe to re-run.
-- =============================================================================

-- p_user: only that player's lobbies (null: everyone's). Returns how many expired.
create or replace function public.expire_idle_lobbies(p_user uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.matches m
     set status = 'expired', updated_at = now()
   where m.status in ('open', 'pending')
     and (p_user is null or exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = p_user))
     and (
       (m.is_quick and m.status = 'open' and m.created_at < now() - interval '10 minutes'
        and (select count(*) from public.match_players mp
              where mp.match_id = m.id and mp.role = 'player' and mp.state = 'joined') < 2)
       or (m.mode = 'live' and m.created_at < now() - interval '2 hours')
     );
  get diagnostics n = row_count;
  return n;
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
  perform public.expire_idle_lobbies(v_me);
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

create or replace function public.quick_match(p_app text, p_version uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.play_app(p_app, p_version);
  v_id uuid;
begin
  -- My dead lobbies go first, so a new press doesn't stack another one on top.
  perform public.expire_idle_lobbies(v_me);
  -- Already waiting in a lobby with company.
  select m.id into v_id
    from public.matches m
    join public.match_players mp on mp.match_id = m.id and mp.user_id = v_me and mp.role = 'player'
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick
     and m.version_id is not distinct from p_version
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
     and m.version_id is not distinct from p_version
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
       and m.version_id is not distinct from p_version
       and (select count(*) from public.match_players mp where mp.match_id = m.id and mp.role = 'player') < 2;
    perform public.seat_player(v_id, v_me);
    perform public.try_activate(v_id);
    update public.matches set updated_at = now() where id = v_id;
    return v_id;
  end if;

  select m.id into v_id
    from public.matches m
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick and m.created_by = v_me
     and m.version_id is not distinct from p_version
     and m.created_at > now() - interval '10 minutes'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.matches
    (app_slug, mode, status, scoring, created_by, is_open, is_quick, votes_needed,
     min_players, max_players, team_count, version_id)
  values (a.slug, case when 'live' = any (a.modes) then 'live' else 'async' end, 'open', a.scoring, v_me,
          true, true, a.votes_to_win,
          least(a.max_players, greatest(a.min_players, a.team_count)), a.max_players, a.team_count, p_version)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, team, state)
  values (v_id, v_me, 0, case when a.team_count > 0 then 0 end, 'joined');
  return v_id;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'cron' and p.proname = 'schedule') then
    raise notice 'pg_cron is not available: dead lobbies expire when players load their matches';
    return;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'cron' and c.relname = 'job') then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''xapps-lobbies''';
  end if;
  execute $cmd$select cron.schedule('xapps-lobbies', '*/5 * * * *', 'select public.expire_idle_lobbies()')$cmd$;
end $$;

revoke execute on function public.expire_idle_lobbies(uuid) from public, anon, authenticated;
