/**
 * Greg's Face — pure game rules. No React, no DOM, no SDK side effects:
 * everything is deterministic given its inputs, so the tests (and replays of
 * a run) agree on positions and scores.
 *
 * Rules in one breath: a feature slides left↔right across the blank face at
 * exactly the right height (ping-pong, speeding up). Tap to drop it. Only the
 * horizontal miss counts, so it's a pure timing game. Eyes, then nose, then
 * mouth; the face scores the average accuracy of the three (100 = dead on).
 *
 * It's a solo game: build the face as often as you like and see where your
 * best face ranks worldwide. Every run gets fresh slides (start, direction,
 * speed, acceleration) from its own fork of the app's random.
 */
import type { Random } from "@xapps/sdk";
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
 * One run's slides, from forks of `random` only: the same on every call with
 * the same random (safe in a React initializer). Fork per run for fresh ones.
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

/** Average of the features dropped so far. */
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

export function formatPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** Share text for X. */
export function shareText(score: number, name = "Greg"): string {
  return `I built ${name}'s face ${formatPct(Math.round(score))} right on XApps ${score >= 90 ? "😎" : "🤪"}`;
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

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements                                         */
/* ---------------------------------------------------------------------- */

/** Achievement ids (declared in the app's manifest). */
export type FaceAchievement =
  | "first_face"
  | "spitting_image"
  | "pixel_perfect"
  | "steady_hands"
  | "real_greg"
  | "hat_trick"
  | "face_factory"
  | "on_a_roll"
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
  /** "Face factory": this many faces built, all time. */
  factory: 10,
  /** "On a roll": this many faces in a row at `spitting` or better. */
  roll: 3,
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

/** Faces in a row at "spitting image" or better, after a face scoring `score`. */
export function nextStreak(streak: number, score: number): number {
  return score >= PROGRESS.spitting ? streak + 1 : 0;
}

/**
 * Achievements from your runs so far: `facesBuilt` all time (the aggregated
 * stat) and the current streak of 90 %+ faces.
 */
export function soloAchievements({ facesBuilt, streak }: { facesBuilt: number; streak: number }): FaceAchievement[] {
  const earned: FaceAchievement[] = [];
  if (facesBuilt >= PROGRESS.factory) earned.push("face_factory");
  if (streak >= PROGRESS.roll) earned.push("on_a_roll");
  return earned;
}

/** Stats to report once the face is done (zero counters are left out). */
export function runStats(drops: readonly Drop[]): { [key: string]: number } {
  const stats: { [key: string]: number } = { best_face: faceScore(drops), faces_built: 1 };
  const perfect = drops.filter((d) => d.perfect).length;
  if (perfect > 0) stats.perfect_parts = perfect;
  return stats;
}
