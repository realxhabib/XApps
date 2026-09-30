/**
 * 8-Ball Pool — the practice bot. Pure: no React, no SDK.
 *
 * It thinks like a club player:
 * 1. List every makeable pot (legal ball × pocket) by geometry: ghost-ball
 *    aim, clear paths for the cue ball and the object ball, a sane cut angle
 *    and a pocket it can actually enter.
 * 2. Simulate the best few with the real physics at a few speeds (and, from
 *    medium up, with follow or draw) and keep the ones that pot cleanly,
 *    preferring the one that leaves the cue ball on another shot.
 * 3. Nothing on? Play a safety: a legal soft touch that leaves the opponent
 *    the least, including kicks off a cushion when every ball is hidden.
 * 4. With ball in hand it first picks a spot for a comfortable straight-in shot.
 *
 * Its aim and speed then get a little human error by level, so it misses
 * sometimes. `planBotShot` is a generator that yields between simulations so
 * the UI can spread the thinking over frames.
 */

import {
  HEAD_X,
  POCKETS,
  R,
  TABLE_L,
  TABLE_W,
  simulate,
  type Balls,
  type Pocket,
  type Vec,
} from "./physics";
import { checkCueSpot, defaultCueSpot, judge, legalTargets, needsCall, other, type Game, type Seat, type ShotInput } from "./rules";

export type BotLevel = "easy" | "medium" | "hard";

interface LevelSpec {
  /** Aim error, degrees (1 σ). */
  aim: number;
  /** Relative speed error (1 σ). */
  power: number;
  /** Candidate pots simulated. */
  candidates: number;
  /** Plays for position (spin variations, next-shot scoring). */
  position: boolean;
  /** Chance of simply picking a worse makeable shot. */
  sloppy: number;
}

export const LEVELS: Record<BotLevel, LevelSpec> = {
  easy: { aim: 1.3, power: 0.08, candidates: 3, position: false, sloppy: 0.35 },
  medium: { aim: 0.8, power: 0.06, candidates: 4, position: true, sloppy: 0.15 },
  hard: { aim: 0.16, power: 0.025, candidates: 8, position: true, sloppy: 0 },
};

export interface PotCandidate {
  target: number;
  pocket: number;
  /** Cue aim angle (table space). */
  angle: number;
  /** Cut angle, radians. */
  cut: number;
  /** Cue ball → ghost ball. */
  d1: number;
  /** Object ball → pocket. */
  d2: number;
  /** Higher is easier. */
  ease: number;
}

export interface BotPlan {
  input: ShotInput;
  kind: "break" | "pot" | "safety";
  target: number | null;
  pocket: number | null;
  /** The shot before human error (tests use it to check the bot's judgement). */
  ideal: ShotInput;
}

/* ------------------------------------------------------------------------ */
/* Geometry                                                                 */
/* ------------------------------------------------------------------------ */

/** Is the straight path of a ball from `a` to `b` clear of every ball except `skip`? */
export function pathClear(balls: Balls, a: Vec, b: Vec, skip: readonly number[], clearance = 2 * R): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return true;
  for (let i = 0; i < balls.length; i++) {
    const p = balls[i];
    if (!p || skip.includes(i)) continue;
    let u = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
    if (u <= 0) continue; // behind the start: the ball is leaving it
    u = Math.min(1, u);
    const qx = a.x + dx * u - p.x;
    const qy = a.y + dy * u - p.y;
    if (qx * qx + qy * qy < (clearance - 1e-4) ** 2) return false;
  }
  return true;
}

/** Can a ball travelling in direction `dir` enter pocket `p`? (Side pockets reject shallow angles.) */
function pocketAccepts(p: Pocket, dir: Vec): boolean {
  const cos = -(dir.x * p.facing.x + dir.y * p.facing.y);
  return p.side ? cos > Math.cos((56 * Math.PI) / 180) : cos > Math.cos((72 * Math.PI) / 180);
}

/** Every geometrically makeable pot from `cue` on `targets`, easiest first. */
export function potCandidates(balls: Balls, cue: Vec, targets: readonly number[], pockets: readonly Pocket[] = POCKETS): PotCandidate[] {
  const out: PotCandidate[] = [];
  for (const id of targets) {
    const t = balls[id];
    if (!t) continue;
    for (const p of pockets) {
      const tx = p.aim.x - t.x;
      const ty = p.aim.y - t.y;
      const d2 = Math.hypot(tx, ty);
      if (d2 < 1e-6) continue;
      const dir = { x: tx / d2, y: ty / d2 };
      if (!pocketAccepts(p, dir)) continue;
      const ghost = { x: t.x - dir.x * 2 * R, y: t.y - dir.y * 2 * R };
      if (ghost.x < R * 0.98 || ghost.x > TABLE_L - R * 0.98 || ghost.y < R * 0.98 || ghost.y > TABLE_W - R * 0.98) continue;
      const cx = ghost.x - cue.x;
      const cy = ghost.y - cue.y;
      const d1 = Math.hypot(cx, cy);
      if (d1 < 1e-6) continue;
      const cosCut = (cx * dir.x + cy * dir.y) / d1;
      const cut = Math.acos(Math.max(-1, Math.min(1, cosCut)));
      if (cut > (80 * Math.PI) / 180) continue;
      if (!pathClear(balls, t, p.aim, [0, id])) continue;
      if (!pathClear(balls, cue, ghost, [0, id])) continue;
      const ease = (Math.pow(Math.cos(cut), 1.6) / (1 + 0.55 * d1 + 0.85 * d2)) * (p.side ? 0.82 : 1);
      out.push({ target: id, pocket: p.id, angle: Math.atan2(cy, cx), cut, d1, d2, ease });
    }
  }
  return out.sort((a, b) => b.ease - a.ease);
}

/** How good the best pot for `seat` is on `game`'s table (0 = nothing on). */
export function bestPotEase(game: Game, seat: Seat): number {
  const cue = game.balls[0];
  if (!cue) return 0.9; // ball in hand: something is always on
  const best = potCandidates(game.balls, cue, legalTargets(game, seat))[0];
  return best?.ease ?? 0;
}

/* ------------------------------------------------------------------------ */
/* Planning                                                                 */
/* ------------------------------------------------------------------------ */

export interface BotOptions {
  level?: BotLevel;
  /** [0, 1) source: inject a seeded one for tests. */
  random?: () => number;
}

interface Trial {
  input: ShotInput;
  score: number;
  kind: "pot" | "safety";
  target: number | null;
  pocket: number | null;
}

function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Speed the shot needs: enough to reach the pocket with some pace to spare. */
function basePower(c: PotCandidate): number {
  const need = c.d1 + c.d2 / Math.max(0.25, Math.cos(c.cut));
  return Math.min(0.85, 0.12 + 0.22 * Math.sqrt(need));
}

/** Picks a cue ball spot with ball in hand: a comfortable, nearly straight-in shot. */
export function placeCueBall(game: Game, seat: Seat, random: () => number = Math.random): Vec {
  const targets = legalTargets(game, seat);
  let best: { p: Vec; score: number } | null = null;
  const probe: Game = { ...game, balls: game.balls.slice() };
  probe.balls[0] = null;
  for (const id of targets) {
    const t = game.balls[id];
    if (!t) continue;
    for (const pk of POCKETS) {
      const tx = pk.aim.x - t.x;
      const ty = pk.aim.y - t.y;
      const d2 = Math.hypot(tx, ty);
      const dir = { x: tx / d2, y: ty / d2 };
      if (!pocketAccepts(pk, dir) || !pathClear(game.balls, t, pk.aim, [0, id])) continue;
      for (const back of [0.2, 0.32, 0.5]) {
        for (const tilt of [0, 0.18, -0.18]) {
          // Slightly off straight so the cue ball can move on after contact.
          const ca = Math.cos(tilt);
          const sa = Math.sin(tilt);
          const bx = dir.x * ca - dir.y * sa;
          const by = dir.x * sa + dir.y * ca;
          const ghost = { x: t.x - dir.x * 2 * R, y: t.y - dir.y * 2 * R };
          const p = { x: ghost.x - bx * back, y: ghost.y - by * back };
          if (checkCueSpot(probe, p) !== "ok") continue;
          const cands = potCandidates(game.balls, p, [id], [pk]);
          const c = cands[0];
          if (!c) continue;
          const score = c.ease * (pk.side ? 0.9 : 1) + random() * 0.01;
          if (!best || score > best.score) best = { p, score };
        }
      }
    }
  }
  if (best) return best.p;
  // Nothing straightforward: somewhere legal near the middle of the allowed area.
  const fallback = defaultCueSpot({ ...game, balls: probe.balls });
  return game.bih === "kitchen" ? { x: Math.min(fallback.x, HEAD_X - R), y: fallback.y } : fallback;
}

/**
 * Plans the bot's shot for `seat` (whose turn it must be). Yields between
 * simulations; the return value is the plan. Use `chooseBotShot` to run it in one go.
 */
export function* planBotShot(game: Game, seat: Seat, options: BotOptions = {}): Generator<void, BotPlan, void> {
  const level = LEVELS[options.level ?? "medium"];
  const random = options.random ?? Math.random;

  // Ball in hand: place the cue ball first.
  const cue = game.bih ? placeCueBall(game, seat, random) : (game.balls[0] as Vec);
  const table: Game = { ...game, balls: game.balls.slice() };
  table.balls[0] = cue;
  const cueIn = game.bih ? cue : null;

  if (!game.broken) {
    // Break: full pace into the head ball, a hair off centre.
    const head = headBall(game.balls);
    const off = (random() - 0.5) * 0.35 * R;
    const angle = Math.atan2(head.y + off - cue.y, head.x - cue.x);
    const ideal: ShotInput = { angle, power: 0.93 + random() * 0.07, spin: { x: 0, y: -0.15 }, cue: cueIn, call: null };
    return { input: withError(ideal, level, random, 0.4), kind: "break", target: null, pocket: null, ideal };
  }

  const targets = legalTargets(table, seat);
  const calling = needsCall(table, seat);
  const all = potCandidates(table.balls, cue, targets);
  // An easy bot sometimes fancies a harder shot than the best one.
  let cands = all.slice(0, level.candidates);
  if (level.sloppy > 0 && all.length > 1 && random() < level.sloppy) {
    cands = all.slice(1, 1 + level.candidates);
  }

  const trials: Trial[] = [];
  const evaluate = (input: ShotInput, kind: Trial["kind"], target: number | null, pocket: number | null, bonus = 0) => {
    const sim = simulate(table.balls, { angle: input.angle, power: input.power, spin: input.spin }, { record: false });
    const { game: next, summary } = judge(table, seat, sim, input.call);
    let score: number;
    if (summary.win === seat) score = 10;
    else if (summary.win !== null) score = -100;
    else if (summary.foul) score = -5 - bestPotEase(next, other(seat));
    else if (summary.cont) score = 2 + (level.position ? bestPotEase(next, seat) * 3 : 0);
    else score = -bestPotEase(next, other(seat)) * 2;
    trials.push({ input, score: score + bonus, kind, target, pocket });
    return score;
  };

  for (const c of cands) {
    const base = basePower(c);
    const powers = level.position ? [base * 0.8, base, base * 1.35] : [base, base * 1.25];
    const spins: Vec[] = level.position ? [{ x: 0, y: 0 }, { x: 0, y: 0.45 }, { x: 0, y: -0.55 }] : [{ x: 0, y: 0 }];
    for (const power of powers) {
      for (const spin of spins) {
        const input: ShotInput = { angle: c.angle, power: Math.min(1, power), spin, cue: cueIn, call: calling ? c.pocket : null };
        evaluate(input, "pot", c.target, c.pocket, c.ease * 0.5);
        yield;
      }
    }
  }

  let best = pickBest(trials);
  // Robustness: a pot that only works dead-on is risky. Check the favourite with aim error.
  if (best && best.kind === "pot" && best.score > 1) {
    const sigma = (Math.max(0.25, level.aim) * Math.PI) / 180;
    let holds = 0;
    for (const s of [-1, 1]) {
      const wobble = { ...best.input, angle: best.input.angle + s * sigma };
      const sim = simulate(table.balls, { angle: wobble.angle, power: wobble.power, spin: wobble.spin }, { record: false });
      const { summary } = judge(table, seat, sim, wobble.call);
      if (summary.win === seat || summary.cont) holds++;
      else if (summary.win !== null) holds -= 2;
      yield;
    }
    if (holds < 0) best = { ...best, score: best.score - 6 };
  }

  if (!best || best.score < 1) {
    // Safety (or a kick when nothing is visible).
    for (const input of safetyShots(table, seat, cue, cueIn, calling, random)) {
      evaluate(input, "safety", null, input.call, 0);
      yield;
    }
    best = pickBest(trials);
  }

  const chosen = best as Trial;
  const ideal = chosen.input;
  return { input: withError(ideal, level, random), kind: chosen.kind, target: chosen.target, pocket: chosen.pocket, ideal };
}

/** Runs `planBotShot` to completion. */
export function chooseBotShot(game: Game, seat: Seat, options: BotOptions = {}): BotPlan {
  const it = planBotShot(game, seat, options);
  for (;;) {
    const step = it.next();
    if (step.done) return step.value;
  }
}

function pickBest(trials: readonly Trial[]): Trial | null {
  let best: Trial | null = null;
  for (const t of trials) if (!best || t.score > best.score) best = t;
  return best;
}

function headBall(balls: Balls): Vec {
  let head: Vec | null = null;
  for (let i = 1; i < balls.length; i++) {
    const b = balls[i];
    if (b && (!head || b.x < head.x)) head = b;
  }
  return head ?? { x: TABLE_L * 0.75, y: TABLE_W / 2 };
}

/** Soft legal touches on each target (full, thick and thin), plus kicks at other angles. */
function safetyShots(game: Game, seat: Seat, cue: Vec, cueIn: Vec | null, calling: boolean, random: () => number): ShotInput[] {
  const out: ShotInput[] = [];
  const targets = legalTargets(game, seat);
  const call = calling ? nearestPocketId(game.balls[8] ?? cue) : null;
  for (const id of targets.slice(0, 7)) {
    const t = game.balls[id];
    if (!t) continue;
    const base = Math.atan2(t.y - cue.y, t.x - cue.x);
    const dist = Math.hypot(t.x - cue.x, t.y - cue.y);
    for (const frac of [0, 0.5, -0.5, 0.85, -0.85]) {
      const angle = base + Math.asin(Math.max(-1, Math.min(1, (frac * 2 * R) / Math.max(dist, 2 * R))));
      for (const power of [0.16, 0.26]) out.push({ angle, power: power + dist * 0.04, spin: { x: 0, y: -0.2 }, cue: cueIn, call });
    }
  }
  // Kicks: fan out around the table.
  for (let k = 0; k < 16; k++) {
    const angle = (k / 16) * 2 * Math.PI + random() * 0.1;
    out.push({ angle, power: 0.34, spin: { x: 0, y: 0 }, cue: cueIn, call });
  }
  return out;
}

function nearestPocketId(p: Vec): number {
  let best = 0;
  let bestD = Infinity;
  for (const pk of POCKETS) {
    const d = (pk.aim.x - p.x) ** 2 + (pk.aim.y - p.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = pk.id;
    }
  }
  return best;
}

function withError(input: ShotInput, level: LevelSpec, random: () => number, powerScale = 1): ShotInput {
  const angle = input.angle + (gaussian(random) * level.aim * Math.PI) / 180;
  const power = Math.max(0.05, Math.min(1, input.power * (1 + gaussian(random) * level.power * powerScale)));
  return { ...input, angle, power };
}
