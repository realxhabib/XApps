/**
 * Pure Meme Duel logic: entry validation/sanitizing, sticker math, bot entries
 * and small helpers. No React, no SDK calls — everything here is unit-tested.
 */
import {
  DROP_TEMPLATE_ID,
  PHOTO_BOT_CAPTIONS,
  PHOTO_TEMPLATES,
  dropBotCaptions,
  dropTemplate,
  isPhotoTemplateId,
} from "./photo-templates";
import { positionedSlot, slotCenter, slotFrame, STICKER_SIZE } from "./render";
import { parseRound, type MemeRound } from "./round";
import {
  BOT_CAPTIONS,
  CANVAS,
  MEME_TEMPLATES,
  STICKERS,
  canvasOf,
  getTemplate,
  type CaptionPosition,
  type CaptionSlot,
  type MemeEntry,
  type MemeTemplate,
  type StickerPlacement,
} from "./templates";

type CanvasSize = { width: number; height: number };
type Positions = Record<string, CaptionPosition> | undefined;

/** A source of uniform floats in [0, 1) — `Math.random` or a seeded stream. */
export type Rand = () => number;

export const MAX_STICKERS = 3;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 2.6;
/** A sticker's center stays at least this far (0..1) inside the canvas. */
export const EDGE_MARGIN = 0.04;

/** Live matches are a hard 2 minutes; async/practice get a soft 3-minute clock. */
export const LIVE_TIME_MS = 120_000;
export const SOFT_TIME_MS = 180_000;
/** Minimum gap between "typing" room messages, and how long the pill lingers after the last one. */
export const TYPING_THROTTLE_MS = 1_200;
export const TYPING_IDLE_MS = 2_800;

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* ---------------------------------------------------------------------- */
/* Sticker math                                                           */
/* ---------------------------------------------------------------------- */

/** Keeps a 0..1 coordinate inside the canvas (NaN and junk land in the middle). */
export function clampPosition(value: unknown, margin = EDGE_MARGIN): number {
  return clamp(finite(value, 0.5), margin, 1 - margin);
}

export function clampScale(value: unknown): number {
  return clamp(finite(value, 1), SCALE_MIN, SCALE_MAX);
}

/** Wraps any angle into (-180, 180], rounded to 0.1°. */
export function normalizeRotation(value: unknown): number {
  const deg = finite(value, 0);
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180;
  const rounded = Math.round((wrapped === -180 ? 180 : wrapped) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Signed shortest turn from `from` to `to` in degrees, so springs never spin the long way round. */
export function shortestTurn(from: number, to: number): number {
  return normalizeRotation(to - from);
}

export function isStickerEmoji(value: unknown): value is string {
  return typeof value === "string" && STICKERS.includes(value);
}

export function clampSticker(sticker: StickerPlacement): StickerPlacement {
  return {
    emoji: sticker.emoji,
    x: round4(clampPosition(sticker.x)),
    y: round4(clampPosition(sticker.y)),
    scale: round4(clampScale(sticker.scale)),
    rotate: normalizeRotation(sticker.rotate),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Radius of a sticker as a fraction of the canvas width. */
export function stickerRadius(scale: number): number {
  return (STICKER_SIZE * clampScale(scale) * 0.5) / CANVAS.width;
}

/**
 * Corner-handle gesture: dragging the handle away from/around the sticker's
 * center scales and rotates it. All points share one coordinate space.
 */
export function handleTransform(
  center: Point,
  start: Point,
  current: Point,
  startScale: number,
  startRotate: number,
): { scale: number; rotate: number } {
  const v0 = { x: start.x - center.x, y: start.y - center.y };
  const v1 = { x: current.x - center.x, y: current.y - center.y };
  const d0 = Math.max(8, Math.hypot(v0.x, v0.y));
  const d1 = Math.hypot(v1.x, v1.y);
  const turn = ((Math.atan2(v1.y, v1.x) - Math.atan2(v0.y, v0.x)) * 180) / Math.PI;
  return { scale: clampScale((startScale * d1) / d0), rotate: normalizeRotation(startRotate + turn) };
}

/** Two-finger pinch: the change in distance scales, the change in angle rotates. */
export function pinchTransform(
  a0: Point,
  b0: Point,
  a1: Point,
  b1: Point,
  startScale: number,
  startRotate: number,
): { scale: number; rotate: number } {
  return handleTransform(a0, b0, { x: b1.x - a1.x + a0.x, y: b1.y - a1.y + a0.y }, startScale, startRotate);
}

/* ---------------------------------------------------------------------- */
/* Captions                                                               */
/* ---------------------------------------------------------------------- */

/** Cuts to `max` UTF-16 units without splitting a surrogate pair (emoji). */
export function truncateSafe(value: string, max: number): string {
  if (value.length <= max) return value;
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max);
}

/** Removes control characters and lone surrogates; newlines/tabs become spaces. */
function stripUnsafe(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[i]! + value[i + 1]!;
        i++;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += " ";
      continue;
    }
    if (code < 0x20 || code === 0x7f || code === 0xfffe || code === 0xffff) continue;
    out += value[i]!;
  }
  return out;
}

/**
 * Cleans text while the player types: keeps trailing spaces (so the next word
 * can follow) but drops control characters and enforces the slot's limit.
 */
export function cleanCaptionInput(raw: string, maxLength: number): string {
  return truncateSafe(stripUnsafe(raw), maxLength);
}

/** Final form of a caption: cleaned, whitespace collapsed, trimmed, within the limit. */
export function sanitizeCaption(raw: unknown, maxLength: number): string {
  if (typeof raw !== "string") return "";
  return truncateSafe(stripUnsafe(raw).replace(/\s+/g, " ").trim(), maxLength).trim();
}

/* ---------------------------------------------------------------------- */
/* Entries                                                                */
/* ---------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An original or photo template id (drops aren't in the catalog). */
export function isTemplateId(value: unknown): value is string {
  return typeof value === "string" && (MEME_TEMPLATES.some((t) => t.id === value) || isPhotoTemplateId(value));
}

/** Photo templates and drops let players drag their captions around. */
export function hasMovableCaptions(template: MemeTemplate): boolean {
  return !!template.photo;
}

/* ---------------------------------------------------------------------- */
/* Caption positions                                                      */
/* ---------------------------------------------------------------------- */

/**
 * Where a caption's center may go (0..1 of the canvas): its whole frame stays
 * on the canvas. A frame wider/taller than the canvas is pinned to the middle.
 */
export function captionRange(slot: CaptionSlot, canvas: CanvasSize): { minX: number; maxX: number; minY: number; maxY: number } {
  const f = slotFrame(slot);
  const halfW = f.width / 2 / canvas.width;
  const halfH = f.height / 2 / canvas.height;
  const [minX, maxX] = halfW >= 0.5 ? [0.5, 0.5] : [halfW, 1 - halfW];
  const [minY, maxY] = halfH >= 0.5 ? [0.5, 0.5] : [halfH, 1 - halfH];
  return { minX, maxX, minY, maxY };
}

/** A caption's default position (0..1): the center of the frame the template gave it. */
export function defaultCaptionPosition(slot: CaptionSlot, canvas: CanvasSize): CaptionPosition {
  const c = slotCenter(slot);
  return { x: round4(c.x / canvas.width), y: round4(c.y / canvas.height) };
}

/** Clamps a dragged caption onto the canvas. Non-finite input means "not moved" (undefined). */
export function clampCaptionPosition(slot: CaptionSlot, canvas: CanvasSize, raw: unknown): CaptionPosition | undefined {
  if (!isRecord(raw)) return undefined;
  const { x, y } = raw;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const r = captionRange(slot, canvas);
  return { x: round4(clamp(x, r.minX, r.maxX)), y: round4(clamp(y, r.minY, r.maxY)) };
}

/**
 * Keeps only positions for this template's slots, clamped and rounded.
 * Captions left at (or snapped back to) their default spot are dropped.
 */
export function sanitizePositions(raw: unknown, template: MemeTemplate): Record<string, CaptionPosition> {
  const out: Record<string, CaptionPosition> = {};
  if (!hasMovableCaptions(template) || !isRecord(raw)) return out;
  const canvas = canvasOf(template);
  for (const slot of template.slots) {
    const pos = clampCaptionPosition(slot, canvas, raw[slot.id]);
    if (!pos) continue;
    const home = clampCaptionPosition(slot, canvas, defaultCaptionPosition(slot, canvas)) as CaptionPosition;
    if (Math.abs(pos.x - home.x) < 0.001 && Math.abs(pos.y - home.y) < 0.001) continue;
    out[slot.id] = pos;
  }
  return out;
}

/** The slot as drawn: moved to the player's position when there is one. */
export function slotWithPosition(template: MemeTemplate, slot: CaptionSlot, positions?: Positions): CaptionSlot {
  return positions && hasMovableCaptions(template) ? positionedSlot(slot, canvasOf(template), positions[slot.id]) : slot;
}

/* ---------------------------------------------------------------------- */
/* Entries                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Turns anything (our own editor state, stored data, another client's
 * payload) into a valid entry: known template, one trimmed caption per slot,
 * at most three known stickers inside the canvas, caption positions on the
 * canvas (photo templates only).
 *
 * `fallback` is a template id, or the round's resolved template (needed for
 * drops, which aren't in the catalog).
 */
export function sanitizeEntry(raw: unknown, fallback?: string | MemeTemplate): MemeEntry {
  const input = isRecord(raw) ? raw : {};
  const given = typeof fallback === "object" && fallback ? fallback : undefined;
  const fallbackId = typeof fallback === "string" ? fallback : undefined;
  const template =
    given && (input.templateId === given.id || !isTemplateId(input.templateId))
      ? given
      : getTemplate(
          isTemplateId(input.templateId)
            ? input.templateId
            : isTemplateId(fallbackId)
              ? fallbackId
              : (MEME_TEMPLATES[0] as MemeTemplate).id,
        );
  const templateId = template.id;
  const rawCaptions = isRecord(input.captions) ? input.captions : {};
  const captions: Record<string, string> = {};
  for (const slot of template.slots) captions[slot.id] = sanitizeCaption(rawCaptions[slot.id], slot.maxLength);

  const rawStickers = Array.isArray(input.stickers) ? input.stickers : [];
  const stickers = rawStickers
    .filter((s): s is Record<string, unknown> => isRecord(s) && isStickerEmoji(s.emoji))
    .slice(0, MAX_STICKERS)
    .map((s) =>
      clampSticker({
        emoji: s.emoji as string,
        x: finite(s.x, 0.5),
        y: finite(s.y, 0.5),
        scale: finite(s.scale, 1),
        rotate: finite(s.rotate, 0),
      }),
    );
  const positions = sanitizePositions(input.positions, template);
  return Object.keys(positions).length ? { templateId, captions, stickers, positions } : { templateId, captions, stickers };
}

/** Submit is allowed once any caption has real text. */
export function hasCaption(entry: Pick<MemeEntry, "templateId" | "captions">, template = getTemplate(entry.templateId)): boolean {
  return template.slots.some((slot) => sanitizeCaption(entry.captions[slot.id], slot.maxLength) !== "");
}

/**
 * Alt text for the Arena: the captions in slot order ("POV: …" keeps its
 * prefix), led by the round's topic when there is one. A remix says whose it
 * is and what it remixes ("@me's remix of Two Buttons — Topic: …").
 */
export function entryAlt(entry: MemeEntry, template = getTemplate(entry.templateId), topic?: string, handle?: string): string {
  const parts = template.slots
    .map((slot) => {
      const text = sanitizeCaption(entry.captions[slot.id], slot.maxLength);
      return text ? (slot.prefix ? `${slot.prefix} ${text}` : text) : "";
    })
    .filter(Boolean);
  if (template.remixOf) {
    const who = handle ? `@${handle.replace(/^@/, "")}'s` : "A";
    const caption = parts.length ? `: ${parts.join(" / ")}` : "";
    return `${who} remix of ${template.remixOf.name}${caption}${topic ? ` — Topic: ${topic}` : ""}`;
  }
  const text = parts.length ? parts.join(" / ") : `${template.name} meme`;
  return topic ? `Topic: ${topic} — ${text}` : text;
}

export type EntryJson = {
  templateId: string;
  captions: { [slot: string]: string };
  stickers: { emoji: string; x: number; y: number; scale: number; rotate: number }[];
  positions?: { [slot: string]: { x: number; y: number } };
  /** Drops: a reference to the image (never the image itself, it's embedded in the display). */
  drop?: { src: string | null; width: number; height: number; name?: string };
  /** The player uploaded their own image (embedded in the display only); `templateId`/`drop` say what it remixes. */
  remix?: true;
  topic?: string;
};

/** Longest drop URL kept in `data` (demo drops are data: URLs: those are left out). */
const DROP_REF_MAX = 512;

/**
 * Plain JSON copy of an entry for `xapps.submit({ data })`. Pass the resolved
 * template and round to record a drop reference and the topic.
 */
export function entryToJson(entry: MemeEntry, template?: MemeTemplate, round?: MemeRound): EntryJson {
  // A remix records the round's template it stands in for, never its own (uploaded) image.
  const base = template?.remixOf ?? template;
  const json: EntryJson = {
    templateId: template?.remixOf ? template.remixOf.id : entry.templateId,
    captions: { ...entry.captions },
    stickers: entry.stickers.map((s) => ({ emoji: s.emoji, x: s.x, y: s.y, scale: s.scale, rotate: s.rotate })),
  };
  if (entry.positions && Object.keys(entry.positions).length) {
    json.positions = Object.fromEntries(Object.entries(entry.positions).map(([id, p]) => [id, { x: p.x, y: p.y }]));
  }
  if (base?.id === DROP_TEMPLATE_ID && base.photo) {
    const src = base.photo.src;
    json.drop = {
      src: src.startsWith("https://") && src.length <= DROP_REF_MAX ? src : null,
      width: base.photo.width,
      height: base.photo.height,
      ...(round?.drop?.name ? { name: round.drop.name } : {}),
    };
  }
  if (template?.remixOf) json.remix = true;
  if (round?.topic) json.topic = round.topic;
  return json;
}

/* ---------------------------------------------------------------------- */
/* Template choice                                                        */
/* ---------------------------------------------------------------------- */

/**
 * The round's template: a dropped image wins, then an explicit known
 * `templateId`, otherwise a photo template picked from the match-seeded
 * random stream (identical on both clients).
 */
export function resolveTemplate(rng: { pick<T>(items: readonly T[]): T }, round: MemeRound): MemeTemplate {
  if (round.drop) return dropTemplate(round.drop);
  if (isTemplateId(round.templateId)) return getTemplate(round.templateId);
  return rng.pick(PHOTO_TEMPLATES);
}

/** `resolveTemplate` straight from untrusted `match.settings`. */
export function pickTemplate(
  rng: { pick<T>(items: readonly T[]): T },
  settings?: { [key: string]: unknown } | null,
): MemeTemplate {
  return resolveTemplate(rng, parseRound(settings as Parameters<typeof parseRound>[0]));
}

/* ---------------------------------------------------------------------- */
/* Placement                                                              */
/* ---------------------------------------------------------------------- */

/** A caption slot's full-size area as fractions of the canvas. */
export function slotBounds(slot: CaptionSlot, canvas: CanvasSize = CANVAS): Box {
  const f = slotFrame(slot);
  return { x: f.x / canvas.width, y: f.y / canvas.height, w: f.width / canvas.width, h: f.height / canvas.height };
}

/** Which caption slot (if any) sits under a 0..1 canvas point — tapping the canvas focuses it. */
export function slotAt(template: MemeTemplate, point: Point, positions?: Positions): CaptionSlot | undefined {
  const canvas = canvasOf(template);
  return template.slots.find((slot) => {
    const b = slotBounds(slotWithPosition(template, slot, positions), canvas);
    return point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h;
  });
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * Things a random sticker should rather not cover, weighted: captions most,
 * the template's own text next, its big hero emoji a little.
 */
function obstacles(template: MemeTemplate, positions?: Positions): { box: Box; weight: number }[] {
  const canvas = canvasOf(template);
  const out = template.slots.map((slot) => ({ box: slotBounds(slotWithPosition(template, slot, positions), canvas), weight: 10 }));
  for (const el of template.scene) {
    if (el.kind === "text") {
      const w = el.text.length * el.size * 0.58;
      const left = el.anchor === "start" ? el.x : el.x - w / 2;
      out.push({
        box: { x: left / CANVAS.width, y: (el.y - el.size * 0.85) / CANVAS.height, w: w / CANVAS.width, h: el.size / CANVAS.height },
        weight: 6,
      });
    } else if (el.kind === "emoji" && el.size >= 100) {
      const s = el.size * 0.8;
      out.push({
        box: { x: (el.x - s / 2) / CANVAS.width, y: (el.y - s / 2) / CANVAS.height, w: s / CANVAS.width, h: s / CANVAS.height },
        weight: 1.5,
      });
    }
  }
  return out;
}

/**
 * A fun spot for a sticker: tries a handful of random candidates and keeps
 * the one that covers the least caption/scene text and crowds other stickers least.
 */
export function randomStickerPlacement(
  template: MemeTemplate,
  emoji: string,
  rand: Rand,
  existing: readonly StickerPlacement[] = [],
  positions?: Positions,
): StickerPlacement {
  const avoid = obstacles(template, positions);
  // Radii are fractions of the width; on a tall/wide canvas y fractions scale differently.
  const aspect = canvasOf(template).width / canvasOf(template).height;
  let best: StickerPlacement | null = null;
  let bestCost = Infinity;
  for (let attempt = 0; attempt < 40; attempt++) {
    const scale = 0.9 + rand() * 0.45;
    const candidate: StickerPlacement = {
      emoji,
      x: 0.12 + rand() * 0.76,
      y: 0.12 + rand() * 0.76,
      scale,
      rotate: -20 + rand() * 40,
    };
    const r = stickerRadius(scale);
    const ry = r * aspect;
    const box = { x: candidate.x - r, y: candidate.y - ry, w: r * 2, h: ry * 2 };
    let cost = 0;
    for (const { box: area, weight } of avoid) cost += overlapArea(box, area) * weight;
    for (const other of existing) {
      const gap = Math.hypot(other.x - candidate.x, (other.y - candidate.y) / aspect) - r - stickerRadius(other.scale);
      if (gap < 0.04) cost += 0.04 - gap;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = candidate;
      if (cost === 0) break;
    }
  }
  return clampSticker(best as StickerPlacement);
}

/** The dice button: every sticker gets a fresh random spot, angle and size. */
export function scatterStickers<T extends StickerPlacement>(
  template: MemeTemplate,
  stickers: readonly T[],
  rand: Rand,
  positions?: Positions,
): T[] {
  const placed: StickerPlacement[] = [];
  return stickers.map((sticker) => {
    const next = randomStickerPlacement(template, sticker.emoji, rand, placed, positions);
    placed.push(next);
    return { ...sticker, x: next.x, y: next.y, scale: next.scale, rotate: next.rotate };
  });
}

/* ---------------------------------------------------------------------- */
/* Bot                                                                    */
/* ---------------------------------------------------------------------- */

export function pickFrom<T>(items: readonly T[], rand: Rand): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))] as T;
}

/** The bot's caption bank for a template: originals, photo templates, or the generic pool for drops. */
export function botCaptionsFor(template: MemeTemplate): readonly Record<string, string>[] {
  if (template.id === DROP_TEMPLATE_ID) return dropBotCaptions(template);
  return BOT_CAPTIONS[template.id] ?? PHOTO_BOT_CAPTIONS[template.id] ?? [];
}

/** The practice bot's meme: a canned caption set for the template plus one sticker. */
export function makeBotEntry(template: MemeTemplate, rand: Rand): MemeEntry {
  const bank = botCaptionsFor(template);
  const captions = bank.length
    ? pickFrom(bank, rand)
    : Object.fromEntries(template.slots.map((slot) => [slot.id, slot.placeholder]));
  const sticker = randomStickerPlacement(template, pickFrom(STICKERS, rand), rand);
  return sanitizeEntry({ templateId: template.id, captions, stickers: [sticker] }, template);
}

/** When the bot submits on its own: somewhere 15–40 s into the match. */
export function botSubmitDelayMs(rand: Rand): number {
  return Math.round(15_000 + rand() * 25_000);
}

/** When the human submits first, the bot follows a few seconds later. */
export function botFollowUpDelayMs(rand: Rand): number {
  return Math.round(2_500 + rand() * 2_500);
}

/* ---------------------------------------------------------------------- */
/* Misc                                                                   */
/* ---------------------------------------------------------------------- */

/** "2:05" — rounds up so the clock shows 0:00 only when time is really out. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export type Outcome = "win" | "lose" | "draw";

export function outcomeFor(result: { winnerId: string | null }, meId: string): Outcome {
  if (!result.winnerId) return "draw";
  return result.winnerId === meId ? "win" : "lose";
}
