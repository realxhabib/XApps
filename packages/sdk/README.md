# @xapps/sdk

Build multiplayer apps for **XApps**, the social app marketplace on X: 1v1 duels, 2–8 player tables, team games, turn-based games that last days, and games with their own challenge setup. The SDK is a small bridge (~44 KB minified / ~15 KB gzipped including the standalone mock host, zero dependencies) between your app, running in a sandboxed iframe, and the XApps host. The host gives your app:

- **Identity**: every player is signed in with X (`handle`, `name`, `avatarUrl`).
- **Realtime rooms**: `room.send` / `room.on`, plus presence.
- **Shared match state**: one versioned JSON document per match that persists, with turns and rounds.
- **Matches and results**: submit a score or an entry, and the platform settles the match, awards XP and updates leaderboards.
- **Crowd judging**: with `votes` scoring, the Arena crowd picks the winner.
- **Media**: upload images, audio and video clips, and submit them as entries.
- **Progression**: key/value storage (per player and per app), custom stats with leaderboards, and achievements.
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

More hooks: `useMatch()`, `usePresence()`, `useReactions(fn)`, for v2 matches `useMatchState()`, `useTurn()`, `useRound()`, `usePlayers()`, `useSetup()`, and for media and progression `useMediaUpload()`, `useStats()`, `useAchievements()`, `useAchievementEvents(fn)` (see below).

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
| `submit({ score?, data?, display? })` · `submitFor(botId, …)` | `display` is `{kind:"text",title?,body}`, `{kind:"svg",svg,alt}`, `{kind:"image",url,alt}`, `{kind:"video",url,alt,poster?}`, `{kind:"audio",url,alt,cover?}` or `{kind:"gallery",items:[{url,alt}]}` (2–6 items). See [Media uploads](#media-uploads) |
| `room.send(type, payload)` · `room.on(type, fn)` · `room.onAny(fn)` · `room.onPresence(fn)` | ≤ 8 KB payloads, ≤ 30 messages/s |
| `ui.setStatus` · `ui.setScores` · `ui.setTurn` · `ui.toast` · `ui.celebrate` · `ui.haptic` | Host UI |
| `social.share(text, url?)` | Opens the X composer. The player always confirms the post. |
| `storage.get(key, { scope? })` · `storage.set(key, value)` · `storage.delete(key)` · `storage.list({ prefix?, scope? })` | ≤ 64 KB JSON per value, ≤ 200 keys per player. `scope: "user"` (default, private) or `"app"` (public, read-only here). See [Storage scopes](#storage-scopes) |
| `media.upload(blob, { alt? })` · `media.kindOf(mime)` | Upload an image, audio or video file → `MediaRef { url, kind, mime, bytes, width?, height?, duration? }` |
| `stats.defs` · `stats.report(values)` | Your manifest stats; report values, get the new aggregates |
| `achievements.defs` · `achievements.unlock(id)` · `achievements.unlocked` · `onAchievement(fn)` | Your manifest achievements |
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

Settings must be a JSON object of at most 4 KB, and the summary (shown on the invite) at most 140 characters. In setup purpose, match methods (`room.send`, `submit`, `state.*`, `turn.end`, `round.set`, `stats.report`, `achievements.unlock`) are refused with `forbidden`. `ready()`, `ui.*`, `storage.*` and `media.upload` still work, so a setup screen can upload a picture and put its URL in the settings.

### Spectators

People can watch a match without a seat. A spectator gets `role: "spectator"`, `seat: -1`, and is never listed in `players`. They receive room messages, state changes, turns, rounds and reactions, and they can read `state`. They can't `submit`, `forfeit`, `room.send`, `state.set`/`update`, `turn.end`, `round.set`, `media.upload`, `stats.report`, `achievements.unlock` or `storage.set`/`delete`; the SDK and the host refuse those with `forbidden`. They can still read storage.

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
| `stats: [...]` | `?xapps-stats=<json>` | Manifest stats. `stats.report` aggregates them in memory. |
| `achievements: [...]` | `?xapps-achievements=<json>` | Manifest achievements. Each unlocks once, with a small banner and an `achievement.unlock` event. |
| `appStorage: {…}` | | Seeds the read-only `app` storage scope |
| `probeMedia: false` | | Skip reading width/height/duration of uploads |

`createMockHost()` also returns `setState(state, by?)`, `endTurn(next?)`, `setRound(n)` and `setAppStorage(key, value)` so tests can simulate the other players and your server, plus `stats`, `achievements` and `uploads` to inspect. In the mock, uploads become object URLs (`blob:…`) that only live as long as the page, and user storage lives in `localStorage` under `xapps-mock:`.

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
| `storage.get` | | `{ key, scope? }` → value or `null` (`scope` defaults to `"user"`) |
| `storage.set` | | `{ key, value }` → `null` (user scope) |
| `storage.delete` | `storageDelete` | `{ key }` → `null` (user scope) |
| `storage.list` | `storageList` | `{ prefix?, scope? }` → `string[]` |
| `media.upload` | `uploadMedia` | `{ file: Blob, alt? }` → `MediaRef`. Type and size are already checked; enforce the daily quotas. |
| `stats.report` | `reportStats` | `{ values }` → `{ [key]: newValue }` |
| `achievements.unlock` | `unlockAchievement` | `{ id }` → `{ unlocked }`. Call `bridge.emitAchievement(id, userId)` when it's new. |

The core validates params and refuses by purpose and role (read from `context()`, or from an `access()` option) before calling your handler. Push changes with `bridge.emitState(state, version, by)`, `bridge.emitTurn(turn, deadline)` and `bridge.emitRound(round)`, or emit a `match.update`, from which the client derives the same events. Emit before you answer `turn.end` so the app sees the new turn first. `rankPlayers(entries, "high" | "low", { teams })` computes placements, ties and team sums.

The `file` of a `media.upload` comes from the app's window, so it is a `Blob` of *another realm*: `instanceof Blob` is false on the host. Use `isBlobLike()` (duck-typed), `mediaKindOf(mime)` and `mediaProblem(file)` from `@xapps/sdk/host`; `displayProblem(display)`, `statsProblem(values, defs?)`, `achievementProblem(id, defs?)` and `aggregateStat(aggregate, previous, value)` are there too. When `context().app.stats` / `.achievements` are set, the core also refuses undeclared stat keys and achievement ids.


## Media & data

Everything in this section is additive; apps that don't use it are unaffected.

### Media uploads

`xapps.media.upload(blob, { alt? })` hands a `Blob` (or `File`) to the host, which stores it for the signed-in player and returns a `MediaRef`:

```ts
interface MediaRef { url: string; kind: "image" | "audio" | "video"; mime: string; bytes: number; width?: number; height?: number; duration?: number }
```

| Kind | Types | Max size |
| --- | --- | --- |
| image | jpeg, png, webp, gif | 8 MB |
| audio | mpeg, mp4, ogg, webm, wav | 10 MB |
| video | mp4, webm, quicktime | 25 MB |

Per player per app: 60 uploads and 200 MB per rolling 24 h (error code `rate_limited`). Codec parameters are ignored (`video/webm;codecs=vp9` is a webm video), and `xapps.media.kindOf(mime)` tells you the kind (or `null`) before you record anything. Uploads work in match and setup purpose; spectators get `forbidden`. The SDK checks type and size before sending, and the host checks again.

Entries can then show the media. Media URLs must be ones the host issued (`media.upload` results):

| `display` | Notes |
| --- | --- |
| `{ kind: "video", url, alt, poster? }` | Plays muted when in view, loops; tap for sound |
| `{ kind: "audio", url, alt, cover? }` | Audio player, `cover` image optional |
| `{ kind: "gallery", items: [{ url, alt }, …] }` | 2–6 images, swipeable |
| `{ kind: "image", url, alt }` | As before; an upload URL works too |

`alt` is required for video, audio and every gallery item.

Record a 5-second clip and submit it as a crowd-judged entry:

```ts
const xapps = await connect();

async function recordClip(seconds = 5): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  const type = ["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return new Blob(chunks, { type: recorder.mimeType });
}

const clip = await recordClip();
if (xapps.media.kindOf(clip.type) !== "video") throw new Error(`Can't upload ${clip.type}`);
const video = await xapps.media.upload(clip, { alt: "My 5-second impression" });
await xapps.submit({
  data: { seconds: video.duration ?? 5 },
  display: { kind: "video", url: video.url, alt: "My 5-second impression" },
});
```

The iframe needs camera/microphone permission from the host for `getUserMedia`; picking a file with `<input type="file" accept="video/*">` works everywhere. Uploads can take a while: the SDK waits up to 120 s (`upload(file, { timeoutMs })`).

React:

```tsx
import { useMediaUpload } from "@xapps/sdk/react";

function DropPicker({ onPicked }: { onPicked: (url: string) => void }) {
  const { upload, uploading, error } = useMediaUpload();
  return (
    <label>
      <input type="file" accept="image/*" disabled={uploading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) onPicked((await upload(file, { alt: file.name })).url);
        }} />
      {uploading ? "Uploading…" : error?.message}
    </label>
  );
}
```

### Storage scopes

| Scope | Who reads | Who writes | Use it for |
| --- | --- | --- | --- |
| `user` (default) | the player | the player's client | saves, preferences, unlocked levels |
| `app` | everyone | only your server (`storageSet`, `PUT /api/v1/storage/:key`) | daily puzzles, config, seasons |

```ts
const progress = await xapps.storage.get<{ level: number }>("progress");      // user scope
await xapps.storage.set("progress", { level: (progress?.level ?? 0) + 1 });
await xapps.storage.delete("old-save");
const saves = await xapps.storage.list({ prefix: "save:" });                 // keys only

const puzzle = await xapps.storage.get("puzzle:2026-09-29", { scope: "app" }); // written by your server
const days = await xapps.storage.list({ prefix: "puzzle:", scope: "app" });
```

Values are JSON of at most 64 KB; keys are 1–64 characters; each player has at most 200 keys per app. `set`/`delete` are user scope only.

### Stats & leaderboards

Declare up to 8 stats in your manifest: `{ key, label, aggregate: "max" | "min" | "sum" | "last", format?: "number" | "ms" | "percent" }` with keys like `best_time` (`^[a-z][a-z0-9_]{0,31}$`). The platform keeps one value per player per stat, folds every report into it with the aggregate, and shows a leaderboard tab per stat on your app page (a `min` stat ranks ascending) and the player's stats on their profile.

```ts
xapps.stats.defs;                                         // [{ key: "best_time", label: "Best time", aggregate: "min", format: "ms" }, …]
const now = await xapps.stats.report({ best_time: 8_420, wins: 1 });
// → { best_time: 7_900 (your best so far), wins: 12 (running sum) }
```

Values must be finite numbers, and keys must be declared (the SDK checks against `stats.defs` when the host sends them). Server-authoritative apps report from their server with `reportStats(userId, values)` instead. `stats.report` isn't available in setup purpose or to spectators.

### Achievements

Declare up to 30 achievements: `{ id, name, description, icon (one emoji), xp (0–100), secret?: boolean }`, at most 500 XP in total. XP is awarded once, and secret achievements stay hidden on profiles until unlocked.

```ts
if (won && !xapps.achievements.unlocked.has("first_win")) {
  const { unlocked } = await xapps.achievements.unlock("first_win"); // false if the player already had it
}

xapps.onAchievement(({ id, userId }, def) => {
  // Anyone in the match, you included. The host already shows the toast, sound and confetti.
  if (userId !== xapps.me.id) showTicker(`${xapps.player(userId)?.name} unlocked ${def?.icon} ${def?.name}`);
});
```

`achievements.unlocked` holds the ids this player unlocked (or was confirmed to already have) during this session.

React:

```tsx
import { useAchievementEvents, useAchievements, useStats } from "@xapps/sdk/react";

const { defs, report } = useStats();
const { defs: badges, unlock, unlocked } = useAchievements();  // `unlocked` re-renders on change
useAchievementEvents(({ id, userId }, def) => console.log(userId, "unlocked", def?.name ?? id));
```

## Testing

- **Standalone**: open your app directly (not in an iframe), and `connect()` starts a mock host where you play against a bot.
- **Standalone, N players**: see [Testing multiplayer locally](#testing-multiplayer-locally) for more seats, teams, turns, spectating and setup mode.
- **Sandbox**: `/developers/sandbox` on any XApps host runs two seats side by side with a protocol log.
- **Framing**: your server must allow XApps to embed you, e.g. `Content-Security-Policy: frame-ancestors https://<xapps-host>`.

## Trust model

Scores are reported by clients. Use the shared seed for anything both players must agree on, commit-reveal for secret picks (see `examples/rps`), and crowd judging for creative formats.

For matches that must not trust clients at all, run a server: see below.

## Server authority & webhooks

An app with its own server can be the referee. Players' browsers stay untrusted; your server holds two secrets from the app's **Server** panel on XApps (each shown once):

- the **app secret** (`xas_…`) to call the server API, and
- the **webhook signing secret** (`whsec_…`) to verify the events XApps sends to your webhook URL.

Switch the app to `authority: "server"` and `xapps.submit()` only records entries (the score is a *claim*): the match settles when your server calls `reportResult`. If every player has submitted and your server hasn't reported within 24 h, the platform settles a draw and sends `match.ended` with `reason: "server_timeout"`.

`@xapps/sdk/server` uses only `fetch` and Web Crypto, so it runs on Node 20+, Deno, Bun, Cloudflare Workers and edge runtimes. Never import it in browser code.

```ts
import { createServerClient } from "@xapps/sdk/server";

const xapps = createServerClient({ secret: process.env.XAPPS_SECRET!, baseUrl: "https://<xapps-host>" });

await xapps.getMatch(id);                                  // every player's entry (data included)
await xapps.setState(id, state, expectedVersion);           // → { version }; XAppsError "conflict" if it moved
await xapps.updateState(id, (state, match) => next);        // read-modify-write, retries on conflict
await xapps.endTurn(id, nextPlayerId);                      // or endTurn(id) for the next seat
await xapps.setRound(id, 3);
await xapps.reportResult(id, { scores: { [alice]: 12, [bob]: 9 } });          // ranked by your scoring
await xapps.reportResult(id, { ranks: { [alice]: 1, [bob]: 2 } }, { leavers: [carol] });

await xapps.storageSet("puzzle:2026-09-29", { grid, answer });  // app scope: every player can read it
await xapps.storageDelete("puzzle:2026-09-28");
await xapps.reportStats(alice, { best_time: 7_900 });        // → { best_time: <new aggregate> }
await xapps.unlockAchievement(alice, "first_win");           // → { unlocked: boolean }
```

Server-authoritative apps should report stats and unlock achievements from their server (for example when a `match.submitted` entry checks out), since anything a client does can be faked.

### Next.js route (Node or edge)

```ts
// app/api/xapps/webhook/route.ts
import { createServerClient, verifyWebhook, XAppsError } from "@xapps/sdk/server";

const xapps = createServerClient({ secret: process.env.XAPPS_SECRET!, baseUrl: process.env.XAPPS_URL! });

export async function POST(request: Request) {
  const raw = await request.text(); // the raw body: don't JSON.parse before verifying
  let event;
  try {
    event = await verifyWebhook(raw, request.headers.get("x-xapps-signature"), process.env.XAPPS_WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof XAppsError) return new Response(error.code, { status: 400 });
    throw error;
  }

  if (event.type === "match.submitted") {
    const { match } = event;
    const players = match.players.filter((p) => p.role === "player");
    if (players.every((p) => p.state === "submitted")) {
      // Re-score every entry on the server instead of trusting the claimed scores.
      const scores = Object.fromEntries(players.map((p) => [p.userId, scoreEntry(p.submission?.data)]));
      await xapps.reportResult(match.id, { scores }).catch((error) => {
        // Another delivery already settled it.
        if (!(error instanceof XAppsError && error.code === "invalid_state")) throw error;
      });
    }
  }
  return new Response("ok"); // any 2xx marks the delivery done; anything else is retried with backoff
}
```

With Express, verify against the raw bytes: `app.post("/xapps/webhook", express.raw({ type: "application/json" }), …)` and pass `req.body.toString("utf8")` and `req.get("x-xapps-signature")`.

### Cloudflare Worker

```ts
import { createServerClient, verifyWebhook, XAppsError } from "@xapps/sdk/server";

interface Env {
  XAPPS_URL: string;
  XAPPS_SECRET: string;
  XAPPS_WEBHOOK_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const raw = await request.text();
    try {
      const event = await verifyWebhook(raw, request.headers.get("x-xapps-signature"), env.XAPPS_WEBHOOK_SECRET);
      if (event.type === "match.state" && isGameOver(event.match.state)) {
        const xapps = createServerClient({ secret: env.XAPPS_SECRET, baseUrl: env.XAPPS_URL });
        await xapps.reportResult(event.match.id, { ranks: ranksFrom(event.match.state) });
      }
      return new Response("ok");
    } catch (error) {
      if (error instanceof XAppsError && error.code.endsWith("_signature")) return new Response(error.code, { status: 400 });
      throw error; // a 5xx makes XApps retry
    }
  },
};
```

### Webhooks

| Event | When |
| --- | --- |
| `match.created` / `match.started` | A match of your app was created / started |
| `match.state` | The shared state changed (debounced: at most one pending per match) |
| `match.turn` | The turn moved |
| `match.submitted` | A player submitted an entry |
| `match.ended` | The match settled (`reason: "server_timeout"` for the 24 h safety valve) |
| `ping` | "Send test event" in the Server panel (`match` is null) |
| `achievement.unlocked` | A player unlocked one of your achievements (from their client or your server): `{ userId, achievementId }`, `match` is null |

Each delivery is a `POST` with the JSON body `{ id, type, createdAt, app: { slug }, match }` (the match as it was when the event was queued; call `getMatch` for the latest) and the headers `X-XApps-Event`, `X-XApps-Delivery` (a uuid) and `X-XApps-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(signing secret, t + "." + body)>`. `verifyWebhook` rejects signatures older than 5 minutes (`toleranceSeconds`), accepts any of several `v1` values, and throws `XAppsError` with code `invalid_signature`, `stale_signature` or `invalid_payload`. Non-2xx responses are retried with backoff (1, 2, 4 … 256 min, 9 attempts), so handle events idempotently (dedupe by `event.id`). `signWebhook(body, secret)` builds a header for tests.

### Server API

The client wraps these routes on the XApps host. Call them directly from any language with `Authorization: Bearer xas_…`:

| Route | Body | Success |
| --- | --- | --- |
| `GET /api/v1/matches/:id` | | the match |
| `PUT /api/v1/matches/:id/state` | `{ state, expectedVersion }` | `{ version }` |
| `POST /api/v1/matches/:id/turn` | `{ next? }` | `{ ok: true }` |
| `POST /api/v1/matches/:id/round` | `{ round }` | `{ ok: true }` |
| `POST /api/v1/matches/:id/result` | `{ scores }` or `{ ranks }`, optional `leavers` | `{ ok: true }` |
| `PUT /api/v1/storage/:key` | `{ value }` (≤ 64 KB JSON) | `{ ok: true }` |
| `DELETE /api/v1/storage/:key` | | `{ ok: true }` (or 204) |
| `POST /api/v1/stats` | `{ userId, values }` | `{ values }` (new aggregates) |
| `POST /api/v1/achievements` | `{ userId, id }` | `{ unlocked }` |

Errors are `{ error: { code, message } }`: 401 `unauthorized` (missing or wrong secret), 403 `forbidden` (another app's match), 404 `not_found`, 409 `conflict` (state version moved) or `invalid_state` (e.g. already settled), 422 `invalid_params`, 501 `not_configured` (the host runs in demo mode: the server API and webhooks need Supabase).
