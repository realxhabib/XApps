/**
 * Emoji Decode — pure game logic. No React, no SDK calls: everything here is
 * deterministic given its inputs, so both clients (and the tests) agree.
 */
import type { Json, MatchResult, Random } from "@xapps/sdk";
import { PUZZLES, type Puzzle } from "./puzzles";

/* ---------------------------------------------------------------------- */
/* Tuning                                                                 */
/* ---------------------------------------------------------------------- */

export const QUESTION_COUNT = 8;
/** Answer window per puzzle. */
export const QUESTION_MS = 12_000;
/**
 * The clock starts this long after a puzzle appears, so the tiles have time
 * to pop in before the ring starts draining. Answering inside the grace
 * window still earns the full speed bonus.
 */
export const INTRO_GRACE_MS = 400;
/** How long the verdict stays on screen before the next puzzle. */
export const REVEAL_MS = 1_100;
/** Approximate exit + entrance time between two puzzles (bot pacing). */
export const TRANSITION_MS = 450;

export const BASE_POINTS = 100;
export const SPEED_POINTS = 100;
export const STREAK_BONUS = 25;
/** The streak bonus applies from this many correct answers in a row. */
export const STREAK_BONUS_FROM = 3;
/** Keeps a match varied: never more than this many puzzles of one category. */
export const MAX_PER_CATEGORY = 3;

export const BOT_ACCURACY = 0.72;
export const BOT_MIN_MS = 2_500;
export const BOT_MAX_MS = 9_000;

/* ---------------------------------------------------------------------- */
/* Match setup                                                            */
/* ---------------------------------------------------------------------- */

export interface Question {
  index: number;
  puzzle: Puzzle;
  /** Answer + distractors in the (shared) display order. */
  options: string[];
  correctIndex: number;
}

/**
 * Picks `count` puzzles in a shared order, capping each category so a match
 * never turns into eight movies in a row.
 */
export function pickPuzzles(random: Random, bank: readonly Puzzle[] = PUZZLES, count = QUESTION_COUNT): Puzzle[] {
  const shuffled = random.shuffle(bank);
  const perCategory = new Map<string, number>();
  const picked: Puzzle[] = [];
  const skipped: Puzzle[] = [];
  for (const puzzle of shuffled) {
    if (picked.length >= count) break;
    const used = perCategory.get(puzzle.category) ?? 0;
    if (used >= MAX_PER_CATEGORY) {
      skipped.push(puzzle);
      continue;
    }
    perCategory.set(puzzle.category, used + 1);
    picked.push(puzzle);
  }
  // Tiny banks (tests) may not satisfy the cap — top up in shuffled order.
  for (const puzzle of skipped) {
    if (picked.length >= count) break;
    picked.push(puzzle);
  }
  return picked;
}

/**
 * Builds the match both players see. Uses forks of the shared seed only, so
 * the result is identical on every client and on every call (safe to run in
 * a React initializer, even twice under StrictMode).
 */
export function buildMatch(random: Random, bank: readonly Puzzle[] = PUZZLES, count = QUESTION_COUNT): Question[] {
  return pickPuzzles(random.fork("puzzles"), bank, count).map((puzzle, index) => {
    const options = random.fork("q" + index).shuffle([puzzle.answer, ...puzzle.distractors]);
    return { index, puzzle, options, correctIndex: options.indexOf(puzzle.answer) };
  });
}

/** Splits an emoji string into user-perceived characters (ZWJ/keycap safe). */
export function splitEmoji(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  const parts = Segmenter
    ? Array.from(new Segmenter("en", { granularity: "grapheme" }).segment(text), (s) => s.segment)
    : Array.from(text);
  return parts.filter((part) => part.trim() !== "");
}

/* ---------------------------------------------------------------------- */
/* Scoring                                                                */
/* ---------------------------------------------------------------------- */

/** Milliseconds left on the clock at `now` for a puzzle shown at `shownAt`. */
export function remainingAt(shownAt: number, now: number): number {
  const ticking = Math.max(0, now - shownAt - INTRO_GRACE_MS);
  return Math.max(0, Math.min(QUESTION_MS, QUESTION_MS - ticking));
}

/** 0–100 speed bonus: round(100 × remaining / 12 s). */
export function speedBonus(remainingMs: number): number {
  const fraction = Math.max(0, Math.min(1, remainingMs / QUESTION_MS));
  return Math.round(SPEED_POINTS * fraction);
}

/**
 * Points for one answer. `streak` counts consecutive correct answers
 * *including this one*: the 3rd, 4th, … in a row each earn +25.
 */
export function answerPoints(correct: boolean, remainingMs: number, streak: number): number {
  if (!correct) return 0;
  return BASE_POINTS + speedBonus(remainingMs) + (streak >= STREAK_BONUS_FROM ? STREAK_BONUS : 0);
}

export interface AnswerRecord {
  q: number;
  puzzleId: string;
  /** Option index picked, or `null` when the clock ran out. */
  choice: number | null;
  correct: boolean;
  remainingMs: number;
  /** Real time from the puzzle appearing to the answer (includes the intro grace). */
  elapsedMs: number;
  points: number;
  /** Consecutive correct answers after this one (0 when wrong). */
  streak: number;
  /** Running total after this answer. */
  total: number;
}

export interface RunState {
  answers: AnswerRecord[];
  total: number;
  streak: number;
  bestStreak: number;
}

export const EMPTY_RUN: RunState = { answers: [], total: 0, streak: 0, bestStreak: 0 };

/**
 * Applies one answer. Idempotent per question: answering the same `q` twice
 * returns the existing record and an unchanged run. `elapsedMs` is only for
 * display/stats; scoring uses the clock's `remainingMs`.
 */
export function recordAnswer(
  run: RunState,
  question: Question,
  choice: number | null,
  remainingMs: number,
  elapsedMs: number = QUESTION_MS - remainingMs + INTRO_GRACE_MS,
): { run: RunState; answer: AnswerRecord } {
  const existing = run.answers.find((a) => a.q === question.index);
  if (existing) return { run, answer: existing };
  const correct = choice !== null && choice === question.correctIndex;
  const streak = correct ? run.streak + 1 : 0;
  const clamped = correct ? Math.max(0, Math.min(QUESTION_MS, Math.round(remainingMs))) : 0;
  const points = answerPoints(correct, clamped, streak);
  const total = run.total + points;
  const answer: AnswerRecord = {
    q: question.index,
    puzzleId: question.puzzle.id,
    choice,
    correct,
    remainingMs: Math.max(0, Math.round(remainingMs)),
    elapsedMs: Math.max(0, Math.round(elapsedMs)),
    points,
    streak,
    total,
  };
  return {
    run: {
      answers: [...run.answers, answer],
      total,
      streak,
      bestStreak: Math.max(run.bestStreak, streak),
    },
    answer,
  };
}

/** Re-scores a whole run from scratch (used by tests and summaries). */
export function scoreRun(questions: Question[], picks: { choice: number | null; remainingMs: number }[]): RunState {
  let run = EMPTY_RUN;
  picks.forEach((pick, i) => {
    const question = questions[i];
    if (question) run = recordAnswer(run, question, pick.choice, pick.remainingMs).run;
  });
  return run;
}

export interface RunSummary {
  correct: number;
  total: number;
  bestStreak: number;
  /** Average answer time of correct answers, in ms (null if none). */
  avgCorrectMs: number | null;
}

export function summarize(run: RunState): RunSummary {
  const correct = run.answers.filter((a) => a.correct);
  const times = correct.map((a) => a.elapsedMs);
  return {
    correct: correct.length,
    total: run.total,
    bestStreak: run.bestStreak,
    avgCorrectMs: times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
  };
}

/** What goes into `xapps.submit({ data })`. */
export function submissionData(questions: Question[], run: RunState): Json {
  return {
    answers: run.answers.map((a) => ({
      q: a.q,
      id: a.puzzleId,
      pick: a.choice === null ? null : (questions[a.q]?.options[a.choice] ?? null),
      correct: a.correct,
      ms: a.elapsedMs,
      points: a.points,
    })),
  };
}

/* ---------------------------------------------------------------------- */
/* Opponent progress (live broadcast + bot)                               */
/* ---------------------------------------------------------------------- */

/** Room event sent after every answer: `room.send("answered", …)`. */
export const ANSWERED_EVENT = "answered";

export type AnsweredPayload = { q: number; correct: boolean; points: number; total: number };

const MAX_POINTS_PER_ANSWER = BASE_POINTS + SPEED_POINTS + STREAK_BONUS;

/** Validates an untrusted room payload. */
export function parseAnswered(payload: unknown): AnsweredPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { q, correct, points, total } = payload as Record<string, unknown>;
  if (typeof q !== "number" || !Number.isInteger(q) || q < 0 || q >= QUESTION_COUNT) return null;
  if (typeof correct !== "boolean") return null;
  if (typeof points !== "number" || !Number.isFinite(points) || points < 0 || points > MAX_POINTS_PER_ANSWER) return null;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return null;
  if (total > MAX_POINTS_PER_ANSWER * QUESTION_COUNT) return null;
  return { q, correct, points: Math.round(points), total: Math.round(total) };
}

export interface PipResult {
  correct: boolean;
  points: number;
}

/** An opponent's progress through the 8 puzzles. */
export interface Track {
  results: (PipResult | null)[];
  total: number;
}

export function emptyTrack(): Track {
  return { results: Array.from({ length: QUESTION_COUNT }, () => null), total: 0 };
}

/** Idempotent (dedupes by `q`) and order-tolerant (totals only go up). */
export function applyToTrack(track: Track, p: AnsweredPayload): Track {
  if (track.results[p.q]) return track;
  const results = track.results.slice();
  results[p.q] = { correct: p.correct, points: p.points };
  return { results, total: Math.max(track.total, p.total) };
}

export function answeredCount(track: Track): number {
  return track.results.filter(Boolean).length;
}

export function trackFromRun(run: RunState): Track {
  let track = emptyTrack();
  for (const a of run.answers) track = applyToTrack(track, { q: a.q, correct: a.correct, points: a.points, total: a.total });
  return track;
}

/** Async "ghost": where the opponent's final score would be at this point at an even pace. */
export function paceScore(target: number, answered: number): number {
  return Math.round((target * Math.max(0, Math.min(QUESTION_COUNT, answered))) / QUESTION_COUNT);
}

export interface BotStep extends AnsweredPayload {
  /** When the bot answers, in ms since the match started. */
  atMs: number;
  /** How long the bot looked at this puzzle. */
  delayMs: number;
  choice: number;
}

/**
 * Simulates a bot run on its own timeline: each puzzle appears after the
 * previous verdict + transition, and the bot answers 2.5–9 s later with
 * ~72 % accuracy. `rand` is local noise (`Math.random`), never shared.
 */
export function planBot(
  questions: Question[],
  rand: () => number = Math.random,
  accuracy = BOT_ACCURACY,
): BotStep[] {
  const steps: BotStep[] = [];
  let run = EMPTY_RUN;
  let shownAt = 0;
  for (const question of questions) {
    const delayMs = Math.round(BOT_MIN_MS + rand() * (BOT_MAX_MS - BOT_MIN_MS));
    const correct = rand() < accuracy;
    const wrong = question.options.map((_, i) => i).filter((i) => i !== question.correctIndex);
    const choice = correct
      ? question.correctIndex
      : (wrong[Math.min(wrong.length - 1, Math.floor(rand() * wrong.length))] ?? 0);
    const atMs = shownAt + delayMs;
    const result = recordAnswer(run, question, choice, remainingAt(shownAt, atMs), delayMs);
    run = result.run;
    steps.push({
      q: question.index,
      atMs,
      delayMs,
      choice,
      correct: result.answer.correct,
      points: result.answer.points,
      total: result.answer.total,
    });
    shownAt = atMs + REVEAL_MS + TRANSITION_MS;
  }
  return steps;
}

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements                                         */
/* ---------------------------------------------------------------------- */

/** Achievement ids (declared in the app's manifest). */
export type DecodeAchievement =
  | "first_win"
  | "fluent"
  | "lightning"
  | "on_a_roll"
  | "score_1500"
  | "speed_reader"
  | "photo_finish"
  | "lost_in_translation";

export const PROGRESS = {
  /** "Lightning read": decoded within this long of the puzzle appearing. */
  lightningMs: 2_000,
  /** "On a roll": this many in a row. */
  rollStreak: 5,
  /** "1,500 club": near-perfect and quick (the ceiling is 1,750). */
  bigScore: 1_500,
  /** "Speed reader": at least this many decoded… */
  speedReaderCorrect: 6,
  /** …averaging at most this long each. */
  speedReaderAvgMs: 4_000,
  /** "Photo finish": win by at most this many points. */
  photoFinishPoints: 25,
} as const;

/**
 * Achievements the run so far has earned. Per-answer ones (lightning, streak)
 * unlock the moment the answer lands; whole-match ones once all eight puzzles
 * are answered.
 */
export function earnedAchievements(run: RunState, count = QUESTION_COUNT): DecodeAchievement[] {
  const earned: DecodeAchievement[] = [];
  if (run.answers.some((a) => a.correct && a.elapsedMs <= PROGRESS.lightningMs)) earned.push("lightning");
  if (run.bestStreak >= PROGRESS.rollStreak) earned.push("on_a_roll");
  if (run.answers.length < count) return earned;
  const s = summarize(run);
  if (s.correct === count) earned.push("fluent");
  if (run.total >= PROGRESS.bigScore) earned.push("score_1500");
  if (s.correct >= PROGRESS.speedReaderCorrect && s.avgCorrectMs !== null && s.avgCorrectMs < PROGRESS.speedReaderAvgMs) {
    earned.push("speed_reader");
  }
  if (s.correct === 0) earned.push("lost_in_translation");
  return earned;
}

/** Stats to report when the run is over (zero counters are left out). */
export function runStats(run: RunState): { [key: string]: number } {
  const correct = run.answers.filter((a) => a.correct);
  const stats: { [key: string]: number } = { best_score: run.total };
  if (correct.length > 0) {
    stats.puzzles_decoded = correct.length;
    stats.fastest_decode = Math.min(...correct.map((a) => a.elapsedMs));
  }
  return stats;
}

/** Achievements and stats from the settled match: a win, and how close it was. */
export function resultProgress(
  result: Pick<MatchResult, "winnerId" | "scores">,
  me: string,
): { achievements: DecodeAchievement[]; stats: { [key: string]: number } } {
  if (result.winnerId !== me) return { achievements: [], stats: {} };
  const mine = result.scores[me];
  const others = Object.entries(result.scores)
    .filter(([id, score]) => id !== me && typeof score === "number")
    .map(([, score]) => score as number);
  const achievements: DecodeAchievement[] = ["first_win"];
  if (typeof mine === "number" && others.length > 0 && mine - Math.max(...others) <= PROGRESS.photoFinishPoints) {
    achievements.push("photo_finish");
  }
  return { achievements, stats: { wins: 1 } };
}
