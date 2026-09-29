import type { PlayerInfo } from "@xapps/sdk";
import { useLogger, useMatchResult, usePlayers, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useEffect, useMemo, useRef, useState } from "react";

/** How long a race lasts. */
const DURATION_MS = 10_000;
/** The practice bot taps with this chance every 100 ms (≈ 6.5 taps/s). */
const BOT_SKILL = 0.65;

type Taps = { [playerId: string]: number };

/**
 * {{name}}: a 10-second tap race.
 *
 * - Every tap is broadcast to the room (`room.send("taps", { count })`), so
 *   everyone (spectators included) sees the live race.
 * - When the clock runs out each player submits their own count; the platform
 *   compares the scores (`scoring: "high"`) and settles the match.
 * - In practice matches the opponents are bots: this client plays them and
 *   submits for them with `submitFor`.
 */
export function App() {
  const xapps = useXApps();
  const log = useLogger();
  const result = useMatchResult();
  const { players, me, opponents, isSpectator } = usePlayers();
  // Practice/sandbox bots are driven by the players' own client.
  const bots = useMemo(() => (isSpectator ? [] : opponents.filter((p) => p.isBot)), [opponents, isSpectator]);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [taps, setTaps] = useState<Taps>({});
  const submitted = useRef(false);

  const endsAt = startedAt === null ? null : startedAt + DURATION_MS;
  const racing = endsAt !== null && now < endsAt;
  const finished = endsAt !== null && now >= endsAt;
  const secondsLeft = endsAt === null ? DURATION_MS / 1000 : Math.max(0, Math.ceil((endsAt - now) / 1000));

  // Tell the host we're on screen. It plays its VS intro + countdown, then fires onStart.
  useEffect(() => {
    const off = xapps.onStart(() => {
      // Local clock: every client races for exactly DURATION_MS from its own start signal.
      const at = Date.now();
      setStartedAt(at);
      setNow(at);
      log.info("race started", { players: xapps.players.length, practice: xapps.match.mode === "practice" });
    });
    xapps.ready().catch((error: unknown) => log.error("ready failed", { error: String(error) }));
    return off;
  }, [xapps, log]);

  // Tick the clock while racing.
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAt]);

  // Other players' taps (and, for spectators, everyone's).
  useRoomEvent<{ count: number }>("taps", ({ count }, from) => {
    if (typeof count !== "number") return;
    setTaps((t) => ({ ...t, [from]: Math.max(t[from] ?? 0, count) }));
  });

  // Practice: drive the bots from the shared seed.
  useEffect(() => {
    if (bots.length === 0 || endsAt === null) return;
    const rngs = bots.map((b) => ({ id: b.id, rng: xapps.random.fork(`bot:${b.id}`) }));
    const id = setInterval(() => {
      if (Date.now() >= endsAt) return;
      const tapped = rngs.filter(({ rng }) => rng.chance(BOT_SKILL)).map((b) => b.id);
      if (tapped.length) setTaps((t) => ({ ...t, ...Object.fromEntries(tapped.map((b) => [b, (t[b] ?? 0) + 1])) }));
    }, 100);
    return () => clearInterval(id);
  }, [bots, endsAt, xapps]);

  // Live scoreboard in the host HUD.
  useEffect(() => {
    if (startedAt === null) return;
    xapps.ui.setScores(Object.fromEntries(players.map((p) => [p.id, taps[p.id] ?? 0]))).catch(() => {});
  }, [xapps, players, taps, startedAt]);

  // Time's up: submit once (and for the bots in practice).
  useEffect(() => {
    if (!finished || isSpectator || submitted.current) return;
    submitted.current = true;
    const mine = taps[me.id] ?? 0;
    log.info("race over", { taps: mine });
    xapps
      .submit({ score: mine, display: { kind: "text", title: "Tap race", body: `${mine} taps in ${DURATION_MS / 1000} s` } })
      .catch((error: unknown) => log.error("submit failed", { error: String(error) }));
    for (const b of bots) {
      xapps.submitFor(b.id, { score: taps[b.id] ?? 0 }).catch((error: unknown) => log.warn("bot submit failed", { error: String(error) }));
    }
  }, [finished, isSpectator, taps, me.id, bots, xapps, log]);

  // Celebrate a win.
  useEffect(() => {
    if (result && result.winnerId === me.id) xapps.ui.celebrate("big").catch(() => {});
  }, [result, me.id, xapps]);

  const tap = () => {
    if (!racing || isSpectator) return;
    const count = (taps[me.id] ?? 0) + 1;
    setTaps((t) => ({ ...t, [me.id]: count }));
    // Over ~30 messages/s the SDK answers rate_limited; the next tap carries the latest count anyway.
    xapps.room.send("taps", { count }).catch(() => {});
    xapps.ui.haptic("light").catch(() => {});
  };

  const leader = Math.max(20, ...players.map((p) => taps[p.id] ?? 0));
  const status = result
    ? result.winnerId === null
      ? "It's a draw!"
      : result.winnerId === me.id
        ? "You win! 🎉"
        : `${nameOf(players, result.winnerId)} wins`
    : finished
      ? "Time! Waiting for the result…"
      : racing
        ? isSpectator
          ? "Race on!"
          : "TAP! TAP! TAP!"
        : isSpectator
          ? "Waiting for the race to start…"
          : "Get ready…";

  return (
    <main className="app">
      <header>
        <h1>{xapps.context.app.name}</h1>
        <p className="muted">Most taps in {DURATION_MS / 1000} seconds wins.</p>
      </header>

      <section className="lanes" aria-label="Race">
        {players.map((p) => {
          const count = taps[p.id] ?? 0;
          return (
            <div key={p.id} className={`lane${p.id === me.id ? " me" : ""}`}>
              <div className="lane-head">
                <span>
                  {p.id === me.id ? "You" : `@${p.handle}`}
                  {p.isBot ? " 🤖" : ""}
                </span>
                <strong>{count}</strong>
              </div>
              <div className="bar">
                <div className="fill" style={{ width: `${Math.min(100, (count / leader) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </section>

      <div className="clock" aria-live="polite">
        {secondsLeft}s
      </div>

      {isSpectator ? (
        <p className="muted center">You’re watching.</p>
      ) : (
        <button type="button" className="tap" onPointerDown={tap} disabled={!racing}>
          TAP
        </button>
      )}

      <p className="status" role="status">
        {status}
      </p>
    </main>
  );
}

function nameOf(players: PlayerInfo[], id: string): string {
  const p = players.find((x) => x.id === id);
  return p ? `@${p.handle}` : "Someone";
}
