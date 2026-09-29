-- =============================================================================
-- Meme Duel renders its own challenge setup (platform v2, Stage 3).
--
-- The app now picks its template / trending meme / dropped image / topic in
-- setup purpose and uploads drops with `media.upload`, so the platform's
-- hard-coded Meme Duel setup is gone. Mirrors `apps/web/src/platform/catalog.ts`.
-- Safe to re-run.
-- =============================================================================

update public.apps set has_setup = true where slug = 'meme-duel';
