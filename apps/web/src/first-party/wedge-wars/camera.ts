/**
 * Cameras:
 * - chase: a critically-damped spring behind the followed truck, looking
 *   ahead along its (smoothed) heading, pulled back and widened with speed,
 *   kept inside the arena walls;
 * - broadcast: spectators get a slow orbiting "TV" camera framing every truck
 *   still fighting, leaning toward the latest action;
 * - KO cam: orbits the wreck (slow motion is driven by the world);
 * plus trauma-based shake (reduced-motion aware, scaled by the world).
 */

import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { ARENA, damp, wrapAngle } from "./logic";
import type { World } from "./world";

const _desired = new Vector3();
const _look = new Vector3();
const _tmp = new Vector3();

function spring(pos: Vector3, vel: Vector3, target: Vector3, omega: number, dt: number): void {
  // Critically damped spring (semi-implicit Euler).
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  const dx = pos.x - target.x;
  const dy = pos.y - target.y;
  const dz = pos.z - target.z;
  const nx = (f * dx + dt * vel.x) * detInv;
  const ny = (f * dy + dt * vel.y) * detInv;
  const nz = (f * dz + dt * vel.z) * detInv;
  vel.set((vel.x - hoo * dx) * detInv, (vel.y - hoo * dy) * detInv, (vel.z - hoo * dz) * detInv);
  pos.set(target.x + nx, target.y + ny, target.z + nz);
}

export class CameraRig {
  readonly pos = new Vector3(0, 30, -30);
  private readonly vel = new Vector3();
  readonly look = new Vector3();
  private readonly lookVel = new Vector3();
  private heading = 0;
  private headingInit = false;
  private orbit = 0;
  private fov = 60;
  private started = false;
  /** Distance to the focus (for depth of field). */
  focus = 8;
  /** 0..1 how strongly the KO cam is active (drives DOF bokeh). */
  koBlend = 0;

  update(camera: PerspectiveCamera, world: World, dt: number, now: number, time: number): void {
    const me = world.me;
    const ko = world.koCamId && now < world.koCamUntil ? world.byId.get(world.koCamId) : undefined;
    const followId = me && me.alive ? me.id : world.watching;
    const follow = followId ? world.byId.get(followId) : undefined;
    const broadcast = !follow;

    // The TV camera cuts straight to its framing (no swoop).
    const snap = !this.started && !follow;
    if (snap) this.started = true;
    if (!this.started && follow) {
      // Start high above and behind for a swoop into the chase position.
      this.heading = follow.yaw;
      this.headingInit = true;
      this.pos.set(follow.pos.x - Math.sin(follow.yaw) * 22, 18, follow.pos.z - Math.cos(follow.yaw) * 22);
      this.look.copy(follow.pos);
      this.started = true;
    }

    let omega = 5.5;
    let fov = 60;
    this.koBlend += ((ko ? 1 : 0) - this.koBlend) * damp(4, dt);

    if (ko) {
      // Orbit the wreck.
      this.orbit += dt * (world.reduceMotion ? 0.15 : 0.55);
      const r = 6.8;
      _desired.set(ko.pos.x + Math.sin(this.orbit) * r, Math.max(ko.pos.y, 0) + 2.6, ko.pos.z + Math.cos(this.orbit) * r);
      _look.set(ko.pos.x, Math.max(-1, ko.pos.y) + 0.4, ko.pos.z);
      omega = 3.2;
      fov = 48;
    } else if (broadcast) {
      // Frame the fight.
      const alive = world.trucks.filter((t) => t.alive);
      const set = alive.length ? alive : world.trucks;
      let cx = 0;
      let cz = 0;
      for (const t of set) {
        cx += t.pos.x;
        cz += t.pos.z;
      }
      cx /= Math.max(1, set.length);
      cz /= Math.max(1, set.length);
      let spread = 4;
      for (const t of set) spread = Math.max(spread, Math.hypot(t.pos.x - cx, t.pos.z - cz));
      // Lean toward whoever got hit last.
      const hot = [...world.trucks].sort((a, b) => b.hurtAt - a.hurtAt)[0];
      if (hot && time - hot.hurtAt < 1500) {
        cx = cx * 0.6 + hot.pos.x * 0.4;
        cz = cz * 0.6 + hot.pos.z * 0.4;
      }
      this.orbit += dt * 0.07;
      const r = Math.min(24, 9 + spread * 0.8);
      _desired.set(cx + Math.sin(this.orbit) * r, Math.min(9.5, 4.5 + spread * 0.3), cz + Math.cos(this.orbit) * r);
      _look.set(cx, 0.4, cz);
      omega = 2.2;
      fov = 55;
    } else if (follow) {
      // Chase: smoothed heading so hits/spins don't whip the camera.
      const target = follow.speed < -2 ? follow.yaw : follow.yaw;
      if (!this.headingInit) {
        this.heading = target;
        this.headingInit = true;
      }
      this.heading += wrapAngle(target - this.heading) * damp(follow.flipped ? 0.5 : 3.2, dt);
      const speed = Math.abs(follow.speed);
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      // Portrait screens see less sideways: sit further back and higher.
      const narrow = Math.max(0, Math.min(1, (1.3 - camera.aspect) / 0.8));
      const back = 6.4 + narrow * 2.6 + speed * 0.09 + (follow.boosting ? 1.2 : 0);
      const up = 2.75 + narrow * 1.2 + speed * 0.02;
      _desired.set(follow.pos.x - fx * back, Math.max(0, follow.pos.y) + up, follow.pos.z - fz * back);
      const ahead = 3.2 + speed * 0.14;
      _look.set(follow.pos.x + fx * ahead, Math.max(-1, follow.pos.y) + 0.55, follow.pos.z + fz * ahead);
      omega = 6;
      fov = 60 + Math.min(12, speed * 0.3) + (follow.boosting ? 6 : 0);
    } else {
      _desired.set(0, 26, -30);
      _look.set(0, 0, 0);
    }

    // Keep clear of trucks: push the camera out of any hull it would sit in, and rise over it.
    for (const t of world.trucks) {
      const dx = _desired.x - t.pos.x;
      const dz = _desired.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      const clear = 2.4;
      if (d < clear && _desired.y < t.pos.y + 2.6) {
        const push = clear - d;
        const nx = d > 1e-3 ? dx / d : -Math.sin(this.heading);
        const nz = d > 1e-3 ? dz / d : -Math.cos(this.heading);
        _desired.x += nx * push * 0.6;
        _desired.z += nz * push * 0.6;
        _desired.y = Math.max(_desired.y, t.pos.y + 1.4 + push * 0.8);
      }
    }

    // Keep inside the walls: slide along, and rise to peek over when pressed out.
    const lim = ARENA.half - 0.8;
    const outX = Math.max(0, Math.abs(_desired.x) - lim);
    const outZ = Math.max(0, Math.abs(_desired.z) - lim);
    if (outX > 0) _desired.x = Math.sign(_desired.x) * lim;
    if (outZ > 0) _desired.z = Math.sign(_desired.z) * lim;
    _desired.y += (outX + outZ) * 0.6;
    _desired.y = Math.max(1.3, _desired.y);

    if (snap) {
      this.pos.copy(_desired);
      this.look.copy(_look);
    }
    spring(this.pos, this.vel, _desired, omega, dt);
    spring(this.look, this.lookVel, _look, omega * 1.4, dt);

    // Shake.
    const trauma = world.trauma;
    world.trauma = Math.max(0, trauma - dt * 1.4);
    const shake = trauma * trauma * (world.reduceMotion ? 0.25 : 1);
    camera.position.copy(this.pos);
    if (shake > 0.0005) {
      const t = now * 0.001;
      camera.position.x += (Math.sin(t * 47.3) + Math.sin(t * 91.7) * 0.5) * shake * 0.45;
      camera.position.y += (Math.sin(t * 53.1 + 1.3) + Math.sin(t * 77.2) * 0.5) * shake * 0.35;
      camera.position.z += Math.sin(t * 61.9 + 2.1) * shake * 0.45;
    }
    camera.lookAt(this.look);
    if (shake > 0.0005) camera.rotateZ(Math.sin(now * 0.037) * shake * 0.05);
    this.fov += (fov - this.fov) * damp(4, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    this.focus = _tmp.copy(this.look).sub(camera.position).length();
    void MathUtils;
  }
}
