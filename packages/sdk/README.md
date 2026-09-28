# @xapps/sdk

Build multiplayer apps for **XApps**, the social app marketplace on X: 1v1 duels, 2–8 player tables, team games, turn-based games that last days, and games with their own challenge setup. The SDK is a small bridge (~32 KB minified / ~11 KB gzipped including the standalone mock host, zero dependencies) between your app, running in a sandboxed iframe, and the XApps host. The host gives your app:

- **Identity**: every player is signed in with X (`handle`, `name`, `avatarUrl`).
- **Realtime rooms**: `room.send` / `room.on`, plus presence.
- **Shared match state**: one versioned JSON document per match that persists, with turns and rounds.
- **Matches and results**: submit a score or an entry, and the platform settles the match, awards XP and updates leaderboards.
- **Crowd judging**: with `votes` scoring, the Arena crowd picks the winner.
- **Host UI**: VS intro, countdown, HUD, emoji reactions, confetti, results screen, rematch and share.

```bash
npm install @xapps/sdk
```

No build step? Import the browser bundle from your XApps host:

```html
<script type="module">
  import { connect } from "https://<xapps-host>/sdk/v1.js";
</script>
<!-- or classic: <script src="https://<xapps-host>/sdk/v1.global.js"></script> → window.XApps -->
```

## Quick start

```ts
import { connect } from "@xapps/sdk";

const xapps = await connect();                 // players, seed, mode…
const bot = xapps.opponents.find((p) => p.isBot); // practice: your app plays the bot

xapps.room.on("move", (move, from) => applyMove(move, from));
xapps.onStart(() => startGame());              // fires after the host's VS intro
await xapps.ready();                           // call once your first screen is up

// when the game ends:
await xapps.submit({ score: myScore, data: { moves } });
if (bot) await xapps.submitFor(bot.id, { score: botScore });
xapps.onEnd((result) => console.log(result.winnerId));
```

### React

```tsx
import { XAppsProvider, useXApps, useRoomEvent, useMatchStarted, useMatchResult } from "@xapps/sdk/react";

<XAppsProvider fallback={<Spinner />}>
  <Game />
</XAppsProvider>;
```

More hooks: `useMatch()`, `usePresence()`, `useReactions(fn)`, and for v2 matches `useMatchState()`, `useTurn()`, `useRound()`, `usePlayers()`, `useSetup()` (see below).

## Lifecycle

1. The host loads your URL in a sandboxed iframe, and `connect()` completes the handshake.
2. You render, then call `ready()`.
3. The host waits for every human player, plays the VS intro and the 3-2-1 countdown, then `onStart` fires.
4. Players talk through the room.
5. Each client calls `submit()` exactly once.
6. The platform settles the match (`high`, `low` or `votes`), and `onEnd` fires. The host then shows its results screen.

## API

| API | Notes |
| --- | --- |
| `connect(options?)` | Shared client (safe to call repeatedly). `hostOrigins` pins trusted hosts. `mock` controls the standalone mock host. |
| `xapps.purpose` | `"match"` (play) or `"setup"` (render your challenge setup screen) |
| `xapps.me` / `players` / `opponents` / `opponent` / `teammates` | `PlayerInfo`: `id, handle, name, avatarUrl, seat, isBot, submitted, score, team, role`. `players` = seated players by seat, `opponents` = every other seated player, `opponent` = the first one (1v1), `teammates` = same team |
| `xapps.role` · `xapps.isSpectator` | `"player"` or `"spectator"` |
| `xapps.match` | `id, mode (live·async·practice·sandbox), status, scoring, seed, settings, minPlayers, maxPlayers, teams, state, stateVersion, turn, turnDeadline, round` |
| `xapps.random` | Seeded by the match, identical on every client: `next, int, float, pick, shuffle, normal, chance, fork(label)` |
| `xapps.isHost` | `true` for seat 0, for when one client should referee |
| `ready()` · `onStart(fn)` · `onUpdate(fn)` · `onEnd(fn)` · `forfeit()` | Lifecycle |
| `submit({ score?, data?, display? })` · `submitFor(botId, …)` | `display` is `{kind:"text",title?,body}`, `{kind:"svg",svg,alt}` or `{kind:"image",url,alt}` (https) |
| `room.send(type, payload)` · `room.on(type, fn)` · `room.onAny(fn)` · `room.onPresence(fn)` | ≤ 8 KB payloads, ≤ 30 messages/s |
| `ui.setStatus` · `ui.setScores` · `ui.setTurn` · `ui.toast` · `ui.celebrate` · `ui.haptic` | Host UI |
| `social.share(text, url?)` | Opens the X composer. The player always confirms the post. |
| `storage.get(key)` · `storage.set(key, value)` | Per player, per app, ≤ 16 KB per value |
| `state.current` · `state.version` · `state.get()` · `state.set(value, expectedVersion?)` · `state.update(fn, { retries? })` · `state.onChange(fn)` | Shared match state, ≤ 64 KB JSON, compare-and-set (error code `conflict`) |
| `turn.current` · `turn.isMine` · `turn.deadline` · `turn.end(next?)` · `onTurn(fn)` | Turns (optional) |
| `round.current` · `round.set(n)` · `onRound(fn)` | Round counter in the host HUD, never goes backwards |
| `setup.active` · `setup.submit(settings, summary?)` · `setup.cancel()` | Setup purpose only. Settings ≤ 4 KB JSON object, summary ≤ 140 chars |

`@xapps/sdk/host` exports `createHostBridge` / `createHostCore` if you want to embed XApps apps yourself or write integration tests. `@xapps/sdk/protocol` has the wire types.

## Matches for 2–8 players

Everything in this section is additive: 1v1 apps written for v1 keep working unchanged (`opponent`, `submit`, `onEnd` behave as before).

### Turn-based game with shared state

The shared state is one JSON document per match with a version number. Writes are compare-and-set, so two players can never silently overwrite each other. `state.update(fn)` reads the latest state, applies `fn`, and if someone else wrote first it re-reads and runs `fn` again. Keep `fn` free of side effects. The state persists, so an async game can be picked up days later.

```ts
const xapps = await connect();

type Board = { cells: (string | null)[]; winner: string | null };

xapps.state.onChange((board) => render(board as Board | null)); // every change, yours included
xapps.onTurn(({ turn }) => xapps.ui.setStatus(turn === xapps.me.id ? "Your move" : "Waiting…"));
render(xapps.state.current as Board | null);                    // latest known state at launch
await xapps.ready();

async function play(cell: number) {
  if (!xapps.turn.isMine) return;
  await xapps.state.update<Board>((board) => {
    const next = board ?? { cells: Array(9).fill(null), winner: null };
    if (next.cells[cell]) return undefined;                     // undefined = don't write
    next.cells[cell] = xapps.me.id;                             // `board` is your own copy
    next.winner = findWinner(next.cells);
    return next;
  });
  await xapps.turn.end();                                       // next seated player (or turn.end(playerId))
}
```

In async matches `turn.deadline` is when the turn times out (3 days). Missing it forfeits, and the inbox tells players when it's their turn. Use `state.set(value, expectedVersion)` for a raw compare-and-set that fails with code `conflict`.

### 4-player free for all

```ts
const xapps = await connect();
// xapps.players: 2–8 seated players; xapps.opponents: everyone but you.
xapps.ui.setScores(Object.fromEntries(xapps.players.map((p) => [p.id, 0])));
xapps.onRound((round) => xapps.ui.setStatus(`Round ${round}/5`));
if (xapps.isHost) await xapps.round.set(1);   // one client drives the round counter

// Everyone still submits once. With N players, results come as placements.
await xapps.submit({ score });
xapps.onEnd(({ ranks, winnerId }) => {
  // ranks: { [playerId]: 1 | 2 | … }, ties share a rank. winnerId: unique first place, or null on a tie.
});
```

In practice mode bots fill the empty seats. Your app plays them: `xapps.players.filter((p) => p.isBot)`, `submitFor(bot.id, …)`.

### Team play

Apps can declare 2–4 teams. Seat `s` plays for team `s % teams`, so `player.team` is always set in team play.

```ts
const xapps = await connect();
const myTeam = xapps.me.team;                                   // 0, 1, …
const allies = xapps.teammates;                                 // same team, without you
const rivals = xapps.opponents.filter((p) => p.team !== myTeam);

xapps.onEnd(({ winnerTeam, ranks }) => {
  // Team score = sum of its members' scores. Every member gets the team's placement.
  // winnerId is null in team play; winnerTeam is the winning team (null on a tie).
  showBanner(winnerTeam === myTeam ? "Your team wins!" : "Good game");
});
```

### Challenge setup screen

Apps that declare `setup: true` render their own challenge setup. The host opens your app in the challenge sheet with `purpose: "setup"` (no match starts, `onStart` never fires). The settings you submit become `match.settings` for everyone in the match.

```ts
const xapps = await connect();

if (xapps.purpose === "setup") {
  const defaults = xapps.match.settings;                        // prefill (e.g. when editing)
  renderSetupForm(defaults, {
    onDone: (settings) => xapps.setup.submit(settings, `${settings.rounds} rounds · ${settings.theme}`),
    onCancel: () => xapps.setup.cancel(),
  });
} else {
  startGame(xapps.match.settings);
}
```

Settings must be a JSON object of at most 4 KB, and the summary (shown on the invite) at most 140 characters. In setup purpose, match methods (`room.send`, `submit`, `state.*`, `turn.end`, `round.set`) are refused with `forbidden`. `ready()`, `ui.*` and `storage.*` still work.

### Spectators

People can watch a match without a seat. A spectator gets `role: "spectator"`, `seat: -1`, and is never listed in `players`. They receive room messages, state changes, turns, rounds and reactions, and they can read `state`. They can't `submit`, `forfeit`, `room.send`, `state.set`/`update`, `turn.end` or `round.set`; the SDK and the host refuse those with `forbidden`.

```ts
const xapps = await connect();
if (xapps.isSpectator) {
  hideControls();
  xapps.ui.setStatus("Watching");
}
xapps.state.onChange((state) => render(state));                 // same stream as players
```

### React

```tsx
import { useMatchState, usePlayers, useRound, useSetup, useTurn } from "@xapps/sdk/react";

function Board() {
  const { state, version, update } = useMatchState<Board>();   // also `set(value, expectedVersion?)`
  const { turn, isMine, deadline, end } = useTurn();
  const { round } = useRound();                                 // also `set(n)`
  const { players, opponents, teammates, me, role, isSpectator } = usePlayers();
  const { isSetup, settings, submit, cancel } = useSetup();
  // …
}
```

### Testing multiplayer locally

Opened directly, `connect()` starts the mock host. Configure it through `connect({ mock: { … } })` or URL switches:

| Option | URL switch | Effect |
| --- | --- | --- |
| `players: 4` | `?xapps-players=4` | You + 3 bots (`bot`, `bot2`, `bot3`) |
| `teams: 2` | `?xapps-teams=2` | Team play |
| `turnBased: true` | `?xapps-turns=1` | Seat 0 starts with the turn. The mock lets your app end bot turns. |
| `role: "spectator"` | `?xapps-role=spectator` | Watch a table of bots |
| `purpose: "setup"` | `?xapps-purpose=setup` | Setup mode. `setup.submit` logs the settings and shows a banner with a link that opens a mock match with them. |
| `settings: {…}` | `?xapps-settings=<json>` | `match.settings` for the mock match |
| `state: {…}` | | Initial shared state |

`createMockHost()` also returns `setState(state, by?)`, `endTurn(next?)` and `setRound(n)` so tests can simulate the other players.

### Hosting apps yourself

`createHostCore` / `createHostBridge` handlers for the new methods can be keyed by method name or by a friendly alias:

| Method | Alias | Params → result |
| --- | --- | --- |
| `state.get` | `getState` | `{}` → `{ state, version }` |
| `state.set` | `setState` | `{ state, expectedVersion }` → `{ version }`. Throw `new XAppsError("conflict", …)` when the version moved. |
| `turn.end` | `endTurn` | `{ next? }` → `null` |
| `round.set` | `setRound` | `{ round }` → `null` |
| `setup.submit` | `submitSetup` | `{ settings, summary? }` → `null` |
| `setup.cancel` | `cancelSetup` | `{}` → `null` |

The core validates params and refuses by purpose and role (read from `context()`, or from an `access()` option) before calling your handler. Push changes with `bridge.emitState(state, version, by)`, `bridge.emitTurn(turn, deadline)` and `bridge.emitRound(round)`, or emit a `match.update`, from which the client derives the same events. Emit before you answer `turn.end` so the app sees the new turn first. `rankPlayers(entries, "high" | "low", { teams })` computes placements, ties and team sums.

## Testing

- **Standalone**: open your app directly (not in an iframe), and `connect()` starts a mock host where you play against a bot.
- **Standalone, N players**: see [Testing multiplayer locally](#testing-multiplayer-locally) for more seats, teams, turns, spectating and setup mode.
- **Sandbox**: `/developers/sandbox` on any XApps host runs two seats side by side with a protocol log.
- **Framing**: your server must allow XApps to embed you, e.g. `Content-Security-Policy: frame-ancestors https://<xapps-host>`.

## Trust model

Scores are reported by clients. Use the shared seed for anything both players must agree on, commit-reveal for secret picks (see `examples/rps`), and crowd judging for creative formats.
