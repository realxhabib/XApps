# Changelog

All notable changes to `@xapps/sdk`. The wire protocol is still version 1:
every release is additive, and apps built against an older SDK keep working on
newer hosts (and the other way round, minus the new features).

## 0.4.0

Shipping: logs and a publishable package.

- **Logs.** `xapps.log.debug/info/warn/error(message, data?)` writes to your
  app's log (the Logs tab of your developer console). Fire and forget: it never
  throws, never blocks and returns nothing. Messages are cut to 500 chars (with
  `…`), `data` over 4 KB of JSON is replaced by a note, and past 60 entries a
  minute the extra entries are dropped.
- **Error capture.** Uncaught errors and unhandled promise rejections are sent
  as `error` logs with a trimmed stack. Opt out with
  `connect({ captureErrors: false })`.
- **Frame height**: `xapps.ui.resize(height)` tells the host how tall your
  content is (CSS px, rounded up and clamped to 120–2000), and
  `xapps.ui.autoResize()` keeps it updated with a `ResizeObserver` (at most one
  request per 100 ms; returns a stop function). Useful for challenge setup
  screens shown inside the host's sheet. Allowed for every purpose and role.
- React: `useLogger()`, `useAutoResize()`.
- Host: request `log` (validated: level, message ≤ 500 chars, data ≤ 4 KB;
  allowed for every purpose and role, spectators included; excess over
  60/min per app instance is dropped silently). Handler key `log` or
  `logEvent`. `LOG_LEVELS`, `isLogLevel` and `logProblem` are exported from
  `@xapps/sdk/host`. Request `ui.resize` (handler `ui.resize` or `resize`)
  receives the height already clamped; `LIMITS.frameHeight` and
  `clampFrameHeight` are exported.
- Mock host: prints logs as `[xapps log]` console lines and keeps them in
  `mock.logs`; `ui.resize` is a `console.debug` no-op.
- Packaging: published to npm with an `exports` map (`.`, `./react`, `./host`,
  `./server`, `./protocol`) carrying type declarations that also resolve under
  `moduleResolution: "node16"/"nodenext"`, `sideEffects: false`, MIT license.
  `react` is an optional peer dependency (only `./react` needs it).
- New: [`create-xapp`](https://www.npmjs.com/package/create-xapp) scaffolds a
  ready project: `npx create-xapp my-game`.

## 0.3.0

Media, data and trust.

- **Media uploads**: `xapps.media.upload(blob, { alt })` for images, audio and
  video (per-kind size limits, daily quotas) → `MediaRef`; entries can be
  `video`, `audio` and `gallery` displays.
- **Storage scopes**: `storage.get/list(…, { scope: "app" })` reads the app's
  public space (written by your server); `storage.delete`, `storage.list`.
- **Stats & leaderboards**: manifest `stats`, `xapps.stats.report(values)`
  with `max`/`min`/`sum`/`last` aggregates.
- **Achievements**: manifest `achievements`, `xapps.achievements.unlock(id)`,
  `onAchievement`.
- React: `useMediaUpload()`, `useStats()`, `useAchievements()`,
  `useAchievementEvents()`.
- **Server client** (`@xapps/sdk/server`): `verifyWebhook` / `signWebhook` for
  signed webhooks and `createServerClient` for the server API (settle matches,
  write app storage) with an app secret key.

## 0.2.0

Matches for 2–8 players.

- Tables of 2–8 seats, **teams** (seat `s` plays for team `s % teams`) and
  **spectators** (read-only). `players`, `opponents`, `teammates`, `me`, `role`.
- **Shared match state**: one versioned JSON document per match (≤ 64 KB),
  compare-and-set `state.set` and retrying `state.update(fn)`.
- **Turns** (`turn.end`, `onTurn`, deadlines in async matches) and a **round**
  counter in the host HUD.
- **Challenge setup**: apps with `setup: true` render their own setup screen
  and call `setup.submit(settings, summary)`.
- N-player results with placements (`ranks`, `winnerTeam`).
- Mock host: `players`, `teams`, `turnBased`, `role`, `purpose` options and
  `?xapps-*` URL switches.
- React: `useMatchState()`, `useTurn()`, `useRound()`, `usePlayers()`,
  `useSetup()`.

## 0.1.0

The 1v1 core.

- `connect()` handshake over `postMessage` (origin-pinned), launch context
  (user, match, seed), `ready()` / `onStart` / `onEnd`.
- Realtime room: `room.send` / `room.on` / presence, rate limited.
- `submit()` / `submitFor(botId)` for practice bots, `forfeit()`; the platform
  settles `high`, `low` or crowd `votes` scoring.
- Host UI (`ui.toast/celebrate/haptic/setStatus/setScores/setTurn`),
  `social.share`, per-player key/value storage, seeded `random`.
- A standalone mock host (open your app directly and play against a bot),
  `@xapps/sdk/host` to embed apps, React bindings (`XAppsProvider`,
  `useXApps`, `useRoomEvent`, …) and a no-build browser bundle.
