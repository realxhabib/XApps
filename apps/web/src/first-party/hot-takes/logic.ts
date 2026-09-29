/**
 * Hot Takes — pure game logic. No React, no SDK side effects: everything the
 * UI needs to decide (sides, prompt, validation, bot behaviour, timers) lives
 * here so it can be unit-tested and so both clients provably agree.
 */
import type { Json, MatchMode, MatchResult } from "@xapps/sdk";
import {
  HOT_TAKE_PROMPTS,
  SPARK_OPENERS,
  getPrompt,
  type HotTakeEntry,
  type HotTakePrompt,
  type Side,
  type Spice,
} from "./prompts";

/* ------------------------------------------------------------------ */
/* Match setup                                                        */
/* ------------------------------------------------------------------ */

/** The slice of the SDK's seeded `Random` that setup needs. */
export interface SeededRandom {
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  fork(label: string): SeededRandom;
}

export interface MatchSetup {
  prompt: HotTakePrompt;
  /** Index 0 = seat 0's side, index 1 = seat 1's side. Always opposite. */
  sides: readonly [Side, Side];
}

export function opposite(side: Side): Side {
  return side === "for" ? "against" : "for";
}

/**
 * Seat 0 flips a (seeded) coin, seat 1 takes the other side, so the two
 * players always argue opposite sides — against humans and bots alike.
 */
export function assignSides(rng: Pick<SeededRandom, "chance">): readonly [Side, Side] {
  const first: Side = rng.chance(0.5) ? "for" : "against";
  return [first, opposite(first)];
}

/**
 * Prompt + sides for a match. Uses forks of the match random so the result is
 * identical on every client *and* independent of how many times React happens
 * to call this (StrictMode double renders, remounts…). A valid
 * `settings.promptId` (demo data, curated challenges) wins over the dice.
 */
export function setupMatch(rng: SeededRandom, settings: { [key: string]: Json } = {}): MatchSetup {
  const requested = typeof settings.promptId === "string" ? settings.promptId : null;
  const known = requested ? HOT_TAKE_PROMPTS.find((p) => p.id === requested) : undefined;
  const prompt = known ?? rng.fork("hot-takes:prompt").pick(HOT_TAKE_PROMPTS);
  const sides = assignSides(rng.fork("hot-takes:sides"));
  return { prompt, sides };
}

/**
 * Side for a player. Players are ranked by seat (not by raw seat number) so
 * a match with seats 1 and 2 still maps onto [first, second].
 */
export function sideForPlayer(
  sides: readonly [Side, Side],
  players: readonly { id: string; seat: number }[],
  playerId: string,
): Side {
  const ranked = players.slice().sort((a, b) => a.seat - b.seat);
  const index = ranked.findIndex((p) => p.id === playerId);
  return index <= 0 ? sides[0] : sides[1];
}

/* ------------------------------------------------------------------ */
/* Text: graphemes, counting, validation                              */
/* ------------------------------------------------------------------ */

export const TAKE_LIMIT = 280;
/** The counter turns amber when this many characters (or fewer) remain. */
export const WARN_REMAINING = 20;
/** Past this many over the limit the X counter drops its ring, showing only the number. */
const RING_HIDES_AFTER_OVER = 10;

let segmenter: Intl.Segmenter | null | undefined;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter === undefined) {
    segmenter =
      typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;
  }
  return segmenter;
}

/**
 * User-perceived characters. "👩‍👩‍👧" or "🇺🇸" count as one, like people
 * expect. Falls back to code points (`Array.from`) without Intl.Segmenter.
 */
export function graphemes(text: string): string[] {
  const seg = getSegmenter();
  if (seg) return Array.from(seg.segment(text), (s) => s.segment);
  return Array.from(text);
}

export function countChars(text: string): number {
  return graphemes(text).length;
}

export type CounterTone = "idle" | "ok" | "warn" | "over";

export interface CounterState {
  count: number;
  remaining: number;
  /** 0..1 fill of the ring. */
  progress: number;
  tone: CounterTone;
  /** X shows the remaining number only near / past the limit. */
  showNumber: boolean;
  showRing: boolean;
}

export function counterState(count: number, limit = TAKE_LIMIT): CounterState {
  const remaining = limit - count;
  const tone: CounterTone =
    count === 0 ? "idle" : remaining < 0 ? "over" : remaining <= WARN_REMAINING ? "warn" : "ok";
  return {
    count,
    remaining,
    progress: Math.max(0, Math.min(1, count / limit)),
    tone,
    showNumber: remaining <= WARN_REMAINING,
    showRing: remaining >= -RING_HIDES_AFTER_OVER,
  };
}

/** Tidies whitespace without touching the words: trims, drops trailing spaces, caps blank lines. */
export function normalizeTake(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type TakeValidation =
  | { ok: true; take: string; count: number }
  | { ok: false; reason: "empty" | "too-long"; count: number };

export function validateTake(raw: string, limit = TAKE_LIMIT): TakeValidation {
  const take = normalizeTake(raw);
  const count = countChars(take);
  if (count === 0) return { ok: false, reason: "empty", count };
  if (count > limit) return { ok: false, reason: "too-long", count };
  return { ok: true, take, count };
}

/** Grapheme-safe cut to `limit` (used when the live clock forces a submit). */
export function truncateTake(text: string, limit = TAKE_LIMIT): string {
  const parts = graphemes(text);
  if (parts.length <= limit) return text;
  return parts.slice(0, limit).join("").trimEnd();
}

/* ------------------------------------------------------------------ */
/* "Need a spark?"                                                    */
/* ------------------------------------------------------------------ */

/** The known opener `text` starts with, if any. */
export function leadingOpener(text: string, openers: readonly string[] = SPARK_OPENERS): string | null {
  const trimmed = text.trimStart();
  return openers.find((o) => trimmed.startsWith(o)) ?? null;
}

/** A random opener that differs from the one the text already starts with. */
export function pickSpark(
  current: string,
  rand: () => number = Math.random,
  openers: readonly string[] = SPARK_OPENERS,
): string {
  const existing = leadingOpener(current, openers);
  const pool = openers.filter((o) => o !== existing);
  const list = pool.length ? pool : openers;
  return list[Math.floor(rand() * list.length) % list.length] as string;
}

/**
 * Puts `opener` at the start of the take. Pressing the button again swaps
 * the opener instead of stacking "Hear me out: Respectfully, …".
 * Returns the new text and where the caret should go.
 */
export function applySpark(
  text: string,
  opener: string,
  openers: readonly string[] = SPARK_OPENERS,
): { text: string; caret: number } {
  const existing = leadingOpener(text, openers);
  const rest = (existing ? text.trimStart().slice(existing.length) : text).trimStart();
  const next = rest ? `${opener} ${rest}` : `${opener} `;
  return { text: next, caret: next.length };
}

/* ------------------------------------------------------------------ */
/* Entries                                                            */
/* ------------------------------------------------------------------ */

export function isSpice(value: unknown): value is Spice {
  return value === 1 || value === 2 || value === 3;
}

export function buildEntry(promptId: string, side: Side, take: string, spice: Spice): HotTakeEntry {
  return { promptId, side, take, spice };
}

/** `HotTakeEntry` as a plain JSON object for `submit({ data })`. */
export function entryToJson(entry: HotTakeEntry): { [key: string]: Json } {
  return { promptId: entry.promptId, side: entry.side, take: entry.take, spice: entry.spice };
}

/* ------------------------------------------------------------------ */
/* Bot                                                                */
/* ------------------------------------------------------------------ */

/** Random line from the prompt's bank for `side`. `rand` is injectable for tests. */
export function pickBotTake(prompt: HotTakePrompt, side: Side, rand: () => number = Math.random): string {
  const bank = prompt[side].length ? prompt[side] : getPrompt(prompt.id)[side];
  if (!bank.length) return "No notes. The prompt speaks for itself.";
  return bank[Math.floor(rand() * bank.length) % bank.length] as string;
}

export function pickBotSpice(rand: () => number = Math.random): Spice {
  const n = 1 + (Math.floor(rand() * 3) % 3);
  return n as Spice;
}

export function botEntry(prompt: HotTakePrompt, side: Side, rand: () => number = Math.random): HotTakeEntry {
  return buildEntry(prompt.id, side, pickBotTake(prompt, side, rand), pickBotSpice(rand));
}

/** The bot locks in at a random 20–50 s mark (measured from the start of writing)… */
export const BOT_MARK_MS: readonly [number, number] = [20_000, 50_000];
/** …or this soon after the human submits, whichever comes first. */
export const BOT_AFTER_HUMAN_MS: readonly [number, number] = [1_800, 3_800];

export function randomBetween(range: readonly [number, number], rand: () => number = Math.random): number {
  return Math.round(range[0] + rand() * (range[1] - range[0]));
}

/**
 * When the bot should submit, in ms since writing started. `humanAt` is when
 * the human submitted (same clock) or null while they're still writing.
 */
export function botDueAt(markMs: number, humanAt: number | null, afterHumanMs: number): number {
  if (humanAt === null) return markMs;
  return Math.min(markMs, humanAt + afterHumanMs);
}

/**
 * Whether the practice bot should look like it's typing at `elapsedMs`.
 * It "thinks" for a moment, then types in bursts with short pauses — purely
 * cosmetic, but it makes practice feel like a real opponent.
 */
export function botTypingAt(elapsedMs: number, dueMs: number, phaseMs = 0): boolean {
  if (elapsedMs < 2_500 || elapsedMs >= dueMs) return false;
  const cycle = (elapsedMs + phaseMs) % 7_000;
  return cycle < 5_000;
}

/* ------------------------------------------------------------------ */
/* Realtime                                                           */
/* ------------------------------------------------------------------ */

export const ROOM_TYPING = "typing";
export const ROOM_SUBMITTED = "submitted";
/** Send at most one typing ping per interval. */
export const TYPING_SEND_INTERVAL_MS = 1_200;
/** Hide "is typing…" when no ping arrived for this long. */
export const TYPING_VISIBLE_MS = 3_000;

/** Leading-edge throttle on an injected clock: returns true when a send is allowed. */
export function createThrottle(intervalMs: number): (now: number) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return (now) => {
    if (now - last < intervalMs) return false;
    last = now;
    return true;
  };
}

/* ------------------------------------------------------------------ */
/* Clock                                                              */
/* ------------------------------------------------------------------ */

export interface TimerRule {
  durationMs: number;
  /** Hard timers auto-submit at zero (live); soft ones just nag. */
  hard: boolean;
}

export function timerFor(mode: MatchMode): TimerRule {
  return mode === "live" ? { durationMs: 90_000, hard: true } : { durationMs: 180_000, hard: false };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** What to do when the clock hits zero. */
export function onClockExpired(rule: TimerRule, text: string): { kind: "submit"; take: string } | { kind: "wait" } {
  if (!rule.hard) return { kind: "wait" };
  const take = truncateTake(normalizeTake(text));
  return countChars(take) > 0 ? { kind: "submit", take } : { kind: "wait" };
}

/* ------------------------------------------------------------------ */
/* Reveal choreography                                                */
/* ------------------------------------------------------------------ */

export function promptWords(prompt: string): string[] {
  return prompt.split(/\s+/).filter(Boolean);
}

/** Milestones (ms after the reveal starts) for the prompt → side reveal. */
export function revealTimeline(wordCount: number, reduced = false) {
  const perWord = reduced ? 40 : 150;
  const typed = 450 + wordCount * perWord;
  const card = typed + (reduced ? 100 : 350);
  const flip = card + (reduced ? 200 : 850);
  const done = flip + (reduced ? 1_600 : 3_000);
  return { perWord, typed, card, flip, done };
}

/* ------------------------------------------------------------------ */
/* HUD & result                                                       */
/* ------------------------------------------------------------------ */

export type Phase = "pregame" | "reveal" | "compose" | "waiting" | "voting" | "result";

export function hudStatus(phase: Phase, side: Side, opponentHandle: string | undefined): string | null {
  switch (phase) {
    case "pregame":
      return null;
    case "reveal":
      return "Picking sides…";
    case "compose":
      return `Argue ${side === "for" ? "FOR" : "AGAINST"}`;
    case "waiting":
      return opponentHandle ? `Waiting for @${opponentHandle}` : "Waiting for your opponent";
    case "voting":
      return "Crowd is voting";
    case "result":
      return "The crowd has spoken";
  }
}

export type Outcome = "won" | "lost" | "draw";

export function outcomeFor(result: Pick<MatchResult, "winnerId">, meId: string): Outcome {
  if (result.winnerId === null) return "draw";
  return result.winnerId === meId ? "won" : "lost";
}

export function voteTally(
  result: Pick<MatchResult, "votes">,
  meId: string,
  opponentId: string | undefined,
): { mine: number; theirs: number } | null {
  if (!result.votes || !opponentId) return null;
  return { mine: result.votes[meId] ?? 0, theirs: result.votes[opponentId] ?? 0 };
}

export const REACTIONS: Record<Outcome, readonly { emoji: string; title: string; line: string }[]> = {
  won: [
    { emoji: "👑", title: "Crowned.", line: "The Arena bought every word." },
    { emoji: "🔥", title: "Too hot to handle.", line: "Your take set the room on fire." },
    { emoji: "🎤", title: "Mic drop.", line: "Nothing left to argue." },
  ],
  lost: [
    { emoji: "💀", title: "Ratioed.", line: "Bold take. The crowd wasn't ready." },
    { emoji: "🧯", title: "Extinguished.", line: "Cool off and come back spicier." },
    { emoji: "🫠", title: "Melted.", line: "They argued it better — this time." },
  ],
  draw: [
    { emoji: "🤝", title: "Split decision.", line: "The Arena couldn't pick a side." },
  ],
};

/** Deterministic pick so re-renders never reshuffle the reaction. */
export function reactionFor(outcome: Outcome, key: string) {
  const list = REACTIONS[outcome];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return list[h % list.length] as (typeof list)[number];
}

/* ------------------------------------------------------------------ */
/* Progress: stats & achievements                                     */
/* ------------------------------------------------------------------ */

/** Achievement ids (declared in the app's manifest). */
export type HotTakesAchievement =
  | "first_take"
  | "ghost_pepper"
  | "every_char"
  | "crowd_pleaser"
  | "too_hot"
  | "short_sweet"
  | "shutout"
  | "buzzer_beater";

export const PROGRESS = {
  /** "Short and sweet": a winning take this short (characters). */
  shortTake: 50,
  /** "Buzzer beater": locked in with this little left on the clock. */
  buzzerMs: 5_000,
} as const;

const MAX_SPICE: Spice = 3;

export interface LockIn {
  take: string;
  spice: Spice;
  /** Clock left when the player locked in (ms), or null if unknown. */
  remainingMs: number | null;
  /** The live clock ran out and submitted for them. */
  forced: boolean;
}

/** Achievements earned the moment a take is locked in. */
export function lockInAchievements(lockIn: LockIn): HotTakesAchievement[] {
  const earned: HotTakesAchievement[] = ["first_take"];
  if (lockIn.spice === MAX_SPICE) earned.push("ghost_pepper");
  if (countChars(lockIn.take) === TAKE_LIMIT) earned.push("every_char");
  const left = lockIn.remainingMs;
  if (!lockIn.forced && left !== null && left > 0 && left <= PROGRESS.buzzerMs) earned.push("buzzer_beater");
  return earned;
}

/** Stats for a locked-in take. */
export function lockInStats(): { [key: string]: number } {
  return { takes: 1 };
}

/**
 * Achievements and stats once the crowd has decided. `entry` is our take when
 * this session knows it (spice and length badges need it).
 */
export function resultProgress(
  result: Pick<MatchResult, "winnerId" | "votes">,
  meId: string,
  opponentId: string | undefined,
  entry: Pick<HotTakeEntry, "take" | "spice"> | null,
): { achievements: HotTakesAchievement[]; stats: { [key: string]: number } } {
  const tally = voteTally(result, meId, opponentId);
  const stats: { [key: string]: number } = {};
  if (tally && tally.mine > 0) stats.votes = tally.mine;
  if (outcomeFor(result, meId) !== "won") return { achievements: [], stats };
  stats.wins = 1;
  const achievements: HotTakesAchievement[] = ["crowd_pleaser"];
  if (entry?.spice === MAX_SPICE) achievements.push("too_hot");
  if (entry && countChars(normalizeTake(entry.take)) <= PROGRESS.shortTake) achievements.push("short_sweet");
  if (tally && tally.mine > 0 && tally.theirs === 0) achievements.push("shutout");
  return { achievements, stats };
}
