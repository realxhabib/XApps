# XApps platform v2

Goal: nothing about our architecture should cap how deep an app can go. v1 was
built for quick 1v1 games that each player finishes once. v2 lifts that in four
stages. Each stage ships on its own (migration, SDK, host, docs, tests) and
stays backward compatible: every v1 app keeps working unchanged.

| Stage | Unlocks |
| --- | --- |
| 1. General matches | 2–8 players, teams, spectators, shared persistent match state, turns (live or over days), rounds, app-defined challenge setup |
| 2. Trust | App secret keys, a server API, signed webhooks, server-authoritative results |
| 3. Media & data | Per-app media uploads, video/audio entries, bigger storage, custom stats + leaderboards, achievements |
| 4. Shipping | App versions + staging, review queue, analytics, logs, `create-xapp` CLI, publishable SDK |

---

## Stage 1: General matches (shipped)

Migrations: `20260930000000_general_matches.sql`, `…000100_trivia_royale.sql`,
`…000200_four_in_a_row_turns.sql`, `…000300_settle_withdraws_invites.sql`.
Showcases: Trivia Royale (2–8 players, shared state, rounds, spectators) and
turn-based Four in a Row (live or over days).

### Concepts

- **Seats vs spectators.** A match has `minPlayers..maxPlayers` seats (2–8).
  Spectators watch with no seat, can't submit or change state, and do get
  room messages, state changes and reactions.
- **Teams.** An app may declare `teams` (2–4). Seat `s` plays for team
  `s % teams`. Team score = sum of its members' scores; placements are per team
  and every member gets the team's placement.
- **Lobby.** A match waits in `open` until it has `maxPlayers` seated, or its
  creator starts it early once `minPlayers` are seated (`startMatch`). Async
  matches start as soon as `minPlayers` are seated.
- **Shared match state.** One JSON document per match (≤ 64 KB) with a
  version number. Writes are compare-and-set on the version, so two clients
  can't silently overwrite each other; the SDK retries `update(fn)` for you.
  Every change is pushed to all players and spectators. It persists, so a
  turn-based game can be picked up days later.
- **Turns.** Optional. `turn` is the player whose move it is; `turn.end(next?)`
  passes it (default: next seated player who hasn't left). In async matches a
  turn has a deadline (3 days); missing it forfeits. The inbox tells people
  when it's their turn.
- **Rounds.** `round` is an app-controlled counter the HUD can show; running
  scores still go through `ui.scores`.
- **Results for N players.** Everyone still submits once at the end. When all
  seated players have submitted (or left/forfeited) the match settles:
  placements (`rank`, ties share a rank) from `score` (high/low) or crowd
  votes, XP by placement, `winnerId` = the unique first place (null on a tie
  or in team play, where `winnerTeam` is set instead).
- **App-defined setup.** An app that declares `setup: true` renders its own
  challenge setup screen: the host opens the app in *setup* mode inside the
  challenge sheet, the app calls `xapps.setup.submit(settings, summary)`, and
  the settings (≤ 4 KB) become `match.settings`. This replaces the platform's
  hard-coded Meme Duel setup.

### Manifest (apps table / `AppManifest`)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `players` | `{ min, max }` | `{2, 2}` | 2 ≤ min ≤ max ≤ 8 |
| `teams` | `number` | `0` | 0 = free for all; else 2–4, and `max` must be a multiple |
| `spectators` | `boolean` | `true` | |
| `setup` | `boolean` | `false` | app renders its own challenge setup |
| `turnBased` | `boolean` | `false` | host shows turn UI and "your turn" inbox items |

SQL: `apps.team_count int default 0`, `apps.allow_spectators bool default true`,
`apps.has_setup bool default false`, `apps.turn_based bool default false`
(existing `min_players`/`max_players` gain real meaning).

### Match shape (`Match`, `match_json`)

New on `Match`: `minPlayers`, `maxPlayers`, `teams`, `state: Json | null`,
`stateVersion: number`, `turnUserId: string | null`, `turnDeadline: string | null`,
`round: number`, `winnerTeam: number | null`, `spectatorCount: number`.

New on `MatchPlayer`: `team: number | null`, `role: "player" | "spectator"`,
`rank: number | null`.

`players` in `match_json` lists seated players only (ordered by seat);
spectators are counted, not listed (`spectatorCount`), except the viewer's own
spectator row, which is included so the client knows its role.

SQL columns: `matches.min_players`, `max_players`, `team_count`, `state jsonb`,
`state_version int default 0`, `turn_user uuid`, `turn_deadline timestamptz`,
`round int default 0`, `winner_team int`; `match_players.team int`,
`role text default 'player'`, `rank int`, and `seat` becomes nullable
(spectators have no seat; unique (match_id, seat) still holds for seats).

### RPCs (all `SECURITY DEFINER`, same error-code conventions as v1)

| RPC | Change |
| --- | --- |
| `create_challenge(p_app, p_mode, p_opponent text = null, p_settings jsonb = '{}', p_opponents text[] = null, p_max_players int = null)` | invites 0..max-1 people; `p_max_players` within the app's range (default: app max for open challenges, else invited+1 clamped to the app's min) |
| `join_match(p_match)` | takes the next free seat; accepting an invite keeps your seat; activates when full (live) or min reached (async) |
| `start_match(p_match)` **new** | creator only, `open` → `active` when ≥ min seated; unfilled invites are withdrawn |
| `spectate_match(p_match)` **new** | adds the viewer as a spectator (app must allow it) |
| `quick_match(p_app)` | fills open quick lobbies up to max; first joiner can start early |
| `start_practice(p_app, p_players int = null)` | practice with bots filling up to `p_players` (default app min) |
| `update_match_state(p_match, p_state jsonb, p_expected_version int)` **new** | seated players of an `active` match; error `40001` "state_conflict" if the version moved; ≤ 64 KB; returns the new version |
| `end_turn(p_match, p_next uuid = null)` **new** | only the turn holder (or anyone when no turn is set); `p_next` must be a seated active player; sets `turn_deadline` (async: +3 days) |
| `set_round(p_match, p_round int)` **new** | seated players, monotonic |
| `submit_entry` | settles when every seated, non-left player has submitted |
| `cast_vote(p_match, p_choice)` | works for N entries |
| `claim_forfeit` | a player gone quiet is marked `left`; the match continues if ≥ 2 remain (≥ 1 per team), else settles |
| `finalize_due_matches()` | also forfeits async turn holders past `turn_deadline` |

Realtime: `is_room_member` includes spectators. State/turn/round changes reach
clients through the existing `matches` postgres_changes watch.

### SDK (`@xapps/sdk` 0.2.0, protocol v1, additive)

`LaunchContext` gains `purpose: "match" | "setup"`. In `match`:
`minPlayers`, `maxPlayers`, `teams`, `role`, `state`, `stateVersion`, `turn`,
`round`. `PlayerInfo` gains `team`, `role`.

New requests:

| Method | Params | Result |
| --- | --- | --- |
| `state.get` | `{}` | `{ state: Json \| null, version: number }` |
| `state.set` | `{ state: Json, expectedVersion: number }` | `{ version: number }`, or error code `conflict` |
| `turn.end` | `{ next?: string \| null }` | `null` |
| `round.set` | `{ round: number }` | `null` |
| `setup.submit` | `{ settings: { [k]: Json }, summary?: string }` | `null` (setup purpose only) |
| `setup.cancel` | `{}` | `null` |

New events: `state.change` `{ state, version, by }`, `turn.change`
`{ turn, deadline }`, `round.change` `{ round }`.

Client API: `xapps.purpose`, `xapps.players`, `xapps.opponents` (all other
seated players), `xapps.teammates`, `xapps.role`, `xapps.isSpectator`,
`xapps.state.get()`, `xapps.state.set(value, expectedVersion?)`,
`xapps.state.update(fn)` (re-reads and retries on conflict), `xapps.state.onChange(fn)`,
`xapps.turn.current`, `xapps.turn.isMine`, `xapps.turn.end(next?)`,
`xapps.onTurn(fn)`, `xapps.round.set(n)`, `xapps.setup.submit(settings, summary?)`,
`xapps.setup.cancel()`. `xapps.opponent` stays (first opponent) for v1 apps.

React: `useMatchState()` → `{ state, version, set, update }`, `useTurn()` →
`{ turn, isMine, end }`, `useRound()`, `useSetup()`, `usePlayers()`.

Host core handlers: `getState`, `setState`, `endTurn`, `setRound`,
`submitSetup`, `cancelSetup`; host emits `state.change`, `turn.change`,
`round.change`. Spectators are refused (`forbidden`) for `match.submit`,
`state.set`, `turn.end`, `round.set`, `room.send` (except they still get events).

Mock host: N players (bots fill `minPlayers`), in-memory state with versions,
rotating turns, and setup purpose when the page URL has `?xapps-purpose=setup`.

### Host UI

- **Lobby**: seat grid (filled/invited/open), invite more by handle, share
  link, creator's **Start** button once ≥ min, "Watch" for spectators.
- **Intro**: 1v1 keeps the VS slam; 3+ players get a free-for-all ring; teams
  get a split by team color.
- **HUD**: compact player strip (up to 8) with scores, turn ring, team colors,
  round counter; spectator badge.
- **Results**: ranked list / podium for 3+ players, team banners.
- **Voting / Arena**: N entries.
- **Challenge sheet**: pick up to max-1 rivals, choose table size when
  max > 2, and the app's own setup screen when `setup: true`.
- **Inbox**: "Your turn in …" for turn-based async matches.

---

## Stage 2: Trust (outline, detailed when stage 1 ships)

- Per-app **secret key** (shown once, stored hashed) and **webhook URL** with
  a separate signing secret.
- **Server API** (`/api/v1/...`, bearer secret): read a match, write match
  state, end turns, **report the authoritative result**.
- Manifest `authority: "client" | "server"`. With `server`, client submits
  are recorded as claims and only the app server's report settles the match.
- **Webhooks** (HMAC-SHA256 signed, retried with backoff): `match.created`,
  `match.started`, `match.state`, `match.submitted`, `match.ended`.
- `@xapps/sdk/server`: `verifyWebhook()`, typed API client.

## Stage 3: Media & data (outline)

- `media.upload(blob)` → hosted URL in a per-app bucket (quotas, image/video/audio).
- Entry displays: `video`, `audio`, and image galleries.
- Storage: larger values, key listing, per-match scoped storage.
- `stats.report(key, value)` + per-app custom leaderboards.
- Achievements declared in the manifest; unlocked by the app (server-only for
  `authority: "server"` apps); shown on profiles.

## Stage 4: Shipping (outline)

- App **versions** (draft → review → published) with a staging channel only
  the developer and invited testers can play.
- **Review queue** for admins; review notes to developers.
- **Analytics** per app (matches, players, completion, duration), **logs**
  (SDK errors + `debug.log`).
- `npx create-xapp` templates (vanilla, React + Vite) and a publishable
  `@xapps/sdk` package (types, ESM + global bundles, changelog).
- Real-money payments/creator payouts are out of scope until there's a Stripe
  account and terms; the data model leaves room for them.
