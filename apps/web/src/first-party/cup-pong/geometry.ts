/**
 * Cup Pong — the physical table, cups and ball (metres), the rack
 * formations, and the mapping between a thrower's frame and the world.
 * Pure: no three.js, no React.
 *
 * Frames
 * - **Thrower frame** (physics, trajectories): the thrower stands behind
 *   z = 0 looking down +z; the target rack sits at the far end (z ≈ TABLE_L).
 *   x is to the thrower's right, y is up, the table top is y = 0.
 * - **World** (rendering, three.js right-handed): seat 0 throws from the
 *   z = 0 end looking down +z, where the thrower's right is world −x; seat 1
 *   throws from the z = TABLE_L end. So `toWorld(seat, p)` is
 *   (x, z) → (−x, z) for seat 0 and (x, TABLE_L − z) for seat 1.
 * - **Rack coordinates** (the shared state): a cup is `(u, v)` with `v` its
 *   distance from its own table end (inwards) and `u` its lateral offset as
 *   the *shooter* sees it. In the shooter's frame that cup stands at
 *   (x = u, z = TABLE_L − v).
 */

/* ---------------------------------------------------------------------- */
/* Dimensions                                                             */
/* ---------------------------------------------------------------------- */

export const TABLE_L = 2.44;
export const TABLE_W = 0.61;
export const TABLE_THICK = 0.035;

export const BALL_R = 0.02;
/** A ball on fire looks bigger… */
export const FIRE_BALL_R = 0.026;
/** …but collides like a smaller one, so it finds the cup more easily. */
export const FIRE_HIT_R = 0.0125;

export const CUP_H = 0.12;
export const CUP_TOP_R = 0.047;
export const CUP_BOTTOM_R = 0.031;
/** Radius of the rolled rim's tube. */
export const RIM_TUBE = 0.004;
/** Where the drink sits inside a cup (height of its surface). */
export const LIQUID_Y = 0.074;

/** Centre-to-centre spacing of touching cups. */
export const CUP_GAP = CUP_TOP_R * 2 + 0.003;
/** Row spacing of a triangle rack (touching cups). */
export const ROW_STEP = (CUP_GAP * Math.sqrt(3)) / 2;
/** Distance of the back row's centres from the table end. */
export const RACK_BACK = CUP_TOP_R + 0.02;

/** Radius of a cup's wall at height `y` (0 at the bottom, CUP_H at the rim). */
export function cupRadiusAt(y: number): number {
  const t = Math.max(0, Math.min(1, y / CUP_H));
  return CUP_BOTTOM_R + (CUP_TOP_R - CUP_BOTTOM_R) * t;
}

/* ---------------------------------------------------------------------- */
/* Racks & formations                                                     */
/* ---------------------------------------------------------------------- */

export type Seat = 0 | 1;
export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** One cup of a rack: a stable id (0–9, from the opening rack) and its rack coordinates. */
export interface Cup {
  id: number;
  u: number;
  v: number;
}

export type Formation = "full" | "triangle" | "zipper" | "diamond" | "square" | "line" | "pair";

/** 4-3-2-1, apex towards the shooter: `[u in cup gaps, row]`. */
const FULL: readonly (readonly [number, number])[] = [
  [-1.5, 0], [-0.5, 0], [0.5, 0], [1.5, 0],
  [-1, 1], [0, 1], [1, 1],
  [-0.5, 2], [0.5, 2],
  [0, 3],
];

/** Which formations a re-rack may pick, by how many cups are left. */
export const RERACK_OPTIONS: Readonly<Record<number, readonly Formation[]>> = {
  6: ["triangle", "zipper"],
  4: ["diamond", "square", "line"],
  3: ["triangle", "line"],
  2: ["line", "pair"],
};

export const RERACK_COUNTS = Object.keys(RERACK_OPTIONS).map(Number);

export const FORMATION_LABEL: Record<Formation, string> = {
  full: "Full rack",
  triangle: "Triangle",
  zipper: "Zipper",
  diamond: "Diamond",
  square: "Square",
  line: "Line",
  pair: "Side by side",
};

/**
 * Slot positions `(u, v)` in metres for `count` cups in `formation`, back row
 * first (v ascending, then u ascending). `null` if that combination doesn't exist.
 */
export function formationSlots(formation: Formation, count: number): { u: number; v: number }[] | null {
  let units: (readonly [number, number])[];
  let packed = true;
  switch (formation) {
    case "full":
      if (count !== 10) return null;
      units = [...FULL];
      break;
    case "triangle": {
      // 3-2-1 or 2-1.
      const rows = count === 6 ? 3 : count === 3 ? 2 : 0;
      if (!rows) return null;
      units = [];
      for (let r = 0; r < rows; r++) {
        const n = rows - r;
        for (let i = 0; i < n; i++) units.push([i - (n - 1) / 2, r]);
      }
      break;
    }
    case "zipper":
      // Two staggered columns marching up the table.
      if (count !== 6) return null;
      units = Array.from({ length: 6 }, (_, i) => [i % 2 === 0 ? -0.5 : 0.5, i] as const);
      break;
    case "diamond":
      if (count !== 4) return null;
      units = [[0, 0], [-0.5, 1], [0.5, 1], [0, 2]];
      break;
    case "square":
      if (count !== 4) return null;
      packed = false;
      units = [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]];
      break;
    case "line":
      if (count < 2 || count > 4) return null;
      packed = false;
      units = Array.from({ length: count }, (_, i) => [0, i] as const);
      break;
    case "pair":
      if (count !== 2) return null;
      units = [[-0.5, 0], [0.5, 0]];
      break;
    default:
      return null;
  }
  const step = packed ? ROW_STEP : CUP_GAP;
  return units.map(([u, r]) => ({ u: round4(u * CUP_GAP), v: round4(RACK_BACK + r * step) }));
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The opening 10-cup rack. */
export function openingRack(): Cup[] {
  return (formationSlots("full", 10) as { u: number; v: number }[]).map((slot, id) => ({ id, ...slot }));
}

/** Formations a re-rack of `count` cups may use (empty when a re-rack isn't allowed at that count). */
export function rerackOptions(count: number): readonly Formation[] {
  return RERACK_OPTIONS[count] ?? [];
}

/**
 * Moves the surviving cups into `formation`. Cups keep their ids: the one
 * furthest back goes to the back slot, and so on, so meshes glide into place.
 */
export function rerack(cups: readonly Cup[], formation: Formation): Cup[] | null {
  const slots = formationSlots(formation, cups.length);
  if (!slots) return null;
  const order = [...cups].sort((a, b) => a.v - b.v || a.u - b.u);
  return order.map((cup, i) => ({ id: cup.id, u: slots[i]!.u, v: slots[i]!.v }));
}

/** Front-most cup (closest to the shooter), ties to the centre. Used for automatic picks. */
export function frontCup(cups: readonly Cup[]): Cup | null {
  let best: Cup | null = null;
  for (const c of cups) {
    if (!best || c.v > best.v + 1e-6 || (Math.abs(c.v - best.v) < 1e-6 && Math.abs(c.u) < Math.abs(best.u))) best = c;
  }
  return best;
}

/* ---------------------------------------------------------------------- */
/* Frames                                                                 */
/* ---------------------------------------------------------------------- */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A target cup's centre (at the table) in the shooter's frame. */
export function cupInShooterFrame(cup: { u: number; v: number }): { x: number; z: number } {
  return { x: cup.u, z: TABLE_L - cup.v };
}

/** Thrower frame → world for the given throwing seat. */
export function toWorld(thrower: Seat, p: Vec3): Vec3 {
  return thrower === 0 ? { x: -p.x, y: p.y, z: p.z } : { x: p.x, y: p.y, z: TABLE_L - p.z };
}

/**
 * World position of a cup of the rack `defender` defends: that rack sits at
 * the defender's own end, and its `(u, v)` are as the other seat sees them.
 */
export function cupWorld(defender: Seat, cup: { u: number; v: number }): { x: number; z: number } {
  const shooter = other(defender);
  const p = toWorld(shooter, { x: cup.u, y: 0, z: TABLE_L - cup.v });
  return { x: p.x, z: p.z };
}
