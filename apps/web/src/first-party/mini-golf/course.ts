/**
 * Mini Golf: the course. Nine handcrafted holes as plain data, from a straight
 * opener to a jump over water. Everything is in course units (a fairway is
 * 4–6 units wide; the ball's radius is 0.14).
 *
 * Coordinates: x runs left → right, y runs from the tee (bottom of the screen)
 * toward the cup (top). Floors are unions of axis-aligned rectangles on a
 * half-unit grid; their outline becomes the walls automatically (compile.ts).
 */

export interface Vec {
  x: number;
  y: number;
}

/** [x0, y0, x1, y1] with x0 < x1 and y0 < y1, on the 0.5 grid. */
export type Rect = readonly [number, number, number, number];

export type Shape =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "ellipse"; x: number; y: number; rx: number; ry: number }
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number };

export type HeightFeature =
  /** Gaussian bump (negative `a` for a bowl): a·exp(−d²/2s²). */
  | { kind: "hill"; x: number; y: number; a: number; s: number }
  /** Smooth step of `a` across [from, to] along an axis, over the whole hole (tiers, banks, valleys). */
  | { kind: "tier"; axis: "x" | "y"; from: number; to: number; a: number }
  /** A wooden jump ramp: rises linearly from 0 to `a` along +y inside the rect, then drops away. */
  | { kind: "ramp"; x0: number; y0: number; x1: number; y1: number; a: number };

export type SurfaceType = "sand" | "water" | "boost";

export interface Surface {
  type: SurfaceType;
  shape: Shape;
  /** Boost pads push along this unit direction. */
  dir?: Vec;
}

/** A solid raised block (convex polygon, counter-clockwise), e.g. a chamfered corner. */
export interface Block {
  points: readonly (readonly [number, number])[];
}

export interface Bumper {
  x: number;
  y: number;
  r: number;
}

/** Arms rotating around a hub, flat on the green (a turnstile). */
export interface Spinner {
  x: number;
  y: number;
  arms: number;
  length: number;
  /** Radians per second (negative spins clockwise). */
  speed: number;
  phase: number;
}

/** A block that glides back and forth between two centers. */
export interface Slider {
  from: Vec;
  to: Vec;
  /** Half extents of the block. */
  hw: number;
  hh: number;
  /** Seconds for a full there-and-back. */
  period: number;
  phase: number;
}

/**
 * The classic: a mill house spanning the fairway with a tunnel through it.
 * Its sails turn in front of the tunnel mouth and block it when one points down.
 */
export interface Windmill {
  x: number;
  /** Front (tee side) and back faces of the house. */
  y0: number;
  y1: number;
  /** House width (spans the fairway) and tunnel width. */
  width: number;
  tunnel: number;
  sails: number;
  speed: number;
  phase: number;
}

/** A teleport tube: roll into the mouth, pop out of the exit. */
export interface Tube {
  from: Vec;
  to: Vec;
  /** Exit direction (unit). */
  dir: Vec;
}

export interface Hole {
  number: number;
  name: string;
  par: number;
  /** One line under the name in the hole intro. */
  blurb: string;
  floor: readonly Rect[];
  tee: Vec;
  cup: Vec;
  heights?: readonly HeightFeature[];
  surfaces?: readonly Surface[];
  blocks?: readonly Block[];
  bumpers?: readonly Bumper[];
  spinners?: readonly Spinner[];
  sliders?: readonly Slider[];
  windmill?: Windmill;
  tubes?: readonly Tube[];
  /** Flyover waypoints from the cup back to the tee (camera targets). */
  flyover: readonly Vec[];
  /** Palette accent for bumpers, trim and flags. */
  accent: string;
}

/** Triangle chamfer in a corner: `corner` is the square corner, `size` the leg length, `sx`/`sy` point into the floor. */
function chamfer(cx: number, cy: number, size: number, sx: 1 | -1, sy: 1 | -1): Block {
  const pts: [number, number][] = [
    [cx, cy],
    [cx + sx * size, cy],
    [cx, cy + sy * size],
  ];
  // Keep every block counter-clockwise.
  return { points: sx * sy > 0 ? pts : [pts[0]!, pts[2]!, pts[1]!] };
}

export const HOLES: readonly Hole[] = [
  {
    number: 1,
    name: "Opening Putt",
    par: 2,
    blurb: "Nice and straight. Mind the hump.",
    floor: [[0, 0, 4, 14]],
    tee: { x: 2, y: 1.6 },
    cup: { x: 2, y: 12 },
    heights: [{ kind: "hill", x: 2, y: 7, a: 0.12, s: 0.9 }],
    blocks: [chamfer(0, 14, 1.2, 1, -1), chamfer(4, 14, 1.2, -1, -1), chamfer(0, 0, 0.8, 1, 1), chamfer(4, 0, 0.8, -1, 1)],
    flyover: [
      { x: 2, y: 12 },
      { x: 2, y: 7 },
      { x: 2, y: 1.6 },
    ],
    accent: "#ff5a5f",
  },
  {
    number: 2,
    name: "Dogleg",
    par: 2,
    blurb: "Bank it off the corner and let it run.",
    floor: [
      [0, 0, 4, 14],
      [4, 10, 10, 14],
    ],
    tee: { x: 2, y: 1.6 },
    cup: { x: 8.4, y: 12 },
    heights: [{ kind: "tier", axis: "x", from: 4.5, to: 9, a: -0.14 }],
    blocks: [chamfer(0, 14, 2.5, 1, -1), chamfer(10, 14, 1, -1, -1), chamfer(10, 10, 1, -1, 1), chamfer(0, 0, 0.8, 1, 1), chamfer(4, 0, 0.8, -1, 1)],
    bumpers: [{ x: 4, y: 10, r: 0.22 }],
    flyover: [
      { x: 8.4, y: 12 },
      { x: 2, y: 12 },
      { x: 2, y: 1.6 },
    ],
    accent: "#ffb020",
  },
  {
    number: 3,
    name: "Bumper Alley",
    par: 3,
    blurb: "Pinball rules. Stay out of the sand.",
    floor: [[0, 0, 5, 16]],
    tee: { x: 2.5, y: 1.5 },
    cup: { x: 2.5, y: 14.2 },
    bumpers: [
      { x: 1.4, y: 6, r: 0.32 },
      { x: 3.6, y: 6, r: 0.32 },
      { x: 2.5, y: 8.4, r: 0.36 },
      { x: 1.2, y: 10.8, r: 0.3 },
      { x: 3.8, y: 10.8, r: 0.3 },
    ],
    surfaces: [
      { type: "sand", shape: { kind: "ellipse", x: 3.85, y: 13.2, rx: 0.8, ry: 0.55 } },
      { type: "sand", shape: { kind: "circle", x: 0.9, y: 13.9, r: 0.55 } },
    ],
    blocks: [chamfer(0, 16, 1, 1, -1), chamfer(5, 16, 1, -1, -1), chamfer(0, 0, 0.8, 1, 1), chamfer(5, 0, 0.8, -1, 1)],
    flyover: [
      { x: 2.5, y: 14.2 },
      { x: 2.5, y: 8.4 },
      { x: 2.5, y: 1.5 },
    ],
    accent: "#ff3fa4",
  },
  {
    number: 4,
    name: "The Windmill",
    par: 3,
    blurb: "Time it through the sails.",
    floor: [[0, 0, 5, 17]],
    tee: { x: 2.5, y: 1.5 },
    cup: { x: 1.3, y: 15 },
    heights: [
      { kind: "tier", axis: "x", from: 0, to: 2.5, a: -0.15 },
      { kind: "tier", axis: "x", from: 2.5, to: 5, a: 0.15 },
      { kind: "hill", x: 2.5, y: 13.1, a: 0.16, s: 0.55 },
      { kind: "hill", x: 3.4, y: 16.2, a: 0.2, s: 0.8 },
    ],
    windmill: { x: 2.5, y0: 8, y1: 10, width: 5, tunnel: 1.1, sails: 4, speed: 1.25, phase: 0.35 },
    blocks: [chamfer(0, 17, 1, 1, -1), chamfer(5, 17, 1, -1, -1)],
    flyover: [
      { x: 1.3, y: 15 },
      { x: 2.5, y: 9 },
      { x: 2.5, y: 1.5 },
    ],
    accent: "#e8412c",
  },
  {
    number: 5,
    name: "Lily Pond",
    par: 3,
    blurb: "Hug the bank or go for the carry. Water costs a stroke.",
    floor: [[0, 0, 6, 17]],
    tee: { x: 1.6, y: 1.6 },
    cup: { x: 4.4, y: 15 },
    heights: [{ kind: "tier", axis: "y", from: 11, to: 12.5, a: 0.22 }],
    surfaces: [
      { type: "water", shape: { kind: "ellipse", x: 3.9, y: 8.2, rx: 2.4, ry: 1.5 } },
      { type: "sand", shape: { kind: "circle", x: 1.3, y: 14, r: 0.75 } },
    ],
    blocks: [chamfer(0, 17, 1.2, 1, -1), chamfer(6, 17, 1.2, -1, -1), chamfer(6, 0, 1, -1, 1)],
    flyover: [
      { x: 4.4, y: 15 },
      { x: 1, y: 8 },
      { x: 1.6, y: 1.6 },
    ],
    accent: "#28c7a0",
  },
  {
    number: 6,
    name: "Tube Station",
    par: 3,
    blurb: "Two tubes. One of them is a shortcut.",
    floor: [
      [0, 0, 6, 6.5],
      [0, 9, 6, 16],
    ],
    tee: { x: 3, y: 1.3 },
    cup: { x: 3.8, y: 14.2 },
    heights: [{ kind: "hill", x: 3.8, y: 14.2, a: -0.1, s: 1.1 }],
    spinners: [{ x: 1.9, y: 3.9, arms: 3, length: 1.2, speed: 1.5, phase: 0 }],
    tubes: [
      { from: { x: 1.1, y: 5.5 }, to: { x: 0.9, y: 14.8 }, dir: { x: 1, y: 0 } },
      { from: { x: 4.9, y: 5.5 }, to: { x: 5.2, y: 9.9 }, dir: { x: -0.6, y: 0.8 } },
    ],
    blocks: [chamfer(6, 16, 1.2, -1, -1), chamfer(0, 9, 0.8, 1, 1), chamfer(0, 0, 0.8, 1, 1), chamfer(6, 0, 0.8, -1, 1)],
    flyover: [
      { x: 3.8, y: 14.2 },
      { x: 3, y: 7.8 },
      { x: 3, y: 1.3 },
    ],
    accent: "#7c5cff",
  },
  {
    number: 7,
    name: "Switchback",
    par: 4,
    blurb: "Up the hill, past the gate, round the bunker.",
    floor: [
      [0, 0, 10, 4],
      [6, 4, 10, 9],
      [0, 9, 10, 13],
      [0, 13, 4, 18],
    ],
    tee: { x: 1.5, y: 2 },
    cup: { x: 2, y: 16.4 },
    heights: [{ kind: "tier", axis: "y", from: 4.5, to: 8.5, a: 0.35 }],
    sliders: [{ from: { x: 5, y: 10.15 }, to: { x: 5, y: 11.85 }, hw: 0.22, hh: 0.75, period: 3.4, phase: 0 }],
    surfaces: [{ type: "sand", shape: { kind: "circle", x: 3.1, y: 12.1, r: 0.65 } }],
    blocks: [
      chamfer(10, 0, 1.5, -1, 1),
      chamfer(10, 13, 1.5, -1, -1),
      chamfer(0, 9, 1.2, 1, 1),
      chamfer(0, 18, 1, 1, -1),
      chamfer(4, 18, 1, -1, -1),
    ],
    bumpers: [{ x: 6, y: 9, r: 0.25 }],
    flyover: [
      { x: 2, y: 16.4 },
      { x: 5, y: 11 },
      { x: 8, y: 6.5 },
      { x: 4, y: 2 },
    ],
    accent: "#3fa9ff",
  },
  {
    number: 8,
    name: "Volcano",
    par: 3,
    blurb: "Too soft rolls back. Too hard flies off the top.",
    floor: [[0, 0, 6, 15]],
    tee: { x: 3, y: 1.5 },
    cup: { x: 3, y: 10.6 },
    heights: [
      { kind: "hill", x: 3, y: 10.6, a: 0.5, s: 1.45 },
      { kind: "hill", x: 3, y: 10.6, a: -0.13, s: 0.42 },
    ],
    surfaces: [
      { type: "sand", shape: { kind: "circle", x: 1.1, y: 8.2, r: 0.7 } },
      { type: "sand", shape: { kind: "circle", x: 4.9, y: 8.2, r: 0.7 } },
      { type: "sand", shape: { kind: "ellipse", x: 3, y: 14.1, rx: 1.4, ry: 0.5 } },
    ],
    bumpers: [
      { x: 1.6, y: 5, r: 0.3 },
      { x: 4.4, y: 5, r: 0.3 },
    ],
    blocks: [chamfer(0, 15, 1.2, 1, -1), chamfer(6, 15, 1.2, -1, -1), chamfer(0, 0, 0.8, 1, 1), chamfer(6, 0, 0.8, -1, 1)],
    flyover: [
      { x: 3, y: 10.6 },
      { x: 3, y: 6 },
      { x: 3, y: 1.5 },
    ],
    accent: "#ff7a1a",
  },
  {
    number: 9,
    name: "Big Air",
    par: 3,
    blurb: "Hit the ramp hard, clear the water, stick the landing.",
    floor: [[0, 0, 4, 20]],
    tee: { x: 2, y: 1.5 },
    cup: { x: 2.9, y: 17.2 },
    heights: [
      { kind: "ramp", x0: 0, y0: 6, x1: 4, y1: 8.5, a: 0.6 },
      { kind: "hill", x: 1.2, y: 18.9, a: 0.3, s: 0.8 },
    ],
    surfaces: [
      { type: "water", shape: { kind: "rect", x0: 0, y0: 8.5, x1: 4, y1: 10.5 } },
      { type: "boost", shape: { kind: "rect", x0: 1.2, y0: 3.4, x1: 2.8, y1: 4.6 }, dir: { x: 0, y: 1 } },
    ],
    spinners: [{ x: 2, y: 15.1, arms: 2, length: 0.95, speed: 1.1, phase: 0.6 }],
    bumpers: [{ x: 0.8, y: 16.6, r: 0.28 }],
    blocks: [chamfer(0, 20, 1, 1, -1), chamfer(4, 20, 1, -1, -1)],
    flyover: [
      { x: 2.9, y: 17.2 },
      { x: 2, y: 9.5 },
      { x: 2, y: 1.5 },
    ],
    accent: "#ffd23d",
  },
];

export const TOTAL_PAR = HOLES.reduce((sum, h) => sum + h.par, 0);
