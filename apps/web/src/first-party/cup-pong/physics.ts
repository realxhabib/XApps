/**
 * Cup Pong ball physics: a small fixed-step simulator (no engine) for a
 * ping-pong ball against the table, the cups' rolled rims (tori) and their
 * tapered walls. Pure and deterministic: the same throw against the same
 * cups always produces the same trajectory on a given JS engine.
 *
 * The *thrower* runs the simulation once, then shares the outcome and a
 * compact, quantised trajectory (see `encodePath`). Everyone else just
 * replays that trajectory, so no two devices ever need to agree on floating
 * point physics.
 *
 * Everything is in the thrower's frame (see geometry.ts): hand behind z = 0,
 * target rack at the far end.
 */

import {
  BALL_R,
  CUP_H,
  CUP_TOP_R,
  FIRE_HIT_R,
  LIQUID_Y,
  RIM_TUBE,
  TABLE_L,
  TABLE_W,
  cupInShooterFrame,
  cupRadiusAt,
  type Cup,
  type Vec3,
} from "./geometry";

/* ---------------------------------------------------------------------- */
/* Tuning                                                                 */
/* ---------------------------------------------------------------------- */

export const GRAVITY = 9.81;
/** Where the ball leaves the hand. */
export const HAND: Readonly<Vec3> = { x: 0, y: 0.34, z: -0.16 };
/** Launch elevation: a proper lob, so balls drop into cups instead of skimming them. */
export const LOFT = (52 * Math.PI) / 180;
/** Full-scale aim (aim = ±1) in radians of yaw. */
export const MAX_YAW = 0.15;
/** Power 0 → the ball would cross rim height this far from the hand; power 1 → D_FAR. */
export const D_NEAR = 1.2;
export const D_FAR = 2.75;
/** Overpowered throws are allowed (they sail off the end). */
export const MAX_POWER = 1.25;

const DT = 1 / 500;
const MAX_T = 4.5;
const SAMPLE_MS = 33;

const E_TABLE = 0.56;
const F_TABLE = 0.92;
const E_RIM = 0.36;
const F_RIM = 0.45;
const E_WALL = 0.32;
const ROLL_FRICTION = 1.4;
/** A ball this far down inside a cup is in. */
const SINK_DEPTH = 0.034;

/* ---------------------------------------------------------------------- */
/* Launch                                                                 */
/* ---------------------------------------------------------------------- */

export interface ThrowInput {
  /** −1 (left) … 1 (right). */
  aim: number;
  /** 0 … MAX_POWER; distance-linear (see D_NEAR / D_FAR). */
  power: number;
}

const q4 = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Clamps and quantises a throw (what gets stored and simulated). */
export function normalizeThrow(input: ThrowInput): ThrowInput {
  const aim = Number.isFinite(input.aim) ? input.aim : 0;
  const power = Number.isFinite(input.power) ? input.power : 0;
  return { aim: q4(clamp(aim, -1, 1)), power: q4(clamp(power, 0, MAX_POWER)) };
}

/** Launch speed that makes a LOFT throw cross height `h` after `d` metres of horizontal travel. */
export function speedForDistance(d: number, h: number = CUP_H): number {
  const cos = Math.cos(LOFT);
  const rise = HAND.y + d * Math.tan(LOFT) - h;
  return Math.sqrt((GRAVITY * d * d) / (2 * cos * cos * Math.max(1e-6, rise)));
}

export const powerToDistance = (power: number) => D_NEAR + power * (D_FAR - D_NEAR);
export const distanceToPower = (d: number) => (d - D_NEAR) / (D_FAR - D_NEAR);

export function launchVelocity(input: ThrowInput): Vec3 {
  const { aim, power } = normalizeThrow(input);
  const v = speedForDistance(powerToDistance(power));
  const yaw = aim * MAX_YAW;
  const h = v * Math.cos(LOFT);
  return { x: h * Math.sin(yaw), y: v * Math.sin(LOFT), z: h * Math.cos(yaw) };
}

/**
 * The throw that would drop the ball dead centre into a cup at `(u, v)`
 * (ignoring every other cup). The bot aims with this and then adds its
 * difficulty's error.
 */
export function idealThrow(cup: { u: number; v: number }): ThrowInput {
  const c = cupInShooterFrame(cup);
  const dx = c.x - HAND.x;
  const dz = c.z - HAND.z;
  const yaw = Math.atan2(dx, dz);
  const d = Math.hypot(dx, dz);
  // The ball comes down at an angle and the far rim is the forgiving side, so
  // the sweet spot is a touch past the cup's axis at rim height.
  return normalizeThrow({ aim: yaw / MAX_YAW, power: distanceToPower(d + 0.013) });
}

/* ---------------------------------------------------------------------- */
/* Simulation                                                             */
/* ---------------------------------------------------------------------- */

export const EV_TABLE = 1;
export const EV_RIM = 2;
export const EV_WALL = 3;
export const EV_SINK = 4;
export const EV_OUT = 5;
export type EventKind = typeof EV_TABLE | typeof EV_RIM | typeof EV_WALL | typeof EV_SINK | typeof EV_OUT;

export interface ThrowEvent {
  /** ms after release. */
  t: number;
  kind: EventKind;
  /** Cup id for rim/wall/sink, else -1. */
  cup: number;
  /** Impact speed (m/s) — drives the sound's loudness. */
  speed: number;
}

export interface PathPoint {
  t: number;
  x: number;
  y: number;
  z: number;
}

export type EndReason = "sink" | "out" | "rest" | "time";

export interface ThrowResult {
  input: ThrowInput;
  /** Id of the cup the ball went into, or null. */
  cup: number | null;
  /** The ball touched the table before going in. */
  bounce: boolean;
  /** The ball touched a rim before going in (a rattler). */
  rim: boolean;
  end: EndReason;
  path: PathPoint[];
  events: ThrowEvent[];
  /** Total animation length in ms. */
  duration: number;
}

export interface SimOptions {
  /** On fire: the hot ball collides like a smaller one. */
  fire?: boolean;
}

/**
 * Flies one throw at the given cups (the defender's rack). Deterministic:
 * fixed 2 ms steps, no randomness, no clocks.
 */
export function simulateThrow(rawInput: ThrowInput, cups: readonly Cup[], options: SimOptions = {}): ThrowResult {
  const input = normalizeThrow(rawInput);
  const hitR = options.fire ? FIRE_HIT_R : BALL_R;
  const vel = launchVelocity(input);
  let px = HAND.x;
  let py = HAND.y;
  let pz = HAND.z;
  let vx = vel.x;
  let vy = vel.y;
  let vz = vel.z;

  const targets = cups.map((c) => ({ id: c.id, ...cupInShooterFrame(c), inside: false }));
  const path: PathPoint[] = [];
  const events: ThrowEvent[] = [];
  let lastSample = -Infinity;
  const sample = (tMs: number, force = false) => {
    if (!force && tMs - lastSample < SAMPLE_MS) return;
    const last = path[path.length - 1];
    if (last && last.t === tMs) path.pop();
    path.push({ t: tMs, x: px, y: py, z: pz });
    lastSample = tMs;
  };
  const lastEventAt = new Map<string, number>();
  const event = (tMs: number, kind: EventKind, cup: number, speed: number) => {
    const key = `${kind}:${cup}`;
    const prev = lastEventAt.get(key);
    // Rolling contact and rim scrapes would otherwise fire every step.
    if (prev !== undefined && tMs - prev < 45) return;
    lastEventAt.set(key, tMs);
    events.push({ t: tMs, kind, cup, speed: Math.round(speed * 100) / 100 });
  };

  let bounced = false;
  let rimmed = false;
  let rolling = false;
  let end: EndReason = "time";
  let sunk: number | null = null;
  const steps = Math.round(MAX_T / DT);
  let step = 0;
  sample(0, true);

  for (step = 1; step <= steps; step++) {
    const tMs = Math.round(step * DT * 1000);
    const prevY = py;
    if (!rolling) vy -= GRAVITY * DT;
    px += vx * DT;
    py += vy * DT;
    pz += vz * DT;
    let contact = false;

    // Table top.
    const overTable = Math.abs(px) <= TABLE_W / 2 && pz >= 0 && pz <= TABLE_L;
    if (overTable && py < BALL_R && prevY >= BALL_R - 1e-6 && vy <= 0) {
      const impact = -vy;
      py = BALL_R;
      if (impact < 0.28) {
        vy = 0;
        rolling = true;
      } else {
        vy = impact * E_TABLE;
        vx *= F_TABLE;
        vz *= F_TABLE;
        bounced = true;
        event(tMs, EV_TABLE, -1, impact);
        contact = true;
      }
    }
    if (rolling) {
      if (!overTable) {
        rolling = false;
      } else {
        const k = Math.max(0, 1 - ROLL_FRICTION * DT);
        vx *= k;
        vz *= k;
        py = BALL_R;
        if (Math.hypot(vx, vz) < 0.05) {
          end = "rest";
          sample(tMs, true);
          break;
        }
      }
    }

    // Cups.
    for (const c of targets) {
      const dx = px - c.x;
      const dz = pz - c.z;
      const rho = Math.hypot(dx, dz);
      if (rho > CUP_TOP_R + hitR + RIM_TUBE + 0.01) {
        if (py >= CUP_H) c.inside = false;
        continue;
      }
      const nx = rho > 1e-9 ? dx / rho : 1;
      const nz = rho > 1e-9 ? dz / rho : 0;

      // Rolled rim: a torus of radius CUP_TOP_R at the cup's lip.
      const qx = c.x + nx * CUP_TOP_R;
      const qz = c.z + nz * CUP_TOP_R;
      const ex = px - qx;
      const ey = py - CUP_H;
      const ez = pz - qz;
      const d = Math.hypot(ex, ey, ez);
      const reach = hitR + RIM_TUBE;
      if (d < reach && d > 1e-9) {
        const mx = ex / d;
        const my = ey / d;
        const mz = ez / d;
        const pen = reach - d;
        px += mx * pen;
        py += my * pen;
        pz += mz * pen;
        const vn = vx * mx + vy * my + vz * mz;
        if (vn < 0) {
          const tx = vx - vn * mx;
          const ty = vy - vn * my;
          const tz = vz - vn * mz;
          const out = -vn * E_RIM;
          vx = tx * F_RIM + out * mx;
          vy = ty * F_RIM + out * my;
          vz = tz * F_RIM + out * mz;
          rimmed = true;
          if (-vn > 0.12) event(tMs, EV_RIM, c.id, -vn);
          contact = true;
        }
      }

      if (py >= CUP_H) {
        // Above the lip: whether we'd drop inside or outside the wall.
        c.inside = Math.hypot(px - c.x, pz - c.z) < CUP_TOP_R;
        continue;
      }
      const r2 = Math.hypot(px - c.x, pz - c.z);
      const wall = cupRadiusAt(py);
      if (c.inside) {
        const limit = wall - hitR;
        if (r2 > limit) {
          px = c.x + nx * limit;
          pz = c.z + nz * limit;
          const vr = vx * nx + vz * nz;
          if (vr > 0) {
            vx -= (1 + E_WALL) * vr * nx;
            vz -= (1 + E_WALL) * vr * nz;
          }
        }
        if (py < CUP_H - SINK_DEPTH) {
          sunk = c.id;
          break;
        }
      } else if (py < CUP_H - RIM_TUBE) {
        const limit = wall + hitR;
        if (r2 < limit) {
          px = c.x + nx * limit;
          pz = c.z + nz * limit;
          const vr = vx * nx + vz * nz;
          if (vr < 0) {
            vx -= (1 + E_WALL) * vr * nx;
            vz -= (1 + E_WALL) * vr * nz;
            if (-vr > 0.12) event(tMs, EV_WALL, c.id, -vr);
            contact = true;
          }
        }
      }
    }

    if (sunk !== null) {
      sample(tMs, true);
      const cup = targets.find((c) => c.id === sunk)!;
      const speed = Math.hypot(vx, vy, vz);
      event(tMs, EV_SINK, sunk, speed);
      // Drop onto the drink, drifting towards the middle of the cup.
      const endT = tMs + 140;
      px = cup.x + (px - cup.x) * 0.35;
      pz = cup.z + (pz - cup.z) * 0.35;
      py = LIQUID_Y + BALL_R * 0.35;
      sample(endT, true);
      end = "sink";
      step = Math.round(endT / 1000 / DT);
      break;
    }
    if (py < -0.35) {
      end = "out";
      event(tMs, EV_OUT, -1, Math.hypot(vx, vy, vz));
      sample(tMs, true);
      break;
    }
    sample(tMs, contact);
  }
  if (end === "time") sample(Math.round(Math.min(step, steps) * DT * 1000), true);

  const last = path[path.length - 1] as PathPoint;
  return {
    input,
    cup: sunk,
    bounce: sunk !== null && bounced,
    rim: sunk !== null && rimmed,
    end,
    path,
    events,
    duration: last.t,
  };
}

/* ---------------------------------------------------------------------- */
/* Compact trajectories (shared state / room)                             */
/* ---------------------------------------------------------------------- */

/** `[t ms, x mm, y mm, z mm, …]` */
export function encodePath(path: readonly PathPoint[]): number[] {
  const out: number[] = [];
  for (const p of path) out.push(Math.round(p.t), Math.round(p.x * 1000), Math.round(p.y * 1000), Math.round(p.z * 1000));
  return out;
}

/** `[t ms, kind, cup, speed cm/s, …]` */
export function encodeEvents(events: readonly ThrowEvent[]): number[] {
  const out: number[] = [];
  for (const e of events) out.push(Math.round(e.t), e.kind, e.cup, Math.round(e.speed * 100));
  return out;
}

const MAX_POINTS = 400;
const MAX_EVENTS = 80;

/** Decodes an untrusted path; null if malformed. */
export function decodePath(raw: unknown): PathPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 8 || raw.length % 4 !== 0 || raw.length > MAX_POINTS * 4) return null;
  const out: PathPoint[] = [];
  let prevT = -1;
  for (let i = 0; i < raw.length; i += 4) {
    const [t, x, y, z] = raw.slice(i, i + 4) as unknown[];
    if (![t, x, y, z].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 100_000)) return null;
    if ((t as number) < prevT) return null;
    prevT = t as number;
    out.push({ t: t as number, x: (x as number) / 1000, y: (y as number) / 1000, z: (z as number) / 1000 });
  }
  return out;
}

export function decodeEvents(raw: unknown): ThrowEvent[] | null {
  if (!Array.isArray(raw) || raw.length % 4 !== 0 || raw.length > MAX_EVENTS * 4) return null;
  const out: ThrowEvent[] = [];
  for (let i = 0; i < raw.length; i += 4) {
    const [t, kind, cup, speed] = raw.slice(i, i + 4) as unknown[];
    if (![t, kind, cup, speed].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if (!Number.isInteger(kind) || (kind as number) < EV_TABLE || (kind as number) > EV_OUT) return null;
    out.push({ t: t as number, kind: kind as EventKind, cup: cup as number, speed: (speed as number) / 100 });
  }
  return out;
}

/** Where the ball is `t` ms into a path (linear between samples; samples sit on every contact). */
export function samplePath(path: readonly PathPoint[], t: number): Vec3 {
  const first = path[0] as PathPoint;
  if (t <= first.t) return { x: first.x, y: first.y, z: first.z };
  let lo = 0;
  let hi = path.length - 1;
  const last = path[hi] as PathPoint;
  if (t >= last.t) return { x: last.x, y: last.y, z: last.z };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((path[mid] as PathPoint).t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo] as PathPoint;
  const b = path[hi] as PathPoint;
  const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

/* ---------------------------------------------------------------------- */
/* Aiming aids                                                            */
/* ---------------------------------------------------------------------- */

/**
 * The first `fraction` of a throw's flight (ballistic, no contacts) as points
 * — the subtle arc preview for a player's first throws.
 */
export function previewArc(input: ThrowInput, fraction = 0.45, points = 18): Vec3[] {
  const v = launchVelocity(input);
  // Time until the ball would come back down to the table.
  const a = -GRAVITY / 2;
  const tLand = (-v.y - Math.sqrt(v.y * v.y - 4 * a * (HAND.y - BALL_R))) / (2 * a);
  const tEnd = tLand * fraction;
  const out: Vec3[] = [];
  for (let i = 0; i <= points; i++) {
    const t = (tEnd * i) / points;
    out.push({ x: HAND.x + v.x * t, y: HAND.y + v.y * t - (GRAVITY / 2) * t * t, z: HAND.z + v.z * t });
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Swipe → throw                                                          */
/* ---------------------------------------------------------------------- */

/** Flick speed (play-area heights per second) that maps to power 0 and to power 1. */
export const FLICK_SLOW = 0.7;
export const FLICK_FAST = 3.4;
/**
 * Power curve: < 1 makes soft tosses (the bounce-shot range) touchier and the
 * lob range around the rack more forgiving.
 */
export const FLICK_GAMMA = 0.78;
/** Swipe angle from vertical (tan) that maps to full aim. */
export const FLICK_FULL_AIM = Math.tan((24 * Math.PI) / 180);

export interface Flick {
  /** Horizontal travel of the release window, px (right positive). */
  dx: number;
  /** Vertical travel of the release window, px (up negative, like the screen). */
  dy: number;
  /** Duration of the release window, ms. */
  ms: number;
  /** Height of the play area, px. */
  height: number;
}

/**
 * A flick's release velocity → a throw: faster flicks throw further, the
 * swipe's lean aims left/right. `null` when it isn't an upward flick.
 */
export function throwFromFlick(flick: Flick): ThrowInput | null {
  const up = -flick.dy;
  if (up <= 0 || flick.ms <= 0 || flick.height <= 0) return null;
  const speed = up / flick.height / (flick.ms / 1000);
  return normalizeThrow({ aim: flick.dx / up / FLICK_FULL_AIM, power: flickPower(speed) });
}

/** Flick speed (heights/s) → power. */
export function flickPower(speed: number): number {
  const linear = Math.max(0, (speed - FLICK_SLOW) / (FLICK_FAST - FLICK_SLOW));
  return Math.pow(linear, FLICK_GAMMA);
}

/** Power → the flick speed (heights/s) that produces it (for hints and tests). */
export function flickSpeedFor(power: number): number {
  return FLICK_SLOW + Math.pow(Math.max(0, power), 1 / FLICK_GAMMA) * (FLICK_FAST - FLICK_SLOW);
}
