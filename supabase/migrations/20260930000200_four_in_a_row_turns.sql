-- Four in a Row becomes turn-based on shared match state (platform v2, stage 1):
-- the board lives in matches.state, a move is update_match_state + end_turn,
-- and it can be played live or asynchronously ("play anytime", 3-day turns).
--
-- Matches already in progress keep working: the app falls back to the move
-- list when a match has no turn holder, and its first end_turn sets one.

update public.apps
   set modes = '{live,async,practice}',
       turn_based = true,
       tagline = 'Drop, stack, connect. Live or over days.'
 where slug = 'four-in-a-row';
