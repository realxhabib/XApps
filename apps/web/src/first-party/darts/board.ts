/**
 * Regulation dartboard geometry and hit-testing (pure, unit-tested).
 *
 * Board coordinates are millimetres from the centre of the bull, x to the
 * right and y DOWN (screen space), so the 20 sits at negative y. Radii follow
 * the WDF/BDO specification.
 *
 * Wires: a point exactly on a ring wire belongs to the ring inside it, and a
 * point exactly on a radial wire belongs to the segment clockwise of it.
 */

export interface Point {
  x: number;
  y: number;
}

/** Numbers clockwise from the top. */
export const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const;

export const RADIUS = {
  /** Inner bull (50). */
  bull: 6.35,
  /** Outer bull (25). */
  outerBull: 15.9,
  trebleInner: 99,
  trebleOuter: 107,
  doubleInner: 162,
  /** Edge of the scoring area. */
  doubleOuter: 170,
  /** Centre line of the numbers ring. */
  numbers: 196,
  /** Edge of the board (the black numbers ring ends here). */
  edge: 225,
} as const;

/** Half the size of the square the board is drawn in (a bit of cabinet around the edge). */
export const VIEW = 240;

/** Each segment spans 18°. */
export const SEGMENT_DEG = 360 / ORDER.length;

export type Ring =
  | "bull"
  | "outer-bull"
  | "inner-single"
  | "treble"
  | "outer-single"
  | "double"
  /** On the board but outside the doubles (the numbers ring). */
  | "board"
  /** Missed the board entirely. */
  | "off";

export interface Hit {
  ring: Ring;
  /** 1–20, 25 for either bull, 0 for a miss. */
  number: number;
  /** 0 for a miss, 1 single, 2 double (and the inner bull), 3 treble. */
  multiplier: 0 | 1 | 2 | 3;
  score: number;
  /** "T20", "D16", "7", "BULL", "25", "MISS". */
  label: string;
}

/** Degrees clockwise from straight up, in [0, 360). */
export function angleOf(p: Point): number {
  const deg = (Math.atan2(p.x, -p.y) * 180) / Math.PI;
  return deg < 0 ? deg + 360 : deg === 360 ? 0 : deg;
}

export function radiusOf(p: Point): number {
  return Math.hypot(p.x, p.y);
}

/** Segment index (into ORDER) at an angle; boundaries belong to the clockwise segment. */
export function segmentIndexAt(deg: number): number {
  const shifted = (((deg + SEGMENT_DEG / 2) % 360) + 360) % 360;
  // Guard against 17.999999 → 18 style float drift at the wires.
  return Math.floor(shifted / SEGMENT_DEG + 1e-9) % ORDER.length;
}

export function ringAt(r: number): Ring {
  if (r <= RADIUS.bull) return "bull";
  if (r <= RADIUS.outerBull) return "outer-bull";
  if (r <= RADIUS.trebleInner) return "inner-single";
  if (r <= RADIUS.trebleOuter) return "treble";
  if (r <= RADIUS.doubleInner) return "outer-single";
  if (r <= RADIUS.doubleOuter) return "double";
  if (r <= RADIUS.edge) return "board";
  return "off";
}

const MULTIPLIER: Record<Ring, 0 | 1 | 2 | 3> = {
  bull: 2,
  "outer-bull": 1,
  "inner-single": 1,
  treble: 3,
  "outer-single": 1,
  double: 2,
  board: 0,
  off: 0,
};

export function makeHit(ring: Ring, number: number): Hit {
  const multiplier = MULTIPLIER[ring];
  if (multiplier === 0) return { ring, number: 0, multiplier: 0, score: 0, label: "MISS" };
  if (ring === "bull") return { ring, number: 25, multiplier: 2, score: 50, label: "BULL" };
  if (ring === "outer-bull") return { ring, number: 25, multiplier: 1, score: 25, label: "25" };
  const prefix = multiplier === 3 ? "T" : multiplier === 2 ? "D" : "";
  return { ring, number, multiplier, score: number * multiplier, label: `${prefix}${number}` };
}

/** What a dart landing at `p` scores. */
export function hitTest(p: Point): Hit {
  const ring = ringAt(radiusOf(p));
  const number = ring === "bull" || ring === "outer-bull" ? 25 : ORDER[segmentIndexAt(angleOf(p))]!;
  return makeHit(ring, number);
}

/** Middle of a ring band (for aiming and tests). */
export function ringCentreRadius(ring: Ring): number {
  switch (ring) {
    case "bull":
      return 0;
    case "outer-bull":
      return (RADIUS.bull + RADIUS.outerBull) / 2;
    case "inner-single":
      return (RADIUS.outerBull + RADIUS.trebleInner) / 2;
    case "treble":
      return (RADIUS.trebleInner + RADIUS.trebleOuter) / 2;
    case "outer-single":
      return (RADIUS.trebleOuter + RADIUS.doubleInner) / 2;
    case "double":
      return (RADIUS.doubleInner + RADIUS.doubleOuter) / 2;
    case "board":
      return (RADIUS.doubleOuter + RADIUS.edge) / 2;
    case "off":
      return RADIUS.edge + 20;
  }
}

/** A point at `radius` mm on the centre line of the segment for `number` (1–20). */
export function pointOn(number: number, radius: number, offsetDeg = 0): Point {
  const index = ORDER.indexOf(number as (typeof ORDER)[number]);
  if (index < 0) throw new Error(`No segment ${number}`);
  const rad = ((index * SEGMENT_DEG + offsetDeg) * Math.PI) / 180;
  return { x: Math.sin(rad) * radius, y: -Math.cos(rad) * radius };
}

/** The centre of a bed: `target(20, "treble")` is the middle of the T20. */
export function target(number: number, ring: Ring): Point {
  if (ring === "bull") return { x: 0, y: 0 };
  if (number === 25) return { x: 0, y: -ringCentreRadius("outer-bull") };
  return pointOn(number, ringCentreRadius(ring));
}

/** Angle (degrees clockwise from up) of the radial wire on the anticlockwise side of a segment. */
export function wireAngle(index: number): number {
  return (((index * SEGMENT_DEG - SEGMENT_DEG / 2) % 360) + 360) % 360;
}

/** Distance (mm) from a point to the nearest wire of the spider (rings and radial wires). */
export function wireDistance(p: Point): number {
  const r = radiusOf(p);
  const rings = [RADIUS.bull, RADIUS.outerBull, RADIUS.trebleInner, RADIUS.trebleOuter, RADIUS.doubleInner, RADIUS.doubleOuter];
  let best = Math.min(...rings.map((w) => Math.abs(r - w)));
  if (r >= RADIUS.outerBull && r <= RADIUS.doubleOuter) {
    const deg = angleOf(p);
    const rel = (((deg + SEGMENT_DEG / 2) % SEGMENT_DEG) + SEGMENT_DEG) % SEGMENT_DEG;
    const off = (Math.min(rel, SEGMENT_DEG - rel) * Math.PI) / 180;
    best = Math.min(best, Math.sin(off) * r);
  }
  return best;
}

/** Clamps a point into the drawn square (for rendering darts that missed the board). */
export function clampToView(p: Point, margin = 8): Point {
  const limit = VIEW - margin;
  return { x: Math.max(-limit, Math.min(limit, p.x)), y: Math.max(-limit, Math.min(limit, p.y)) };
}
