/**
 * Reflexes — pure game rules.
 *
 * No React, no timers, no SDK side effects: everything here is deterministic
 * given its inputs, so both clients of a live duel compute identical outcomes
 * from the same pair of per-round results.
 *
 * Rules in one breath: best of five rounds, first to three wins. Each round
 * waits a shared random STEADY delay, then fires DRAW. Reaction time is
 * measured locally on each device (tap time − signal time), so network lag
 * never decides a duel.
 *
 * Every player's round result falls into one of three buckets, ranked:
 *
 *   tap (valid reaction)  >  no draw (never tapped / timed out)  >  false start
 *
 * A better bucket always wins the round. Two taps compare milliseconds (the
 * lower wins; an exact tie scores nobody). Two fouls of the same kind — both
 * false-started, or both never drew — score nobody either.
 *
 * Void rounds are NOT replayed: they still use up one of the five rounds.
 * That keeps the duel short and both clients in lock-step, at the cost of a
 * rare drawn match (e.g. 2–2 after five rounds).
 */
import type { Json, Random } from "@xapps/sdk";

/* ------------------------------------------------------------------ */
/* Tuning                                                             */
/* ------------------------------------------------------------------ */

/** Round wins needed to take the duel. */
export const WINS_NEEDED = 3;
/** Hard cap on rounds (void rounds count toward it). */
export const MAX_ROUNDS = 5;
/** Shared STEADY delay window. */
export const STEADY_MIN_MS = 1600;
export const STEADY_MAX_MS = 4200;
/** "Round 2" banner before STEADY. Identical on both clients. */
export const INTRO_MS = 1100;
/** If you haven't tapped this long after GO, the round is a miss for you. */
export const MISS_AFTER_MS = 3000;
/** Give up on the opponent's result this long after our own DRAW (they "never drew"). */
export const OPP_TIMEOUT_MS = 8000;
/**
 * After broadcasting a round result we send it again at these offsets, in case
 * a message was dropped. Receivers dedupe by round, so repeats are harmless.
 */
export const RESEND_AFTER_MS = [1500, 4000] as const;
/** How long a round's outcome stays on screen before the next round. */
export const REVEAL_MS = 2200;
/** Beat after your own result before the verdict, so the count-up / TOO EARLY can land. */
export const SETTLE_MS = { tap: 750, falseStart: 1000, miss: 600 } as const;
/** Largest reaction we accept over the wire (anything slower is a miss anyway). */
const MAX_WIRE_MS = 60_000;

/** Bot model: clamp(normal(275, 55), 170, 520) ms, with a 7% itchy trigger finger. */
export const BOT = {
  meanMs: 275,
  deviationMs: 55,
  minMs: 170,
  maxMs: 520,
  falseStartChance: 0.07,
} as const;

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** One player's result for one round. */
export interface RoundResult {
  /** Whole-millisecond reaction time, or `null` for a false start / no draw. */
  ms: number | null;
  /** Tapped during STEADY. Always paired with `ms: null`. */
  falseStart: boolean;
}

export type Side = "me" | "opp";
export type RoundWinner = Side | "none";
export type ResultKind = "tap" | "miss" | "false-start";

export type RoundReason =
  /** Both tapped; the lower time won. */
  | "faster"
  /** Both tapped with the exact same time. */
  | "tie"
  /** The loser jumped the gun. */
  | "false-start"
  /** The loser never drew (didn't tap in time, or their result never arrived). */
  | "no-draw"
  | "both-false-start"
  | "both-no-draw";

export interface RoundOutcome {
  round: number;
  me: RoundResult;
  opp: RoundResult;
  winner: RoundWinner;
  reason: RoundReason;
  /** Winning margin in ms when both players tapped, otherwise `null`. */
  marginMs: number | null;
}

export interface Score {
  me: number;
  opp: number;
}

/** What goes over the wire: `room.send("result", …)`. */
export interface ResultMessage {
  round: number;
  ms: number | null;
  falseStart: boolean;
}

export const FALSE_START: RoundResult = Object.freeze({ ms: null, falseStart: true });
export const NO_DRAW: RoundResult = Object.freeze({ ms: null, falseStart: false });

/* ------------------------------------------------------------------ */
/* Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The STEADY delay for a round. Seeded per round from the shared match RNG
 * so both clients fire DRAW after exactly the same wait.
 */
export function steadyDelayMs(random: Pick<Random, "fork">, round: number): number {
  return random.fork(`round-${round}`).float(STEADY_MIN_MS, STEADY_MAX_MS);
}

/** Reaction time from two `performance.now()` stamps, as a whole, non-negative ms. */
export function reactionMs(signalAt: number, tapAt: number): number {
  return Math.max(0, Math.round(tapAt - signalAt));
}

/**
 * Heartbeat spacing during STEADY. It depends on elapsed time ONLY (never on
 * the round's delay), so the rising tempo can't be used to predict DRAW.
 */
export function heartbeatIntervalMs(elapsedMs: number): number {
  return Math.max(460, Math.round(960 - Math.max(0, elapsedMs) * 0.13));
}

/* ------------------------------------------------------------------ */
/* Resolution                                                         */
/* ------------------------------------------------------------------ */

export function classify(result: RoundResult): ResultKind {
  if (result.falseStart) return "false-start";
  return result.ms === null ? "miss" : "tap";
}

const RANK: Record<ResultKind, number> = { "false-start": 0, miss: 1, tap: 2 };

/**
 * Decide a round from both players' results. Symmetric: swapping `me` and
 * `opp` mirrors the winner, so both clients agree.
 */
export function resolveRound(round: number, me: RoundResult, opp: RoundResult): RoundOutcome {
  const mine = normalizeResult(me);
  const theirs = normalizeResult(opp);
  const a = classify(mine);
  const b = classify(theirs);
  const base = { round, me: mine, opp: theirs };

  if (a !== b) {
    const winner: Side = RANK[a] > RANK[b] ? "me" : "opp";
    const loserKind = winner === "me" ? b : a;
    return { ...base, winner, reason: loserKind === "false-start" ? "false-start" : "no-draw", marginMs: null };
  }
  if (a === "false-start") return { ...base, winner: "none", reason: "both-false-start", marginMs: null };
  if (a === "miss") return { ...base, winner: "none", reason: "both-no-draw", marginMs: null };

  const diff = (theirs.ms as number) - (mine.ms as number);
  if (diff === 0) return { ...base, winner: "none", reason: "tie", marginMs: 0 };
  return { ...base, winner: diff > 0 ? "me" : "opp", reason: "faster", marginMs: Math.abs(diff) };
}

/** The same outcome seen from the other seat. */
export function mirrorOutcome(outcome: RoundOutcome): RoundOutcome {
  const winner: RoundWinner = outcome.winner === "me" ? "opp" : outcome.winner === "opp" ? "me" : "none";
  return { ...outcome, me: outcome.opp, opp: outcome.me, winner };
}

export function tally(outcomes: readonly RoundOutcome[]): Score {
  const score: Score = { me: 0, opp: 0 };
  for (const o of outcomes) {
    if (o.winner === "me") score.me++;
    else if (o.winner === "opp") score.opp++;
  }
  return score;
}

export function isMatchOver(outcomes: readonly RoundOutcome[]): boolean {
  const { me, opp } = tally(outcomes);
  return me >= WINS_NEEDED || opp >= WINS_NEEDED || outcomes.length >= MAX_ROUNDS;
}

export function matchWinner(score: Score): RoundWinner {
  if (score.me === score.opp) return "none";
  return score.me > score.opp ? "me" : "opp";
}

/** "Match point" when either player is one round from the duel, "Final round" on round five. */
export function roundLabel(round: number, score: Score): string | null {
  if (round >= MAX_ROUNDS) return "Final round";
  if (score.me === WINS_NEEDED - 1 || score.opp === WINS_NEEDED - 1) return "Match point";
  return null;
}

/** Fastest valid reaction, or `null` if there wasn't one. */
export function bestMs(results: readonly RoundResult[]): number | null {
  let best: number | null = null;
  for (const r of results) {
    if (r.falseStart || r.ms === null) continue;
    if (best === null || r.ms < best) best = r.ms;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Wire format                                                        */
/* ------------------------------------------------------------------ */

/** Canonical form: whole ms, false starts carry no time. */
export function normalizeResult(result: RoundResult): RoundResult {
  if (result.falseStart) return FALSE_START;
  if (result.ms === null || !Number.isFinite(result.ms)) return NO_DRAW;
  return { ms: Math.max(0, Math.round(result.ms)), falseStart: false };
}

export function toMessage(round: number, result: RoundResult): ResultMessage {
  const r = normalizeResult(result);
  return { round, ms: r.ms, falseStart: r.falseStart };
}

/** Validate an incoming room payload. Returns `null` for anything malformed. */
export function parseResultMessage(payload: unknown): ResultMessage | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const { round, ms, falseStart } = payload as { round?: unknown; ms?: unknown; falseStart?: unknown };
  if (typeof round !== "number" || !Number.isInteger(round) || round < 1 || round > MAX_ROUNDS) return null;
  if (typeof falseStart !== "boolean") return null;
  if (falseStart) return { round, ms: null, falseStart: true };
  if (ms === null) return { round, ms: null, falseStart: false };
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > MAX_WIRE_MS) return null;
  return { round, ms: Math.round(ms), falseStart: false };
}

/* ------------------------------------------------------------------ */
/* Bot                                                                */
/* ------------------------------------------------------------------ */

/** Standard normal sample (Box–Muller) from an injectable uniform RNG. */
export function gaussian(rand: () => number, mean = 0, deviation = 1): number {
  let u = 0;
  // Guard against log(0); a stubbed RNG may hand back exact zeros.
  for (let i = 0; i < 8 && u <= Number.EPSILON; i++) u = rand();
  if (u <= Number.EPSILON) u = 0.5;
  const v = rand();
  return mean + deviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface BotReaction extends RoundResult {
  /** For a false start: how far into STEADY the bot twitched (ms). */
  falseStartAt: number | null;
}

/**
 * One round of the practice bot. Reaction = clamp(normal(275, 55), 170, 520)
 * with a 7% false-start chance. `rand` is injectable (tests pass a seeded or
 * scripted RNG; the app uses `Math.random` so the bot can't be learned from
 * the shared match seed).
 */
export function sampleBotReaction(rand: () => number, steadyMs: number): BotReaction {
  if (rand() < BOT.falseStartChance) {
    // Twitch somewhere in the middle of STEADY, never at the very edges.
    const at = Math.round(steadyMs * (0.3 + 0.6 * rand()));
    return { ms: null, falseStart: true, falseStartAt: at };
  }
  const raw = gaussian(rand, BOT.meanMs, BOT.deviationMs);
  const ms = Math.round(Math.min(BOT.maxMs, Math.max(BOT.minMs, raw)));
  return { ms, falseStart: false, falseStartAt: null };
}

/* ------------------------------------------------------------------ */
/* Presentation helpers (pure, so they're tested too)                 */
/* ------------------------------------------------------------------ */

export interface Verdict {
  headline: string;
  detail: string;
  tone: "win" | "lose" | "even";
}

export function describeOutcome(outcome: RoundOutcome, oppName: string): Verdict {
  const { winner, reason, marginMs } = outcome;
  const tone = winner === "me" ? "win" : winner === "opp" ? "lose" : "even";
  const headline = winner === "me" ? "Round to you" : winner === "opp" ? `${oppName} takes it` : "No point";
  switch (reason) {
    case "faster":
      return { headline, detail: winner === "me" ? `${marginMs} ms faster` : `${marginMs} ms slower`, tone };
    case "tie":
      return { headline: "Dead heat", detail: `Both drew in ${outcome.me.ms} ms`, tone };
    case "false-start":
      return { headline, detail: winner === "me" ? `${oppName} jumped the gun` : "You jumped the gun", tone };
    case "no-draw":
      return { headline, detail: winner === "me" ? `${oppName} never drew` : "You never drew", tone };
    case "both-false-start":
      return { headline, detail: "You both jumped the gun", tone };
    case "both-no-draw":
      return { headline, detail: "Nobody drew", tone };
  }
}

/** Short label for one result: "231 ms", "Too early", "Missed". */
export function resultLabel(result: RoundResult): string {
  const kind = classify(result);
  if (kind === "false-start") return "Too early";
  if (kind === "miss") return "Missed";
  return `${result.ms} ms`;
}

/** `data` for `xapps.submit` — a compact, JSON-safe record of the duel. */
export function submissionData(outcomes: readonly RoundOutcome[]): { rounds: Json[]; bestMs: number | null } {
  return {
    rounds: outcomes.map((o) => ({
      round: o.round,
      me: { ms: o.me.ms, falseStart: o.me.falseStart },
      opp: { ms: o.opp.ms, falseStart: o.opp.falseStart },
      winner: o.winner,
    })),
    bestMs: bestMs(outcomes.map((o) => o.me)),
  };
}

/* ------------------------------------------------------------------ */
/* Progress: stats & achievements (the local player's side)           */
/* ------------------------------------------------------------------ */

/** Achievement ids (declared in the app's manifest). */
export type ReflexesAchievement =
  | "duel_won"
  | "under_200"
  | "under_150"
  | "flawless"
  | "comeback"
  | "photo_finish"
  | "metronome"
  | "twitchy";

export const PROGRESS = {
  /** "Under 200 ms" / "Superhuman": a clean tap strictly below these. */
  fastMs: 200,
  superhumanMs: 150,
  /** "Photo finish": a round won by at most this margin. */
  photoFinishMs: 5,
  /** "Metronome": at least this many clean taps… */
  metronomeTaps: 3,
  /** …all within this spread (fastest to slowest). */
  metronomeSpreadMs: 30,
  /** "Twitchy": this many false starts in one duel. */
  twitchyFalseStarts: 3,
} as const;

/**
 * Achievements the rounds so far have earned (from our seat). Round-level
 * ones (fast taps, photo finish, twitchy) show up as soon as the round that
 * earns them is revealed; duel-level ones (win, 3–0, comeback, metronome) only
 * once `final` is set.
 */
export function earnedAchievements(outcomes: readonly RoundOutcome[], final: boolean): ReflexesAchievement[] {
  const earned: ReflexesAchievement[] = [];
  const taps = outcomes.map((o) => o.me.ms).filter((ms): ms is number => ms !== null);
  if (taps.some((ms) => ms < PROGRESS.fastMs)) earned.push("under_200");
  if (taps.some((ms) => ms < PROGRESS.superhumanMs)) earned.push("under_150");
  if (outcomes.some((o) => o.winner === "me" && o.reason === "faster" && (o.marginMs ?? Infinity) <= PROGRESS.photoFinishMs)) {
    earned.push("photo_finish");
  }
  if (outcomes.filter((o) => o.me.falseStart).length >= PROGRESS.twitchyFalseStarts) earned.push("twitchy");
  if (!final) return earned;

  const score = tally(outcomes);
  const won = matchWinner(score) === "me";
  if (won) earned.push("duel_won");
  if (won && score.opp === 0) earned.push("flawless");
  if (won && trailedBy(outcomes, 2)) earned.push("comeback");
  const clean = outcomes.every((o) => classify(o.me) === "tap");
  if (clean && taps.length >= PROGRESS.metronomeTaps && Math.max(...taps) - Math.min(...taps) <= PROGRESS.metronomeSpreadMs) {
    earned.push("metronome");
  }
  return earned;
}

/** Whether we were ever `rounds` behind during the duel. */
function trailedBy(outcomes: readonly RoundOutcome[], rounds: number): boolean {
  const score: Score = { me: 0, opp: 0 };
  for (const o of outcomes) {
    if (o.winner === "me") score.me++;
    else if (o.winner === "opp") score.opp++;
    if (score.opp - score.me >= rounds) return true;
  }
  return false;
}

/** Stats to report when a duel ends (zero counters are left out). */
export function duelStats(outcomes: readonly RoundOutcome[]): { [key: string]: number } {
  const score = tally(outcomes);
  const won = matchWinner(score) === "me";
  const stats: { [key: string]: number } = {};
  const best = bestMs(outcomes.map((o) => o.me));
  if (best !== null) stats.best_reaction = best;
  if (score.me > 0) stats.rounds_won = score.me;
  if (won) stats.duels_won = 1;
  if (won && score.opp === 0) stats.perfect_duels = 1;
  return stats;
}
