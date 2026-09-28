-- Settlement no longer ranks multiplayer invitees who never accepted: their
-- invites are withdrawn when the match settles.

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

  -- Multiplayer invites nobody answered are withdrawn, not ranked: people who
  -- never played shouldn't collect a placement (1v1 keeps its v1 behavior).
  if m.max_players > 2 then
    delete from public.match_players
     where match_id = p_match and role = 'player' and state = 'invited';
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

revoke execute on function public.settle_match(uuid, uuid) from public, anon, authenticated;
