/**
 * Perfect Circle — the shareable bits, pure (used by the app, the entry
 * display and the server-rendered share card / OG image alike).
 *
 * A share link carries the circle itself: `/embed/perfect-circle/card/<code>`
 * where `code` is base64url of [version, accuracy×10 (2 bytes), x0, y0, x1, y1 …]
 * with CARD_POINTS points quantised to 0–255 across the board (~200 chars).
 * The page's Open Graph image redraws it, so the post on X shows the circle.
 */
import {
  BOARD,
  CENTER,
  floor1,
  formatAccuracy,
  inkColor,
  radialStats,
  resample,
  segmentError,
  verdictFor,
  type Point,
} from "./logic";

export const CARD_VERSION = 1;
/** Points kept in a share link. */
export const CARD_POINTS = 72;
const MIN_CARD_POINTS = 8;

export interface CardData {
  accuracy: number;
  stroke: Point[];
}

const quantise = (v: number) => Math.max(0, Math.min(255, Math.round((v / BOARD) * 255)));
const dequantise = (q: number) => (q / 255) * BOARD;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeCard({ accuracy, stroke }: CardData): string {
  const points = resample(stroke, CARD_POINTS);
  const tenths = Math.max(0, Math.min(1000, Math.round(floor1(accuracy) * 10)));
  const bytes = new Uint8Array(3 + points.length * 2);
  bytes[0] = CARD_VERSION;
  bytes[1] = tenths >> 8;
  bytes[2] = tenths & 0xff;
  points.forEach((p, i) => {
    bytes[3 + i * 2] = quantise(p.x);
    bytes[4 + i * 2] = quantise(p.y);
  });
  return toBase64Url(bytes);
}

/** Null for anything that isn't a card this version wrote. */
export function decodeCard(code: string): CardData | null {
  if (code.length > 400) return null;
  const bytes = fromBase64Url(code);
  if (!bytes || bytes.length < 3 + MIN_CARD_POINTS * 2 || bytes[0] !== CARD_VERSION) return null;
  if ((bytes.length - 3) % 2 !== 0 || (bytes.length - 3) / 2 > CARD_POINTS) return null;
  const tenths = (bytes[1]! << 8) | bytes[2]!;
  if (tenths > 1000) return null;
  const stroke: Point[] = [];
  for (let i = 3; i + 1 < bytes.length; i += 2) stroke.push({ x: dequantise(bytes[i]!), y: dequantise(bytes[i + 1]!), t: 0 });
  return { accuracy: tenths / 10, stroke };
}

export const CARD_PATH = "/embed/perfect-circle/card/";

export function shareText(accuracy: number): string {
  const { emoji } = verdictFor(accuracy);
  return `I drew a ${formatAccuracy(accuracy)} perfect circle on XApps ${emoji} Can you beat it?`;
}

/* ------------------------------------------------------------------ */
/* Drawing, renderer-agnostic                                         */
/* ------------------------------------------------------------------ */

export interface InkSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
}

export interface CircleArt {
  segments: InkSegment[];
  /** The ideal circle (mean radius around the dot). */
  radius: number;
  center: { x: number; y: number };
}

/**
 * The stroke as coloured segments in a `size`-wide square (board units scaled),
 * each coloured by how far it strays from the ideal circle.
 */
export function circleArt(stroke: readonly Point[], size: number, maxSegments = 120): CircleArt {
  const scale = size / BOARD;
  const pts = stroke.length > maxSegments + 1 ? resample(stroke, maxSegments + 1) : stroke;
  const { radius } = radialStats(stroke);
  const segments: InkSegment[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    segments.push({
      x1: a.x * scale,
      y1: a.y * scale,
      x2: b.x * scale,
      y2: b.y * scale,
      color: inkColor(segmentError(a, b, radius)),
    });
  }
  return { segments, radius: radius * scale, center: { x: CENTER.x * scale, y: CENTER.y * scale } };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Self-contained SVG of a circle and its score (the match entry's `display`). */
export function circleSvg(stroke: readonly Point[], accuracy: number | null, size = 400): string {
  const art = circleArt(stroke, size, 96);
  const w = Math.max(3, size / 70);
  const lines = art.segments
    .map((s) => `<line x1="${r1(s.x1)}" y1="${r1(s.y1)}" x2="${r1(s.x2)}" y2="${r1(s.y2)}" stroke="${s.color}"/>`)
    .join("");
  const label =
    accuracy === null
      ? ""
      : `<text x="${size / 2}" y="${r1(size * 0.64)}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="800" font-size="${r1(size * 0.13)}" fill="#f6f7fb">${formatAccuracy(accuracy)}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
    `<rect width="${size}" height="${size}" rx="${r1(size * 0.06)}" fill="#0b0d14"/>` +
    (art.radius > 0
      ? `<circle cx="${r1(art.center.x)}" cy="${r1(art.center.y)}" r="${r1(art.radius)}" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="${r1(w / 2)}" stroke-dasharray="${r1(w * 1.4)} ${r1(w * 1.6)}"/>`
      : "") +
    `<g fill="none" stroke-width="${r1(w)}" stroke-linecap="round">${lines}</g>` +
    `<circle cx="${r1(art.center.x)}" cy="${r1(art.center.y)}" r="${r1(w * 1.3)}" fill="#f6f7fb"/>` +
    label +
    `</svg>`
  );
}
