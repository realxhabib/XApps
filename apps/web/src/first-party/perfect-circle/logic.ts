/**
 * Perfect Circle — pure game rules.
 *
 * No React, no timers, no SDK side effects: a stroke in, a verdict out, the
 * same on every device. Strokes live in "board units": the drawing board is
 * BOARD × BOARD with the dot at its center, whatever its size on screen.
 *
 * How a stroke is scored (see `analyzeStroke`):
 *
 * 1. Trim. Drawing stops the moment the stroke has swept a full 360° around
 *    the dot (the UI finishes the attempt right there), so overdrawing never
 *    helps or hurts: the stroke is cut at exactly one turn.
 * 2. Reject. Too small (mean radius < MIN_RADIUS), too slow (> MAX_DRAW_MS
 *    from first touch to the full turn) or not a full circle (< MIN_SWEEP_DEG
 *    around the dot when the finger lifts). A rejected stroke is a free retry.
 * 3. Score, centered on the dot (the classic "draw a perfect circle" rule: a
 *    lovely circle drawn off to one side is not a circle *around the dot*):
 *
 *      R         = mean distance to the dot along the stroke (length-weighted,
 *                  so drawing speed and pointer sample rate don't matter)
 *      deviation = mean |r − R| / R                    (0 for a true circle)
 *      roundness = max(0, 1 − RADIAL_WEIGHT · deviation)
 *      coverage  = min(1, sweep / 360°)                (released a bit early)
 *      closure   = max(0, 1 − CLOSURE_WEIGHT · |r_end − r_start| / R)
 *
 *      accuracy  = floor₁(100 · roundness · coverage · closure)   → 0.0–100.0
 *
 *    floor₁ rounds down to one decimal, so only a mathematically true circle
 *    shows 100.0%. A 2% average wobble scores about 96%; 98.0% ("perfect")
 *    needs the stroke within 1% of the radius on average.
 */
import type { MatchResult, Random } from "@xapps/sdk";

/* ------------------------------------------------------------------ */
/* Tuning                                                             */
/* ------------------------------------------------------------------ */

/** The drawing board is BOARD × BOARD units with the dot at its center. */
export const BOARD = 1000;
export const CENTER = { x: BOARD / 2, y: BOARD / 2 } as const;
/** Scored circles per player (best one counts). Rejected strokes don't use one up. */
export const ATTEMPTS = 3;
/** Everyone's clock for all their attempts, from the host's GO. */
export const MATCH_MS = 60_000;
/** First touch → full turn. Slower than this is "Too slow". */
export const MAX_DRAW_MS = 8_000;
/** Mean radius below this is "Too small" (the board is 1000 wide). */
export const MIN_RADIUS = 110;
/** Lifting the finger before this much of a turn is "Draw a full circle". */
export const MIN_SWEEP_DEG = 340;
/** Each 1% of average radial wobble costs this many points. */
export const RADIAL_WEIGHT = 2;
/** Spiral penalty: a 10% radius mismatch where the ends meet costs 5%. */
export const CLOSURE_WEIGHT = 0.5;
/** A "perfect circle" (stat + achievement). Hard, but a steady hand gets there. */
export const PERFECT = 98;
/** Readout thresholds for the verdict + achievements. */
export const GREAT = 90;
export const SUPERB = 95;
/** Below this a scored circle is officially an egg. */
export const EGG = 50;
/** Photo finish: winning by this many points or fewer. */
export const PHOTO_FINISH = 0.5;

const TAU = Math.PI * 2;
const FULL_TURN = TAU;

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
  /** Milliseconds (any origin; only differences matter). */
  t: number;
}

const radiusOf = (p: { x: number; y: number }) => Math.hypot(p.x - CENTER.x, p.y - CENTER.y);
const angleOf = (p: { x: number; y: number }) => Math.atan2(p.y - CENTER.y, p.x - CENTER.x);

/** Angle change from `a` to `b` around the dot, in (−π, π]. */
function angleDelta(a: Point, b: Point): number {
  let d = angleOf(b) - angleOf(a);
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Signed angle swept around the dot, in radians (positive = clockwise on screen). */
export function sweepOf(points: readonly Point[]): number {
  let sweep = 0;
  for (let i = 1; i < points.length; i++) sweep += angleDelta(points[i - 1]!, points[i]!);
  return sweep;
}

/** The stroke cut at the point where it completes one full turn (unchanged when it never does). */
export function trimToTurn(points: readonly Point[]): Point[] {
  let sweep = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = angleDelta(a, b);
    const next = sweep + d;
    if (Math.abs(next) >= FULL_TURN) {
      const need = Math.sign(next) * FULL_TURN - sweep;
      const f = d === 0 ? 1 : Math.max(0, Math.min(1, need / d));
      const end = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: a.t + (b.t - a.t) * f };
      return [...points.slice(0, i), end];
    }
    sweep = next;
  }
  return points.slice();
}

/** True once the stroke has gone all the way round (the UI ends the attempt there). */
export function hasFullTurn(points: readonly Point[]): boolean {
  return Math.abs(sweepOf(points)) >= FULL_TURN;
}

export interface RadialStats {
  /** Mean distance to the dot, weighted by stroke length. */
  radius: number;
  /** Mean |r − radius| / radius, weighted the same way. */
  deviation: number;
  /** Stroke length in board units. */
  length: number;
}

/** Length-weighted radius and wobble, so neither speed nor sample rate changes the answer. */
export function radialStats(points: readonly Point[]): RadialStats {
  const segs: { r: number; len: number }[] = [];
  let length = 0;
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const r = radiusOf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    segs.push({ r, len });
    length += len;
    sum += r * len;
  }
  if (length === 0) return { radius: points[0] ? radiusOf(points[0]) : 0, deviation: 0, length: 0 };
  const radius = sum / length;
  if (radius === 0) return { radius, deviation: 0, length };
  let dev = 0;
  for (const s of segs) dev += Math.abs(s.r - radius) * s.len;
  return { radius, deviation: dev / (length * radius), length };
}

/** Rounds down to one decimal (tolerating float noise), so 100.0 means truly perfect. */
export function floor1(value: number): number {
  return Math.floor(value * 10 + 1e-6) / 10;
}

/** Roundness alone as a percentage: the live readout while drawing. */
export function roundness(deviation: number): number {
  return Math.max(0, 1 - RADIAL_WEIGHT * deviation);
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

export type Rejection = "small" | "slow" | "incomplete";

interface AnalysisBase {
  /** The stroke as scored (trimmed at one full turn). */
  stroke: Point[];
  radius: number;
  sweepDeg: number;
  durationMs: number;
}

export type Analysis =
  | (AnalysisBase & {
      ok: true;
      /** 0.0–100.0, one decimal. */
      accuracy: number;
      deviation: number;
      /** |r_end − r_start| / R where the ends meet. */
      gap: number;
    })
  | (AnalysisBase & { ok: false; reason: Rejection });

/** The whole verdict for one stroke. Deterministic; see the file header for the formula. */
export function analyzeStroke(points: readonly Point[]): Analysis {
  const stroke = trimToTurn(points);
  const first = stroke[0];
  const last = stroke[stroke.length - 1];
  const sweepDeg = (Math.abs(sweepOf(stroke)) * 180) / Math.PI;
  const durationMs = first && last ? Math.max(0, last.t - first.t) : 0;
  const stats = radialStats(stroke);
  const base = { stroke, radius: stats.radius, sweepDeg, durationMs };

  if (!first || !last || stats.length === 0 || stats.radius < MIN_RADIUS) return { ...base, ok: false, reason: "small" };
  if (durationMs > MAX_DRAW_MS) return { ...base, ok: false, reason: "slow" };
  if (sweepDeg < MIN_SWEEP_DEG) return { ...base, ok: false, reason: "incomplete" };

  const gap = Math.abs(radiusOf(last) - radiusOf(first)) / stats.radius;
  const coverage = Math.min(1, sweepDeg / 360);
  const closure = Math.max(0, 1 - CLOSURE_WEIGHT * Math.min(1, gap));
  const accuracy = floor1(100 * roundness(stats.deviation) * coverage * closure);
  return { ...base, ok: true, accuracy, deviation: stats.deviation, gap };
}

/** What the big readout shows mid-stroke: roundness so far (null until there's enough to judge). */
export function liveAccuracy(points: readonly Point[]): number | null {
  if (points.length < 3 || Math.abs(sweepOf(points)) < Math.PI / 6) return null;
  const stats = radialStats(points);
  if (stats.radius <= 0) return null;
  return floor1(100 * roundness(stats.deviation));
}

/** Relative wobble of one segment against radius `r` (for colouring the ink). */
export function segmentError(a: Point, b: Point, r: number): number {
  if (r <= 0) return 1;
  return Math.abs(radiusOf({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) - r) / r;
}

/** Red (≥ 12% off) → amber → green (spot on) for a segment's relative error. */
export function inkColor(error: number): string {
  const t = Math.max(0, Math.min(1, error / 0.12));
  const stops: [number, number, number][] = [
    [55, 227, 155], // green
    [255, 201, 61], // amber
    [255, 77, 94], // red
  ];
  const scaled = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  const mix = (k: 0 | 1 | 2) => Math.round(a[k] + (b[k] - a[k]) * f);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** Readout colour for an accuracy: green in the high 90s, amber around 88%, red below ~76%. */
export function accuracyColor(accuracy: number): string {
  return inkColor((Math.max(0, 100 - accuracy) / 100) * 0.5);
}

export const REJECTION_TEXT: Record<Rejection, { title: string; hint: string }> = {
  small: { title: "Too small", hint: "Go bigger: circle the dot with room to spare." },
  slow: { title: "Too slow", hint: `One smooth stroke, under ${MAX_DRAW_MS / 1000} seconds.` },
  incomplete: { title: "Draw a full circle", hint: "Keep going all the way round the dot." },
};

/** A word for the readout. */
export function verdictFor(accuracy: number): { word: string; emoji: string } {
  if (accuracy >= 100) return { word: "Impossible", emoji: "🤯" };
  if (accuracy >= PERFECT) return { word: "Perfect!", emoji: "⭕" };
  if (accuracy >= SUPERB) return { word: "Superb", emoji: "🎯" };
  if (accuracy >= GREAT) return { word: "Great", emoji: "✨" };
  if (accuracy >= 80) return { word: "Nice", emoji: "👌" };
  if (accuracy >= 65) return { word: "Wobbly", emoji: "〰️" };
  if (accuracy >= EGG) return { word: "Lumpy", emoji: "🥔" };
  return { word: "That's an egg", emoji: "🥚" };
}

/* ------------------------------------------------------------------ */
/* A player's run                                                     */
/* ------------------------------------------------------------------ */

export interface Run {
  /** Accuracy of each scored circle, in order (at most ATTEMPTS). */
  scores: number[];
  /** Rejected strokes (free retries). */
  misses: number;
  /** Index into `scores` of the best circle (first one wins ties), or -1. */
  bestIndex: number;
  /** The best circle's stroke, for the final screen, the entry and the share card. */
  bestStroke: Point[] | null;
}

export const EMPTY_RUN: Run = { scores: [], misses: 0, bestIndex: -1, bestStroke: null };

export function bestScore(run: Run): number | null {
  return run.bestIndex >= 0 ? (run.scores[run.bestIndex] ?? null) : null;
}

export function attemptsLeft(run: Run): number {
  return Math.max(0, ATTEMPTS - run.scores.length);
}

/** Folds one analysed stroke into the run. A full run ignores further strokes. */
export function recordStroke(run: Run, analysis: Analysis): Run {
  if (run.scores.length >= ATTEMPTS) return run;
  if (!analysis.ok) return { ...run, misses: run.misses + 1 };
  const scores = [...run.scores, analysis.accuracy];
  const best = bestScore(run);
  const improved = best === null || analysis.accuracy > best;
  return {
    scores,
    misses: run.misses,
    bestIndex: improved ? scores.length - 1 : run.bestIndex,
    bestStroke: improved ? analysis.stroke : run.bestStroke,
  };
}

/* ------------------------------------------------------------------ */
/* Stats & achievements                                               */
/* ------------------------------------------------------------------ */

export type CircleAchievement =
  | "first_circle"
  | "well_rounded"
  | "steady_hand"
  | "perfect_circle"
  | "hat_trick"
  | "roundest"
  | "photo_finish"
  | "show_off"
  | "its_an_egg";

/** Earned from the run so far (the unlock helper sends each id once). */
export function earnedAchievements(run: Run): CircleAchievement[] {
  const out: CircleAchievement[] = [];
  const best = bestScore(run);
  if (run.scores.length > 0) out.push("first_circle");
  if (best !== null && best >= GREAT) out.push("well_rounded");
  if (best !== null && best >= SUPERB) out.push("steady_hand");
  if (best !== null && best >= PERFECT) out.push("perfect_circle");
  if (run.scores.length >= ATTEMPTS && run.scores.every((s) => s >= GREAT)) out.push("hat_trick");
  if (run.scores.some((s) => s < EGG)) out.push("its_an_egg");
  return out;
}

/** Stats for the manifest's leaderboards, reported once when the run is over. */
export function runStats(run: Run): { [key: string]: number } {
  const out: { [key: string]: number } = {};
  const best = bestScore(run);
  if (best !== null) out.best_circle = best;
  const perfect = run.scores.filter((s) => s >= PERFECT).length;
  if (perfect > 0) out.perfect_circles = perfect;
  if (run.scores.length > 0) out.circles_drawn = run.scores.length;
  return out;
}

/** A settled match: a win (and how close it was). */
export function resultProgress(
  result: Pick<MatchResult, "winnerId" | "scores">,
  me: string,
): { achievements: CircleAchievement[]; stats: { [key: string]: number } } {
  if (result.winnerId !== me) return { achievements: [], stats: {} };
  const mine = result.scores[me];
  const others = Object.entries(result.scores)
    .filter(([id, score]) => id !== me && typeof score === "number")
    .map(([, score]) => score as number);
  const achievements: CircleAchievement[] = ["roundest"];
  if (typeof mine === "number" && others.length > 0 && mine - Math.max(...others) <= PHOTO_FINISH + 1e-9) {
    achievements.push("photo_finish");
  }
  return { achievements, stats: { wins: 1 } };
}

/* ------------------------------------------------------------------ */
/* Synthetic circles (bots, tests)                                    */
/* ------------------------------------------------------------------ */

export interface Harmonic {
  /** Lobes: 2 squashes it into an oval, 3 a rounded triangle… */
  k: number;
  /** Relative amplitude (0.02 = ±2% of the radius). */
  amp: number;
  phase: number;
}

export interface SynthOptions {
  radius: number;
  /** Turns drawn (1 = exactly round; bots overshoot a little and get trimmed). */
  turns?: number;
  startDeg?: number;
  /** Counter-clockwise on screen. */
  ccw?: boolean;
  durationMs?: number;
  samples?: number;
  harmonics?: Harmonic[];
  /** Radius drift over one turn, relative (0.05 = ends 5% wider: a spiral). */
  drift?: number;
  /** Offset of the drawn circle's own center from the dot. */
  offset?: { x: number; y: number };
  /** Timestamp of the first point. */
  t0?: number;
}

/** A hand-drawn-looking circle, fully determined by its options. */
export function synthCircle(options: SynthOptions): Point[] {
  const {
    radius,
    turns = 1,
    startDeg = -90,
    ccw = false,
    durationMs = 1800,
    samples = 180,
    harmonics = [],
    drift = 0,
    offset = { x: 0, y: 0 },
    t0 = 0,
  } = options;
  const dir = ccw ? -1 : 1;
  const start = (startDeg * Math.PI) / 180;
  const n = Math.max(2, Math.round(samples * turns));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n; // 0 → 1 along the stroke
    const theta = u * turns * TAU;
    let r = 1 + drift * u * turns;
    for (const h of harmonics) r += h.amp * Math.sin(h.k * theta + h.phase);
    const a = start + dir * theta;
    out.push({
      x: CENTER.x + offset.x + Math.cos(a) * radius * r,
      y: CENTER.y + offset.y + Math.sin(a) * radius * r,
      t: t0 + u * durationMs,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bots                                                               */
/* ------------------------------------------------------------------ */

/** FNV-1a, for stable per-bot personalities. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * How shaky a bot's hand is, stable per bot id: 1.4 (a steady hand, circles
 * around 90–95%) to 3.4 (a sloppy one, high 70s–80s). Best of three, bots
 * land around 92% on average: beatable, but not by a lumpy circle.
 */
export function botShakiness(botId: string): number {
  return 1.4 + ((hash(`perfect-circle:${botId}`) % 1000) / 1000) * 2;
}

export interface BotAttempt {
  /** When the bot finishes this circle, from the start of the match. */
  atMs: number;
  /** How long the stroke takes (the UI replays it). */
  drawMs: number;
  stroke: Point[];
  accuracy: number;
}

/** Three circles for a bot, scored by the real rules. `random` should be a per-bot fork of the match seed. */
export function planBot(botId: string, random: Random): BotAttempt[] {
  const shaky = botShakiness(botId);
  const out: BotAttempt[] = [];
  let at = random.int(2_500, 5_000);
  for (let i = 0; i < ATTEMPTS; i++) {
    const s = shaky * random.float(0.7, 1.35);
    const drawMs = random.int(1_300, 2_600);
    const stroke = synthCircle({
      radius: random.float(230, 380),
      turns: 1.03,
      startDeg: random.float(-180, 180),
      ccw: random.chance(0.35),
      durationMs: drawMs,
      samples: 150,
      drift: random.normal(0, 0.03) * s,
      harmonics: [
        { k: 2, amp: Math.abs(random.normal(0.018, 0.008)) * s, phase: random.float(0, TAU) },
        { k: 3, amp: Math.abs(random.normal(0.008, 0.005)) * s, phase: random.float(0, TAU) },
        { k: 5, amp: Math.abs(random.normal(0.004, 0.003)) * s, phase: random.float(0, TAU) },
        { k: 11, amp: Math.abs(random.normal(0.002, 0.0015)) * s, phase: random.float(0, TAU) },
      ],
    });
    const analysis = analyzeStroke(stroke);
    const accuracy = analysis.ok ? analysis.accuracy : 0;
    at += drawMs;
    out.push({ atMs: at, drawMs, stroke: analysis.stroke, accuracy });
    at += random.int(4_000, 7_500);
  }
  return out;
}

export function bestOfBot(plan: readonly BotAttempt[]): BotAttempt | null {
  let best: BotAttempt | null = null;
  for (const a of plan) if (!best || a.accuracy > best.accuracy) best = a;
  return best;
}

/* ------------------------------------------------------------------ */
/* Wire format (live tables)                                          */
/* ------------------------------------------------------------------ */

export const ATTEMPT_EVENT = "circle";
/** Points sent per circle to the other players (about 400 bytes). */
export const WIRE_POINTS = 64;

export interface AttemptMessage {
  /** 1-based attempt number. */
  n: number;
  accuracy: number;
  /** Flattened [x0, y0, x1, y1, …] in whole board units. */
  pts: number[];
}

/** `n` points evenly spaced along the stroke (by length). */
export function resample(points: readonly Point[], n: number): Point[] {
  if (points.length === 0 || n < 2) return points.slice(0, Math.max(0, n));
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = cum[cum.length - 1]!;
  if (total === 0) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const out: Point[] = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / (n - 1);
    while (j < points.length - 1 && cum[j]! < target) j++;
    const a = points[j - 1]!;
    const b = points[j]!;
    const span = cum[j]! - cum[j - 1]!;
    const f = span === 0 ? 0 : Math.max(0, Math.min(1, (target - cum[j - 1]!) / span));
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, t: a.t + (b.t - a.t) * f });
  }
  return out;
}

export function toWire(n: number, accuracy: number, stroke: readonly Point[]): AttemptMessage {
  const pts: number[] = [];
  for (const p of resample(stroke, WIRE_POINTS)) pts.push(Math.round(p.x), Math.round(p.y));
  return { n, accuracy, pts };
}

/** Validates an attempt from another player. */
export function parseAttempt(payload: unknown): AttemptMessage | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const { n, accuracy, pts } = payload as Record<string, unknown>;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > ATTEMPTS) return null;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) return null;
  if (!Array.isArray(pts) || pts.length > WIRE_POINTS * 2 || pts.length % 2 !== 0) return null;
  if (!pts.every((v) => typeof v === "number" && Number.isFinite(v) && v >= -BOARD && v <= BOARD * 2)) return null;
  return { n, accuracy: floor1(accuracy), pts: pts as number[] };
}

export function fromWire(pts: readonly number[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) out.push({ x: pts[i]!, y: pts[i + 1]!, t: 0 });
  return out;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                         */
/* ------------------------------------------------------------------ */

export function formatAccuracy(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}
