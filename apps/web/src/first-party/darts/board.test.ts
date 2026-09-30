import { describe, expect, it } from "vitest";
import {
  ORDER,
  RADIUS,
  SEGMENT_DEG,
  angleOf,
  clampToView,
  hitTest,
  makeHit,
  pointOn,
  ringAt,
  ringCentreRadius,
  segmentIndexAt,
  target,
  wireAngle,
  wireDistance,
  type Point,
  type Ring,
} from "./board";

/** A point at `deg` clockwise from straight up, `r` mm out. */
const polar = (deg: number, r: number): Point => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad) * r, y: -Math.cos(rad) * r };
};

const SCORING: Ring[] = ["inner-single", "treble", "outer-single", "double"];

describe("board layout", () => {
  it("uses the regulation number order, clockwise from the top", () => {
    expect(ORDER).toEqual([20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]);
    expect(new Set(ORDER).size).toBe(20);
    expect(SEGMENT_DEG).toBe(18);
  });

  it("measures angles clockwise from straight up (y grows down)", () => {
    expect(angleOf({ x: 0, y: -10 })).toBeCloseTo(0);
    expect(angleOf({ x: 10, y: 0 })).toBeCloseTo(90);
    expect(angleOf({ x: 0, y: 10 })).toBeCloseTo(180);
    expect(angleOf({ x: -10, y: 0 })).toBeCloseTo(270);
  });

  it("has 6 at 3 o'clock, 3 at 6 o'clock and 11 at 9 o'clock", () => {
    expect(hitTest({ x: 130, y: 0 }).number).toBe(6);
    expect(hitTest({ x: 0, y: 130 }).number).toBe(3);
    expect(hitTest({ x: -130, y: 0 }).number).toBe(11);
    expect(hitTest({ x: 0, y: -130 }).number).toBe(20);
  });
});

describe("hitTest: every segment and ring", () => {
  it.each(ORDER.map((n, i) => [n, i] as const))("segment %i scores in every ring", (number, index) => {
    for (const ring of SCORING) {
      const hit = hitTest(polar(index * 18, ringCentreRadius(ring)));
      expect(hit.ring, `${number} ${ring}`).toBe(ring);
      expect(hit.number).toBe(number);
      const m = ring === "treble" ? 3 : ring === "double" ? 2 : 1;
      expect(hit.multiplier).toBe(m);
      expect(hit.score).toBe(number * m);
      expect(hit.label).toBe(`${m === 3 ? "T" : m === 2 ? "D" : ""}${number}`);
    }
  });

  it("scores both bulls anywhere around the centre", () => {
    for (let deg = 0; deg < 360; deg += 7) {
      expect(hitTest(polar(deg, 3))).toMatchObject({ ring: "bull", number: 25, multiplier: 2, score: 50, label: "BULL" });
      expect(hitTest(polar(deg, 11))).toMatchObject({ ring: "outer-bull", number: 25, multiplier: 1, score: 25, label: "25" });
    }
    expect(hitTest({ x: 0, y: 0 }).score).toBe(50);
  });

  it("misses outside the doubles, on the numbers ring and off the board", () => {
    expect(hitTest(polar(0, 190))).toMatchObject({ ring: "board", score: 0, multiplier: 0, number: 0, label: "MISS" });
    expect(hitTest(polar(123, 400))).toMatchObject({ ring: "off", score: 0, label: "MISS" });
  });

  it("finds the right bed from target()", () => {
    expect(hitTest(target(20, "treble")).label).toBe("T20");
    expect(hitTest(target(16, "double")).label).toBe("D16");
    expect(hitTest(target(25, "bull")).label).toBe("BULL");
    expect(hitTest(target(25, "outer-bull")).label).toBe("25");
    expect(hitTest(target(7, "outer-single")).label).toBe("7");
  });

  it("reaches 180 with three treble 20s and 60 is the best single dart", () => {
    const best = Math.max(...ORDER.flatMap((n) => SCORING.map((ring) => hitTest(target(n, ring)).score)));
    expect(best).toBe(60);
  });
});

describe("hitTest: wires", () => {
  it("a point exactly on a ring wire belongs to the ring inside it", () => {
    const at = (r: number) => hitTest(polar(0, r)).ring;
    expect(at(RADIUS.bull)).toBe("bull");
    expect(at(RADIUS.outerBull)).toBe("outer-bull");
    expect(at(RADIUS.trebleInner)).toBe("inner-single");
    expect(at(RADIUS.trebleOuter)).toBe("treble");
    expect(at(RADIUS.doubleInner)).toBe("outer-single");
    expect(at(RADIUS.doubleOuter)).toBe("double");
    expect(at(RADIUS.edge)).toBe("board");
    // A hair outside each wire is the next ring out.
    const e = 1e-6;
    expect(at(RADIUS.bull + e)).toBe("outer-bull");
    expect(at(RADIUS.outerBull + e)).toBe("inner-single");
    expect(at(RADIUS.trebleInner + e)).toBe("treble");
    expect(at(RADIUS.trebleOuter + e)).toBe("outer-single");
    expect(at(RADIUS.doubleInner + e)).toBe("double");
    expect(at(RADIUS.doubleOuter + e)).toBe("board");
    expect(at(RADIUS.edge + e)).toBe("off");
  });

  it("a point exactly on a radial wire belongs to the segment clockwise of it", () => {
    for (let i = 0; i < 20; i++) {
      const wire = wireAngle(i); // anticlockwise edge of segment i
      const before = ORDER[(i + 19) % 20];
      expect(segmentIndexAt(wire)).toBe(i);
      expect(hitTest(polar(wire, 130)).number, `wire into ${ORDER[i]}`).toBe(ORDER[i]);
      expect(hitTest(polar(wire + 0.01, 130)).number).toBe(ORDER[i]);
      expect(hitTest(polar(wire - 0.01, 130)).number).toBe(before);
    }
  });

  it("the wire between 5 and 20 (351°) wraps around correctly", () => {
    expect(hitTest(polar(351, 103)).label).toBe("T20");
    expect(hitTest(polar(350.99, 103)).label).toBe("T5");
    expect(hitTest(polar(8.99, 103)).label).toBe("T20");
    expect(hitTest(polar(9, 103)).label).toBe("T1");
  });

  it("ringAt follows the same boundaries", () => {
    expect(ringAt(0)).toBe("bull");
    expect(ringAt(103)).toBe("treble");
    expect(ringAt(166)).toBe("double");
    expect(ringAt(1000)).toBe("off");
  });
});

describe("helpers", () => {
  it("makeHit labels misses and bulls", () => {
    expect(makeHit("off", 20)).toEqual({ ring: "off", number: 0, multiplier: 0, score: 0, label: "MISS" });
    expect(makeHit("bull", 0).score).toBe(50);
  });

  it("pointOn rejects numbers that aren't on the board", () => {
    expect(() => pointOn(21, 100)).toThrow();
    expect(pointOn(20, 100).y).toBeCloseTo(-100);
  });

  it("wireDistance measures to the nearest ring or radial wire", () => {
    expect(wireDistance(polar(0, RADIUS.trebleInner))).toBeCloseTo(0);
    expect(wireDistance(polar(wireAngle(3), 130))).toBeCloseTo(0);
    expect(wireDistance(polar(0, 103))).toBeCloseTo(4); // middle of the T20 bed
    expect(wireDistance(polar(wireAngle(3) + 1, 130))).toBeCloseTo(Math.sin(Math.PI / 180) * 130);
  });

  it("clampToView keeps a point inside the drawn square", () => {
    expect(clampToView({ x: 900, y: -900 })).toEqual({ x: 232, y: -232 });
    expect(clampToView({ x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
  });
});
