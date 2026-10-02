/**
 * Arcade ship handling in track space. A ship keeps a heading (`fwd`) and a
 * travel direction (`vdir`) on the road surface plus a scalar speed; grip pulls
 * the travel direction toward the heading (low grip while drifting makes the
 * slide). Each step moves along the surface and re-locates the ship in track
 * coordinates (s, d), so hills, banked turns, loops and upside-down stretches
 * all just work. Height `h` above the surface is only non-zero in the air.
 *
 * Fixed 60 Hz steps. Plain TypeScript + three's Vector3; deterministic for the
 * same inputs.
 */

import { Vector3 } from "three";
import {
  PAD_LENGTH,
  RAMP_LENGTH,
  deltaS,
  frameAt,
  hasFloor,
  hasWall,
  locate,
  newFrame,
  wrapS,
  type CompiledTrack,
  type Frame,
} from "./track";
import type { ShipStats } from "./types";

export const HZ = 60;
/** Height of a ramp's lip. */
export const RAMP_HEIGHT = 1.4;

/** Surface height of any ramp under (s, d): ships drive up the slope before launching. */
export function rampHeight(track: CompiledTrack, s: number, d: number): number {
  for (const ramp of track.ramps) {
    const into = deltaS(ramp.s - RAMP_LENGTH, s, track.length);
    if (into >= 0 && into <= RAMP_LENGTH) {
      const i = Math.floor(wrapS(s, track.length) / track.step) % track.count;
      if (Math.abs(d) <= track.wall[i]! + 0.5) return (into / RAMP_LENGTH) * RAMP_HEIGHT;
    }
  }
  return 0;
}
export const DT = 1 / HZ;
export const SHIP_RADIUS = 1.7;
const GRAVITY = 44;

export interface Controls {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
}

export const NO_CONTROLS: Controls = { steer: 0, throttle: 0, brake: 0, drift: false };

export type ShipState = "drive" | "spin" | "fall" | "tow" | "warp";

export type PhysEvent =
  | { type: "wall"; strength: number; side: -1 | 1 }
  | { type: "pad" }
  | { type: "ramp" }
  | { type: "land"; strength: number; trick: boolean }
  | { type: "driftStart" }
  | { type: "turbo"; tier: 1 | 2 | 3 }
  | { type: "tier"; tier: 1 | 2 | 3 }
  | { type: "fall" }
  | { type: "respawn" }
  | { type: "chargeJump" };

export interface Tuning {
  top: number;
  accel: number;
  turn: number;
  weight: number;
}

export function tuningFor(stats: ShipStats): Tuning {
  return {
    top: 60 + stats.speed * 4.4,
    accel: 0.5 + stats.accel * 0.13,
    turn: 1.5 + stats.handling * 0.13,
    weight: 0.7 + stats.weight * 0.15,
  };
}

/** Drift charge needed for each mini-turbo tier (seconds of drifting, faster when steering into it). */
export const DRIFT_TIERS = [0.75, 1.55, 2.5] as const;
const TURBO_TIME = [0, 0.55, 1.0, 1.5] as const;
/** Drift yaw (x turn rate) when steering fully out of, neutral in and fully into the drift. */
const DRIFT_ARC = { wide: 0, neutral: 0.65, tight: 1.5 } as const;
/** Largest angle (radians) between the travel direction and the nose while drifting. */
const DRIFT_MAX_SLIP = 0.42;
/** How far (radians) a drift may turn the nose across the road before its yaw fades out. */
const DRIFT_MAX_ACROSS = 0.95;
/**
 * Edge awareness while drifting: near the outer edge of the road the outward slide is eased so the ship
 * closes the remaining room over about this many seconds instead of running onto the shoulder or the rail.
 */
const DRIFT_EDGE_TIME = 0.08;
/** How much further (sine of the angle) than the travel the nose may point at a near edge while drifting. */
const DRIFT_EDGE_NOSE = 0.25;
/** Steering out at least this hard (fraction of full lock) lets a drift run off an open edge. */
const DRIFT_EDGE_OPT_OUT = 0.95;
/** Most speed (fraction) one drifting rail contact can cost, however long it lasts. */
const DRIFT_RAIL_MAX_LOSS = 0.08;
/** Seconds clear of the rail before the next touch counts as a new contact. */
const DRIFT_RAIL_RESET = 0.4;
/** Lateral push-off (m/s) after a drifting rail touch, fading out over DRIFT_PUSH_TIME. */
const DRIFT_PUSH_SPEED = 5;
const DRIFT_PUSH_TIME = 0.25;

export class Ship {
  readonly track: CompiledTrack;
  tune: Tuning;
  s = 0;
  d = 0;
  h = 0;
  vh = 0;
  speed = 0;
  readonly fwd = new Vector3(0, 0, -1);
  readonly vdir = new Vector3(0, 0, -1);
  readonly pos = new Vector3();
  readonly frame: Frame = newFrame();
  state: ShipState = "drive";
  stateLeft = 0;
  /** Seconds of boost left and its strength (1 = normal boost). */
  boost = 0;
  boostPower = 1;
  /** Seconds of invulnerability (after respawn, while warping). */
  invuln = 0;
  shield = 0;
  cloak = 0;
  /** Shrunk by an EMP: slower and flattened until this runs out. */
  shocked = 0;
  coins = 0;
  driftDir: -1 | 0 | 1 = 0;
  driftCharge = 0;
  driftTier: 0 | 1 | 2 | 3 = 0;
  airborne = false;
  /** Trick spin progress (0 none, then 0..1 while spinning). */
  trick = 0;
  private trickQueued = false;
  private driftHeld = false;
  /** Seconds drift has been held going straight (charge jump). */
  charge = 0;
  offroad = false;
  /** Visual spin angle (spin-outs) and lean. */
  spinAngle = 0;
  lean = 0;
  steerVis = 0;
  /** Last safe spot for tow-backs. */
  safeS = 0;
  private fallDir = 0;
  events: PhysEvent[] = [];
  /** Side of the rail the ship is pressed against this step (0 = clear). */
  railContact: -1 | 0 | 1 = 0;
  /** Seconds the edge assist has been holding a drift off the edge (riding it builds no charge). */
  driftPinned = 0;
  /** Speed fraction the current drifting rail contact has cost so far, and seconds since it last touched. */
  private railLoss = 0;
  private railClear = DRIFT_RAIL_RESET;
  /** Seconds of near-continuous rail contact (grinding along a rail builds no drift charge). */
  private railScrape = 0;
  /** Push-off away from the rail after a drifting touch: seconds left and the rail's side. */
  private pushOff = 0;
  private pushSide: -1 | 1 = 1;
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly surf = new Vector3();

  constructor(track: CompiledTrack, tune: Tuning, s: number, d: number) {
    this.track = track;
    this.tune = tune;
    this.place(s, d);
  }

  place(s: number, d: number): void {
    this.s = wrapS(s, this.track.length);
    this.d = d;
    this.h = 0;
    this.vh = 0;
    this.safeS = this.s;
    frameAt(this.track, this.s, this.frame);
    this.fwd.copy(this.frame.fwd);
    this.vdir.copy(this.frame.fwd);
    this.updatePos();
  }

  get grounded(): boolean {
    return !this.airborne && (this.state === "drive" || this.state === "spin" || this.state === "warp");
  }

  get topSpeed(): number {
    let top = this.tune.top * (1 + Math.min(10, this.coins) * 0.008);
    if (this.shocked > 0) top *= 0.62;
    if (this.boost > 0) top *= 1 + 0.3 * this.boostPower;
    else if (this.offroad) top *= 0.52;
    return top;
  }

  /** Relative heading vs the road (radians, + = pointing right of the road). */
  get headingError(): number {
    return Math.atan2(this.fwd.dot(this.frame.right), this.fwd.dot(this.frame.fwd));
  }

  addBoost(seconds: number, power = 1): void {
    this.boost = Math.max(this.boost, seconds);
    this.boostPower = Math.max(power, this.boost > 0 ? this.boostPower : 0);
    this.speed = Math.max(this.speed, Math.min(this.topSpeed, this.speed + 12 * power));
  }

  /** Knock the ship into a spin. Returns false when a shield, warp or invulnerability soaked it. */
  hit(kind: "spin" | "blast" | "bump", seconds = 1.1): boolean {
    if (this.state === "warp" || this.invuln > 0 || this.state === "fall" || this.state === "tow") return false;
    if (this.shield > 0 && kind !== "bump") {
      this.shield = 0;
      return false;
    }
    this.state = "spin";
    this.stateLeft = seconds;
    this.boost = 0;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    if (kind === "blast") {
      this.vh = 11 * this.track.def.gravity ** 0.5;
      this.airborne = true;
      this.speed *= 0.35;
    } else {
      this.speed *= 0.7;
    }
    return true;
  }

  startWarp(seconds: number): void {
    this.state = "warp";
    this.stateLeft = seconds;
    this.invuln = Math.max(this.invuln, seconds + 0.5);
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
  }

  /** Queue a trick (drift pressed in the air after a ramp). */
  tryTrick(): void {
    if (this.airborne && this.trick === 0 && this.vh > -2) this.trickQueued = true;
  }

  step(c: Controls): void {
    const dt = DT;
    this.events.length = 0;
    this.railContact = 0;
    this.railClear += DT;
    if (this.railClear > 0.3) this.railScrape = 0;
    const track = this.track;
    const F = frameAt(track, this.s, this.frame);
    this.invuln = Math.max(0, this.invuln - dt);
    this.shield = Math.max(0, this.shield - dt);
    this.cloak = Math.max(0, this.cloak - dt);
    this.shocked = Math.max(0, this.shocked - dt);
    this.boost = Math.max(0, this.boost - dt);

    if (this.state === "fall") return this.stepFall(dt);
    if (this.state === "tow") return this.stepTow(dt);

    let steer = Math.max(-1, Math.min(1, c.steer));
    let throttle = c.throttle;
    let brake = c.brake;
    if (this.state === "spin") {
      this.stateLeft -= dt;
      this.spinAngle += dt * 13 * Math.max(0.2, this.stateLeft);
      steer = 0;
      throttle = 0;
      brake = 0;
      if (this.stateLeft <= 0) {
        this.state = "drive";
        this.spinAngle = 0;
        this.invuln = Math.max(this.invuln, 0.6);
      }
    }
    if (this.state === "warp") {
      this.stateLeft -= dt;
      throttle = 1;
      brake = 0;
      if (this.stateLeft <= 0) {
        this.state = "drive";
        this.addBoost(0.6);
      }
    }

    const top = this.state === "warp" ? this.tune.top * 1.75 : this.topSpeed;
    const hw = F.halfWidth;
    this.offroad = !this.airborne && Math.abs(this.d) > hw + 0.4 && this.boost <= 0 && this.state !== "warp";

    /* Drift */
    const grounded = !this.airborne;
    if (c.drift && !this.driftHeld) {
      if (this.airborne) this.tryTrick();
      else if (this.state === "drive" && this.speed > 22 && Math.abs(steer) > 0.25) {
        this.driftDir = steer > 0 ? 1 : -1;
        this.driftCharge = 0;
        this.driftTier = 0;
        this.vh = 4.5;
        this.airborne = true;
        this.events.push({ type: "driftStart" });
      }
    }
    // Pressing drift then steering right after also starts a drift (hop first, steer on landing).
    if (c.drift && this.driftDir === 0 && grounded && this.state === "drive" && this.speed > 22 && Math.abs(steer) > 0.5 && this.driftHeld) {
      this.driftDir = steer > 0 ? 1 : -1;
      this.driftCharge = 0;
      this.driftTier = 0;
      this.events.push({ type: "driftStart" });
    }
    // Charge jump: hold drift while going straight, release for a big hop (trick it for a boost).
    if (c.drift && this.driftDir === 0 && grounded && this.state === "drive" && Math.abs(steer) < 0.3) this.charge += dt;
    else if (!c.drift && this.charge > 0.55 && grounded && this.state === "drive") {
      this.vh = 13 * Math.sqrt(track.def.gravity);
      this.airborne = true;
      this.charge = 0;
      this.events.push({ type: "chargeJump" });
    } else if (!c.drift || this.driftDir !== 0) this.charge = 0;
    this.driftHeld = c.drift;
    if (this.driftDir !== 0 && (!c.drift || this.speed < 16 || this.state !== "drive")) {
      if (!c.drift && this.driftTier > 0 && this.state === "drive") {
        const tier = this.driftTier as 1 | 2 | 3;
        this.addBoost(TURBO_TIME[tier], 0.8 + tier * 0.1);
        this.events.push({ type: "turbo", tier });
      }
      this.driftDir = 0;
      this.driftCharge = 0;
      this.driftTier = 0;
    }

    /* Yaw */
    const speedFrac = Math.min(1, Math.abs(this.speed) / this.tune.top);
    let yawRate: number;
    if (this.state === "warp") {
      // Autopilot: follow the racing line.
      const aheadS = this.s + 26;
      const target = track.line[Math.floor(wrapS(aheadS, track.length) / track.step) % track.count]! * hw * 0.6;
      const err = Math.atan2(target - this.d, 26) - this.headingError;
      yawRate = Math.max(-3, Math.min(3, err * 5));
    } else if (this.driftDir !== 0) {
      // Steering into the drift tightens the arc a lot; steering out opens it right up (full opposite lock holds the heading).
      const into = steer * this.driftDir;
      let arc = into >= 0 ? DRIFT_ARC.neutral + (DRIFT_ARC.tight - DRIFT_ARC.neutral) * into : DRIFT_ARC.neutral + (DRIFT_ARC.neutral - DRIFT_ARC.wide) * into;
      // Never let a held drift swing the nose round past side-on to the road.
      const across = this.headingError * this.driftDir;
      if (across > DRIFT_MAX_ACROSS) arc *= Math.max(0, 1 - (across - DRIFT_MAX_ACROSS) / 0.5);
      yawRate = this.driftDir * this.tune.turn * arc;
      if (grounded) {
        // Riding the edge on the assist is safe but builds nothing (and bleeds a little): the boost goes to
        // whoever steers the line.
        if (this.driftPinned > 0.15 || this.railScrape > 0.4) this.driftCharge = Math.max(0, this.driftCharge - dt * 0.35);
        else this.driftCharge += dt * (0.75 + 0.55 * Math.max(0, into));
        const tier = this.driftCharge >= DRIFT_TIERS[2] ? 3 : this.driftCharge >= DRIFT_TIERS[1] ? 2 : this.driftCharge >= DRIFT_TIERS[0] ? 1 : 0;
        if (tier > this.driftTier) {
          this.driftTier = tier;
          this.events.push({ type: "tier", tier: tier as 1 | 2 | 3 });
        }
      }
    } else {
      const agility = speedFrac < 0.15 ? speedFrac / 0.15 : 1 - 0.28 * (speedFrac - 0.15);
      yawRate = steer * this.tune.turn * agility * (this.speed < 0 ? -1 : 1);
      if (this.airborne) yawRate *= 0.6;
    }
    this.fwd.applyAxisAngle(F.up, -yawRate * dt);

    /* Speed */
    if (throttle > 0 || this.state === "warp") {
      const k = this.boost > 0 || this.state === "warp" ? 3 : this.tune.accel;
      if (this.speed < top) this.speed += (top - this.speed) * k * dt * Math.max(throttle, this.state === "warp" ? 1 : 0) + 4 * dt;
      else this.speed += (top - this.speed) * 1.6 * dt;
    } else if (brake > 0) {
      this.speed -= (this.speed > 0 ? 55 : 18) * brake * dt;
      this.speed = Math.max(this.speed, -18);
    } else {
      this.speed -= this.speed * 0.7 * dt;
      if (Math.abs(this.speed) < 0.3) this.speed = 0;
    }
    if (this.speed > top) this.speed += (top - this.speed) * 1.5 * dt;
    if (this.driftDir !== 0) this.speed -= this.speed * 0.035 * dt;

    /* Grip: travel direction follows heading */
    const grip = this.state === "spin" ? 1.2 : this.driftDir !== 0 ? 4.2 : this.airborne ? 1.5 : 9;
    const g = 1 - Math.exp(-grip * dt);
    const dirSign = this.speed < 0 ? -1 : 1;
    this.tmp.copy(this.fwd).multiplyScalar(dirSign);
    this.vdir.lerp(this.tmp, g).normalize();
    if (this.driftDir !== 0) {
      // Bounded outward slip: the slide never runs more than DRIFT_MAX_SLIP off the nose.
      const slip = this.vdir.angleTo(this.tmp);
      if (slip > DRIFT_MAX_SLIP) this.vdir.lerp(this.tmp, 1 - DRIFT_MAX_SLIP / slip).normalize();
      this.driftPinned = this.keepDriftInside(F, steer) ? this.driftPinned + dt : 0;
    }

    /* Move along the surface */
    this.surf.copy(F.pos).addScaledVector(F.right, this.d).addScaledVector(this.vdir, Math.abs(this.speed) * dt);
    if (this.pushOff > 0) {
      this.surf.addScaledVector(F.right, -this.pushSide * DRIFT_PUSH_SPEED * (this.pushOff / DRIFT_PUSH_TIME) * dt);
      this.pushOff = this.driftDir !== 0 ? Math.max(0, this.pushOff - dt) : 0;
    }
    const prevS = this.s;
    const prevD = this.d;
    const loc = locate(track, this.surf, this.s, 12);
    this.s = loc.s;
    this.d = loc.d;
    const F2 = frameAt(track, this.s, this.frame);
    this.fwd.addScaledVector(F2.up, -this.fwd.dot(F2.up)).normalize();
    this.vdir.addScaledVector(F2.up, -this.vdir.dot(F2.up)).normalize();

    /* Vertical */
    if (this.airborne) {
      this.vh -= GRAVITY * track.def.gravity * dt;
      this.h += this.vh * dt;
      if (this.trickQueued) {
        this.trick = 0.001;
        this.trickQueued = false;
      }
      if (this.trick > 0) this.trick = Math.min(1, this.trick + dt * 2.4);
      if (this.h <= 0) {
        const onFloor = hasFloor(track, this.s) && Math.abs(this.d) <= F2.wallOffset + 0.5;
        if (onFloor) {
          const strength = Math.min(1, -this.vh / 18);
          const trick = this.trick >= 0.999;
          this.h = 0;
          this.vh = 0;
          this.airborne = false;
          if (this.trick > 0) {
            if (trick) this.addBoost(0.75, 0.9);
            else this.spinAngle = 0;
          }
          this.trick = 0;
          this.events.push({ type: "land", strength, trick });
        } else if (this.h < -2.5) {
          this.startFall();
        }
      }
    } else {
      this.h = rampHeight(track, this.s, this.d);
      if (!hasFloor(track, this.s)) {
        this.airborne = true;
        this.vh = -2;
      }
    }

    /* Walls and edges */
    // A ship turned across the road reaches further sideways, so it stops further from the rail.
    const sideways = Math.abs(this.fwd.dot(F2.right));
    const wallOff = F2.wallOffset - SHIP_RADIUS * (0.6 + 0.5 * sideways);
    if (Math.abs(this.d) > wallOff) {
      const side: -1 | 1 = this.d > 0 ? 1 : -1;
      // Rails stop anything that was inside them: low ships always, high flyers too unless they were already out.
      const wasInside = Math.abs(prevD) <= F2.wallOffset + 0.5;
      if (hasWall(track, this.s, side) && (this.h < 3 || wasInside)) {
        this.d = side * wallOff;
        this.railContact = side;
        // A touch after a clear spell is a new contact; scraping on (or bouncing off and back) is the same one.
        const fresh = this.railClear >= DRIFT_RAIL_RESET;
        this.railClear = 0;
        this.railScrape += DT;
        const into = this.vdir.dot(F2.right) * side;
        if (into > 0) {
          const strength = into * Math.abs(this.speed);
          const fInto = this.fwd.dot(F2.right) * side;
          if (this.driftDir !== 0) {
            // Drifting along the rail: slide off it softly and keep the drift (and the charge).
            this.vdir.addScaledVector(F2.right, -side * (into + 0.06)).normalize();
            if (fInto > 0) this.fwd.addScaledVector(F2.right, -side * fInto * 0.35).normalize();
            // The cost follows the impact (the speed going into the rail), so grazing it is nearly free, and one
            // contact costs at most DRIFT_RAIL_MAX_LOSS however long the ship scrapes along.
            if (fresh) {
              this.railLoss = 0;
              // Clipping the rail mid-drift knocks the mini-turbo back down a step.
              this.driftCharge = Math.max(0, this.driftCharge - 0.6);
              this.driftTier = this.driftCharge >= DRIFT_TIERS[2] ? 3 : this.driftCharge >= DRIFT_TIERS[1] ? 2 : this.driftCharge >= DRIFT_TIERS[0] ? 1 : 0;
            }
            const cost = Math.min(0.25, into * into * 0.8 + into * 0.04) / Math.max(0.8, this.tune.weight);
            const paid = Math.min(cost, Math.max(0, DRIFT_RAIL_MAX_LOSS - this.railLoss));
            this.speed *= 1 - paid;
            this.railLoss += paid;
            // A short push away from the rail so a held drift comes off it rather than scraping along.
            this.pushOff = DRIFT_PUSH_TIME;
            this.pushSide = side;
          } else {
            this.vdir.addScaledVector(F2.right, -side * into * 1.35).normalize();
            if (fInto > 0) this.fwd.addScaledVector(F2.right, -side * fInto * 0.9).normalize();
            // Glancing scrapes cost little; head-on hits cost a lot.
            this.speed *= 1 - Math.min(0.45, into * 0.6) / Math.max(0.8, this.tune.weight);
          }
          if (strength > 4 && (fresh || this.driftDir === 0)) this.events.push({ type: "wall", strength: Math.min(1, strength / 40), side });
        }
      } else if (!hasWall(track, this.s, side) && Math.abs(this.d) > F2.wallOffset + 2.4 && !this.airborne) {
        this.airborne = true;
        this.vh = -1;
      }
    }

    /* Pads and ramps (crossing checks) */
    const moved = deltaS(prevS, this.s, track.length);
    if (moved > 0 && this.h < 1.6) {
      for (const pad of track.boostPads) {
        const a = deltaS(pad.s - PAD_LENGTH / 2, prevS, track.length);
        const b = deltaS(pad.s - PAD_LENGTH / 2, this.s, track.length);
        if (a <= 0 && b > 0 && b < PAD_LENGTH + 3 && Math.abs(this.d - pad.d * hw) < 4.2) {
          this.addBoost(1.1, 1.1);
          this.events.push({ type: "pad" });
        }
      }
      for (const ramp of track.ramps) {
        const a = deltaS(ramp.s, prevS, track.length);
        const b = deltaS(ramp.s, this.s, track.length);
        if (a < 0 && b >= 0 && b < 6 && Math.abs(this.d) < F2.wallOffset + 0.5) {
          // Ramps have launch boosters: even a slow ship clears the gap.
          this.speed = Math.max(this.speed, this.tune.top * 0.85);
          const f = Math.max(0.85, Math.min(1.1, this.speed / this.tune.top));
          this.vh = Math.max(this.vh, ramp.lift * f * Math.sqrt(track.def.gravity));
          this.airborne = true;
          if (ramp.boost) this.addBoost(0.4, 0.8);
          this.events.push({ type: "ramp" });
        }
        void RAMP_LENGTH;
      }
    }

    if (!this.airborne && hasFloor(track, this.s) && Math.abs(this.d) < hw && this.state === "drive") this.safeS = this.s;

    /* Visual lean */
    const targetLean = this.driftDir !== 0 ? this.driftDir * 0.42 : steer * 0.28 * speedFrac;
    this.lean += (targetLean - this.lean) * (1 - Math.exp(-8 * dt));
    this.steerVis += (steer - this.steerVis) * (1 - Math.exp(-10 * dt));
    this.updatePos();
  }

  /**
   * A held drift slides wide, but it shouldn't glue the ship to the outer rail, park it on the shoulder
   * (where the offroad drag holds it near half speed) or carry it off an open edge. Near the outer edge of
   * the road the outward part of the slide is eased in proportion to the room left, so the travel
   * direction (and the nose, if it points further out) comes round to the road's tangent before the edge.
   * Open edges only get this help while the player isn't steering at them at full lock.
   */
  /** Returns whether it had to hold the drift off the edge this step. */
  private keepDriftInside(F: Frame, steer: number): boolean {
    const speed = Math.abs(this.speed);
    if (speed < 1 || this.h > 3) return false;
    // The edge on the ship's side of the road: the outer one while sliding wide, the inner one once a held
    // drift has turned the ship across a straightening road.
    const side: -1 | 1 = this.d < 0 ? -1 : 1;
    // Steering at it at full lock opts out: open edges stay deadly, and a drift can still be driven into
    // the inner rail on purpose. The outer rail always eases the slide.
    if (steer * side >= DRIFT_EDGE_OPT_OUT && (side === this.driftDir || !hasWall(this.track, this.s, side))) return false;
    const sideways = Math.abs(this.fwd.dot(F.right));
    const wallOff = F.wallOffset - SHIP_RADIUS * (0.6 + 0.5 * sideways);
    const edge = Math.min(F.halfWidth + 0.3, wallOff - 0.3);
    const room = edge - this.d * side;
    // Outward lateral share of the travel the remaining room allows; on the shoulder already, ease back in.
    const allowed = Math.max(-0.12, room / (speed * DRIFT_EDGE_TIME));
    if (allowed >= 1) return false;
    const out = this.vdir.dot(F.right) * side;
    const pinned = out > allowed && room < 1.2;
    if (out > allowed) {
      const along = this.vdir.dot(F.fwd) < 0 ? -1 : 1;
      this.vdir.copy(F.fwd).multiplyScalar(along * Math.sqrt(1 - allowed * allowed)).addScaledVector(F.right, side * allowed);
    }
    // Ease the arc too: the nose may point at the edge only a little more than the room allows.
    const noseOut = this.fwd.dot(F.right) * side;
    if (noseOut > allowed + DRIFT_EDGE_NOSE && this.fwd.dot(F.fwd) > 0) {
      const n = Math.min(1, allowed + DRIFT_EDGE_NOSE);
      this.fwd.copy(F.fwd).multiplyScalar(Math.sqrt(1 - n * n)).addScaledVector(F.right, side * n);
    }
    return pinned;
  }

  private startFall(): void {
    this.state = "fall";
    this.stateLeft = 1.1;
    this.fallDir = Math.sign(this.d) || 1;
    this.driftDir = 0;
    this.driftCharge = 0;
    this.driftTier = 0;
    this.boost = 0;
    this.events.push({ type: "fall" });
  }

  private stepFall(dt: number): void {
    this.stateLeft -= dt;
    this.vh -= GRAVITY * 0.6 * dt;
    this.h += this.vh * dt;
    this.speed *= Math.exp(-0.8 * dt);
    this.d += this.fallDir * 4 * dt;
    this.spinAngle += dt * 2;
    frameAt(this.track, this.s, this.frame);
    this.updatePos();
    if (this.stateLeft <= 0) {
      this.state = "tow";
      this.stateLeft = 1.3;
      this.place(this.safeS, 0);
      this.h = 9;
      this.speed = 0;
      this.spinAngle = 0;
      this.updatePos();
    }
  }

  private stepTow(dt: number): void {
    this.stateLeft -= dt;
    this.h = Math.max(0, 9 * (this.stateLeft / 1.3) ** 2);
    this.updatePos();
    if (this.stateLeft <= 0) {
      this.state = "drive";
      this.h = 0;
      this.airborne = false;
      this.invuln = 1.5;
      this.events.push({ type: "respawn" });
    }
  }

  updatePos(): void {
    const F = this.frame;
    this.pos.copy(F.pos).addScaledVector(F.right, this.d).addScaledVector(F.up, this.h);
    void this.tmp2;
  }
}

/** Bumps two overlapping ships apart in track space. Returns the impact strength (0 when apart). */
export function collideShips(a: Ship, b: Ship): number {
  if (a.state === "fall" || a.state === "tow" || b.state === "fall" || b.state === "tow") return 0;
  if (Math.abs(a.h - b.h) > 2.2) return 0;
  const ds = deltaS(a.s, b.s, a.track.length);
  if (Math.abs(ds) > SHIP_RADIUS * 2.2) return 0;
  const dd = b.d - a.d;
  const dist = Math.hypot(ds * 0.8, dd);
  const min = SHIP_RADIUS * 1.55;
  if (dist >= min) return 0;
  const wa = a.state === "warp" ? 50 : a.tune.weight;
  const wb = b.state === "warp" ? 50 : b.tune.weight;
  const overlap = min - dist;
  const nx = dist > 1e-4 ? dd / dist : a.d < b.d ? 1 : -1;
  const share = wb / (wa + wb);
  a.d -= nx * overlap * share;
  b.d += nx * overlap * (1 - share);
  const rel = Math.abs(a.speed - b.speed);
  // Rear ship loses a little, front ship gets nudged.
  const [back, front] = ds > 0 ? [a, b] : [b, a];
  if (Math.abs(ds) > 0.6) {
    const give = Math.min(8, rel * 0.35);
    back.speed -= give * 0.6;
    front.speed += give * 0.25;
  }
  // Heavier ship shoves the lighter one sideways.
  const push = Math.min(10, 3 + rel * 0.15);
  const side = nx;
  if (a.state !== "warp") a.vdir.addScaledVector(a.frame.right, -side * push * share * 0.03).normalize();
  if (b.state !== "warp") b.vdir.addScaledVector(b.frame.right, side * push * (1 - share) * 0.03).normalize();
  if (a.state === "warp" && b.state !== "warp") b.hit("spin", 0.9);
  if (b.state === "warp" && a.state !== "warp") a.hit("spin", 0.9);
  return Math.min(1, overlap / min + rel / 40);
}
