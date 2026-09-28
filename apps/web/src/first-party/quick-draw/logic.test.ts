import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  BOT,
  FALSE_START,
  MAX_ROUNDS,
  NO_DRAW,
  STEADY_MAX_MS,
  STEADY_MIN_MS,
  WINS_NEEDED,
  bestMs,
  classify,
  describeOutcome,
  gaussian,
  heartbeatIntervalMs,
  isMatchOver,
  matchWinner,
  mirrorOutcome,
  normalizeResult,
  parseResultMessage,
  reactionMs,
  resolveRound,
  resultLabel,
  roundLabel,
  sampleBotReaction,
  steadyDelayMs,
  submissionData,
  tally,
  toMessage,
  type RoundOutcome,
  type RoundResult,
} from "./logic";

const tap = (ms: number): RoundResult => ({ ms, falseStart: false });

/** Uniform RNG that replays `values` in order (cycling). */
function scripted(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

function outcome(round: number, winner: RoundOutcome["winner"]): RoundOutcome {
  const me = winner === "me" ? tap(200) : tap(300);
  const opp = winner === "opp" ? tap(200) : winner === "none" ? tap(300) : tap(300);
  return resolveRound(round, me, opp);
}

describe("steadyDelayMs", () => {
  it("is identical for two clients sharing the match seed", () => {
    const a = createRandom("match-seed-123");
    const b = createRandom("match-seed-123");
    // Consuming the parent stream must not shift the per-round delay.
    a.next();
    a.int(0, 100);
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      expect(steadyDelayMs(a, round)).toBe(steadyDelayMs(b, round));
    }
  });

  it("stays inside the STEADY window and varies by round", () => {
    const rng = createRandom("window");
    const delays = Array.from({ length: MAX_ROUNDS }, (_, i) => steadyDelayMs(rng, i + 1));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(STEADY_MIN_MS);
      expect(d).toBeLessThan(STEADY_MAX_MS);
    }
    expect(new Set(delays).size).toBe(MAX_ROUNDS);
  });

  it("differs between matches", () => {
    expect(steadyDelayMs(createRandom("a"), 1)).not.toBe(steadyDelayMs(createRandom("b"), 1));
  });
});

describe("reactionMs", () => {
  it("rounds to whole milliseconds and never goes negative", () => {
    expect(reactionMs(1000, 1231.4)).toBe(231);
    expect(reactionMs(1000, 1231.6)).toBe(232);
    expect(reactionMs(1000, 990)).toBe(0);
  });
});

describe("heartbeatIntervalMs", () => {
  it("speeds up with elapsed time, within bounds", () => {
    let previous = Infinity;
    for (let t = 0; t <= STEADY_MAX_MS + 2000; t += 250) {
      const interval = heartbeatIntervalMs(t);
      expect(interval).toBeLessThanOrEqual(previous);
      expect(interval).toBeGreaterThanOrEqual(460);
      expect(interval).toBeLessThanOrEqual(960);
      previous = interval;
    }
    expect(heartbeatIntervalMs(0)).toBe(960);
    expect(heartbeatIntervalMs(-50)).toBe(960);
  });
});

describe("classify / normalizeResult", () => {
  it("buckets results", () => {
    expect(classify(tap(250))).toBe("tap");
    expect(classify(tap(0))).toBe("tap");
    expect(classify(NO_DRAW)).toBe("miss");
    expect(classify(FALSE_START)).toBe("false-start");
    // A false start never carries a time, even if one sneaks in.
    expect(classify({ ms: 120, falseStart: true })).toBe("false-start");
  });

  it("canonicalizes", () => {
    expect(normalizeResult({ ms: 120, falseStart: true })).toEqual(FALSE_START);
    expect(normalizeResult({ ms: 231.7, falseStart: false })).toEqual(tap(232));
    expect(normalizeResult({ ms: -4, falseStart: false })).toEqual(tap(0));
    expect(normalizeResult({ ms: Number.NaN, falseStart: false })).toEqual(NO_DRAW);
  });
});

describe("resolveRound", () => {
  it("faster tap wins, with the margin", () => {
    expect(resolveRound(1, tap(210), tap(260))).toMatchObject({ winner: "me", reason: "faster", marginMs: 50 });
    expect(resolveRound(1, tap(300), tap(299))).toMatchObject({ winner: "opp", reason: "faster", marginMs: 1 });
  });

  it("exact tie scores nobody", () => {
    expect(resolveRound(2, tap(250), tap(250))).toMatchObject({ winner: "none", reason: "tie", marginMs: 0 });
  });

  it("a false start loses to a tap and to a no-draw", () => {
    expect(resolveRound(1, FALSE_START, tap(480))).toMatchObject({ winner: "opp", reason: "false-start" });
    expect(resolveRound(1, tap(480), FALSE_START)).toMatchObject({ winner: "me", reason: "false-start" });
    expect(resolveRound(1, FALSE_START, NO_DRAW)).toMatchObject({ winner: "opp", reason: "false-start" });
  });

  it("never drawing loses to any tap", () => {
    expect(resolveRound(1, NO_DRAW, tap(2999))).toMatchObject({ winner: "opp", reason: "no-draw" });
    expect(resolveRound(1, tap(2999), NO_DRAW)).toMatchObject({ winner: "me", reason: "no-draw" });
  });

  it("double fouls void the round", () => {
    expect(resolveRound(3, FALSE_START, FALSE_START)).toMatchObject({ winner: "none", reason: "both-false-start" });
    expect(resolveRound(3, NO_DRAW, NO_DRAW)).toMatchObject({ winner: "none", reason: "both-no-draw" });
  });

  it("is symmetric, so both clients compute the same outcome", () => {
    const samples: RoundResult[] = [FALSE_START, NO_DRAW, tap(0), tap(199), tap(200), tap(201), tap(520)];
    for (const a of samples) {
      for (const b of samples) {
        const mine = resolveRound(4, a, b);
        const theirs = resolveRound(4, b, a);
        expect(mirrorOutcome(theirs)).toEqual(mine);
      }
    }
  });

  it("stores normalized results", () => {
    const o = resolveRound(1, { ms: 201.2, falseStart: false }, { ms: 50, falseStart: true });
    expect(o.me).toEqual(tap(201));
    expect(o.opp).toEqual(FALSE_START);
  });
});

describe("scoring", () => {
  it("tallies wins and ignores void rounds", () => {
    const outcomes = [outcome(1, "me"), outcome(2, "opp"), outcome(3, "none"), outcome(4, "me")];
    expect(tally(outcomes)).toEqual({ me: 2, opp: 1 });
  });

  it("ends at three wins", () => {
    const three = [outcome(1, "me"), outcome(2, "me"), outcome(3, "me")];
    expect(isMatchOver(three)).toBe(true);
    expect(isMatchOver(three.slice(0, 2))).toBe(false);
    expect(isMatchOver([outcome(1, "opp"), outcome(2, "me"), outcome(3, "opp"), outcome(4, "opp")])).toBe(true);
    expect(WINS_NEEDED).toBe(3);
  });

  it("ends after five rounds even without three wins (void rounds count)", () => {
    const five = [outcome(1, "me"), outcome(2, "opp"), outcome(3, "none"), outcome(4, "me"), outcome(5, "opp")];
    expect(isMatchOver(five.slice(0, 4))).toBe(false);
    expect(isMatchOver(five)).toBe(true);
    expect(matchWinner(tally(five))).toBe("none");
  });

  it("picks the match winner", () => {
    expect(matchWinner({ me: 3, opp: 1 })).toBe("me");
    expect(matchWinner({ me: 0, opp: 3 })).toBe("opp");
    expect(matchWinner({ me: 2, opp: 2 })).toBe("none");
  });

  it("labels match point and the final round", () => {
    expect(roundLabel(1, { me: 0, opp: 0 })).toBeNull();
    expect(roundLabel(3, { me: 2, opp: 0 })).toBe("Match point");
    expect(roundLabel(4, { me: 1, opp: 2 })).toBe("Match point");
    expect(roundLabel(5, { me: 2, opp: 2 })).toBe("Final round");
  });

  it("finds the best valid reaction", () => {
    expect(bestMs([tap(300), FALSE_START, tap(212), NO_DRAW, tap(250)])).toBe(212);
    expect(bestMs([FALSE_START, NO_DRAW])).toBeNull();
    expect(bestMs([])).toBeNull();
  });
});

describe("wire format", () => {
  it("round-trips through toMessage / parseResultMessage", () => {
    for (const r of [tap(231), FALSE_START, NO_DRAW]) {
      const message = toMessage(2, r);
      const parsed = parseResultMessage(JSON.parse(JSON.stringify(message)));
      expect(parsed).toEqual(message);
    }
    expect(toMessage(1, { ms: 88, falseStart: true })).toEqual({ round: 1, ms: null, falseStart: true });
  });

  it("rejects malformed payloads", () => {
    const bad: unknown[] = [
      null,
      "result",
      42,
      [],
      {},
      { round: 1, ms: 200 },
      { round: 0, ms: 200, falseStart: false },
      { round: 6, ms: 200, falseStart: false },
      { round: 1.5, ms: 200, falseStart: false },
      { round: "1", ms: 200, falseStart: false },
      { round: 1, ms: -1, falseStart: false },
      { round: 1, ms: "200", falseStart: false },
      { round: 1, ms: Number.POSITIVE_INFINITY, falseStart: false },
      { round: 1, ms: 1e9, falseStart: false },
      { round: 1, ms: 200, falseStart: "no" },
    ];
    for (const payload of bad) expect(parseResultMessage(payload)).toBeNull();
  });

  it("normalizes accepted payloads", () => {
    expect(parseResultMessage({ round: 3, ms: 201.6, falseStart: false })).toEqual({ round: 3, ms: 202, falseStart: false });
    expect(parseResultMessage({ round: 3, ms: 150, falseStart: true })).toEqual({ round: 3, ms: null, falseStart: true });
    expect(parseResultMessage({ round: 3, ms: null, falseStart: false })).toEqual({ round: 3, ms: null, falseStart: false });
  });
});

describe("bot", () => {
  it("gaussian survives an RNG that returns zero", () => {
    const value = gaussian(scripted(0, 0, 0.25), 10, 2);
    expect(Number.isFinite(value)).toBe(true);
  });

  it("uses the injected RNG deterministically", () => {
    // 0.5 → no false start; u = 0.5, v = 0.25 → cos(π/2) ≈ 0 → exactly the mean.
    expect(sampleBotReaction(scripted(0.5, 0.5, 0.25), 3000)).toEqual({ ms: BOT.meanMs, falseStart: false, falseStartAt: null });
    // v = 0 → mean + deviation × sqrt(-2 ln u).
    const expected = Math.round(BOT.meanMs + BOT.deviationMs * Math.sqrt(-2 * Math.log(0.6)));
    expect(sampleBotReaction(scripted(0.5, 0.6, 0), 3000).ms).toBe(expected);
  });

  it("false-starts mid-STEADY when the first draw is under the chance", () => {
    const r = sampleBotReaction(scripted(0.01, 0.5), 3000);
    expect(r).toEqual({ ms: null, falseStart: true, falseStartAt: 1800 });
    const edge = sampleBotReaction(scripted(0.069, 0.999), 2000);
    expect(edge.falseStartAt).toBeLessThan(2000);
    expect(edge.falseStartAt).toBeGreaterThan(0);
  });

  it("clamps to 170–520 ms", () => {
    // Tiny u → huge |z|: cos(0) = 1 pushes up, cos(π) = -1 pushes down.
    expect(sampleBotReaction(scripted(0.5, 1e-9, 0), 3000).ms).toBe(BOT.maxMs);
    expect(sampleBotReaction(scripted(0.5, 1e-9, 0.5), 3000).ms).toBe(BOT.minMs);
  });

  it("matches the target distribution over many seeded rounds", () => {
    const rng = createRandom("bot-distribution");
    const rand = () => rng.next();
    const n = 20_000;
    let falseStarts = 0;
    const times: number[] = [];
    for (let i = 0; i < n; i++) {
      const steady = STEADY_MIN_MS + (i % 7) * 300;
      const r = sampleBotReaction(rand, steady);
      if (r.falseStart) {
        falseStarts++;
        expect(r.ms).toBeNull();
        expect(r.falseStartAt).toBeGreaterThanOrEqual(steady * 0.3 - 1);
        expect(r.falseStartAt).toBeLessThanOrEqual(steady * 0.9 + 1);
      } else {
        expect(Number.isInteger(r.ms)).toBe(true);
        expect(r.ms).toBeGreaterThanOrEqual(BOT.minMs);
        expect(r.ms).toBeLessThanOrEqual(BOT.maxMs);
        times.push(r.ms as number);
      }
    }
    const rate = falseStarts / n;
    expect(rate).toBeGreaterThan(0.06);
    expect(rate).toBeLessThan(0.08);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    expect(mean).toBeGreaterThan(268);
    expect(mean).toBeLessThan(282);
    const sd = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
    expect(sd).toBeGreaterThan(45);
    expect(sd).toBeLessThan(58);
  });
});

describe("presentation", () => {
  it("describes every kind of outcome", () => {
    expect(describeOutcome(resolveRound(1, tap(200), tap(250)), "Bot")).toEqual({
      headline: "Round to you",
      detail: "50 ms faster",
      tone: "win",
    });
    expect(describeOutcome(resolveRound(1, tap(260), tap(250)), "Bot")).toEqual({
      headline: "Bot takes it",
      detail: "10 ms slower",
      tone: "lose",
    });
    expect(describeOutcome(resolveRound(1, tap(250), tap(250)), "Bot")).toMatchObject({ headline: "Dead heat", tone: "even" });
    expect(describeOutcome(resolveRound(1, tap(250), FALSE_START), "Bot").detail).toBe("Bot jumped the gun");
    expect(describeOutcome(resolveRound(1, FALSE_START, tap(250)), "Bot").detail).toBe("You jumped the gun");
    expect(describeOutcome(resolveRound(1, tap(250), NO_DRAW), "Bot").detail).toBe("Bot never drew");
    expect(describeOutcome(resolveRound(1, NO_DRAW, tap(250)), "Bot").detail).toBe("You never drew");
    expect(describeOutcome(resolveRound(1, FALSE_START, FALSE_START), "Bot")).toMatchObject({
      headline: "No point",
      detail: "You both jumped the gun",
    });
    expect(describeOutcome(resolveRound(1, NO_DRAW, NO_DRAW), "Bot").detail).toBe("Nobody drew");
  });

  it("labels results", () => {
    expect(resultLabel(tap(231))).toBe("231 ms");
    expect(resultLabel(FALSE_START)).toBe("Too early");
    expect(resultLabel(NO_DRAW)).toBe("No draw");
  });

  it("builds JSON-safe submission data", () => {
    const outcomes = [resolveRound(1, tap(240), tap(300)), resolveRound(2, FALSE_START, tap(280)), resolveRound(3, tap(205), NO_DRAW)];
    const data = submissionData(outcomes);
    expect(data.bestMs).toBe(205);
    expect(data.rounds).toHaveLength(3);
    expect(data.rounds[1]).toEqual({
      round: 2,
      me: { ms: null, falseStart: true },
      opp: { ms: 280, falseStart: false },
      winner: "opp",
    });
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
