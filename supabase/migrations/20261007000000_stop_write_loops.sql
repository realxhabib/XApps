-- =============================================================================
-- Stop state-write loops.
--
-- update_match_state reported a match that isn't running (finished, expired,
-- cancelled) with errcode 55000, which clients map to "conflict": the SDK
-- re-reads and retries, and Frontline retried after that, so a tab left open
-- on a finished match sent writes non-stop (tens of millions of requests, the
-- database CPU pinned at 100%). It now answers 42501, which clients never retry
-- (old builds included). Live and practice matches nobody has touched for 2
-- hours are expired, so tabs still writing to them stop too. Safe to re-run.
-- =============================================================================

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
    -- Final, so not 55000: clients map that to "conflict" and re-read and retry, and a tab
    -- left open on a finished match retried this write in a loop for days.
    raise exception 'This match isn''t running' using errcode = '42501';
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

-- Abandoned live and practice matches (async ones legitimately wait for days).
update public.matches
   set status = 'expired', updated_at = now()
 where status = 'active'
   and mode in ('live', 'practice')
   and updated_at < now() - interval '2 hours';
