import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  ATTEMPTS,
  BOARD,
  CENTER,
  EMPTY_RUN,
  MAX_DRAW_MS,
  MIN_RADIUS,
  PERFECT,
  analyzeStroke,
  bestOfBot,
  bestScore,
  botShakiness,
  floor1,
  fromWire,
  inkColor,
  liveAccuracy,
  parseAttempt,
  planBot,
  radialStats,
  recordStroke,
  resample,
  sweepOf,
  synthCircle,
  toWire,
  trimToTurn,
  verdictFor,
  type Analysis,
  type Point,
} from "./logic";

const score = (points: Point[]): number => {
  const a = analyzeStroke(points);
  if (!a.ok) throw new Error(`rejected: ${a.reason}`);
  return a.accuracy;
};

const reason = (points: Point[]) => {
  const a = analyzeStroke(points);
  return a.ok ? null : a.reason;
};

const oval = (amp: number) => synthCircle({ radius: 300, harmonics: [{ k: 2, amp, phase: 0 }] });

describe("Perfect Circle scoring", () => {
  it("a true circle around the dot is 100.0%", () => {
    expect(score(synthCircle({ radius: 300 }))).toBe(100);
    expect(score(synthCircle({ radius: 150, samples: 60 }))).toBe(100);
  });

  it("gets worse the more it wobbles", () => {
    const scores = [0.01, 0.02, 0.04, 0.08].map((amp) => score(oval(amp)));
    for (let i = 1; i < scores.length; i++) expect(scores[i]!).toBeLessThan(scores[i - 1]!);
    // A 2% oval (mean deviation 2%·2/π ≈ 1.27%) loses about 2.5 points.
    expect(scores[1]).toBeCloseTo(100 * (1 - 2 * 0.02 * (2 / Math.PI)), 0);
  });

  it("is centered on the dot: a round circle drawn off to one side scores lower", () => {
    const centered = score(synthCircle({ radius: 300 }));
    const off = score(synthCircle({ radius: 300, offset: { x: 30, y: 0 } }));
    const way = score(synthCircle({ radius: 300, offset: { x: 90, y: 0 } }));
    expect(off).toBeLessThan(centered);
    expect(way).toBeLessThan(off);
  });

  it("doesn't care about direction, starting point, size or speed", () => {
    const base = { radius: 300, harmonics: [{ k: 3, amp: 0.03, phase: 0.4 }] };
    const a = score(synthCircle(base));
    expect(score(synthCircle({ ...base, ccw: true }))).toBeCloseTo(a, 0);
    expect(score(synthCircle({ ...base, startDeg: 37 }))).toBeCloseTo(a, 0);
    expect(score(synthCircle({ ...base, radius: 180 }))).toBe(a);
    expect(score(synthCircle({ ...base, durationMs: 700 }))).toBe(a);
    // Twice the samples (a 120 Hz pointer vs 60 Hz) is the same circle.
    expect(score(synthCircle({ ...base, samples: 360 }))).toBeCloseTo(a, 0);
  });

  it("uneven pointer sampling (slow here, fast there) doesn't skew it", () => {
    const even = synthCircle({ radius: 300, harmonics: [{ k: 2, amp: 0.03, phase: 0 }], samples: 720 });
    // Keep every point in the first half, every 6th in the second: very different densities.
    const uneven = even.filter((_, i) => i < 360 || i % 6 === 0 || i === even.length - 1);
    expect(Math.abs(score(uneven) - score(even))).toBeLessThanOrEqual(0.3);
  });

  it("penalises spirals where the ends don't meet", () => {
    const round = score(synthCircle({ radius: 300 }));
    const spiral = analyzeStroke(synthCircle({ radius: 300, drift: 0.1 }));
    expect(spiral.ok).toBe(true);
    if (!spiral.ok) return;
    expect(spiral.gap).toBeCloseTo(0.1, 2);
    expect(spiral.accuracy).toBeLessThan(round - 5);
  });

  it("rounds down to one decimal so only a true circle shows 100.0%", () => {
    expect(floor1(99.99)).toBe(99.9);
    expect(floor1(97.3)).toBe(97.3);
    expect(floor1(97.29999999)).toBe(97.3);
    const almost = score(synthCircle({ radius: 300, harmonics: [{ k: 2, amp: 0.0005, phase: 0 }] }));
    expect(almost).toBeLessThan(100);
    expect(almost).toBeGreaterThanOrEqual(99.9);
  });

  it("is deterministic", () => {
    const stroke = synthCircle({ radius: 280, harmonics: [{ k: 2, amp: 0.02, phase: 1 }, { k: 5, amp: 0.01, phase: 2 }] });
    expect(analyzeStroke(stroke)).toEqual(analyzeStroke(stroke.map((p) => ({ ...p }))));
  });

  it("the 'perfect' line (98%) needs the stroke within about 1% of the radius", () => {
    expect(score(oval(0.012))).toBeGreaterThanOrEqual(PERFECT); // mean deviation ≈ 0.76%
    expect(score(oval(0.02))).toBeLessThan(PERFECT); // ≈ 1.27%
  });
});

describe("Perfect Circle rejections", () => {
  it("too small", () => {
    expect(reason(synthCircle({ radius: MIN_RADIUS - 5 }))).toBe("small");
    expect(reason(synthCircle({ radius: MIN_RADIUS + 5 }))).toBeNull();
    expect(reason([])).toBe("small");
    expect(reason([{ x: 700, y: 500, t: 0 }])).toBe("small");
  });

  it("too slow", () => {
    expect(reason(synthCircle({ radius: 300, durationMs: MAX_DRAW_MS + 1 }))).toBe("slow");
    expect(reason(synthCircle({ radius: 300, durationMs: MAX_DRAW_MS }))).toBeNull();
    // Only the time to the full turn counts: dawdling after it is trimmed off.
    const slowTail = synthCircle({ radius: 300, turns: 1.5, durationMs: MAX_DRAW_MS * 1.4 });
    expect(reason(slowTail)).toBeNull();
  });

  it("not a full circle", () => {
    expect(reason(synthCircle({ radius: 300, turns: 0.5 }))).toBe("incomplete");
    expect(reason(synthCircle({ radius: 300, turns: 330 / 360 }))).toBe("incomplete");
    // A circle that doesn't go around the dot never sweeps around it.
    expect(reason(synthCircle({ radius: 150, offset: { x: 300, y: 0 } }))).toBe("incomplete");
  });

  it("nearly all the way round still counts, minus the missing arc", () => {
    const a = analyzeStroke(synthCircle({ radius: 300, turns: 350 / 360 }));
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.accuracy).toBeCloseTo(floor1((100 * 350) / 360), 0);
  });
});

describe("Perfect Circle geometry", () => {
  it("trims at exactly one full turn, so overdrawing changes nothing", () => {
    const opts = { radius: 300, harmonics: [{ k: 3, amp: 0.02, phase: 0 }] };
    const once = synthCircle({ ...opts, samples: 360 });
    const more = synthCircle({ ...opts, samples: 360, turns: 1.4, durationMs: 1800 * 1.4 });
    const trimmed = trimToTurn(more);
    expect(Math.abs(sweepOf(trimmed))).toBeCloseTo(Math.PI * 2, 6);
    expect(score(more)).toBe(score(once));
    expect(trimToTurn(synthCircle({ radius: 300, turns: 0.6 })).length).toBe(synthCircle({ radius: 300, turns: 0.6 }).length);
  });

  it("sweep is signed by direction", () => {
    expect(sweepOf(synthCircle({ radius: 200, turns: 0.5 }))).toBeCloseTo(Math.PI, 6);
    expect(sweepOf(synthCircle({ radius: 200, turns: 0.5, ccw: true }))).toBeCloseTo(-Math.PI, 6);
  });

  it("radial stats: mean radius and wobble, weighted by length", () => {
    const r = radialStats(synthCircle({ radius: 250, samples: 720 }));
    expect(r.radius).toBeCloseTo(250, 0);
    expect(r.deviation).toBeLessThan(1e-4);
    expect(r.length).toBeCloseTo(2 * Math.PI * 250, -1);
  });

  it("the live readout ignores the first few degrees, then tracks roundness", () => {
    const quarter = synthCircle({ radius: 300, turns: 0.02 });
    expect(liveAccuracy(quarter)).toBeNull();
    expect(liveAccuracy(synthCircle({ radius: 300, turns: 0.5 }))).toBe(100);
  });

  it("resamples evenly by length, keeping the ends", () => {
    const pts = [
      { x: 0, y: 0, t: 0 },
      { x: 10, y: 0, t: 10 },
      { x: 10, y: 30, t: 40 },
    ];
    const out = resample(pts, 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ x: 0, y: 0, t: 0 });
    expect(out[4]).toEqual({ x: 10, y: 30, t: 40 });
    expect(out[1]).toEqual({ x: 10, y: 0, t: 10 });
    expect(out[2]!.y).toBeCloseTo(10);
  });

  it("ink goes green → amber → red with the error", () => {
    expect(inkColor(0)).toBe("rgb(55,227,155)");
    expect(inkColor(0.06)).toBe("rgb(255,201,61)");
    expect(inkColor(0.5)).toBe("rgb(255,77,94)");
  });

  it("verdicts", () => {
    expect(verdictFor(100).word).toBe("Impossible");
    expect(verdictFor(98).word).toBe("Perfect!");
    expect(verdictFor(97.9).word).toBe("Superb");
    expect(verdictFor(42).word).toBe("That's an egg");
  });
});

describe("Perfect Circle runs", () => {
  const ok = (accuracy: number): Analysis => ({
    ok: true,
    accuracy,
    deviation: 0,
    gap: 0,
    stroke: [{ x: accuracy, y: 0, t: 0 }],
    radius: 300,
    sweepDeg: 360,
    durationMs: 1000,
  });
  const miss: Analysis = { ok: false, reason: "small", stroke: [], radius: 20, sweepDeg: 360, durationMs: 500 };

  it("keeps the best of three; misses are free retries", () => {
    let run = EMPTY_RUN;
    run = recordStroke(run, ok(91.2));
    run = recordStroke(run, miss);
    run = recordStroke(run, ok(95.5));
    run = recordStroke(run, ok(93));
    expect(run.scores).toEqual([91.2, 95.5, 93]);
    expect(run.misses).toBe(1);
    expect(bestScore(run)).toBe(95.5);
    expect(run.bestIndex).toBe(1);
    expect(run.bestStroke).toEqual([{ x: 95.5, y: 0, t: 0 }]);
    // Full: further strokes are ignored.
    expect(recordStroke(run, ok(99))).toBe(run);
    expect(run.scores).toHaveLength(ATTEMPTS);
  });

  it("a tie keeps the first circle", () => {
    const run = recordStroke(recordStroke(EMPTY_RUN, ok(90)), ok(90));
    expect(run.bestIndex).toBe(0);
  });
});

describe("Perfect Circle bots", () => {
  it("plays three plausible, deterministic circles per bot", () => {
    const a = planBot("bot", createRandom("seed").fork("bot:bot"));
    const b = planBot("bot", createRandom("seed").fork("bot:bot"));
    expect(a).toEqual(b);
    expect(a).toHaveLength(ATTEMPTS);
    for (const attempt of a) {
      // The bot's score is the real score of the circle it drew.
      expect(analyzeStroke(attempt.stroke)).toMatchObject({ ok: true, accuracy: attempt.accuracy });
    }
    // Finishing times go up and fit inside the match clock.
    expect(a.map((x) => x.atMs)).toEqual([...a.map((x) => x.atMs)].sort((x, y) => x - y));
    expect(a[a.length - 1]!.atMs).toBeLessThan(30_000);
  });

  it("scores like a decent human: mostly 80s–90s, rarely perfect", () => {
    const all: number[] = [];
    const bests: number[] = [];
    for (let i = 0; i < 60; i++) {
      const plan = planBot(`bot${i}`, createRandom(`table-${i}`).fork(`bot:bot${i}`));
      all.push(...plan.map((p) => p.accuracy));
      bests.push(bestOfBot(plan)!.accuracy);
    }
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(Math.min(...all)).toBeGreaterThan(55);
    expect(mean(all)).toBeGreaterThan(84);
    expect(mean(all)).toBeLessThan(93);
    expect(mean(bests)).toBeLessThan(96);
    expect(bests.filter((s) => s >= PERFECT).length).toBeLessThanOrEqual(6);
  });

  it("each bot has a stable hand", () => {
    expect(botShakiness("bot2")).toBe(botShakiness("bot2"));
    expect(botShakiness("x")).toBeGreaterThanOrEqual(1.4);
    expect(botShakiness("x")).toBeLessThanOrEqual(3.4);
  });
});

describe("Perfect Circle wire format", () => {
  it("round-trips a circle through the room (validated)", () => {
    const stroke = synthCircle({ radius: 300 });
    const msg = toWire(2, 97.34, stroke);
    expect(msg.pts).toHaveLength(128);
    const parsed = parseAttempt(JSON.parse(JSON.stringify(msg)));
    expect(parsed).toEqual({ n: 2, accuracy: 97.3, pts: msg.pts });
    const back = fromWire(parsed!.pts);
    expect(back).toHaveLength(64);
    expect(Math.hypot(back[0]!.x - CENTER.x, back[0]!.y - CENTER.y)).toBeCloseTo(300, -1);
  });

  it("refuses junk", () => {
    expect(parseAttempt(null)).toBeNull();
    expect(parseAttempt({ n: 0, accuracy: 50, pts: [] })).toBeNull();
    expect(parseAttempt({ n: 4, accuracy: 50, pts: [] })).toBeNull();
    expect(parseAttempt({ n: 1, accuracy: 101, pts: [] })).toBeNull();
    expect(parseAttempt({ n: 1, accuracy: 50, pts: [1] })).toBeNull();
    expect(parseAttempt({ n: 1, accuracy: 50, pts: ["1", 2] })).toBeNull();
    expect(parseAttempt({ n: 1, accuracy: 50, pts: new Array(200).fill(BOARD / 2) })).toBeNull();
  });
});
