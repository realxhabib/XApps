-- =============================================================================
-- XApps core schema
--
-- Design notes
--  * Clients never write match tables directly. Every state change goes
--    through a SECURITY DEFINER function that validates the caller, so the
--    rules (who can submit, when a match settles, how XP is awarded) live in
--    one place and can't be bypassed from the browser.
--  * Contest entries live in `submissions`, readable by the author only until
--    the match reaches voting — opponents can't peek at your caption.
--  * Realtime rooms are private channels named `match:<uuid>`; only players
--    of that match may join them (see realtime.messages policies at the end).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key,
  handle text not null check (handle ~ '^[a-z0-9_]{1,15}$'),
  name text not null default '',
  avatar_url text,
  bio text not null default '' check (char_length(bio) <= 160),
  x_user_id text,
  is_bot boolean not null default false,
  is_admin boolean not null default false,
  xp integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  streak integer not null default 0,
  best_streak integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_handle_key on public.profiles (handle);
create index profiles_xp_idx on public.profiles (xp desc);

comment on table public.profiles is 'Public player profiles, created from X sign-in metadata.';

-- The practice bot every practice match is played against.
insert into public.profiles (id, handle, name, bio, is_bot)
values ('00000000-0000-4000-8000-00000000b075', 'xapps_bot', 'XApps Bot',
        'I practice so you don''t have to lose in public.', true);

-- Create a profile whenever someone signs in with X for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  base text;
  candidate text;
  n integer := 0;
begin
  base := lower(regexp_replace(
    coalesce(meta->>'user_name', meta->>'preferred_username', meta->>'screen_name',
             split_part(coalesce(new.email, ''), '@', 1), ''),
    '[^a-zA-Z0-9_]', '', 'g'));
  if base = '' then
    base := 'player';
  end if;
  candidate := left(base, 15);
  while exists (select 1 from public.profiles where handle = candidate) loop
    n := n + 1;
    candidate := left(base, 15 - char_length(n::text)) || n::text;
  end loop;

  insert into public.profiles (id, handle, name, avatar_url, x_user_id)
  values (
    new.id,
    candidate,
    left(coalesce(nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), candidate), 50),
    replace(coalesce(meta->>'avatar_url', meta->>'picture'), '_normal.', '_400x400.'),
    coalesce(meta->>'provider_id', meta->>'sub')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep name/avatar fresh when X metadata changes on later sign-ins.
create or replace function public.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  update public.profiles p
     set name = left(coalesce(nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), p.name), 50),
         avatar_url = coalesce(replace(coalesce(meta->>'avatar_url', meta->>'picture'), '_normal.', '_400x400.'), p.avatar_url),
         updated_at = now()
   where p.id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update of raw_user_meta_data on auth.users
  for each row execute function public.handle_user_updated();

create or replace function public.handle_user_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.profiles where id = old.id;
  return old;
end;
$$;

create trigger on_auth_user_deleted
  after delete on auth.users
  for each row execute function public.handle_user_deleted();

-- ---------------------------------------------------------------------------
-- Apps
-- ---------------------------------------------------------------------------

create table public.apps (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name text not null check (char_length(name) between 2 and 40),
  tagline text not null default '' check (char_length(tagline) <= 90),
  description text not null default '' check (char_length(description) <= 1200),
  category text not null check (category in ('games', 'contests', 'debates', 'trivia', 'creative', 'social')),
  icon text not null default '✨' check (char_length(icon) between 1 and 16),
  accent_from text not null default '#5b74ff' check (accent_from ~ '^#[0-9a-fA-F]{6}$'),
  accent_to text not null default '#a35cff' check (accent_to ~ '^#[0-9a-fA-F]{6}$'),
  url text not null,
  modes text[] not null default '{live,practice}'
    check (modes <@ array['live', 'async', 'practice']::text[] and cardinality(modes) > 0),
  min_players integer not null default 2 check (min_players between 2 and 8),
  max_players integer not null default 2 check (max_players between 2 and 8),
  scoring text not null default 'high' check (scoring in ('high', 'low', 'votes')),
  votes_to_win integer not null default 5 check (votes_to_win between 1 and 101),
  duration_label text not null default '' check (char_length(duration_label) <= 30),
  how_to text[] not null default '{}' check (cardinality(how_to) <= 6),
  tags text[] not null default '{}' check (cardinality(tags) <= 8),
  official boolean not null default false,
  developer_id uuid references public.profiles (id) on delete set null,
  status text not null default 'pending' check (status in ('published', 'pending', 'rejected')),
  play_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Community apps must be served over https from their own origin.
  constraint apps_url_check check (official or url ~ '^https://[^/\s]+(/\S*)?$')
);
create index apps_status_idx on public.apps (status);
create index apps_developer_idx on public.apps (developer_id);

-- Submissions from the developer portal always start as pending review, and
-- edits send an app back to review. Runs with the caller's rights so it only
-- applies to direct client writes (role `authenticated`); internal functions
-- such as settle_match run as the table owner and pass through untouched.
create or replace function public.apps_enforce_owner_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  select p.is_admin into v_admin from public.profiles p where p.id = auth.uid();
  if coalesce(v_admin, false) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.developer_id := auth.uid();
    new.play_count := 0;
    new.created_at := now();
  else
    new.developer_id := old.developer_id;
    new.play_count := old.play_count;
    new.slug := old.slug;
  end if;
  new.official := false;
  new.status := 'pending';
  new.updated_at := now();
  return new;
end;
$$;

create trigger apps_enforce_owner_fields
  before insert or update on public.apps
  for each row execute function public.apps_enforce_owner_fields();

insert into public.apps
  (slug, name, tagline, category, icon, accent_from, accent_to, url, modes, scoring, votes_to_win, official, status)
values
  ('meme-duel', 'Meme Duel', 'Same template. Two captions. The crowd decides.', 'contests', '🖼️', '#ff5ca8', '#8b5cff',
   '/embed/meme-duel', '{async,live,practice}', 'votes', 5, true, 'published'),
  ('quick-draw', 'Quick Draw', 'Wait for it… wait for it… DRAW.', 'games', '⚡', '#ffe14d', '#ff7a1a',
   '/embed/quick-draw', '{live,practice}', 'high', 5, true, 'published'),
  ('hot-takes', 'Hot Takes', 'Pick a side. Make your case. Get ratioed or crowned.', 'debates', '🔥', '#ff9a3d', '#ff3d6e',
   '/embed/hot-takes', '{async,live,practice}', 'votes', 5, true, 'published'),
  ('four-in-a-row', 'Four in a Row', 'Drop, stack, connect. Classic strategy, zero lag.', 'games', '🔴', '#3d7bff', '#35e0ff',
   '/embed/four-in-a-row', '{live,practice}', 'high', 5, true, 'published'),
  ('emoji-decode', 'Emoji Decode', '🧠 + ⚡ = you, probably. Race to decode.', 'trivia', '🧩', '#b6ff3d', '#1fd1b2',
   '/embed/emoji-decode', '{live,async,practice}', 'high', 5, true, 'published'),
  ('rps-showdown', 'RPS Showdown', 'Rock, paper, scissors — best of three, no mercy.', 'games', '✊', '#9aa4ff', '#5b6bff',
   '/examples/rps/index.html', '{live,practice}', 'high', 5, true, 'published');

-- ---------------------------------------------------------------------------
-- Matches
-- ---------------------------------------------------------------------------

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  app_slug text not null references public.apps (slug) on delete cascade,
  mode text not null check (mode in ('live', 'async', 'practice')),
  status text not null check (status in ('open', 'pending', 'active', 'voting', 'completed', 'cancelled', 'declined', 'expired')),
  scoring text not null check (scoring in ('high', 'low', 'votes')),
  seed text not null default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  winner_id uuid references public.profiles (id) on delete set null,
  is_open boolean not null default false,
  is_quick boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  votes jsonb not null default '{}'::jsonb,
  votes_needed integer not null default 5,
  voting_ends_at timestamptz,
  simulated_votes boolean not null default false
);
create index matches_status_idx on public.matches (status, updated_at desc);
create index matches_quick_idx on public.matches (app_slug, created_at) where status = 'open' and is_quick;
create index matches_created_by_idx on public.matches (created_by);

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat integer not null check (seat between 0 and 7),
  state text not null check (state in ('invited', 'joined', 'submitted', 'declined', 'left')),
  is_bot boolean not null default false,
  score double precision,
  result text check (result in ('win', 'loss', 'draw')),
  xp_delta integer not null default 0,
  last_seen_at timestamptz,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, seat)
);
create index match_players_user_idx on public.match_players (user_id);

-- Entries are stored apart from match_players so opponents can't read them early.
create table public.submissions (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  data jsonb,
  display jsonb,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id),
  check (octet_length(coalesce(data::text, '')) + octet_length(coalesce(display::text, '')) <= 65536)
);

create table public.votes (
  match_id uuid not null references public.matches (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete cascade,
  choice_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (match_id, voter_id)
);
create index votes_voter_idx on public.votes (voter_id);

create table public.app_player_stats (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  played integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  xp integer not null default 0,
  primary key (app_slug, user_id)
);
create index app_player_stats_rank_idx on public.app_player_stats (app_slug, xp desc);

create table public.app_storage (
  app_slug text not null references public.apps (slug) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 64),
  value jsonb not null check (octet_length(value::text) <= 16384),
  updated_at timestamptz not null default now(),
  primary key (app_slug, user_id, key)
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.apps enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.submissions enable row level security;
alter table public.votes enable row level security;
alter table public.app_player_stats enable row level security;
alter table public.app_storage enable row level security;

create or replace function public.is_match_player(p_match uuid, p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.match_players mp where mp.match_id = p_match and mp.user_id = p_user
  );
$$;

create policy "profiles are public" on public.profiles
  for select using (true);
create policy "players edit their own bio" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (bio) on public.profiles to authenticated;

create policy "published apps are public" on public.apps
  for select using (status = 'published' or developer_id = auth.uid());
create policy "developers submit apps" on public.apps
  for insert to authenticated with check (auth.uid() is not null);
create policy "developers edit their apps" on public.apps
  for update to authenticated using (developer_id = auth.uid() and not official)
  with check (developer_id = auth.uid());
create policy "developers delete their apps" on public.apps
  for delete to authenticated using (developer_id = auth.uid() and not official);

create policy "matches are visible except other people's practice" on public.matches
  for select using (mode <> 'practice' or created_by = auth.uid());

create policy "match players follow match visibility" on public.match_players
  for select using (
    exists (
      select 1 from public.matches m
       where m.id = match_id and (m.mode <> 'practice' or m.created_by = auth.uid())
    )
  );

create policy "entries are private until voting" on public.submissions
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.matches m
       where m.id = match_id
         and (
           (m.status in ('voting', 'completed') and m.mode <> 'practice')
           or (m.mode = 'practice' and m.created_by = auth.uid())
         )
    )
  );

create policy "voters see their own votes" on public.votes
  for select to authenticated using (voter_id = auth.uid());

create policy "stats are public" on public.app_player_stats
  for select using (true);

create policy "players manage their own app storage" on public.app_storage
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- JSON shapes returned to the client (camelCase, mirrors src/platform/types.ts)
-- ---------------------------------------------------------------------------

create or replace function public.profile_json(p public.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'name', p.name, 'avatarUrl', p.avatar_url, 'bio', p.bio,
    'xp', p.xp, 'wins', p.wins, 'losses', p.losses, 'draws', p.draws,
    'streak', p.streak, 'bestStreak', p.best_streak, 'createdAt', p.created_at, 'isBot', p.is_bot
  );
$$;

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
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', mp.user_id, 'seat', mp.seat, 'state', mp.state, 'isBot', mp.is_bot,
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
      ) order by mp.seat)
      from public.match_players mp
      join public.profiles p on p.id = mp.user_id
      left join public.submissions s on s.match_id = mp.match_id and s.user_id = mp.user_id
      where mp.match_id = m.id
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------

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
  v_best double precision;
  v_leaders integer;
  v_result text;
  v_xp integer;
  v_ranked boolean;
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status in ('completed', 'cancelled', 'declined', 'expired') then
    return;
  end if;

  if p_forfeit_by is not null then
    select mp.user_id into v_winner
      from public.match_players mp
     where mp.match_id = p_match and mp.user_id <> p_forfeit_by
     order by mp.seat
     limit 1;
  elsif m.scoring = 'votes' then
    select max(coalesce((m.votes ->> mp.user_id::text)::integer, 0)) into v_best
      from public.match_players mp where mp.match_id = p_match;
    select count(*) into v_leaders
      from public.match_players mp
     where mp.match_id = p_match and coalesce((m.votes ->> mp.user_id::text)::integer, 0) = v_best;
    if v_leaders = 1 then
      select mp.user_id into v_winner
        from public.match_players mp
       where mp.match_id = p_match and coalesce((m.votes ->> mp.user_id::text)::integer, 0) = v_best;
    end if;
  else
    if m.scoring = 'high' then
      select max(mp.score) into v_best from public.match_players mp where mp.match_id = p_match and mp.score is not null;
    else
      select min(mp.score) into v_best from public.match_players mp where mp.match_id = p_match and mp.score is not null;
    end if;
    if v_best is not null then
      select count(*) into v_leaders from public.match_players mp where mp.match_id = p_match and mp.score = v_best;
      if v_leaders = 1 then
        select mp.user_id into v_winner from public.match_players mp where mp.match_id = p_match and mp.score = v_best;
      end if;
    end if;
  end if;

  update public.matches
     set status = 'completed', winner_id = v_winner, ended_at = now(), updated_at = now()
   where id = p_match;
  update public.apps set play_count = play_count + 1 where slug = m.app_slug;

  v_ranked := m.mode <> 'practice';
  for r in select * from public.match_players where match_id = p_match loop
    v_result := case when v_winner is null then 'draw' when r.user_id = v_winner then 'win' else 'loss' end;
    v_xp := case
      when r.is_bot then 0
      when not v_ranked then 3
      when v_result = 'win' then 30
      when v_result = 'draw' then 15
      else 8
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

-- Crowd voting closes after its deadline even if nobody reached the target.
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
  -- Stale lobbies and invites expire quietly.
  update public.matches set status = 'expired', updated_at = now()
   where status in ('open', 'pending') and created_at < now() - interval '7 days';
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Match lifecycle RPCs
-- ---------------------------------------------------------------------------

create or replace function public.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to play' using errcode = '28000';
  end if;
  return auth.uid();
end;
$$;

create or replace function public.playable_app(p_app text)
returns public.apps
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.apps;
begin
  select * into a from public.apps where slug = p_app;
  if not found or (a.status <> 'published' and a.developer_id is distinct from auth.uid()) then
    raise exception 'App not found' using errcode = 'P0002';
  end if;
  return a;
end;
$$;

create or replace function public.create_challenge(p_app text, p_mode text, p_opponent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  a public.apps := public.playable_app(p_app);
  v_handle text := lower(ltrim(btrim(coalesce(p_opponent, '')), '@'));
  v_opp uuid;
  v_id uuid;
begin
  if p_mode not in ('live', 'async') or not (p_mode = any (a.modes)) then
    raise exception '% doesn''t support % play', a.name, p_mode using errcode = '22023';
  end if;
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

  insert into public.matches (app_slug, mode, status, scoring, created_by, is_open, votes_needed)
  values (a.slug, p_mode, case when v_opp is null then 'open' else 'pending' end, a.scoring, v_me,
          v_opp is null, a.votes_to_win)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_me, 0, 'joined');
  if v_opp is not null then
    insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_opp, 1, 'invited');
  end if;
  return v_id;
end;
$$;

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
  select m.id into v_id
    from public.matches m
   where m.app_slug = a.slug and m.status = 'open' and m.is_quick
     and m.created_by <> v_me and m.created_at > now() - interval '10 minutes'
   order by m.created_at
   limit 1
   for update skip locked;
  if v_id is not null then
    insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_me, 1, 'joined');
    update public.matches set status = 'active', is_open = false, updated_at = now() where id = v_id;
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

  insert into public.matches (app_slug, mode, status, scoring, created_by, is_open, is_quick, votes_needed)
  values (a.slug, case when 'live' = any (a.modes) then 'live' else 'async' end, 'open', a.scoring, v_me,
          true, true, a.votes_to_win)
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_me, 0, 'joined');
  return v_id;
end;
$$;

create or replace function public.start_practice(p_app text)
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
  if (select count(*) from public.matches where created_by = v_me and mode = 'practice'
        and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Take a breather — practice limit reached' using errcode = '54000';
  end if;
  insert into public.matches (app_slug, mode, status, scoring, created_by, votes_needed, simulated_votes)
  values (a.slug, 'practice', 'active', a.scoring, v_me, 5, a.scoring = 'votes')
  returning id into v_id;
  insert into public.match_players (match_id, user_id, seat, state) values (v_id, v_me, 0, 'joined');
  insert into public.match_players (match_id, user_id, seat, state, is_bot)
  values (v_id, '00000000-0000-4000-8000-00000000b075', 1, 'joined', true);
  return v_id;
end;
$$;

create or replace function public.join_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
  m public.matches;
  v_state text;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  select state into v_state from public.match_players where match_id = p_match and user_id = v_me;
  if v_state is not null then
    if v_state = 'invited' then
      update public.match_players set state = 'joined', joined_at = now()
       where match_id = p_match and user_id = v_me;
    end if;
  elsif m.is_open and m.status = 'open'
        and (select count(*) from public.match_players where match_id = p_match) < 2 then
    insert into public.match_players (match_id, user_id, seat, state) values (p_match, v_me, 1, 'joined');
    update public.matches set is_open = false where id = p_match;
  else
    raise exception 'This challenge is no longer open' using errcode = '55000';
  end if;

  if m.status in ('open', 'pending')
     and (select count(*) from public.match_players where match_id = p_match) >= 2
     and not exists (select 1 from public.match_players where match_id = p_match and state = 'invited') then
    update public.matches set status = 'active', updated_at = now() where id = p_match;
  else
    update public.matches set updated_at = now() where id = p_match;
  end if;
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
begin
  update public.match_players set state = 'declined'
   where match_id = p_match and user_id = v_me and state = 'invited';
  if not found then
    raise exception 'Nothing to decline' using errcode = '22023';
  end if;
  update public.matches set status = 'declined', updated_at = now() where id = p_match;
end;
$$;

create or replace function public.cancel_match(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
begin
  update public.matches set status = 'cancelled', updated_at = now()
   where id = p_match and created_by = v_me and status in ('open', 'pending');
  if not found then
    raise exception 'Only the challenger can cancel before it starts' using errcode = '55000';
  end if;
end;
$$;

create or replace function public.mark_started(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.require_user();
begin
  if not public.is_match_player(p_match, v_me) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  update public.matches set started_at = coalesce(started_at, now())
   where id = p_match and started_at is null;
end;
$$;

create or replace function public.heartbeat(p_match uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.match_players set last_seen_at = now()
   where match_id = p_match and user_id = auth.uid();
$$;

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
begin
  select * into m from public.matches where id = p_match for update;
  if not found or m.status <> 'active' or m.started_at is null then
    raise exception 'Match isn''t running' using errcode = '55000';
  end if;
  if not public.is_match_player(p_match, v_me) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  select * into v_opp from public.match_players
   where match_id = p_match and user_id <> v_me and not is_bot and state <> 'submitted'
   limit 1;
  if v_opp.user_id is null then
    raise exception 'No opponent to claim against' using errcode = '22023';
  end if;
  if coalesce(v_opp.last_seen_at, m.started_at) > now() - interval '45 seconds' then
    raise exception 'Your opponent is still connected' using errcode = '55000';
  end if;
  perform public.settle_match(p_match, v_opp.user_id);
end;
$$;

create or replace function public.forfeit_match(p_match uuid)
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
  if not found or m.status not in ('active', 'pending', 'open') then
    raise exception 'Match already over' using errcode = '55000';
  end if;
  if not public.is_match_player(p_match, v_me) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  if (select count(*) from public.match_players where match_id = p_match) < 2 then
    update public.matches set status = 'cancelled', updated_at = now() where id = p_match;
    return;
  end if;
  perform public.settle_match(p_match, v_me);
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
  t public.match_players;
  v_everyone boolean;
  v_winner uuid;
  v_loser uuid;
begin
  select * into m from public.matches where id = p_match for update;
  if not found then
    raise exception 'Match not found' using errcode = 'P0002';
  end if;
  if not public.is_match_player(p_match, v_me) then
    raise exception 'Not in this match' using errcode = '42501';
  end if;
  select * into t from public.match_players where match_id = p_match and user_id = v_target;
  if t.user_id is null then
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

  select count(*) >= 2 and bool_and(state = 'submitted') into v_everyone
    from public.match_players where match_id = p_match;

  if not v_everyone then
    update public.matches set updated_at = now() where id = p_match;
    return;
  end if;

  if m.scoring = 'votes' then
    if m.mode = 'practice' then
      -- A simulated crowd judges practice contests instantly.
      select user_id into v_winner from public.match_players where match_id = p_match order by random() limit 1;
      select user_id into v_loser from public.match_players where match_id = p_match and user_id <> v_winner limit 1;
      update public.matches
         set votes = jsonb_build_object(v_winner::text, m.votes_needed, v_loser::text, floor(random() * m.votes_needed)::integer),
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
end;
$$;

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
  if public.is_match_player(p_match, v_me) then
    raise exception 'You can''t judge your own match' using errcode = '42501';
  end if;
  if not public.is_match_player(p_match, p_choice) then
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
  end if;
  if m.mode = 'practice' and m.created_by is distinct from auth.uid() then
    return null;
  end if;
  return public.match_json(m, auth.uid());
end;
$$;

create or replace function public.list_my_matches()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.match_json(m, auth.uid()) order by m.updated_at desc), '[]'::jsonb)
    from (
      select m.* from public.matches m
       where exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = auth.uid())
       order by m.updated_at desc
       limit 60
    ) m;
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
         and (v_me is null or not exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = v_me))
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
         and (select count(*) from public.match_players mp where mp.match_id = m.id) >= 2
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
         and exists (select 1 from public.match_players mp where mp.match_id = m.id and mp.user_id = p_user)
       order by m.updated_at desc
       limit 20
    ) m;
$$;

create or replace function public.leaderboard(p_app text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select p.id,
           coalesce(s.wins, p.wins) as r_wins,
           coalesce(s.played, p.wins + p.losses + p.draws) as r_played,
           coalesce(s.xp, p.xp) as r_xp
      from public.profiles p
      left join public.app_player_stats s on s.user_id = p.id and s.app_slug = p_app
     where not p.is_bot
       and (case when p_app is null then p.xp > 0 else s.user_id is not null end)
     order by coalesce(s.xp, p.xp) desc, coalesce(s.wins, p.wins) desc
     limit 50
  ),
  numbered as (
    select r.*, row_number() over (order by r.r_xp desc, r.r_wins desc) as rank from ranked r
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('rank', n.rank, 'profile', public.profile_json(p),
                                'wins', n.r_wins, 'played', n.r_played, 'xp', n.r_xp)
             order by n.rank),
           '[]'::jsonb)
    from numbered n
    join public.profiles p on p.id = n.id;
$$;

-- Internal helpers are not part of the public API.
revoke execute on function public.match_json(public.matches, uuid) from public, anon, authenticated;
revoke execute on function public.settle_match(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.finalize_due_matches() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_updated() from public, anon, authenticated;
revoke execute on function public.handle_user_deleted() from public, anon, authenticated;
revoke execute on function public.apps_enforce_owner_fields() from public, anon, authenticated;
revoke execute on function public.playable_app(text) from public, anon;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Row changes power match/inbox refreshes in the client.
alter publication supabase_realtime add table public.matches, public.match_players;

-- Private broadcast + presence channels: only the players of a match may join
-- `match:<id>`.
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
  return public.is_match_player(v_id, auth.uid());
end;
$$;

create policy "players read their match room" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension in ('broadcast', 'presence') and public.is_room_member((select realtime.topic())));

create policy "players write to their match room" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension in ('broadcast', 'presence') and public.is_room_member((select realtime.topic())));
