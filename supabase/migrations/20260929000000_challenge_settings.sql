-- Challenge setup: the challenger can shape the round (a Meme Duel template,
-- an image they dropped, a topic…). Apps read it as `match.settings`.

drop function if exists public.create_challenge(text, text, text);

create or replace function public.create_challenge(
  p_app text,
  p_mode text,
  p_opponent text default null,
  p_settings jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
  v_handle text := lower(ltrim(btrim(coalesce(p_opponent, '')), '@'));
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_opp uuid;
  v_id uuid;
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
  if v_handle <> '' then
    select id into v_opp from public.profiles where handle = v_handle and not is_bot;
    if v_opp is null then
      raise exception '@% hasn''t joined XApps yet', v_handle using errcode = 'P0002';
    end if;
    if v_opp = v_me then
      raise exception 'You can''t challenge yourself' using errcode = '22023';
    end if;
  end if;
  if (select count(*) from public.matches
       where created_by = v_me and status in ('open', 'pending')
         and created_at > now() - interval '1 day') >= 30 then
    raise exception 'Too many open challenges — finish a few first' using errcode = '54000';
  end if;

  insert into public.matches (app_slug, mode, status, scoring, created_by, is_open, votes_needed, settings)
  values (a.slug, p_mode, case when v_opp is null then 'open' else 'pending' end, a.scoring, v_me,
          v_opp is null, a.votes_to_win, v_settings)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_me, 0, 'joined');
  if v_opp is not null then
    insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_opp, 1, 'invited');
  end if;
  return v_id;
end;
$$;

-- Images people drop into Meme Duel. Public to read (entries are shown to the
-- crowd); each person uploads only into their own folder: <user id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meme-drops', 'meme-drops', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "meme drops: upload into own folder" on storage.objects;
create policy "meme drops: upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'meme-drops' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- "Quick Draw" is now "Reflexes".
update public.apps set name = 'Reflexes', tagline = 'Wait for it… wait for it… GO.' where slug = 'quick-draw';
