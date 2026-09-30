/**
 * Mini Golf physics: one ball on a height field, fixed timestep.
 *
 * Deterministic by construction: a shot's outcome depends only on the hole,
 * the lie, the aim, the power and the tick it was struck on (moving
 * obstacles are pure functions of time). No randomness, no wall clock, so the
 * same shot replays identically anywhere — each player simulates only their
 * own ball, and opponents just see the positions it produced.
 *
 * Model: the ball rolls on the turf (slopes accelerate it by −g∇h, rolling
 * resistance slows it, sand much more), bounces off walls/blocks (restitution)
 * and bumpers (with a kick), rides boost pads, flies off ramp edges when the
 * ground falls away faster than gravity, lands, splashes into water (the game
 * adds a penalty stroke and puts it back), travels through tubes, and drops
 * into the cup when it arrives slowly enough (faster balls lip out).
 */

import type { Slider, Spinner, Windmill } from "./course";
import { BALL_R, type CompiledHole } from "./compile";

/* ------------------------------------------------------------------ */
/* Tuning                                                             */
/* ------------------------------------------------------------------ */

/** 120 Hz keeps a full-power ball under half its radius per step (no tunnelling). */
export const HZ = 120;
export const DT = 1 / HZ;
export const G = 9.8;
/** Launch speed at full power (units/s). */
export const MAX_SPEED = 12.5;
export const CUP_R = 0.25;
/** A ball slower than this over the cup drops in; faster ones lip out. */
export const CAPTURE_SPEED = 1.9;
/** Rolling resistance: deceleration = k0 + k1·speed. k0 is also the static friction (a ball rests on slopes gentler than k0/g). */
export const FRICTION = {
  turf: { k0: 1.3, k1: 0.11 },
  sand: { k0: 6.5, k1: 1.4 },
} as const;
export const WALL_E = 0.7;
export const BLOCK_E = 0.66;
export const BUMPER_E = 0.95;
/** Extra speed a bumper adds on a solid hit. */
export const BUMPER_KICK = 1.4;
export const BOOST_ACCEL = 16;
export const BOOST_TOP = 9.5;
export const TUBE_TICKS = Math.round(0.55 * HZ);
export const TUBE_R = 0.3;
/** A shot never lasts longer than this. */
export const MAX_SHOT_TICKS = 25 * HZ;
const STOP_SPEED = 0.06;
const SPINNER_HUB = 0.16;
const SPINNER_ARM = 0.06;
const GATE_HALF = 0.3;

/* ------------------------------------------------------------------ */
/* Moving obstacles (pure functions of time, shared with the renderer) */
/* ------------------------------------------------------------------ */

export function spinnerAngle(s: Spinner, t: number): number {
  return s.phase + s.speed * t;
}

export function sliderState(s: Slider, t: number): { x: number; y: number; vx: number; vy: number } {
  const w = (2 * Math.PI) / s.period;
  const a = w * t + s.phase;
  const u = 0.5 - 0.5 * Math.cos(a);
  const du = 0.5 * Math.sin(a) * w;
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  return { x: s.from.x + dx * u, y: s.from.y + dy * u, vx: dx * du, vy: dy * du };
}

export function windmillAngle(w: Windmill, t: number): number {
  return w.phase + w.speed * t;
}

/** Whether a sail hangs across the tunnel mouth at time t. */
export function gateClosed(w: Windmill, t: number): boolean {
  const base = windmillAngle(w, t);
  for (let i = 0; i < w.sails; i++) {
    let d = (base + (i * 2 * Math.PI) / w.sails + Math.PI / 2) % (2 * Math.PI);
    if (d < 0) d += 2 * Math.PI;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (Math.abs(d) < GATE_HALF) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Simulation                                                         */
/* ------------------------------------------------------------------ */

export type SimStatus = "rest" | "rolling" | "tube" | "holed" | "water";

export type SimEvent =
  | { type: "wall"; speed: number }
  | { type: "bumper"; index: number; speed: number }
  | { type: "obstacle"; speed: number }
  | { type: "sand" }
  | { type: "boost" }
  | { type: "water"; x: number; y: number }
  | { type: "tube-in"; index: number }
  | { type: "tube-out"; index: number }
  | { type: "launch" }
  | { type: "land"; speed: number }
  | { type: "lip" }
  | { type: "cup" }
  | { type: "rest" }
  | { type: "knock" };

export interface ShotStats {
  /** Wall, block and bumper contacts this shot. */
  bounces: number;
  /** Ticks spent in the air this shot. */
  airTicks: number;
  tubes: number;
}

const grad: [number, number] = [0, 0];

export class Sim {
  x: number;
  y: number;
  z: number;
  vx = 0;
  vy = 0;
  vz = 0;
  air = false;
  status: SimStatus = "rest";
  /** Absolute tick: time = tick · DT. */
  tick: number;
  /** Ticks since the current shot (or knock) started. */
  shotTicks = 0;
  tubeIndex = -1;
  tubeLeft = 0;
  private tubeSpeed = 0;
  private inSand = false;
  private onBoost = false;
  private lipArmed = true;
  stats: ShotStats = { bounces: 0, airTicks: 0, tubes: 0 };
  /** Events since the last drain. Consumers may clear it; the sim only appends. */
  events: SimEvent[] = [];
  readonly c: CompiledHole;

  constructor(course: CompiledHole, x: number, y: number, tick = 0) {
    this.c = course;
    this.x = x;
    this.y = y;
    this.z = course.height(x, y);
    this.tick = tick;
  }

  get time(): number {
    return this.tick * DT;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get moving(): boolean {
    return this.status === "rolling" || this.status === "tube";
  }

  /** Strike the resting ball. `angle` in radians (0 = +x, π/2 = toward the far end), power 0..1. */
  shoot(angle: number, power: number): void {
    const p = Math.max(0, Math.min(1, power));
    const v = p * MAX_SPEED;
    this.vx = Math.cos(angle) * v;
    this.vy = Math.sin(angle) * v;
    this.vz = 0;
    this.air = false;
    this.status = "rolling";
    this.shotTicks = 0;
    this.stats = { bounces: 0, airTicks: 0, tubes: 0 };
    this.lipArmed = true;
    this.inSand = this.c.surfaceAt(this.x, this.y)?.type === "sand";
  }

  /** Put the ball down at rest (after a splash, or to replay). */
  place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.z = this.c.height(x, y);
    this.vx = this.vy = this.vz = 0;
    this.air = false;
    this.status = "rest";
  }

  /** Advance one fixed step. A resting ball only reacts to moving obstacles hitting it. */
  step(): void {
    this.tick++;
    const st = this.status;
    if (st === "holed" || st === "water") return;
    if (st === "rest") {
      if (this.collideMoving(false) > 0) {
        this.status = "rolling";
        this.shotTicks = 0;
        this.stats = { bounces: 0, airTicks: 0, tubes: 0 };
        this.events.push({ type: "knock" });
      }
      return;
    }
    this.shotTicks++;
    if (st === "tube") {
      if (--this.tubeLeft <= 0) this.exitTube();
      return;
    }
    this.integrate();
  }

  private integrate(): void {
    const c = this.c;
    const surface = this.air ? null : c.surfaceAt(this.x, this.y);
    const sand = surface?.type === "sand";
    // Ground slope at the start of the step (also gives the vertical speed on the ground).
    c.grad(this.x, this.y, grad);
    const gx0 = grad[0];
    const gy0 = grad[1];
    if (!this.air) {
      const g2 = gx0 * gx0 + gy0 * gy0;
      let ax = (-G * gx0) / (1 + g2);
      let ay = (-G * gy0) / (1 + g2);
      if (surface?.type === "boost" && surface.dir) {
        const along = this.vx * surface.dir.x + this.vy * surface.dir.y;
        if (along < BOOST_TOP) {
          ax += surface.dir.x * BOOST_ACCEL;
          ay += surface.dir.y * BOOST_ACCEL;
        }
        if (!this.onBoost) this.events.push({ type: "boost" });
        this.onBoost = true;
      } else this.onBoost = false;
      // Cup: a gentle pull toward the middle once over the rim.
      const cdx = c.hole.cup.x - this.x;
      const cdy = c.hole.cup.y - this.y;
      const cd = Math.hypot(cdx, cdy);
      if (cd < CUP_R && cd > 1e-6) {
        ax += (cdx / cd) * 5;
        ay += (cdy / cd) * 5;
      }
      const f = sand ? FRICTION.sand : FRICTION.turf;
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 0) {
        const dv = (f.k0 + f.k1 * speed) * DT;
        if (dv >= speed) {
          this.vx = 0;
          this.vy = 0;
        } else {
          this.vx -= (this.vx / speed) * dv;
          this.vy -= (this.vy / speed) * dv;
        }
      }
      this.vx += ax * DT;
      this.vy += ay * DT;
      if (sand && !this.inSand) this.events.push({ type: "sand" });
      this.inSand = sand;
    } else {
      this.vz -= G * DT;
      this.stats.airTicks++;
    }

    const px = this.x;
    const py = this.y;
    this.x += this.vx * DT;
    this.y += this.vy * DT;

    this.collideStatic();
    this.collideMoving(true);

    // Height: follow the ground, or fly when it falls away.
    const h = c.height(this.x, this.y);
    if (!this.air) {
      const vzGround = this.vx * gx0 + this.vy * gy0;
      const ballistic = this.z + vzGround * DT - 0.5 * G * DT * DT;
      if (h > this.z + 0.08) {
        this.blockStep(px, py);
      } else if (h < ballistic - 0.004) {
        this.air = true;
        this.vz = vzGround;
        this.z = ballistic;
        this.events.push({ type: "launch" });
      } else {
        this.z = h;
      }
    } else {
      this.z += this.vz * DT;
      if (this.z <= h) {
        if (h - this.z > 0.12 && this.vz > -6) {
          // Clipped the side of higher ground: bounce back off it.
          this.z = Math.max(this.z, c.height(px, py));
          this.blockStep(px, py);
        } else {
          const impact = -this.vz;
          this.z = h;
          if (impact > 1.6) {
            this.vz = impact * 0.32;
            this.vx *= 0.9;
            this.vy *= 0.9;
          } else {
            this.air = false;
            this.vz = 0;
            this.vx *= 0.94;
            this.vy *= 0.94;
          }
          this.events.push({ type: "land", speed: impact });
        }
      }
    }

    if (this.air) return this.timeout();

    // Surfaces that end or redirect the shot.
    const under = c.surfaceAt(this.x, this.y);
    if (under?.type === "water") {
      this.status = "water";
      this.vx = this.vy = this.vz = 0;
      this.events.push({ type: "water", x: this.x, y: this.y });
      return;
    }
    const tubes = c.hole.tubes;
    if (tubes) {
      for (let i = 0; i < tubes.length; i++) {
        const t = tubes[i]!;
        if (Math.hypot(this.x - t.from.x, this.y - t.from.y) < TUBE_R) {
          this.status = "tube";
          this.tubeIndex = i;
          this.tubeLeft = TUBE_TICKS;
          this.tubeSpeed = Math.hypot(this.vx, this.vy);
          this.x = t.from.x;
          this.y = t.from.y;
          this.vx = this.vy = 0;
          this.stats.tubes++;
          this.events.push({ type: "tube-in", index: i });
          return;
        }
      }
    }

    // The cup.
    const cup = c.hole.cup;
    const dx = this.x - cup.x;
    const dy = this.y - cup.y;
    const d = Math.hypot(dx, dy);
    const speed = Math.hypot(this.vx, this.vy);
    if (d < CUP_R - BALL_R * 0.3) {
      if (speed < CAPTURE_SPEED) {
        this.status = "holed";
        this.x = cup.x;
        this.y = cup.y;
        this.vx = this.vy = 0;
        this.events.push({ type: "cup" });
        return;
      }
      if (this.lipArmed) {
        // Too hot: it rattles across, knocked off line away from the middle.
        this.lipArmed = false;
        const off = (dx * this.vy - dy * this.vx) / (speed * CUP_R);
        const turn = -Math.sign(off || 1) * 0.28 * (1 - Math.min(1, Math.abs(off)));
        const cs = Math.cos(turn);
        const sn = Math.sin(turn);
        const vx = this.vx * cs - this.vy * sn;
        const vy = this.vx * sn + this.vy * cs;
        this.vx = vx * 0.86;
        this.vy = vy * 0.86;
        this.events.push({ type: "lip" });
      }
    } else if (d > CUP_R + 0.05) {
      this.lipArmed = true;
    }

    // Coming to rest.
    if (speed < STOP_SPEED && d > CUP_R) {
      c.grad(this.x, this.y, grad);
      const slope = (G * Math.hypot(grad[0], grad[1])) / (1 + grad[0] * grad[0] + grad[1] * grad[1]);
      const f = this.inSand ? FRICTION.sand : FRICTION.turf;
      if (slope < f.k0 * 0.95) {
        this.vx = this.vy = 0;
        this.status = "rest";
        this.events.push({ type: "rest" });
        return;
      }
    }
    this.timeout();
  }

  private timeout(): void {
    if (this.shotTicks < MAX_SHOT_TICKS) return;
    // Safety valve (e.g. rocking forever in a bowl): settle where it is.
    if (this.air) {
      this.air = false;
      this.z = this.c.height(this.x, this.y);
    }
    this.vx = this.vy = this.vz = 0;
    this.status = "rest";
    this.events.push({ type: "rest" });
  }

  /** Moving into much higher ground at rolling height acts like a wall. */
  private blockStep(px: number, py: number): void {
    this.x = px;
    this.y = py;
    this.vx *= -0.4;
    this.vy *= -0.4;
    this.events.push({ type: "wall", speed: Math.hypot(this.vx, this.vy) });
  }

  private exitTube(): void {
    const t = this.c.hole.tubes![this.tubeIndex]!;
    const speed = Math.min(7, Math.max(2.4, this.tubeSpeed * 0.8));
    this.x = t.to.x;
    this.y = t.to.y;
    this.z = this.c.height(t.to.x, t.to.y);
    this.vx = t.dir.x * speed;
    this.vy = t.dir.y * speed;
    this.status = "rolling";
    this.events.push({ type: "tube-out", index: this.tubeIndex });
  }

  /**
   * Pushes the ball out of a circle/capsule contact at (qx, qy) of radius `rad`
   * moving with (ovx, ovy); reflects the relative velocity. Returns the impact
   * speed (0 when touching without closing in), or −1 when not touching.
   */
  private contact(qx: number, qy: number, rad: number, e: number, ovx: number, ovy: number): number {
    const dx = this.x - qx;
    const dy = this.y - qy;
    const min = BALL_R + rad;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return -1;
    const d = Math.sqrt(d2);
    let nx: number;
    let ny: number;
    if (d > 1e-9) {
      nx = dx / d;
      ny = dy / d;
    } else {
      const s = Math.hypot(this.vx - ovx, this.vy - ovy) || 1;
      nx = -(this.vx - ovx) / s;
      ny = -(this.vy - ovy) / s;
    }
    this.x += nx * (min - d);
    this.y += ny * (min - d);
    let rvx = this.vx - ovx;
    let rvy = this.vy - ovy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return 0;
    rvx -= (1 + e) * vn * nx;
    rvy -= (1 + e) * vn * ny;
    // A little grip on the rail.
    const vt = rvx * -ny + rvy * nx;
    rvx -= vt * 0.05 * -ny;
    rvy -= vt * 0.05 * nx;
    this.vx = rvx + ovx;
    this.vy = rvy + ovy;
    return -vn;
  }

  private collideStatic(): void {
    const caps = this.c.capsules;
    const x = this.x;
    const y = this.y;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < caps.length; i++) {
        const cap = caps[i]!;
        if (x + BALL_R < cap.minX || x - BALL_R > cap.maxX || y + BALL_R < cap.minY || y - BALL_R > cap.maxY) continue;
        const abx = cap.bx - cap.ax;
        const aby = cap.by - cap.ay;
        const len2 = abx * abx + aby * aby;
        let t = len2 > 0 ? ((this.x - cap.ax) * abx + (this.y - cap.ay) * aby) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const e = cap.kind === "bumper" ? BUMPER_E : cap.kind === "block" ? BLOCK_E : WALL_E;
        const hit = this.contact(cap.ax + abx * t, cap.ay + aby * t, cap.r, e, 0, 0);
        if (hit <= 0) continue;
        if (pass === 0) this.stats.bounces++;
        if (cap.kind === "bumper") {
          if (hit > 0.4) {
            const nx = this.x - cap.ax;
            const ny = this.y - cap.ay;
            const n = Math.hypot(nx, ny) || 1;
            this.vx += (nx / n) * BUMPER_KICK;
            this.vy += (ny / n) * BUMPER_KICK;
            const s = Math.hypot(this.vx, this.vy);
            const cap2 = MAX_SPEED * 1.05;
            if (s > cap2) {
              this.vx *= cap2 / s;
              this.vy *= cap2 / s;
            }
          }
          this.events.push({ type: "bumper", index: cap.index, speed: hit });
        } else this.events.push({ type: "wall", speed: hit });
      }
    }
  }

  /** Spinners, sliders and the windmill gate at the current time. Returns the strongest impact (or ≤ 0). */
  private collideMoving(countBounce: boolean): number {
    const hole = this.c.hole;
    const t = this.time;
    let best = -1;
    const note = (hit: number) => {
      if (hit <= 0) return;
      best = Math.max(best, hit);
      if (countBounce) this.stats.bounces++;
      this.events.push({ type: "obstacle", speed: hit });
    };
    for (const s of hole.spinners ?? []) {
      const reach = s.length + BALL_R + SPINNER_ARM;
      if (Math.abs(this.x - s.x) > reach || Math.abs(this.y - s.y) > reach) continue;
      note(this.contact(s.x, s.y, SPINNER_HUB, 0.6, 0, 0));
      const a0 = spinnerAngle(s, t);
      for (let k = 0; k < s.arms; k++) {
        const a = a0 + (k * 2 * Math.PI) / s.arms;
        const ex = Math.cos(a) * s.length;
        const ey = Math.sin(a) * s.length;
        let u = ((this.x - s.x) * ex + (this.y - s.y) * ey) / (s.length * s.length);
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = s.x + ex * u;
        const qy = s.y + ey * u;
        // Surface velocity of the arm at the contact: ω × r.
        note(this.contact(qx, qy, SPINNER_ARM, 0.6, -s.speed * (qy - s.y), s.speed * (qx - s.x)));
      }
    }
    for (const s of hole.sliders ?? []) {
      const p = sliderState(s, t);
      const qx = Math.max(p.x - s.hw, Math.min(p.x + s.hw, this.x));
      const qy = Math.max(p.y - s.hh, Math.min(p.y + s.hh, this.y));
      if (qx === this.x && qy === this.y) {
        // Centre inside the block (it slid onto the ball): pop out the nearest side.
        const l = this.x - (p.x - s.hw);
        const r = p.x + s.hw - this.x;
        const b = this.y - (p.y - s.hh);
        const tp = p.y + s.hh - this.y;
        const m = Math.min(l, r, b, tp);
        if (m === l) this.x = p.x - s.hw - BALL_R;
        else if (m === r) this.x = p.x + s.hw + BALL_R;
        else if (m === b) this.y = p.y - s.hh - BALL_R;
        else this.y = p.y + s.hh + BALL_R;
        this.vx = p.vx * 1.6;
        this.vy = p.vy * 1.6;
        note(Math.hypot(p.vx, p.vy) + 0.01);
        continue;
      }
      note(this.contact(qx, qy, 0.02, 0.6, p.vx, p.vy));
    }
    const w = hole.windmill;
    if (w && gateClosed(w, t)) {
      const gy = w.y0 - 0.06;
      // One-sided: only stops balls still in front of the mouth.
      if (this.y < gy && Math.abs(this.x - w.x) < w.tunnel / 2 + BALL_R) {
        const qx = Math.max(w.x - w.tunnel / 2, Math.min(w.x + w.tunnel / 2, this.x));
        note(this.contact(qx, gy, 0.05, 0.55, 0, 0));
      }
    }
    return best;
  }
}

/* ------------------------------------------------------------------ */
/* Whole shots                                                        */
/* ------------------------------------------------------------------ */

export interface ShotResult {
  status: "rest" | "holed" | "water";
  x: number;
  y: number;
  ticks: number;
  stats: ShotStats;
  /** Where a splash happened. */
  splash: { x: number; y: number } | null;
}

/** Plays a shot to the end, as fast as possible. */
export function simulateShot(
  course: CompiledHole,
  from: { x: number; y: number },
  angle: number,
  power: number,
  tick = 0,
): ShotResult {
  const sim = new Sim(course, from.x, from.y, tick);
  sim.shoot(angle, power);
  return runToEnd(sim);
}

export function runToEnd(sim: Sim): ShotResult {
  let splash: { x: number; y: number } | null = null;
  while (sim.moving) {
    sim.step();
    if (sim.events.length > 64) sim.events.length = 0;
  }
  if (sim.status === "water") splash = { x: sim.x, y: sim.y };
  const status = sim.status === "holed" || sim.status === "water" ? sim.status : "rest";
  return { status, x: sim.x, y: sim.y, ticks: sim.shotTicks, stats: { ...sim.stats }, splash };
}
