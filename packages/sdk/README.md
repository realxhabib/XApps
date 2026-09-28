# @xapps/sdk

Build head-to-head apps for **XApps**, the social app marketplace on X. The SDK is a small bridge (~16 KB minified, zero dependencies) between your app, running in a sandboxed iframe, and the XApps host. The host gives your app:

- **Identity**: every player is signed in with X (`handle`, `name`, `avatarUrl`).
- **Realtime rooms**: `room.send` / `room.on`, plus presence.
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
| `xapps.me` / `opponent` / `opponents` / `players` | `PlayerInfo`: `id, handle, name, avatarUrl, seat, isBot, submitted, score` |
| `xapps.match` | `id, mode (live·async·practice·sandbox), status, scoring, seed, settings` |
| `xapps.random` | Seeded by the match, identical on every client: `next, int, float, pick, shuffle, normal, chance, fork(label)` |
| `xapps.isHost` | `true` for seat 0, for when one client should referee |
| `ready()` · `onStart(fn)` · `onUpdate(fn)` · `onEnd(fn)` · `forfeit()` | Lifecycle |
| `submit({ score?, data?, display? })` · `submitFor(botId, …)` | `display` is `{kind:"text",title?,body}`, `{kind:"svg",svg,alt}` or `{kind:"image",url,alt}` (https) |
| `room.send(type, payload)` · `room.on(type, fn)` · `room.onAny(fn)` · `room.onPresence(fn)` | ≤ 8 KB payloads, ≤ 30 messages/s |
| `ui.setStatus` · `ui.setScores` · `ui.setTurn` · `ui.toast` · `ui.celebrate` · `ui.haptic` | Host UI |
| `social.share(text, url?)` | Opens the X composer. The player always confirms the post. |
| `storage.get(key)` · `storage.set(key, value)` | Per player, per app, ≤ 16 KB per value |

`@xapps/sdk/host` exports `createHostBridge` / `createHostCore` if you want to embed XApps apps yourself or write integration tests. `@xapps/sdk/protocol` has the wire types.

## Testing

- **Standalone**: open your app directly (not in an iframe), and `connect()` starts a mock host where you play against a bot.
- **Sandbox**: `/developers/sandbox` on any XApps host runs two seats side by side with a protocol log.
- **Framing**: your server must allow XApps to embed you, e.g. `Content-Security-Policy: frame-ancestors https://<xapps-host>`.

## Trust model

Scores are reported by clients. Use the shared seed for anything both players must agree on, commit-reveal for secret picks (see `examples/rps`), and crowd judging for creative formats.
