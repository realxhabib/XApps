import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { DuelEngine, type Clock, type DuelEvent, type Phase } from "./duel";
import {
  INTRO_MS,
  MISS_AFTER_MS,
  OPP_TIMEOUT_MS,
  REVEAL_MS,
  SETTLE_MS,
  mirrorOutcome,
  steadyDelayMs,
  type ResultMessage,
} from "./logic";

/* ------------------------------------------------------------------ */
/* Test harness                                                       */
/* ------------------------------------------------------------------ */

/** Deterministic timer queue shared by every simulated client. */
class FakeClock implements Clock {
  private t = 0;
  private seq = 0;
  private queue: { at: number; id: number; fn: () => void }[] = [];

  now = () => this.t;

  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.queue.push({ at: this.t + ms, id, fn });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.queue = this.queue.filter((q) => q.id !== handle);
  };

  get pending(): number {
    return this.queue.length;
  }

  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: (typeof this.queue)[number] | undefined;
      for (const q of this.queue) {
        if (q.at <= end && (!next || q.at < next.at || (q.at === next.at && q.id < next.id))) next = q;
      }
      if (!next) break;
      this.queue = this.queue.filter((q) => q !== next);
      this.t = next.at;
      next.fn();
    }
    this.t = end;
  }

  /** Run until the queue drains (or a safety cap). */
  flush(maxMs = 120_000): void {
    this.advance(maxMs);
  }
}

function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

/** rand values that make the bot tap in exactly 275 ms, every round. */
const BOT_275 = scripted(0.5, 0.5, 0.25);

type Plan =
  /** Tap this many ms after DRAW. */
  | { react: number }
  /** Tap this many ms into STEADY (a false start if it's before DRAW). */
  | { jumpAfter: number }
  /** Never tap. */
  | { idle: true };

/** Drive `engine` like a player following `plan(round)`. Returns the event log. */
function autoplay(engine: DuelEngine, clock: FakeClock, plan: (round: number) => Plan): DuelEvent[] {
  const log: DuelEvent[] = [];
  engine.onEvent((event) => {
    log.push(event);
    if (event.type === "steady") {
      const p = plan(event.round);
      if ("jumpAfter" in p) clock.setTimeout(() => engine.tap(clock.now()), p.jumpAfter);
    }
    if (event.type === "draw") {
      const p = plan(event.round);
      if ("react" in p) clock.setTimeout(() => engine.tap(clock.now()), p.react);
    }
  });
  return log;
}

function phases(engine: DuelEngine): Phase[] {
  const seen: Phase[] = [];
  engine.subscribe(() => {
    const phase = engine.getSnapshot().phase;
    if (seen[seen.length - 1] !== phase) seen.push(phase);
  });
  return seen;
}

const seeded = (seed: string) => {
  const rng = createRandom(seed);
  return (round: number) => steadyDelayMs(rng, round);
};

/* ------------------------------------------------------------------ */
/* Bot duels                                                          */
/* ------------------------------------------------------------------ */

describe("DuelEngine vs a simulated bot", () => {
  it("plays a clean 3–0 and walks every phase in order", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    const seen = phases(engine);
    const log = autoplay(engine, clock, () => ({ react: 200 }));
    engine.start();
    clock.flush();

    const view = engine.getSnapshot();
    expect(view.phase).toBe("final");
    expect(view.score).toEqual({ me: 3, opp: 0 });
    expect(view.outcomes.map((o) => [o.me.ms, o.opp.ms, o.winner])).toEqual([
      [200, 275, "me"],
      [200, 275, "me"],
      [200, 275, "me"],
    ]);
    expect(seen).toEqual([
      ...Array.from({ length: 3 }, () => ["intro", "steady", "draw", "shot", "reveal"] as Phase[]).flat(),
      "final",
    ]);
    expect(log.filter((e) => e.type === "final")).toHaveLength(1);
    // Each round: intro + steady + reaction + settle beat + reveal.
    expect(clock.now()).toBeGreaterThanOrEqual(3 * (INTRO_MS + 2000 + 200 + SETTLE_MS.tap + REVEAL_MS));
    expect(clock.pending).toBe(0);
  });

  it("the bot's faster draws win it rounds and the cue fires before our tap", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 1800, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    const log = autoplay(engine, clock, () => ({ react: 400 }));
    engine.start();
    clock.flush();
    expect(engine.getSnapshot().score).toEqual({ me: 0, opp: 3 });
    const cues = log.filter((e) => e.type === "opp-fired" || e.type === "shot").map((e) => e.type);
    expect(cues.slice(0, 2)).toEqual(["opp-fired", "shot"]);
  });

  it("hides the opponent's time until we have our own", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 2000 + 100);
    expect(engine.getSnapshot().phase).toBe("draw");
    expect(engine.getSnapshot().opp).toBeNull();
    engine.tap(clock.now());
    expect(engine.getSnapshot().mine).toEqual({ ms: 100, falseStart: false });
    expect(engine.getSnapshot().opp).toEqual({ ms: 275, falseStart: false });
  });

  it("a tap during STEADY is a false start and loses the round", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 3000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    const log = autoplay(engine, clock, (round) => (round === 1 ? { jumpAfter: 1500 } : { react: 150 }));
    engine.start();
    clock.advance(INTRO_MS + 1500);
    expect(engine.getSnapshot().phase).toBe("shot");
    expect(engine.getSnapshot().mine).toEqual({ ms: null, falseStart: true });
    // DRAW never fires for us after a false start.
    clock.advance(3000);
    expect(log.some((e) => e.type === "draw" && e.round === 1)).toBe(false);
    clock.flush();
    const view = engine.getSnapshot();
    expect(view.outcomes[0]).toMatchObject({ winner: "opp", reason: "false-start" });
    expect(view.score).toEqual({ me: 3, opp: 1 });
  });

  it("an input stamped before the signal counts as a false start", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 2000); // DRAW just fired at t = INTRO + 2000
    expect(engine.getSnapshot().phase).toBe("draw");
    expect(engine.tap(clock.now() - 5)).toBe("false-start");
  });

  it("never tapping is a no-draw after MISS_AFTER_MS", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 2000 + MISS_AFTER_MS - 1);
    expect(engine.getSnapshot().phase).toBe("draw");
    clock.advance(1);
    expect(engine.getSnapshot().mine).toEqual({ ms: null, falseStart: false });
    clock.advance(SETTLE_MS.miss);
    expect(engine.getSnapshot().last).toMatchObject({ winner: "opp", reason: "no-draw" });
  });

  it("taps during the round banner are ignored (just a nudge)", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    const log = autoplay(engine, clock, () => ({ idle: true }));
    expect(engine.tap()).toBe("ignored"); // not started yet
    engine.start();
    clock.advance(INTRO_MS / 2);
    expect(engine.tap(clock.now())).toBe("early");
    expect(engine.getSnapshot().phase).toBe("intro");
    expect(log.some((e) => e.type === "nudge")).toBe(true);
  });

  it("double taps only count once", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 2000 + 180);
    expect(engine.tap(clock.now())).toBe("shot");
    clock.advance(40);
    expect(engine.tap(clock.now())).toBe("ignored");
    expect(engine.getSnapshot().mine).toEqual({ ms: 180, falseStart: false });
  });

  it("the bot's false start is cued mid-STEADY and hands us the round", () => {
    const clock = new FakeClock();
    // Round 1: bot twitches (0.01 < 7%) at 60% of STEADY; later rounds 275 ms.
    const rand = scripted(0.01, 0.5, 0.5, 0.5, 0.25, 0.5, 0.5, 0.25, 0.5, 0.5, 0.25);
    const engine = new DuelEngine({ steadyDelay: () => 3000, opponent: { kind: "simulated", rand }, clock });
    const log = autoplay(engine, clock, () => ({ react: 320 }));
    engine.start();
    clock.advance(INTRO_MS + 1799);
    expect(engine.getSnapshot().oppFalseStart).toBe(false);
    clock.advance(1);
    expect(engine.getSnapshot().oppFalseStart).toBe(true);
    expect(log.filter((e) => e.type === "opp-false-start")).toHaveLength(1);
    clock.flush();
    expect(engine.getSnapshot().outcomes[0]).toMatchObject({ winner: "me", reason: "false-start" });
  });

  it("ends after five rounds when void rounds prevent three wins", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    // me: win, lose, tie (void), win, lose → 2–2 after five rounds.
    const reacts = [200, 300, 275, 200, 300];
    autoplay(engine, clock, (round) => ({ react: reacts[round - 1] as number }));
    engine.start();
    clock.flush();
    const view = engine.getSnapshot();
    expect(view.phase).toBe("final");
    expect(view.outcomes).toHaveLength(5);
    expect(view.outcomes[2]).toMatchObject({ winner: "none", reason: "tie" });
    expect(view.score).toEqual({ me: 2, opp: 2 });
  });

  it("halt() freezes the duel and cancels every timer", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 500);
    engine.halt();
    expect(engine.getSnapshot().phase).toBe("halted");
    expect(clock.pending).toBe(0);
    expect(engine.tap()).toBe("ignored");
    clock.flush();
    expect(engine.getSnapshot().phase).toBe("halted");
  });

  it("markSignalPainted moves the signal to the paint, within reason", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    engine.start();
    clock.advance(INTRO_MS + 2000);
    const signal = clock.now();
    engine.markSignalPainted(signal + 500); // implausible → ignored
    engine.markSignalPainted(signal + 12);
    clock.advance(212);
    engine.tap(clock.now());
    expect(engine.getSnapshot().mine?.ms).toBe(200);
  });
});

/* ------------------------------------------------------------------ */
/* Live duels                                                         */
/* ------------------------------------------------------------------ */

interface Wire {
  latency: (i: number) => number;
  duplicate?: (i: number) => boolean;
  drop?: (i: number) => boolean;
}

/** Two engines joined by a fake room on one shared clock. */
function liveDuel(seed: string, wire: Wire, plans: { a: (r: number) => Plan; b: (r: number) => Plan }, startSkew = 0) {
  const clock = new FakeClock();
  const sent = { a: [] as ResultMessage[], b: [] as ResultMessage[] };
  let counter = 0;
  const engines: { a?: DuelEngine; b?: DuelEngine } = {};
  const deliver = (to: "a" | "b", message: ResultMessage) => {
    const i = counter++;
    if (wire.drop?.(i)) return;
    const copies = wire.duplicate?.(i) ? 2 : 1;
    for (let c = 0; c < copies; c++) {
      // Round-trip through JSON like the real room does.
      const payload: unknown = JSON.parse(JSON.stringify(message));
      clock.setTimeout(() => engines[to]?.receive(payload), wire.latency(i) + c * 7);
    }
  };
  const a = new DuelEngine({
    steadyDelay: seeded(seed),
    clock,
    opponent: { kind: "remote", send: (m) => (sent.a.push(m), deliver("b", m)) },
  });
  const b = new DuelEngine({
    steadyDelay: seeded(seed),
    clock,
    opponent: { kind: "remote", send: (m) => (sent.b.push(m), deliver("a", m)) },
  });
  engines.a = a;
  engines.b = b;
  const logA = autoplay(a, clock, plans.a);
  const logB = autoplay(b, clock, plans.b);
  a.start();
  if (startSkew > 0) clock.setTimeout(() => b.start(), startSkew);
  else b.start();
  return { clock, a, b, sent, logA, logB };
}

describe("DuelEngine live sync", () => {
  it("both clients compute identical, mirrored outcomes", () => {
    const { clock, a, b } = liveDuel(
      "live-1",
      { latency: () => 80 },
      { a: (r) => ({ react: [210, 330, 250, 199, 240][r - 1] as number }), b: (r) => ({ react: [260, 240, 250, 300, 180][r - 1] as number }) },
    );
    clock.flush();
    const va = a.getSnapshot();
    const vb = b.getSnapshot();
    expect(va.phase).toBe("final");
    expect(vb.phase).toBe("final");
    expect(vb.outcomes.map(mirrorOutcome)).toEqual(va.outcomes);
    expect(va.score).toEqual({ me: vb.score.opp, opp: vb.score.me });
    // 210<260 A, 330>240 B, tie, 199<300 A, 240>180 B → 2–2 after five.
    expect(va.outcomes.map((o) => o.winner)).toEqual(["me", "opp", "none", "me", "opp"]);
  });

  it("never lets network lag decide: reaction times are local", () => {
    // Every other message crawls; B is still faster every round and must win.
    const { clock, a, b } = liveDuel(
      "laggy",
      { latency: (i) => (i % 2 === 0 ? 40 : 900) },
      { a: () => ({ react: 260 }), b: () => ({ react: 230 }) },
    );
    clock.flush();
    expect(a.getSnapshot().score).toEqual({ me: 0, opp: 3 });
    expect(b.getSnapshot().score).toEqual({ me: 3, opp: 0 });
  });

  it("stays consistent under jitter, duplicates, reordering and start skew", () => {
    for (let trial = 0; trial < 60; trial++) {
      const rng = createRandom(`fuzz-${trial}`);
      const jitter = Array.from({ length: 200 }, () => rng.int(5, 1200));
      const dup = Array.from({ length: 200 }, () => rng.chance(0.3));
      const pick = (): Plan => {
        const roll = rng.next();
        if (roll < 0.1) return { jumpAfter: rng.int(100, 1500) };
        if (roll < 0.14) return { idle: true };
        return { react: rng.int(150, 450) };
      };
      const plansA = Array.from({ length: 5 }, pick);
      const plansB = Array.from({ length: 5 }, pick);
      const { clock, a, b, logA, logB } = liveDuel(
        `seed-${trial}`,
        { latency: (i) => jitter[i % jitter.length] as number, duplicate: (i) => dup[i % dup.length] as boolean },
        { a: (r) => plansA[r - 1] as Plan, b: (r) => plansB[r - 1] as Plan },
        rng.int(0, 250),
      );
      clock.flush(300_000);
      const va = a.getSnapshot();
      const vb = b.getSnapshot();
      expect(va.phase, `trial ${trial}`).toBe("final");
      expect(vb.phase, `trial ${trial}`).toBe("final");
      expect(vb.outcomes.map(mirrorOutcome), `trial ${trial}`).toEqual(va.outcomes);
      // With < OPP_TIMEOUT_MS of lag nobody should ever be timed out.
      expect(logA.some((e) => e.type === "opp-timeout")).toBe(false);
      expect(logB.some((e) => e.type === "opp-timeout")).toBe(false);
    }
  });

  it("keeps both screens within one latency of each other, even after an early false start", () => {
    const latency = 120;
    // A jumps the gun early in every round; B always takes its time.
    const { clock, a, b, logA, logB } = liveDuel(
      "drift",
      { latency: () => latency },
      { a: () => ({ jumpAfter: 200 }), b: () => ({ react: 450 }) },
    );
    const revealsA: number[] = [];
    const revealsB: number[] = [];
    a.onEvent((e) => e.type === "reveal" && revealsA.push(clock.now()));
    b.onEvent((e) => e.type === "reveal" && revealsB.push(clock.now()));
    clock.flush();
    expect(a.getSnapshot().score).toEqual({ me: 0, opp: 3 });
    expect(revealsA).toHaveLength(3);
    revealsA.forEach((t, i) => expect(Math.abs(t - (revealsB[i] as number))).toBeLessThanOrEqual(latency));
    expect(logA.some((e) => e.type === "opp-timeout") || logB.some((e) => e.type === "opp-timeout")).toBe(false);
  });

  it("dedupes repeats: every round result is sent 3× but counted once", () => {
    const { clock, a, sent } = liveDuel("dupes", { latency: () => 50 }, { a: () => ({ react: 200 }), b: () => ({ react: 300 }) });
    clock.flush();
    expect(a.getSnapshot().score).toEqual({ me: 3, opp: 0 });
    const perRound = new Map<number, number>();
    for (const m of sent.b) perRound.set(m.round, (perRound.get(m.round) ?? 0) + 1);
    expect([...perRound.values()].every((n) => n === 3)).toBe(true);
    expect(a.receive({ round: 1, ms: 1, falseStart: false })).toBe(false);
  });

  it("survives a dropped message thanks to the resend", () => {
    // Lose every third message on the wire, in both directions.
    const { clock, a, b, logA, logB } = liveDuel(
      "drops",
      { latency: () => 60, drop: (i) => i % 3 === 0 },
      { a: () => ({ react: 240 }), b: () => ({ react: 280 }) },
    );
    clock.flush();
    expect(a.getSnapshot().score).toEqual({ me: 3, opp: 0 });
    expect(b.getSnapshot().outcomes.map(mirrorOutcome)).toEqual(a.getSnapshot().outcomes);
    expect(logA.some((e) => e.type === "opp-timeout")).toBe(false);
    expect(logB.some((e) => e.type === "opp-timeout")).toBe(false);
  });

  it("buffers an opponent's result for a round we haven't reached yet", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "remote", send: () => {} }, clock });
    // They're ahead and already jumped the gun in round 1 before our round even started.
    expect(engine.receive({ round: 1, ms: null, falseStart: true })).toBe(true);
    expect(engine.receive({ round: 2, ms: 250, falseStart: false })).toBe(true);
    engine.start();
    clock.advance(INTRO_MS);
    expect(engine.getSnapshot()).toMatchObject({ phase: "steady", oppFalseStart: true });
    clock.advance(2000 + 300);
    engine.tap(clock.now());
    clock.advance(SETTLE_MS.tap);
    expect(engine.getSnapshot().last).toMatchObject({ winner: "me", reason: "false-start" });
    clock.advance(REVEAL_MS + INTRO_MS + 2000);
    // Round 2's buffered tap surfaces as a "fired" cue once our DRAW is up.
    expect(engine.getSnapshot()).toMatchObject({ phase: "draw", round: 2, oppFired: true });
  });

  it("never deadlocks when the opponent goes silent", () => {
    const clock = new FakeClock();
    const sent: ResultMessage[] = [];
    const delay = seeded("silent");
    const engine = new DuelEngine({ steadyDelay: delay, opponent: { kind: "remote", send: (m) => sent.push(m) }, clock });
    const log = autoplay(engine, clock, () => ({ react: 250 }));
    engine.start();
    clock.advance(INTRO_MS + delay(1) + OPP_TIMEOUT_MS - 1);
    expect(engine.getSnapshot().phase).toBe("shot");
    clock.advance(1);
    expect(engine.getSnapshot().phase).toBe("shot");
    clock.advance(SETTLE_MS.miss);
    expect(engine.getSnapshot().last).toMatchObject({ winner: "me", reason: "no-draw" });
    clock.flush();
    const view = engine.getSnapshot();
    expect(view.phase).toBe("final");
    expect(view.score).toEqual({ me: 3, opp: 0 });
    expect(view.outcomes.every((o) => o.reason === "no-draw")).toBe(true);
    expect(log.filter((e) => e.type === "opp-timeout")).toHaveLength(3);
    expect(sent).toHaveLength(9); // each round: send + two resends
    // A result that limps in after the timeout is ignored.
    expect(engine.receive({ round: 1, ms: 100, falseStart: false })).toBe(false);
    expect(engine.getSnapshot().score).toEqual({ me: 3, opp: 0 });
  });

  it("ignores malformed payloads and never accepts room input against a bot", () => {
    const clock = new FakeClock();
    const remote = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "remote", send: () => {} }, clock });
    expect(remote.receive({ round: 1, ms: "fast", falseStart: false })).toBe(false);
    expect(remote.receive(null)).toBe(false);
    const bot = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    expect(bot.receive({ round: 1, ms: 100, falseStart: false })).toBe(false);
  });

  it("destroy() silences listeners and timers", () => {
    const clock = new FakeClock();
    const engine = new DuelEngine({ steadyDelay: () => 2000, opponent: { kind: "simulated", rand: BOT_275 }, clock });
    let notified = 0;
    engine.subscribe(() => notified++);
    engine.start();
    const before = notified;
    engine.destroy();
    clock.flush();
    expect(notified).toBe(before);
    expect(clock.pending).toBe(0);
  });
});
