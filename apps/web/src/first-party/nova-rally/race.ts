/**
 * A Grand Prix on this client: the racers (you, other live humans, the
 * platform's bots and CPU pilots filling the grid to eight), each race's
 * intro → countdown → race → results, items, pickups, hazards, projectiles,
 * slipstream, laps and places, the room traffic, the host HUD and submitting.
 *
 * Plain TypeScript (no React): the view calls `frame(dt)` every animation
 * frame; React re-renders from `subscribe` / `getSnapshot`.
 *
 * Multiplayer: every client simulates the ships it owns (its own, plus the
 * bots and CPU pilots on the conductor, the first human by seat) and streams
 * them; everyone simulates every projectile from its spawn message, and each
 * client only decides hits on its own ships. The conductor times each start
 * and has the final word on race results.
 */

import type { Json, MatchResult, PlayerInfo, XAppsClient } from "@xapps/sdk";
import { Vector3 } from "three";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { AiPilot, rubberBand, type AiView } from "./ai";
import { RaceAudio, type RaceSound } from "./audio";
import {
  BOX_LANES,
  BOX_RESPAWN,
  COIN_RESPAWN,
  ITEMS,
  MAX_COINS,
  hazardAt,
  hazardHits,
  projectileHits,
  rollItem,
  spawnProjectile,
  stepProjectile,
  type HazardState,
  type ItemId,
  type Projectile,
  type ProjectileKind,
} from "./items";
import {
  FIELD_SIZE,
  classScale,
  earnedAchievements,
  emptyRecord,
  gpStats,
  parseSettings,
  placeSuffix,
  pointsFor,
  submissionBody,
  type GpSettings,
  type RaceRecord,
} from "./logic";
import { DT, NO_CONTROLS, Ship, collideShips, tuningFor, type Controls } from "./physics";
import { LIVERY_SWATCHES, SHIPS, type ShipDesign } from "./ships";
import { compileTrack, deltaS, frameAt, trackPoint, wrapS, type CompiledTrack } from "./track";
import { trackById } from "./tracks";
import type { Livery } from "./types";

const TAG = "nova-rally";
const ignore = () => {};

export type Phase = "intro" | "countdown" | "race" | "finished" | "results" | "podium";
export type RacerKind = "me" | "human" | "bot" | "cpu";

const INTRO_S = 4.2;
const INTRO_REDUCED_S = 1.2;
const COUNTDOWN_S = 3.4;
const RESULTS_S = 9;
const SEND_EVERY = 0.1;
const CPU_NAMES = ["Vega", "Orion", "Lyra", "Juno", "Rigel", "Nova", "Castor", "Io", "Titan", "Kepler"];

export interface HeldItem {
  id: ItemId;
  uses: number;
}

export interface ShipChoice {
  design: number;
  livery: number;
}

interface NetState {
  s: number;
  d: number;
  h: number;
  speed: number;
  yaw: number;
  flags: number;
  lap: number;
  at: number;
}

export class Racer {
  readonly id: string;
  readonly idx: number;
  readonly name: string;
  readonly handle: string;
  readonly avatarUrl: string | null;
  readonly kind: RacerKind;
  local: boolean;
  design: ShipDesign;
  livery: Livery;
  designIndex: number;
  liveryIndex: number;
  ship!: Ship;
  ai: AiPilot | null;
  readonly prevPos = new Vector3();
  lap = -1;
  halfway = false;
  progress = 0;
  place = 0;
  finished = false;
  finishTime = 0;
  lapStart = 0;
  lapTimes: number[] = [];
  items: HeldItem[] = [];
  roulette = 0;
  points = 0;
  lastGain = 0;
  draft = 0;
  net: NetState | null = null;
  record: RaceRecord = emptyRecord("");
  /** Visual flags received for remote ships. */
  remoteFlags = 0;
  /** Seconds a CPU waits before reacting to the start. */
  startDelay = 0;
  rocketStart = false;
  gone = false;

  constructor(opts: {
    id: string;
    idx: number;
    name: string;
    handle: string;
    avatarUrl: string | null;
    kind: RacerKind;
    local: boolean;
    designIndex: number;
    liveryIndex: number;
    ai: AiPilot | null;
  }) {
    this.id = opts.id;
    this.idx = opts.idx;
    this.name = opts.name;
    this.handle = opts.handle;
    this.avatarUrl = opts.avatarUrl;
    this.kind = opts.kind;
    this.local = opts.local;
    this.designIndex = opts.designIndex;
    this.liveryIndex = opts.liveryIndex;
    this.design = SHIPS[opts.designIndex % SHIPS.length]!;
    this.livery = liveryFor(this.design, opts.liveryIndex);
    this.ai = opts.ai;
  }

  get isMe(): boolean {
    return this.kind === "me";
  }

  setDesign(designIndex: number, liveryIndex: number): void {
    this.designIndex = designIndex;
    this.liveryIndex = liveryIndex;
    this.design = SHIPS[designIndex % SHIPS.length]!;
    this.livery = liveryFor(this.design, liveryIndex);
  }
}

/** Livery -1 = the ship's own paint, else a swatch. */
export function liveryFor(design: ShipDesign, index: number): Livery {
  return index < 0 ? design.livery : (LIVERY_SWATCHES[index % LIVERY_SWATCHES.length] ?? design.livery);
}

export type Fx =
  | { type: "boom"; pos: Vector3; big: boolean }
  | { type: "sparks"; pos: Vector3; side: number; strength: number }
  | { type: "box"; pos: Vector3 }
  | { type: "coin"; pos: Vector3 }
  | { type: "turbo"; racer: number; tier: number }
  | { type: "pad"; racer: number }
  | { type: "land"; racer: number; strength: number }
  | { type: "shieldPop"; racer: number }
  | { type: "emp"; from: number }
  | { type: "warp"; racer: number }
  | { type: "hit"; racer: number }
  | { type: "splash"; pos: Vector3 }
  | { type: "finish"; racer: number };

export interface Callout {
  id: number;
  text: string;
  tone: "good" | "bad" | "info" | "big";
}

export interface StandingRow {
  idx: number;
  name: string;
  avatarUrl: string | null;
  kind: RacerKind;
  color: string;
  place: number;
  points: number;
  gain: number;
  time: number | null;
  isMe: boolean;
  designIndex: number;
  liveryIndex: number;
}

export interface HudSnapshot {
  phase: Phase;
  raceIndex: number;
  raceCount: number;
  trackId: string;
  trackName: string;
  trackIdNext: string | null;
  cupName: string;
  lap: number;
  laps: number;
  place: number;
  field: number;
  items: readonly HeldItem[];
  roulette: boolean;
  coins: number;
  countdown: number | null;
  callout: Callout | null;
  standings: readonly StandingRow[];
  raceTime: number;
  lastLap: number | null;
  bestLap: number | null;
  spectator: boolean;
  waiting: boolean;
  submitted: boolean;
  submitError: boolean;
  result: MatchResult | null;
  cc: number;
  finishedPlace: number | null;
  wrongWay: boolean;
}

export interface Input {
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
  lookBack: boolean;
}

interface SavedGp {
  v: 1;
  next: number;
  points: { [id: string]: number };
  records: RaceRecord[];
}

function nameOf(p: PlayerInfo, me: boolean): string {
  if (me) return "You";
  return p.isBot ? p.name : p.name?.trim() || `@${p.handle}`;
}

function conductorId(players: readonly PlayerInfo[]): string | null {
  return [...players].filter((p) => !p.isBot).sort((a, b) => a.seat - b.seat)[0]?.id ?? null;
}

export class RaceRuntime {
  readonly xapps: XAppsClient;
  readonly audio = new RaceAudio();
  readonly reduced: boolean;
  readonly spectator: boolean;
  readonly settings: GpSettings;
  readonly racers: Racer[] = [];
  readonly me: Racer | null;
  readonly live: boolean;
  readonly conductor: boolean;
  private readonly scale: ReturnType<typeof classScale>;

  raceIndex = 0;
  track: CompiledTrack;
  phase: Phase = "intro";
  /** Seconds into the current phase. */
  phaseTime = 0;
  phaseLength = INTRO_S;
  raceTime = 0;
  /** Race start in performance.now() ms (live sync), or null when free-running. */
  private startAt: number | null = null;
  private waitingForGo = false;
  input: Input = { steer: 0, throttle: 0, brake: 0, drift: false, lookBack: false };
  private throttleSince = -1;
  private acc = 0;
  alpha = 1;
  /** Bumped when a new race (track) starts so the renderer rebuilds. */
  raceSerial = 0;

  projectiles: Projectile[] = [];
  private projectileSeq = 0;
  hazards: HazardState[] = [];
  /** Per item-row box respawn timers (row × lane), seconds until back. */
  boxes: number[][] = [];
  coins: number[] = [];
  fx: Fx[] = [];
  empFlash = 0;

  private snapshot: HudSnapshot;
  private listeners = new Set<() => void>();
  private callout: Callout | null = null;
  private calloutId = 0;
  private lastEmit = 0;
  private sendClock = 0;
  private lastPlace = -1;
  private records: RaceRecord[] = [];
  private raceOrder: number[] | null = null;
  private resultsFrom: "local" | "conductor" = "local";
  private submitted = false;
  private submitError = false;
  private result: MatchResult | null = null;
  private disposed = false;
  private started = false;
  private endTimer = -1;
  private remoteSeen = new Map<string, number>();
  private wrongWay = 0;

  constructor(xapps: XAppsClient, reduced: boolean, choice: ShipChoice) {
    this.xapps = xapps;
    this.reduced = reduced;
    this.spectator = xapps.isSpectator;
    this.settings = parseSettings(xapps.match.settings);
    this.scale = classScale(this.settings.cc);
    const players = [...xapps.players].sort((a, b) => a.seat - b.seat);
    const humansOnline = players.filter((p) => !p.isBot && p.id !== xapps.me.id);
    this.live = xapps.match.mode === "live" && humansOnline.length > 0;
    const conductor = conductorId(players);
    this.conductor = !this.live || conductor === xapps.me.id;
    const rand = xapps.random.fork("grid");

    // Seats: everyone at the table who races on this client, then CPU pilots to fill eight.
    const used = new Set<number>();
    const pickDesign = () => {
      for (let k = 0; k < 20; k++) {
        const i = Math.floor(rand.next() * SHIPS.length);
        if (!used.has(i)) {
          used.add(i);
          return i;
        }
      }
      return Math.floor(rand.next() * SHIPS.length);
    };
    if (!this.spectator) used.add(choice.design);
    let idx = 0;
    for (const p of players) {
      const isMe = !this.spectator && p.id === xapps.me.id;
      if (!isMe && !p.isBot && !this.live) continue; // Async: absent humans race on their own time.
      const kind: RacerKind = isMe ? "me" : p.isBot ? "bot" : "human";
      const local = isMe || (kind === "bot" && this.conductor);
      const skill = (0.55 + rand.next() * 0.35) * this.scale.cpu;
      const design = isMe ? choice.design : pickDesign();
      this.racers.push(
        new Racer({
          id: p.id,
          idx: idx++,
          name: nameOf(p, isMe),
          handle: p.handle,
          avatarUrl: p.avatarUrl,
          kind,
          local,
          designIndex: design,
          liveryIndex: isMe ? choice.livery : -1,
          ai: kind === "bot" || kind === "me" ? new AiPilot(kind === "me" ? 0.7 : skill, () => rand.next()) : null,
        }),
      );
    }
    let cpu = 0;
    while (this.racers.length < FIELD_SIZE) {
      const skill = Math.min(0.98, (0.5 + rand.next() * 0.42) * this.scale.cpu);
      this.racers.push(
        new Racer({
          id: `cpu:${cpu}`,
          idx: idx++,
          name: CPU_NAMES[cpu % CPU_NAMES.length]!,
          handle: CPU_NAMES[cpu % CPU_NAMES.length]!.toLowerCase(),
          avatarUrl: null,
          kind: "cpu",
          local: this.conductor,
          designIndex: pickDesign(),
          liveryIndex: -1,
          ai: new AiPilot(skill, () => Math.random()),
        }),
      );
      cpu++;
    }
    this.me = this.racers.find((r) => r.isMe) ?? null;
    this.track = compileTrack(trackById(this.settings.cup.tracks[0]!));
    this.racers.forEach((r, slot) => {
      const g = this.track.grid(slot);
      r.ship = new Ship(this.track, tuningFor(r.design.stats), g.s, g.d);
      r.prevPos.copy(r.ship.pos);
    });
    this.snapshot = this.buildSnapshot();
  }

  get raceCount(): number {
    return this.settings.cup.tracks.length;
  }

  get storageKey(): string {
    return `gp:${this.xapps.match.id}`.slice(0, 64);
  }

  get sendRoom(): boolean {
    return this.live && !this.spectator;
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    let next = 0;
    if (!this.spectator && !this.live) {
      try {
        const saved = (await Promise.race([
          this.xapps.storage.get(this.storageKey),
          new Promise<null>((r) => setTimeout(() => r(null), 1500)),
        ])) as unknown as SavedGp | null;
        if (saved && saved.v === 1 && saved.next > 0 && saved.next < this.raceCount) {
          next = saved.next;
          this.records = saved.records ?? [];
          for (const r of this.racers) r.points = saved.points?.[r.id] ?? 0;
        }
      } catch {
        // Fresh Grand Prix.
      }
    }
    if (this.disposed) return;
    this.xapps.ui.setTurn(null).catch(ignore);
    this.sendHello();
    this.beginRace(next);
  }

  attach(): void {
    this.disposed = false;
    this.audio.attach();
  }

  detach(): void {
    this.disposed = true;
    this.audio.music(null);
    this.audio.detach();
  }

  private beginRace(index: number): void {
    this.raceIndex = index;
    this.track = compileTrack(trackById(this.settings.cup.tracks[index]!));
    const track = this.track;
    this.raceSerial++;
    this.projectiles = [];
    this.hazards = [];
    this.boxes = track.itemRows.map(() => BOX_LANES.map(() => 0));
    this.coins = track.coins.map(() => 0);
    this.raceTime = 0;
    this.raceOrder = null;
    this.resultsFrom = "local";
    this.endTimer = -1;
    this.throttleSince = -1;
    this.lastPlace = -1;
    this.empFlash = 0;
    this.wrongWay = 0;
    this.callout = null;

    // Grid: fewest points at the front of the grid... leaders start at the back.
    const order = [...this.racers].sort((a, b) => a.points - b.points || a.idx - b.idx);
    const rand = this.xapps.random.fork(`race:${index}`);
    if (index === 0) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand.next() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
    }
    order.forEach((r, slot) => {
      const g = track.grid(slot);
      const tune = tuningFor(r.design.stats);
      tune.top *= this.scale.speed;
      tune.accel *= this.scale.accel;
      r.ship = new Ship(track, tune, g.s, g.d);
      r.prevPos.copy(r.ship.pos);
      r.lap = -1;
      r.halfway = false;
      r.progress = g.s - track.length;
      r.finished = false;
      r.finishTime = 0;
      r.lapStart = 0;
      r.lapTimes = [];
      r.items = [];
      r.roulette = 0;
      r.draft = 0;
      r.net = null;
      r.lastGain = 0;
      r.rocketStart = false;
      r.record = emptyRecord(track.def.id);
      r.startDelay = r.isMe ? 0 : 0.05 + Math.random() * 0.35 * (1.2 - (r.ai?.skill ?? 0.6));
    });
    this.updatePlaces();

    this.phase = "intro";
    this.phaseTime = 0;
    this.phaseLength = this.reduced ? INTRO_REDUCED_S : INTRO_S;
    this.startAt = null;
    this.waitingForGo = this.live && !this.conductor;
    if (this.live && this.conductor) this.scheduleGo();
    this.audio.music(track.def.theme);
    this.audio.setIntensity(false);
    this.xapps.ui
      .setStatus(`${this.settings.cup.name} · Race ${index + 1}/${this.raceCount} · ${track.def.name}`)
      .catch(ignore);
    this.pushScores();
    this.emit(true);
  }

  private scheduleGo(): void {
    const lead = (this.reduced ? INTRO_REDUCED_S : INTRO_S) + COUNTDOWN_S;
    this.startAt = performance.now() + lead * 1000;
    this.sendGo();
  }

  private sendGo(): void {
    if (!this.sendRoom || this.startAt === null) return;
    const inMs = Math.round(this.startAt - performance.now());
    this.xapps.room.send("go", { r: this.raceIndex, in: inMs }).catch(ignore);
  }

  skipIntro(): void {
    if (this.phase !== "intro" || this.live) return;
    this.phaseTime = Math.max(this.phaseTime, this.phaseLength - 0.2);
  }

  /** Results screen: tap to move on (solo only). */
  continueResults(): void {
    if (this.phase === "results" && !this.live && this.phaseTime > 1.2) this.phaseTime = this.phaseLength;
  }

  /* ---------------------------------------------------------------- */
  /* HUD store                                                        */
  /* ---------------------------------------------------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  private standings(): StandingRow[] {
    const order = this.phase === "results" || this.phase === "podium" ? this.resultOrder() : [...this.racers].sort((a, b) => a.place - b.place);
    const rows = order.map((r, i) => ({
      idx: r.idx,
      name: r.name,
      avatarUrl: r.avatarUrl,
      kind: r.kind,
      color: r.livery.glow,
      place: i,
      points: r.points,
      gain: r.lastGain,
      time: r.finished ? r.finishTime : null,
      isMe: r.isMe,
      designIndex: r.designIndex,
      liveryIndex: r.liveryIndex,
    }));
    if (this.phase === "podium") rows.sort((a, b) => b.points - a.points || a.place - b.place);
    return rows.map((row, i) => ({ ...row, place: this.phase === "podium" ? i : row.place }));
  }

  private resultOrder(): Racer[] {
    if (this.raceOrder) return this.raceOrder.map((i) => this.racers[i]!).filter(Boolean);
    return [...this.racers].sort((a, b) => a.place - b.place);
  }

  private buildSnapshot(): HudSnapshot {
    const me = this.me;
    const countdown =
      this.phase === "countdown" ? Math.max(0, Math.ceil(this.phaseLength - this.phaseTime)) : this.phase === "race" && this.raceTime < 0.8 ? 0 : null;
    const best = me && me.lapTimes.length ? Math.min(...me.lapTimes) : null;
    return {
      phase: this.phase,
      raceIndex: this.raceIndex,
      raceCount: this.raceCount,
      trackId: this.track.def.id,
      trackName: this.track.def.name,
      trackIdNext: this.settings.cup.tracks[this.raceIndex + 1] ?? null,
      cupName: this.settings.cup.name,
      lap: me ? Math.max(1, Math.min(this.settings.laps, me.lap + 1)) : 1,
      laps: this.settings.laps,
      place: me?.place ?? 0,
      field: this.racers.length,
      items: me ? me.items.map((i) => ({ ...i })) : [],
      roulette: !!me && me.roulette > 0,
      coins: me?.ship.coins ?? 0,
      countdown,
      callout: this.callout,
      standings: this.standings(),
      raceTime: this.raceTime,
      lastLap: me?.lapTimes.at(-1) ?? null,
      bestLap: best,
      spectator: this.spectator,
      waiting: this.waitingForGo && this.phase === "intro" && this.phaseTime >= this.phaseLength,
      submitted: this.submitted,
      submitError: this.submitError,
      result: this.result,
      cc: this.settings.cc,
      finishedPlace: me?.finished ? me.place : null,
      wrongWay: this.wrongWay > 1.2,
    };
  }

  private emit(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastEmit < 120) return;
    this.lastEmit = now;
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  private say(text: string, tone: Callout["tone"] = "info"): void {
    this.callout = { id: ++this.calloutId, text, tone };
    this.emit(true);
  }

  private sfx(sound: RaceSound, racer?: Racer, volume = 1): void {
    if (racer && !racer.isMe) {
      const me = this.me;
      if (!me) return;
      const dist = racer.ship.pos.distanceTo(me.ship.pos);
      if (dist > 70) return;
      volume *= Math.max(0.1, 1 - dist / 70);
    }
    this.audio.play(sound, { volume });
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                            */
  /* ---------------------------------------------------------------- */

  frame(rawDt: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, rawDt));
    this.phaseTime += dt;
    this.empFlash = Math.max(0, this.empFlash - dt);

    if (this.phase === "intro") {
      if (this.startAt !== null) {
        const toGo = (this.startAt - performance.now()) / 1000;
        if (toGo <= COUNTDOWN_S) this.enterCountdown(COUNTDOWN_S - toGo);
      } else if (this.phaseTime >= this.phaseLength && !this.waitingForGo) {
        this.enterCountdown(0);
      }
      if (this.sendRoom && this.conductor && Math.floor(this.phaseTime) !== Math.floor(this.phaseTime - dt)) this.sendGo();
    } else if (this.phase === "countdown") {
      const before = Math.ceil(this.phaseLength - (this.phaseTime - dt));
      const now = Math.ceil(this.phaseLength - this.phaseTime);
      if (now !== before && now > 0 && now <= 3) this.audio.play("countdown");
      if (this.input.throttle > 0.5 && this.throttleSince < 0) this.throttleSince = this.phaseLength - this.phaseTime;
      if (this.input.throttle <= 0.5) this.throttleSince = -1;
      if (this.phaseTime >= this.phaseLength) this.go();
      if (this.startAt !== null && performance.now() >= this.startAt && this.phase === "countdown") this.go();
    }

    if (this.phase === "race" || this.phase === "finished") {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= DT && steps < 6) {
        this.tick();
        this.acc -= DT;
        steps++;
      }
      if (steps >= 6) this.acc = 0;
      this.alpha = this.acc / DT;
      this.checkRaceEnd(dt);
      this.sendClock += dt;
      if (this.sendRoom && this.sendClock >= SEND_EVERY) {
        this.sendClock = 0;
        this.sendStates();
      }
      this.updateRemote(dt);
      this.engineSound();
    } else {
      this.alpha = 1;
      this.updateRemote(dt);
      if (this.phase === "countdown" && this.me) {
        this.audio.engine({ speed01: 0, throttle: this.input.throttle, boost: 0, drifting: false, driftTier: 0, airborne: false });
      }
    }

    if (this.phase === "results" && this.phaseTime >= this.phaseLength) {
      if (this.raceIndex + 1 < this.raceCount) this.beginRace(this.raceIndex + 1);
      else this.enterPodium();
    }
    this.emit();
  }

  private enterCountdown(elapsed: number): void {
    this.phase = "countdown";
    this.phaseTime = Math.max(0, elapsed);
    this.phaseLength = COUNTDOWN_S;
    this.waitingForGo = false;
    this.emit(true);
  }

  private go(): void {
    this.phase = "race";
    this.phaseTime = 0;
    this.raceTime = 0;
    this.acc = 0;
    this.audio.play("go");
    for (const r of this.racers) {
      if (!r.local) continue;
      r.lapStart = 0;
      if (r.isMe) {
        const t = this.throttleSince;
        if (t > 0 && t <= 1.15 && t >= 0.25) {
          r.ship.addBoost(1.3, 1.1);
          r.rocketStart = true;
          r.record.rocketStart = true;
          this.audio.play("rocketStart");
          this.say("Rocket start!", "good");
        } else if (t > 1.7) {
          r.ship.hit("spin", 0.9);
          this.audio.play("stall");
          this.say("Overheated!", "bad");
        }
      } else if (r.ai && Math.random() < r.ai.skill * 0.6) {
        r.ship.addBoost(1.1, 1);
      }
    }
    this.emit(true);
  }

  /* ---------------------------------------------------------------- */
  /* Simulation                                                       */
  /* ---------------------------------------------------------------- */

  private tick(): void {
    const track = this.track;
    this.raceTime += DT;
    this.hazards = track.hazards.map((h) => hazardAt(h, track, this.raceTime));

    for (const r of this.racers) {
      r.prevPos.copy(r.ship.pos);
      if (!r.local) continue;
      const ship = r.ship;
      let controls: Controls = NO_CONTROLS;
      let fire = false;
      let backward = false;
      if (this.raceTime < r.startDelay && !r.isMe) {
        controls = NO_CONTROLS;
      } else if (r.isMe && !r.finished && !this.autopilot) {
        controls = { steer: this.input.steer, throttle: this.input.throttle, brake: this.input.brake, drift: this.input.drift };
        fire = this.fireQueued;
        backward = this.input.brake > 0.5 || this.input.lookBack;
      } else if (r.ai) {
        const dec = r.ai.think(ship, this.aiView(r), DT);
        controls = dec.controls;
        fire = dec.useItem && (!r.isMe || this.autopilot);
        backward = dec.backward;
      }
      if (r.isMe) this.fireQueued = false;
      if (fire) this.useItem(r, backward);

      ship.step(controls);
      this.onShipEvents(r);
      this.checkLap(r);

      if (r.roulette > 0) {
        r.roulette -= DT;
        if (r.roulette <= 0) {
          r.roulette = 0;
          const leaderHas = this.racers.some((o) => o.items.some((i) => i.id === "singularity")) || this.projectiles.some((p) => p.kind === "singularity");
          const id = rollItem(r.place, this.racers.length, Math.random(), leaderHas);
          r.items.push({ id, uses: ITEMS[id].uses });
          if (r.isMe) {
            this.audio.play("rouletteStop");
            this.emit(true);
          }
        }
      }

      // Rubber-band CPU pilots toward the best human.
      if (!r.isMe && r.ai) {
        const humans = this.racers.filter((o) => o.kind === "me" || o.kind === "human");
        const best = humans.length ? Math.max(...humans.map((h) => h.progress)) : r.progress;
        const tune = tuningFor(r.design.stats);
        ship.tune.top = tune.top * this.scale.speed * rubberBand(r.ai.skill, r.progress - best, track.length);
      }

      this.slipstream(r);
      this.pickups(r);
      this.hazardHits(r);
    }

    // Boxes on the road vanish for remote ships too.
    for (const r of this.racers) if (!r.local) this.pickups(r, true);

    // Ship vs ship.
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i]!;
        const b = this.racers[j]!;
        if (!a.local && !b.local) continue;
        if (a.ship.cloak > 0 || b.ship.cloak > 0) continue;
        const saved = !b.local ? { s: b.ship.s, d: b.ship.d, speed: b.ship.speed } : !a.local ? { s: a.ship.s, d: a.ship.d, speed: a.ship.speed } : null;
        const hit = collideShips(a.ship, b.ship);
        if (saved) {
          const remote = !b.local ? b.ship : a.ship;
          remote.s = saved.s;
          remote.d = saved.d;
          remote.speed = saved.speed;
        }
        if (hit > 0.15 && (a.isMe || b.isMe)) this.audio.play("bump", { volume: Math.min(1, hit) });
      }
    }

    // Projectiles.
    for (const p of this.projectiles) {
      const target = p.target ? this.racers.find((r) => r.id === p.target) : p.kind === "singularity" ? this.leader() : null;
      stepProjectile(p, track, DT, target ? { s: target.ship.s, d: target.ship.d, visible: target.ship.cloak <= 0 } : null);
      if (p.dead) continue;
      if (p.kind === "singularity" && p.boom >= 0 && p.boom < DT * 1.5) {
        this.fx.push({ type: "boom", pos: this.worldOf(p.s, p.d, 2), big: true });
        this.sfx("singularity", undefined, 1);
      }
      for (const r of this.racers) {
        if (!r.local || r.ship.state === "fall" || r.ship.state === "tow") continue;
        if (p.kind !== "singularity" && r.id === p.owner && p.age < 0.6) continue;
        if (r.ship.cloak > 0 && p.kind !== "singularity") continue;
        if (!projectileHits(p, r.ship.s, r.ship.d, r.ship.h, track.length)) continue;
        const kind = p.kind === "bolt" ? "spin" : "blast";
        const shielded = r.ship.shield > 0 && p.kind !== "singularity";
        if (p.kind === "singularity") r.ship.shield = 0;
        const landed = r.ship.hit(kind, p.kind === "singularity" ? 1.8 : kind === "blast" ? 1.4 : 1.1);
        this.onHit(r, landed, shielded, p.owner, p.kind);
        if (p.kind !== "singularity") {
          p.dead = true;
          this.fx.push({ type: "boom", pos: r.ship.pos.clone(), big: p.kind !== "bolt" });
          this.sendFx({ k: "x", id: p.id });
          break;
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    // Boxes and coins come back.
    for (const row of this.boxes) for (let k = 0; k < row.length; k++) row[k] = Math.max(0, row[k]! - DT);
    for (let k = 0; k < this.coins.length; k++) this.coins[k] = Math.max(0, this.coins[k]! - DT);

    this.updatePlaces();
    const me = this.me;
    if (me && !me.finished) {
      if (me.place !== this.lastPlace) {
        if (this.lastPlace >= 0 && this.raceTime > 2) this.audio.play(me.place < this.lastPlace ? "positionUp" : "positionDown", { volume: 0.5 });
        this.lastPlace = me.place;
        me.record.worstPlace = Math.max(me.record.worstPlace, this.raceTime > 5 ? me.place : 0);
      }
      const err = Math.abs(me.ship.headingError);
      this.wrongWay = err > 2.1 && me.ship.state === "drive" ? this.wrongWay + DT : 0;
    }
  }

  private fireQueued = false;
  /** Debug/attract: the CPU flies your ship. */
  autopilot = false;

  /** Debug: run the simulation forward without rendering (dt steps of 1/60 s). */
  fastForward(seconds: number): void {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) this.frame(1 / 60);
  }

  /** The player pressed the item button. */
  fire(): void {
    if (this.phase === "race" && this.me && !this.me.finished) this.fireQueued = true;
  }

  private aiView(r: Racer): AiView {
    const track = this.track;
    const others = this.racers
      .filter((o) => o !== r)
      .map((o) => ({
        s: o.ship.s,
        d: o.ship.d,
        speed: o.ship.speed,
        ahead: o.progress > r.progress,
        gapProgress: o.progress - r.progress,
        visible: o.ship.cloak <= 0,
      }));
    const dangers: { s: number; d: number; r: number }[] = [];
    for (const p of this.projectiles) if (p.kind === "mine") dangers.push({ s: p.s, d: p.d, r: 2.4 });
    this.hazards.forEach((h) => {
      if (h.radius > 0 || h.warn > 0.4) dangers.push({ s: h.s, d: h.d, r: Math.max(3, h.radius) });
    });
    const boxes: { s: number; d: number }[] = [];
    if (r.items.length === 0 && r.roulette <= 0) {
      track.itemRows.forEach((s, row) => {
        const i = Math.floor(wrapS(s, track.length) / track.step) % track.count;
        BOX_LANES.forEach((lane, k) => {
          if (this.boxes[row]![k]! <= 0) boxes.push({ s, d: lane * track.halfWidth[i]! });
        });
      });
    }
    const threatened = this.projectiles.some((p) => p.kind === "seeker" && p.target === r.id && deltaS(p.s, r.ship.s, track.length) < 50);
    return { track, others, dangers, boxes, threatened, item: r.roulette > 0 ? null : (r.items[0]?.id ?? null), place: r.place, field: this.racers.length };
  }

  private onShipEvents(r: Racer): void {
    const me = r.isMe;
    for (const e of r.ship.events) {
      switch (e.type) {
        case "wall":
          if (e.strength > 0.15) this.fx.push({ type: "sparks", pos: r.ship.pos.clone(), side: e.side, strength: e.strength });
          if (me) this.audio.play("wallHit", { volume: 0.4 + e.strength * 0.6, pan: e.side * 0.6 });
          break;
        case "pad":
          this.fx.push({ type: "pad", racer: r.idx });
          if (me) {
            this.audio.play("boostPad");
            this.audio.play("boost");
          } else this.sfx("boostPad", r, 0.5);
          break;
        case "ramp":
          if (me) this.audio.play("jump");
          break;
        case "chargeJump":
          this.fx.push({ type: "land", racer: r.idx, strength: 0.5 });
          if (me) this.audio.play("jump");
          break;
        case "land":
          this.fx.push({ type: "land", racer: r.idx, strength: e.strength });
          if (e.trick) {
            r.record.tricks++;
            if (me) {
              this.audio.play("trick");
              this.say("Trick boost!", "good");
            }
          }
          if (me && e.strength > 0.3) this.audio.play("land", { volume: e.strength });
          break;
        case "driftStart":
          if (me) this.audio.play("driftStart", { volume: 0.6 });
          break;
        case "tier":
          if (me) this.audio.play(e.tier === 1 ? "miniTurbo1" : e.tier === 2 ? "miniTurbo2" : "miniTurbo3", { volume: 0.35 });
          break;
        case "turbo":
          r.record.turbos++;
          if (e.tier === 3) r.record.purpleTurbos++;
          this.fx.push({ type: "turbo", racer: r.idx, tier: e.tier });
          if (me) {
            this.audio.play(e.tier === 1 ? "miniTurbo1" : e.tier === 2 ? "miniTurbo2" : "miniTurbo3");
            if (e.tier === 3) this.say("Ultra turbo!", "good");
          } else this.sfx("boost", r, 0.4);
          break;
        case "fall":
          r.record.falls++;
          r.ship.coins = Math.max(0, r.ship.coins - 3);
          if (me) {
            this.audio.play("fall");
            this.say("Lost in space!", "bad");
          }
          break;
        case "respawn":
          if (me) this.audio.play("respawn");
          break;
      }
    }
  }

  private checkLap(r: Racer): void {
    const track = this.track;
    const L = track.length;
    const s = r.ship.s;
    if (s > L * 0.35 && s < L * 0.65) r.halfway = true;
    const prev = r.progress - (r.lap < 0 ? -L : r.lap * L);
    // Crossing the line forward: s wrapped from near L to near 0.
    if (r.ship.state !== "tow" && prev > L * 0.8 && s < L * 0.2) {
      if (r.halfway || r.lap < 0) {
        const now = this.raceTime;
        if (r.lap >= 0) r.lapTimes.push(now - r.lapStart);
        r.lap++;
        r.lapStart = now;
        r.halfway = false;
        if (r.lap >= this.settings.laps && !r.finished) this.finishRacer(r, now);
        else if (r.isMe && r.lap > 0) {
          if (r.lap === this.settings.laps - 1) {
            this.say("Final lap!", "big");
            this.audio.play("finalLap");
            this.audio.setIntensity(true);
          } else {
            this.say(`Lap ${r.lap + 1}`, "info");
            this.audio.play("lap");
          }
        }
      } else {
        // Crossed without going round: count it as behind the line still.
        r.lap = Math.max(r.lap, 0);
      }
    } else if (prev < L * 0.2 && s > L * 0.8 && r.lap >= 0) {
      // Reversed over the line.
      r.lap--;
    }
    r.progress = (r.lap < 0 ? -L : r.lap * L) + s;
    if (r.lap < 0 && s < L * 0.5) r.progress = s; // shouldn't happen, but keep monotone
    if (r.finished) r.progress = this.settings.laps * L + (this.racers.length - r.place);
  }

  private finishRacer(r: Racer, time: number): void {
    r.finished = true;
    r.finishTime = time;
    r.record.time = time;
    r.record.bestLap = r.lapTimes.length ? Math.min(...r.lapTimes) : Infinity;
    this.updatePlaces();
    this.fx.push({ type: "finish", racer: r.idx });
    if (this.sendRoom) this.xapps.room.send("fin", { r: this.raceIndex, i: r.idx, t: Math.round(time * 1000) }).catch(ignore);
    if (r.isMe) {
      this.phase = "finished";
      this.phaseTime = 0;
      r.record.place = r.place;
      this.audio.play("finish");
      setTimeout(() => this.audio.play(r.place <= 2 ? "win" : "lose"), 900);
      this.say(r.place === 0 ? "1st place!" : `${placeSuffix(r.place + 1)} place`, r.place <= 2 ? "big" : "info");
      this.xapps.ui.setStatus(`Finished ${placeSuffix(r.place + 1)} on ${this.track.def.name}`).catch(ignore);
      this.emit(true);
    }
  }

  private updatePlaces(): void {
    const sorted = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    sorted.forEach((r, i) => (r.place = i));
  }

  private leader(): Racer | null {
    return this.racers.find((r) => r.place === 0 && !r.finished) ?? this.racers.filter((r) => !r.finished).sort((a, b) => a.place - b.place)[0] ?? null;
  }

  private slipstream(r: Racer): void {
    const ship = r.ship;
    if (ship.state !== "drive" || ship.speed < 40 || ship.boost > 0) {
      r.draft = Math.max(0, r.draft - DT * 2);
      return;
    }
    let drafting = false;
    for (const o of this.racers) {
      if (o === r) continue;
      const gap = deltaS(ship.s, o.ship.s, this.track.length);
      if (gap > 4 && gap < 32 && Math.abs(o.ship.d - ship.d) < 3.2 && Math.abs(o.ship.h - ship.h) < 3) {
        drafting = true;
        break;
      }
    }
    r.draft = drafting ? r.draft + DT : Math.max(0, r.draft - DT * 1.5);
    if (r.draft > 1.4) {
      r.draft = 0;
      ship.addBoost(0.9, 0.9);
      if (r.isMe) {
        this.audio.play("whoosh");
        this.say("Slipstream!", "good");
      }
    }
  }

  private pickups(r: Racer, remote = false): void {
    const track = this.track;
    const ship = r.ship;
    if (ship.state === "fall" || ship.state === "tow" || ship.h > 4) return;
    track.itemRows.forEach((s, row) => {
      const gap = deltaS(s, ship.s, track.length);
      if (Math.abs(gap) > 2.4) return;
      const i = Math.floor(wrapS(s, track.length) / track.step) % track.count;
      BOX_LANES.forEach((lane, k) => {
        if (this.boxes[row]![k]! > 0) return;
        if (Math.abs(lane * track.halfWidth[i]! - ship.d) > 2.6) return;
        this.boxes[row]![k] = BOX_RESPAWN;
        this.fx.push({ type: "box", pos: this.worldOf(s, lane * track.halfWidth[i]!, 1.4) });
        if (remote) return;
        if (r.items.length < 2 && r.roulette <= 0) {
          r.roulette = r.isMe ? 1.25 : 0.6;
          if (r.isMe) {
            this.audio.play("itemBox");
            this.audio.play("roulette");
            this.emit(true);
          }
        } else if (r.isMe) this.audio.play("itemBox", { volume: 0.5 });
      });
    });
    if (remote) return;
    track.coins.forEach((c, k) => {
      if (this.coins[k]! > 0) return;
      const i = Math.floor(wrapS(c.s, track.length) / track.step) % track.count;
      const cd = c.d * track.halfWidth[i]!;
      if (Math.abs(deltaS(c.s, ship.s, track.length)) > 2 || Math.abs(cd - ship.d) > 2.2) return;
      this.coins[k] = COIN_RESPAWN;
      ship.coins = Math.min(MAX_COINS, ship.coins + 1);
      r.record.maxCoins = Math.max(r.record.maxCoins, ship.coins);
      this.fx.push({ type: "coin", pos: this.worldOf(c.s, cd, 1.2) });
      if (r.isMe) {
        this.audio.play("coin", { volume: 0.7 });
        this.emit(true);
      }
    });
  }

  private hazardHits(r: Racer): void {
    const ship = r.ship;
    if (ship.state !== "drive" || ship.cloak > 0) return;
    const track = this.track;
    this.hazards.forEach((h, k) => {
      const kind = track.hazards[k]!.item.kind;
      if (!hazardHits(h, ship.s, ship.d, ship.h, track.length, kind)) return;
      const shielded = ship.shield > 0;
      const landed = ship.hit(h.effect, h.effect === "blast" ? 1.3 : 1);
      if (kind === "meteor" || kind === "asteroid") this.fx.push({ type: "boom", pos: ship.pos.clone(), big: kind === "meteor" });
      this.onHit(r, landed, shielded, null, null);
    });
  }

  private onHit(r: Racer, landed: boolean, shielded: boolean, by: string | null, kind: ProjectileKind | null): void {
    if (shielded) {
      this.fx.push({ type: "shieldPop", racer: r.idx });
      this.sfx("shieldPop", r);
      return;
    }
    if (!landed) return;
    r.record.timesHit++;
    r.ship.coins = Math.max(0, r.ship.coins - 2);
    this.fx.push({ type: "hit", racer: r.idx });
    this.sfx(kind === "bolt" || kind === null ? "spinout" : "explosion", r);
    if (r.isMe) {
      this.say(kind === "singularity" ? "Sucked into a singularity!" : "Hit!", "bad");
      this.xapps.ui.haptic("heavy").catch(ignore);
    }
    if (by) {
      const shooter = this.racers.find((o) => o.id === by);
      if (shooter?.local) {
        shooter.record.hitsLanded++;
        if (kind === "singularity" && r.place === 0) shooter.record.singularityOnLeader = true;
        if (shooter.isMe) this.say(`Hit ${r.name}!`, "good");
      } else if (this.sendRoom) {
        this.sendFx({ k: "hit", by, v: r.idx, kind: kind ?? "" });
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* Items                                                            */
  /* ---------------------------------------------------------------- */

  private useItem(r: Racer, backward: boolean): void {
    const held = r.items[0];
    if (!held || r.roulette > 0 || r.ship.state === "fall" || r.ship.state === "tow") return;
    const ship = r.ship;
    held.uses--;
    if (held.uses <= 0) r.items.shift();
    if (r.isMe) this.emit(true);
    const me = r.isMe;
    switch (held.id) {
      case "nitro":
      case "nitro3":
        ship.addBoost(1.25, 1.15);
        this.fx.push({ type: "turbo", racer: r.idx, tier: 2 });
        if (me) this.audio.play("boost");
        else this.sfx("boost", r, 0.5);
        break;
      case "shield":
        ship.shield = 10;
        this.sfx("shieldUp", r);
        break;
      case "warp":
        ship.startWarp(3.4);
        this.fx.push({ type: "warp", racer: r.idx });
        this.sfx("warp", r);
        if (me) this.say("Warp drive!", "good");
        break;
      case "cloak": {
        ship.cloak = 6;
        this.sfx("cloak", r);
        const victims = this.racers.filter((o) => o !== r && o.place < r.place && o.items.length > 0 && o.roulette <= 0);
        const victim = victims[Math.floor(Math.random() * victims.length)];
        if (victim && r.items.length < 2) {
          if (victim.local) {
            const stolen = victim.items.shift()!;
            r.items.push(stolen);
            if (victim.isMe) this.say(`${r.name} stole your ${ITEMS[stolen.id].name}!`, "bad");
            if (me) this.say(`Stole ${ITEMS[stolen.id].name}!`, "good");
          } else {
            this.sendFx({ k: "steal", v: victim.idx });
            r.items.push({ id: "nitro", uses: 1 });
          }
        }
        break;
      }
      case "emp": {
        this.fx.push({ type: "emp", from: r.idx });
        this.empFlash = 1;
        this.audio.play("empZap");
        this.applyEmp(r);
        this.sendFx({ k: "emp", o: r.idx });
        break;
      }
      case "seeker":
      case "bolt":
      case "bolt3":
      case "mine":
      case "singularity": {
        const kind: ProjectileKind = held.id === "bolt3" ? "bolt" : held.id;
        const back = backward && kind !== "singularity" && kind !== "seeker";
        let target: string | null = null;
        if (kind === "seeker") {
          const ahead = this.racers.filter((o) => o.place === r.place - 1)[0];
          target = ahead?.id ?? null;
        }
        const dir: 1 | -1 = kind === "mine" ? (backward ? -1 : 1) : back ? -1 : 1;
        let s = ship.s + (kind === "mine" ? (dir === 1 && this.input.throttle > 0 && me && !backward ? 0 : -4.5) : dir * 4);
        if (kind === "mine" && me && !backward && this.input.throttle > 0.5 && this.input.steer === 0) s = ship.s - 4.5;
        const vd = kind === "bolt" ? Math.sin(ship.headingError) * 60 * dir : 0;
        const id = `${r.idx}:${++this.projectileSeq}`;
        const p = spawnProjectile(kind, id, r.id, target, wrapS(s, this.track.length), ship.d, dir, vd);
        if (kind === "mine") p.s = wrapS(ship.s - 4.5, this.track.length);
        this.projectiles.push(p);
        this.sendFx({ k: "p", id, kind, o: r.idx, t: target ? (this.racers.find((o) => o.id === target)?.idx ?? -1) : -1, s: p.s, d: p.d, dir, vd });
        this.sfx(kind === "seeker" ? "missile" : kind === "mine" ? "mineDrop" : kind === "singularity" ? "singularity" : "fire", r, me ? 1 : 0.6);
        break;
      }
    }
  }

  private applyEmp(from: Racer): void {
    for (const o of this.racers) {
      if (!o.local || o === from || o.place >= from.place) continue;
      if (o.ship.state === "warp") continue;
      if (o.ship.shield > 0) {
        o.ship.shield = 0;
        this.fx.push({ type: "shieldPop", racer: o.idx });
        continue;
      }
      o.ship.shocked = 4;
      o.ship.hit("spin", 0.7);
      o.items = o.items.filter((i) => i.id !== "shield");
      if (o.isMe) {
        this.say("EMP! Systems down", "bad");
        this.empFlash = 1;
      }
    }
    if (from.local) from.record.hitsLanded += this.racers.filter((o) => o.place < from.place).length > 0 ? 1 : 0;
  }

  /* ---------------------------------------------------------------- */
  /* Race end                                                         */
  /* ---------------------------------------------------------------- */

  private checkRaceEnd(dt: number): void {
    const humans = this.racers.filter((r) => r.kind === "me" || r.kind === "human");
    const leaderDone = this.racers.find((r) => r.finished);
    const allHumansDone = humans.every((r) => r.finished || r.gone);
    if (this.endTimer < 0) {
      if (allHumansDone && humans.length > 0) this.endTimer = this.live ? 3 : 2.6;
      else if (leaderDone && this.raceTime - leaderDone.finishTime > 50) this.endTimer = 0.5;
      else if (humans.length === 0 && this.racers.every((r) => r.finished)) this.endTimer = 1;
      else if (this.spectator && leaderDone && this.raceTime - leaderDone.finishTime > 20) this.endTimer = 0.5;
    } else {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.endRace();
    }
  }

  private endRace(): void {
    if (this.phase === "results") return;
    const L = this.track.length;
    const laps = this.settings.laps;
    // Everyone still racing gets an estimated time from their pace.
    for (const r of this.racers) {
      if (r.finished) continue;
      const remaining = Math.max(0, laps * L - r.progress);
      const pace = Math.max(35, r.ship.tune.top * 0.85);
      r.finishTime = this.raceTime + remaining / pace + 0.5;
    }
    let order = [...this.racers].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.progress - a.progress;
    });
    if (this.raceOrder && this.resultsFrom === "conductor") order = this.raceOrder.map((i) => this.racers[i]!);
    this.raceOrder = order.map((r) => r.idx);
    if (this.live && this.conductor && this.sendRoom) this.xapps.room.send("res", { r: this.raceIndex, o: this.raceOrder }).catch(ignore);
    this.applyResults();
    this.phase = "results";
    this.phaseTime = 0;
    this.phaseLength = RESULTS_S;
    this.audio.setIntensity(false);
    this.audio.music("menu");
    if (this.me) {
      this.me.record.place = order.indexOf(this.me);
      this.records[this.raceIndex] = { ...this.me.record };
    }
    this.save();
    this.pushScores();
    this.emit(true);
  }

  private applyResults(): void {
    const order = this.raceOrder ?? [];
    for (const r of this.racers) {
      r.points -= r.lastGain;
      r.lastGain = 0;
    }
    order.forEach((idx, place) => {
      const r = this.racers[idx];
      if (!r) return;
      r.lastGain = pointsFor(place);
      r.points += r.lastGain;
      r.place = place;
    });
  }

  private enterPodium(): void {
    this.phase = "podium";
    this.phaseTime = 0;
    this.phaseLength = Infinity;
    this.audio.music("menu");
    this.emit(true);
    this.finishGp();
  }

  private gpOrder(): Racer[] {
    return [...this.racers].sort((a, b) => b.points - a.points || a.place - b.place);
  }

  private finishGp(): void {
    const order = this.gpOrder();
    const me = this.me;
    if (me && !this.spectator && !this.submitted) {
      const place = order.indexOf(me);
      const records = this.records.filter(Boolean);
      reportStats(this.xapps, gpStats(records, place), TAG);
      unlockAchievements(this.xapps, earnedAchievements(records, { place, complete: true }), TAG);
      this.audio.play(place === 0 ? "win" : "lose");
      this.submitNow();
    }
    // The conductor submits for the platform's bots.
    if (this.conductor && !this.spectator) {
      for (const r of this.racers) {
        if (r.kind !== "bot") continue;
        if (this.xapps.player(r.id)?.submitted) continue;
        this.xapps
          .submitFor(r.id, {
            score: r.points,
            data: { points: r.points },
            display: { kind: "text", title: `${r.points} pts`, body: `${placeSuffix(order.indexOf(r) + 1)} overall` },
          })
          .catch((error: unknown) => console.warn(`[${TAG}] bot submit failed`, error));
      }
    }
  }

  submitNow(): void {
    const me = this.me;
    if (!me || this.xapps.me.submitted) return;
    const order = this.gpOrder();
    const place = order.indexOf(me);
    const races = this.records.filter(Boolean).map((r) => ({ track: r.track, place: r.place }));
    this.submitError = false;
    this.xapps
      .submit({
        score: me.points,
        data: { points: me.points, cup: this.settings.cup.id, cc: this.settings.cc, races: races.map((r) => [r.track, r.place]) },
        display: { kind: "text", title: `${me.points} pts`, body: submissionBody(me.points, place, races) },
      })
      .then(
        () => {
          this.submitted = true;
          this.xapps.storage.delete(this.storageKey).catch(ignore);
          this.emit(true);
        },
        (error: unknown) => {
          console.error(`[${TAG}] submit failed`, error);
          this.submitError = true;
          this.submitted = false;
          this.emit(true);
        },
      );
    this.submitted = true;
    this.emit(true);
  }

  onResult(result: MatchResult): void {
    if (this.result) return;
    this.result = result;
    if (this.me && !this.spectator && result.winnerId === this.me.id) {
      unlockAchievements(this.xapps, ["first_win"], TAG);
    }
    this.emit(true);
  }

  private pushScores(): void {
    const scores: { [id: string]: string } = {};
    for (const r of this.racers) if (r.kind !== "cpu") scores[r.id] = `${r.points} pts`;
    this.xapps.ui.setScores(scores).catch(ignore);
  }

  private save(): void {
    if (this.spectator || !this.me || this.live) return;
    const value: SavedGp = {
      v: 1,
      next: this.raceIndex + 1,
      points: Object.fromEntries(this.racers.map((r) => [r.id, r.points])),
      records: this.records,
    };
    this.xapps.storage.set(this.storageKey, value as unknown as Json).catch(ignore);
  }

  /* ---------------------------------------------------------------- */
  /* Network                                                          */
  /* ---------------------------------------------------------------- */

  private sendHello(): void {
    if (!this.sendRoom || !this.me) return;
    this.xapps.room.send("hi", { d: this.me.designIndex, l: this.me.liveryIndex }).catch(ignore);
  }

  private sendFx(payload: { [key: string]: Json }): void {
    if (!this.sendRoom) return;
    this.xapps.room.send("fx", { ...payload, r: this.raceIndex }).catch(ignore);
  }

  private sendStates(): void {
    const rows: number[][] = [];
    for (const r of this.racers) {
      if (!r.local) continue;
      const s = r.ship;
      const flags =
        (s.boost > 0 ? 1 : 0) |
        (s.driftTier << 1) |
        (s.shield > 0 ? 8 : 0) |
        (s.cloak > 0 ? 16 : 0) |
        (s.state === "warp" ? 32 : 0) |
        (s.state === "spin" ? 64 : 0) |
        (s.state === "fall" || s.state === "tow" ? 128 : 0) |
        (r.finished ? 256 : 0) |
        (s.driftDir !== 0 ? 512 : 0) |
        (s.driftDir > 0 ? 1024 : 0);
      rows.push([r.idx, round(s.s, 1), round(s.d, 2), round(s.h, 2), round(s.speed, 1), round(s.headingError, 3), flags, r.lap]);
    }
    this.xapps.room.send("st", { r: this.raceIndex, a: rows }).catch(ignore);
  }

  onRemoteState(payload: Json, from: string): void {
    const p = payload as { r?: number; a?: number[][] };
    if (!p || p.r !== this.raceIndex || !Array.isArray(p.a)) return;
    this.remoteSeen.set(from, performance.now());
    for (const row of p.a) {
      if (!Array.isArray(row) || row.length < 8) continue;
      const r = this.racers[row[0]!];
      if (!r || r.local) continue;
      r.net = { s: row[1]!, d: row[2]!, h: row[3]!, speed: row[4]!, yaw: row[5]!, flags: row[6]!, lap: row[7]!, at: performance.now() };
    }
  }

  onRemoteHello(payload: Json, from: string): void {
    const p = payload as { d?: number; l?: number };
    const r = this.racers.find((o) => o.id === from);
    if (!r || r.local || typeof p?.d !== "number") return;
    r.setDesign(Math.abs(Math.round(p.d)) % SHIPS.length, typeof p.l === "number" ? Math.round(p.l) : -1);
    this.raceSerial++;
    this.emit(true);
  }

  onRemoteGo(payload: Json): void {
    const p = payload as { r?: number; in?: number };
    if (this.conductor || typeof p?.in !== "number" || p.r !== this.raceIndex) return;
    if (this.phase !== "intro" && this.phase !== "countdown") return;
    this.startAt = performance.now() + p.in;
    this.waitingForGo = false;
  }

  onRemoteFinish(payload: Json): void {
    const p = payload as { r?: number; i?: number; t?: number };
    if (p?.r !== this.raceIndex || typeof p.i !== "number" || typeof p.t !== "number") return;
    const r = this.racers[p.i];
    if (!r || r.local || r.finished) return;
    r.finished = true;
    r.finishTime = p.t / 1000;
    this.updatePlaces();
  }

  onRemoteResults(payload: Json): void {
    const p = payload as { r?: number; o?: number[] };
    if (this.conductor || p?.r !== this.raceIndex || !Array.isArray(p.o)) return;
    this.raceOrder = p.o.filter((i) => typeof i === "number" && this.racers[i]);
    this.resultsFrom = "conductor";
    if (this.phase === "results") {
      this.applyResults();
      if (this.me) {
        this.me.record.place = this.raceOrder.indexOf(this.me.idx);
        this.records[this.raceIndex] = { ...this.me.record };
      }
      this.emit(true);
    } else if (this.phase === "race" || this.phase === "finished") {
      this.endRace();
    }
  }

  onRemoteFx(payload: Json, from: string): void {
    const p = payload as { k?: string; r?: number; [key: string]: Json | undefined };
    if (!p || p.r !== this.raceIndex) return;
    const track = this.track;
    switch (p.k) {
      case "p": {
        const owner = this.racers[p.o as number];
        if (!owner || typeof p.s !== "number" || typeof p.d !== "number") return;
        const target = typeof p.t === "number" && p.t >= 0 ? (this.racers[p.t]?.id ?? null) : null;
        const kind = p.kind as ProjectileKind;
        if (!["seeker", "bolt", "mine", "singularity"].includes(kind)) return;
        const proj = spawnProjectile(kind, String(p.id), owner.id, target, wrapS(p.s, track.length), p.d, p.dir === -1 ? -1 : 1, typeof p.vd === "number" ? p.vd : 0);
        this.projectiles.push(proj);
        this.sfx(kind === "seeker" ? "missile" : kind === "mine" ? "mineDrop" : "fire", owner, 0.5);
        break;
      }
      case "x":
        for (const proj of this.projectiles) if (proj.id === p.id) proj.dead = true;
        break;
      case "emp": {
        const from = this.racers[p.o as number];
        if (from) {
          this.fx.push({ type: "emp", from: from.idx });
          this.applyEmp(from);
        }
        break;
      }
      case "steal": {
        const victim = this.racers[p.v as number];
        if (victim?.local && victim.items.length) {
          const stolen = victim.items.shift()!;
          if (victim.isMe) this.say(`Someone stole your ${ITEMS[stolen.id].name}!`, "bad");
        }
        break;
      }
      case "hit": {
        const shooter = this.racers.find((o) => o.id === p.by);
        if (shooter?.local) {
          shooter.record.hitsLanded++;
          if (shooter.isMe) this.say(`Hit ${this.racers[p.v as number]?.name ?? "them"}!`, "good");
        }
        break;
      }
    }
    void from;
  }

  onPresence(online: string[]): void {
    for (const r of this.racers) {
      if (r.kind !== "human") continue;
      r.gone = !online.includes(r.id);
    }
  }

  private updateRemote(dt: number): void {
    const track = this.track;
    const now = performance.now();
    for (const r of this.racers) {
      if (r.local || !r.net) continue;
      const n = r.net;
      const age = Math.min(0.35, (now - n.at) / 1000);
      const targetS = wrapS(n.s + n.speed * age, track.length);
      const ship = r.ship;
      if (this.phase !== "race" && this.phase !== "finished") r.prevPos.copy(ship.pos);
      const ds = deltaS(ship.s, targetS, track.length);
      const k = Math.abs(ds) > 30 ? 1 : 1 - Math.exp(-12 * dt);
      ship.s = wrapS(ship.s + ds * k, track.length);
      ship.d += (n.d - ship.d) * k;
      ship.h += (n.h - ship.h) * k;
      ship.speed = n.speed;
      ship.boost = n.flags & 1 ? 0.2 : 0;
      ship.driftTier = ((n.flags >> 1) & 3) as 0 | 1 | 2 | 3;
      ship.shield = n.flags & 8 ? 1 : 0;
      ship.cloak = n.flags & 16 ? 1 : 0;
      ship.state = n.flags & 32 ? "warp" : n.flags & 64 ? "spin" : n.flags & 128 ? "tow" : "drive";
      ship.driftDir = n.flags & 512 ? (n.flags & 1024 ? 1 : -1) : 0;
      if (ship.state === "spin") ship.spinAngle += dt * 10;
      else ship.spinAngle = 0;
      const F = ship.frame;
      // Heading from the road direction and the sent heading error.
      ship.updatePos();
      frameInto(track, ship);
      ship.fwd.copy(F.fwd).applyAxisAngle(F.up, -n.yaw);
      ship.lean += ((ship.driftDir * 0.42) - ship.lean) * (1 - Math.exp(-8 * dt));
      ship.updatePos();
      if (r.lap !== n.lap) r.lap = n.lap;
      r.progress = (r.lap < 0 ? -track.length : r.lap * track.length) + ship.s;
      if (r.finished) r.progress = this.settings.laps * track.length + (this.racers.length - r.place);
    }
  }

  private engineSound(): void {
    const me = this.me;
    if (!me) return;
    const s = me.ship;
    this.audio.engine({
      speed01: Math.max(0, s.speed) / s.tune.top,
      throttle: me.finished ? 0.6 : this.input.throttle,
      boost: s.boost > 0 || s.state === "warp" ? 1 : 0,
      drifting: s.driftDir !== 0,
      driftTier: s.driftTier,
      airborne: s.airborne,
    });
  }

  /* ---------------------------------------------------------------- */
  /* For the renderer                                                 */
  /* ---------------------------------------------------------------- */

  worldOf(s: number, d: number, h: number): Vector3 {
    return trackPoint(this.track, s, d, h, new Vector3());
  }

  drainFx(): Fx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  /** The racer the camera follows. */
  get focus(): Racer {
    if (this.me) return this.me;
    return [...this.racers].sort((a, b) => a.place - b.place)[0]!;
  }

  /** Fraction of the intro flyover done (0..1). */
  get introProgress(): number {
    if (this.phase !== "intro") return 1;
    return Math.min(1, this.phaseTime / this.phaseLength);
  }
}

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}


function frameInto(track: CompiledTrack, ship: Ship): void {
  frameAt(track, ship.s, ship.frame);
}
