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
Standalone apps (`kind: "app"`) open in app mode instead (see below).

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

## Standalone apps (purpose `app`)

Apps with `kind: "app"` in their manifest aren't games: people open them
(news, dashboards, tools, meme makers) at `/apps/<slug>/open`
(`?version=<id>` opens a test build for the owner and testers). There are no
challenges, lobbies, scoring or results. The page lives in the `(standalone)`
route group (no site chrome) and renders `components/play/app-room.tsx`.

What the host does:

1. Signed-out viewers get a "Sign in with X" card (back to this URL after
   login). Apps are promised a real X identity in `xapps.user`, so nothing
   runs anonymously, even though `openApp` would allow it for live apps.
2. `backend.openApp(slug, versionId)` records the open and returns the app to
   run (a test build's manifest for owners/testers). Games are refused with
   `invalid` and the page points back to the app page.
3. The iframe (same `APP_SANDBOX` / `APP_ALLOW` as the play room) fills the
   screen under a slim top bar: back, glyph, name, "by @developer" (or the
   app's `ui.status` line), a test-build badge, Share on X and fullscreen.
4. The bridge launches it with `purpose: "app"` and a one-player stub match
   (`standaloneMatch(user, { id: "app:<slug>", seed })` from
   `@xapps/sdk/host`). The cover lifts on connect: `ready()` is optional and
   answers `{ startedAt: null }`; `match.start` / `match.end` are never sent.
5. The host core refuses match-only requests for purpose `app` before any
   handler runs (`room.send`, `match.submit`, `match.forfeit`, `state.*`,
   `turn.end`, `round.set`, `ui.scores`, `ui.turn`, `setup.*` →
   `forbidden`). Handled: `storage.*`, `stats.report`, `stats.leaderboard`
   (the stat's global board + the viewer's rank, `backend.statStanding`),
   `achievements.unlock`
   (host achievement moment + `achievement.unlock` event), `media.upload`,
   `log` (`logAppEvent` with `matchId: null`), `social.share`, `ui.toast`,
   `ui.celebrate`, `ui.haptic`, `ui.status` (top bar) and `ui.resize`
   (no-op: the frame always fills the screen).
6. Test builds echo stats and show achievements (0 XP) without saving them,
   exactly like test-build matches. `stats.leaderboard` reads the live app's
   board (a stat it doesn't declare yet reads as an empty board).

### First-party standalone apps

They use the same layout as the games: `src/first-party/<slug>` +
`src/app/embed/<slug>/page.tsx`, and `kind: "app"` on the `OFFICIAL_APPS`
entry. The entry still carries the manifest's match fields (`modes`,
`players`, `scoring`…) because the type and the `apps` table have them, but
they mean nothing for an app: keep the harmless defaults (`players` 2–2,
`teams` 0, no `setup`/`turnBased`). `npm run sync-apps` writes the kind, and
falls back to the column defaults for match fields that wouldn't pass the
table's checks (`official-apps.ts`). People open it at `/apps/<slug>/open`.

Opened directly, `/embed/<slug>` runs the mock host in app mode, like the
host would: `EmbedRoot` launches the mock with `purpose: "app"` whenever the
catalog entry says `kind: "app"`. A page can also say so explicitly, and pass
extra mock options:

```tsx
<EmbedRoot slug="perfect-circle" purpose="app" mock={{ leaderboard: { best_circle: [97.1, 91, 84.5] } }}>
  <PerfectCircle />
</EmbedRoot>
```

(`?xapps-purpose=match|app` on the URL still overrides it.) In app mode the
mock seats "You" alone, never fires `match.start`, refuses match-only calls,
and keeps storage, stats, achievements and `stats.leaderboard` working: the
board is your reported values ranked among a handful of made-up players.

Solo games built as apps show where the player stands with
`xapps.stats.leaderboard(key)` / `useStatStanding(key)` from the public SDK:
`{ top, me: { rank, value } | null, total }`, e.g. "#14 of 2,380 · top 1%".
