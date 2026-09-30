/**
 * Mini Golf: pure rules. Scoring, callouts, the wire format for ghosts and
 * scorecards, bot tuning, and what a round earns (stats + achievements).
 * No React, no SDK side effects.
 */

import type { Json } from "@xapps/sdk";
import { HOLES, TOTAL_PAR } from "./course";

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

/** Strokes allowed per hole. Not in after this many, you pick up and score one more. */
export const STROKE_CAP = 6;
export const PICKUP_SCORE = STROKE_CAP + 1;
export const HOLE_COUNT = HOLES.length;

export type Tone = "ace" | "great" | "good" | "par" | "meh" | "bad";

export interface Callout {
  label: string;
  tone: Tone;
}

/** "Hole in one!", "Birdie!", "Par", "Bogey"… for a finished hole. */
export function holeCallout(strokes: number, par: number, holed = true): Callout {
  if (!holed) return { label: "Picked up", tone: "bad" };
  if (strokes === 1) return { label: "Hole in one!", tone: "ace" };
  const d = strokes - par;
  if (d <= -3) return { label: "Albatross!", tone: "great" };
  if (d === -2) return { label: "Eagle!", tone: "great" };
  if (d === -1) return { label: "Birdie!", tone: "good" };
  if (d === 0) return { label: "Par", tone: "par" };
  if (d === 1) return { label: "Bogey", tone: "meh" };
  if (d === 2) return { label: "Double bogey", tone: "bad" };
  if (d === 3) return { label: "Triple bogey", tone: "bad" };
  return { label: `+${d}`, tone: "bad" };
}

/** Scorecard symbol class for a hole score. */
export function scoreMark(strokes: number, par: number): "ace" | "eagle" | "birdie" | "par" | "bogey" | "double" {
  if (strokes === 1) return "ace";
  const d = strokes - par;
  if (d <= -2) return "eagle";
  if (d === -1) return "birdie";
  if (d === 0) return "par";
  if (d === 1) return "bogey";
  return "double";
}

export function cardTotal(card: readonly number[]): number {
  return card.reduce((sum, s) => sum + s, 0);
}

/** Strokes over (+) or under (−) par for the holes played so far. */
export function toPar(card: readonly number[]): number {
  let par = 0;
  for (let i = 0; i < card.length && i < HOLES.length; i++) par += HOLES[i]!.par;
  return cardTotal(card) - par;
}

export function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `−${-n}`;
}

/** Placements for "low" scoring (fewest strokes wins; ties share a rank). */
export function rankTotals(totals: { id: string; total: number }[]): Map<string, number> {
  const ranks = new Map<string, number>();
  for (const a of totals) ranks.set(a.id, 1 + totals.filter((b) => b.total < a.total).length);
  return ranks;
}

/** Score to submit: total strokes over nine holes (capped holes count PICKUP_SCORE). */
export function roundScore(card: readonly number[]): number {
  return cardTotal(card.map((s) => Math.min(PICKUP_SCORE, Math.max(1, Math.round(s)))));
}

/* ------------------------------------------------------------------ */
/* Records (for achievements)                                         */
/* ------------------------------------------------------------------ */

export interface HoleRecord {
  strokes: number;
  holed: boolean;
  /** Balls in the water on this hole. */
  splashes: number;
  /** Walls, blocks and bumpers hit on the stroke that went in. */
  finalBounces: number;
  /** The stroke that went in spent time in the air. */
  finalAir: boolean;
}

export type GolfAchievement =
  | "first_round"
  | "ace"
  | "under_par"
  | "hot_streak"
  | "clean_card"
  | "trick_shot"
  | "airmail"
  | "first_win"
  | "fish_food"
  | "double_ace";

export const PROGRESS = {
  hotStreak: 3,
  trickBounces: 3,
  fishFood: 3,
} as const;

/**
 * Achievements earned by the holes so far. Hole-level ones (ace, trick shot,
 * airmail, streaks, water) unlock as they happen; round-level ones once all
 * nine holes are in. `won` is only known after the match settles.
 */
export function earnedAchievements(holes: readonly HoleRecord[], opts: { won?: boolean } = {}): GolfAchievement[] {
  const earned: GolfAchievement[] = [];
  const aces = holes.filter((h) => h.holed && h.strokes === 1).length;
  if (aces >= 1) earned.push("ace");
  if (aces >= 2) earned.push("double_ace");
  if (holes.some((h) => h.holed && h.finalBounces >= PROGRESS.trickBounces)) earned.push("trick_shot");
  if (holes.some((h) => h.holed && h.finalAir)) earned.push("airmail");
  let run = 0;
  let best = 0;
  holes.forEach((h, i) => {
    run = h.holed && h.strokes < HOLES[i]!.par ? run + 1 : 0;
    best = Math.max(best, run);
  });
  if (best >= PROGRESS.hotStreak) earned.push("hot_streak");
  if (holes.reduce((n, h) => n + h.splashes, 0) >= PROGRESS.fishFood) earned.push("fish_food");
  if (holes.length >= HOLE_COUNT) {
    earned.push("first_round");
    const card = holes.map((h) => h.strokes);
    if (toPar(card) < 0) earned.push("under_par");
    if (holes.every((h, i) => h.holed && h.strokes <= HOLES[i]!.par)) earned.push("clean_card");
  }
  if (opts.won) earned.push("first_win");
  return earned;
}

/** Stats for a finished round (zero counters left out). */
export function roundStats(holes: readonly HoleRecord[]): { [key: string]: number } {
  const stats: { [key: string]: number } = {};
  if (holes.length < HOLE_COUNT) return stats;
  stats.rounds_played = 1;
  stats.best_round = roundScore(holes.map((h) => h.strokes));
  const aces = holes.filter((h) => h.holed && h.strokes === 1).length;
  if (aces > 0) stats.holes_in_one = aces;
  return stats;
}

/* ------------------------------------------------------------------ */
/* Wire format                                                        */
/* ------------------------------------------------------------------ */

/** `room.send("b", …)`: where my ball is (throttled while it moves). */
export interface BallMessage {
  h: number;
  x: number;
  y: number;
  z: number;
  /** Strokes on this hole so far. */
  s: number;
  /** 1 while moving, 0 at rest, 2 holed, 3 in a tube. */
  m: number;
}

/** `room.send("c", …)`: my scorecard and where I am. */
export interface CardMessage {
  card: number[];
  /** Hole I'm on (index), or HOLE_COUNT when done. */
  h: number;
}

const q = (n: number) => Math.round(n * 100) / 100;

export function ballMessage(h: number, x: number, y: number, z: number, s: number, m: number): BallMessage {
  return { h, x: q(x), y: q(y), z: q(z), s, m };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

export function parseBall(payload: unknown): BallMessage | null {
  if (!isObj(payload)) return null;
  const { h, x, y, z, s, m } = payload;
  if (!finite(h, 0, HOLE_COUNT - 1) || !Number.isInteger(h)) return null;
  if (!finite(x, -50, 50) || !finite(y, -50, 50) || !finite(z, -10, 10)) return null;
  if (!finite(s, 0, 99) || !finite(m, 0, 3)) return null;
  return { h, x, y, z, s: Math.round(s), m: Math.round(m) };
}

export function parseCard(payload: unknown): CardMessage | null {
  if (!isObj(payload)) return null;
  const { card, h } = payload;
  if (!Array.isArray(card) || card.length > HOLE_COUNT) return null;
  if (!card.every((s) => finite(s, 1, PICKUP_SCORE) && Number.isInteger(s))) return null;
  if (!finite(h, 0, HOLE_COUNT) || !Number.isInteger(h)) return null;
  return { card: card as number[], h };
}

/** What goes in `submit({ data })`. */
export function submissionData(card: readonly number[], shots: number): { [key: string]: Json } {
  return { card: [...card], toPar: toPar(card), par: TOTAL_PAR, shots };
}

export function submissionBody(card: readonly number[]): string {
  const aces = card.filter((s) => s === 1).length;
  const birdies = card.filter((s, i) => s > 1 && s < (HOLES[i]?.par ?? 0)).length;
  const bits = [`${formatToPar(toPar(card))} over ${card.length} holes`];
  if (aces) bits.push(`${aces} ace${aces === 1 ? "" : "s"}`);
  if (birdies) bits.push(`${birdies} birdie${birdies === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

/* ------------------------------------------------------------------ */
/* Bots                                                               */
/* ------------------------------------------------------------------ */

export interface BotSkill {
  /** 0..1 */
  level: number;
  /** Aim wobble (radians, 1σ). */
  angleSd: number;
  /** Power wobble (fraction of the power, 1σ). */
  powerSd: number;
  /** Seconds of timing slop against moving obstacles (±). */
  timing: number;
  /** Chance to take a safer, second-best line. */
  lazy: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A bot's hands from a 0..1 level: better bots wobble less. */
export function botSkill(level: number): BotSkill {
  const t = Math.max(0, Math.min(1, level));
  return {
    level: t,
    angleSd: (lerp(3.4, 1.1, t) * Math.PI) / 180,
    powerSd: lerp(0.12, 0.045, t),
    timing: lerp(0.5, 0.15, t),
    lazy: lerp(0.25, 0.06, t),
  };
}

/** Seconds a bot lines up a putt: longer when it's far out. */
export function botThinkSeconds(rand: () => number, distance: number): number {
  return 1.1 + Math.min(1.4, distance * 0.08) + rand() * 1.1;
}

/** Standard normal sample from a uniform RNG (Box–Muller). */
export function gaussian(rand: () => number): number {
  let u = 0;
  for (let i = 0; i < 8 && u <= Number.EPSILON; i++) u = rand();
  if (u <= Number.EPSILON) u = 0.5;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Palette for balls, in seat order. */
export const BALL_COLORS = ["#ffffff", "#ff4d6d", "#3fa9ff", "#ffd23d", "#8b5cf6", "#2ee6a6", "#ff8a3d", "#f472b6"] as const;
