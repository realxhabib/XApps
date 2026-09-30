/**
 * The round, on this client: your ball's hole-by-hole state machine, the bots
 * this client plays for, ghosts of everyone else, the room traffic, the host
 * HUD, and submitting. Plain TypeScript (no React): the renderer calls
 * `frame(dt)` every animation frame and React only re-renders on discrete
 * changes (`subscribe` / `getSnapshot`).
 *
 * Everyone plays the same nine holes at their own pace, each with their own
 * ball and their own deterministic simulation; opponents only ever see the
 * positions it produced.
 */

import type { Json, MatchResult, PlayerInfo, XAppsClient } from "@xapps/sdk";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { GolfAudio } from "./audio";
import { getCompiled, type CompiledHole } from "./compile";
import { HOLES, type Vec } from "./course";
import {
  BALL_COLORS,
  HOLE_COUNT,
  PICKUP_SCORE,
  STROKE_CAP,
  ballMessage,
  botSkill,
  botThinkSeconds,
  earnedAchievements,
  formatToPar,
  gaussian,
  holeCallout,
  parseBall,
  parseCard,
  roundScore,
  roundStats,
  submissionBody,
  submissionData,
  toPar,
  type BotSkill,
  type Callout,
  type HoleRecord,
} from "./logic";
import { HZ, Sim, TUBE_TICKS, runToEnd, type SimEvent } from "./physics";
import { QUICK, planShot, type Plan } from "./planner";

const TAG = "mini-golf";
const ignore = () => {};

export type Phase = "intro" | "aim" | "roll" | "reset" | "sunk" | "card" | "done" | "watch";

export interface Ghost {
  hole: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  ty: number;
  tz: number;
  /** 0 rest, 1 moving, 2 holed, 3 in a tube. */
  mode: number;
  /** Local time of the last update (performance.now), for fading stale ghosts. */
  seenAt: number;
}

export interface Seat {
  id: string;
  seat: number;
  name: string;
  handle: string;
  avatarUrl: string | null;
  isBot: boolean;
  isMe: boolean;
  color: string;
  card: number[];
  /** Hole index being played (HOLE_COUNT once done). */
  hole: number;
  strokes: number;
  ghost: Ghost | null;
}

export type Fx =
  | { type: "splash"; x: number; y: number; mine: boolean }
  | { type: "bumper"; index: number }
  | { type: "impact"; x: number; y: number; strength: number }
  | { type: "sand"; x: number; y: number }
  | { type: "sunk"; ace: boolean; mine: boolean }
  | { type: "shot"; power: number }
  | { type: "land"; x: number; y: number; strength: number };

export interface Aim {
  active: boolean;
  angle: number;
  power: number;
}

export interface HudSnapshot {
  phase: Phase;
  hole: number;
  strokes: number;
  callout: (Callout & { id: number; strokes: number }) | null;
  seats: readonly Seat[];
  /** When the scorecard moves on by itself (performance.now ms), or null. */
  cardDeadline: number | null;
  overview: boolean;
  splashId: number;
  /** Seconds of intro left (0 once playing). */
  intro: boolean;
  submitted: boolean;
  submitError: boolean;
  result: MatchResult | null;
  spectator: boolean;
}

interface SavedRound {
  v: 1;
  records: HoleRecord[];
  bots: { [id: string]: number[] };
}

function nameOf(p: PlayerInfo, me: boolean): string {
  if (me) return "You";
  return p.isBot ? p.name : p.name?.trim() || `@${p.handle}`;
}

/** Who plays the bots: the first human by seat (as in the other first-party games). */
function botDriverId(players: readonly PlayerInfo[]): string | null {
  return [...players].filter((p) => !p.isBot).sort((a, b) => a.seat - b.seat)[0]?.id ?? null;
}

const INTRO_S = 2.9;
const INTRO_REDUCED_S = 0.9;
const CARD_S = 7;
const SEND_EVERY_MS = 110;

/* ------------------------------------------------------------------ */
/* Bots                                                               */
/* ------------------------------------------------------------------ */

class BotRunner {
  readonly seat: Seat;
  readonly skill: BotSkill;
  hole = 0;
  sim: Sim | null = null;
  strokes = 0;
  lastRest: Vec = { x: 0, y: 0 };
  state: "wait" | "think" | "roll" | "splash" | "finished" = "wait";
  clock = 0;
  thinkLeft = 0;
  splashLeft = 0;
  plan: Generator<void, Plan[], void> | null = null;
  plans: Plan[] | null = null;
  submitted = false;

  constructor(seat: Seat, level: number) {
    this.seat = seat;
    this.skill = botSkill(level);
  }

  get course(): CompiledHole {
    return getCompiled(HOLES[this.hole]!);
  }

  startHole(clock: number): void {
    const hole = HOLES[this.hole]!;
    this.clock = clock;
    this.sim = new Sim(this.course, hole.tee.x, hole.tee.y, Math.round(clock * HZ));
    this.strokes = 0;
    this.lastRest = { ...hole.tee };
    this.seat.hole = this.hole;
    this.seat.strokes = 0;
    this.think();
  }

  think(): void {
    const sim = this.sim!;
    const course = this.course;
    this.state = "think";
    this.thinkLeft = botThinkSeconds(Math.random, course.navDistance(sim.x, sim.y));
    const slop = (Math.random() * 2 - 1) * this.skill.timing;
    const tick = Math.round((this.clock + this.thinkLeft + slop) * HZ);
    this.plan = planShot(HOLES[this.hole]!, { x: sim.x, y: sim.y }, tick, QUICK);
    this.plans = null;
  }

  /** Runs the planner until the time budget is spent. */
  work(budgetMs: number): void {
    if (!this.plan) return;
    const until = performance.now() + budgetMs;
    while (performance.now() < until) {
      const step = this.plan.next();
      if (step.done) {
        this.plans = step.value;
        this.plan = null;
        return;
      }
    }
  }

  pick(): { angle: number; power: number } {
    const plans = this.plans ?? [];
    let choice = plans[0];
    if (choice && choice.score > -100 && Math.random() < this.skill.lazy) choice = plans[1 + Math.floor(Math.random() * 2)] ?? choice;
    if (!choice) {
      // Planner found nothing (shouldn't happen): tap it toward the cup.
      const cup = HOLES[this.hole]!.cup;
      return { angle: Math.atan2(cup.y - this.sim!.y, cup.x - this.sim!.x), power: 0.3 };
    }
    return {
      angle: choice.angle + gaussian(Math.random) * this.skill.angleSd,
      power: Math.max(0.04, Math.min(1, choice.power * (1 + gaussian(Math.random) * this.skill.powerSd))),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Runtime                                                            */
/* ------------------------------------------------------------------ */

export class GolfRuntime {
  readonly xapps: XAppsClient;
  readonly audio = new GolfAudio();
  readonly reduced: boolean;
  readonly spectator: boolean;
  readonly seats: Seat[];
  readonly me: Seat | null;
  private readonly bots: BotRunner[] = [];
  private readonly sendRoom: boolean;

  /* My round */
  holeIndex = 0;
  holeTime = 0;
  phase: Phase = "intro";
  introLeft = 0;
  introTotal = 1;
  sim: Sim;
  strokes = 0;
  lastRest: Vec;
  records: HoleRecord[] = [];
  private splashes = 0;
  private phaseLeft = 0;
  private cardDeadline: number | null = null;
  /** holeTime when my ball dropped (for the drop animation). */
  sunkAt = -1;
  shots = 0;

  /* Presentation */
  aim: Aim = { active: false, angle: Math.PI / 2, power: 0 };
  overview = false;
  fx: Fx[] = [];
  /** Bumped each time a new hole starts (the renderer rebuilds its scene). */
  holeSerial = 0;

  /* HUD store */
  private snapshot: HudSnapshot;
  private listeners = new Set<() => void>();
  private callout: HudSnapshot["callout"] = null;
  private calloutId = 0;
  private splashId = 0;
  private submitted = false;
  private submitError = false;
  private result: MatchResult | null = null;
  private lastSend = 0;
  private lastSentMoving = false;
  private disposed = false;
  private started = false;

  constructor(xapps: XAppsClient, reduced: boolean) {
    this.xapps = xapps;
    this.reduced = reduced;
    this.spectator = xapps.isSpectator;
    const players = [...xapps.players].sort((a, b) => a.seat - b.seat);
    this.seats = players.map((p, i) => ({
      id: p.id,
      seat: p.seat,
      name: nameOf(p, !this.spectator && p.id === xapps.me.id),
      handle: p.handle,
      avatarUrl: p.avatarUrl,
      isBot: p.isBot,
      isMe: !this.spectator && p.id === xapps.me.id,
      color: BALL_COLORS[i % BALL_COLORS.length]!,
      card: [],
      hole: 0,
      strokes: 0,
      ghost: null,
    }));
    this.me = this.seats.find((s) => s.isMe) ?? null;
    const driver = botDriverId(players);
    if (!this.spectator && driver === xapps.me.id) {
      for (const seat of this.seats.filter((s) => s.isBot)) {
        const r = xapps.random.fork(`bot:${seat.seat}`);
        this.bots.push(new BotRunner(seat, 0.4 + r.next() * 0.45));
      }
    }
    this.sendRoom = !this.spectator && xapps.opponents.some((p) => !p.isBot);
    const hole = HOLES[0]!;
    this.sim = new Sim(getCompiled(hole), hole.tee.x, hole.tee.y, 0);
    this.lastRest = { ...hole.tee };
    if (this.spectator) this.phase = "watch";
    this.snapshot = this.buildSnapshot();
  }

  get course(): CompiledHole {
    return getCompiled(HOLES[this.holeIndex]!);
  }

  get storageKey(): string {
    return `round:${this.xapps.match.id}`.slice(0, 64);
  }

  /** Loads a round in progress (a reload mid-match), then starts. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.spectator) {
      try {
        const saved = (await Promise.race([
          this.xapps.storage.get(this.storageKey),
          new Promise<null>((r) => setTimeout(() => r(null), 1500)),
        ])) as unknown as SavedRound | null;
        if (saved && saved.v === 1 && Array.isArray(saved.records) && saved.records.length < HOLE_COUNT) {
          this.records = saved.records.slice(0, HOLE_COUNT);
          this.me!.card = this.records.map((r) => r.strokes);
          for (const bot of this.bots) {
            const card = saved.bots?.[bot.seat.id];
            if (Array.isArray(card)) {
              bot.seat.card = card.slice(0, HOLE_COUNT);
              bot.hole = bot.seat.card.length;
            }
          }
        }
      } catch {
        // No saved round: start fresh.
      }
    }
    if (this.disposed) return;
    this.xapps.ui.setTurn(null).catch(ignore);
    this.pushScores();
    this.beginHole(this.spectator ? 0 : this.records.length);
    this.sendCard();
  }

  /** The view mounted (again: StrictMode mounts twice). */
  attach(): void {
    this.disposed = false;
    this.audio.attach();
  }

  /** The view unmounted: stop the clock and the sound. */
  detach(): void {
    this.disposed = true;
    this.audio.detach();
  }

  /* ---------------------------------------------------------------- */
  /* HUD store                                                        */
  /* ---------------------------------------------------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): HudSnapshot => this.snapshot;

  private buildSnapshot(): HudSnapshot {
    return {
      phase: this.phase,
      hole: this.holeIndex,
      strokes: this.strokes,
      callout: this.callout,
      seats: this.seats.map((s) => ({ ...s, card: [...s.card] })),
      cardDeadline: this.cardDeadline,
      overview: this.overview,
      splashId: this.splashId,
      intro: this.phase === "intro",
      submitted: this.submitted,
      submitError: this.submitError,
      result: this.result,
      spectator: this.spectator,
    };
  }

  private emit(): void {
    this.snapshot = this.buildSnapshot();
    for (const fn of this.listeners) fn();
  }

  /* ---------------------------------------------------------------- */
  /* Holes                                                            */
  /* ---------------------------------------------------------------- */

  private beginHole(index: number): void {
    this.holeIndex = Math.min(index, HOLE_COUNT - 1);
    const hole = HOLES[this.holeIndex]!;
    this.holeTime = 0;
    this.sim = new Sim(getCompiled(hole), hole.tee.x, hole.tee.y, 0);
    this.lastRest = { ...hole.tee };
    this.strokes = 0;
    this.splashes = 0;
    this.sunkAt = -1;
    this.aim = { active: false, angle: Math.atan2(hole.cup.y - hole.tee.y, hole.cup.x - hole.tee.x), power: 0 };
    this.overview = false;
    this.cardDeadline = null;
    this.callout = null;
    this.holeSerial++;
    if (this.me) {
      this.me.hole = this.holeIndex;
      this.me.strokes = 0;
    }
    if (this.spectator) {
      this.phase = "watch";
    } else {
      this.phase = "intro";
      this.introTotal = this.reduced ? INTRO_REDUCED_S : INTRO_S;
      this.introLeft = this.introTotal;
    }
    this.xapps.ui.setStatus(`Hole ${hole.number} of ${HOLE_COUNT} · Par ${hole.par}`).catch(ignore);
    this.emit();
  }

  skipIntro(): void {
    if (this.phase === "intro") this.introLeft = Math.min(this.introLeft, 0.25);
  }

  private startPlaying(): void {
    this.phase = "aim";
    this.sendBall(true);
    // Bots tee off with you, on the same clock, so their ghosts dodge the same sails.
    for (const bot of this.bots) {
      if (bot.state === "wait" && bot.hole === this.holeIndex) bot.startHole(this.holeTime);
    }
    this.emit();
  }

  /** From the scorecard. */
  nextHole(): void {
    if (this.phase !== "card") return;
    this.audio.resume();
    this.beginHole(this.holeIndex + 1);
  }

  setOverview(on: boolean): void {
    if (this.overview === on) return;
    this.overview = on;
    this.emit();
  }

  /* ---------------------------------------------------------------- */
  /* Shooting                                                         */
  /* ---------------------------------------------------------------- */

  canAim(): boolean {
    return this.phase === "aim" && this.sim.status === "rest" && !this.result;
  }

  setAim(angle: number, power: number): void {
    if (!this.canAim()) return;
    const prev = this.aim.power;
    this.aim = { active: true, angle, power };
    if (Math.floor(power * 10) !== Math.floor(prev * 10)) this.audio.aimTick(power);
  }

  cancelAim(): void {
    this.aim = { ...this.aim, active: false, power: 0 };
  }

  shoot(): boolean {
    const { angle, power } = this.aim;
    this.aim = { ...this.aim, active: false, power: 0 };
    if (!this.canAim() || power < 0.03) return false;
    this.lastRest = { x: this.sim.x, y: this.sim.y };
    this.sim.shoot(angle, power);
    this.strokes++;
    this.shots++;
    if (this.me) this.me.strokes = this.strokes;
    this.phase = "roll";
    this.audio.putt(power);
    this.fx.push({ type: "shot", power });
    this.haptic(power > 0.7 ? "medium" : "light");
    this.emit();
    return true;
  }

  private haptic(style: "light" | "medium" | "heavy" | "success" | "error"): void {
    this.xapps.ui.haptic(style).catch(ignore);
  }

  /* ---------------------------------------------------------------- */
  /* Frame                                                            */
  /* ---------------------------------------------------------------- */

  frame(dtIn: number): void {
    if (this.disposed || !this.started) return;
    const dt = Math.min(0.1, Math.max(0, dtIn));
    this.holeTime += dt;

    if (this.phase === "intro") {
      this.introLeft -= dt;
      if (this.introLeft <= 0) this.startPlaying();
    }

    // My ball runs on the hole clock (at rest it only watches for moving obstacles).
    if (!this.spectator && this.phase !== "card" && this.phase !== "done") this.stepMine();

    if (this.phaseLeft > 0) {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) this.phaseTimeout();
    }
    if (this.phase === "card" && this.cardDeadline !== null && performance.now() >= this.cardDeadline) this.nextHole();

    this.updateBots(dt);
    this.updateGhosts(dt);
  }

  private stepMine(): void {
    const sim = this.sim;
    const target = Math.floor(this.holeTime * HZ);
    let guard = 0;
    while (sim.tick < target && guard++ < 40) sim.step();
    if (sim.tick < target) sim.tick = target;
    if (sim.events.length) {
      const events = sim.events;
      sim.events = [];
      for (const e of events) this.onMyEvent(e);
    }
    if (this.phase === "roll") {
      if (sim.status === "rest") this.onRest();
      else if (sim.status === "water") this.onWater();
      else if (sim.status === "holed") this.onHoled();
      const now = performance.now();
      if (now - this.lastSend > SEND_EVERY_MS) this.sendBall(false);
    } else if (this.phase === "aim" && sim.status === "rolling") {
      // Knocked by a sail or a slider while lining up.
      this.aim = { ...this.aim, active: false, power: 0 };
      this.phase = "roll";
      this.emit();
    }
  }

  private onMyEvent(e: SimEvent): void {
    const sim = this.sim;
    switch (e.type) {
      case "wall":
        this.audio.knock(e.speed);
        if (e.speed > 3) this.fx.push({ type: "impact", x: sim.x, y: sim.y, strength: e.speed });
        if (e.speed > 5) this.haptic("light");
        break;
      case "bumper":
        this.audio.bumper(e.speed);
        this.fx.push({ type: "bumper", index: e.index });
        this.haptic("light");
        break;
      case "obstacle":
      case "knock":
        this.audio.obstacle(e.type === "knock" ? 3 : e.speed);
        this.haptic("medium");
        break;
      case "sand":
        this.audio.sand();
        this.fx.push({ type: "sand", x: sim.x, y: sim.y });
        break;
      case "boost":
        this.audio.boost();
        break;
      case "tube-in":
        this.audio.tubeIn();
        break;
      case "tube-out":
        this.audio.tubeOut();
        this.haptic("light");
        break;
      case "launch":
        this.audio.launch();
        break;
      case "land":
        this.audio.land(e.speed);
        this.fx.push({ type: "land", x: sim.x, y: sim.y, strength: e.speed });
        if (e.speed > 2) this.haptic("medium");
        break;
      case "lip":
        this.audio.lip();
        this.haptic("light");
        break;
      case "water":
      case "cup":
      case "rest":
        break;
    }
  }

  private onRest(): void {
    this.lastRest = { x: this.sim.x, y: this.sim.y };
    this.sendBall(true);
    if (this.strokes >= STROKE_CAP) return this.finishHole(false);
    this.phase = "aim";
    this.emit();
  }

  private onWater(): void {
    this.splashes++;
    this.strokes++;
    if (this.me) this.me.strokes = this.strokes;
    this.splashId++;
    this.fx.push({ type: "splash", x: this.sim.x, y: this.sim.y, mine: true });
    this.audio.splash();
    this.haptic("error");
    this.phase = "reset";
    this.phaseLeft = 1.2;
    this.emit();
  }

  private onHoled(): void {
    this.sunkAt = this.holeTime;
    this.finishHole(true);
  }

  private finishHole(holed: boolean): void {
    const hole = HOLES[this.holeIndex]!;
    const score = holed ? this.strokes : PICKUP_SCORE;
    const callout = holeCallout(score, hole.par, holed);
    const ace = holed && score === 1;
    this.records.push({
      strokes: score,
      holed,
      splashes: this.splashes,
      finalBounces: holed ? this.sim.stats.bounces : 0,
      finalAir: holed && this.sim.stats.airTicks > 0,
    });
    if (this.me) {
      this.me.card = this.records.map((r) => r.strokes);
      this.me.strokes = score;
    }
    this.callout = { ...callout, id: ++this.calloutId, strokes: score };
    this.phase = "sunk";
    this.phaseLeft = ace ? 3.6 : 2.4;
    if (holed) {
      this.audio.cup();
      this.fx.push({ type: "sunk", ace, mine: true });
      this.sendBall(true);
    }
    if (ace) {
      setTimeout(() => this.audio.applause(), 250);
      this.xapps.ui.celebrate("big").catch(ignore);
      this.haptic("success");
    } else if (callout.tone === "great" || callout.tone === "good") {
      setTimeout(() => this.audio.chime(callout.tone === "great"), 300);
      this.haptic("success");
    } else if (callout.tone === "bad" || callout.tone === "meh") {
      setTimeout(() => this.audio.sag(), 350);
    }
    unlockAchievements(this.xapps, earnedAchievements(this.records), TAG);
    this.pushScores();
    this.sendCard();
    this.save();
    this.emit();
  }

  private phaseTimeout(): void {
    if (this.phase === "reset") {
      this.sim.place(this.lastRest.x, this.lastRest.y);
      this.sendBall(true);
      if (this.strokes >= STROKE_CAP) return this.finishHole(false);
      this.phase = "aim";
      this.emit();
    } else if (this.phase === "sunk") {
      this.callout = null;
      if (this.records.length >= HOLE_COUNT) {
        this.phase = "done";
        if (this.me) this.me.hole = HOLE_COUNT;
        this.sendCard();
        this.finishRound();
      } else {
        this.phase = "card";
        this.cardDeadline = performance.now() + CARD_S * 1000;
      }
      this.emit();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Bots                                                             */
  /* ---------------------------------------------------------------- */

  private updateBots(dt: number): void {
    if (this.bots.length === 0 || this.result) return;
    let budget = 7;
    const myHole = this.spectator ? HOLE_COUNT : this.holeIndex;
    const playing = this.phase === "aim" || this.phase === "roll" || this.phase === "reset";
    for (const bot of this.bots) {
      if (bot.state === "finished") continue;
      // Visible: on my hole while I'm playing it. Otherwise it plays on quickly in the background.
      const visible = !this.spectator && bot.hole === myHole && this.phase !== "card" && this.phase !== "done";
      if (bot.state === "wait") {
        const mayStart = bot.hole < myHole || (bot.hole === myHole && playing) || this.phase === "done";
        if (mayStart && bot.hole < HOLE_COUNT) bot.startHole(visible ? this.holeTime : bot.clock);
        else continue;
      }
      bot.clock = visible ? this.holeTime : bot.clock + dt * 3;
      const spend = Math.min(budget, visible ? 3 : 5);
      budget -= spend;
      this.stepBot(bot, dt * (visible ? 1 : 3), visible, spend);
    }
  }

  private stepBot(bot: BotRunner, dt: number, visible: boolean, budgetMs: number): void {
    const sim = bot.sim;
    if (!sim) return;
    if (bot.state === "think") {
      bot.thinkLeft -= dt;
      if (budgetMs > 0) bot.work(budgetMs);
      if (bot.thinkLeft <= 0 && bot.plans) {
        const { angle, power } = bot.pick();
        sim.tick = Math.round(bot.clock * HZ);
        bot.lastRest = { x: sim.x, y: sim.y };
        sim.shoot(angle, power);
        bot.strokes++;
        bot.seat.strokes = bot.strokes;
        bot.state = "roll";
        if (visible) this.audio.putt(power * 0.5);
      } else if (sim.status === "rest") {
        // Idle ball still reacts to sails and sliders.
        const target = Math.round(bot.clock * HZ);
        let guard = 0;
        while (sim.tick < target && guard++ < 40) sim.step();
        sim.tick = Math.max(sim.tick, target);
        if (sim.moving) bot.state = "roll";
      }
    }
    if (bot.state === "roll") {
      if (visible) {
        const target = Math.round(bot.clock * HZ);
        let guard = 0;
        while (sim.tick < target && guard++ < 40) sim.step();
        for (const e of sim.events) this.onBotEvent(e, sim);
        sim.events = [];
      } else {
        runToEnd(sim);
        sim.events = [];
        bot.clock = sim.tick / HZ;
      }
      if (sim.status === "rest") {
        bot.lastRest = { x: sim.x, y: sim.y };
        if (bot.strokes >= STROKE_CAP) this.botFinishHole(bot, false);
        else bot.think();
      } else if (sim.status === "water") {
        bot.strokes++;
        bot.seat.strokes = bot.strokes;
        if (visible) this.fx.push({ type: "splash", x: sim.x, y: sim.y, mine: false });
        bot.state = "splash";
        bot.splashLeft = visible ? 1.1 : 0;
      } else if (sim.status === "holed") {
        if (visible) this.fx.push({ type: "sunk", ace: bot.strokes === 1, mine: false });
        this.botFinishHole(bot, true);
      }
    }
    if (bot.state === "splash") {
      bot.splashLeft -= dt;
      if (bot.splashLeft <= 0) {
        sim.place(bot.lastRest.x, bot.lastRest.y);
        if (bot.strokes >= STROKE_CAP) this.botFinishHole(bot, false);
        else bot.think();
      }
    }
    const g = bot.seat.ghost ?? { hole: bot.hole, x: sim.x, y: sim.y, z: sim.z, tx: 0, ty: 0, tz: 0, mode: 0, seenAt: 0 };
    g.hole = bot.hole;
    g.x = g.tx = sim.x;
    g.y = g.ty = sim.y;
    g.z = g.tz = sim.z;
    g.mode = sim.status === "holed" ? 2 : sim.status === "tube" ? 3 : sim.moving ? 1 : 0;
    g.seenAt = performance.now();
    bot.seat.ghost = g;
  }

  private onBotEvent(e: SimEvent, sim: Sim): void {
    switch (e.type) {
      case "wall":
        this.audio.knock(e.speed, 0.4);
        break;
      case "bumper":
        this.audio.bumper(e.speed, 0.4);
        this.fx.push({ type: "bumper", index: e.index });
        break;
      case "obstacle":
        this.audio.obstacle(e.speed, 0.4);
        break;
      case "cup":
        this.audio.cup(0.45);
        break;
      case "land":
        this.fx.push({ type: "land", x: sim.x, y: sim.y, strength: e.speed });
        break;
      default:
        break;
    }
  }

  private botFinishHole(bot: BotRunner, holed: boolean): void {
    const score = holed ? bot.strokes : PICKUP_SCORE;
    bot.seat.card = [...bot.seat.card, score].slice(0, HOLE_COUNT);
    bot.seat.strokes = score;
    bot.hole++;
    bot.seat.hole = bot.hole;
    bot.plan = null;
    bot.plans = null;
    if (bot.hole >= HOLE_COUNT) {
      bot.state = "finished";
      this.submitBot(bot);
    } else {
      bot.state = "wait";
      bot.sim = null;
    }
    this.pushScores();
    this.save();
    this.emit();
  }

  private submitBot(bot: BotRunner): void {
    if (bot.submitted || this.xapps.player(bot.seat.id)?.submitted) return;
    bot.submitted = true;
    const card = bot.seat.card;
    this.xapps
      .submitFor(bot.seat.id, {
        score: roundScore(card),
        data: submissionData(card, 0),
        display: { kind: "text", title: `${roundScore(card)} strokes`, body: submissionBody(card) },
      })
      .catch((error: unknown) => {
        bot.submitted = false;
        console.warn(`[${TAG}] bot submit failed`, error);
      });
  }

  /* ---------------------------------------------------------------- */
  /* Ghosts & room                                                    */
  /* ---------------------------------------------------------------- */

  private updateGhosts(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    for (const s of this.seats) {
      const g = s.ghost;
      if (!g || s.isMe || s.isBot) continue;
      g.x += (g.tx - g.x) * k;
      g.y += (g.ty - g.y) * k;
      g.z += (g.tz - g.z) * k;
    }
  }

  onRemoteBall(payload: unknown, from: string): void {
    const seat = this.seats.find((s) => s.id === from);
    const msg = parseBall(payload);
    if (!seat || seat.isMe || !msg) return;
    const fresh = !seat.ghost || seat.ghost.hole !== msg.h;
    const g: Ghost = seat.ghost ?? { hole: msg.h, x: msg.x, y: msg.y, z: msg.z, tx: msg.x, ty: msg.y, tz: msg.z, mode: msg.m, seenAt: 0 };
    g.hole = msg.h;
    g.tx = msg.x;
    g.ty = msg.y;
    g.tz = msg.z;
    if (fresh || msg.m === 3) {
      g.x = msg.x;
      g.y = msg.y;
      g.z = msg.z;
    }
    if (msg.m === 2 && g.mode !== 2 && msg.h === this.holeIndex) this.audio.cup(0.4);
    g.mode = msg.m;
    g.seenAt = performance.now();
    seat.ghost = g;
    seat.hole = msg.h;
    seat.strokes = msg.s;
  }

  onRemoteCard(payload: unknown, from: string): void {
    const seat = this.seats.find((s) => s.id === from);
    const msg = parseCard(payload);
    if (!seat || seat.isMe || !msg) return;
    seat.card = msg.card;
    seat.hole = msg.h;
    if (this.spectator) this.followLeader();
    this.pushScores();
    this.emit();
  }

  /** Spectators watch the hole the furthest-along player is on. */
  private followLeader(): void {
    const hole = Math.min(HOLE_COUNT - 1, Math.max(0, ...this.seats.map((s) => Math.min(s.hole, HOLE_COUNT - 1))));
    if (hole !== this.holeIndex) this.beginHole(hole);
  }

  private sendBall(force: boolean): void {
    if (!this.sendRoom || !this.me) return;
    const moving = this.sim.moving;
    if (!force && !moving && !this.lastSentMoving) return;
    this.lastSend = performance.now();
    this.lastSentMoving = moving;
    const m = this.sim.status === "holed" ? 2 : this.sim.status === "tube" ? 3 : moving ? 1 : 0;
    this.xapps.room.send("b", { ...ballMessage(this.holeIndex, this.sim.x, this.sim.y, this.sim.z, this.strokes, m) }).catch(ignore);
  }

  private sendCard(): void {
    if (!this.sendRoom || !this.me) return;
    this.xapps.room.send("c", { card: [...this.me.card], h: this.me.hole }).catch(ignore);
  }

  private pushScores(): void {
    const scores: { [id: string]: string } = {};
    for (const s of this.seats) scores[s.id] = s.card.length ? formatToPar(toPar(s.card)) : "E";
    this.xapps.ui.setScores(scores).catch(ignore);
  }

  private save(): void {
    if (this.spectator || !this.me) return;
    const value: SavedRound = {
      v: 1,
      records: this.records,
      bots: Object.fromEntries(this.bots.map((b) => [b.seat.id, b.seat.card])),
    };
    this.xapps.storage.set(this.storageKey, value as unknown as Json).catch(ignore);
  }

  /* ---------------------------------------------------------------- */
  /* End of round                                                     */
  /* ---------------------------------------------------------------- */

  private finishRound(): void {
    if (this.submitted || !this.me) return;
    const card = this.me.card;
    reportStats(this.xapps, roundStats(this.records), TAG);
    unlockAchievements(this.xapps, earnedAchievements(this.records), TAG);
    this.xapps.ui.setStatus(`Round in · ${roundScore(card)} (${formatToPar(toPar(card))})`).catch(ignore);
    this.submitNow();
  }

  submitNow(): void {
    if (!this.me || this.xapps.me.submitted) return;
    const card = this.me.card;
    this.submitError = false;
    this.xapps
      .submit({
        score: roundScore(card),
        data: submissionData(card, this.shots),
        display: { kind: "text", title: `${roundScore(card)} strokes`, body: submissionBody(card) },
      })
      .then(
        () => {
          this.submitted = true;
          this.xapps.storage.delete(this.storageKey).catch(ignore);
          this.emit();
        },
        (error: unknown) => {
          console.error(`[${TAG}] submit failed`, error);
          this.submitError = true;
          this.emit();
        },
      );
    this.submitted = true;
    this.emit();
  }

  onResult(result: MatchResult): void {
    if (this.result) return;
    this.result = result;
    if (this.me && !this.spectator) {
      const won = result.winnerId === this.me.id;
      if (won) {
        reportStats(this.xapps, { wins: 1 }, TAG);
        unlockAchievements(this.xapps, earnedAchievements(this.records, { won: true }), TAG);
      }
    }
    this.aim = { ...this.aim, active: false, power: 0 };
    this.emit();
  }

  /* ---------------------------------------------------------------- */
  /* For the renderer                                                 */
  /* ---------------------------------------------------------------- */

  /** Intro flyover progress 0..1. */
  get introProgress(): number {
    if (this.phase !== "intro") return 1;
    return 1 - Math.max(0, this.introLeft) / this.introTotal;
  }

  /** Progress through a tube (0..1) while the ball is inside one. */
  tubeProgress(sim: Sim): number {
    return sim.status === "tube" ? 1 - sim.tubeLeft / TUBE_TICKS : 0;
  }

  drainFx(): Fx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }
}
