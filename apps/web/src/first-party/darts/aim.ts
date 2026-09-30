/**
 * Aiming, hand sway and the flick (pure, unit-tested).
 *
 * While you hold a dart up, your aim point drifts with a smooth hand sway: a
 * sum of a few slow sines per axis (a Lissajous-like wander) with seeded
 * phases and frequencies, so every dart sways differently but the same seed
 * always sways the same way. You counter it by moving your finger. Holding
 * your breath calms the sway for a moment, then you have to gasp for air.
 *
 * The throw is a flick up. Its speed sets the vertical drop (too soft lands
 * low, too hard sails high), and a flick that isn't straight up pulls the dart
 * sideways. The landing point is a pure function of the release (aim point,
 * sway time, breath, flick speed and angle) and the sway parameters.
 */

import type { Point } from "./board";

/* ---------------------------------------------------------------------- */
/* Sway                                                                    */
/* ---------------------------------------------------------------------- */

export const SWAY = {
  /** Peak-ish wander (mm) once the dart is fully raised. */
  amplitude: 15,
  /** The dart is still coming up: sway starts at this fraction… */
  raiseFactor: 0.45,
  /** …and reaches full strength after this long (ms). */
  raiseMs: 650,
  /** Holding the dart up longer than this starts to tire the arm… */
  fatigueAfterMs: 3500,
  /** …adding this much sway per second… */
  fatiguePerSec: 0.22,
  /** …up to this multiple. */
  fatigueMax: 2.2,
} as const;

export const BREATH = {
  /** Calming down to the held level. */
  inMs: 260,
  /** How long the breath holds (from the tap). */
  holdMs: 1700,
  /** Sway multiplier while held. */
  held: 0.2,
  /** Gasping for air afterwards. */
  gaspMs: 500,
  gasp: 1.35,
  /** Back to normal after the gasp. */
  recoverMs: 900,
} as const;

/** Three sines per axis: slow wander, medium drift, fast tremor. */
export interface SwayParams {
  fx: [number, number, number];
  fy: [number, number, number];
  px: [number, number, number];
  py: [number, number, number];
  /** Per-dart amplitude (mm). */
  amp: number;
}

const WEIGHTS = [0.62, 0.3, 0.08] as const;
const BASE_FX = [0.21, 0.53, 2.3] as const;
const BASE_FY = [0.27, 0.67, 2.7] as const;

/** Sway parameters for one dart, from a seeded stream (e.g. `xapps.random.fork("sway:3").next`). */
export function swayParams(rand: () => number): SwayParams {
  const jitter = (f: number) => f * (0.85 + rand() * 0.3);
  const phase = () => rand() * Math.PI * 2;
  return {
    fx: [jitter(BASE_FX[0]), jitter(BASE_FX[1]), jitter(BASE_FX[2])],
    fy: [jitter(BASE_FY[0]), jitter(BASE_FY[1]), jitter(BASE_FY[2])],
    px: [phase(), phase(), phase()],
    py: [phase(), phase(), phase()],
    amp: SWAY.amplitude * (0.9 + rand() * 0.2),
  };
}

const smooth = (t: number) => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Sway multiplier from holding your breath at `breathAt` (ms since the dart was raised). */
export function breathFactor(tMs: number, breathAt: number | null): number {
  if (breathAt === null || tMs < breathAt) return 1;
  const dt = tMs - breathAt;
  if (dt < BREATH.inMs) return lerp(1, BREATH.held, smooth(dt / BREATH.inMs));
  if (dt < BREATH.holdMs) return BREATH.held;
  const gasp = dt - BREATH.holdMs;
  if (gasp < BREATH.gaspMs) return lerp(BREATH.held, BREATH.gasp, smooth(gasp / BREATH.gaspMs));
  const recover = gasp - BREATH.gaspMs;
  if (recover < BREATH.recoverMs) return lerp(BREATH.gasp, 1, smooth(recover / BREATH.recoverMs));
  return 1;
}

/** Whether a breath is currently calming the sway. */
export function breathHeld(tMs: number, breathAt: number | null): boolean {
  return breathAt !== null && tMs >= breathAt && tMs - breathAt < BREATH.holdMs;
}

/** Overall sway strength at `tMs` since the dart was raised. */
export function swayStrength(tMs: number, breathAt: number | null, amp: number): number {
  const t = Math.max(0, tMs);
  const raise = lerp(SWAY.raiseFactor, 1, smooth(t / SWAY.raiseMs));
  const tired = Math.min(SWAY.fatigueMax, 1 + (Math.max(0, t - SWAY.fatigueAfterMs) / 1000) * SWAY.fatiguePerSec);
  return amp * raise * tired * breathFactor(t, breathAt);
}

/** Where the hand has drifted the aim (mm) `tMs` after raising the dart. */
export function swayOffset(params: SwayParams, tMs: number, breathAt: number | null = null): Point {
  const s = Math.max(0, tMs) / 1000;
  const k = swayStrength(tMs, breathAt, params.amp);
  let x = 0;
  let y = 0;
  for (let i = 0; i < 3; i++) {
    x += WEIGHTS[i]! * Math.sin(2 * Math.PI * params.fx[i]! * s + params.px[i]!);
    y += WEIGHTS[i]! * Math.sin(2 * Math.PI * params.fy[i]! * s + params.py[i]!);
  }
  return { x: x * k, y: y * k };
}

/* ---------------------------------------------------------------------- */
/* Flick                                                                   */
/* ---------------------------------------------------------------------- */

/** One pointer sample, CSS px and ms. */
export interface Sample {
  t: number;
  x: number;
  y: number;
}

export const FLICK = {
  /** A flick moves up at least this far (px)… */
  minDistance: 28,
  /** …and faster than this on average (px/ms). */
  minSpeed: 0.3,
  /** A flick starts where the finger first rises faster than this (px/ms). */
  startSpeed: 0.35,
  /** A late sample (up to `hitchMs` after the last) that still rose this far (px) keeps the flick going. */
  hitchRise: 6,
  hitchMs: 110,
  /** Same-time samples that drop back down more than this (px) end the flick. */
  maxDip: 3,
  /** Lifting off this soon after the last move (ms) still counts as the flick; a longer stop is a drag. */
  liftGraceMs: 150,
  /** The release speed is measured over at least this long (ms), or the whole flick if it's shorter. */
  minWindowMs: 24,
  /** Only the last this-long of a flick counts towards its release speed. */
  releaseWindowMs: 70,
  /** Flicks are short. Anything slower is a drag. */
  maxMs: 320,
} as const;

export type FlickResult =
  | { kind: "cancel"; reason: "short" | "slow" | "down" }
  | {
      kind: "throw";
      /** Index of the sample where the flick began: the aim is read there. */
      startIndex: number;
      /** Release speed (px/ms, upwards). */
      speed: number;
      /** Direction, radians from straight up (positive = to the right). */
      angle: number;
      durationMs: number;
    };

/**
 * Reads a flick off the end of a stroke. The flick is the trailing run of
 * samples that keeps moving up; the dart leaves the hand at the last sample.
 */
export function analyzeFlick(samples: readonly Sample[]): FlickResult {
  let n = samples.length;
  if (n < 2) return { kind: "cancel", reason: "short" };
  // The lift-off sample often repeats the last position a few ms later: that's still the flick.
  while (n > 2) {
    const last = samples[n - 1]!;
    const before = samples[n - 2]!;
    if (Math.abs(before.y - last.y) >= 0.5 || last.t - before.t > FLICK.liftGraceMs) break;
    n--;
  }
  const end = samples[n - 1]!;
  let k = n - 1;
  while (k > 0) {
    const prev = samples[k - 1]!;
    const cur = samples[k]!;
    if (end.t - prev.t > FLICK.maxMs) break;
    const up = prev.y - cur.y;
    const dt = cur.t - prev.t;
    if (dt <= 0) {
      if (up < -FLICK.maxDip) break;
      k--;
      continue;
    }
    // Still aiming (or moving down) before this. A hitch (a late but clearly rising sample) doesn't end it.
    if (up / dt < FLICK.startSpeed && !(up >= FLICK.hitchRise && dt <= FLICK.hitchMs)) break;
    k--;
  }
  // Take-off: the finger accelerates into a flick, so include a couple of slower rising samples.
  for (let back = 0; back < 2 && k > 0; back++) {
    const prev = samples[k - 1]!;
    const cur = samples[k]!;
    if (cur.t - prev.t > 40 || prev.y - cur.y <= 0.3) break;
    k--;
  }
  const start = samples[k]!;
  const rise = start.y - end.y;
  const duration = end.t - start.t;
  if (rise <= 0) return { kind: "cancel", reason: "down" };
  if (rise < FLICK.minDistance || duration <= 0) return { kind: "cancel", reason: "short" };
  if (rise / duration < FLICK.minSpeed) return { kind: "cancel", reason: "slow" };

  // Release speed: the last stretch of the flick (bunched samples fall back to the whole flick).
  let w = n - 1;
  while (w > k && end.t - samples[w - 1]!.t <= FLICK.releaseWindowMs) w--;
  if (end.t - samples[w]!.t < FLICK.minWindowMs) w = k;
  const from = samples[w]!;
  const dt = Math.max(12, end.t - from.t);
  const speed = Math.max(0, from.y - end.y) / dt;
  const angle = Math.atan2(end.x - start.x, rise);
  return { kind: "throw", startIndex: k, speed, angle, durationMs: duration };
}

/**
 * Flick speed normalized to the stage height, so a phone and a desktop window
 * need the same *feel* of flick rather than the same pixels.
 */
export function normalizeSpeed(pxPerMs: number, stageHeight: number): number {
  const h = Math.max(480, Math.min(1100, stageHeight || 760));
  return pxPerMs * (760 / h);
}

/* ---------------------------------------------------------------------- */
/* Landing                                                                 */
/* ---------------------------------------------------------------------- */

export const POWER = {
  /** Normalized speeds (≈ px/ms on a 760 px tall stage). */
  min: 0.3,
  /** The sweet spot: no drop at all between these. */
  low: 1.25,
  high: 2.7,
  /** Past this it can't sail any higher. */
  max: 5.5,
  /** How far a weak flick drops (mm, at `min`). */
  maxDrop: 75,
  /** How far a hard flick rises (mm, at `max`). */
  maxRise: 65,
  /** A gentle slope inside the sweet spot (mm per unit of speed). */
  inBand: 5,
  /** Flick angles inside this (radians) don't pull the dart sideways. */
  deadAngle: 0.14,
  /** Sideways pull (mm per radian beyond the dead zone). */
  sideways: 70,
  maxSideways: 45,
} as const;

export type PowerVerdict = "soft" | "good" | "hard";

export function powerVerdict(speed: number): PowerVerdict {
  if (speed < POWER.low) return "soft";
  if (speed > POWER.high) return "hard";
  return "good";
}

/** 0..1 position of a speed on the power gauge (sweet spot in the middle). */
export function powerGauge(speed: number): number {
  return Math.max(0, Math.min(1, (speed - POWER.min) / (POWER.max - POWER.min)));
}

/** Vertical error from flick speed (mm, positive = lower on the board). */
export function verticalError(speed: number): number {
  const s = Math.max(POWER.min, Math.min(POWER.max, speed));
  // Continuous: the gentle in-band slope meets the drop and the rise at the band's edges.
  const edge = ((POWER.high - POWER.low) / 2) * POWER.inBand;
  if (s < POWER.low) return edge + (POWER.maxDrop - edge) * Math.pow((POWER.low - s) / (POWER.low - POWER.min), 1.15);
  if (s > POWER.high) return -edge - (POWER.maxRise - edge) * Math.pow((s - POWER.high) / (POWER.max - POWER.high), 0.9);
  const mid = (POWER.low + POWER.high) / 2;
  return (mid - s) * POWER.inBand;
}

/** Sideways error from the flick angle (mm, positive = right). */
export function lateralError(angle: number): number {
  const a = Math.abs(angle);
  if (!Number.isFinite(a) || a <= POWER.deadAngle) return 0;
  return Math.sign(angle) * Math.min(POWER.maxSideways, (a - POWER.deadAngle) * POWER.sideways);
}

/** Everything that decides where a dart lands. */
export interface Release {
  /** Where the finger was aiming (mm), before sway. */
  aim: Point;
  /** When the flick began, ms after the dart was raised. */
  swayT: number;
  /** When the breath was held (ms after raising), if at all. */
  breathAt: number | null;
  /** Normalized flick speed. */
  speed: number;
  /** Flick angle, radians from straight up. */
  angle: number;
}

/** Where the sway had the reticle at the moment the flick began. */
export function reticleAt(aim: Point, params: SwayParams, tMs: number, breathAt: number | null): Point {
  const s = swayOffset(params, tMs, breathAt);
  return { x: aim.x + s.x, y: aim.y + s.y };
}

/** Where the dart lands (mm). Pure: same release + sway → same point. */
export function landingPoint(release: Release, params: SwayParams): Point {
  const r = reticleAt(release.aim, params, release.swayT, release.breathAt);
  return {
    x: r.x + lateralError(release.angle),
    y: r.y + verticalError(release.speed),
  };
}

/** How long the dart is in the air (ms): harder flicks arrive sooner. */
export function flightMs(speed: number): number {
  return Math.round(Math.max(190, Math.min(420, 420 - (speed - POWER.min) * 60)));
}

/** Keeps the aim point on (or just around) the board. */
export function clampAim(p: Point, limit = 230): Point {
  return { x: Math.max(-limit, Math.min(limit, p.x)), y: Math.max(-limit, Math.min(limit, p.y)) };
}

/**
 * Keyboard throws: holding Space charges a power bar that swings 0 → 1 → 0
 * every `periodMs`; releasing maps it to a flick speed (the sweet spot sits
 * a little under the middle of the bar).
 */
export const CHARGE_PERIOD_MS = 1400;

export function chargeLevel(heldMs: number): number {
  const phase = (Math.max(0, heldMs) % CHARGE_PERIOD_MS) / CHARGE_PERIOD_MS;
  return phase < 0.5 ? phase * 2 : 2 - phase * 2;
}

export function chargeToSpeed(level: number): number {
  return POWER.min + Math.max(0, Math.min(1, level)) * (POWER.max - POWER.min) * 0.8;
}
