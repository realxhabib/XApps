/**
 * Pure size-budget logic for photo entries. A submission (data + display,
 * JSON-serialized) must stay under the SDK's `LIMITS.submissionBytes`; photo
 * entries embed their image as a JPEG data URL, so we step down the image's
 * size/quality until the whole submission fits.
 */
import { LIMITS } from "@xapps/sdk";

/** What we aim for: comfortably under the SDK's hard limit (64 KB). */
export const SUBMISSION_BUDGET = Math.min(56 * 1024, LIMITS.submissionBytes - 8 * 1024);

/** Longest side of the embedded image, in pixels. */
export const MAX_IMAGE_SIDE = 560;

export interface EncodeStep {
  /** Longest side in pixels. */
  side: number;
  /** JPEG quality, 0..1. */
  quality: number;
}

/** Tried in order until the submission fits; the first steps fit almost every photo. */
export const ENCODE_LADDER: readonly EncodeStep[] = [
  { side: MAX_IMAGE_SIDE, quality: 0.8 },
  { side: MAX_IMAGE_SIDE, quality: 0.7 },
  { side: MAX_IMAGE_SIDE, quality: 0.6 },
  { side: 500, quality: 0.55 },
  { side: 440, quality: 0.5 },
  { side: 380, quality: 0.45 },
  { side: 320, quality: 0.42 },
  { side: 260, quality: 0.4 },
  { side: 200, quality: 0.36 },
];

/** Exactly how the SDK measures a submission: UTF-8 bytes of its JSON. */
export function submissionBytes(value: unknown): number {
  const text = JSON.stringify(value ?? null);
  return new TextEncoder().encode(text).length;
}

/** Pixel size for an image scaled down (never up) so its longest side is at most `maxSide`. */
export function scaleToFit(width: number, height: number, maxSide: number): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Steps worth trying for an image this size: a small image skips resolutions it can't reach. */
export function ladderFor(width: number, height: number, ladder: readonly EncodeStep[] = ENCODE_LADDER): EncodeStep[] {
  const longest = Math.max(width, height);
  const steps = ladder.map((step) => ({ ...step, side: Math.min(step.side, Math.max(1, Math.round(longest))) }));
  // Drop duplicates created by the clamp above.
  return steps.filter((step, i) => steps.findIndex((s) => s.side === step.side && s.quality === step.quality) === i);
}

export interface Fitted<T> {
  value: T;
  step: EncodeStep;
  bytes: number;
}

/**
 * Walks the ladder: encodes the image at each step, builds the submission
 * around it and measures it. Returns the first (best-looking) one that fits,
 * or throws when even the smallest step is too big.
 */
export async function fitToBudget<T>(
  ladder: readonly EncodeStep[],
  encode: (step: EncodeStep) => string | Promise<string>,
  build: (href: string) => T,
  budget = SUBMISSION_BUDGET,
  measure: (value: T) => number = submissionBytes,
): Promise<Fitted<T>> {
  let smallest = Infinity;
  for (const step of ladder) {
    const value = build(await encode(step));
    const bytes = measure(value);
    if (bytes <= budget) return { value, step, bytes };
    smallest = Math.min(smallest, bytes);
  }
  throw new Error(`meme too large: ${smallest} bytes > ${budget}`);
}
