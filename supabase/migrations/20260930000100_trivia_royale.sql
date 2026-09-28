-- =============================================================================
-- Trivia Royale: first-party 2–8 player trivia (platform v2 stage 1 showcase).
--
-- Seeds the official app row with its v2 manifest (players 2–8, free for all,
-- spectators). Mirrors `apps/web/src/platform/catalog.ts`. Safe to re-run.
-- =============================================================================

insert into public.apps
  (slug, name, tagline, description, category, icon, accent_from, accent_to, url, modes,
   min_players, max_players, team_count, allow_spectators, has_setup, turn_based,
   scoring, duration_label, how_to, tags, official, status)
values
  ('trivia-royale', 'Trivia Royale', 'Up to 8 players. 8 rounds. One crown.',
   'A live trivia battle royale for 2–8 players. Everyone gets the same question at the same moment: '
   || 'lock in fast for more points, chain correct answers for streak bonuses, and watch the leaderboard '
   || 'reshuffle after every round. The final round scores double. Friends can drop in to spectate with '
   || 'live answer counts.',
   'trivia', '👑', '#ffd84d', '#ff5c7a', '/embed/trivia-royale', '{live,practice}',
   2, 8, 0, true, false, false,
   'high', '~2 min',
   array[
     'Everyone sees the same question with four answers and 12 seconds on the clock.',
     'Lock in fast: correct answers score up to 1,000, and streaks add up to +300.',
     'Eight rounds across science, geography, arts and more. The last one counts double.',
     'Highest total takes the crown.'
   ],
   '{trivia,multiplayer,party,live}', true, 'published')
on conflict (slug) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  accent_from = excluded.accent_from,
  accent_to = excluded.accent_to,
  url = excluded.url,
  modes = excluded.modes,
  min_players = excluded.min_players,
  max_players = excluded.max_players,
  team_count = excluded.team_count,
  allow_spectators = excluded.allow_spectators,
  has_setup = excluded.has_setup,
  turn_based = excluded.turn_based,
  scoring = excluded.scoring,
  duration_label = excluded.duration_label,
  how_to = excluded.how_to,
  tags = excluded.tags,
  official = excluded.official,
  status = excluded.status,
  updated_at = now();
