"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  Boxes,
  KeyRound,
  ServerCog,
  Smartphone,
  Webhook,
  FlaskConical,
  Fingerprint,
  Gavel,
  Film,
  Medal,
  MonitorPlay,
  Plus,
  Layers,
  Radio,
  ShieldCheck,
  Trophy,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SERVER_ROUTES, SIGNATURE_FORMAT, API_ERRORS, WEBHOOK_EVENTS, reportSnippet, webhookSnippet } from "@/components/developers/server-snippets";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Segmented } from "@/components/ui/segmented";
import { spring } from "@/lib/motion";
import { useOrigin } from "@/lib/use-origin";
import { cn } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { useAppServerConfig, useMyApps } from "@/platform/queries";
import type { AppManifest } from "@/platform/types";
import { LIMITS } from "@xapps/sdk";

const FEATURES = [
  { icon: Fingerprint, title: "X identity", body: "Every player arrives signed in with their X handle and avatar. No auth code on your side." },
  { icon: Radio, title: "Realtime rooms", body: "Broadcast moves and see who's connected. Seeded randomness keeps both screens in sync." },
  { icon: Boxes, title: "Matchmaking", body: "Quick match, invites by @handle and open challenge links that go viral on the timeline." },
  { icon: Users, title: "2 to 8 players", body: "Free-for-alls, 2–4 teams and spectators. Lobbies, seats and podiums are handled for you." },
  { icon: Layers, title: "Shared state & turns", body: "A versioned match document every client sees, plus turns and rounds — live or over days." },
  { icon: Trophy, title: "Results & XP", body: "Submit a score; the platform settles the match, awards XP and updates leaderboards." },
  { icon: Gavel, title: "Crowd judging", body: "Contest apps submit an entry and the Arena crowd votes. Ideal for creative formats." },
  { icon: MonitorPlay, title: "Host-rendered drama", body: "VS intro, countdown, HUD, emoji reactions, confetti and results screens come free." },
  { icon: ServerCog, title: "Your server as referee", body: "An app secret, a server API and signed webhooks. Declare server authority and only your backend can settle a match." },
  { icon: Film, title: "Media entries", body: "Upload images, audio and video from your app. Entries can be clips, sounds or swipeable galleries — the Arena plays them all." },
  { icon: Medal, title: "Stats & achievements", body: "Declare stats and get leaderboards on your listing. Unlock achievements with a host-rendered moment and XP on profiles." },
];

const REACT_SNIPPET = `import { XAppsProvider, useXApps, useRoomEvent, useMatchStarted } from "@xapps/sdk/react";

export default function App() {
  return (
    <XAppsProvider fallback={<p>Loading…</p>}>
      <Game />
    </XAppsProvider>
  );
}

function Game() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const [taps, setTaps] = useState(0);

  useEffect(() => void xapps.ready(), [xapps]);            // show your intro, then say ready
  useRoomEvent("tap", (payload, from) => bump(from));     // messages from the other player

  const tap = () => {
    setTaps((n) => n + 1);
    xapps.room.send("tap", { at: Date.now() });
  };

  const done = () => xapps.submit({ score: taps });        // the platform decides the winner
  return started ? <button onClick={tap}>Tap! {taps}</button> : <p>Get ready…</p>;
}`;

const vanillaSnippet = (origin: string) => `<script type="module">
  import { connect } from "${origin}/sdk/v1.js";

  const xapps = await connect();
  document.title = \`@\${xapps.me.handle} vs @\${xapps.opponent?.handle}\`;

  xapps.room.on("move", (move, from) => applyMove(move, from));
  xapps.onStart(() => startGame());

  // Bots only appear in practice — your app plays for them.
  const bot = xapps.opponents.find((p) => p.isBot);

  await xapps.ready();
  // …when the game ends:
  await xapps.submit({ score: myScore, data: { moves } });
  if (bot) await xapps.submitFor(bot.id, { score: botScore });
</script>`;

const CONTEST_SNIPPET = `// Scoring "votes": no score — describe the entry the Arena will judge.
await xapps.submit({
  data: { caption, templateId },            // anything you want to keep
  display: {
    kind: "svg",                            // or "text" / "image" / "video" / "audio" / "gallery"
    svg: renderMySvg(caption),              // self-contained SVG, shown via <img>
    alt: caption,
  },
});`;

const MEDIA_SNIPPET = `// A clip recorded in your app becomes the entry the Arena plays.
const clip = await xapps.media.upload(recordedBlob, { alt: "My 10-second trick shot" });
// → { url, kind: "video", mime, bytes, width, height, duration }

await xapps.submit({
  display: { kind: "video", url: clip.url, alt: "My 10-second trick shot" },
  // audio:   { kind: "audio", url, alt, cover? }
  // gallery: { kind: "gallery", items: [{ url, alt }, …] }   (2–6 uploaded images)
});

// Progression from your manifest's stats + achievements.
await xapps.stats.report({ best_time: 8120, runs: 1 });   // max/min/sum/last per stat
const { unlocked } = await xapps.achievements.unlock("first_clip");
xapps.onAchievement(({ id, userId }) => cheer(userId, id)); // anyone in the match

// Storage: private per player, or the app's public space your server writes.
await xapps.storage.set("settings", { sfx: false });
const puzzle = await xapps.storage.get("daily", { scope: "app" });`;

const TURNS_SNIPPET = `import { connect } from "@xapps/sdk";

const xapps = await connect();                     // manifest: turnBased: true, modes: ["live", "async"]

// Everyone sees the same versioned document, days later too.
xapps.state.onChange((board) => render(board));
xapps.onTurn(({ turn }) => highlight(turn === xapps.me.id));
await xapps.ready();

async function play(move) {
  if (!xapps.turn.isMine) return;
  await xapps.state.update((board) => applyMove(board ?? newBoard(), move));  // retries on conflicts
  await xapps.turn.end();                           // next seated player's move (inbox pings them)
}`;

const standaloneSnippet = (origin: string) => `// manifest: kind "app" — people open it at /apps/<slug>/open, no matches.
import { connect } from "${origin}/sdk/v1.js";

const xapps = await connect({ mock: { purpose: "app" } }); // mock: outside XApps too
// xapps.purpose === "app": no ready(), no onStart, no submit. Just render.

hello.textContent = \`Hey @\${xapps.user.handle}\`;         // always signed in with X
const watchlist = (await xapps.storage.get("watchlist")) ?? [];

async function add(ticker) {
  watchlist.push(ticker);
  await xapps.storage.set("watchlist", watchlist);          // private to this viewer
  await xapps.stats.report({ tracked: watchlist.length });  // stats from your manifest
  await xapps.achievements.unlock("first_pick");            // the host shows the toast
  xapps.ui.setStatus(\`\${watchlist.length} tickers\`);      // shown in the host's top bar
}`;

const soloSnippet = (origin: string) => `// manifest: kind "app", stats: best (aggregate "max", format "percent") and runs (aggregate "sum")
// The Perfect Circle / Greg's Face pattern: play as often as you like, climb a worldwide board.
import { connect } from "${origin}/sdk/v1.js";

const xapps = await connect({ mock: { purpose: "app" } });

async function finished(score) {                        // e.g. 97.3
  await xapps.stats.report({ best: score, runs: 1 });    // max keeps your best
  const board = await xapps.stats.leaderboard("best", { limit: 5 });
  // board.me → { rank: 14, value: 97.3 } · board.total → 2380 · board.top → [{ rank, player, value }]
  showStanding(\`#\${board.me.rank} of \${board.total}\`, board.top);
}

async function share(canvas, score) {
  const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
  const image = await xapps.media.upload(blob, { alt: \`My \${score}% run\` });
  // X shows the uploaded image as a big card: the host posts it via a page with card tags.
  await xapps.social.share(\`I scored \${score}% on XApps\`, image.url);
}`;

type SnippetTab = "react" | "vanilla" | "contest" | "turns" | "media" | "app" | "solo";

const LIFECYCLE = [
  { title: "Load", body: "Host opens your URL in a sandboxed iframe." },
  { title: "Handshake", body: "connect() receives players, seed and mode." },
  { title: "ready()", body: "You render, then signal you're ready." },
  { title: "VS intro", body: "Host plays the versus + 3-2-1." },
  { title: "onStart", body: "Game on. Talk through the room." },
  { title: "submit()", body: "Send your score or entry." },
  { title: "Settle", body: "Platform picks the winner, awards XP." },
  { title: "onEnd", body: "Host shows results, rematch, share." },
];

const API: { group: string; rows: [string, string][] }[] = [
  {
    group: "Connect & context",
    rows: [
      ["connect(options?)", "Handshake with the host. Returns the shared client (safe to call many times). Opened directly, it starts a local mock host."],
      ["xapps.me · xapps.players · xapps.opponents", "PlayerInfo: id, handle, name, avatarUrl, seat, team, role, isBot, submitted, score. `opponent` is the first opponent (1v1 apps)."],
      ["xapps.teammates · xapps.role · xapps.isSpectator", "Team play and watching: spectators see everything but can't submit, send or write state."],
      ["xapps.match", "id, mode (live | async | practice | sandbox), status, scoring, seed, settings, minPlayers, maxPlayers, teams."],
      ["xapps.purpose", "\"match\", or \"setup\" when the host opens you to set up a challenge (manifest setup: true)."],
      ["xapps.random", "Seeded RNG shared by every client: next(), int(), pick(), shuffle(), normal(), fork(label)."],
      ["xapps.isHost", "True for seat 0 — handy when one client should referee."],
    ],
  },
  {
    group: "Lifecycle",
    rows: [
      ["xapps.ready()", "Call once your first screen is rendered. The match starts when everyone is ready."],
      ["xapps.onStart(fn)", "Fires after the host's VS intro (immediately if the match already started)."],
      ["xapps.submit({ score?, data?, display? })", "Your final result. Score for high/low scoring, display for crowd-judged apps."],
      ["xapps.submitFor(botId, submission)", "Submit on behalf of a bot you're simulating (practice & sandbox)."],
      ["xapps.onUpdate(fn) · xapps.onEnd(fn)", "Match changes (opponent submitted, votes) and the final result."],
      ["xapps.forfeit()", "Concede the match."],
    ],
  },
  {
    group: "Realtime room",
    rows: [
      ["xapps.room.send(type, payload)", `Broadcast JSON to the other players (≤ ${LIMITS.roomPayloadBytes / 1024} KB, ≤ ${LIMITS.roomMessagesPerSecond}/s).`],
      ["xapps.room.on(type, (payload, from) => …)", "Listen for one event type. Returns an unsubscribe function."],
      ["xapps.room.onPresence(fn) · room.online()", "Who's connected right now."],
      ["xapps.onReaction(fn)", "Emoji reactions players fire from the HUD."],
    ],
  },
  {
    group: "Shared state, turns & rounds",
    rows: [
      ["xapps.state.get() · set(value, version?)", `One JSON document per match (≤ ${LIMITS.matchStateBytes / 1024} KB), versioned: a stale write fails with "conflict".`],
      ["xapps.state.update(draft => next)", "Read-modify-write that re-reads and retries on conflicts. Persists, so turn-based games resume days later."],
      ["xapps.state.onChange(fn)", "Every change from any player (your own writes included)."],
      ["xapps.turn.current · isMine · deadline · end(next?)", "Whose move it is. end() passes to the next seated player (or who you name). Async turns have a 3-day deadline."],
      ["xapps.round.set(n) · onRound(fn)", "Round counter shown in the host HUD. Never goes backwards."],
    ],
  },
  {
    group: "Challenge setup (setup: true)",
    rows: [
      ["xapps.setup.submit(settings, summary?)", `Render your own setup screen inside the challenge sheet; settings (≤ ${LIMITS.setupSettingsBytes / 1024} KB) become match.settings.`],
      ["xapps.setup.cancel()", "Close setup without choosing."],
      ["?xapps-purpose=setup", "Open your app directly with this to test the setup screen against the mock host."],
    ],
  },
  {
    group: "Host UI & extras",
    rows: [
      ["xapps.ui.setStatus(text) · setScores(map) · setTurn(id)", "Drive the host HUD above your app."],
      ["xapps.ui.toast(msg) · celebrate() · haptic(style)", "Host-rendered toasts, confetti and vibration."],
      ["xapps.ui.lockGestures(element)", "Makes a canvas/board/slider a drag surface: no page scroll, bounce or pull-to-refresh while touching it, iOS included. Returns an undo function. React: useGestureLock(ref). connect() already stops your page from bouncing inside XApps."],
      ["xapps.social.share(text, url?)", "Opens the X composer, pre-filled. The user always confirms. Pass a media.upload image URL and X shows the picture as a large card."],
    ],
  },
  {
    group: "Media & entries",
    rows: [
      ["xapps.media.upload(blob, { alt? })", `→ MediaRef { url, kind, mime, bytes, width?, height?, duration? }. Images (JPEG/PNG/WebP/GIF) ≤ ${LIMITS.media.image.maxBytes / 1048576} MB, audio (MP3/M4A/Ogg/WebM/WAV) ≤ ${LIMITS.media.audio.maxBytes / 1048576} MB, video (MP4/WebM/MOV) ≤ ${LIMITS.media.video.maxBytes / 1048576} MB.`],
      ["Quota", `${LIMITS.media.uploadsPerDay} uploads and ${LIMITS.media.bytesPerDay / 1048576} MB per player per app per rolling 24 h (error code rate_limited). Match, setup and standalone apps; spectators can't upload.`],
      ["display: { kind: \"video\", url, alt, poster? }", "Plays muted when in view and loops; tap for sound."],
      ["display: { kind: \"audio\", url, alt, cover? }", "A compact waveform player with play/pause and seeking."],
      ["display: { kind: \"gallery\", items: [{ url, alt }] }", `${LIMITS.galleryItems.min}–${LIMITS.galleryItems.max} images, swipeable with dots and arrow keys.`],
      ["Allowed media URLs", "Only files from media.upload (our app-media storage). Other URLs, blob: and data: are refused in video/audio/gallery entries and meme drops."],
    ],
  },
  {
    group: "Storage",
    rows: [
      ["xapps.storage.get(key, { scope? }) · set(key, value)", `scope "user" (default) is private to the player: ≤ ${LIMITS.storageValueBytes / 1024} KB per value, ≤ ${LIMITS.storageKeysPerUser} keys per app.`],
      ["xapps.storage.delete(key) · list({ prefix?, scope? })", "Remove a key; list keys (sorted), optionally by prefix."],
      ["scope: \"app\"", "One public key/value space per app: every player reads it, only your server writes it (PUT /api/v1/storage/:key). Daily puzzles, config, seasons."],
    ],
  },
  {
    group: "Stats & achievements",
    rows: [
      ["xapps.stats.report({ [key]: number })", "Applies each stat's aggregate (max · min · sum · last) and resolves with the new values. Keys must be in your manifest."],
      ["xapps.stats.leaderboard(key, { limit? })", "→ { top, me, total }: the stat's global board (best first, ties share a rank; 10 rows, up to 50), the viewer's { rank, value } (null before their first value) and how many people have one. \"#14 of 2,380\". Read-only: every purpose, spectators too."],
      ["xapps.stats.defs · xapps.achievements.defs", "What your manifest declares, from the launch context."],
      ["xapps.achievements.unlock(id)", "→ { unlocked } (false if the player already had it). XP is added to their profile once; the host shows the unlock moment."],
      ["xapps.onAchievement(fn)", "achievement.unlock { id, userId } — the player, or someone else in a live match."],
      ["Server authority", "Server-authoritative apps report stats and unlock achievements only from their server: POST /api/v1/stats · /api/v1/achievements."],
      ["useStats() · useAchievements() · useMediaUpload()", "React hooks (@xapps/sdk/react)."],
    ],
  },
  {
    group: "Server SDK (@xapps/sdk/server)",
    rows: [
      ["verifyWebhook(rawBody, signatureHeader, secret, { toleranceSeconds? })", "Checks X-XApps-Signature and returns the parsed event. Throws XAppsError invalid_signature or stale_signature (older than 5 min by default). Accepts several v1 signatures during a rotation. Web Crypto only: Node 18+, Deno, Workers, edge."],
      ["createServerClient({ secret, baseUrl })", "A client for the server API, authenticated with your xas_ secret. Never ship it to the browser."],
      ["server.getMatch(id)", "The match with every player's submission, data included."],
      ["server.setState(id, state, version) · updateState(id, fn)", "Compare-and-set the shared state; updateState re-reads and retries on 409."],
      ["server.endTurn(id, next?) · setRound(id, round)", "Drive turns and rounds from your server."],
      ["server.reportResult(id, { scores } | { ranks }, { leavers? })", "Settle the match (ranks win if both are given). The only way to settle with server authority."],
    ],
  },
  {
    group: "React (@xapps/sdk/react)",
    rows: [
      ["<XAppsProvider fallback errorFallback>", "Connects once and provides the client."],
      ["useXApps() · useMatch() · usePresence()", "Client, live match object, connected players."],
      ["useRoomEvent(type, handler) · useReactions(handler)", "Subscriptions that clean themselves up."],
      ["useMatchStarted() · useMatchResult()", "Booleans/results that re-render when they change."],
      ["useMatchState() · useTurn() · useRound()", "{ state, version, set, update } · { turn, isMine, deadline, end } · { round, set }."],
      ["usePlayers() · useSetup()", "{ players, opponents, teammates, me, role } · { isSetup, submit, cancel }."],
    ],
  },
];

const MANIFEST: [string, string][] = [
  ["slug", "URL id, lowercase letters/numbers/dashes (e.g. tap-race)"],
  ["name · tagline · description", "How your app is listed"],
  ["category", "games · contests · debates · trivia · creative · social"],
  ["icon · accent", "One emoji + a two-color gradient"],
  ["url", "https URL of your app (must allow framing by XApps)"],
  ["modes", "live (same time) · async (play anytime) · practice (vs bots)"],
  ["players", "{ min, max } seats per match, 2–8"],
  ["teams", "0 for free-for-all, or 2–4 teams (seat s plays for team s % teams)"],
  ["spectators", "Let others watch live matches (default on)"],
  ["turnBased", "Players take turns; the host shows turn UI and pings whoever's up"],
  ["setup", "You render your own challenge setup screen"],
  ["scoring", "high (bigger wins) · low (smaller wins) · votes (crowd decides)"],
  ["authority", "client (default) · server — set on your app's Server panel once it has a secret; not for votes apps"],
  ["stats", `Up to ${LIMITS.maxStats}: { key, label, aggregate: max | min | sum | last, format?: number | ms | percent (0–100) }. Key like best_time`],
  ["achievements", `Up to ${LIMITS.maxAchievements}: { id, name, description, icon (one emoji), xp (0–100), secret? }; at most ${LIMITS.maxAchievementXpPerApp} XP in total`],
  ["howTo", "Up to 3 short steps shown on your listing"],
];

function MyApps() {
  const { viewer } = useViewer();
  const { data } = useMyApps();
  if (!viewer || !data || data.length === 0) return null;
  return (
    <section className="mt-16">
      <h2 className="font-display text-2xl font-extrabold">Your apps</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.map((app) => (
          <MyAppCard key={app.slug} app={app} />
        ))}
      </div>
    </section>
  );
}

function MyAppCard({ app }: { app: AppManifest }) {
  const { data: server } = useAppServerConfig(app.slug);
  const authority = server?.authority ?? app.authority ?? "client";
  return (
    <div className="rounded-3xl glass p-2 transition hover:bg-white/[0.05]">
      <Link href={`/developers/apps/${app.slug}`} className="flex items-center gap-3 rounded-2xl p-2">
        <AppGlyph app={app} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{app.name}</p>
          <p className="truncate text-xs text-ink-400">{app.url}</p>
        </div>
        <Badge tone={app.status === "published" ? "success" : app.status === "pending" ? "gold" : "danger"}>{app.status}</Badge>
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-white/[0.06] px-2 pb-1 pt-2.5 text-xs text-ink-400">
        <span className={cn("flex items-center gap-1.5", authority === "server" ? "text-volt" : "text-ink-300")}>
          {authority === "server" ? <ServerCog className="size-3.5" /> : <Smartphone className="size-3.5" />}
          {authority === "server" ? "Server settles" : "Clients settle"}
        </span>
        <span className={cn("flex items-center gap-1.5", server?.hasSecret && "text-ink-200")}>
          <KeyRound className="size-3.5" /> {server ? (server.hasSecret ? <span className="font-mono">{server.secretPrefix}…</span> : "No secret") : "…"}
        </span>
        <span className={cn("flex items-center gap-1.5", server?.hasWebhook && "text-ink-200")}>
          <Webhook className="size-3.5" /> {server ? (server.hasWebhook ? "Webhook on" : "No webhook") : "…"}
        </span>
        <Link href={`/developers/apps/${app.slug}?tab=server`} className="inline-flex items-center gap-1 font-semibold text-ink-300 hover:text-ink-100 hover:underline">
          Server
        </Link>
        <Link href={`/developers/apps/${app.slug}`} className="ml-auto inline-flex items-center gap-1 font-semibold text-nova-300 hover:underline">
          Console <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

const TRUST_PILLARS = [
  {
    icon: KeyRound,
    title: "App secret",
    body: "xas_ + 48 hex, shown once when you create or rotate it. We keep a SHA-256 hash and an 8-character prefix; rotating kills the old one instantly.",
  },
  {
    icon: Webhook,
    title: "Signed webhooks",
    body: "An https URL plus its own whsec_ signing secret. Deliveries retry with backoff (1 → 256 min, 9 attempts) and show up live on your Server panel.",
  },
  {
    icon: ServerCog,
    title: "Server authority",
    body: "Your server settles every match via POST /api/v1/matches/:id/result; players' scores become claims. If it stays silent 24 h after everyone submits, the match is a draw.",
  },
];

function TrustSection() {
  const [tab, setTab] = useState<"verify" | "report">("verify");
  const origin = useOrigin();
  return (
    <section className="mt-20" id="trust">
      <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Trust</p>
      <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Let your server referee</h2>
      <p className="mt-3 max-w-2xl text-ink-300">
        Players&apos; browsers are untrusted. Give your app a secret and its own backend can read and write matches, get signed
        webhooks and — with server authority — be the only one that decides who won.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {TRUST_PILLARS.map((pillar, i) => {
          const Icon = pillar.icon;
          return (
            <motion.div
              key={pillar.title}
              className="rounded-[2rem] glass p-6"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.07, ...spring.soft }}
            >
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06]">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-extrabold">{pillar.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{pillar.body}</p>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <motion.section
          className="min-w-0 rounded-[2rem] glass p-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={spring.soft}
        >
          <h3 className="font-display text-lg font-extrabold">Server API</h3>
          <p className="mt-1 text-sm text-ink-300">
            Send <code className="font-mono text-[13px] text-ink-100">Authorization: Bearer xas_…</code>. Match routes return the
            match JSON with all submissions visible to your server; storage, stats and achievements act for your app.
          </p>
          <div className="mt-4 space-y-2">
            {SERVER_ROUTES.map((route) => (
              <div key={route.method + route.path} className="rounded-2xl border border-white/[0.06] bg-ink-900/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold",
                      route.method === "GET"
                        ? "bg-success/15 text-success"
                        : route.method === "PUT"
                          ? "bg-gold/15 text-gold"
                          : route.method === "DELETE"
                            ? "bg-danger/15 text-danger"
                            : "bg-nova-500/20 text-nova-300",
                    )}
                  >
                    {route.method}
                  </span>
                  <code className="break-all font-mono text-[13px] text-ink-50">{route.path}</code>
                </div>
                <p className="mt-1.5 text-xs text-ink-400">
                  {route.body !== "—" && <code className="mr-2 font-mono text-flare">{route.body}</code>}
                  {route.note}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-400">
            Errors are <code className="font-mono">{"{ error: { code, message } }"}</code>: {API_ERRORS}.
          </p>
        </motion.section>

        <motion.section
          className="min-w-0 rounded-[2rem] glass p-6"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: 0.06, ...spring.soft }}
        >
          <h3 className="font-display text-lg font-extrabold">Webhooks</h3>
          <p className="mt-1 text-sm text-ink-300">
            POSTed as <code className="font-mono text-[13px] text-ink-100">{"{ id, type, createdAt, app, match }"}</code>.
          </p>
          <dl className="mt-4 space-y-2.5">
            {WEBHOOK_EVENTS.map(([event, desc]) => (
              <div key={event} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[8.5rem_1fr] sm:gap-3">
                <dt className="font-mono text-[13px] text-nova-300">{event}</dt>
                <dd className="text-sm text-ink-300">{desc}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 rounded-2xl border border-white/[0.06] bg-ink-950/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">Headers</p>
            <p className="mt-1.5 break-all font-mono text-xs leading-relaxed text-ink-200">
              X-XApps-Event · X-XApps-Delivery (uuid)
              <br />
              {SIGNATURE_FORMAT}
            </p>
            <p className="mt-2 text-xs text-ink-400">Reject timestamps older than 5 minutes — verifyWebhook does both checks.</p>
          </div>
        </motion.section>
      </div>

      <div className="mt-6">
        <Segmented
          layoutId="trust-snippet"
          value={tab}
          onChange={setTab}
          items={[
            { id: "verify", label: "Verify a webhook" },
            { id: "report", label: "Report a result" },
          ]}
        />
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="mt-4">
          <CodeBlock
            filename={tab === "verify" ? "app/api/xapps/webhook/route.ts" : "lib/xapps.ts"}
            code={tab === "verify" ? webhookSnippet() : reportSnippet(origin)}
          />
        </motion.div>
        <p className="mt-3 text-sm text-ink-400">
          Create the secret, webhook and authority on your app&apos;s page under <b className="text-ink-200">Server</b>. The
          server API and webhooks need the Supabase backend; demo mode previews the settings only.
        </p>
      </div>
    </section>
  );
}

export function Developers() {
  const [tab, setTab] = useState<SnippetTab>("react");
  const origin = useOrigin();
  const snippets: Record<SnippetTab, { filename: string; code: string }> = {
    react: { filename: "App.tsx", code: REACT_SNIPPET },
    vanilla: { filename: "index.html", code: vanillaSnippet(origin) },
    contest: { filename: "submit.ts", code: CONTEST_SNIPPET },
    turns: { filename: "game.ts", code: TURNS_SNIPPET },
    media: { filename: "clip.ts", code: MEDIA_SNIPPET },
    app: { filename: "app.js", code: standaloneSnippet(origin) },
    solo: { filename: "solo.js", code: soloSnippet(origin) },
  };
  return (
    <div>
      <section className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
          <Badge tone="nova">@xapps/sdk · v0.1</Badge>
          <h1 className="mt-5 font-display text-[clamp(2.6rem,6vw,4.6rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
            Build the next thing <span className="text-gradient">everyone challenges</span> their friends to.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-300">
            XApps handles identity, matchmaking, realtime rooms, results, XP and the crowd. You write the fun part — in
            any framework, hosted anywhere. It hosts both games people challenge each other to and standalone apps people
            simply open, like a news reader, a dashboard or a meme maker.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/developers/sandbox" size="xl" variant="accent" magnetic icon={<FlaskConical className="size-5" />}>
              Open the sandbox
            </Button>
            <Button href="/developers/new" size="xl" variant="glass" icon={<Plus className="size-5" />}>
              Register an app
            </Button>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 30, rotate: 2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay: 0.1, ...spring.soft }}>
          <CodeBlock filename="terminal" code={`npm install @xapps/sdk\n\n// or, no build step at all:\nimport { connect } from "${origin}/sdk/v1.js";`} />
        </motion.div>
      </section>

      <Reveal className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <RevealItem key={f.title}>
              <TiltCard className="h-full rounded-[2rem]" intensity={6}>
                <div className="h-full rounded-[2rem] glass p-6">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.06]">
                    <Icon className="size-5" />
                  </span>
                  <h3 className="mt-4 font-display text-lg font-extrabold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{f.body}</p>
                </div>
              </TiltCard>
            </RevealItem>
          );
        })}
      </Reveal>

      <section className="mt-20" id="quickstart">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Quickstart</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">From 1v1 to 8 players in 20 lines</h2>
        <Segmented
          className="mt-6"
          layoutId="dev-snippet"
          value={tab}
          onChange={setTab}
          items={[
            { id: "react", label: "React" },
            { id: "vanilla", label: "No build" },
            { id: "contest", label: "Contest entry" },
            { id: "turns", label: "Turn-based" },
            { id: "media", label: "Media & stats" },
            { id: "app", label: "Standalone app" },
            { id: "solo", label: "Solo + leaderboard" },
          ]}
        />
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="mt-4">
          <CodeBlock filename={snippets[tab].filename} code={snippets[tab].code} />
        </motion.div>
        {tab === "solo" ? (
          <p className="mt-3 text-sm text-ink-400">
            Register it as an <span className="font-mono text-ink-200">app</span>, declare the stat, and add an icon and
            cover in the form. Your listing shows the stat&apos;s leaderboard, and{" "}
            <Link href="/apps/perfect-circle" className="text-nova-300 hover:underline">
              Perfect Circle
            </Link>{" "}
            and{" "}
            <Link href="/apps/gregs-face" className="text-nova-300 hover:underline">
              Greg&apos;s Face
            </Link>{" "}
            are built exactly this way on the public SDK.
          </p>
        ) : tab === "app" ? (
          <p className="mt-3 text-sm text-ink-400">
            Standalone apps (register with kind <span className="font-mono text-ink-200">app</span>) open full screen with
            the viewer signed in: storage, stats, achievements, media, logs and toasts work; matches, rooms and shared state
            don&apos;t. A complete example lives at{" "}
            <Link href="/examples/notes/index.html?xapps-purpose=app" className="text-nova-300 hover:underline">
              /examples/notes
            </Link>{" "}
            — a private pinboard in one HTML file.
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-400">
            A complete example lives at{" "}
            <Link href="/examples/rps/index.html" className="text-nova-300 hover:underline">
              /examples/rps
            </Link>{" "}
            — one HTML file, commit-reveal included. Play it as <Link href="/apps/rps-showdown" className="text-nova-300 hover:underline">RPS Showdown</Link>.
          </p>
        )}
      </section>

      <section className="mt-20">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Lifecycle</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">What happens in a match</h2>
        <div className="no-scrollbar -mx-[var(--page-gutter)] mt-8 overflow-x-auto px-[var(--page-gutter)] pb-2">
          <ol className="flex min-w-max gap-3">
            {LIFECYCLE.map((step, i) => (
              <motion.li
                key={step.title}
                className="relative w-44 rounded-3xl glass p-4"
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07, ...spring.soft }}
              >
                <span className="font-mono text-xs text-ink-500">0{i + 1}</span>
                <p className="mt-1 font-display text-lg font-extrabold">{step.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-300">{step.body}</p>
                {i < LIFECYCLE.length - 1 && <ArrowRight className="absolute -right-3 top-1/2 z-10 size-4 -translate-y-1/2 text-ink-500" />}
              </motion.li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mt-20" id="api">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Reference</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">The whole API</h2>
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {API.map((section) => (
            <motion.section
              key={section.group}
              className="rounded-[2rem] glass p-6"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={spring.soft}
            >
              <h3 className="font-display text-lg font-extrabold">{section.group}</h3>
              <dl className="mt-4 space-y-3">
                {section.rows.map(([sig, desc]) => (
                  <div key={sig}>
                    <dt className="font-mono text-[13px] text-nova-300">{sig}</dt>
                    <dd className="mt-0.5 text-sm text-ink-300">{desc}</dd>
                  </div>
                ))}
              </dl>
            </motion.section>
          ))}
          <motion.section
            className="rounded-[2rem] glass p-6"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={spring.soft}
          >
            <h3 className="font-display text-lg font-extrabold">App manifest</h3>
            <dl className="mt-4 space-y-3">
              {MANIFEST.map(([field, desc]) => (
                <div key={field} className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr]">
                  <dt className="font-mono text-[13px] text-flare">{field}</dt>
                  <dd className="text-sm text-ink-300">{desc}</dd>
                </div>
              ))}
            </dl>
          </motion.section>
        </div>
      </section>

      <TrustSection />

      <section className="mt-20 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[
          {
            icon: ShieldCheck,
            title: "Sandboxed & origin-pinned",
            body: "Apps run in a sandboxed iframe and never see the player's session. The host only talks to your registered origin, and the SDK pins the host's.",
          },
          {
            icon: FlaskConical,
            title: "Test without the marketplace",
            body: "Open your app directly and the SDK's mock host plays you against a bot. The Sandbox runs two copies side by side with a live protocol log.",
          },
          {
            icon: Trophy,
            title: "Trust model",
            body: "By default players' clients report scores. For anything competitive, give your app server authority: your server settles every match and client scores are only claims. Client-settled apps should still lean on seeded RNG and commit-reveal.",
          },
        ].map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.title}
              className="rounded-[2rem] border border-white/[0.07] bg-white/[0.02] p-6"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, ...spring.soft }}
            >
              <Icon className="size-5 text-ink-300" />
              <h3 className="mt-3 font-display text-lg font-extrabold">{card.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-300">{card.body}</p>
            </motion.div>
          );
        })}
      </section>

      <section className={cn("mt-20 rounded-[2.5rem] border border-white/[0.08] bg-ink-850/80 p-8 sm:p-10")}>
        <h2 className="font-display text-3xl font-extrabold tracking-tight">Ship it</h2>
        <ol className="mt-4 space-y-2 text-ink-300">
          <li>1. Host your app on https and allow XApps to frame it: <code className="font-mono text-sm text-ink-100">Content-Security-Policy: frame-ancestors &lt;xapps-origin&gt;</code></li>
          <li>2. Test both seats in the Sandbox until the log is clean.</li>
          <li>3. Register it — it&apos;s reviewed, then listed in the marketplace for everyone on X.</li>
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button href="/developers/new" size="lg" variant="primary" icon={<Plus className="size-4" />}>
            Register an app
          </Button>
          <Button href="/developers/sandbox" size="lg" variant="glass" icon={<FlaskConical className="size-4" />}>
            Sandbox
          </Button>
        </div>
      </section>

      <MyApps />
    </div>
  );
}
