-- =============================================================================
-- Stat standings: an app reads a stat's global leaderboard and the viewer's
-- own place on it (SDK `xapps.stats.leaderboard(key, { limit })`), so a solo
-- game can say "you're #14 of 2,380 · top 1%".
--
--  * app_stat_standing(p_app, p_key, p_limit default 10) returns
--    { key, top, me, total }:
--      top   = app_stat_leaderboard(p_app, p_key, limit): [{ rank, profile, value }]
--              best first (min stats ascending, others descending), equal
--              values share a rank (1, 2, 2, 4); limit clamped to 1–50.
--      me    = { rank, value } for the signed-in viewer, ranked exactly like
--              the board (1 + how many people have a strictly better value),
--              or null when they have no value (or are signed out).
--      total = how many people have a value (bots excluded, like the board).
--    Resolves the app like app_stat_leaderboard (playable_app: published, or
--    the developer's own), so unknown apps raise P0002 and undeclared stats
--    22023. Read-only; granted to anon and authenticated.
-- Mirrors the demo backend (statStanding). Safe to re-run.
-- =============================================================================

create or replace function public.app_stat_standing(p_app text, p_key text, p_limit integer default 10)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps := public.playable_app(p_app);
  v_agg text;
  v_me uuid := auth.uid();
  v_value double precision;
  v_rank integer;
  v_total integer;
begin
  select e->>'aggregate' into v_agg from jsonb_array_elements(a.stats) e where e->>'key' = p_key;
  if v_agg is null then
    raise exception 'Unknown stat %', p_key using errcode = '22023';
  end if;

  select count(*) into v_total
    from public.app_user_stats s
    join public.profiles p on p.id = s.user_id
   where s.app_slug = a.slug and s.key = p_key and not p.is_bot;

  if v_me is not null then
    select s.value into v_value
      from public.app_user_stats s
      join public.profiles p on p.id = s.user_id
     where s.app_slug = a.slug and s.key = p_key and s.user_id = v_me and not p.is_bot;
    if found then
      -- rank() over the board: 1 + everyone strictly ahead.
      select 1 + count(*) into v_rank
        from public.app_user_stats s
        join public.profiles p on p.id = s.user_id
       where s.app_slug = a.slug and s.key = p_key and not p.is_bot
         and case when v_agg = 'min' then s.value < v_value else s.value > v_value end;
    end if;
  end if;

  return jsonb_build_object(
    'key', p_key,
    'top', public.app_stat_leaderboard(p_app, p_key, least(greatest(coalesce(p_limit, 10), 1), 50)),
    'me', case when v_rank is null then null else jsonb_build_object('rank', v_rank, 'value', v_value) end,
    'total', v_total
  );
end;
$$;

revoke execute on function public.app_stat_standing(text, text, integer) from public;
grant execute on function public.app_stat_standing(text, text, integer) to anon, authenticated;
