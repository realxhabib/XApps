-- =============================================================================
-- Wedge Wars: first-party 2–4 player real-time 3D robot-combat arena.
--
-- Seeds the official app row with its v2 manifest (players 2–4, free for all,
-- spectators, live + practice) and its stats + achievements. Mirrors
-- `apps/web/src/platform/catalog.ts` exactly (the app's progress test compares
-- them); the apps_validate_manifest_data trigger validates the lists on the
-- way in. Safe to re-run.
-- =============================================================================

insert into public.apps
  (slug, name, tagline, description, category, icon, accent_from, accent_to, url, modes,
   min_players, max_players, team_count, allow_spectators, has_setup, turn_based,
   scoring, duration_label, how_to, tags, official, status, stats, achievements)
values
  ('wedge-wars', 'Wedge Wars', 'Armored wedge trucks. Spinners, flippers, fire. Last truck standing.',
   'A real-time 3D robot-combat arena for 2–4 players. Build your wedge truck in the garage — bar spinner, '
   || 'flipper, axe hammer or flamethrower, plus armor and paint — then brawl in a steel arena with a KO pit, '
   || 'pop-up saws, flame vents and a pulverizer. Ram, flip and torch your way to last truck standing before '
   || 'the 2:30 bell.',
   'games', '🛻', '#c6ff3d', '#ff5a1f', '/embed/wedge-wars', '{live,practice}',
   2, 4, 0, true, false, false,
   'high', '2:30',
   array[
     'Pick a weapon, an armor kit and a paint job in the garage, then lock in.',
     'Drive with WASD or the stick, Space fires your weapon, Shift boosts, R rights a flipped truck.',
     'Ram nose-first, land weapon hits, and shove rivals into the pit or the hazards.',
     'Last truck standing wins; at the bell, the healthiest truck takes it. Damage dealt adds to your score.'
   ],
   '{3d,combat,multiplayer,live,physics}', true, 'published',
   -- Wedge Wars: 4 stats, 9 achievements (350 XP)
   $json$[
     {"key":"damage_dealt","label":"Damage dealt","aggregate":"sum","format":"number"},
     {"key":"kos","label":"KOs","aggregate":"sum","format":"number"},
     {"key":"wins","label":"Wins","aggregate":"sum","format":"number"},
     {"key":"best_flip","label":"Best flip (cm)","aggregate":"max","format":"number"}
   ]$json$::jsonb,
   $json$[
     {"id":"first_win","name":"Scrap king","description":"Win a Wedge Wars match.","icon":"🏆","xp":20},
     {"id":"first_blood","name":"First blood","description":"Land the first KO of a match.","icon":"🩸","xp":25},
     {"id":"flipped","name":"Flipped!","description":"Launch an opponent 2 m into the air with your flipper.","icon":"🤸","xp":40},
     {"id":"pit_boss","name":"Pit boss","description":"Knock an opponent into the KO pit.","icon":"🕳️","xp":40},
     {"id":"untouchable","name":"Untouchable","description":"Win with more than 75% of your hull left.","icon":"🛡️","xp":60},
     {"id":"flamed_out","name":"Flamed out","description":"Finish off an opponent with the flamethrower.","icon":"🔥","xp":40},
     {"id":"hammer_time","name":"Hammer time","description":"Land five axe-hammer blows in one match.","icon":"🔨","xp":40},
     {"id":"last_standing","name":"Last truck standing","description":"Win a full four-truck free-for-all.","icon":"👑","xp":60},
     {"id":"pulverized","name":"Pancaked","description":"Get flattened by the pulverizer.","icon":"🥞","xp":25,"secret":true}
   ]$json$::jsonb)
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
  stats = excluded.stats,
  achievements = excluded.achievements,
  updated_at = now();
