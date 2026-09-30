import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_FACE, FACE, PART_ORDER, faceConfigProblems, type FaceConfig } from "./face";
import {
  MAX_SPEED,
  PART_MAX_MS,
  PERFECT_WITHIN,
  ZERO_AT,
  botPilotId,
  buildSlides,
  distance,
  dropAt,
  faceScore,
  formatPct,
  nextCrossing,
  parseDrop,
  partAccuracy,
  planBot,
  runningScore,
  shareText,
  slideU,
  speedAt,
  submission,
  trackX,
  trueU,
  trueX,
  verdict,
  type Slide,
} from "./logic";

const slides = buildSlides(createRandom("greg-seed"));

describe("face config", () => {
  it("the shipped face and the default are usable", () => {
    expect(faceConfigProblems(FACE)).toEqual([]);
    expect(faceConfigProblems(DEFAULT_FACE)).toEqual([]);
  });

  it("every true position sits inside the track", () => {
    for (const part of PART_ORDER) {
      const u = trueU(FACE, part);
      expect(u, part).toBeGreaterThan(0);
      expect(u, part).toBeLessThan(1);
    }
  });

  it("catches rects outside the image or on top of each other", () => {
    const bad: FaceConfig = {
      ...DEFAULT_FACE,
      parts: {
        eyes: { x: 10, y: 10, w: 100, h: 40 },
        nose: { x: 50, y: 30, w: 30, h: 40 },
        mouth: { x: 380, y: 300, w: 60, h: 30 },
      },
    };
    const problems = faceConfigProblems(bad);
    expect(problems).toContain("eyes and nose overlap");
    expect(problems.some((p) => p.startsWith("mouth: the rect must sit inside"))).toBe(true);
  });
});

describe("slides", () => {
  it("are identical for the same seed and differ between seeds", () => {
    expect(buildSlides(createRandom("greg-seed"))).toEqual(slides);
    expect(buildSlides(createRandom("other-seed"))).not.toEqual(slides);
  });

  it("start near an end and move inwards, later features faster", () => {
    for (const part of PART_ORDER) {
      const s = slides[part];
      expect(s.start <= 0.12 || s.start >= 0.88).toBe(true);
      expect(s.dir).toBe(s.start < 0.5 ? 1 : -1);
    }
    expect(slides.mouth.v0).toBeGreaterThan(slides.eyes.v0 * 0.9);
  });

  it("speed up until the cap", () => {
    const s: Slide = { start: 0, dir: 1, v0: 0.5, accel: 0.25, vmax: MAX_SPEED };
    expect(speedAt(s, 0)).toBe(0.5);
    expect(speedAt(s, 2_000)).toBeCloseTo(1);
    expect(speedAt(s, 60_000)).toBe(MAX_SPEED);
    // Distance keeps growing continuously past the cap.
    const tCap = ((MAX_SPEED - 0.5) / 0.25) * 1000;
    expect(distance(s, tCap + 1000) - distance(s, tCap)).toBeCloseTo(MAX_SPEED);
    expect(distance(s, -50)).toBe(0);
  });

  it("ping-pong between 0 and 1", () => {
    const s: Slide = { start: 0.2, dir: 1, v0: 1, accel: 0, vmax: 1 };
    expect(slideU(s, 0)).toBeCloseTo(0.2);
    expect(slideU(s, 800)).toBeCloseTo(1);
    expect(slideU(s, 1_300)).toBeCloseTo(0.5);
    expect(slideU(s, 1_800)).toBeCloseTo(0);
    expect(slideU(s, 2_100)).toBeCloseTo(0.3);
    const back: Slide = { ...s, dir: -1 };
    expect(slideU(back, 200)).toBeCloseTo(0);
    expect(slideU(back, 500)).toBeCloseTo(0.3);
    for (let t = 0; t < PART_MAX_MS; t += 37) {
      const u = slideU(slides.nose, t);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });

  it("maps the track across the middle of the face", () => {
    expect(trackX(FACE, 0.5)).toBe(FACE.width / 2);
    expect(trackX(FACE, 0)).toBeCloseTo(FACE.width * 0.1);
    expect(trackX(FACE, 1)).toBeCloseTo(FACE.width * 0.9);
    for (const part of PART_ORDER) expect(trackX(FACE, trueU(FACE, part))).toBeCloseTo(trueX(FACE, part));
  });
});

describe("scoring", () => {
  it("dead on (within the perfect window) is a clean 100", () => {
    expect(partAccuracy(0)).toBe(100);
    expect(partAccuracy(PERFECT_WITHIN)).toBe(100);
    expect(partAccuracy(-PERFECT_WITHIN / 2)).toBe(100);
  });

  it("falls off linearly and never goes below zero", () => {
    expect(partAccuracy(PERFECT_WITHIN + 0.0001)).toBeLessThan(100);
    expect(partAccuracy(ZERO_AT / 2)).toBe(50);
    expect(partAccuracy(ZERO_AT / 10)).toBe(90);
    expect(partAccuracy(ZERO_AT)).toBe(0);
    expect(partAccuracy(1)).toBe(0);
    expect(partAccuracy(Number.NaN)).toBe(0);
    // One decimal.
    expect(partAccuracy(0.0123)).toBe(95.9);
  });

  it("a drop at the crossing time is (nearly) perfect; far away it isn't", () => {
    for (const part of PART_ORDER) {
      const t = nextCrossing(FACE, slides, part, 500);
      expect(t).toBeGreaterThan(500);
      const drop = dropAt(FACE, slides, part, t);
      expect(drop.err).toBeLessThan(0.004);
      expect(drop.accuracy).toBe(100);
      expect(drop.perfect).toBe(true);
    }
    const early = dropAt(FACE, slides, "eyes", 0);
    expect(early.accuracy).toBeLessThan(10);
    expect(early.perfect).toBe(false);
  });

  it("clamps drop times and marks auto drops", () => {
    const late = dropAt(FACE, slides, "mouth", PART_MAX_MS + 5_000, true);
    expect(late.atMs).toBe(PART_MAX_MS);
    expect(late.auto).toBe(true);
    expect(dropAt(FACE, slides, "mouth", -20).atMs).toBe(0);
  });

  it("the face is the average of three, a missing part counts zero", () => {
    expect(faceScore([{ accuracy: 100 }, { accuracy: 80 }, { accuracy: 60 }])).toBe(80);
    expect(faceScore([{ accuracy: 91.2 }, { accuracy: 88.8 }, { accuracy: 73.3 }])).toBe(84.4);
    expect(faceScore([{ accuracy: 90 }])).toBe(30);
    expect(runningScore([{ accuracy: 90 }])).toBe(90);
    expect(runningScore([])).toBe(0);
  });

  it("verdicts go from Greg to Picasso", () => {
    expect(verdict(100).title).toBe("That's Greg!");
    expect(verdict(92).title).toBe("Spitting image");
    expect(verdict(10).title).toBe("Picasso's Greg");
  });

  it("submission carries the score, parts and a readable line", () => {
    const drops = PART_ORDER.map((part, i) => dropAt(FACE, slides, part, nextCrossing(FACE, slides, part, 400) + i * 40));
    const sub = submission(drops);
    expect(sub.score).toBe(faceScore(drops));
    expect(sub.display.body).toMatch(/^👀 .*% {2}👃 .*% {2}👄 .*%$/);
    expect((sub.data as { parts: unknown[] }).parts).toHaveLength(3);
    expect(formatPct(87)).toBe("87%");
    expect(formatPct(87.46)).toBe("87.5%");
    expect(shareText(86.6)).toBe("I built Greg's face 87% right on XApps 🤪");
  });

  it("room payloads are validated", () => {
    expect(parseDrop({ part: "nose", accuracy: 88.44 })).toEqual({ part: "nose", accuracy: 88.4 });
    expect(parseDrop({ part: "ears", accuracy: 50 })).toBeNull();
    expect(parseDrop({ part: "eyes", accuracy: 101 })).toBeNull();
    expect(parseDrop([1])).toBeNull();
    expect(parseDrop(null)).toBeNull();
  });
});

describe("bots", () => {
  it("are played by the lowest-seated human only", () => {
    const table = [
      { id: "bot1", seat: 0, isBot: true },
      { id: "ann", seat: 2, isBot: false },
      { id: "bob", seat: 1, isBot: false },
    ];
    expect(botPilotId(table)).toBe("bob");
    expect(botPilotId(table.filter((p) => p.isBot))).toBeNull();
  });

  it("play deterministically per seed", () => {
    const a = planBot(FACE, slides, createRandom("seed::bot:b1"));
    const b = planBot(FACE, slides, createRandom("seed::bot:b1"));
    expect(a).toEqual(b);
    expect(a.drops.map((d) => d.part)).toEqual(PART_ORDER);
    expect(a.times).toHaveLength(3);
    expect(a.times[0]!).toBeLessThan(a.times[1]!);
    expect(a.finishMs).toBeGreaterThan(a.times[2]!);
  });

  it("score like decent humans: mostly 70–98, rarely perfect", () => {
    const scores: number[] = [];
    let perfect = 0;
    for (let i = 0; i < 300; i++) {
      const seedSlides = buildSlides(createRandom(`m${i}`));
      const run = planBot(FACE, seedSlides, createRandom(`m${i}::bot:x`));
      scores.push(faceScore(run.drops));
      perfect += run.drops.filter((d) => d.perfect).length;
    }
    scores.sort((x, y) => x - y);
    const median = scores[150]!;
    expect(median).toBeGreaterThan(80);
    expect(median).toBeLessThan(97);
    expect(scores[15]!).toBeGreaterThan(55);
    expect(perfect / 900).toBeLessThan(0.35);
    // Short matches: a bot is done well within half a minute.
    const run = planBot(FACE, slides, createRandom("slow"));
    expect(run.finishMs).toBeLessThan(25_000);
  });
});
