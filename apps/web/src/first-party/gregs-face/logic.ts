/**
 * Greg's Face — pure game rules. No React, no DOM, no SDK side effects:
 * everything is deterministic given its inputs, so every client (and the
 * tests) agree on positions, scores and bot runs.
 *
 * Rules in one breath: a feature slides left↔right across the blank face at
 * exactly the right height (ping-pong, speeding up). Tap to drop it. Only the
 * horizontal miss counts, so it's a pure timing game. Eyes, then nose, then
 * mouth; the face scores the average accuracy of the three (100 = dead on).
 *
 * Every player gets the same slides (start, direction, speed, acceleration),
 * forked from the match seed, so a match is fair across devices.
 */
import type { Json, MatchResult, PlayerInfo, Random } from "@xapps/sdk";
import { PART_ORDER, type FaceConfig, type PartId } from "./face";

/* ---------------------------------------------------------------------- */
/* Tuning                                                                 */
/* ---------------------------------------------------------------------- */

/** "Eyes!" beat before a feature starts moving (taps are ignored). */
export const PART_INTRO_MS = 700;
/** A feature still moving after this long drops wherever it is. */
export const PART_MAX_MS = 7_000;
/** How long a dropped feature's verdict shows before the next one. */
export const SETTLE_MS = 1_050;
/** The track spans the face centre ± this fraction of the image width. */
export const TRACK_HALF = 0.4;
/** Within this fraction of the image width a drop is pixel perfect (100%). */
export const PERFECT_WITHIN = 0.006;
/** A miss of this fraction of the image width (or more) scores 0%. */
export const ZERO_AT = 0.3;
/** Top speed, in sweeps per second (a sweep = one end of the track to the other). */
export const MAX_SPEED = 1.7;

/** Starting speed (sweeps/s) and acceleration (sweeps/s²) per feature; later ones are quicker. */
const BASE: Record<PartId, { v0: number; accel: number }> = {
  eyes: { v0: 0.55, accel: 0.12 },
  nose: { v0: 0.65, accel: 0.16 },
  mouth: { v0: 0.75, accel: 0.2 },
};

/* ---------------------------------------------------------------------- */
/* Slides                                                                 */
/* ---------------------------------------------------------------------- */

/** How one feature moves. `u` is the position on the track, 0 (left) to 1 (right). */
export interface Slide {
  start: number;
  dir: 1 | -1;
  /** Sweeps per second at t = 0. */
  v0: number;
  /** Sweeps per second². */
  accel: number;
  vmax: number;
}

export type Slides = Record<PartId, Slide>;

/**
 * The match's slides, from forks of the shared seed only: identical on every
 * client and on every call (safe in a React initializer).
 */
export function buildSlides(random: Random): Slides {
  const out = {} as Slides;
  for (const id of PART_ORDER) {
    const r = random.fork(`slide:${id}`);
    const left = r.chance(0.5);
    const start = left ? r.float(0, 0.12) : r.float(0.88, 1);
    out[id] = {
      start,
      dir: left ? 1 : -1,
      v0: BASE[id].v0 * r.float(0.9, 1.15),
      accel: BASE[id].accel * r.float(0.85, 1.2),
      vmax: MAX_SPEED,
    };
  }
  return out;
}

/** Sweeps travelled `tMs` after the feature started moving. */
export function distance(slide: Slide, tMs: number): number {
  const t = Math.max(0, tMs) / 1000;
  if (slide.accel <= 0) return Math.min(slide.v0, slide.vmax) * t;
  const tCap = Math.max(0, (slide.vmax - slide.v0) / slide.accel);
  if (t <= tCap) return slide.v0 * t + 0.5 * slide.accel * t * t;
  return slide.v0 * tCap + 0.5 * slide.accel * tCap * tCap + slide.vmax * (t - tCap);
}

/** Speed in sweeps per second at `tMs`. */
export function speedAt(slide: Slide, tMs: number): number {
  return Math.min(slide.vmax, slide.v0 + slide.accel * (Math.max(0, tMs) / 1000));
}

/** Track position (0–1) at `tMs`: ping-pongs between the ends. */
export function slideU(slide: Slide, tMs: number): number {
  const s = slide.start + slide.dir * distance(slide, tMs);
  const w = ((s % 2) + 2) % 2;
  return w <= 1 ? w : 2 - w;
}

/** Image x of the feature's centre at track position `u`. */
export function trackX(face: Pick<FaceConfig, "width">, u: number): number {
  return face.width / 2 + (2 * u - 1) * TRACK_HALF * face.width;
}

/** Where the feature really belongs, as an image x (its rect's centre). */
export function trueX(face: FaceConfig, part: PartId): number {
  const r = face.parts[part];
  return r.x + r.w / 2;
}

/** The track position where the feature belongs (may fall outside 0–1 for an off-centre face). */
export function trueU(face: FaceConfig, part: PartId): number {
  return ((trueX(face, part) - face.width / 2) / (TRACK_HALF * face.width) + 1) / 2;
}

/* ---------------------------------------------------------------------- */
/* Scoring                                                                */
/* ---------------------------------------------------------------------- */

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Accuracy (0–100, one decimal) for a horizontal miss of `err` × image width.
 * Within PERFECT_WITHIN it's a clean 100; beyond that it falls linearly to 0
 * at ZERO_AT.
 */
export function partAccuracy(err: number): number {
  const e = Math.abs(err);
  if (!Number.isFinite(e)) return 0;
  if (e <= PERFECT_WITHIN) return 100;
  return Math.min(99.9, Math.max(0, round1(100 * (1 - e / ZERO_AT))));
}

export interface Drop {
  part: PartId;
  /** Ms after the feature started moving (clamped to 0–PART_MAX_MS). */
  atMs: number;
  /** Where it landed: track position and image x of its centre. */
  u: number;
  x: number;
  /** Horizontal miss as a fraction of the image width. */
  err: number;
  accuracy: number;
  perfect: boolean;
  /** Dropped by the clock, not the player. */
  auto: boolean;
}

/** Drops `part` at `tMs` into its slide. */
export function dropAt(face: FaceConfig, slides: Slides, part: PartId, tMs: number, auto = false): Drop {
  const atMs = Math.round(Math.max(0, Math.min(PART_MAX_MS, tMs)));
  const u = slideU(slides[part], atMs);
  const x = trackX(face, u);
  const err = Math.abs(x - trueX(face, part)) / face.width;
  const accuracy = partAccuracy(err);
  return { part, atMs, u, x, err, accuracy, perfect: err <= PERFECT_WITHIN, auto };
}

/** The face's score: average accuracy over all three features (a missing one counts 0). */
export function faceScore(drops: readonly Pick<Drop, "accuracy">[]): number {
  const sum = drops.slice(0, PART_ORDER.length).reduce((s, d) => s + d.accuracy, 0);
  return round1(sum / PART_ORDER.length);
}

/** Average of the features dropped so far (for the live HUD). */
export function runningScore(drops: readonly Pick<Drop, "accuracy">[]): number {
  if (drops.length === 0) return 0;
  return round1(drops.reduce((s, d) => s + d.accuracy, 0) / drops.length);
}

/** Shown on the reveal and the share card. */
export function verdict(score: number): { title: string; emoji: string } {
  if (score >= 97) return { title: "That's Greg!", emoji: "🤩" };
  if (score >= 90) return { title: "Spitting image", emoji: "😎" };
  if (score >= 78) return { title: "Close cousin", emoji: "🙂" };
  if (score >= 62) return { title: "Greg's weird uncle", emoji: "🤨" };
  if (score >= 40) return { title: "Who is this?", emoji: "😵‍💫" };
  return { title: "Picasso's Greg", emoji: "🎨" };
}

const PART_EMOJI: Record<PartId, string> = { eyes: "👀", nose: "👃", mouth: "👄" };

export function formatPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** What goes into `xapps.submit`. */
export function submission(drops: readonly Drop[]): {
  score: number;
  data: Json;
  display: { kind: "text"; title: string; body: string };
} {
  const score = faceScore(drops);
  return {
    score,
    data: {
      parts: drops.map((d) => ({ part: d.part, accuracy: d.accuracy, x: round1(d.x), ms: d.atMs, auto: d.auto })),
    },
    display: {
      kind: "text",
      title: `${formatPct(score)} Greg · ${verdict(score).title}`,
      body: drops.map((d) => `${PART_EMOJI[d.part]} ${formatPct(d.accuracy)}`).join("  "),
    },
  };
}

/** Share text for X. */
export function shareText(score: number, name = "Greg"): string {
  return `I built ${name}'s face ${formatPct(Math.round(score))} right on XApps ${score >= 90 ? "😎" : "🤪"}`;
}

/* ---------------------------------------------------------------------- */
/* Live progress (room events)                                            */
/* ---------------------------------------------------------------------- */

/** Room event after every drop: `room.send("drop", { part, accuracy })`. */
export const DROP_EVENT = "drop";

export type DropPayload = { part: PartId; accuracy: number };

/** Validates an untrusted room payload. */
export function parseDrop(payload: unknown): DropPayload | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { part, accuracy } = payload as Record<string, unknown>;
  if (typeof part !== "string" || !PART_ORDER.includes(part as PartId)) return null;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return null;
  return { part: part as PartId, accuracy: round1(accuracy) };
}

/* ---------------------------------------------------------------------- */
/* Bots                                                                   */
/* ---------------------------------------------------------------------- */

export interface BotRun {
  drops: Drop[];
  /** When each drop lands, in ms since the match started (intros and verdicts included). */
  times: number[];
  /** When the bot is done (its last verdict has shown). */
  finishMs: number;
}

/** First time ≥ `fromMs` the feature passes its true position (or `fromMs` if it never does). */
export function nextCrossing(face: FaceConfig, slides: Slides, part: PartId, fromMs: number): number {
  const target = trueU(face, part);
  const slide = slides[part];
  let prev = slideU(slide, fromMs) - target;
  for (let t = Math.ceil(fromMs) + 1; t <= PART_MAX_MS; t++) {
    const cur = slideU(slide, t) - target;
    if (cur === 0 || Math.sign(cur) !== Math.sign(prev)) return t;
    prev = cur;
  }
  return fromMs;
}

/**
 * Who should play the bots at this table: the lowest-seated human. Every
 * bot's run is forked from the match seed, so whoever plays it computes the
 * same drops; this just keeps a table of humans from submitting twice.
 */
export function botPilotId(players: readonly Pick<PlayerInfo, "id" | "seat" | "isBot">[]): string | null {
  const humans = players.filter((p) => !p.isBot);
  if (humans.length === 0) return null;
  return humans.reduce((a, b) => (b.seat < a.seat ? b : a)).id;
}

/**
 * A bot's whole run. Like a person it watches for a while, then aims for the
 * next pass over the right spot and taps with a human timing error (a few
 * dozen ms, now and then a proper whiff). `random` should be a per-bot fork
 * of the match seed (`xapps.random.fork("bot:" + id)`) so any client that
 * plays the bot computes the same run.
 */
export function planBot(face: FaceConfig, slides: Slides, random: Random): BotRun {
  const sigmaMs = random.float(30, 95);
  const drops: Drop[] = [];
  const times: number[] = [];
  let clock = 0;
  for (const part of PART_ORDER) {
    const watch = random.float(700, 2_600);
    const aim = nextCrossing(face, slides, part, watch);
    const whiff = random.chance(0.07) ? 4 : 1;
    const errMs = random.normal(0, sigmaMs) * whiff;
    const drop = dropAt(face, slides, part, aim + errMs);
    drops.push(drop);
    clock += PART_INTRO_MS + drop.atMs;
    times.push(Math.round(clock));
    clock += SETTLE_MS;
  }
  return { drops, times, finishMs: Math.round(clock) };
}

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements                                         */
/* ---------------------------------------------------------------------- */

/** Achievement ids (declared in the app's manifest). */
export type FaceAchievement =
  | "first_face"
  | "first_win"
  | "spitting_image"
  | "pixel_perfect"
  | "steady_hands"
  | "real_greg"
  | "hat_trick"
  | "head_of_table"
  | "show_and_tell"
  | "picasso";

export const PROGRESS = {
  /** "Spitting image": a face at least this accurate. */
  spitting: 90,
  /** "The real Greg": near-flawless. */
  real: 97,
  /** "Steady hands": every feature at least this accurate. */
  steady: 85,
  /** "Picasso" (secret): a face under this. */
  picasso: 40,
  /** "Head of the table": win at a table this big. */
  table: 4,
} as const;

/**
 * Achievements the run so far has earned. "Pixel perfect" unlocks the moment
 * a perfect drop lands; whole-face ones once all three features are down.
 */
export function earnedAchievements(drops: readonly Drop[]): FaceAchievement[] {
  const earned: FaceAchievement[] = [];
  if (drops.some((d) => d.perfect)) earned.push("pixel_perfect");
  if (drops.length < PART_ORDER.length) return earned;
  const score = faceScore(drops);
  earned.push("first_face");
  if (score >= PROGRESS.spitting) earned.push("spitting_image");
  if (score >= PROGRESS.real) earned.push("real_greg");
  if (drops.every((d) => d.accuracy >= PROGRESS.steady)) earned.push("steady_hands");
  if (drops.every((d) => d.perfect)) earned.push("hat_trick");
  if (score < PROGRESS.picasso) earned.push("picasso");
  return earned;
}

/** Stats to report once the face is done (zero counters are left out). */
export function runStats(drops: readonly Drop[]): { [key: string]: number } {
  const stats: { [key: string]: number } = { best_face: faceScore(drops), faces_built: 1 };
  const perfect = drops.filter((d) => d.perfect).length;
  if (perfect > 0) stats.perfect_parts = perfect;
  return stats;
}

/** Achievements and stats from the settled match: a win, and at how big a table. */
export function resultProgress(
  result: Pick<MatchResult, "winnerId" | "scores">,
  me: string,
): { achievements: FaceAchievement[]; stats: { [key: string]: number } } {
  if (result.winnerId !== me) return { achievements: [], stats: {} };
  const achievements: FaceAchievement[] = ["first_win"];
  if (Object.keys(result.scores).length >= PROGRESS.table) achievements.push("head_of_table");
  return { achievements, stats: { wins: 1 } };
}
