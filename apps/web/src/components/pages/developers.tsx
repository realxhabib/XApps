"use client";

import { motion } from "motion/react";
import {
  ArrowRight,
  Boxes,
  FlaskConical,
  Fingerprint,
  Gavel,
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
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Segmented } from "@/components/ui/segmented";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { useMyApps } from "@/platform/queries";
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

const VANILLA_SNIPPET = `<script type="module">
  import { connect } from "https://YOUR-XAPPS-HOST/sdk/v1.js";

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
    kind: "svg",                            // or "text" / "image" (https)
    svg: renderMySvg(caption),              // self-contained SVG, shown via <img>
    alt: caption,
  },
});`;

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
      ["xapps.social.share(text, url?)", "Opens the X composer, pre-filled. The user always confirms."],
      ["xapps.storage.get(key) · set(key, value)", `Per-user, per-app key/value (≤ ${LIMITS.storageValueBytes / 1024} KB per value).`],
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
  ["howTo", "Up to 3 short steps shown on your listing"],
];

function MyApps() {
  const { viewer } = useViewer();
  const { data } = useMyApps();
  if (!viewer || !data || data.length === 0) return null;
  return (
    <section className="mt-16">
      <h2 className="font-display text-2xl font-extrabold">Your apps</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {data.map((app) => (
          <Link key={app.slug} href={`/apps/${app.slug}`} className="flex items-center gap-3 rounded-3xl glass p-4 transition hover:bg-white/[0.06]">
            <AppGlyph app={app} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{app.name}</p>
              <p className="truncate text-xs text-ink-400">{app.url}</p>
            </div>
            <Badge tone={app.status === "published" ? "success" : app.status === "pending" ? "gold" : "danger"}>{app.status}</Badge>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function Developers() {
  const [tab, setTab] = useState<"react" | "vanilla" | "contest" | "turns">("react");
  return (
    <div>
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
          <Badge tone="nova">@xapps/sdk · v0.1</Badge>
          <h1 className="mt-5 font-display text-[clamp(2.6rem,6vw,4.6rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
            Build the next thing <span className="text-gradient">everyone challenges</span> their friends to.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-300">
            XApps handles identity, matchmaking, realtime rooms, results, XP and the crowd. You write the fun part — in
            any framework, hosted anywhere.
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
          <CodeBlock filename="terminal" code={`npm install @xapps/sdk\n\n// or, no build step at all:\nimport { connect } from "https://YOUR-XAPPS-HOST/sdk/v1.js";`} />
        </motion.div>
      </section>

      <Reveal className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          ]}
        />
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy} className="mt-4">
          <CodeBlock
            filename={tab === "react" ? "App.tsx" : tab === "vanilla" ? "index.html" : tab === "turns" ? "game.ts" : "submit.ts"}
            code={tab === "react" ? REACT_SNIPPET : tab === "vanilla" ? VANILLA_SNIPPET : tab === "turns" ? TURNS_SNIPPET : CONTEST_SNIPPET}
          />
        </motion.div>
        <p className="mt-3 text-sm text-ink-400">
          A complete example lives at{" "}
          <Link href="/examples/rps/index.html" className="text-nova-300 hover:underline">
            /examples/rps
          </Link>{" "}
          — one HTML file, commit-reveal included. Play it as <Link href="/apps/rps-showdown" className="text-nova-300 hover:underline">RPS Showdown</Link>.
        </p>
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
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
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
                <div key={field} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                  <dt className="font-mono text-[13px] text-flare">{field}</dt>
                  <dd className="text-sm text-ink-300">{desc}</dd>
                </div>
              ))}
            </dl>
          </motion.section>
        </div>
      </section>

      <section className="mt-20 grid gap-4 lg:grid-cols-3">
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
            body: "Scores are client-reported, so settle what you can deterministically (seeded RNG), use commit-reveal for secret picks, and keep crowd-judged formats for creative work.",
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
