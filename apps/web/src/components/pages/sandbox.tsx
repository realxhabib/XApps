"use client";

import { createHostBridge, decideWinner, type HostBridge, type HostHandlers } from "@xapps/sdk/host";
import type { HostEvent, HostEventData, Json, LaunchContext, MatchResult, PlayerInfo, Scoring, SubmissionDisplay } from "@xapps/sdk/protocol";
import { randomId } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import { Eraser, Play, RotateCcw, Trophy } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EntryView } from "@/components/arena/entry-view";
import { toast } from "@/components/chrome/toasts";
import { celebrate } from "@/components/motion/confetti";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { OFFICIAL_APPS } from "@/platform/catalog";

type SandboxMode = "live" | "async" | "practice";

interface Seat {
  id: string;
  handle: string;
  name: string;
  isBot: boolean;
}

interface SeatState {
  connected: boolean;
  ready: boolean;
  status: string | null;
  scores: Record<string, number | string>;
  turn: string | null;
}

interface Entry {
  score?: number;
  data?: Json;
  display?: SubmissionDisplay;
}

interface LogLine {
  id: number;
  at: number;
  seat: number | "host";
  kind: "request" | "event" | "error" | "info";
  name: string;
  detail?: string;
}

const HUMANS: Seat[] = [
  { id: "p1", handle: "player_one", name: "Player One", isBot: false },
  { id: "p2", handle: "player_two", name: "Player Two", isBot: false },
];
const BOT: Seat = { id: "bot", handle: "sandbox_bot", name: "Sandbox Bot", isBot: true };

const blankSeat = (): SeatState => ({ connected: false, ready: false, status: null, scores: {}, turn: null });

const PRESETS = [
  { label: "RPS Showdown (vanilla example)", url: "/examples/rps/index.html", scoring: "high" as Scoring },
  ...OFFICIAL_APPS.filter((a) => a.official).map((a) => ({ label: a.name, url: a.url, scoring: a.scoring })),
];

function preview(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  } catch {
    return String(value);
  }
}

let logId = 1;

export function Sandbox() {
  const params = useSearchParams();
  const [url, setUrl] = useState(params.get("url") ?? PRESETS[0]!.url);
  const [scoring, setScoring] = useState<Scoring>((params.get("scoring") as Scoring) ?? PRESETS[0]!.scoring);
  const [mode, setMode] = useState<SandboxMode>("live");
  const [run, setRun] = useState<{ url: string; scoring: Scoring; mode: SandboxMode; seed: string; key: number } | null>(null);
  const [seats, setSeats] = useState<SeatState[]>([blankSeat(), blankSeat()]);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [result, setResult] = useState<MatchResult | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<"all" | "0" | "1">("all");
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const bridges = useRef<(HostBridge | null)[]>([null, null]);
  const startedAt = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const storage = useRef(new Map<string, Json>());

  const players: Seat[] = useMemo(() => (run?.mode === "practice" ? [HUMANS[0]!, BOT] : HUMANS), [run?.mode]);
  const humanSeats = run?.mode === "practice" ? 1 : 2;

  const append = useCallback((line: Omit<LogLine, "id" | "at">) => {
    setLog((l) => [...l.slice(-299), { ...line, id: logId++, at: Date.now() }]);
  }, []);

  const emit = useCallback(
    <E extends HostEvent>(seat: number, event: E, data: HostEventData<E>) => {
      bridges.current[seat]?.emit(event, data);
      append({ seat, kind: "event", name: event, detail: preview(data) });
    },
    [append],
  );

  const patchSeat = (seat: number, patch: Partial<SeatState>) =>
    setSeats((all) => all.map((s, i) => (i === seat ? { ...s, ...patch } : s)));

  // Mutable mirrors so bridge handlers always see fresh values.
  const state = useRef({ seats, entries, result, players, run });
  useEffect(() => {
    state.current = { seats, entries, result, players, run };
  });

  const launchMatch = useCallback(
    (seatIndex: number): LaunchContext["match"] => {
      const { entries: e, players: ps, run: r } = state.current;
      return {
        id: `sandbox-${r?.key ?? 0}`,
        mode: r?.mode ?? "live",
        status: state.current.result ? "completed" : "active",
        scoring: r?.scoring ?? "high",
        seed: r?.seed ?? "sandbox",
        seat: seatIndex,
        settings: {},
        players: ps.map<PlayerInfo>((p, i) => ({
          id: p.id,
          handle: p.handle,
          name: p.name,
          avatarUrl: null,
          seat: i,
          isBot: p.isBot,
          submitted: !!e[p.id],
          score: e[p.id]?.score ?? null,
        })),
      };
    },
    [],
  );

  const finish = useCallback(
    (winnerId: string | null, votes?: Record<string, number>) => {
      const { entries: e, players: ps } = state.current;
      const scores: Record<string, number | null> = {};
      ps.forEach((p) => (scores[p.id] = e[p.id]?.score ?? null));
      const final: MatchResult = { matchId: `sandbox-${state.current.run?.key}`, status: "completed", winnerId, scores, votes };
      setResult(final);
      append({ seat: "host", kind: "info", name: "match settled", detail: preview(final) });
      for (let i = 0; i < humanSeats; i++) emit(i, "match.end", { result: final });
      celebrate({ count: 90 });
    },
    [append, emit, humanSeats],
  );

  const maybeStart = useCallback(() => {
    const { seats: s } = state.current;
    const everyone = s.slice(0, humanSeats).every((x) => x.ready);
    if (!everyone || startedAt.current !== null) return;
    startedAt.current = -1;
    append({ seat: "host", kind: "info", name: "everyone ready → starting in 1s" });
    setTimeout(() => {
      startedAt.current = Date.now();
      for (let i = 0; i < humanSeats; i++) emit(i, "match.start", { at: startedAt.current });
    }, 1000);
  }, [append, emit, humanSeats]);

  // Wire one host bridge per human seat.
  useEffect(() => {
    if (!run) return;
    let origin: string;
    try {
      origin = new URL(run.url, window.location.origin).origin;
    } catch {
      toast("That URL doesn't look right", { tone: "danger" });
      return;
    }
    startedAt.current = null;
    const created: HostBridge[] = [];
    for (let seat = 0; seat < humanSeats; seat++) {
      const me = players[seat]!;
      const others = players.filter((p) => p.id !== me.id);
      const handlers: HostHandlers = {
        ready: () => {
          patchSeat(seat, { ready: true });
          state.current.seats = state.current.seats.map((s, i) => (i === seat ? { ...s, ready: true } : s));
          setTimeout(maybeStart, 0);
          return { startedAt: startedAt.current && startedAt.current > 0 ? startedAt.current : null };
        },
        "room.send": ({ type, payload }) => {
          if (run.mode === "live") {
            others
              .filter((o) => !o.isBot)
              .forEach((o) => emit(players.indexOf(o), "room.message", { type, payload, from: me.id, at: Date.now() }));
          }
          return null;
        },
        "match.submit": ({ playerId, ...entry }) => {
          const target = playerId ?? me.id;
          const player = players.find((p) => p.id === target);
          if (!player) throw new Error(`Unknown player ${target}`);
          if (target !== me.id && !player.isBot) throw new Error("You can only submit for yourself or a bot");
          if (state.current.entries[target]) throw new Error("Already submitted");
          if (run.scoring !== "votes" && typeof entry.score !== "number") throw new Error("A score is required for this scoring mode");
          const next = { ...state.current.entries, [target]: entry };
          state.current.entries = next;
          setEntries(next);
          for (let i = 0; i < humanSeats; i++) emit(i, "match.update", { match: launchMatch(i) });
          const all = players.every((p) => next[p.id]);
          if (all && run.scoring !== "votes") {
            const scores = Object.fromEntries(players.map((p) => [p.id, next[p.id]?.score ?? null]));
            setTimeout(() => finish(decideWinner(scores, run.scoring as "high" | "low")), 300);
          } else if (all) {
            append({ seat: "host", kind: "info", name: "both entries in → pick a winner below (you are the crowd)" });
          }
          return { state: "waiting", result: null };
        },
        "match.forfeit": () => {
          const other = others[0];
          setTimeout(() => finish(other?.id ?? null), 100);
          return null;
        },
        "ui.toast": ({ message }) => (toast(`P${seat + 1}: ${message}`), null),
        "ui.celebrate": () => (celebrate({ count: 60 }), null),
        "ui.haptic": () => null,
        "ui.status": ({ text }) => (patchSeat(seat, { status: text }), null),
        "ui.scores": ({ scores }) => (patchSeat(seat, { scores }), null),
        "ui.turn": ({ playerId }) => (patchSeat(seat, { turn: playerId }), null),
        "social.share": ({ text }) => {
          toast("Would open the X composer", { description: text.slice(0, 100) });
          return null;
        },
        "storage.get": ({ key }) => storage.current.get(`${me.id}:${key}`) ?? null,
        "storage.set": ({ key, value }) => {
          storage.current.set(`${me.id}:${key}`, value);
          return null;
        },
      };
      const bridge = createHostBridge({
        target: () => frames[seat]!.current?.contentWindow ?? null,
        appOrigin: origin,
        context: () => ({
          app: { id: "sandbox", slug: "sandbox", name: "Sandbox" },
          user: { id: me.id, handle: me.handle, name: me.name, avatarUrl: null },
          match: launchMatch(seat),
          host: { name: "XApps Sandbox", version: "0.1.0", origin: window.location.origin },
          locale: navigator.language,
        }),
        handlers,
        onConnect: ({ sdkVersion }) => {
          patchSeat(seat, { connected: true });
          append({ seat, kind: "info", name: `connected (sdk ${sdkVersion})` });
          bridge.emit("room.presence", { online: players.map((p) => p.id) });
        },
        onRequest: (method, p) => append({ seat, kind: "request", name: method, detail: preview(p) }),
        onRequestError: (method, error) => append({ seat, kind: "error", name: method, detail: error.message }),
      });
      bridges.current[seat] = bridge;
      created.push(bridge);
    }
    return () => {
      created.forEach((b) => b.destroy());
      bridges.current = [null, null];
    };
    // `frames` refs are stable; everything else is read through `state`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  const launch = () => {
    setSeats([blankSeat(), blankSeat()]);
    setEntries({});
    state.current.entries = {};
    setResult(null);
    setLog([]);
    storage.current.clear();
    setRun({ url, scoring, mode, seed: randomId(12), key: Date.now() });
  };

  const visibleLog = log.filter((l) => filter === "all" || String(l.seat) === filter || l.seat === "host");
  const bothIn = players.length > 0 && players.every((p) => entries[p.id]);

  return (
    <div>
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Developers</p>
        <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight">Sandbox</h1>
        <p className="mt-3 max-w-2xl text-ink-300">
          Load any app URL and play both seats side by side. Room messages are relayed locally and every protocol message
          is logged. Nothing here touches real matches or XP.
        </p>
      </motion.header>

      <section className="mt-8 rounded-[2rem] glass p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input
            list="sandbox-presets"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="h-11 flex-1 rounded-full border border-white/10 bg-white/[0.03] px-4 font-mono text-sm outline-none focus:border-nova-400/60"
            aria-label="App URL"
            placeholder="https://your-app.dev"
          />
          <datalist id="sandbox-presets">
            {PRESETS.map((p) => (
              <option key={p.url} value={p.url}>
                {p.label}
              </option>
            ))}
          </datalist>
          <Segmented
            layoutId="sb-mode"
            size="sm"
            value={mode}
            onChange={setMode}
            items={[
              { id: "live", label: "Live · 2 seats" },
              { id: "async", label: "Async · 2 seats" },
              { id: "practice", label: "vs Bot" },
            ]}
          />
          <Segmented
            layoutId="sb-scoring"
            size="sm"
            value={scoring}
            onChange={setScoring}
            items={[
              { id: "high", label: "High" },
              { id: "low", label: "Low" },
              { id: "votes", label: "Votes" },
            ]}
          />
          <Button variant="accent" icon={run ? <RotateCcw className="size-4" /> : <Play className="size-4" />} onClick={launch} magnetic>
            {run ? "Restart" : "Launch"}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.url}
              onClick={() => {
                setUrl(p.url);
                setScoring(p.scoring);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition",
                url === p.url ? "border-white/40 bg-white/10 text-ink-50" : "border-white/10 text-ink-300 hover:border-white/25",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {!run ? (
        <div className="mt-6 rounded-[2rem] border border-dashed border-white/15 p-12 text-center text-ink-300">
          Pick an app and press <b className="text-ink-50">Launch</b>. Tip: your own app on{" "}
          <code className="font-mono text-ink-100">http://localhost</code> works too if it allows framing.
        </div>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-[1fr_22rem]">
          <div className={cn("grid gap-4", humanSeats === 2 ? "md:grid-cols-2" : "")}>
            {Array.from({ length: humanSeats }).map((_, seat) => {
              const me = players[seat]!;
              const s = seats[seat]!;
              return (
                <motion.div
                  key={`${run.key}-${seat}`}
                  className="overflow-hidden rounded-[2rem] border border-white/10 bg-ink-900"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: seat * 0.08, ...spring.soft }}
                >
                  <div className="flex items-center gap-3 border-b border-white/[0.07] px-4 py-2.5">
                    <Avatar person={me} size={30} online={s.connected} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        Seat {seat + 1} · @{me.handle}
                      </p>
                      <p className="truncate text-xs text-ink-400">{s.status ?? (s.connected ? "connected" : "loading…")}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.turn === me.id && <Badge tone="volt">turn</Badge>}
                      {s.ready && <Badge tone="nova">ready</Badge>}
                      {entries[me.id] && <Badge tone="success">submitted</Badge>}
                      {Object.keys(s.scores).length > 0 && (
                        <span className="font-mono text-xs text-ink-300">
                          {players.map((p) => s.scores[p.id] ?? "–").join(" : ")}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative h-[560px]">
                    <iframe
                      key={run.key}
                      ref={frames[seat]}
                      src={run.url}
                      title={`Seat ${seat + 1}`}
                      className="absolute inset-0 size-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
                      allow="autoplay; clipboard-write"
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="flex min-h-[420px] flex-col overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0c13]">
            <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
              <p className="text-sm font-semibold">Protocol log</p>
              <div className="ml-auto flex items-center gap-1">
                {(["all", "0", "1"] as const).slice(0, humanSeats + 1).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", filter === f ? "bg-white/15 text-ink-50" : "text-ink-400")}
                  >
                    {f === "all" ? "All" : `P${Number(f) + 1}`}
                  </button>
                ))}
                <button onClick={() => setLog([])} className="ml-1 rounded-full p-1.5 text-ink-400 hover:bg-white/10" aria-label="Clear log">
                  <Eraser className="size-3.5" />
                </button>
              </div>
            </div>
            <div ref={logRef} className="max-h-[560px] flex-1 space-y-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
              <AnimatePresence initial={false}>
                {visibleLog.map((line) => (
                  <motion.div
                    key={line.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="rounded-lg px-2 py-1 hover:bg-white/[0.04]"
                  >
                    <span className="text-ink-500">{new Date(line.at).toLocaleTimeString("en", { hour12: false })}</span>{" "}
                    <span className={cn(line.seat === "host" ? "text-gold" : line.seat === 0 ? "text-nova-300" : "text-flare")}>
                      {line.seat === "host" ? "HOST" : `P${line.seat + 1}`}
                    </span>{" "}
                    <span
                      className={cn(
                        line.kind === "request" && "text-[#7fe7ff]",
                        line.kind === "event" && "text-volt",
                        line.kind === "error" && "text-danger",
                        line.kind === "info" && "text-ink-300",
                      )}
                    >
                      {line.kind === "request" ? "→" : line.kind === "event" ? "←" : line.kind === "error" ? "✕" : "•"} {line.name}
                    </span>
                    {line.detail && <span className="block truncate pl-4 text-ink-400">{line.detail}</span>}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {run && run.scoring === "votes" && bothIn && !result && (
          <motion.section
            className="mt-6 rounded-[2rem] glass p-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.soft}
          >
            <h2 className="font-display text-2xl font-extrabold">You&apos;re the crowd — pick a winner</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {players.map((p) => (
                <button
                  key={p.id}
                  onClick={() => finish(p.id, Object.fromEntries(players.map((x) => [x.id, x.id === p.id ? 5 : 2])))}
                  className="rounded-3xl p-2 text-left ring-1 ring-white/10 transition hover:ring-white/40"
                >
                  <EntryView display={entries[p.id]?.display} compact />
                  <p className="mt-2 px-2 text-sm font-semibold">@{p.handle}</p>
                </button>
              ))}
            </div>
          </motion.section>
        )}
        {result && (
          <motion.section
            className="mt-6 flex flex-wrap items-center gap-4 rounded-[2rem] border border-gold/30 bg-gold/[0.06] p-5"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.bouncy}
          >
            <Trophy className="size-6 text-gold" />
            <p className="font-semibold">
              {result.winnerId ? `@${players.find((p) => p.id === result.winnerId)?.handle} wins` : "Draw"}
              <span className="ml-2 font-mono text-sm text-ink-300">{preview(result.scores)}</span>
            </p>
            <Button className="ml-auto" size="sm" variant="primary" icon={<RotateCcw className="size-4" />} onClick={launch}>
              Run again
            </Button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
