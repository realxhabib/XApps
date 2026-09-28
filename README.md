# XApps

**A social app marketplace on X.** Sign in with X, pick an app and go head-to-head with anyone:
reflex duels, meme battles judged by the crowd, hot-take debates, strategy and trivia races.
Anyone can build and list their own app with the `@xapps/sdk`.

- **Marketplace**: browse, search and filter apps. Each app card is a live animated vignette.
- **Challenges**: quick match, invite by `@handle`, or post an open challenge link to your timeline.
- **Play room**: every app runs inside a host that adds the drama: a VS intro, a 3-2-1 countdown, a HUD with presence and turn indicators, emoji reactions, results with XP and level-ups, rematch and share.
- **The Arena**: the crowd judges meme duels and hot takes. Entries stay anonymous until you vote, and every vote earns XP.
- **Profiles and leaderboards**: XP, levels, streaks, and rankings overall and per app.
- **Developer portal**: SDK docs, app registration with a live preview, and a **Sandbox** that runs two copies of your app side by side with a live protocol log.

| Default app | Format | Scoring |
| --- | --- | --- |
| 🖼️ Meme Duel | Caption the same template, drag stickers, and let the crowd vote | votes |
| ⚡ Reflexes | Best-of-five reflex duel, with reaction times measured on each device | rounds won |
| 🔥 Hot Takes | You're assigned a side; argue it in 280 characters, and the crowd picks the better argument | votes |
| 🔴 Four in a Row | Classic connect-four with physics and a minimax bot | win/draw/loss |
| 🧩 Emoji Decode | Eight emoji puzzles, where both speed and accuracy score | points |
| ✊ RPS Showdown | Example community app: **one HTML file**, commit-reveal included | rounds won |

The five default apps are built on the **same public SDK** that third-party developers use. They're only special in that they're served from `/embed/*`.

---

## Quick start (demo mode, no setup)

```bash
npm install
npm run dev          # http://localhost:3000
```

Without Supabase keys, XApps runs in **demo mode**. Everything lives in your browser: a cast of personas, bots that accept challenges and fill quick-match lobbies, and a simulated crowd that votes in the Arena. To play yourself live, sign in as one persona in one tab and as another persona in a second tab. The tabs talk through `BroadcastChannel`, just like two players on Supabase Realtime.

## Going live: Supabase + Sign in with X

1. **Create a Supabase project.**
2. **Install the schema.** Run [`supabase/migrations/20260928000000_xapps_core.sql`](supabase/migrations/20260928000000_xapps_core.sql) in the SQL editor. Or use the CLI: `npx supabase link --project-ref <ref> && npx supabase db push`. This creates the tables, row-level security, the match/vote/XP RPCs, realtime room authorization, and seeds the default apps plus the practice bot.
3. **Create an X app** in the [X developer portal](https://developer.x.com):
   - Turn on **OAuth 2.0** and choose the type *Web App*.
   - Set the callback URL to `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Copy the **Client ID** and **Client Secret**.
4. **Enable the provider** in Supabase under *Authentication → Providers → X / Twitter (OAuth 2.0)* and paste the client ID and secret.
5. **Allow the redirect** under *Authentication → URL Configuration*:
   - Set the Site URL to your domain.
   - Add `http://localhost:3000/auth/callback` and `https://<your-domain>/auth/callback` to the redirect URLs.
6. **Configure the web app.** Copy [`.env.example`](.env.example) to `apps/web/.env.local` and fill in the values:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   # or NEXT_PUBLIC_SUPABASE_ANON_KEY
   NEXT_PUBLIC_SUPABASE_X_PROVIDER=                          # optional: auto-detects "x" or legacy "twitter"
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

If the keys are set but the schema isn't installed yet, the app says so and offers a one-click switch to demo mode.

## Deploy

**Vercel** (recommended): import the repo and set **Root Directory** to `apps/web`. Leave *Include files outside the root directory* on, because the app imports `packages/sdk`. [`apps/web/vercel.json`](apps/web/vercel.json) already installs from the monorepo root and runs `npm run build`, which bundles the SDK and then runs `next build`. Use Node 22 (anything from 20.9 works). Add the four variables from step 6 in *Settings → Environment Variables*, with `NEXT_PUBLIC_SITE_URL` set to your production URL. Then add `https://<your-domain>/auth/callback` to the Supabase redirect URLs. Without the Supabase variables, the deployment runs in demo mode.

**Anywhere else**: `npm ci && npm run build && npm start` on Node 20.9+ serves on port 3000 (set `PORT` to change it).

**Reviewing community apps.** New submissions start as `pending` and are only visible to their developer. To publish one, run this in the SQL editor:

```sql
update public.apps set status = 'published' where slug = 'their-app';
```

## Architecture

```
┌──────────────────────────── XApps host (Next.js) ────────────────────────────┐
│  Marketplace · Challenges · Arena · Profiles · Developer portal              │
│                                                                              │
│  /play/[id]  ── Play room: VS intro, HUD, reactions, voting, results         │
│      │  createHostBridge()  (origin-pinned postMessage)                      │
│      ▼                                                                       │
│  ┌───────────────── sandboxed <iframe> ─────────────────┐                    │
│  │  Any app: first-party (/embed/*) or community (https) │                   │
│  │  connect() · room.send/on · submit() · ui.* · storage │  ← @xapps/sdk     │
│  └────────────────────────────────────────────────────────┘                  │
│      │                                                                       │
│  Backend interface ── SupabaseBackend (Postgres RPCs + RLS, Realtime rooms)  │
│                    └─ DemoBackend (localStorage + BroadcastChannel + bots)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Apps never see a session token.** They run in a sandboxed iframe, the host only answers messages from the app's registered origin, and the SDK pins the host's origin after the handshake.
- **All match writes go through `SECURITY DEFINER` RPCs** (`submit_entry`, `cast_vote`, `claim_forfeit`, …). Clients can't touch match tables directly. The settlement logic (winner, XP, streaks, per-app stats) lives in one SQL function.
- **Contest entries stay private until voting**, so an opponent can't read your caption early. Realtime rooms are private channels (`match:<id>`) that only the match's players can join.
- **Everything shared is seeded.** Every client gets the same `match.seed`, so prompts, puzzles and delays match on both screens without extra messages.

```
apps/web/                  Next.js 16 app (App Router, React 19, Tailwind v4, Motion)
  src/app/(site)/          marketplace pages       src/app/play/     play room
  src/app/embed/<slug>/    first-party app frames  src/first-party/  their code
  src/platform/            backend interface, demo + Supabase backends, queries
  src/components/          chrome, motion primitives, marketplace, play room
packages/sdk/              @xapps/sdk: protocol, client, host bridge, React hooks
examples/rps/              a complete app in one HTML file
supabase/migrations/       schema, RLS, RPCs, realtime auth
supabase/tests/            lifecycle tests against a plain local Postgres
```

## Build an app

```ts
import { connect } from "@xapps/sdk"; // or "https://<xapps-host>/sdk/v1.js" with no build step

const xapps = await connect();
xapps.room.on("move", (move, from) => apply(move, from));
xapps.onStart(() => startGame());
await xapps.ready();
// …
await xapps.submit({ score: 42 });
```

Full reference: the `/developers` page in the app and [`packages/sdk/README.md`](packages/sdk/README.md). You can open your app directly and the SDK starts a mock host with a bot opponent. Use `/developers/sandbox` to test both seats.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Builds the SDK bundle and starts Next.js on :3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Unit tests (SDK protocol, game logic, scoring) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run test:e2e` | Playwright end-to-end run in demo mode |
| `supabase/tests/run.sh` | Applies the migrations to a throwaway local Postgres and checks the whole match lifecycle, RLS included |

## Known limitations

- **Scores are client-reported.** Deterministic seeds and commit-reveal limit cheating, and a cheater can only turn a loss into a draw by also claiming the win. Fully server-authoritative play would need game servers.
- **Crowd-judged content is user-generated.** Before a public launch, add reporting and moderation for captions and takes.
- **Async runs aren't locked.** A player who leaves before submitting can replay the run.
