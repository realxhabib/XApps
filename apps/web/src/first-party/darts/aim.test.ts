import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  BREATH,
  FLICK,
  POWER,
  SWAY,
  analyzeFlick,
  breathFactor,
  breathHeld,
  chargeLevel,
  chargeToSpeed,
  clampAim,
  flightMs,
  landingPoint,
  lateralError,
  normalizeSpeed,
  powerGauge,
  powerVerdict,
  reticleAt,
  swayOffset,
  swayParams,
  swayStrength,
  verticalError,
  type Release,
  type Sample,
} from "./aim";
import { hitTest, target } from "./board";

const params = (seed = "match-1", dart = 0) => swayParams(createRandom(seed).fork(`sway:${dart}`).next);

describe("sway", () => {
  it("is deterministic: the same seed sways the same way", () => {
    const a = params();
    const b = params();
    expect(a).toEqual(b);
    for (const t of [0, 250, 1234.5, 5000]) expect(swayOffset(a, t)).toEqual(swayOffset(b, t));
  });

  it("differs between darts and between matches", () => {
    const t = 1500;
    expect(swayOffset(params("m", 0), t)).not.toEqual(swayOffset(params("m", 1), t));
    expect(swayOffset(params("m", 0), t)).not.toEqual(swayOffset(params("n", 0), t));
  });

  it("moves smoothly (no jumps between frames)", () => {
    const p = params();
    for (let t = 0; t < 6000; t += 16) {
      const a = swayOffset(p, t);
      const b = swayOffset(p, t + 16);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(3);
    }
  });

  it("stays within a sensible range and actually wanders", () => {
    const p = params();
    let max = 0;
    let sumX = 0;
    let n = 0;
    for (let t = 0; t < 3000; t += 10) {
      const s = swayOffset(p, t);
      max = Math.max(max, Math.hypot(s.x, s.y));
      sumX += s.x;
      n++;
    }
    expect(max).toBeGreaterThan(SWAY.amplitude * 0.4);
    expect(max).toBeLessThan(SWAY.amplitude * 1.6);
    expect(Math.abs(sumX / n)).toBeLessThan(SWAY.amplitude); // centred-ish, not a constant drift
  });

  it("starts gentle while the dart comes up, and tires the arm when held too long", () => {
    const amp = 10;
    expect(swayStrength(0, null, amp)).toBeCloseTo(amp * SWAY.raiseFactor);
    expect(swayStrength(SWAY.raiseMs, null, amp)).toBeCloseTo(amp);
    expect(swayStrength(SWAY.fatigueAfterMs + 2000, null, amp)).toBeGreaterThan(amp);
    expect(swayStrength(120_000, null, amp)).toBeCloseTo(amp * SWAY.fatigueMax);
  });

  it("holding your breath calms the sway, then you gasp", () => {
    expect(breathFactor(500, null)).toBe(1);
    expect(breathFactor(500, 1000)).toBe(1); // not yet
    expect(breathFactor(1000 + BREATH.inMs + 10, 1000)).toBe(BREATH.held);
    expect(breathHeld(1000 + BREATH.holdMs - 1, 1000)).toBe(true);
    expect(breathHeld(1000 + BREATH.holdMs, 1000)).toBe(false);
    expect(breathFactor(1000 + BREATH.holdMs + BREATH.gaspMs, 1000)).toBeCloseTo(BREATH.gasp);
    expect(breathFactor(1000 + BREATH.holdMs + BREATH.gaspMs + BREATH.recoverMs + 1, 1000)).toBe(1);
    const p = params();
    const calm = swayOffset(p, 2000, 1000);
    const wild = swayOffset(p, 2000, null);
    expect(Math.hypot(calm.x, calm.y)).toBeCloseTo(Math.hypot(wild.x, wild.y) * BREATH.held, 5);
  });
});

/** A synthetic stroke: hold still, then flick up at `speed` px/ms for `ms`, optionally drifting sideways. */
function stroke({ hold = 300, speed = 2, ms = 60, dx = 0, lift = true }: { hold?: number; speed?: number; ms?: number; dx?: number; lift?: boolean } = {}): Sample[] {
  const out: Sample[] = [];
  for (let t = 0; t <= hold; t += 16) out.push({ t, x: 200, y: 600 });
  const step = 8;
  for (let t = step; t <= ms; t += step) out.push({ t: hold + t, x: 200 + (dx * t) / ms, y: 600 - speed * t });
  if (lift) {
    const last = out[out.length - 1]!;
    out.push({ ...last, t: last.t + 6 });
  }
  return out;
}

describe("analyzeFlick", () => {
  it("finds the flick at the end of a stroke and its speed", () => {
    const samples = stroke({ speed: 2, ms: 64 });
    const flick = analyzeFlick(samples);
    expect(flick.kind).toBe("throw");
    if (flick.kind !== "throw") return;
    expect(flick.speed).toBeCloseTo(2, 1);
    expect(flick.angle).toBeCloseTo(0);
    // The aim is read where the finger took off (the last still sample).
    expect(samples[flick.startIndex]!.t).toBe(288);
  });

  it("reads a sideways flick's angle", () => {
    const flick = analyzeFlick(stroke({ speed: 2, ms: 64, dx: 40 }));
    expect(flick.kind).toBe("throw");
    if (flick.kind === "throw") expect(flick.angle).toBeCloseTo(Math.atan2(40, 128), 2);
  });

  it("ignores a slow aiming drag before the flick", () => {
    const samples: Sample[] = [];
    for (let t = 0; t <= 400; t += 16) samples.push({ t, x: 200, y: 600 - t * 0.08 }); // drifting up slowly while aiming
    const top = samples[samples.length - 1]!;
    for (let t = 8; t <= 56; t += 8) samples.push({ t: top.t + t, x: 200, y: top.y - 2.5 * t });
    const flick = analyzeFlick(samples);
    expect(flick.kind).toBe("throw");
    if (flick.kind !== "throw") return;
    expect(top.t - samples[flick.startIndex]!.t).toBeLessThanOrEqual(32);
    expect(flick.speed).toBeCloseTo(2.5, 1);
  });

  it("cancels taps, drags down, slow pushes and a stop before lifting", () => {
    expect(analyzeFlick([{ t: 0, x: 0, y: 0 }])).toEqual({ kind: "cancel", reason: "short" });
    expect(analyzeFlick(stroke({ speed: 2, ms: 8 })).kind).toBe("cancel"); // 16 px
    expect(analyzeFlick(stroke({ speed: -2, ms: 80 }))).toMatchObject({ kind: "cancel" });
    expect(analyzeFlick(stroke({ speed: 0.2, ms: 300 }))).toMatchObject({ kind: "cancel" });
    const stopped = stroke({ speed: 2, ms: 64, lift: false });
    const last = stopped[stopped.length - 1]!;
    stopped.push({ ...last, t: last.t + FLICK.liftGraceMs + 50 });
    expect(analyzeFlick(stopped).kind).toBe("cancel");
  });

  it("forgives a short pause before lifting off", () => {
    const paused = stroke({ speed: 2, ms: 64, lift: false });
    const last = paused[paused.length - 1]!;
    paused.push({ ...last, t: last.t + 100 });
    const flick = analyzeFlick(paused);
    expect(flick.kind).toBe("throw");
    if (flick.kind === "throw") expect(flick.speed).toBeCloseTo(2, 1);
  });

  it("survives a frame hitch in the middle of a flick", () => {
    const samples = stroke({ speed: 2, ms: 48, lift: false });
    const last = samples[samples.length - 1]!;
    samples.push({ t: last.t + 74, x: last.x, y: last.y - 17 }, { t: last.t + 82, x: last.x, y: last.y - 34 });
    const flick = analyzeFlick(samples);
    expect(flick.kind).toBe("throw");
    if (flick.kind === "throw") expect(samples[flick.startIndex]!.t).toBeLessThanOrEqual(300);
  });

  it("copes with bunched samples (same timestamps)", () => {
    const bunched: Sample[] = [
      { t: 0, x: 0, y: 600 },
      { t: 900, x: 0, y: 590 },
      { t: 900, x: 0, y: 570 },
      { t: 900, x: 0, y: 550 },
      { t: 916, x: 0, y: 500 },
    ];
    const flick = analyzeFlick(bunched);
    expect(flick.kind).toBe("throw");
    if (flick.kind === "throw") {
      expect(Number.isFinite(flick.speed)).toBe(true);
      expect(flick.speed).toBeLessThan(10);
    }
  });

  it("needs a minimum rise", () => {
    expect(FLICK.minDistance).toBeGreaterThan(10);
  });

  it("normalizes speed to the stage height", () => {
    expect(normalizeSpeed(2, 760)).toBeCloseTo(2);
    expect(normalizeSpeed(2, 1100)).toBeCloseTo(2 * (760 / 1100));
    expect(normalizeSpeed(2, 200)).toBeCloseTo(2 * (760 / 480)); // clamped
  });
});

describe("flick → landing", () => {
  it("the sweet spot barely moves the dart; soft drops it, hard lifts it", () => {
    const mid = (POWER.low + POWER.high) / 2;
    expect(verticalError(mid)).toBeCloseTo(0);
    expect(Math.abs(verticalError(POWER.low))).toBeLessThan(5);
    expect(Math.abs(verticalError(POWER.high))).toBeLessThan(5);
    expect(verticalError(POWER.min)).toBeCloseTo(POWER.maxDrop);
    expect(verticalError(0)).toBeCloseTo(POWER.maxDrop); // clamped
    expect(verticalError(POWER.max)).toBeCloseTo(-POWER.maxRise);
    expect(verticalError(99)).toBeCloseTo(-POWER.maxRise);
    // Monotonic: faster always lands higher (smaller y).
    let prev = Infinity;
    for (let s = 0.3; s <= 6; s += 0.05) {
      const e = verticalError(s);
      expect(e).toBeLessThanOrEqual(prev + 1e-9);
      prev = e;
    }
  });

  it("classifies power for feedback", () => {
    expect(powerVerdict(0.8)).toBe("soft");
    expect(powerVerdict(2)).toBe("good");
    expect(powerVerdict(4)).toBe("hard");
    expect(powerGauge(POWER.min)).toBe(0);
    expect(powerGauge(POWER.max)).toBe(1);
  });

  it("a crooked flick pulls sideways beyond a dead zone", () => {
    expect(lateralError(0)).toBe(0);
    expect(lateralError(POWER.deadAngle)).toBe(0);
    expect(lateralError(0.4)).toBeGreaterThan(0);
    expect(lateralError(-0.4)).toBeLessThan(0);
    expect(lateralError(2)).toBe(POWER.maxSideways);
    expect(lateralError(Number.NaN)).toBe(0);
  });

  it("is a pure function of the release and the sway", () => {
    const p = params();
    const release: Release = { aim: target(20, "treble"), swayT: 1234, breathAt: 600, speed: 2.1, angle: 0.05 };
    const a = landingPoint(release, p);
    expect(landingPoint({ ...release }, params())).toEqual(a);
    const r = reticleAt(release.aim, p, release.swayT, release.breathAt);
    expect(a.x).toBeCloseTo(r.x);
    expect(a.y).toBeCloseTo(r.y + verticalError(2.1));
  });

  it("a perfect flick with a calm breath lands where the reticle was", () => {
    const p = params();
    const aim = target(20, "treble");
    // Mid-breath the sway is tiny, so a clean flick at the sweet spot hits the treble.
    const land = landingPoint({ aim, swayT: 2200, breathAt: 1500, speed: (POWER.low + POWER.high) / 2, angle: 0 }, p);
    expect(hitTest(land).label).toBe("T20");
  });

  it("a soft flick at the treble 20 drops into the single 20 or lower", () => {
    const aim = target(20, "treble");
    const flat = { ...params(), amp: 0 };
    const land = landingPoint({ aim, swayT: 1000, breathAt: null, speed: 0.9, angle: 0 }, flat);
    expect(land.y).toBeGreaterThan(aim.y + 8);
    expect(hitTest(land).label).toBe("20");
    const hard = landingPoint({ aim, swayT: 1000, breathAt: null, speed: 5, angle: 0 }, flat);
    expect(hard.y).toBeLessThan(aim.y - 40);
  });

  it("flight time shrinks with power", () => {
    expect(flightMs(1)).toBeGreaterThan(flightMs(4));
    expect(flightMs(-5)).toBeLessThanOrEqual(420);
    expect(flightMs(50)).toBeGreaterThanOrEqual(190);
  });

  it("keyboard charge swings and maps into the power range", () => {
    expect(chargeLevel(0)).toBe(0);
    expect(chargeLevel(700)).toBeCloseTo(1);
    expect(chargeLevel(1400)).toBeCloseTo(0);
    expect(chargeToSpeed(0)).toBe(POWER.min);
    const good = [0.3, 0.4, 0.5].map(chargeToSpeed).map(powerVerdict);
    expect(good).toContain("good");
  });

  it("clampAim keeps the aim around the board", () => {
    expect(clampAim({ x: 999, y: -999 })).toEqual({ x: 230, y: -230 });
  });
});
