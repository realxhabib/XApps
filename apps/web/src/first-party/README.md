# First-party apps

Every default app is built on the **public** `@xapps/sdk`, exactly like a
community app. The only difference is hosting: these are served same-origin
from `/embed/<slug>` instead of from a developer's own domain.

```
src/first-party/<slug>/     game logic (pure, unit-tested) + React UI
src/app/embed/<slug>/page.tsx  <EmbedRoot slug="<slug>"><App /></EmbedRoot>
```

Open `/embed/<slug>` directly and the SDK's mock host kicks in: you play
"You" vs a practice bot, and `match.start` fires shortly after `ready()`.

## Adding a first-party app

1. Build it in `src/first-party/<slug>/` and add `src/app/embed/<slug>/page.tsx`.
2. Add its manifest to `OFFICIAL_APPS` in `src/platform/catalog.ts` with
   `official: true` and `url: "/embed/<slug>"`.
3. Deploy. **No migration is needed**: the production build runs
   `npm run sync-apps`, which upserts every official catalog app into
   `public.apps` (mapping in `src/platform/official-apps.ts`). Changing an
   existing app's manifest (players, modes, stats, achievements, copy) works
   the same way. Run `npm run sync-apps -- --dry-run` to see the rows.

Migrations are only for platform changes. Official apps never get
`app_versions`: they ship with the site, so their version RPCs refuse them.

## Lifecycle contract (what the host does)

1. The host loads the app in an iframe and answers the SDK handshake.
2. The app renders its pre-game screen and calls `xapps.ready()` once.
3. When every human is present and ready, the host plays its versus intro
   and 3-2-1 countdown, then fires `match.start` (`useMatchStarted()`).
   Apps never need their own pre-game countdown.
4. The app plays the match. Human opponents talk through
   `xapps.room.send` / `useRoomEvent`. **Bots are played by the app**: if
   `useBot()` returns a player, this client simulates it and submits for it
   with `xapps.submitFor(bot.id, …)`.
5. The app calls `xapps.submit({ score, data, display })` exactly once.
   `score` is required for `high`/`low` scoring; `display` (text or SVG) is
   what the crowd sees for `votes` scoring.
6. When the platform settles the match, `match.end` fires
   (`useMatchResult()`); ~1s later the host covers the app with its results
   screen. Apps should show a short final state, not a full results page.

Drive the host HUD with `xapps.ui.setStatus`, `setScores` and `setTurn`.
Use `xapps.random` (seeded per match) for anything both players must agree
on — prompts, puzzles, delays.
