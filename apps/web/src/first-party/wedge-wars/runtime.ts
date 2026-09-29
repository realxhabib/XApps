/**
 * One match's runtime: owns the World, input, network link, audio, VFX and
 * the physics bodies, and runs the per-frame loop (input → bots → physics
 * step → weapons/hazards → effects → network → round end → HUD).
 * React components only mount things and forward events into it.
 */

import type { XAppsClient } from "@xapps/sdk";
import type { RapierRigidBody } from "@react-three/rapier";
import type { Ray, World as RapierWorld } from "@dimforge/rapier3d-compat";
import { PerspectiveCamera, Vector3 } from "three";
import { ArenaAudio } from "./audio";
import { CameraRig } from "./camera";
import { Input } from "./controls";
import {
  DISCONNECT_MS,
  OUTRO_MS,
  botDecide,
  hazardLayout,
  pulverizerLevel,
  sawLevel,
  topSpeed,
  ventState,
  type HazardLayout,
  type Loadout,
} from "./logic";
import { NetLink } from "./net";
import { FpsProbe } from "./quality";
import { drive, hazards, massFor, ownedChecks, ram, readBody, steerProxy, trackFlip, weaponFx, weapons } from "./systems";
import { EXHAUSTS, healthFraction, WHEELS, WHEEL_Y } from "./truck";
import type { Vfx } from "./vfx";
import { World, type FinalRow, type SeatInfo } from "./world";

const ignore = () => {};

interface TruckFx {
  skid: Vector3[];
  skidOn: boolean[];
  wasGrounded: boolean;
  exploded: boolean;
  deadAt: number;
  vy: number;
}

interface DamageNumber {
  x: number;
  y: number;
  z: number;
  amount: number;
  mine: boolean;
  born: number;
  el: HTMLElement | null;
}

export interface RuntimeOptions {
  xapps: XAppsClient;
  seats: SeatInfo[];
  meId: string | null;
  spectator: boolean;
  sim: boolean;
  reduceMotion: boolean;
  localIds: Set<string>;
  loadouts: Map<string, Loadout>;
  skills: Map<string, number>;
  /** Id of the client that drives the bots (for disconnect checks). */
  botDriver: string | null;
  /** Practice with nobody else here: pausing really pauses. */
  canPause: boolean;
}

const _v = new Vector3();
const _w = new Vector3();

export class MatchRuntime {
  readonly world: World;
  readonly input = new Input();
  readonly net: NetLink;
  readonly audio = new ArenaAudio();
  readonly camera = new CameraRig();
  readonly layout: HazardLayout;
  readonly canPause: boolean;
  private readonly xapps: XAppsClient;
  private readonly bodies = new Map<string, RapierRigidBody>();
  private readonly fx = new Map<string, TruckFx>();
  private vfx: Vfx | null = null;
  private readonly botRand: () => number;
  private readonly botDriver: string | null;
  private online = new Set<string>();
  private prevHazardT = 0;
  private hudAt = 0;
  private paused = false;
  private pausedAt = 0;
  private finalized = false;
  private ray: Ray | null = null;
  private readonly grounded = new Map<string, boolean>();
  private readonly numbers: DamageNumber[] = [];
  private numberEls: HTMLElement[] = [];
  private arrowEls = new Map<string, HTMLElement>();
  private speedEl: HTMLElement | null = null;
  private vignetteEl: HTMLElement | null = null;
  private probe = new FpsProbe();
  private lowFpsListeners = new Set<() => void>();
  private finalListeners = new Set<(rows: FinalRow[]) => void>();

  constructor(o: RuntimeOptions) {
    this.xapps = o.xapps;
    this.canPause = o.canPause;
    this.botDriver = o.botDriver;
    this.world = new World({
      seats: o.seats,
      meId: o.meId,
      spectator: o.spectator,
      sim: o.sim,
      reduceMotion: o.reduceMotion,
      localIds: o.localIds,
      loadouts: o.loadouts,
      skills: o.skills,
    });
    const hazardRand = o.xapps.random.fork("hazards");
    this.layout = hazardLayout(() => hazardRand.next());
    const botRandom = o.xapps.random.fork(`bots:${o.meId ?? "spectator"}`);
    this.botRand = () => botRandom.next();
    this.net = new NetLink(o.xapps, this.world);
    for (const t of this.world.trucks) {
      this.fx.set(t.id, { skid: WHEELS.map(() => new Vector3()), skidOn: WHEELS.map(() => false), wasGrounded: true, exploded: false, deadAt: 0, vy: 0 });
    }
    const w = this.world;
    w.hooks = {
      sparks: (x, y, z, nx, ny, nz, p) => this.vfx?.sparksAt(x, y, z, nx, ny, nz, p),
      debris: (x, y, z, p, c) => this.vfx?.debrisAt(x, y, z, p, c),
      damageNumber: (x, y, z, amount, mine) => this.pushNumber(x, y, z, amount, mine),
      sound: (name, v, x, z) => this.audio.play(name, v, x, z),
      sendHit: (h) => this.net.hit(h, performance.now()),
      sendKo: (v, a, c, t) => this.net.ko(v, a, c, t, performance.now()),
      impulse: (id, ix, iy, iz, px, py, pz) => {
        const body = this.bodies.get(id);
        const t = w.byId.get(id);
        if (!body || !t) return;
        const m = body.mass() || massFor(t);
        body.applyImpulseAtPoint({ x: ix * m, y: iy * m, z: iz * m }, { x: px, y: py, z: pz }, true);
      },
      haptic: (style) => {
        this.xapps.ui.haptic(style).catch(ignore);
      },
    };
  }

  /* Wiring ---------------------------------------------------------------- */

  start(now: number): void {
    this.world.start(now);
    this.input.attach();
    this.audio.resume();
  }

  dispose(): void {
    this.input.dispose();
    this.audio.dispose();
  }

  setVfx(v: Vfx | null): void {
    this.vfx = v;
  }

  setBody(id: string, body: RapierRigidBody | null): void {
    if (body) this.bodies.set(id, body);
    else this.bodies.delete(id);
  }

  setOnline(ids: string[]): void {
    this.online = new Set(ids);
  }

  setNumberEls(els: HTMLElement[]): void {
    this.numberEls = els;
  }

  setArrowEl(id: string, el: HTMLElement | null): void {
    if (el) this.arrowEls.set(id, el);
    else this.arrowEls.delete(id);
  }

  setSpeedEl(el: HTMLElement | null): void {
    this.speedEl = el;
  }

  setVignetteEl(el: HTMLElement | null): void {
    this.vignetteEl = el;
  }

  onLowFps(listener: () => void): () => void {
    this.lowFpsListeners.add(listener);
    return () => this.lowFpsListeners.delete(listener);
  }

  onFinal(listener: (rows: FinalRow[]) => void): () => void {
    this.finalListeners.add(listener);
    return () => this.finalListeners.delete(listener);
  }

  /** Match clock in seconds (hazards). */
  clock = (): number => this.world.time(this.paused ? this.pausedAt : performance.now()) / 1000;

  isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    if (!this.canPause || paused === this.paused) return;
    const now = performance.now();
    if (paused) this.pausedAt = now;
    else this.world.shiftClock(now - this.pausedAt);
    this.paused = paused;
    this.world.bumpHud();
  }

  /** Cycles the camera: TV cam (null) → each truck still fighting → TV cam… */
  watchNext(): void {
    const alive = this.world.trucks.filter((t) => t.alive).map((t) => t.id);
    const list: (string | null)[] = [null, ...(alive.length ? alive : this.world.trucks.map((t) => t.id))];
    const i = list.indexOf(this.world.watching);
    this.world.watching = list[(i + 1) % list.length] ?? null;
    this.world.bumpHud();
  }

  /* Collisions ------------------------------------------------------------- */

  /** A truck this client owns touched something (Rapier collision enter). */
  collide(selfId: string, other: { truckId?: string; wall?: boolean } | undefined, now: number): void {
    const t = this.world.byId.get(selfId);
    if (!t || !t.local) return;
    if (other?.truckId) {
      const o = this.world.byId.get(other.truckId);
      if (o) ram(this.world, t, o, now);
      return;
    }
    if (other?.wall) {
      const speed = Math.hypot(t.vel.x, t.vel.z);
      if (speed > 7) {
        const dx = Math.sign(t.pos.x) * (Math.abs(t.pos.x) > Math.abs(t.pos.z) ? 1 : 0);
        const dz = Math.sign(t.pos.z) * (Math.abs(t.pos.z) >= Math.abs(t.pos.x) ? 1 : 0);
        this.vfx?.sparksAt(t.pos.x + dx * 1.2, t.pos.y + 0.1, t.pos.z + dz * 1.2, -dx, 0.5, -dz, Math.min(1.2, speed / 18));
        this.audio.play("wall", Math.min(1, speed / 20), t.pos.x, t.pos.z);
        if (t.isMe || this.world.watching === t.id) this.world.addTrauma(Math.min(0.5, speed / 40));
      }
    }
  }

  /* Physics step ----------------------------------------------------------- */

  /** Runs inside the physics step, before integration. */
  beforeStep(rw: RapierWorld, RayCtor: new (o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }) => Ray): void {
    const now = performance.now();
    const dt = rw.timestep;
    if (!this.ray) this.ray = new RayCtor({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    const ray = this.ray;
    for (const t of this.world.trucks) {
      const body = this.bodies.get(t.id);
      if (!body) continue;
      if (t.local) {
        const p = body.translation();
        ray.origin.x = p.x;
        ray.origin.y = p.y;
        ray.origin.z = p.z;
        const hit = rw.castRay(ray, 0.98, true, undefined, undefined, undefined, body);
        const grounded = !!hit;
        this.grounded.set(t.id, grounded);
        drive(t, body, dt, grounded, this.world.time(now), this.world, this.audio);
      } else {
        steerProxy(t, body, now, dt);
        t.grounded = t.pos.y < 1.1 && !t.flipped;
      }
    }
  }

  /* Frame -------------------------------------------------------------------- */

  frame(delta: number, step: (dt: number) => void, camera: PerspectiveCamera, width: number, height: number): void {
    const now = performance.now();
    const w = this.world;
    const realDt = Math.min(delta, 1 / 20);
    const verdict = this.probe.sample(delta);
    if (verdict === "down") this.lowFpsListeners.forEach((l) => l());

    if (this.paused) {
      this.camera.update(camera, w, 0.0001, now, w.time(this.pausedAt));
      this.overlay(camera, width, height, now);
      return;
    }

    const scale = now < w.hitStopUntil ? 0.05 : now < w.slowMoUntil ? 0.3 : 1;
    w.timeScale = scale;
    const dt = realDt * scale;
    const time = w.time(now);

    // Inputs: you, then the bots you drive.
    const me = w.me;
    if (me && me.local) {
      if (w.phase === "fight" && me.alive) this.input.read(me.input);
      else zero(me.input);
    }
    for (const t of w.trucks) {
      if (!t.local || !t.bot) continue;
      if (w.phase !== "fight" || !t.alive) {
        zero(t.input);
        continue;
      }
      const sense = {
        t: time / 1000,
        x: t.pos.x,
        z: t.pos.z,
        yaw: t.yaw,
        speed: t.speed,
        weapon: t.loadout.weapon,
        ready: t.loadout.weapon === "flamer" ? t.fuel > 0.3 : t.cooldown <= 0,
        boost: t.boost,
        flipped: t.flipped && Math.abs(t.vel.y) < 1,
        skill: t.skill,
        targets: w.trucks.filter((o) => o !== t).map((o) => ({ id: o.id, x: o.pos.x, z: o.pos.z, vx: o.vel.x, vz: o.vel.z, alive: o.alive })),
        dangers: this.dangers(time / 1000),
      };
      const c = botDecide(sense, t.bot, this.botRand);
      Object.assign(t.input, c);
    }

    // Physics. Gameplay waits until every truck has its body.
    step(dt);
    if (this.bodies.size < w.trucks.length) {
      this.camera.update(camera, w, realDt, now, time);
      return;
    }
    for (const t of w.trucks) {
      const body = this.bodies.get(t.id);
      if (!body) continue;
      readBody(t, body);
      if (t.local) t.grounded = this.grounded.get(t.id) ?? t.grounded;
    }

    // Weapons, owned-truck checks, hazards.
    const ctx = { world: w, vfx: this.vfx, audio: this.audio, now, dt, time };
    for (const t of w.trucks) {
      if (!t.local) continue;
      weapons(t, ctx);
      ownedChecks(w, t, now, dt);
      trackFlip(w, t, time);
    }
    const ht = time / 1000;
    hazards(w, this.layout, { now, dt, vfx: this.vfx, audio: this.audio, prevT: this.prevHazardT, t: ht });
    this.prevHazardT = ht;

    this.truckFx(dt, time, now);
    this.disconnects(now, time);

    // Round end.
    if (w.checkEnd(now)) this.net.fin(w.endReason ?? "time", now);
    if (w.phase === "outro" && now - w.endAt > OUTRO_MS && !this.finalized) {
      this.finalized = true;
      const rows = w.finalize();
      this.finalListeners.forEach((l) => l(rows));
    }

    this.net.tick(now);
    this.vfx?.update(dt);

    // Audio.
    const watch = w.watching ? w.byId.get(w.watching) : undefined;
    const listener = me && me.alive ? me : watch;
    if (listener) this.audio.setListener(listener.pos.x, listener.pos.z);
    if (me && me.alive && w.phase === "fight") {
      this.audio.setEngine(true, Math.min(1, Math.abs(me.speed) / topSpeed(me.loadout)), Math.abs(me.input.throttle), me.boosting);
      this.audio.setWhine(me.loadout.weapon === "spinner" ? me.spin : 0);
      this.audio.setRoar(me.firing ? 1 : 0);
    } else {
      this.audio.setEngine(false, 0, 0, false);
      this.audio.setWhine(0);
      this.audio.setRoar(0);
    }

    this.camera.update(camera, w, realDt, now, time);
    this.overlay(camera, width, height, now);

    if (now - this.hudAt > 80) {
      this.hudAt = now;
      w.bumpHud();
    }
  }

  private dangers(t: number): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const s of this.layout.saws) if (sawLevel(t, s.phase) > 0.2 || sawLevel(t + 0.6, s.phase) > 0.2) out.push({ x: s.x, z: s.z, r: 1.7 });
    for (const v of this.layout.vents) if (ventState(t, v.phase) !== "idle") out.push({ x: v.x, z: v.z, r: 1.8 });
    const pv = this.layout.pulverizer;
    if (pulverizerLevel(t, pv.phase) < 0.8) out.push({ x: pv.x, z: pv.z, r: 2.6 });
    return out;
  }

  /** Smoke, fire, exhaust flames, tire marks, dust and wreck explosions. */
  private truckFx(dt: number, time: number, now: number): void {
    const vfx = this.vfx;
    if (!vfx || dt <= 0) return;
    for (const t of this.world.trucks) {
      const f = this.fx.get(t.id);
      if (!f) continue;
      const remoteFiring = !t.local && !!(t.net.flags & 2);
      weaponFx(t, t.local ? t.firing : remoteFiring && t.loadout.weapon === "flamer", vfx, dt, time);

      const health = healthFraction(t.hp, t.armor, t.loadout);
      const hood = _v.set(0, 0.55, 0.8).applyQuaternion(t.quat).add(t.pos);
      if (!t.alive) {
        if (!f.exploded) {
          f.exploded = true;
          f.deadAt = now;
          if (t.pos.y > -1.5) vfx.explosion(t.pos.x, Math.max(0.2, t.pos.y), t.pos.z);
        }
        const age = (now - f.deadAt) / 1000;
        if (t.pos.y > -2 && Math.random() < dt * (age < 6 ? 14 : 5)) vfx.smokeAt(hood.x, hood.y + 0.2, hood.z, 1, 0.95, 2.2, 0.9);
        if (t.pos.y > -2 && age < 5 && Math.random() < dt * 20) vfx.fireColumn(hood.x, hood.y, hood.z, 0.8, 2.5, 1, 0.45);
        continue;
      }
      if (health < 0.55 && Math.random() < dt * (0.55 - health) * 26) vfx.smokeAt(hood.x, hood.y, hood.z, 1, 0.5 + (0.55 - health), 1.6, 0.45);
      if (health < 0.25 && Math.random() < dt * 14) vfx.fireColumn(hood.x, hood.y, hood.z, 0.4, 1.8, 1, 0.25);
      if (health < 0.35 && Math.random() < dt * 3) vfx.sparksAt(hood.x, hood.y, hood.z, 0, 1, 0, 0.15);
      const burning = t.local ? t.burnUntil > time : !!(t.net.flags & 8);
      if (burning && Math.random() < dt * 30) vfx.fireColumn(t.pos.x, t.pos.y + 0.4, t.pos.z, 1.4, 2, 1, 0.35);

      const boosting = t.local ? t.boosting : !!(t.net.flags & 1);
      if (boosting) {
        for (const e of EXHAUSTS) {
          _w.set(e.x, e.y + 0.05, e.z).applyQuaternion(t.quat).add(t.pos);
          vfx.fireColumn(_w.x, _w.y, _w.z, 0.05, 2.6, 1, 0.16);
        }
      } else if (Math.random() < dt * 1.5) {
        const e = EXHAUSTS[Math.random() < 0.5 ? 0 : 1]!;
        _w.set(e.x, e.y + 0.05, e.z).applyQuaternion(t.quat).add(t.pos);
        vfx.smokeAt(_w.x, _w.y, _w.z, 1, 0.8, 1.2, 0.18);
      }

      // Landings.
      if (t.grounded && !f.wasGrounded && f.vy < -4) {
        vfx.dust(t.pos.x, t.pos.z, 5);
        vfx.sparksAt(t.pos.x, 0.05, t.pos.z, 0, 1, 0, 0.3);
        this.audio.play("clang", Math.min(1, -f.vy / 12), t.pos.x, t.pos.z);
        if (t.isMe || this.world.watching === t.id) this.world.addTrauma(Math.min(0.4, -f.vy / 30));
      }
      f.wasGrounded = t.grounded;
      f.vy = t.vel.y;

      // Tire marks + dust when sliding, braking hard or launching.
      const sliding = t.grounded && (t.slip > 3.2 || (boosting && Math.abs(t.speed) < 8) || (t.local && Math.abs(t.input.throttle) > 0.5 && Math.sign(t.input.throttle) !== Math.sign(t.speed) && Math.abs(t.speed) > 4));
      for (let i = 0; i < WHEELS.length; i++) {
        const wh = WHEELS[i]!;
        if (wh.front && t.slip < 5) {
          f.skidOn[i] = false;
          continue;
        }
        const contact = _w.set(wh.x, WHEEL_Y - 0.36, wh.z).applyQuaternion(t.quat).add(t.pos);
        if (!sliding || contact.y > 0.3) {
          f.skidOn[i] = false;
          continue;
        }
        const last = f.skid[i]!;
        if (!f.skidOn[i]) {
          last.set(contact.x, 0, contact.z);
          f.skidOn[i] = true;
          continue;
        }
        const d = Math.hypot(contact.x - last.x, contact.z - last.z);
        if (d > 0.3) {
          const yaw = Math.atan2(contact.x - last.x, contact.z - last.z);
          vfx.skid((contact.x + last.x) / 2, (contact.z + last.z) / 2, yaw, d);
          last.set(contact.x, 0, contact.z);
          if (Math.random() < 0.5) vfx.dust(contact.x, contact.z, 1);
        }
      }
    }
  }

  /** Remote trucks whose owner went quiet power down (counted as a KO). */
  private disconnects(now: number, time: number): void {
    const w = this.world;
    if (w.phase !== "fight" || w.sim) return;
    for (const t of w.trucks) {
      if (t.local || !t.alive) continue;
      const owner = t.isBot ? this.botDriver : t.id;
      const silent = now - t.lastPacketAt;
      const limit = t.hasNet ? DISCONNECT_MS : DISCONNECT_MS * 2;
      if (silent < limit) continue;
      if (owner && this.online.has(owner) && silent < DISCONNECT_MS * 2.5) continue;
      w.knockOut(t, w.creditFor(t, now), "dc", time, null, true);
    }
  }

  /* DOM overlay: damage numbers, off-screen arrows, speed lines ------------ */

  private pushNumber(x: number, y: number, z: number, amount: number, mine: boolean): void {
    if (this.numbers.length >= this.numberEls.length && this.numbers.length > 0) this.numbers.shift();
    this.numbers.push({ x, y, z, amount, mine, born: performance.now(), el: null });
  }

  private overlay(camera: PerspectiveCamera, width: number, height: number, now: number): void {
    // Damage numbers.
    const used = new Set<HTMLElement>();
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]!;
      const age = (now - n.born) / 1000;
      if (age > 1) {
        this.numbers.splice(i, 1);
        continue;
      }
      if (!n.el || used.has(n.el)) {
        n.el = this.numberEls.find((e) => !used.has(e) && !this.numbers.some((m) => m !== n && m.el === e)) ?? null;
        if (n.el) {
          n.el.textContent = String(Math.round(n.amount));
          n.el.dataset.tone = n.mine ? "mine" : "hit";
        }
      }
      if (!n.el) continue;
      used.add(n.el);
      _v.set(n.x, n.y + age * 1.4, n.z).project(camera);
      const visible = _v.z < 1;
      const sx = (_v.x * 0.5 + 0.5) * width;
      const sy = (-_v.y * 0.5 + 0.5) * height;
      const scale = age < 0.12 ? 0.6 + age * 5 : 1.2 - age * 0.3;
      n.el.style.opacity = visible ? String(Math.min(1, (1 - age) * 2.2)) : "0";
      n.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
    for (const e of this.numberEls) if (!used.has(e)) e.style.opacity = "0";

    // Off-screen arrows toward opponents.
    const me = this.world.me;
    const focus = me && me.alive ? me : undefined;
    for (const t of this.world.trucks) {
      const el = this.arrowEls.get(t.id);
      if (!el) continue;
      if (!focus || t === focus || !t.alive) {
        el.style.opacity = "0";
        continue;
      }
      _v.set(t.pos.x, t.pos.y + 0.5, t.pos.z).project(camera);
      const behind = _v.z > 1;
      let x = behind ? -_v.x : _v.x;
      let y = behind ? -_v.y : _v.y;
      const on = !behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88;
      if (on) {
        el.style.opacity = "0";
        continue;
      }
      const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.82, 1e-3);
      x /= m;
      y /= m;
      const sx = (x * 0.5 + 0.5) * width;
      const sy = (-y * 0.5 + 0.5) * height;
      const ang = Math.atan2(-y, x);
      const dist = Math.hypot(t.pos.x - focus.pos.x, t.pos.z - focus.pos.z);
      el.style.opacity = "1";
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -50%)`;
      const arrow = el.firstElementChild as HTMLElement | null;
      if (arrow) arrow.style.transform = `rotate(${ang.toFixed(3)}rad)`;
      const label = el.lastElementChild as HTMLElement | null;
      if (label && label !== arrow) label.textContent = `${Math.round(dist)}m`;
    }

    // Speed lines + damage vignette.
    if (this.speedEl) {
      const boost = me && me.alive && me.boosting ? 1 : 0;
      const cur = Number(this.speedEl.dataset.v ?? "0");
      const next = cur + (boost - cur) * 0.15;
      this.speedEl.dataset.v = next.toFixed(3);
      this.speedEl.style.opacity = this.world.reduceMotion ? String(next * 0.4) : next.toFixed(3);
    }
    if (this.vignetteEl && me) {
      const hurt = Math.max(0, 1 - (this.world.time(now) - me.hurtAt) / 500);
      const low = me.alive ? Math.max(0, 0.35 - healthFraction(me.hp, me.armor, me.loadout)) * 1.6 : 0;
      this.vignetteEl.style.opacity = Math.min(1, hurt * 0.4 + low * 0.7 + (low > 0 ? Math.sin(now / 180) * 0.08 : 0)).toFixed(3);
    }
  }
}

function zero(c: { throttle: number; steer: number; fire: boolean; boost: boolean; selfRight: boolean }): void {
  c.throttle = 0;
  c.steer = 0;
  c.fire = false;
  c.boost = false;
  c.selfRight = false;
}
