/**
 * Per-step gameplay systems, run by the match loop:
 * - `drive`: arcade vehicle model on a Rapier rigid body (throttle/brake
 *   toward a target speed, lateral tire grip, yaw-rate steering, downforce,
 *   boost, self-righting).
 * - `steerProxy`: remote trucks are dynamic bodies pulled toward their
 *   interpolated network pose, so local collisions still feel physical.
 * - `weapons`: spin-up, strokes, flame fuel and hit detection for trucks this
 *   client owns.
 * - `hazards`: saws, vents, the pulverizer and the pit, for owned trucks.
 */

import type { RapierRigidBody } from "@react-three/rapier";
import { Quaternion, Vector3 } from "three";
import {
  ARENA,
  ARMORS,
  BURN_DPS,
  FLAME_DPS,
  FLIPPER_DAMAGE,
  HAMMER_DAMAGE,
  INTERP_MS,
  PULVERIZER_DAMAGE,
  SAW_DPS,
  VENT_DPS,
  WEAPONS,
  clamp01,
  damp,
  inCone,
  pulverizerJustLanded,
  pulverizerLevel,
  ramDamage,
  sampleSnapshots,
  sawLevel,
  sphereHitsHull,
  spinnerDamage,
  topSpeed,
  ventState,
  type HazardLayout,
  type NetTruck,
} from "./logic";
import { FLAME_NOZZLES, WEAPON_ZONE } from "./truck";
import type { TruckRuntime, World } from "./world";
import type { Vfx } from "./vfx";
import type { ArenaAudio } from "./audio";

const _q = new Quaternion();
const _qi = new Quaternion();
const _fwd = new Vector3();
const _up = new Vector3();
const _side = new Vector3();
const _w = new Vector3();
const _p = new Vector3();
const _a = new Vector3();
const _net: NetTruck = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, vx: 0, vy: 0, vz: 0, hp: 0, armor: 0, weapon: 0, flags: 0, loadout: 0, dmg: 0 };

/** Body mass per armor kit (Rapier units). */
export function massFor(t: TruckRuntime): number {
  return ARMORS[t.loadout.armor].mass;
}

/** Refreshes a truck's cached kinematics from its body. */
export function readBody(t: TruckRuntime, body: RapierRigidBody): void {
  const p = body.translation();
  const r = body.rotation();
  const v = body.linvel();
  t.pos.set(p.x, p.y, p.z);
  t.quat.set(r.x, r.y, r.z, r.w);
  t.vel.set(v.x, v.y, v.z);
  _fwd.set(0, 0, 1).applyQuaternion(t.quat);
  _up.set(0, 1, 0).applyQuaternion(t.quat);
  t.yaw = Math.atan2(_fwd.x, _fwd.z);
  const flat = Math.hypot(_fwd.x, _fwd.z) || 1;
  t.speed = (v.x * _fwd.x + v.z * _fwd.z) / flat;
  t.flipped = _up.y < 0.35;
  _side.set(_fwd.z, 0, -_fwd.x).divideScalar(flat);
  t.slip = Math.abs(v.x * _side.x + v.z * _side.z);
}

/**
 * Drive one owned truck for one physics step. `grounded` comes from the
 * loop's downward ray (so this stays free of Rapier world queries).
 */
export function drive(t: TruckRuntime, body: RapierRigidBody, dt: number, grounded: boolean, time: number, world: World, audio: ArenaAudio | null): void {
  const mass = body.mass();
  const r = body.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);
  const flatLen = Math.hypot(_fwd.x, _fwd.z) || 1;
  const fx = _fwd.x / flatLen;
  const fz = _fwd.z / flatLen;
  const sx = fz;
  const sz = -fx;
  const lv = body.linvel();
  const av = body.angvel();
  const vF = lv.x * fx + lv.z * fz;
  const vS = lv.x * sx + lv.z * sz;
  const input = t.input;
  const alive = t.alive && world.phase === "fight";
  t.grounded = grounded;

  // Boost tank.
  const wantBoost = alive && input.boost && t.boost > 0.02 && input.throttle > 0.1;
  if (wantBoost && !t.boosting && t.isMe) audio?.play("boost", 0.8);
  t.boosting = wantBoost && (t.boosting || t.boost > 0.15);
  if (t.boosting) t.boost = Math.max(0, t.boost - dt / 2.4);
  else t.boost = Math.min(1, t.boost + dt / 7);

  const upright = _up.y > 0.55;
  if (grounded && upright && alive) {
    const top = topSpeed(t.loadout) * (t.boosting ? 1.5 : 1);
    let accel = 0;
    const throttle = input.throttle;
    if (Math.abs(throttle) > 0.02) {
      const target = throttle > 0 ? throttle * top : throttle * top * 0.55;
      const braking = Math.sign(throttle) !== Math.sign(vF) && Math.abs(vF) > 1;
      const maxA = t.boosting ? 30 : 19;
      accel = braking ? Math.sign(throttle) * 34 : Math.max(-maxA, Math.min(maxA, (target - vF) * 3.4));
    } else {
      accel = -vF * 1.6;
    }
    // Lateral grip (less while boosting through a turn → drifts + tire marks).
    const grip = t.boosting && Math.abs(input.steer) > 0.4 ? 5 : 12;
    const dvS = -vS * damp(grip, dt);
    body.applyImpulse({ x: (fx * accel * dt + sx * dvS) * mass, y: -Math.abs(vF) * 0.35 * dt * mass, z: (fz * accel * dt + sz * dvS) * mass }, true);

    // Yaw-rate steering (+steer = right = negative yaw rate).
    const speedFactor = Math.min(1, Math.abs(vF) / 5 + 0.3);
    const dir = vF < -0.5 ? -1 : 1;
    const rate = -input.steer * 2.8 * speedFactor * dir;
    const wy = av.y + (rate - av.y) * damp(12, dt);
    body.setAngvel({ x: av.x * 0.98, y: wy, z: av.z * 0.98 }, true);
  } else if (alive && !grounded && upright) {
    // A touch of air control.
    const wy = av.y + (-input.steer * 1.2 - av.y) * damp(2, dt);
    body.setAngvel({ x: av.x, y: wy, z: av.z }, true);
  }

  // Self-right when flipped or on its side.
  t.selfRightCd = Math.max(0, t.selfRightCd - dt * 1000);
  const tipped = _up.y < 0.5;
  if (alive && tipped && input.selfRight && t.selfRightCd <= 0) {
    t.selfRightCd = 3_500;
    _a.set(_up.z, 0, -_up.x); // axis = up × worldUp (rotates body up toward +Y)
    const len = _a.length() || 1;
    _a.divideScalar(len);
    if (_up.y < -0.9) _a.set(fx, 0, fz); // upside down: roll about the long axis
    body.applyImpulse({ x: 0, y: 7.5 * mass, z: 0 }, true);
    body.applyTorqueImpulse({ x: _a.x * 3.4 * mass, y: 0, z: _a.z * 3.4 * mass }, true);
    audio?.play("selfRight", t.isMe ? 1 : 0.6, t.pos.x, t.pos.z);
    void time;
  }
}

/**
 * Pulls a remote truck's proxy body toward the replicated pose at local time
 * `now` (drawn INTERP_MS in the past, extrapolated a little past the newest
 * packet). Teleports on a big error (spawn, respawn, lag spike).
 */
export function steerProxy(t: TruckRuntime, body: RapierRigidBody, now: number, dt: number): void {
  if (!t.hasNet || t.clockOffset === null) return;
  const senderT = now - t.clockOffset - INTERP_MS;
  if (!sampleSnapshots(t.snaps, senderT, _net)) return;
  const p = body.translation();
  const ex = _net.x - p.x;
  const ey = _net.y - p.y;
  const ez = _net.z - p.z;
  const err = Math.hypot(ex, ey, ez);
  _q.set(_net.qx, _net.qy, _net.qz, _net.qw);
  if (err > 3.5) {
    body.setTranslation({ x: _net.x, y: _net.y, z: _net.z }, true);
    body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    body.setLinvel({ x: _net.vx, y: _net.vy, z: _net.vz }, true);
    return;
  }
  const k = 12;
  const clampV = (v: number) => Math.max(-45, Math.min(45, v));
  body.setLinvel({ x: clampV(_net.vx + ex * k), y: clampV(_net.vy + ey * k), z: clampV(_net.vz + ez * k) }, true);
  const r = body.rotation();
  _qi.set(r.x, r.y, r.z, r.w).invert();
  const d = _q.clone().multiply(_qi);
  if (d.w < 0) d.set(-d.x, -d.y, -d.z, -d.w);
  const angle = 2 * Math.acos(Math.min(1, d.w));
  const s = Math.sqrt(1 - d.w * d.w);
  if (s > 1e-4) {
    const w = Math.min(20, (angle / Math.max(dt, 1 / 120)) * 0.35);
    body.setAngvel({ x: (d.x / s) * w, y: (d.y / s) * w, z: (d.z / s) * w }, true);
  } else body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

/** World-space point of a truck-space offset. */
function toWorld(t: TruckRuntime, x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(x, y, z).applyQuaternion(t.quat).add(t.pos);
}

export interface WeaponContext {
  world: World;
  vfx: Vfx | null;
  audio: ArenaAudio | null;
  now: number;
  dt: number;
  /** Match time (ms). */
  time: number;
}

/** Runs one owned truck's weapon for a frame: timers, animation and hits. */
export function weapons(t: TruckRuntime, ctx: WeaponContext): void {
  const { world, dt } = ctx;
  const spec = WEAPONS[t.loadout.weapon];
  const fighting = t.alive && world.phase === "fight";
  const dtMs = dt * 1000;
  t.cooldown = Math.max(0, t.cooldown - dtMs);
  const kind = t.loadout.weapon;
  const fx = Math.sin(t.yaw);
  const fz = Math.cos(t.yaw);

  if (kind === "spinner") {
    // `anim` doubles as "revving" time left (s).
    if (fighting && t.input.fire && t.cooldown <= 0 && t.anim <= 0) {
      t.anim = 1.9;
      ctx.audio?.play("boost", t.isMe ? 0.5 : 0.25, t.pos.x, t.pos.z);
    }
    const revving = t.anim > 0;
    if (revving) {
      t.anim = Math.max(0, t.anim - dt);
      if (t.anim <= 0) t.cooldown = spec.cooldownMs;
    }
    const target = !fighting ? 0 : revving ? 1 : 0.3;
    t.spin += (target - t.spin) * damp(revving ? 2.4 : 0.9, dt);
    if (fighting && t.spin > 0.2) {
      const z = WEAPON_ZONE.spinner;
      const c = toWorld(t, z.x, z.y, z.z, _p);
      for (const o of world.trucks) {
        if (o === t || !o.alive) continue;
        if (!sphereHitsHull(c.x, c.y, c.z, z.r, o.pos.x, o.pos.y, o.pos.z, o.yaw)) continue;
        if ((t.rehit.get(o.id) ?? 0) > ctx.time) continue;
        t.rehit.set(o.id, ctx.time + 450);
        const dmg = spinnerDamage(t.spin);
        const dx = o.pos.x - c.x;
        const dz = o.pos.z - c.z;
        const len = Math.hypot(dx, dz) || 1;
        const kick = 4 + 11 * t.spin;
        // Horizontal bar spinning clockwise (from above) flings to the side too.
        const tx = -dz / len;
        const tz = dx / len;
        world.dealHit(t, o, dmg, [(dx / len) * kick + tx * kick * 0.5, 2 + 6 * t.spin, (dz / len) * kick + tz * kick * 0.5], [c.x + (dx / len) * 0.9, c.y + 0.1, c.z + (dz / len) * 0.9], "spinner", ctx.now);
        // Energy dump + recoil.
        t.spin *= 0.3;
        if (revving) {
          t.anim = 0;
          t.cooldown = spec.cooldownMs;
        }
        world.hooks.impulse?.(t.id, -(dx / len) * 3, 0.6, -(dz / len) * 3, c.x, c.y, c.z);
        break;
      }
    }
    return;
  }

  if (kind === "flipper" || kind === "hammer") {
    // `animT` = seconds into the stroke (≥ 0 while it runs), `anim` = pose 0..1.
    if (fighting && t.input.fire && t.cooldown <= 0 && t.animT < 0) {
      t.animT = 0;
      t.strokeHit = false;
      t.cooldown = spec.cooldownMs;
      if (kind === "flipper") ctx.audio?.play("flip", t.isMe ? 1 : 0.6, t.pos.x, t.pos.z);
    }
    if (t.animT >= 0) {
      t.animT += dt;
      const s = t.animT;
      if (kind === "flipper") {
        t.anim = s < 0.1 ? s / 0.1 : s < 0.28 ? 1 : s < 0.8 ? 1 - (s - 0.28) / 0.52 : 0;
        if (!t.strokeHit && s <= 0.2 && fighting) {
          const z = WEAPON_ZONE.flipper;
          const c = toWorld(t, z.x, z.y, z.z, _p);
          for (const o of world.trucks) {
            if (o === t || !o.alive) continue;
            if (!sphereHitsHull(c.x, c.y, c.z, z.r, o.pos.x, o.pos.y, o.pos.z, o.yaw)) continue;
            t.strokeHit = true;
            // Launch: up + away, applied low on the near side so it tumbles.
            const px = o.pos.x - fx * 0.9;
            const pz = o.pos.z - fz * 0.9;
            world.dealHit(t, o, FLIPPER_DAMAGE, [fx * 4.5, 11.5, fz * 4.5], [px, o.pos.y - 0.25, pz], "flipper", ctx.now);
            t.flipTrack = { target: o.id, baseY: o.pos.y, peak: o.pos.y, until: ctx.time + 1_800 };
            world.hooks.impulse?.(t.id, -fx * 1.2, -2, -fz * 1.2, t.pos.x, t.pos.y, t.pos.z);
          }
        }
        if (s >= 0.8) t.animT = -1;
      } else {
        // Hammer: wind-up, strike, hold, recover.
        t.anim = s < 0.1 ? -s : s < 0.23 ? -0.1 + ((s - 0.1) / 0.13) * 1.1 : s < 0.45 ? 1 : s < 1.05 ? 1 - (s - 0.45) / 0.6 : 0;
        if (!t.strokeHit && s >= 0.22 && fighting) {
          t.strokeHit = true;
          const z = WEAPON_ZONE.hammer;
          const c = toWorld(t, z.x, z.y, z.z, _p);
          let hit = false;
          for (const o of world.trucks) {
            if (o === t || !o.alive) continue;
            if (!sphereHitsHull(c.x, c.y, c.z, z.r, o.pos.x, o.pos.y, o.pos.z, o.yaw)) continue;
            hit = true;
            world.dealHit(t, o, HAMMER_DAMAGE, [fx * 1.5, -3.5, fz * 1.5], [c.x, Math.max(c.y, o.pos.y + 0.4), c.z], "hammer", ctx.now);
          }
          if (!hit) {
            // Floor strike.
            const floorY = 0.05;
            ctx.vfx?.sparksAt(c.x, floorY, c.z, 0, 1, 0, 0.6);
            ctx.audio?.play("clang", t.isMe ? 0.9 : 0.5, c.x, c.z);
            if (t.isMe) world.addTrauma(0.18);
          }
        }
        if (s >= 1.05) t.animT = -1;
      }
    } else {
      t.anim = 0;
    }
    return;
  }

  // Flamethrower: hold to burn while there's fuel.
  const wasFiring = t.firing;
  const canStart = t.fuel > 0.22;
  t.firing = fighting && t.input.fire && t.fuel > 0.01 && (wasFiring || canStart);
  if (t.firing) {
    t.fuel = Math.max(0, t.fuel - dt / 3.2);
    t.cooldown = 400; // refill pause after letting go
    for (const o of world.trucks) {
      if (o === t || !o.alive) continue;
      if (!inCone(t.pos.x, t.pos.z, t.yaw, o.pos.x, o.pos.z, spec.range, 0.3)) continue;
      if (Math.abs(o.pos.y - t.pos.y) > 2) continue;
      const acc = (t.flameAcc.get(o.id) ?? 0) + FLAME_DPS * dt;
      if (acc >= 3) {
        t.flameAcc.set(o.id, 0);
        world.dealHit(t, o, acc, [fx * 0.6, 0.2, fz * 0.6], [o.pos.x - fx * 0.8, o.pos.y + 0.35, o.pos.z - fz * 0.8], "flamer", ctx.now);
      } else t.flameAcc.set(o.id, acc);
    }
  } else if (t.cooldown <= 0) {
    t.fuel = Math.min(1, t.fuel + dt / (spec.cooldownMs / 1000));
  }
  t.anim = t.fuel;
}

/** Visual-only weapon effects, for every truck (owned or remote). */
export function weaponFx(t: TruckRuntime, firing: boolean, vfx: Vfx, dt: number, time: number): void {
  if (t.loadout.weapon === "flamer" && firing && t.alive) {
    const fx = Math.sin(t.yaw);
    const fz = Math.cos(t.yaw);
    for (const n of FLAME_NOZZLES) {
      toWorld(t, n.x, n.y, n.z, _w);
      vfx.flame(_w.x, _w.y, _w.z, fx, 0.04, fz, t.vel.x, 0, t.vel.z, dt > 0.02 ? 3 : 2);
    }
    if (Math.random() < dt * 12) {
      const d = 3 + Math.random() * 2;
      vfx.smokeAt(t.pos.x + fx * d, t.pos.y + 0.5, t.pos.z + fz * d, 1, 0.7, 1.4, 0.6);
    }
  }
  void time;
}

/** Hazard timing + effects for everyone; damage only for trucks this client owns. */
export function hazards(world: World, layout: HazardLayout, ctx: { now: number; dt: number; vfx: Vfx | null; audio: ArenaAudio | null; prevT: number; t: number }): void {
  const { t, prevT, dt, vfx, audio, now } = ctx;
  const fighting = world.phase === "fight";
  // Saws.
  for (const s of layout.saws) {
    const level = sawLevel(t, s.phase);
    if (level <= 0.4) continue;
    for (const tr of world.trucks) {
      if (!tr.alive) continue;
      if (Math.abs(tr.pos.x - s.x) > 1.9 || Math.abs(tr.pos.z - s.z) > 1.3 || tr.pos.y > 2) continue;
      if (Math.random() < dt * 30) vfx?.sparksAt(s.x + (tr.pos.x - s.x) * 0.3, 0.5, s.z, (tr.pos.x - s.x) * 0.3, 0.9, (tr.pos.z - s.z) * 0.6, 0.35);
      if (Math.random() < dt * 8) audio?.play("saw", 0.8, s.x, s.z);
      if (!tr.local || !fighting) continue;
      const acc = (tr.flameAcc.get("_saw") ?? 0) + SAW_DPS * dt;
      if (acc >= 3) {
        tr.flameAcc.set("_saw", 0);
        const dx = tr.pos.x - s.x || 0.1;
        const dz = tr.pos.z - s.z || 0.1;
        const l = Math.hypot(dx, dz);
        world.applyHit(world.creditFor(tr, now), tr, acc, [(dx / l) * 2.5, 2.2, (dz / l) * 2.5], [s.x, 0.5, s.z], "saw", now);
      } else tr.flameAcc.set("_saw", acc);
    }
  }
  // Vents.
  for (const v of layout.vents) {
    const state = ventState(t, v.phase);
    if (state === "fire") {
      if (vfx) vfx.fireColumn(v.x, 0.1, v.z, 1.8, 7, dt > 0.02 ? 4 : 3, 0.55);
      if (ventState(prevT, v.phase) !== "fire") audio?.play("vent", 0.9, v.x, v.z);
      for (const tr of world.trucks) {
        if (!tr.alive || !tr.local || !fighting) continue;
        if (Math.abs(tr.pos.x - v.x) > 1.7 || Math.abs(tr.pos.z - v.z) > 1.7 || tr.pos.y > 3) continue;
        const acc = (tr.flameAcc.get("_vent") ?? 0) + VENT_DPS * dt;
        if (acc >= 3) {
          tr.flameAcc.set("_vent", 0);
          world.applyHit(world.creditFor(tr, now), tr, acc, [0, 1.2, 0], [tr.pos.x, 0.3, tr.pos.z], "vent", now);
        } else tr.flameAcc.set("_vent", acc);
      }
    } else if (state === "warn" && vfx && Math.random() < dt * 10) {
      vfx.smokeAt(v.x + (Math.random() - 0.5) * 2, 0.1, v.z + (Math.random() - 0.5) * 2, 1, 0.3, 1.5, 0.5);
    }
  }
  // Pulverizer.
  const pv = layout.pulverizer;
  if (pulverizerJustLanded(prevT, t, pv.phase)) {
    audio?.play("pulverizer", 1, pv.x, pv.z);
    if (vfx) {
      vfx.sparksAt(pv.x, 0.1, pv.z, 0, 1, 0, 1.2);
      for (let i = 0; i < 6; i++) vfx.dust(pv.x + (Math.random() - 0.5) * 4, pv.z + (Math.random() - 0.5) * 4, 2);
    }
    const watch = world.watching ? world.byId.get(world.watching) : undefined;
    if (watch && Math.hypot(watch.pos.x - pv.x, watch.pos.z - pv.z) < 12) world.addTrauma(0.35);
    for (const tr of world.trucks) {
      if (!tr.alive || !tr.local || !fighting) continue;
      if (Math.abs(tr.pos.x - pv.x) > 2.2 || Math.abs(tr.pos.z - pv.z) > 2.2 || tr.pos.y > 2.5) continue;
      const dx = tr.pos.x - pv.x || 0.1;
      const dz = tr.pos.z - pv.z || 0.1;
      const l = Math.hypot(dx, dz);
      world.applyHit(world.creditFor(tr, now), tr, PULVERIZER_DAMAGE, [(dx / l) * 5, -3, (dz / l) * 5], [tr.pos.x, tr.pos.y + 0.6, tr.pos.z], "pulverizer", now);
    }
  }
  void pulverizerLevel;
}

/** Pit falls and out-of-bounds, burns, and flip tracking for owned trucks. */
export function ownedChecks(world: World, t: TruckRuntime, now: number, dt: number): void {
  if (!t.local || !t.alive || world.phase !== "fight") return;
  const time = world.time(now);
  if (t.pos.y < ARENA.koDepth || Math.abs(t.pos.x) > ARENA.half + 6 || Math.abs(t.pos.z) > ARENA.half + 6) {
    world.knockOut(t, world.creditFor(t, now), "pit", time, t.lastHitKind);
    return;
  }
  world.burnTick(t, dt, now, BURN_DPS);
}

/** Tracks how high a flipped opponent flew (for "Flipped!" and best_flip). */
export function trackFlip(world: World, t: TruckRuntime, time: number): void {
  const f = t.flipTrack;
  if (!f) return;
  const target = world.byId.get(f.target);
  if (!target) {
    t.flipTrack = null;
    return;
  }
  f.peak = Math.max(f.peak, target.pos.y);
  if (time >= f.until) {
    t.bestFlipCm = Math.max(t.bestFlipCm, Math.round((f.peak - f.baseY) * 100));
    t.flipTrack = null;
  }
}

/**
 * Ram damage when two trucks touch: the attacker (`t`, owned here) deals
 * damage from its closing speed if it hit nose-first. Uses the velocities
 * cached before this step.
 */
export function ram(world: World, t: TruckRuntime, other: TruckRuntime, now: number): void {
  if (!t.local || !t.alive || !other.alive || world.phase !== "fight") return;
  const time = world.time(now);
  if ((t.rehit.get(`ram:${other.id}`) ?? 0) > time) return;
  const nx = other.pos.x - t.pos.x;
  const nz = other.pos.z - t.pos.z;
  const len = Math.hypot(nx, nz) || 1;
  const ux = nx / len;
  const uz = nz / len;
  const closing = (t.vel.x - other.vel.x) * ux + (t.vel.z - other.vel.z) * uz;
  const frontDot = Math.sin(t.yaw) * ux + Math.cos(t.yaw) * uz;
  const dmg = ramDamage(closing, frontDot, ARMORS[t.loadout.armor].ram * (t.boosting ? 1.15 : 1));
  if (dmg <= 0) return;
  t.rehit.set(`ram:${other.id}`, time + 500);
  const kick = closing * 0.3 * (ARMORS[t.loadout.armor].mass / ARMORS[other.loadout.armor].mass);
  world.dealHit(t, other, dmg, [ux * kick, 1 + closing * 0.08, uz * kick], [t.pos.x + ux * 1.4, t.pos.y + 0.2, t.pos.z + uz * 1.4], "ram", now);
}

export { clamp01 };
