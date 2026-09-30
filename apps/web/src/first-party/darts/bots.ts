/**
 * Practice bots (pure, unit-tested). Each bot gets a skill from the match's
 * seed, aims like a pub player (mostly the treble 20, sometimes the bull or
 * the treble 19) and scatters around that aim with a skill-based Gaussian
 * spread plus the occasional wild dart. Everything is seeded, so every
 * client at the table sees the same bot darts at the same pace.
 */

import { RADIUS, target, type Point } from "./board";
import { DARTS_PER_ROUND, TOTAL_DARTS } from "./logic";

export interface BotProfile {
  /** 0 (hopeless) … 1 (pro). */
  skill: number;
  /** Rough time between darts (ms). */
  paceMs: number;
  /** Their favourite aim. */
  style: "t20" | "t19" | "bull";
}

export const BOT = {
  minSkill: 0.3,
  maxSkill: 0.88,
  /** Spread (mm, one standard deviation per axis) of the weakest and the best bot. */
  worstSpread: 38,
  bestSpread: 10,
  /** Chance of a wild dart for the weakest bot (scaled down with skill). */
  wildChance: 0.08,
  wildFactor: 2.6,
  /** Dropping darts a little is the most common pub error. */
  sag: 4,
  /** Before a bot's first dart (ms). */
  firstDartMs: [2400, 4200] as const,
  /** Pause between rounds (they walk up to pull their darts). */
  roundBreakMs: 1900,
  /** When the player we're waiting on is done, bots hurry up to this pace. */
  hurryMs: 650,
} as const;

/** Box–Muller normal from a uniform source. */
export function gaussian(rand: () => number, mean = 0, deviation = 1): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function botProfile(rand: () => number): BotProfile {
  // Skew a little towards the middle so most bots feel like decent pub players.
  const u = (rand() + rand()) / 2;
  const skill = BOT.minSkill + u * (BOT.maxSkill - BOT.minSkill);
  const style = rand() < 0.12 ? "bull" : rand() < 0.12 ? "t19" : "t20";
  return { skill, paceMs: Math.round(2900 - skill * 900 + rand() * 600), style };
}

/** One standard deviation of scatter (mm) for a skill. */
export function spreadFor(skill: number): number {
  const s = Math.max(0, Math.min(1, skill));
  return BOT.worstSpread + (BOT.bestSpread - BOT.worstSpread) * s;
}

function aimFor(profile: BotProfile, rand: () => number): Point {
  // Now and then everyone switches target (the T20 bed is getting crowded).
  if (profile.style === "bull") return rand() < 0.8 ? target(25, "bull") : target(20, "treble");
  if (profile.style === "t19") return rand() < 0.75 ? target(19, "treble") : target(20, "treble");
  return rand() < 0.9 ? target(20, "treble") : target(19, "treble");
}

/** One bot dart. */
export function botDart(profile: BotProfile, rand: () => number): Point {
  const aim = aimFor(profile, rand);
  const wild = rand() < BOT.wildChance * (1 - profile.skill);
  const spread = spreadFor(profile.skill) * (wild ? BOT.wildFactor : 1);
  const p = {
    x: aim.x + gaussian(rand, 0, spread),
    y: aim.y + gaussian(rand, BOT.sag * (1 - profile.skill), spread),
  };
  // Keep the wildest ones near the board so they're visible.
  const r = Math.hypot(p.x, p.y);
  const max = RADIUS.edge + 12;
  return r > max ? { x: (p.x / r) * max, y: (p.y / r) * max } : p;
}

/** All nine darts of a bot's game. */
export function botDarts(profile: BotProfile, rand: () => number): Point[] {
  return Array.from({ length: TOTAL_DARTS }, () => botDart(profile, rand));
}

/**
 * When each dart lands (ms after the match started): a first-dart delay,
 * then the bot's pace with some jitter, and a break between rounds.
 */
export function botSchedule(profile: BotProfile, rand: () => number): number[] {
  const [lo, hi] = BOT.firstDartMs;
  let t = lo + rand() * (hi - lo);
  const out: number[] = [];
  for (let i = 0; i < TOTAL_DARTS; i++) {
    if (i > 0) t += profile.paceMs * (0.75 + rand() * 0.5) + (i % DARTS_PER_ROUND === 0 ? BOT.roundBreakMs : 0);
    out.push(Math.round(t));
  }
  return out;
}

/**
 * The schedule once the humans are done: darts still to come land at the
 * hurry pace from `now` (never later than planned).
 */
export function hurrySchedule(schedule: readonly number[], now: number): number[] {
  let next = now;
  return schedule.map((t) => {
    if (t <= now) return t;
    next += BOT.hurryMs;
    return Math.min(t, next);
  });
}

export interface BotPlan {
  profile: BotProfile;
  darts: Point[];
  schedule: number[];
}

/** A bot's whole game from its seeded stream. */
export function planBot(rand: () => number): BotPlan {
  const profile = botProfile(rand);
  return { profile, darts: botDarts(profile, rand), schedule: botSchedule(profile, rand) };
}
