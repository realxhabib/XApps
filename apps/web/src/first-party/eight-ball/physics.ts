/**
 * 8-Ball Pool — table geometry and ball physics. Pure: no React, no SDK, no DOM.
 *
 * Units are metres, seconds and radians on a 7-ft-style bar table seen from
 * above: `x` runs 0 → TABLE_L along the length (the head string and the
 * kitchen are at the low end), `y` runs 0 → TABLE_W across, and `z` points up
 * out of the cloth (right-handed). Ball 0 is the cue ball, 1–7 solids, 8 the
 * eight ball, 9–15 stripes.
 *
 * The simulation is a fixed-timestep (1 kHz) integrator with:
 * - sliding vs rolling cloth friction on a full 3D spin vector, so follow,
 *   draw and stun come out of the physics rather than special cases;
 * - side spin (english) that grips the cushions and bends the rebound;
 * - equal-mass ball–ball impulses with slight energy loss;
 * - cushions and pocket jaws as line segments (their ends act as knuckles);
 * - pockets that capture a ball once its centre crosses into the hole.
 *
 * Floating point may differ slightly between devices, so the shooter's
 * result is authoritative: `simulate` also records a compact trajectory
 * (`Recording`) that other clients replay verbatim.
 */

export const TABLE_L = 2.24;
export const TABLE_W = 1.12;
export const R = 0.028575;
export const BALLS = 16;
/** The head string: the cue ball starts (and is placed after a break scratch) at x ≤ HEAD_X. */
export const HEAD_X = TABLE_L / 4;
export const FOOT_SPOT = { x: TABLE_L * 0.75, y: TABLE_W / 2 } as const;
export const HEAD_SPOT = { x: HEAD_X, y: TABLE_W / 2 } as const;

/** Fastest cue ball the power control can produce (m/s). */
export const MAX_SPEED = 7.6;
const MIN_SPEED = 0.18;

const G = 9.81;
const MU_SLIDE = 0.2;
const MU_ROLL = 0.014;
/** Extra rolling drag proportional to speed (1/s): stops the long tail of slow rolls sooner. */
const ROLL_DRAG = 0.16;
/** Side-spin decay (rad/s²). */
const SPIN_DECAY = 7;
const E_BALL = 0.96;
const MU_CUSHION = 0.2;
const STOP_SPEED = 0.005;

export const DT = 0.001;
/** Hard cap on a shot's length (s). */
export const MAX_SHOT_TIME = 30;

export interface Vec {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------------ */
/* Geometry: cushions, jaws and pockets                                     */
/* ------------------------------------------------------------------------ */

/** Distance from a corner to where the cushion nose ends, along each rail. */
const CORNER_JAW = 0.092;
/** Half the side pocket's mouth. */
const SIDE_HALF = 0.07;

export interface Segment {
  a: Vec;
  b: Vec;
  kind: "rail" | "jaw";
}

export interface Pocket {
  id: number;
  /** Centre of the hole (capture circle). */
  x: number;
  y: number;
  /** Capture radius: a ball whose centre gets this close drops. */
  r: number;
  /** Where to aim an object ball (just inside the mouth). */
  aim: Vec;
  /** Unit vector from the pocket out onto the table. */
  facing: Vec;
  side: boolean;
}

const v = (x: number, y: number): Vec => ({ x, y });

function buildPockets(): Pocket[] {
  const L = TABLE_L;
  const W = TABLE_W;
  const s2 = Math.SQRT1_2;
  const corner = (id: number, cx: number, cy: number, fx: number, fy: number): Pocket => ({
    id,
    x: cx - fx * 0.017,
    y: cy - fy * 0.017,
    r: 0.066,
    aim: v(cx + fx * 0.03, cy + fy * 0.03),
    facing: v(fx * s2, fy * s2),
    side: false,
  });
  const side = (id: number, cx: number, cy: number, fy: number): Pocket => ({
    id,
    x: cx,
    y: cy - fy * 0.034,
    r: 0.06,
    aim: v(cx, cy + fy * 0.004),
    facing: v(0, fy),
    side: true,
  });
  // Clockwise from the bottom-left corner (the head end is x = 0).
  return [
    corner(0, 0, 0, 1, 1),
    side(1, L / 2, 0, 1),
    corner(2, L, 0, -1, 1),
    corner(3, L, W, -1, -1),
    side(4, L / 2, W, -1),
    corner(5, 0, W, 1, -1),
  ];
}

export const POCKETS: readonly Pocket[] = buildPockets();

function buildSegments(): Segment[] {
  const L = TABLE_L;
  const W = TABLE_W;
  const c = CORNER_JAW;
  const out: Segment[] = [];
  const rail = (ax: number, ay: number, bx: number, by: number) => out.push({ a: v(ax, ay), b: v(bx, by), kind: "rail" });
  const jaw = (ax: number, ay: number, dx: number, dy: number, len: number) =>
    out.push({ a: v(ax, ay), b: v(ax + dx * len, ay + dy * len), kind: "jaw" });

  // Cushion noses.
  rail(c, 0, L / 2 - SIDE_HALF, 0);
  rail(L / 2 + SIDE_HALF, 0, L - c, 0);
  rail(c, W, L / 2 - SIDE_HALF, W);
  rail(L / 2 + SIDE_HALF, W, L - c, W);
  rail(0, c, 0, W - c);
  rail(L, c, L, W - c);

  // Corner jaws converge slightly towards the hole (38° off the rail line).
  const ca = Math.cos((38 * Math.PI) / 180);
  const sa = Math.sin((38 * Math.PI) / 180);
  const len = 0.075;
  jaw(c, 0, -ca, -sa, len);
  jaw(0, c, -sa, -ca, len);
  jaw(L - c, 0, ca, -sa, len);
  jaw(L, c, sa, -ca, len);
  jaw(L - c, W, ca, sa, len);
  jaw(L, W - c, sa, ca, len);
  jaw(c, W, -ca, sa, len);
  jaw(0, W - c, -sa, ca, len);

  // Side jaws: nearly straight back, narrowing a touch.
  const ts = Math.sin((12 * Math.PI) / 180);
  const tc = Math.cos((12 * Math.PI) / 180);
  const slen = 0.055;
  jaw(L / 2 - SIDE_HALF, 0, ts, -tc, slen);
  jaw(L / 2 + SIDE_HALF, 0, -ts, -tc, slen);
  jaw(L / 2 - SIDE_HALF, W, ts, tc, slen);
  jaw(L / 2 + SIDE_HALF, W, -ts, tc, slen);
  return out;
}

export const SEGMENTS: readonly Segment[] = buildSegments();

/** Is `p` a legal resting spot for a ball (on the cloth, not in a pocket mouth)? */
export function onCloth(p: Vec, margin = R): boolean {
  return p.x >= margin && p.x <= TABLE_L - margin && p.y >= margin && p.y <= TABLE_W - margin;
}

/* ------------------------------------------------------------------------ */
/* Racking                                                                  */
/* ------------------------------------------------------------------------ */

/** Table positions: index = ball number, `null` = pocketed. */
export type Balls = (Vec | null)[];

/**
 * A standard rack with the apex on the foot spot: the 8 in the middle of the
 * third row, a solid and a stripe in the back corners, the rest shuffled by
 * `random` (seeded per match so both players rack the same). Balls sit a hair
 * apart so the break spreads cleanly.
 */
export function rackBalls(random: () => number = Math.random): Balls {
  const gap = 0.0002;
  const d = 2 * R + gap;
  const rowDx = d * Math.sin(Math.PI / 3);
  const slots: Vec[] = [];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      slots.push({ x: FOOT_SPOT.x + row * rowDx, y: FOOT_SPOT.y + (k - row / 2) * d });
    }
  }
  // Slot 4 = middle of row 3; slots 10 and 14 = back corners.
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7], random);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], random);
  const cornerSolidLeft = random() < 0.5;
  const order = new Array<number>(15).fill(0);
  order[4] = 8;
  order[10] = cornerSolidLeft ? (solids.pop() as number) : (stripes.pop() as number);
  order[14] = cornerSolidLeft ? (stripes.pop() as number) : (solids.pop() as number);
  const rest = shuffle([...solids, ...stripes], random);
  for (let i = 0; i < 15; i++) if (order[i] === 0) order[i] = rest.pop() as number;

  const balls: Balls = new Array(BALLS).fill(null);
  balls[0] = { x: HEAD_X * 0.55, y: TABLE_W / 2 };
  order.forEach((id, i) => {
    const s = slots[i] as Vec;
    // A few microns of jitter so no two breaks are identical.
    balls[id] = { x: s.x + (random() - 0.5) * 0.0001, y: s.y + (random() - 0.5) * 0.0001 };
  });
  return balls;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Nearest free spot to `want` along the long string towards the foot rail (for re-spotting the 8). */
export function spotBall(balls: Balls, want: Vec = FOOT_SPOT, ignore = -1): Vec {
  for (let step = 0; step < 400; step++) {
    const dx = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.004;
    const p = { x: Math.min(TABLE_L - R, Math.max(R, want.x + dx)), y: want.y };
    if (isFreeSpot(balls, p, ignore)) return p;
  }
  return { ...want };
}

/** No other ball within two radii (and on the cloth). */
export function isFreeSpot(balls: Balls, p: Vec, ignore = -1): boolean {
  if (!onCloth(p)) return false;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (!b || i === ignore) continue;
    if ((b.x - p.x) ** 2 + (b.y - p.y) ** 2 < (2 * R + 0.0005) ** 2) return false;
  }
  return true;
}

/* ------------------------------------------------------------------------ */
/* The strike                                                               */
/* ------------------------------------------------------------------------ */

export interface Strike {
  /** Aim direction in table space (radians, 0 = +x). */
  angle: number;
  /** 0..1 from the power control. */
  power: number;
  /** Tip offset: `x` side english (−1 left … 1 right), `y` vertical (−1 draw … 1 follow). */
  spin: Vec;
}

export const speedOf = (power: number): number => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(Math.min(1, Math.max(0, power)), 1.35);

/** Clamps a spin offset into the unit disc (where the tip can legally strike). */
export function clampSpin(spin: Vec): Vec {
  const m = Math.hypot(spin.x, spin.y);
  return m > 1 ? { x: spin.x / m, y: spin.y / m } : { x: spin.x, y: spin.y };
}

/** Spin (ωR/v) the tip gives per unit of offset. 1.25 ≈ a touch over natural roll at full follow. */
const SPIN_GAIN = 1.25;

/* ------------------------------------------------------------------------ */
/* Recording                                                                */
/* ------------------------------------------------------------------------ */

/** Event kinds in a recording: ball–ball click, cushion thud, pocket drop, cue strike. */
export type EventKind = "b" | "c" | "p" | "s";

/**
 * A shot as other clients replay it. `tracks[i]` is a flat list of
 * `[ms, x mm, y mm, …]` keyframes for ball `i` (linear between them; the
 * last keyframe is where it stopped or dropped). `events` are
 * `[ms, kind, ball, speed ×100 or pocket id]`.
 */
export interface Recording {
  ms: number;
  tracks: number[][];
  events: [number, EventKind, number, number][];
}

export interface PocketedBall {
  id: number;
  pocket: number;
  ms: number;
}

export interface SimResult {
  final: Balls;
  pocketed: PocketedBall[];
  /** First object ball the cue ball touched. */
  firstHit: number | null;
  /** Some ball hit a cushion after the first contact. */
  railAfterContact: boolean;
  /** Distinct object balls that touched a cushion (break legality). */
  railBalls: number;
  /** Object balls that touched a cushion before dropping (banks, kicks off the rail). */
  banked: number[];
  /** Cushions the cue ball touched before its first contact (kick shots). */
  cueRailsBeforeHit: number;
  ms: number;
  rec: Recording;
}

/* ------------------------------------------------------------------------ */
/* Simulation                                                               */
/* ------------------------------------------------------------------------ */

const KEY_MIN_MS = 70;
const KEY_MAX_MS = 400;
const KEY_TURN_COS = Math.cos((2.5 * Math.PI) / 180);
const MAX_EVENTS = 160;

const mm = (m: number) => Math.round(m * 1000);

/**
 * Plays one shot from `balls` (the cue ball must be on the table) until
 * everything stops. Never mutates `balls`.
 */
export interface SimProbe {
  (ms: number, state: { x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array; on: Uint8Array }): void;
}

export function simulate(
  balls: Balls,
  strike: Strike,
  options: { maxTime?: number; record?: boolean; probe?: SimProbe } = {},
): SimResult {
  const record = options.record ?? true;
  const maxSteps = Math.round((options.maxTime ?? MAX_SHOT_TIME) / DT);
  const n = BALLS;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  const wz = new Float64Array(n);
  const on = new Uint8Array(n);
  const moving = new Uint8Array(n);
  const rails = new Uint16Array(n);

  for (let i = 0; i < n; i++) {
    const b = balls[i];
    if (!b) continue;
    on[i] = 1;
    x[i] = b.x;
    y[i] = b.y;
  }
  if (!on[0]) throw new Error("simulate: the cue ball is not on the table");

  // The strike.
  const speed = speedOf(strike.power);
  const spin = clampSpin(strike.spin);
  const dx = Math.cos(strike.angle);
  const dy = Math.sin(strike.angle);
  vx[0] = dx * speed;
  vy[0] = dy * speed;
  // Follow/draw: spin about ẑ × d (the rolling axis), ωR/v = SPIN_GAIN · offset.
  const roll = (SPIN_GAIN * spin.y * speed) / R;
  wx[0] = -dy * roll;
  wy[0] = dx * roll;
  // Right english (x > 0) spins the ball clockwise seen from above (ωz < 0).
  wz[0] = (-SPIN_GAIN * spin.x * speed) / R;
  moving[0] = 1;

  const tracks: number[][] = [];
  const lastKey: { t: number; vx: number; vy: number; sp: number }[] = [];
  for (let i = 0; i < n; i++) {
    tracks.push(on[i] ? [0, mm(x[i] as number), mm(y[i] as number)] : []);
    lastKey.push({ t: 0, vx: 0, vy: 0, sp: 0 });
  }
  const events: [number, EventKind, number, number][] = [];
  const pushEvent = (t: number, kind: EventKind, a: number, b: number) => {
    if (record && events.length < MAX_EVENTS) events.push([t, kind, a, b]);
  };
  pushEvent(0, "s", 0, Math.round(speed * 100));
  lastKey[0] = { t: 0, vx: vx[0] as number, vy: vy[0] as number, sp: speed };

  const key = (i: number, t: number) => {
    if (!record) return;
    const tr = tracks[i] as number[];
    const px = mm(x[i] as number);
    const py = mm(y[i] as number);
    const len = tr.length;
    if (len >= 3 && tr[len - 3] === t) {
      tr[len - 2] = px;
      tr[len - 1] = py;
    } else {
      tr.push(t, px, py);
    }
    const bvx = vx[i] as number;
    const bvy = vy[i] as number;
    lastKey[i] = { t, vx: bvx, vy: bvy, sp: Math.hypot(bvx, bvy) };
  };
  /** A resting ball about to move: pin its rest position at `t` so replays hold it still until then. */
  const wake = (i: number, t: number) => {
    if (moving[i]) return;
    moving[i] = 1;
    key(i, Math.max(0, t - 1));
  };

  const pocketed: PocketedBall[] = [];
  let firstHit: number | null = null;
  let railAfterContact = false;
  let cueRailsBeforeHit = 0;
  const banked: number[] = [];

  const slideDecel = MU_SLIDE * G;
  const rollDecel = MU_ROLL * G;
  const r2 = 4 * R * R;
  let step = 0;
  let t = 0;

  for (step = 1; step <= maxSteps; step++) {
    t = step; // ms, since DT = 1 ms
    let any = false;

    // 1) Cloth friction and motion.
    for (let i = 0; i < n; i++) {
      if (!on[i] || !moving[i]) continue;
      let bvx = vx[i] as number;
      let bvy = vy[i] as number;
      let bwx = wx[i] as number;
      let bwy = wy[i] as number;
      // Slip of the contact point with the cloth: v + ω × (−R ẑ).
      const ux = bvx - R * bwy;
      const uy = bvy + R * bwx;
      const slip = Math.hypot(ux, uy);
      if (slip > 1e-4) {
        const change = 3.5 * slideDecel * DT;
        if (slip <= change) {
          // Reaches pure rolling within this step: v_roll = v − (2/7)·u.
          bvx -= (2 / 7) * ux;
          bvy -= (2 / 7) * uy;
          bwx = -bvy / R;
          bwy = bvx / R;
        } else {
          const ex = ux / slip;
          const ey = uy / slip;
          bvx -= slideDecel * ex * DT;
          bvy -= slideDecel * ey * DT;
          bwx -= ((2.5 * slideDecel) / R) * ey * DT;
          bwy += ((2.5 * slideDecel) / R) * ex * DT;
        }
      } else {
        const sp = Math.hypot(bvx, bvy);
        if (sp > 0) {
          const next = Math.max(0, sp - (rollDecel + ROLL_DRAG * sp) * DT);
          const k = next / sp;
          bvx *= k;
          bvy *= k;
        }
        bwx = -bvy / R;
        bwy = bvx / R;
      }
      let bwz = wz[i] as number;
      if (bwz !== 0) {
        const dec = SPIN_DECAY * DT;
        bwz = Math.abs(bwz) <= dec ? 0 : bwz - Math.sign(bwz) * dec;
        wz[i] = bwz;
      }
      const sp = Math.hypot(bvx, bvy);
      const spinning = Math.hypot(bvx - R * bwy, bvy + R * bwx) > 1e-4;
      if (sp < STOP_SPEED && !spinning) {
        vx[i] = 0;
        vy[i] = 0;
        wx[i] = 0;
        wy[i] = 0;
        wz[i] = 0;
        moving[i] = 0;
        key(i, t);
        continue;
      }
      vx[i] = bvx;
      vy[i] = bvy;
      wx[i] = bwx;
      wy[i] = bwy;
      x[i] = (x[i] as number) + bvx * DT;
      y[i] = (y[i] as number) + bvy * DT;
      any = true;
    }

    // 2) Cushions and jaws (only balls near the edge can touch them).
    for (let i = 0; i < n; i++) {
      if (!on[i] || !moving[i]) continue;
      const px = x[i] as number;
      const py = y[i] as number;
      if (px > R + 0.002 && px < TABLE_L - R - 0.002 && py > R + 0.002 && py < TABLE_W - R - 0.002) continue;
      for (const seg of SEGMENTS) {
        const sx = seg.b.x - seg.a.x;
        const sy = seg.b.y - seg.a.y;
        const len2 = sx * sx + sy * sy;
        let u = ((px - seg.a.x) * sx + (py - seg.a.y) * sy) / len2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = seg.a.x + sx * u;
        const qy = seg.a.y + sy * u;
        const ddx = (x[i] as number) - qx;
        const ddy = (y[i] as number) - qy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= R * R || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        const nx = ddx / dist;
        const ny = ddy / dist;
        const vn = (vx[i] as number) * nx + (vy[i] as number) * ny;
        // Push out of the cushion.
        x[i] = qx + nx * R;
        y[i] = qy + ny * R;
        if (vn >= 0) continue;
        cushion(i, nx, ny, vn);
        rails[i] = (rails[i] as number) + 1;
        if (firstHit !== null) railAfterContact = true;
        else if (i === 0) cueRailsBeforeHit++;
        pushEvent(t, "c", i, Math.round(-vn * 100));
        key(i, t);
      }
    }

    // 3) Ball–ball collisions (pairs where at least one ball moves).
    for (let i = 0; i < n; i++) {
      if (!on[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!on[j] || (!moving[i] && !moving[j])) continue;
        const ddx = (x[j] as number) - (x[i] as number);
        const ddy = (y[j] as number) - (y[i] as number);
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 >= r2) continue;
        const dist = Math.sqrt(d2) || 1e-9;
        const nx = ddx / dist;
        const ny = ddy / dist;
        const rel = ((vx[i] as number) - (vx[j] as number)) * nx + ((vy[i] as number) - (vy[j] as number)) * ny;
        // Separate the pair: a resting ball stays put unless it is about to be struck anyway.
        const overlap = 2 * R - dist;
        const hitting = rel > 0;
        if (hitting) {
          // Pin the rest position first so replays hold a struck ball still until now.
          wake(i, t);
          wake(j, t);
        }
        const si = moving[i] || hitting ? (moving[j] || hitting ? 0.5 : 1) : 0;
        const sj = 1 - si;
        x[i] = (x[i] as number) - nx * overlap * si;
        y[i] = (y[i] as number) - ny * overlap * si;
        x[j] = (x[j] as number) + nx * overlap * sj;
        y[j] = (y[j] as number) + ny * overlap * sj;
        if (!hitting) continue;
        const jn = ((1 + E_BALL) / 2) * rel;
        vx[i] = (vx[i] as number) - jn * nx;
        vy[i] = (vy[i] as number) - jn * ny;
        vx[j] = (vx[j] as number) + jn * nx;
        vy[j] = (vy[j] as number) + jn * ny;
        if (firstHit === null && (i === 0 || j === 0)) firstHit = i === 0 ? j : i;
        pushEvent(t, "b", i === 0 ? j : i, Math.round(rel * 100));
        key(i, t);
        key(j, t);
      }
    }

    // 4) Pockets.
    for (let i = 0; i < n; i++) {
      if (!on[i] || !moving[i]) continue;
      const px = x[i] as number;
      const py = y[i] as number;
      if (px > 0.09 && px < TABLE_L - 0.09 && py > 0.09 && py < TABLE_W - 0.09) continue;
      let hole: Pocket | null = null;
      for (const p of POCKETS) {
        if ((px - p.x) ** 2 + (py - p.y) ** 2 < p.r * p.r) {
          hole = p;
          break;
        }
      }
      // Safety net: anything that escaped the rails is counted in the nearest pocket.
      if (!hole && (px < -0.12 || px > TABLE_L + 0.12 || py < -0.12 || py > TABLE_W + 0.12)) hole = nearestPocket({ x: px, y: py });
      if (!hole) continue;
      key(i, t);
      on[i] = 0;
      moving[i] = 0;
      pocketed.push({ id: i, pocket: hole.id, ms: t });
      if (i !== 0 && (rails[i] as number) > 0) banked.push(i);
      pushEvent(t, "p", i, hole.id);
    }

    // 5) Keyframes for replays: collisions keyed above; here, curves and speed changes.
    if (record) {
      for (let i = 0; i < n; i++) {
        if (!on[i] || !moving[i]) continue;
        const lk = lastKey[i] as { t: number; vx: number; vy: number; sp: number };
        const age = t - lk.t;
        if (age < KEY_MIN_MS) {
          // Tight curves (masse, draw reversing) need denser keys.
          if (age >= 12 && turned(lk, vx[i] as number, vy[i] as number, 0.94)) key(i, t);
          continue;
        }
        const bvx = vx[i] as number;
        const bvy = vy[i] as number;
        const sp = Math.hypot(bvx, bvy);
        const drift = (Math.abs(sp - lk.sp) * age) / 8000; // metres of linear-interpolation error
        if (age >= KEY_MAX_MS || drift > 0.0015 || turned(lk, bvx, bvy, KEY_TURN_COS)) key(i, t);
      }
    }

    options.probe?.(t, { x, y, vx, vy, on });
    if (!any) break;
  }

  for (let i = 0; i < n; i++) if (on[i] && moving[i]) key(i, t);

  const final: Balls = new Array(n).fill(null);
  let railBalls = 0;
  for (let i = 0; i < n; i++) {
    if (on[i]) final[i] = { x: x[i] as number, y: y[i] as number };
    if (i > 0 && (rails[i] as number) > 0) railBalls++;
  }
  // Tracks of balls that never moved collapse to their single rest keyframe.
  for (const tr of tracks) if (tr.length > 3 && tr.every((val, k) => k % 3 === 0 || val === tr[k % 3 === 1 ? 1 : 2])) tr.length = 3;

  return {
    final,
    pocketed,
    firstHit,
    railAfterContact,
    railBalls,
    banked,
    cueRailsBeforeHit,
    ms: t,
    rec: { ms: t, tracks: record ? tracks : [], events },
  };

  /** Cushion response: restitution on the normal, friction (english) on the tangent. */
  function cushion(i: number, nx: number, ny: number, vn: number) {
    const tx = -ny;
    const ty = nx;
    const vt = (vx[i] as number) * tx + (vy[i] as number) * ty;
    const e = 0.84 - 0.08 * Math.min(1, -vn / 4);
    const jn = -(1 + e) * vn;
    // Contact slip along the rail: v·t − R·ωz.
    const s = vt - R * (wz[i] as number);
    const jt = -Math.sign(s) * Math.min(MU_CUSHION * jn, (2 / 7) * Math.abs(s));
    vx[i] = (vx[i] as number) + jn * nx + jt * tx;
    vy[i] = (vy[i] as number) + jn * ny + jt * ty;
    wz[i] = (wz[i] as number) - (2.5 * jt) / R;
    // The cushion nose sits above the ball's centre: it eats most of the roll into the rail.
    const wn = (wx[i] as number) * nx + (wy[i] as number) * ny;
    const wt = (wx[i] as number) * tx + (wy[i] as number) * ty;
    const keep = 0.25;
    wx[i] = wn * nx + wt * keep * tx;
    wy[i] = wn * ny + wt * keep * ty;
  }
}

function turned(lk: { vx: number; vy: number; sp: number }, bvx: number, bvy: number, cosLimit: number): boolean {
  const sp = Math.hypot(bvx, bvy);
  if (lk.sp < 1e-6 || sp < 1e-6) return false;
  return (lk.vx * bvx + lk.vy * bvy) / (lk.sp * sp) < cosLimit;
}

export function nearestPocket(p: Vec): Pocket {
  let best = POCKETS[0] as Pocket;
  let bestD = Infinity;
  for (const pk of POCKETS) {
    const d = (pk.x - p.x) ** 2 + (pk.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = pk;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------ */
/* Replay: positions at a time from a recording                             */
/* ------------------------------------------------------------------------ */

/**
 * Position of ball `i` at `ms` along its track (metres), or null once it has
 * dropped (`dropped` lists balls that end in a pocket). Before its first
 * keyframe a ball sits at its first keyframe.
 */
export function trackAt(track: readonly number[], ms: number): Vec | null {
  const count = Math.floor(track.length / 3);
  if (count === 0) return null;
  if (ms <= (track[0] as number)) return { x: (track[1] as number) / 1000, y: (track[2] as number) / 1000 };
  for (let k = 1; k < count; k++) {
    const t1 = track[k * 3] as number;
    if (ms <= t1) {
      const t0 = track[(k - 1) * 3] as number;
      const f = t1 === t0 ? 1 : (ms - t0) / (t1 - t0);
      const x0 = track[(k - 1) * 3 + 1] as number;
      const y0 = track[(k - 1) * 3 + 2] as number;
      const x1 = track[k * 3 + 1] as number;
      const y1 = track[k * 3 + 2] as number;
      return { x: (x0 + (x1 - x0) * f) / 1000, y: (y0 + (y1 - y0) * f) / 1000 };
    }
  }
  return { x: (track[(count - 1) * 3 + 1] as number) / 1000, y: (track[(count - 1) * 3 + 2] as number) / 1000 };
}

/** Last keyframe time of a track. */
export const trackEnd = (track: readonly number[]): number => (track.length >= 3 ? (track[track.length - 3] as number) : 0);

/** Validates an untrusted recording (from the shared state). */
export function readRecording(value: unknown): Recording | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  const ms = r.ms;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > MAX_SHOT_TIME * 1000 + 10) return null;
  if (!Array.isArray(r.tracks) || r.tracks.length > BALLS) return null;
  const tracks: number[][] = [];
  for (const tr of r.tracks) {
    if (!Array.isArray(tr) || tr.length % 3 !== 0 || tr.length > 30_000) return null;
    if (!tr.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e6)) return null;
    tracks.push(tr as number[]);
  }
  const events: [number, EventKind, number, number][] = [];
  if (Array.isArray(r.events)) {
    for (const e of r.events.slice(0, MAX_EVENTS)) {
      if (!Array.isArray(e) || e.length !== 4) continue;
      const [t, kind, a, b] = e as unknown[];
      if (typeof t !== "number" || typeof a !== "number" || typeof b !== "number") continue;
      if (kind !== "b" && kind !== "c" && kind !== "p" && kind !== "s") continue;
      events.push([t, kind, a, b]);
    }
  }
  return { ms, tracks, events };
}

/* ------------------------------------------------------------------------ */
/* Aim prediction (guide lines)                                             */
/* ------------------------------------------------------------------------ */

export type AimHit =
  | { kind: "ball"; id: number; dist: number; ghost: Vec; objectDir: Vec; cueDir: Vec; cut: number }
  | { kind: "rail"; dist: number; at: Vec; normal: Vec; bounce: Vec }
  | { kind: "pocket"; dist: number; at: Vec; pocket: number };

/**
 * Where a cue ball rolled from `from` along `angle` first touches something:
 * a ball (with the ghost-ball position and both deflection directions), a
 * cushion (with the rebound) or a pocket. `follow` is the tip's vertical
 * offset (−1 draw … 1 follow) and `power` 0..1, which bend the cue ball's
 * path after contact the way the simulation will.
 */
export function predictAim(balls: Balls, from: Vec, angle: number, follow = 0, power = 0.5): AimHit | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: AimHit | null = null;
  let bestD = Infinity;

  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (!b) continue;
    // Ray vs circle of radius 2R around the ball.
    const ox = b.x - from.x;
    const oy = b.y - from.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    const rr = 4 * R * R;
    if (perp2 >= rr) continue;
    const dist = along - Math.sqrt(rr - perp2);
    if (dist < 0 || dist >= bestD) continue;
    const ghost = { x: from.x + dx * dist, y: from.y + dy * dist };
    const nx = (b.x - ghost.x) / (2 * R);
    const ny = (b.y - ghost.y) / (2 * R);
    const cosCut = Math.max(-1, Math.min(1, dx * nx + dy * ny));
    // Stun: the cue ball leaves along the tangent; spin at contact bends it.
    const tx = dx - cosCut * nx;
    const ty = dy - cosCut * ny;
    const f = spinAtContact(speedOf(power), follow, dist);
    // Once it rolls again: v = (5/7)·v_t + (2/7)·f·d (the spin still points along the old line).
    const cx = 5 * tx + 2 * f * dx;
    const cy = 5 * ty + 2 * f * dy;
    const cm = Math.hypot(cx, cy);
    best = {
      kind: "ball",
      id: i,
      dist,
      ghost,
      objectDir: { x: nx, y: ny },
      cueDir: cm < 1e-6 ? { x: 0, y: 0 } : { x: cx / cm, y: cy / cm },
      cut: Math.acos(cosCut),
    };
    bestD = dist;
  }

  // Pockets: the ray passes over a hole.
  for (const p of POCKETS) {
    const ox = p.x - from.x;
    const oy = p.y - from.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    const rr = p.r * p.r;
    if (perp2 >= rr) continue;
    const dist = along - Math.sqrt(rr - perp2);
    if (dist >= bestD) continue;
    // Only counts if the ball fits through the mouth (no jaw first) — checked below by the segment pass.
    best = { kind: "pocket", dist: Math.max(0, dist), at: { x: from.x + dx * dist, y: from.y + dy * dist }, pocket: p.id };
    bestD = dist;
  }

  // Cushions and jaws: sweep a circle of radius R.
  for (const seg of SEGMENTS) {
    const hit = sweepSegment(from, dx, dy, seg);
    if (!hit || hit.dist >= bestD) continue;
    const vn = dx * hit.nx + dy * hit.ny;
    best = {
      kind: "rail",
      dist: hit.dist,
      at: { x: from.x + dx * hit.dist, y: from.y + dy * hit.dist },
      normal: { x: hit.nx, y: hit.ny },
      bounce: { x: dx - 2 * vn * hit.nx, y: dy - 2 * vn * hit.ny },
    };
    bestD = hit.dist;
  }
  return best;
}

/** First distance along (dx, dy) at which a circle of radius R centred at `from` touches `seg`. */
function sweepSegment(from: Vec, dx: number, dy: number, seg: Segment): { dist: number; nx: number; ny: number } | null {
  let best: { dist: number; nx: number; ny: number } | null = null;
  const sx = seg.b.x - seg.a.x;
  const sy = seg.b.y - seg.a.y;
  const len = Math.hypot(sx, sy);
  const ux = sx / len;
  const uy = sy / len;
  // Both faces of the segment.
  for (const side of [1, -1]) {
    const nx = -uy * side;
    const ny = ux * side;
    const denom = dx * nx + dy * ny;
    if (denom >= -1e-9) continue; // moving away from / along this face
    // Distance from the offset line (at R along n).
    const px = from.x - (seg.a.x + nx * R);
    const py = from.y - (seg.a.y + ny * R);
    const t = -(px * nx + py * ny) / denom;
    if (t < 0) continue;
    const hx = from.x + dx * t - seg.a.x;
    const hy = from.y + dy * t - seg.a.y;
    const along = hx * ux + hy * uy;
    if (along < 0 || along > len) continue;
    if (!best || t < best.dist) best = { dist: t, nx, ny };
  }
  // The two ends (knuckles).
  for (const e of [seg.a, seg.b]) {
    const ox = e.x - from.x;
    const oy = e.y - from.y;
    const along = ox * dx + oy * dy;
    if (along <= 0) continue;
    const perp2 = ox * ox + oy * oy - along * along;
    if (perp2 >= R * R) continue;
    const t = along - Math.sqrt(R * R - perp2);
    if (t < 0) continue;
    if (!best || t < best.dist) {
      const hx = from.x + dx * t - e.x;
      const hy = from.y + dy * t - e.y;
      const m = Math.hypot(hx, hy) || 1;
      best = { dist: t, nx: hx / m, ny: hy / m };
    }
  }
  return best;
}

/**
 * The cue ball's ωR/v at the moment it has travelled `dist`, starting with
 * speed `speed` and a vertical tip offset `follow` (−1 … 1). Sliding friction
 * pulls it towards natural roll (1) on the way.
 */
export function spinAtContact(speed: number, follow: number, dist: number): number {
  let sp = speed;
  let wr = SPIN_GAIN * follow * speed; // ω·R
  let travelled = 0;
  const dt = 0.004;
  for (let k = 0; k < 4000 && travelled < dist && sp > 0.01; k++) {
    const slip = sp - wr;
    if (Math.abs(slip) < 1e-3) return 1;
    const s = Math.sign(slip);
    const dv = MU_SLIDE * G * dt;
    if (Math.abs(slip) <= 3.5 * dv) {
      return 1;
    }
    sp -= s * dv;
    wr += s * 2.5 * dv;
    travelled += sp * dt;
  }
  return sp > 0.01 ? wr / sp : 1;
}
