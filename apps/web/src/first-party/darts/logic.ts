/**
 * Darts "Score attack" rules, callouts, room messages and progress (pure,
 * unit-tested). Everyone throws 9 darts (3 rounds of 3) at the same time;
 * the highest total wins.
 */

import type { Json } from "@xapps/sdk";
import { hitTest, radiusOf, type Hit, type Point } from "./board";

export const DARTS_PER_ROUND = 3;
export const ROUNDS = 3;
export const TOTAL_DARTS = DARTS_PER_ROUND * ROUNDS;
/** The most anyone can score: nine treble 20s. */
export const MAX_TOTAL = 60 * TOTAL_DARTS;

/** How long the end-of-round callout stays up before the darts are pulled (ms). */
export const ROUND_END_MS = 1500;
/** …and a longer beat for big rounds. */
export const BIG_ROUND_END_MS = 2600;

export interface Scored extends Hit {
  /** Where it landed (mm). */
  at: Point;
}

export function score(at: Point): Scored {
  return { ...hitTest(at), at };
}

export function scoreAll(darts: readonly Point[]): Scored[] {
  return darts.map(score);
}

export function total(darts: readonly Point[]): number {
  return darts.reduce((sum, p) => sum + hitTest(p).score, 0);
}

/** Darts grouped into rounds of three (the last one may be partial). */
export function rounds<T>(darts: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < darts.length; i += DARTS_PER_ROUND) out.push(darts.slice(i, i + DARTS_PER_ROUND));
  return out;
}

/** 0-based round of the next dart (ROUNDS once all nine are thrown). */
export function roundOf(thrown: number): number {
  return Math.min(ROUNDS, Math.floor(thrown / DARTS_PER_ROUND));
}

export function roundScores(darts: readonly Point[]): number[] {
  return rounds(darts).map((r) => total(r));
}

/* ---------------------------------------------------------------------- */
/* Callouts                                                                */
/* ---------------------------------------------------------------------- */

export const is180 = (hits: readonly Hit[]): boolean =>
  hits.length === DARTS_PER_ROUND && hits.every((h) => h.number === 20 && h.multiplier === 3);

/** Three bulls (either bull) in one round: a darts "hat trick". */
export const isHatTrick = (hits: readonly Hit[]): boolean =>
  hits.length === DARTS_PER_ROUND && hits.every((h) => h.number === 25);

/** Single, double and treble of the same number in one round. */
export function isShanghai(hits: readonly Hit[]): boolean {
  if (hits.length !== DARTS_PER_ROUND) return false;
  const n = hits[0]!.number;
  if (n < 1 || n > 20 || !hits.every((h) => h.number === n)) return false;
  const m = hits.map((h) => h.multiplier).sort();
  return m[0] === 1 && m[1] === 2 && m[2] === 3;
}

/** 26 with a single 20, 5 and 1: the classic "bed and breakfast". */
export function isBedAndBreakfast(hits: readonly Hit[]): boolean {
  if (hits.length !== DARTS_PER_ROUND || !hits.every((h) => h.multiplier === 1)) return false;
  return hits.map((h) => h.number).sort((a, b) => a - b).join(",") === "1,5,20";
}

/** Two darts of one round landing within this (mm): Robin Hood. */
export const ROBIN_HOOD_MM = 3;

export function isRobinHood(round: readonly Point[]): boolean {
  for (let i = 0; i < round.length; i++) {
    for (let j = i + 1; j < round.length; j++) {
      const a = round[i]!;
      const b = round[j]!;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= ROBIN_HOOD_MM && radiusOf(a) <= 225) return true;
    }
  }
  return false;
}

export type CalloutTone = "legend" | "hot" | "good" | "meh" | "cold";

export interface Callout {
  text: string;
  sub?: string;
  tone: CalloutTone;
}

/** What the caller shouts after a full round of three. */
export function roundCallout(hits: readonly Hit[]): Callout {
  const sum = hits.reduce((s, h) => s + h.score, 0);
  if (is180(hits)) return { text: "ONE HUNDRED AND EIGHTY!", sub: "Maximum", tone: "legend" };
  if (isHatTrick(hits)) return { text: "Hat trick!", sub: `${sum} · three bulls`, tone: "legend" };
  if (isShanghai(hits)) return { text: "Shanghai!", sub: `${sum}`, tone: "hot" };
  if (sum >= 140) return { text: `Ton ${sum - 100}!`, sub: "Huge round", tone: "hot" };
  if (sum >= 100) return { text: sum === 100 ? "Ton!" : `Ton ${sum - 100}`, tone: "hot" };
  if (isBedAndBreakfast(hits)) return { text: "Bed & breakfast", sub: "26", tone: "meh" };
  if (sum === 0) return { text: "Oof. Nothing.", tone: "cold" };
  if (sum >= 60) return { text: `${sum}`, sub: "Nice round", tone: "good" };
  if (sum === 45) return { text: "45", sub: "Bag of nuts", tone: "meh" };
  return { text: `${sum}`, tone: sum < 20 ? "cold" : "meh" };
}

export type DartTone = "bull" | "treble" | "double" | "single" | "miss";

export function dartTone(hit: Hit): DartTone {
  if (hit.number === 25) return "bull";
  if (hit.multiplier === 3) return "treble";
  if (hit.multiplier === 2) return "double";
  if (hit.multiplier === 1) return "single";
  return "miss";
}

/* ---------------------------------------------------------------------- */
/* Room messages                                                           */
/* ---------------------------------------------------------------------- */

/** Coordinates travel as tenths of a millimetre. */
const PRECISION = 10;
const LIMIT_MM = 600;

/** Rounds a landing point to what the wire carries (so every client scores it identically). */
export function quantize(p: Point): Point {
  return { x: Math.round(p.x * PRECISION) / PRECISION, y: Math.round(p.y * PRECISION) / PRECISION };
}

/** `{ d: [x1, y1, x2, y2, …] }`: all of a player's darts so far, so a lost message heals itself. */
export function toMessage(darts: readonly Point[]): { d: number[] } {
  const d: number[] = [];
  for (const p of darts.slice(0, TOTAL_DARTS)) d.push(Math.round(p.x * PRECISION), Math.round(p.y * PRECISION));
  return { d };
}

export function parseMessage(payload: unknown): Point[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const d = (payload as { d?: unknown }).d;
  if (!Array.isArray(d) || d.length % 2 !== 0 || d.length > TOTAL_DARTS * 2) return null;
  const out: Point[] = [];
  for (let i = 0; i < d.length; i += 2) {
    const x = d[i];
    const y = d[i + 1];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > LIMIT_MM * PRECISION || Math.abs(y) > LIMIT_MM * PRECISION) return null;
    out.push({ x: x / PRECISION, y: y / PRECISION });
  }
  return out;
}

/** Keeps the longer of what we had and what arrived (messages can overtake each other). */
export function mergeDarts(known: readonly Point[] | undefined, incoming: readonly Point[]): Point[] {
  if (!known || incoming.length >= known.length) return incoming.slice(0, TOTAL_DARTS);
  return known.slice();
}

/* ---------------------------------------------------------------------- */
/* Submission                                                              */
/* ---------------------------------------------------------------------- */

export function submissionFor(darts: readonly Point[]): { score: number; data: Json; display: { kind: "text"; title: string; body: string } } {
  const hits = scoreAll(darts);
  const sum = total(darts);
  const byRound = rounds(hits).map((r) => r.map((h) => h.label).join(" "));
  return {
    score: sum,
    data: { darts: toMessage(darts).d, rounds: roundScores(darts) },
    display: { kind: "text", title: `${sum}`, body: byRound.join(" · ") || "No darts" },
  };
}

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements (the local player's side)                */
/* ---------------------------------------------------------------------- */

export type DartsAchievement =
  | "first_game"
  | "winner"
  | "bullseye"
  | "ton_up"
  | "hat_trick"
  | "one_eighty"
  | "treble_century"
  | "shanghai"
  | "bed_and_breakfast"
  | "robin_hood";

export const PROGRESS = {
  /** "Ton up": a round of at least this. */
  ton: 100,
  /** "Treble century": a 9-dart total of at least this. */
  bigGame: 300,
} as const;

/**
 * Achievements earned by the darts thrown so far. Dart- and round-level ones
 * land as soon as they happen; `final` adds the game-level ones.
 */
export function earnedAchievements(darts: readonly Point[], final: boolean): DartsAchievement[] {
  const earned: DartsAchievement[] = [];
  const hits = scoreAll(darts);
  const full = rounds(hits).filter((r) => r.length === DARTS_PER_ROUND);
  const pointRounds = rounds(darts);
  if (hits.some((h) => h.ring === "bull")) earned.push("bullseye");
  if (full.some((r) => r.reduce((s, h) => s + h.score, 0) >= PROGRESS.ton)) earned.push("ton_up");
  if (full.some(isHatTrick)) earned.push("hat_trick");
  if (full.some(is180)) earned.push("one_eighty");
  if (full.some(isShanghai)) earned.push("shanghai");
  if (full.some(isBedAndBreakfast)) earned.push("bed_and_breakfast");
  if (pointRounds.some(isRobinHood)) earned.push("robin_hood");
  if (!final) return earned;
  if (darts.length >= TOTAL_DARTS) earned.push("first_game");
  if (total(darts) >= PROGRESS.bigGame) earned.push("treble_century");
  return earned;
}

/** Stats to report when a game ends (zero counters are left out). */
export function gameStats(darts: readonly Point[]): { [key: string]: number } {
  const hits = scoreAll(darts);
  const stats: { [key: string]: number } = { best_total: total(darts), games: 1 };
  const bulls = hits.filter((h) => h.number === 25).length;
  if (bulls > 0) stats.bullseyes = bulls;
  const maxes = rounds(hits).filter(is180).length;
  if (maxes > 0) stats.ton_80s = maxes;
  return stats;
}

/** Whether a settled result makes us the outright winner of a table. */
export function wonTable(ranks: { [playerId: string]: number } | undefined, meId: string, players: number): boolean {
  if (!ranks || players < 2) return false;
  if (ranks[meId] !== 1) return false;
  return Object.entries(ranks).filter(([, r]) => r === 1).length === 1;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
