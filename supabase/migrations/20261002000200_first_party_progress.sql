-- First-party progress: stats and achievements for the official apps.
--
-- Gives Reflexes, Four in a Row, Trivia Royale, Emoji Decode and Hot Takes
-- their manifest stats (leaderboard tabs) and achievements (badges). The
-- lists match apps/web/src/platform/catalog.ts exactly (the web app's
-- catalog test compares them), and the apps_validate_manifest_data trigger
-- validates them on the way in. Meme Duel is left as it is.

-- Reflexes: 4 stats, 8 achievements (335 XP)
update public.apps set
  stats = $json$[
     {"key":"best_reaction","label":"Best reaction","aggregate":"min","format":"ms"},
     {"key":"rounds_won","label":"Rounds won","aggregate":"sum","format":"number"},
     {"key":"duels_won","label":"Duels won","aggregate":"sum","format":"number"},
     {"key":"perfect_duels","label":"Perfect duels","aggregate":"sum","format":"number"}
   ]$json$::jsonb,
  achievements = $json$[
     {"id":"duel_won","name":"Fastest gun","description":"Win a Reflexes duel.","icon":"🤠","xp":20},
     {"id":"under_200","name":"Under 200 ms","description":"React to GO in under 200 milliseconds.","icon":"⚡","xp":40},
     {"id":"under_150","name":"Superhuman","description":"React to GO in under 150 ms. Are you even human?","icon":"🦾","xp":70},
     {"id":"flawless","name":"Flawless 3–0","description":"Win a duel without dropping a round.","icon":"💎","xp":40},
     {"id":"comeback","name":"Comeback","description":"Win a duel after falling 0–2 behind.","icon":"🔄","xp":60},
     {"id":"photo_finish","name":"Photo finish","description":"Win a round by 5 milliseconds or less.","icon":"📸","xp":40},
     {"id":"metronome","name":"Metronome","description":"Three clean taps in a duel, all within 30 ms.","icon":"⏱️","xp":40},
     {"id":"twitchy","name":"Twitchy","description":"Jump the gun three times in one duel.","icon":"🫨","xp":25,"secret":true}
   ]$json$::jsonb
where slug = 'quick-draw';

-- Four in a Row: 3 stats, 9 achievements (350 XP)
update public.apps set
  stats = $json$[
     {"key":"wins","label":"Wins","aggregate":"sum","format":"number"},
     {"key":"fastest_win","label":"Fastest win (discs)","aggregate":"min","format":"number"},
     {"key":"longest_line","label":"Longest winning line","aggregate":"max","format":"number"}
   ]$json$::jsonb,
  achievements = $json$[
     {"id":"first_win","name":"Connected","description":"Win a game of Four in a Row.","icon":"🔴","xp":20},
     {"id":"diagonal","name":"Diagonal","description":"Win with a diagonal line.","icon":"📐","xp":30},
     {"id":"quick_four","name":"Four in 7 moves","description":"Win using seven or fewer of your own discs.","icon":"⏩","xp":40},
     {"id":"blocker","name":"Blocker","description":"Drop a disc where your opponent would have won.","icon":"🛡️","xp":20},
     {"id":"the_wall","name":"The Wall","description":"Block three would-be fours in a single game.","icon":"🧱","xp":50},
     {"id":"marathon","name":"Marathon","description":"Play a game until all 42 cells are full.","icon":"🏃","xp":50},
     {"id":"pen_pal","name":"Turn-based win","description":"Win a play-anytime game.","icon":"✉️","xp":30},
     {"id":"long_line","name":"Five alive","description":"Win with a line of five or more discs.","icon":"🖐️","xp":50},
     {"id":"double_trouble","name":"Double trouble","description":"Complete two lines of four with a single disc.","icon":"✨","xp":60,"secret":true}
   ]$json$::jsonb
where slug = 'four-in-a-row';

-- Trivia Royale: 4 stats, 9 achievements (400 XP)
update public.apps set
  stats = $json$[
     {"key":"best_score","label":"Best score","aggregate":"max","format":"number"},
     {"key":"correct_answers","label":"Correct answers","aggregate":"sum","format":"number"},
     {"key":"best_streak","label":"Best streak","aggregate":"max","format":"number"},
     {"key":"crowns","label":"Crowns","aggregate":"sum","format":"number"}
   ]$json$::jsonb,
  achievements = $json$[
     {"id":"crowned","name":"Crowned","description":"Win a Trivia Royale table.","icon":"👑","xp":20},
     {"id":"perfect_game","name":"8 for 8","description":"A perfect game: all eight questions right.","icon":"🎯","xp":80},
     {"id":"speed_demon","name":"Speed demon","description":"A right answer within 2 seconds.","icon":"⚡","xp":30},
     {"id":"on_fire","name":"On fire","description":"Answer five questions in a row correctly.","icon":"🔥","xp":40},
     {"id":"podium","name":"Podium","description":"Finish top three at a table of four or more.","icon":"🥉","xp":30},
     {"id":"lone_genius","name":"Lone genius","description":"The only right answer at a table of three or more.","icon":"🧠","xp":40},
     {"id":"clutch","name":"Double down","description":"Snatch the win on the double-points final round.","icon":"🎲","xp":50},
     {"id":"host_with_most","name":"Host with the most","description":"Win a full eight-player table.","icon":"🎉","xp":80},
     {"id":"gloriously_wrong","name":"Gloriously wrong","description":"Answer all eight questions. Miss all eight.","icon":"🙃","xp":30,"secret":true}
   ]$json$::jsonb
where slug = 'trivia-royale';

-- Emoji Decode: 4 stats, 8 achievements (335 XP)
update public.apps set
  stats = $json$[
     {"key":"best_score","label":"Best score","aggregate":"max","format":"number"},
     {"key":"puzzles_decoded","label":"Puzzles decoded","aggregate":"sum","format":"number"},
     {"key":"fastest_decode","label":"Fastest decode","aggregate":"min","format":"ms"},
     {"key":"wins","label":"Wins","aggregate":"sum","format":"number"}
   ]$json$::jsonb,
  achievements = $json$[
     {"id":"first_win","name":"Cracked it","description":"Win an Emoji Decode match.","icon":"🔓","xp":20},
     {"id":"fluent","name":"Fluent in emoji","description":"Decode all eight puzzles in one match.","icon":"💯","xp":70},
     {"id":"lightning","name":"Lightning read","description":"Decode a puzzle within 2 seconds.","icon":"⚡","xp":40},
     {"id":"on_a_roll","name":"On a roll","description":"Decode five puzzles in a row.","icon":"🔥","xp":30},
     {"id":"score_1500","name":"1,500 club","description":"Score 1,500 points or more in a match.","icon":"🎖️","xp":60},
     {"id":"speed_reader","name":"Speed reader","description":"Decode 6+ puzzles in a match, under 4 s on average.","icon":"📖","xp":50},
     {"id":"photo_finish","name":"Photo finish","description":"Win a match by 25 points or fewer.","icon":"📸","xp":40},
     {"id":"lost_in_translation","name":"Lost for words","description":"Miss all eight puzzles in a match.","icon":"🙈","xp":25,"secret":true}
   ]$json$::jsonb
where slug = 'emoji-decode';

-- Hot Takes: 3 stats, 8 achievements (255 XP)
update public.apps set
  stats = $json$[
     {"key":"takes","label":"Takes written","aggregate":"sum","format":"number"},
     {"key":"wins","label":"Debates won","aggregate":"sum","format":"number"},
     {"key":"votes","label":"Crowd votes","aggregate":"sum","format":"number"}
   ]$json$::jsonb,
  achievements = $json$[
     {"id":"first_take","name":"Fresh take","description":"Lock in your first take.","icon":"🗞️","xp":10},
     {"id":"ghost_pepper","name":"Ghost pepper","description":"Lock in a take at maximum spice.","icon":"🌶️","xp":15},
     {"id":"every_char","name":"Maxed out","description":"Use all 280 characters. Exactly.","icon":"📏","xp":30},
     {"id":"crowd_pleaser","name":"Crowd pleaser","description":"Win a debate in the Arena.","icon":"👑","xp":30},
     {"id":"too_hot","name":"Scorcher","description":"Win with a maximum-spice take.","icon":"🔥","xp":40},
     {"id":"short_sweet","name":"Short and sweet","description":"Win with a take of 50 characters or fewer.","icon":"✂️","xp":50},
     {"id":"shutout","name":"Shutout","description":"Win a debate without the other side getting a vote.","icon":"🧹","xp":50},
     {"id":"buzzer_beater","name":"Buzzer beater","description":"Lock in with 5 seconds or less on the clock.","icon":"⏱️","xp":30,"secret":true}
   ]$json$::jsonb
where slug = 'hot-takes';
