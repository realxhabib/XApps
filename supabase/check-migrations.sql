-- Which XApps migrations has this database run? Paste into the Supabase SQL editor.
-- Run the ones marked false in filename order (supabase/migrations/).
select n as "#", file, applied
from (values
  (1, '20260928000000_xapps_core',            to_regclass('public.matches') is not null),
  (2, '20260929000000_challenge_settings',    exists (select 1 from storage.buckets where id = 'meme-drops')),
  (3, '20260930000000_general_matches',       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'matches' and column_name = 'state_version')),
  (4, '20260930000100_trivia_royale',         exists (select 1 from public.apps where slug = 'trivia-royale')),
  (5, '20260930000200_four_in_a_row_turns',   exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'turn_based')
                                              and exists (select 1 from public.apps where slug = 'four-in-a-row' and 'async' = any (modes))),
  (6, '20260930000300_settle_withdraws_invites', exists (select 1 from pg_proc where proname = 'settle_match' and prosrc like '%nobody answered%')),
  (7, '20261001000000_trust',                 to_regclass('public.app_credentials') is not null),
  (8, '20261002000000_media_and_data',        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'stats'))
) as m(n, file, applied)
order by n;
