/**
 * Trivia Royale — pure game logic. No React, no SDK calls: everything here is
 * deterministic given its inputs, so every client (and the tests) agree.
 *
 * Coordination model (platform v2 shared match state):
 *
 * - One JSON document per match, `TriviaState`. A *driver* (the lowest-seated
 *   human still present) writes phase changes: question → reveal → next
 *   question … → final. Every player writes only their own answer.
 * - All writes go through `state.update()` (compare-and-set + retry), and every
 *   transition here is a guarded, idempotent reducer: it returns `undefined`
 *   when the state already moved on, so two clients racing to drive the same
 *   transition can't double-apply it.
 * - Scores are never stored: they are folded from the answers of revealed
 *   rounds (`scoreRounds`), so every client computes the same table.
 */
import type { Json, Random } from "@xapps/sdk";
import { QUESTIONS, type Category, type Difficulty, type TriviaQuestion } from "./questions";

/* ---------------------------------------------------------------------- */
/* Tuning                                                                 */
/* ---------------------------------------------------------------------- */

export const ROUNDS = 8;
/** Answer window per question (the clock starts after the intro). */
export const QUESTION_MS = 12_000;
/** The question card and tiles land before the clock starts draining. */
export const INTRO_MS = 900;
/** Slack for late answers in flight before the driver times a question out. */
export const LATE_GRACE_MS = 700;
/** After the last present player locks in, wait this long before revealing. */
export const ALL_IN_BEAT_MS = 700;
/** The correct answer + everyone's picks. */
export const REVEAL_MS = 2_800;
/** The between-round leaderboard shuffle. */
export const LEADERBOARD_MS = 3_200;
/** The last round skips the leaderboard: reveal, then straight to the podium. */
export const LAST_REVEAL_MS = 3_200;
/** A driver that hasn't moved the match on this long past a deadline is replaced. */
export const STALE_MS = 4_000;
/** Each further backup driver waits this much longer (in case the first is gone too). */
export const BACKUP_STEP_MS = 1_500;

export const MAX_POINTS = 1_000;
/** Floor for any correct answer, however late. */
export const MIN_POINTS = 400;
/** Streak bonus: +100 for 2 in a row, +200 for 3, +300 (cap) for 4 or more. */
export const STREAK_STEP = 100;
export const STREAK_CAP = 300;
/** Round difficulty curve: three warm-ups, three mediums, two hard ones. */
export const DIFFICULTY_PLAN: readonly Difficulty[] = [1, 1, 1, 2, 2, 2, 3, 3];
/** The final round scores double. */
export const DOUBLE_ROUND = ROUNDS;

/* ---------------------------------------------------------------------- */
/* Match setup                                                            */
/* ---------------------------------------------------------------------- */

export interface Question {
  /** 1-based round number. */
  round: number;
  id: string;
  category: Category;
  difficulty: Difficulty;
  text: string;
  /** Answer + distractors in the shared display order. */
  choices: string[];
  correct: number;
  double: boolean;
}

/**
 * Picks one question per round, each from a different category, following
 * the difficulty curve. Falls back gracefully when a category runs dry
 * (tiny test banks).
 */
export function pickQuestions(
  random: Random,
  bank: readonly TriviaQuestion[] = QUESTIONS,
  count = ROUNDS,
): TriviaQuestion[] {
  const categories = random.shuffle(Array.from(new Set(bank.map((q) => q.category))));
  const used = new Set<string>();
  const usedCategories = new Set<Category>();
  const picked: TriviaQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const difficulty = DIFFICULTY_PLAN[Math.min(i, DIFFICULTY_PLAN.length - 1)] ?? 2;
    const fresh = (q: TriviaQuestion) => !used.has(q.id);
    const tiers: ((q: TriviaQuestion) => boolean)[] = [
      (q) => fresh(q) && !usedCategories.has(q.category) && q.difficulty === difficulty,
      (q) => fresh(q) && !usedCategories.has(q.category),
      (q) => fresh(q) && q.difficulty === difficulty,
      fresh,
    ];
    let choice: TriviaQuestion | undefined;
    for (const ok of tiers) {
      // Walk categories in the shared shuffled order so the category mix varies per match.
      for (const category of categories) {
        const pool = bank.filter((q) => q.category === category && ok(q));
        if (pool.length) {
          choice = random.pick(pool);
          break;
        }
      }
      if (choice) break;
    }
    if (!choice) break;
    used.add(choice.id);
    usedCategories.add(choice.category);
    // Rotate so the next round starts its search from a different category.
    categories.push(categories.shift() as Category);
    picked.push(choice);
  }
  return picked;
}

/**
 * The match every client sees. Uses forks of the shared seed only, so it is
 * identical on every client and on every call.
 */
export function buildQuestions(random: Random, bank: readonly TriviaQuestion[] = QUESTIONS, count = ROUNDS): Question[] {
  return pickQuestions(random.fork("questions"), bank, count).map((q, i) => {
    const choices = random.fork(`choices:${i}`).shuffle([q.answer, ...q.wrong]);
    return {
      round: i + 1,
      id: q.id,
      category: q.category,
      difficulty: q.difficulty,
      text: q.text,
      choices,
      correct: choices.indexOf(q.answer),
      double: i + 1 === DOUBLE_ROUND,
    };
  });
}

/* ---------------------------------------------------------------------- */
/* Scoring                                                                */
/* ---------------------------------------------------------------------- */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Answer time, clamped to the question window. */
export function clampMs(ms: number): number {
  return Number.isFinite(ms) ? Math.round(clamp(ms, 0, QUESTION_MS)) : QUESTION_MS;
}

/** 1000 × share of the clock left, never below 400 for a correct answer. */
export function speedPoints(ms: number): number {
  const share = 1 - clampMs(ms) / QUESTION_MS;
  return Math.max(MIN_POINTS, Math.round(MAX_POINTS * share));
}

/** `streak` counts consecutive correct answers including this one. */
export function streakBonus(streak: number): number {
  return streak >= 2 ? Math.min(STREAK_CAP, (streak - 1) * STREAK_STEP) : 0;
}

export function answerPoints(correct: boolean, ms: number, streak: number, double = false): number {
  if (!correct) return 0;
  return (speedPoints(ms) + streakBonus(streak)) * (double ? 2 : 1);
}

/* ---------------------------------------------------------------------- */
/* Shared state                                                           */
/* ---------------------------------------------------------------------- */

export type Phase = "question" | "reveal" | "final";

export interface Answer {
  /** Tile index picked. */
  choice: number;
  /** Time from the clock starting to the pick, measured on the player's own screen. */
  ms: number;
}

export type AnswerMap = { [playerId: string]: Answer };

export interface TriviaState {
  v: 1;
  /** 1-based round. */
  round: number;
  phase: Phase;
  /** When the current phase began (driver's clock, epoch ms). */
  startedAt: number;
  /** Who wrote the last phase change (the acting driver). */
  driver: string;
  /** Answers for the current round. */
  answers: AnswerMap;
  /** Answers of finished rounds; `history[i]` is round i + 1. */
  history: AnswerMap[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseAnswers(raw: unknown): AnswerMap | null {
  if (!isRecord(raw)) return null;
  const out: AnswerMap = {};
  for (const [id, a] of Object.entries(raw)) {
    if (!isRecord(a)) continue;
    const { choice, ms } = a;
    if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 3) continue;
    if (typeof ms !== "number" || !Number.isFinite(ms)) continue;
    out[id] = { choice, ms: clampMs(ms) };
  }
  return out;
}

/** Validates the (untrusted) shared state. Anything unexpected reads as "no state yet". */
export function parseState(raw: Json | null | undefined): TriviaState | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const { round, phase, startedAt, driver, answers, history } = raw;
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > ROUNDS) return null;
  if (phase !== "question" && phase !== "reveal" && phase !== "final") return null;
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  if (typeof driver !== "string") return null;
  const current = parseAnswers(answers);
  if (!current || !Array.isArray(history) || history.length > ROUNDS) return null;
  const past: AnswerMap[] = [];
  for (const h of history) {
    const parsed = parseAnswers(h);
    if (!parsed) return null;
    past.push(parsed);
  }
  return { v: 1, round, phase, startedAt, driver, answers: current, history: past };
}

export function toJson(state: TriviaState): Json {
  return state as unknown as Json;
}

export function initialState(driver: string, now: number): TriviaState {
  return { v: 1, round: 1, phase: "question", startedAt: now, driver, answers: {}, history: [] };
}

/** Records one player's pick. `undefined` when the round moved on or they already answered. */
export function withAnswer(
  state: TriviaState | null,
  playerId: string,
  round: number,
  choice: number,
  ms: number,
): TriviaState | undefined {
  if (!state || state.phase !== "question" || state.round !== round) return undefined;
  if (state.answers[playerId]) return undefined;
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) return undefined;
  return { ...state, answers: { ...state.answers, [playerId]: { choice, ms: clampMs(ms) } } };
}

/** question → reveal, for `round` only. */
export function toReveal(state: TriviaState | null, round: number, driver: string, now: number): TriviaState | undefined {
  if (!state || state.phase !== "question" || state.round !== round) return undefined;
  return { ...state, phase: "reveal", startedAt: now, driver };
}

/** reveal → next question (or the final standings after the last round), for `round` only. */
export function advance(state: TriviaState | null, round: number, driver: string, now: number): TriviaState | undefined {
  if (!state || state.phase !== "reveal" || state.round !== round) return undefined;
  const history = [...state.history.slice(0, round - 1), state.answers];
  if (round >= ROUNDS) return { ...state, phase: "final", startedAt: now, driver, answers: {}, history };
  return { v: 1, round: round + 1, phase: "question", startedAt: now, driver, answers: {}, history };
}

/** Answer maps of every round whose answer has been revealed. */
export function revealedRounds(state: TriviaState | null): AnswerMap[] {
  if (!state) return [];
  if (state.phase === "reveal") return [...state.history.slice(0, state.round - 1), state.answers];
  return state.history.slice(0, state.phase === "final" ? ROUNDS : state.round - 1);
}

/** Picks per tile (live counts for spectators, the reveal for everyone). */
export function choiceCounts(answers: AnswerMap, choices = 4): number[] {
  const counts = Array.from({ length: choices }, () => 0);
  for (const a of Object.values(answers)) if (a.choice < choices) counts[a.choice] = (counts[a.choice] ?? 0) + 1;
  return counts;
}

/* ---------------------------------------------------------------------- */
/* Standings                                                              */
/* ---------------------------------------------------------------------- */

export interface RoundResult {
  round: number;
  choice: number | null;
  correct: boolean;
  ms: number | null;
  points: number;
  /** Consecutive correct answers after this round (0 when wrong or missed). */
  streak: number;
}

export interface Standing {
  id: string;
  total: number;
  streak: number;
  bestStreak: number;
  correct: number;
  results: RoundResult[];
  /** Competition rank (1, 1, 3…). */
  rank: number;
}

/** Competition ranking by total, ties share a rank; keeps the input order among ties. */
export function rankStandings<T extends { total: number }>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.map((row, i) => ({ row, i })).sort((a, b) => b.row.total - a.row.total || a.i - b.i);
  const out: (T & { rank: number })[] = [];
  sorted.forEach(({ row }, i) => {
    const prev = out[i - 1];
    out.push({ ...row, rank: prev && prev.total === row.total ? prev.rank : i + 1 });
  });
  return out;
}

/** Folds revealed rounds into ranked standings for `ids` (seat order breaks ties). */
export function scoreRounds(questions: Question[], rounds: AnswerMap[], ids: string[]): Standing[] {
  const rows = ids.map((id) => {
    let total = 0;
    let streak = 0;
    let bestStreak = 0;
    let correct = 0;
    const results: RoundResult[] = [];
    rounds.forEach((answers, i) => {
      const question = questions[i];
      if (!question) return;
      const a = answers[id];
      const right = !!a && a.choice === question.correct;
      streak = right ? streak + 1 : 0;
      bestStreak = Math.max(bestStreak, streak);
      if (right) correct += 1;
      const points = a ? answerPoints(right, a.ms, streak, question.double) : 0;
      total += points;
      results.push({ round: i + 1, choice: a?.choice ?? null, correct: right, ms: a?.ms ?? null, points, streak });
    });
    return { id, total, streak, bestStreak, correct, results };
  });
  return rankStandings(rows);
}

/** The table now and just before the latest reveal (for the leaderboard shuffle). */
export function tables(questions: Question[], state: TriviaState | null, ids: string[]): { current: Standing[]; previous: Standing[] } {
  const rounds = revealedRounds(state);
  const current = scoreRounds(questions, rounds, ids);
  const previous = rounds.length ? scoreRounds(questions, rounds.slice(0, -1), ids) : current;
  return { current, previous };
}

/** "1st", "2nd", "3rd", "11th"… */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/* ---------------------------------------------------------------------- */
/* Timing, driver election and the driver's next move                     */
/* ---------------------------------------------------------------------- */

export interface Seat {
  id: string;
  seat: number;
  isBot: boolean;
}

/** Seated players currently here. Bots are always present; an unknown roster (no presence yet) means everyone. */
export function presentSeats(seats: readonly Seat[], online: readonly string[] | null): Seat[] {
  if (!online || online.length === 0) return seats.slice();
  return seats.filter((s) => s.isBot || online.includes(s.id));
}

export function allAnswered(state: TriviaState, present: readonly Seat[]): boolean {
  return present.length > 0 && present.every((s) => !!state.answers[s.id]);
}

/** How long a phase lasts at most, counted from when a client first saw it. */
export function phaseLimitMs(state: TriviaState): number {
  if (state.phase === "question") return INTRO_MS + QUESTION_MS + LATE_GRACE_MS;
  if (state.phase === "reveal") return state.round >= ROUNDS ? LAST_REVEAL_MS : REVEAL_MS + LEADERBOARD_MS;
  return Infinity;
}

/**
 * Local time at which the current phase should end: the phase limit, or a
 * beat after the last present player locked in. `anchor` is when this client
 * first saw the phase (or the match start, with no state yet); `changedAt`
 * is when it last saw any change.
 */
export function dueAt(state: TriviaState | null, anchor: number, changedAt: number, present: readonly Seat[]): number {
  if (!state) return anchor;
  const limit = anchor + phaseLimitMs(state);
  if (state.phase === "question" && allAnswered(state, present)) {
    return Math.min(limit, Math.max(anchor + INTRO_MS, changedAt) + ALL_IN_BEAT_MS);
  }
  return limit;
}

/**
 * Who should move the match on right now. Candidates are the humans still
 * present, by seat. The current driver keeps the job until it is more than
 * `STALE_MS` late; then the next candidate after it takes over, and every
 * `BACKUP_STEP_MS` after that the one after. With no driver yet (or one that
 * left) the lowest-seated present human acts at once, and the others back it
 * up the same way once it is `STALE_MS` late.
 */
export function driverFor(
  seats: readonly Seat[],
  online: readonly string[] | null,
  current: string | null,
  overdueMs: number,
): string | null {
  const candidates = presentSeats(seats, online)
    .filter((s) => !s.isBot)
    .sort((a, b) => a.seat - b.seat);
  if (candidates.length === 0) return null;
  const index = current ? candidates.findIndex((c) => c.id === current) : -1;
  if (index >= 0 && overdueMs <= STALE_MS) return current;
  const backups = (order: Seat[], first: number) => {
    const k = first + Math.floor(Math.max(0, overdueMs - STALE_MS) / BACKUP_STEP_MS);
    return (order[Math.min(order.length - 1, k)] as Seat).id;
  };
  if (index >= 0) {
    const successors = [...candidates.slice(index + 1), ...candidates.slice(0, index)];
    return successors.length ? backups(successors, 0) : current; // a lone driver keeps trying
  }
  // No driver yet, or it left: the lowest seat at once; the next ones only if that one is stale too.
  return overdueMs <= STALE_MS ? (candidates[0] as Seat).id : backups(candidates, 1);
}

export type Action =
  | { kind: "none" }
  | { kind: "start" }
  | { kind: "reveal"; round: number }
  | { kind: "advance"; round: number };

export interface DecideInput {
  state: TriviaState | null;
  /** The local player's id when it may write (seated), else null. */
  me: string | null;
  seats: readonly Seat[];
  online: readonly string[] | null;
  anchor: number;
  changedAt: number;
  now: number;
  /** Local simulation (spectating a table of bots in the mock host): this client always drives. */
  sim?: boolean;
}

/** The driver's next move for this client, if any. Pure: the caller performs it. */
export function decide(input: DecideInput): Action {
  const { state, me, seats, online, anchor, changedAt, now } = input;
  if (!me || state?.phase === "final") return { kind: "none" };
  const present = presentSeats(seats, online);
  const overdue = now - dueAt(state, anchor, changedAt, present);
  if (overdue < 0) return { kind: "none" };
  const driver = input.sim ? me : driverFor(seats, online, state?.driver ?? null, overdue);
  if (driver !== me) return { kind: "none" };
  if (!state) return { kind: "start" };
  return state.phase === "question" ? { kind: "reveal", round: state.round } : { kind: "advance", round: state.round };
}

/**
 * When this client should consider a phase to have started, in its own clock.
 * Live changes start "now" (clock skew between players doesn't matter); a
 * state that was already there at launch (rejoin, late spectator) is aged
 * by its `startedAt`, never into the future.
 */
export function anchorFor(startedAt: number, now: number, live: boolean): number {
  if (live || !Number.isFinite(startedAt)) return now;
  return Math.min(now, startedAt);
}

/** Milliseconds left on the answer clock. */
export function clockLeft(anchor: number, now: number): number {
  return clamp(QUESTION_MS - (now - anchor - INTRO_MS), 0, QUESTION_MS);
}

/** The answer time to report for a pick made at `now`. */
export function answerMs(anchor: number, now: number): number {
  return clampMs(now - anchor - INTRO_MS);
}

/* ---------------------------------------------------------------------- */
/* Bots                                                                   */
/* ---------------------------------------------------------------------- */

/** FNV-1a, for stable per-bot personalities. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface BotProfile {
  /** Base chance of a right answer on a medium question. */
  accuracy: number;
  /** Typical time to a confident answer, in ms. */
  paceMs: number;
}

/** Every bot gets its own stable personality: some are sharp, some are quick, some are neither. */
export function botProfile(botId: string): BotProfile {
  const h = hash(botId);
  return {
    accuracy: 0.6 + ((h % 1000) / 1000) * 0.24,
    paceMs: 3_000 + (((h >>> 10) % 1000) / 1000) * 3_200,
  };
}

const DIFFICULTY_ACCURACY: Record<Difficulty, number> = { 1: 0.16, 2: 0, 3: -0.18 };
const DIFFICULTY_PACE: Record<Difficulty, number> = { 1: 0.8, 2: 1, 3: 1.25 };
/** Chance a bot freezes and lets the clock run out. */
export const BOT_TIMEOUT_CHANCE = 0.04;

/**
 * A human-ish answer: right more often on easy questions, quicker when
 * right, slower and sometimes out of time when wrong. `null` = no answer.
 * `rand` is local noise (Math.random), never the shared seed.
 */
export function planBotAnswer(
  question: Pick<Question, "correct" | "difficulty" | "choices">,
  profile: BotProfile,
  rand: () => number = Math.random,
): Answer | null {
  if (rand() < BOT_TIMEOUT_CHANCE) return null;
  const accuracy = clamp(profile.accuracy + DIFFICULTY_ACCURACY[question.difficulty], 0.2, 0.97);
  const right = rand() < accuracy;
  const wrong = question.choices.map((_, i) => i).filter((i) => i !== question.correct);
  const choice = right ? question.correct : (wrong[Math.floor(rand() * wrong.length)] ?? 0);
  // Roughly normal around the bot's pace (sum of uniforms), hesitating more on wrong answers.
  const jitter = (rand() + rand() + rand()) / 3 - 0.5; // -0.5..0.5
  const pace = profile.paceMs * DIFFICULTY_PACE[question.difficulty] * (right ? 1 : 1.3);
  const ms = Math.round(clamp(pace * (1 + jitter * 1.1), 1_100, QUESTION_MS - 400));
  return { choice, ms };
}

/* ---------------------------------------------------------------------- */
/* Submission                                                             */
/* ---------------------------------------------------------------------- */

export function submissionFor(
  questions: Question[],
  standing: Standing,
): { score: number; data: Json; display: { kind: "text"; title: string; body: string } } {
  return {
    score: standing.total,
    data: {
      correct: standing.correct,
      bestStreak: standing.bestStreak,
      rounds: standing.results.map((r) => ({
        q: questions[r.round - 1]?.id ?? null,
        pick: r.choice === null ? null : (questions[r.round - 1]?.choices[r.choice] ?? null),
        correct: r.correct,
        ms: r.ms,
        points: r.points,
      })),
    },
    display: {
      kind: "text",
      title: `${standing.correct}/${ROUNDS} correct · ${standing.total.toLocaleString("en")} pts`,
      body: standing.results.map((r) => (r.correct ? "✅" : r.choice === null ? "⏰" : "❌")).join(" "),
    },
  };
}
