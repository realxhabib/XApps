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
  (8, '20261002000000_media_and_data',        exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'stats')),
  (9, '20261002000100_meme_duel_setup',       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'has_setup')
                                              and exists (select 1 from public.apps where slug = 'meme-duel' and has_setup)),
  (10, '20261002000200_first_party_progress', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'stats')
                                              and exists (select 1 from public.apps where slug = 'quick-draw' and jsonb_array_length(stats) > 0)),
  (11, '20261003000000_shipping',             to_regclass('public.app_versions') is not null),
  (12, '20261004000000_wedge_wars',           exists (select 1 from public.apps where slug = 'wedge-wars' and jsonb_array_length(achievements) > 0)),
  (13, '20261005000000_version_revisions',    exists (select 1 from pg_proc where proname = 'revise_app_version')),
  (14, '20261005000100_app_images',           exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'cover_image')),
  (15, '20261006000000_lobby_expiry',         exists (select 1 from pg_proc where proname = 'expire_idle_lobbies')),
  (16, '20261006000100_standalone_apps',      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'apps' and column_name = 'kind')
                                              and exists (select 1 from pg_proc where proname = 'open_app')),
  (17, '20261006000200_app_upvotes',          to_regclass('public.app_upvotes') is not null
                                              and exists (select 1 from pg_proc where proname = 'set_app_upvote'))
) as m(n, file, applied)
order by n;
