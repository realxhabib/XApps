/**
 * The match runtime: one mutable `World` per match, shared by the physics
 * loop, the renderer, the network link and the HUD. Nothing here is React
 * state — the canvas reads it every frame, and the DOM HUD subscribes to a
 * throttled snapshot (`subscribe` / `hud()`), so a 60 fps game never
 * re-renders React at 60 fps.
 */

import { Quaternion, Vector3 } from "three";
import {
  ARMORS,
  BURN_MS,
  CREDIT_MS,
  HP_MAX,
  OUTRO_MS,
  PAINTS,
  ROUND_MS,
  WEAPONS,
  applyDamage,
  decodeLoadout,
  encodeLoadout,
  newBotMemory,
  placements,
  roundOver,
  scoreFor,
  spawnFor,
  type BotMemory,
  type EndReason,
  type HitKind,
  type KoCause,
  type Loadout,
  type NetTruck,
  type Snapshot,
  type Standing,
} from "./logic";

export interface SeatInfo {
  id: string;
  seat: number;
  name: string;
  handle: string;
  isBot: boolean;
  avatarUrl: string | null;
}

export interface Controls {
  throttle: number;
  steer: number;
  fire: boolean;
  boost: boolean;
  selfRight: boolean;
}

export interface TruckRuntime {
  id: string;
  seat: number;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isBot: boolean;
  isMe: boolean;
  /** Simulated (and owned) by this client. */
  local: boolean;
  loadout: Loadout;
  /** Loadout confirmed (always for local trucks; from the first packet for remote ones). */
  loadoutKnown: boolean;
  skill: number;

  hp: number;
  armor: number;
  armorMax: number;
  alive: boolean;
  koAt: number | null;
  koCause: KoCause | null;
  koBy: string | null;
  lastHitBy: string | null;
  lastHitAt: number;
  lastHitKind: HitKind | null;

  /** Kinematics, refreshed from the physics body after every step. */
  pos: Vector3;
  quat: Quaternion;
  vel: Vector3;
  yaw: number;
  /** Forward speed (m/s). */
  speed: number;
  grounded: boolean;
  flipped: boolean;
  /** Sideways slip (m/s): tire marks + smoke. */
  slip: number;

  input: Controls;
  /** Weapon: cooldown left (ms), animation 0..1, spinner spin 0..1, flamer fuel 0..1. */
  cooldown: number;
  anim: number;
  animT: number;
  spin: number;
  fuel: number;
  firing: boolean;
  /** Weapon hit already applied in this stroke (flipper/hammer). */
  strokeHit: boolean;
  boost: number;
  boosting: boolean;
  selfRightCd: number;
  burnUntil: number;
  burnBy: string | null;
  /** Visual wear 0..1: grime/scorch build up with damage. */
  scorch: number;
  /** Dents: local-space hit points waiting to be pressed into the hull. */
  dents: { x: number; y: number; z: number; depth: number }[];

  /** Match stats (tracked by whoever owns the attacker). */
  dmgDealt: number;
  kos: number;
  hammerHits: number;
  flameKos: number;
  pitKos: number;
  firstKo: boolean;
  pulverized: boolean;
  bestFlipCm: number;
  flipTrack: { target: string; baseY: number; peak: number; until: number } | null;
  /** Per-target re-hit cooldown for continuous weapons (spinner, flames, rams). */
  rehit: Map<string, number>;
  flameAcc: Map<string, number>;

  /** Remote replication. */
  snaps: Snapshot[];
  clockOffset: number | null;
  lastPacketAt: number;
  net: NetTruck;
  hasNet: boolean;

  bot: BotMemory | null;
  /** HUD damage flash (match ms). */
  hurtAt: number;
}

export interface FeedItem {
  key: number;
  at: number;
  victim: string;
  by: string | null;
  cause: KoCause;
}

export interface HudTruck {
  id: string;
  seat: number;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isBot: boolean;
  isMe: boolean;
  color: string;
  hp: number;
  armor: number;
  armorMax: number;
  alive: boolean;
  dmg: number;
  hurt: boolean;
  weapon: string;
}

export interface HudSnapshot {
  version: number;
  /** The scene is up and the clock is running. */
  ready: boolean;
  phase: Phase;
  remainingMs: number;
  trucks: HudTruck[];
  me: {
    alive: boolean;
    cooldown: number;
    weaponReady: boolean;
    weapon: string;
    fuel: number;
    boost: number;
    flipped: boolean;
    selfRightReady: boolean;
    speed: number;
  } | null;
  feed: FeedItem[];
  endReason: EndReason | null;
  winnerId: string | null;
  results: FinalRow[] | null;
  callout: { key: number; text: string; tone: "ko" | "info" | "win"; at: number } | null;
  watching: string | null;
}

export interface FinalRow {
  id: string;
  rank: number;
  score: number;
  hp: number;
  dmg: number;
  alive: boolean;
}

export type Phase = "fight" | "outro" | "over";

/** What the world needs from the renderer/audio/network, all optional (tests, sim). */
export interface WorldHooks {
  sparks?: (x: number, y: number, z: number, nx: number, ny: number, nz: number, power: number) => void;
  debris?: (x: number, y: number, z: number, power: number, color: string) => void;
  damageNumber?: (x: number, y: number, z: number, amount: number, mine: boolean) => void;
  sound?: (name: SoundName, volume?: number, x?: number, z?: number) => void;
  sendHit?: (msg: HitSend) => void;
  sendKo?: (victimSeat: number, attackerSeat: number, cause: KoCause, t: number) => void;
  impulse?: (id: string, ix: number, iy: number, iz: number, px: number, py: number, pz: number) => void;
  haptic?: (style: "light" | "medium" | "heavy" | "success" | "error") => void;
}

export interface HitSend {
  attacker: number;
  victim: number;
  damage: number;
  impulse: [number, number, number];
  point: [number, number, number];
  kind: HitKind;
}

export type SoundName =
  | "impact"
  | "bigImpact"
  | "clang"
  | "flip"
  | "hammer"
  | "ko"
  | "saw"
  | "vent"
  | "pulverizer"
  | "boost"
  | "selfRight"
  | "wall";

let feedKey = 0;
let calloutKey = 0;

export class World {
  readonly trucks: TruckRuntime[] = [];
  readonly byId = new Map<string, TruckRuntime>();
  readonly bySeat = new Map<number, TruckRuntime>();
  readonly meId: string | null;
  readonly spectator: boolean;
  /** Offline simulation (spectating a bot table in the mock host): nothing is sent or submitted. */
  readonly sim: boolean;
  readonly reduceMotion: boolean;
  hooks: WorldHooks = {};

  phase: Phase = "fight";
  private startAt = 0;
  private started = false;
  endReason: EndReason | null = null;
  endAt = 0;
  winnerId: string | null = null;
  results: FinalRow[] | null = null;
  firstKoDone = false;

  /** Slow motion (KO cam) and hit-stop. */
  timeScale = 1;
  hitStopUntil = 0;
  slowMoUntil = 0;
  /** Camera trauma 0..1 (decays in the camera rig). */
  trauma = 0;
  /** KO cam focus (a truck id) until `koCamUntil` (performance time). */
  koCamId: string | null = null;
  koCamUntil = 0;
  /** Who the camera follows when not driving (spectators, after your KO). */
  watching: string | null = null;

  feed: FeedItem[] = [];
  callout: HudSnapshot["callout"] = null;

  private hudListeners = new Set<() => void>();
  private hudCache: HudSnapshot | null = null;
  private hudVersion = 0;

  constructor(options: {
    seats: SeatInfo[];
    meId: string | null;
    spectator: boolean;
    sim: boolean;
    reduceMotion: boolean;
    /** Ids this client simulates. */
    localIds: Set<string>;
    loadouts: Map<string, Loadout>;
    skills: Map<string, number>;
  }) {
    this.meId = options.meId;
    this.spectator = options.spectator;
    this.sim = options.sim;
    this.reduceMotion = options.reduceMotion;
    for (const s of [...options.seats].sort((a, b) => a.seat - b.seat)) {
      const loadout = options.loadouts.get(s.id) ?? decodeLoadout(0);
      const local = options.localIds.has(s.id);
      const armorMax = ARMORS[loadout.armor].armor;
      const t: TruckRuntime = {
        id: s.id,
        seat: s.seat,
        name: s.name,
        handle: s.handle,
        avatarUrl: s.avatarUrl,
        isBot: s.isBot,
        isMe: s.id === options.meId,
        local,
        loadout,
        loadoutKnown: local || s.isBot || options.loadouts.has(s.id),
        skill: options.skills.get(s.id) ?? 0.6,
        hp: HP_MAX,
        armor: armorMax,
        armorMax,
        alive: true,
        koAt: null,
        koCause: null,
        koBy: null,
        lastHitBy: null,
        lastHitAt: -Infinity,
        lastHitKind: null,
        pos: new Vector3(spawnFor(s.seat).x, 0.63, spawnFor(s.seat).z),
        quat: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spawnFor(s.seat).yaw),
        vel: new Vector3(),
        yaw: spawnFor(s.seat).yaw,
        speed: 0,
        grounded: true,
        flipped: false,
        slip: 0,
        input: { throttle: 0, steer: 0, fire: false, boost: false, selfRight: false },
        cooldown: 0,
        anim: 0,
        animT: -1,
        spin: 0.15,
        fuel: 1,
        firing: false,
        strokeHit: false,
        boost: 1,
        boosting: false,
        selfRightCd: 0,
        burnUntil: 0,
        burnBy: null,
        scorch: 0,
        dents: [],
        dmgDealt: 0,
        kos: 0,
        hammerHits: 0,
        flameKos: 0,
        pitKos: 0,
        firstKo: false,
        pulverized: false,
        bestFlipCm: 0,
        flipTrack: null,
        rehit: new Map(),
        flameAcc: new Map(),
        snaps: [],
        clockOffset: null,
        lastPacketAt: 0,
        net: {
          x: 0,
          y: 0,
          z: 0,
          qx: 0,
          qy: 0,
          qz: 0,
          qw: 1,
          vx: 0,
          vy: 0,
          vz: 0,
          hp: HP_MAX,
          armor: armorMax,
          weapon: 0,
          flags: 0,
          loadout: 0,
          dmg: 0,
        },
        hasNet: false,
        bot: local && s.isBot ? newBotMemory() : null,
        hurtAt: -Infinity,
      };
      this.trucks.push(t);
      this.byId.set(t.id, t);
      this.bySeat.set(t.seat, t);
    }
    const me = this.meId ? this.byId.get(this.meId) : undefined;
    // Players follow themselves; spectators start on the TV camera (null).
    this.watching = me ? me.id : null;
  }

  /* Clock ---------------------------------------------------------------- */

  start(now: number): void {
    if (this.started) return;
    this.started = true;
    this.startAt = now;
    this.callout = { key: ++calloutKey, text: "FIGHT!", tone: "info", at: now };
    for (const t of this.trucks) t.lastPacketAt = now;
    this.bumpHud();
  }

  /** Moves the match clock's origin (pausing a practice match). */
  shiftClock(ms: number): void {
    this.startAt += ms;
    this.endAt += this.phase === "fight" ? 0 : ms;
  }

  /** Match time (ms) at performance time `now`. */
  time(now: number): number {
    return this.started ? now - this.startAt : 0;
  }

  get me(): TruckRuntime | undefined {
    return this.meId ? this.byId.get(this.meId) : undefined;
  }

  alive(): TruckRuntime[] {
    return this.trucks.filter((t) => t.alive);
  }

  /* Damage --------------------------------------------------------------- */

  /**
   * A hit found by `attacker` (a truck this client owns, or null for a
   * hazard). Applied here when this client owns the victim; otherwise sent to
   * the victim's owner. Sparks and numbers show right away either way.
   */
  dealHit(
    attacker: TruckRuntime | null,
    victim: TruckRuntime,
    damage: number,
    impulse: [number, number, number],
    point: [number, number, number],
    kind: HitKind,
    now: number,
  ): void {
    if (!victim.alive || this.phase !== "fight" || damage <= 0) return;
    if (attacker && attacker.id !== victim.id) {
      attacker.dmgDealt += damage;
      if (kind === "hammer") attacker.hammerHits += 1;
    }
    if (victim.local) {
      this.applyHit(attacker?.id ?? null, victim, damage, impulse, point, kind, now);
    } else if (attacker) {
      this.hooks.sendHit?.({ attacker: attacker.seat, victim: victim.seat, damage, impulse, point, kind });
      this.hitFx(attacker, victim, damage, point, kind);
      // Predict the shove on the proxy so the hit reads instantly; the owner's state corrects it.
      this.hooks.impulse?.(victim.id, impulse[0] * 0.6, impulse[1] * 0.6, impulse[2] * 0.6, point[0], point[1], point[2]);
    }
  }

  /** Applies a hit to a truck this client owns (from a local attacker, a hazard or a peer's `hit`). */
  applyHit(
    attackerId: string | null,
    victim: TruckRuntime,
    damage: number,
    impulse: [number, number, number],
    point: [number, number, number],
    kind: HitKind,
    now: number,
  ): void {
    if (!victim.alive || this.phase !== "fight") return;
    const before = victim.hp + victim.armor;
    const next = applyDamage(victim, damage);
    victim.hp = next.hp;
    victim.armor = next.armor;
    victim.hurtAt = this.time(now);
    victim.scorch = Math.min(1, victim.scorch + damage / 160 + (kind === "flamer" || kind === "vent" ? damage / 60 : 0));
    if (attackerId && attackerId !== victim.id) {
      victim.lastHitBy = attackerId;
      victim.lastHitAt = this.time(now);
      victim.lastHitKind = kind;
    }
    if (kind === "pulverizer") victim.pulverized = true;
    if (kind === "flamer" && attackerId) {
      victim.burnUntil = this.time(now) + BURN_MS;
      victim.burnBy = attackerId;
    }
    this.hooks.impulse?.(victim.id, impulse[0], impulse[1], impulse[2], point[0], point[1], point[2]);
    const attacker = attackerId ? this.byId.get(attackerId) : undefined;
    this.hitFx(attacker ?? null, victim, damage, point, kind);
    if (damage >= 6) this.dent(victim, point, damage);
    if (victim.isMe) this.hooks.haptic?.(damage >= 15 ? "heavy" : damage >= 6 ? "medium" : "light");
    if (victim.hp <= 0 && before > 0) {
      const credit = attackerId ?? this.creditFor(victim, now);
      this.knockOut(victim, credit, "wreck", this.time(now), kind);
    }
  }

  /** Visual + audio + camera response to a hit (every client). */
  hitFx(attacker: TruckRuntime | null, victim: TruckRuntime, damage: number, point: [number, number, number], kind: HitKind): void {
    const [px, py, pz] = point;
    const nx = px - victim.pos.x;
    const nz = pz - victim.pos.z;
    const len = Math.hypot(nx, nz) || 1;
    if (kind !== "flamer" && kind !== "vent") {
      this.hooks.sparks?.(px, py, pz, nx / len, 0.6, nz / len, Math.min(1.6, 0.35 + damage / 16));
      this.hooks.sound?.(damage >= 16 ? "bigImpact" : kind === "hammer" ? "hammer" : "impact", Math.min(1, 0.4 + damage / 25), px, pz);
    }
    if (damage >= 3) {
      const mine = !!attacker?.isMe;
      this.hooks.damageNumber?.(px, py + 0.6, pz, damage, mine);
    }
    const involvesMe = victim.isMe || !!attacker?.isMe;
    const nearWatch = this.watching === victim.id || (attacker && this.watching === attacker.id);
    if (involvesMe || nearWatch) {
      this.addTrauma((damage / 30) * (involvesMe ? 1 : 0.5));
      if (damage >= 18 && !this.reduceMotion) this.hitStopUntil = performance.now() + 70;
    }
  }

  private dent(victim: TruckRuntime, point: [number, number, number], damage: number): void {
    if (victim.dents.length > 24) return;
    // World → truck-local (ignoring scale): inverse-rotate the offset.
    const v = _v.set(point[0] - victim.pos.x, point[1] - victim.pos.y, point[2] - victim.pos.z);
    v.applyQuaternion(_q.copy(victim.quat).invert());
    victim.dents.push({ x: v.x, y: v.y, z: v.z, depth: Math.min(0.14, 0.03 + damage / 220) });
  }

  /** Who gets the credit for a pit/hazard KO: the last attacker within CREDIT_MS. */
  creditFor(victim: TruckRuntime, now: number): string | null {
    return victim.lastHitBy && this.time(now) - victim.lastHitAt <= CREDIT_MS ? victim.lastHitBy : null;
  }

  /**
   * Marks a KO. Called by the owner (which then broadcasts it) or on a peer's
   * `ko` message (`remote`). Idempotent.
   */
  knockOut(victim: TruckRuntime, by: string | null, cause: KoCause, at: number, kind: HitKind | null = null, remote = false): void {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.koAt = at;
    victim.koCause = cause;
    victim.koBy = by;
    victim.firing = false;
    const attacker = by ? this.byId.get(by) : undefined;
    if (attacker && attacker.id !== victim.id) {
      attacker.kos += 1;
      if (!this.firstKoDone) attacker.firstKo = true;
      if (cause === "pit") attacker.pitKos += 1;
      const burning = victim.burnUntil > at && victim.burnBy === attacker.id;
      if (kind === "flamer" || (burning && cause === "wreck")) attacker.flameKos += 1;
    }
    this.firstKoDone = true;
    if (!remote && victim.local && !this.sim) {
      this.hooks.sendKo?.(victim.seat, attacker?.seat ?? -1, cause, at);
    }
    this.feed = [{ key: ++feedKey, at, victim: victim.id, by: attacker?.id ?? null, cause }, ...this.feed].slice(0, 5);
    this.callout = {
      key: ++calloutKey,
      text: victim.isMe ? "WRECKED" : cause === "pit" ? "PITTED!" : cause === "dc" ? "POWERED DOWN" : "KO!",
      tone: "ko",
      at: performance.now(),
    };
    this.hooks.sound?.("ko", 1, victim.pos.x, victim.pos.z);
    this.hooks.sparks?.(victim.pos.x, victim.pos.y + 0.5, victim.pos.z, 0, 1, 0, 2);
    if (cause !== "pit" && cause !== "dc") {
      for (let i = 0; i < 6; i++) this.hooks.debris?.(victim.pos.x, victim.pos.y + 0.4, victim.pos.z, 1.3, PAINTS[victim.loadout.paint]?.hex ?? "#888");
    }
    // KO cam on the wreck (a short one mid-match, the long one if it decided the round).
    const now = performance.now();
    const involvesMe = victim.isMe || attacker?.isMe;
    if (involvesMe || this.watching === victim.id || this.alive().length <= 1) {
      this.koCamId = victim.id;
      this.koCamUntil = now + (this.alive().length <= 1 ? OUTRO_MS : 1_600);
      if (!this.reduceMotion) this.slowMoUntil = now + (this.alive().length <= 1 ? 1_400 : 700);
    }
    this.addTrauma(involvesMe ? 0.8 : 0.35);
    if (victim.isMe) this.hooks.haptic?.("error");
    // The followed truck is gone: players follow whoever is still fighting, spectators go back to the TV camera.
    if (this.watching === victim.id) this.watching = this.me ? (this.alive()[0]?.id ?? victim.id) : null;
    this.bumpHud();
  }

  addTrauma(amount: number): void {
    const scaled = this.reduceMotion ? amount * 0.25 : amount;
    this.trauma = Math.min(1, this.trauma + scaled);
  }

  /** Ongoing burn damage (owner only) — called every frame with dt (s). */
  burnTick(t: TruckRuntime, dt: number, now: number, dps: number): void {
    if (!t.local || !t.alive) return;
    const time = this.time(now);
    if (t.burnUntil <= time) return;
    const acc = (t.flameAcc.get("_burn") ?? 0) + dps * dt;
    if (acc >= 2) {
      t.flameAcc.set("_burn", 0);
      this.applyHit(t.burnBy, t, acc, [0, 0, 0], [t.pos.x, t.pos.y + 0.4, t.pos.z], "flamer", now);
    } else t.flameAcc.set("_burn", acc);
  }

  /* Network in ----------------------------------------------------------- */

  /** A peer's packed state for `seat`. */
  receiveState(seat: number, senderT: number, state: NetTruck, now: number): void {
    const t = this.bySeat.get(seat);
    if (!t || t.local) return;
    t.clockOffset = t.clockOffset === null || now - senderT < t.clockOffset ? now - senderT : t.clockOffset + (now - senderT - t.clockOffset) * 0.02;
    t.lastPacketAt = now;
    if (!t.loadoutKnown || encodeLoadout(t.loadout) !== state.loadout) {
      const l = decodeLoadout(state.loadout);
      t.loadout = l;
      t.armorMax = ARMORS[l.armor].armor;
      t.loadoutKnown = true;
      this.bumpHud();
    }
    const snaps = t.snaps;
    const last = snaps[snaps.length - 1];
    if (!last || senderT > last.t) snaps.push({ t: senderT, s: { ...state } });
    if (snaps.length > 24) snaps.splice(0, snaps.length - 24);
    // The owner is the authority on health; dead flag KOs locally if we missed the `ko`.
    t.hp = state.hp;
    t.armor = state.armor;
    t.dmgDealt = Math.max(t.dmgDealt, state.dmg);
    if (state.hp < (t.net.hp ?? HP_MAX) - 0.5) t.hurtAt = this.time(now);
    Object.assign(t.net, state);
    t.hasNet = true;
  }

  /* Round end ------------------------------------------------------------- */

  /** Checks the end condition; returns true when the round just ended. */
  checkEnd(now: number): boolean {
    if (this.phase !== "fight") return false;
    const reason = roundOver(this.alive().length, this.trucks.length, this.time(now));
    if (!reason) return false;
    this.end(reason, now);
    return true;
  }

  end(reason: EndReason, now: number): void {
    if (this.phase !== "fight") return;
    this.phase = "outro";
    this.endReason = reason;
    this.endAt = now;
    for (const t of this.trucks) {
      t.firing = false;
      t.input.fire = false;
    }
    const alive = this.alive();
    if (reason === "time") {
      this.callout = { key: ++calloutKey, text: "TIME!", tone: "info", at: now };
      const leader = alive.sort((a, b) => b.hp + b.armor - (a.hp + a.armor))[0];
      if (leader && !this.koCamId) {
        this.koCamId = leader.id;
        this.koCamUntil = now + OUTRO_MS;
      }
    }
    this.bumpHud();
  }

  /** Final placements and scores, from this client's view of every truck. */
  finalize(): FinalRow[] {
    const standings: Standing[] = this.trucks.map((t) => ({
      id: t.id,
      seat: t.seat,
      alive: t.alive,
      hp: t.alive ? t.hp : 0,
      armor: t.alive ? t.armor : 0,
      koAt: t.koAt,
      dmg: t.dmgDealt,
    }));
    const ranks = placements(standings);
    const n = this.trucks.length;
    const rows = standings
      .map((s) => {
        const rank = ranks.get(s.id) ?? n;
        return { id: s.id, rank, score: scoreFor(rank, n, s.dmg, s.hp), hp: s.hp, dmg: s.dmg, alive: s.alive };
      })
      .sort((a, b) => a.rank - b.rank);
    this.results = rows;
    this.winnerId = rows[0]?.id ?? null;
    this.phase = "over";
    const winner = this.winnerId ? this.byId.get(this.winnerId) : undefined;
    this.callout = {
      key: ++calloutKey,
      text: winner ? (winner.isMe ? "YOU WIN" : `${winner.isBot ? winner.name : "@" + winner.handle} WINS`) : "DRAW",
      tone: "win",
      at: performance.now(),
    };
    this.bumpHud();
    return rows;
  }

  /* HUD ------------------------------------------------------------------ */

  subscribe = (listener: () => void): (() => void) => {
    this.hudListeners.add(listener);
    return () => this.hudListeners.delete(listener);
  };

  /** Marks the HUD dirty and notifies (the loop calls this ~12×/s, events call it right away). */
  bumpHud(): void {
    this.hudVersion++;
    this.hudCache = null;
    this.hudListeners.forEach((l) => l());
  }

  hud = (): HudSnapshot => {
    if (this.hudCache) return this.hudCache;
    const now = performance.now();
    const time = this.time(now);
    const me = this.me;
    const spec = me ? WEAPONS[me.loadout.weapon] : null;
    this.hudCache = {
      version: this.hudVersion,
      ready: this.started,
      phase: this.phase,
      remainingMs: this.phase === "fight" ? Math.max(0, ROUND_MS - time) : Math.max(0, ROUND_MS - this.time(this.endAt)),
      trucks: this.trucks.map((t) => ({
        id: t.id,
        seat: t.seat,
        name: t.name,
        handle: t.handle,
        avatarUrl: t.avatarUrl,
        isBot: t.isBot,
        isMe: t.isMe,
        color: PAINTS[t.loadout.paint]?.hex ?? "#fff",
        hp: t.alive ? t.hp : 0,
        armor: t.alive ? t.armor : 0,
        armorMax: t.armorMax,
        alive: t.alive,
        dmg: Math.round(t.dmgDealt),
        hurt: time - t.hurtAt < 350,
        weapon: t.loadout.weapon,
      })),
      me:
        me && spec
          ? {
              alive: me.alive,
              cooldown: me.loadout.weapon === "flamer" ? 1 - me.fuel : Math.min(1, me.cooldown / spec.cooldownMs),
              weaponReady: me.loadout.weapon === "flamer" ? me.fuel > 0.1 : me.cooldown <= 0,
              weapon: me.loadout.weapon,
              fuel: me.fuel,
              boost: me.boost,
              flipped: me.flipped,
              selfRightReady: me.selfRightCd <= 0,
              speed: Math.abs(me.speed),
            }
          : null,
      feed: this.feed,
      endReason: this.endReason,
      winnerId: this.winnerId,
      results: this.results,
      callout: this.callout && (this.callout.tone === "win" || now - this.callout.at < 1_700) ? this.callout : null,
      watching: this.watching,
    };
    return this.hudCache;
  };
}

const _v = new Vector3();
const _q = new Quaternion();
