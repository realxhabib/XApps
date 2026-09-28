/**
 * A tiny in-page host used when an app is opened directly (not inside XApps).
 * It gives you a player, a bot opponent, a start signal and a result so you
 * can build and debug without the marketplace. For true two-player testing
 * use the XApps Sandbox, which runs two copies of your app side by side.
 */
import { createHostCore, decideWinner, type HostBridge } from "./host";
import type { Json, LaunchContext, MatchResult, Scoring, Submission } from "./protocol";
import { randomId } from "./random";
import { createMemoryTransportPair, type AppTransport } from "./transport";

export interface MockHostOptions {
  scoring?: Scoring;
  /** Seed override, handy for reproducing a bug. */
  seed?: string;
  /** Delay before `match.start` fires after `ready()`. Default 400 ms. */
  startDelayMs?: number;
  /** Match settings passed to the app. */
  settings?: { [key: string]: Json };
  /** Silence the console output. */
  quiet?: boolean;
}

export interface MockHost {
  transport: AppTransport;
  bridge: HostBridge;
  context: LaunchContext;
}

export function createMockHost(options: MockHostOptions = {}): MockHost {
  const pair = createMemoryTransportPair();
  const log = (...args: unknown[]) => {
    if (!options.quiet) console.info("%c[xapps mock]", "color:#8b5cf6;font-weight:600", ...args);
  };

  const context: LaunchContext = {
    app: { id: "local", slug: "local", name: typeof document !== "undefined" ? document.title || "My app" : "My app" },
    user: { id: "you", handle: "you", name: "You", avatarUrl: null },
    match: {
      id: `mock-${randomId(6)}`,
      mode: "sandbox",
      status: "active",
      scoring: options.scoring ?? "high",
      seed: options.seed ?? randomId(12),
      seat: 0,
      settings: options.settings ?? {},
      players: [
        { id: "you", handle: "you", name: "You", avatarUrl: null, seat: 0, isBot: false, submitted: false, score: null },
        { id: "bot", handle: "xapps_bot", name: "Practice Bot", avatarUrl: null, seat: 1, isBot: true, submitted: false, score: null },
      ],
    },
    host: { name: "XApps Mock Host", version: "0.1.0", origin: "memory://host" },
    locale: typeof navigator !== "undefined" ? navigator.language : "en",
  };

  const submissions = new Map<string, Submission>();
  let startedAt: number | null = null;
  let ended: MatchResult | null = null;

  const finish = () => {
    const scores: Record<string, number | null> = {};
    for (const p of context.match.players) scores[p.id] = submissions.get(p.id)?.score ?? null;
    const winnerId =
      context.match.scoring === "votes"
        ? context.match.players[Math.floor(Math.random() * context.match.players.length)]?.id ?? null
        : decideWinner(scores, context.match.scoring);
    ended = { matchId: context.match.id, status: "completed", winnerId, scores };
    context.match.status = "completed";
    log("match ended", ended);
    setTimeout(() => bridge.emit("match.end", { result: ended as MatchResult }), 250);
  };

  const bridge = createHostCore(pair.host, {
    context: () => context,
    onConnect: () => log("app connected", context),
    handlers: {
      ready: () => {
        if (startedAt === null) {
          setTimeout(() => {
            startedAt = Date.now();
            log("match.start");
            bridge.emit("room.presence", { online: context.match.players.map((p) => p.id) });
            bridge.emit("match.start", { at: startedAt });
          }, options.startDelayMs ?? 400);
        }
        return { startedAt };
      },
      "room.send": ({ type, payload }) => {
        log("room.send", type, payload);
        return null;
      },
      "match.submit": ({ playerId, ...submission }) => {
        const id = playerId ?? context.user.id;
        const player = context.match.players.find((p) => p.id === id);
        if (!player) throw new Error(`Unknown player ${id}`);
        if (id !== context.user.id && !player.isBot) throw new Error("You can only submit for yourself or a bot");
        submissions.set(id, submission);
        player.submitted = true;
        player.score = submission.score ?? null;
        log("submit", id, submission);
        bridge.emit("match.update", { match: context.match });
        if (!ended && context.match.players.every((p) => p.submitted)) finish();
        return { state: ended ? "final" : "waiting", result: ended };
      },
      "match.forfeit": () => {
        ended = {
          matchId: context.match.id,
          status: "completed",
          winnerId: "bot",
          scores: { you: null, bot: null },
        };
        setTimeout(() => bridge.emit("match.end", { result: ended as MatchResult }), 100);
        return null;
      },
      "ui.toast": ({ message, tone }) => (log(`toast (${tone ?? "info"})`, message), null),
      "ui.celebrate": ({ intensity }) => (log("🎉 celebrate", intensity ?? "big"), null),
      "ui.haptic": ({ style }) => {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(style === "heavy" ? 30 : 10);
        return null;
      },
      "ui.status": ({ text }) => (log("status", text), null),
      "ui.scores": ({ scores }) => (log("scores", scores), null),
      "ui.turn": ({ playerId }) => (log("turn", playerId), null),
      "social.share": ({ text, url }) => {
        const intent = new URL("https://x.com/intent/post");
        intent.searchParams.set("text", text);
        if (url) intent.searchParams.set("url", url);
        if (typeof window !== "undefined") window.open(intent.toString(), "_blank", "noopener,noreferrer");
        return null;
      },
      "storage.get": ({ key }) => {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(`xapps-mock:${key}`);
        return raw === null ? null : (JSON.parse(raw) as Json);
      },
      "storage.set": ({ key, value }) => {
        if (typeof localStorage !== "undefined") localStorage.setItem(`xapps-mock:${key}`, JSON.stringify(value));
        return null;
      },
    },
  });

  return { transport: pair.app, bridge, context };
}
