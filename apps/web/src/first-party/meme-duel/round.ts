/**
 * What a Meme Duel round is about, read from `match.settings`. The challenger
 * sets these when creating the challenge; quick matches and practice leave
 * them empty and the match seed picks a template.
 *
 *   templateId  a template to caption (photo template id or an original)
 *   drop        an image the challenger dropped (upload or X post photo)
 *   topic       an optional theme both players caption toward
 */
import type { Json } from "@xapps/sdk";

export const TOPIC_MAX = 80;

/** A caption box on a dropped image, as fractions (0..1) of the image. */
export interface DropSlot {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** "impact": white outlined meme text; "label": dark text on a white tag. */
  style: "impact" | "label";
}

export const MAX_DROP_SLOTS = 6;

export interface MemeDrop {
  /** https URL on an allowed host (see src/lib/meme-image.ts) or a data:image URL in demo mode. */
  src: string;
  width: number;
  height: number;
  /** Where the image came from, e.g. the X post it was pulled from. */
  credit?: { handle: string; url: string } | null;
  /** The meme format's name, e.g. for a trending template Grok found. */
  name?: string;
  /** Caption boxes placed for this image. Without them the drop gets top/bottom text. */
  slots?: DropSlot[];
}

export interface MemeRound {
  templateId?: string;
  drop?: MemeDrop;
  topic?: string;
}

function dimension(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 16 && value <= 8192 ? Math.round(value) : null;
}

/** Validates untrusted settings into a round description. Anything malformed is dropped. */
export function parseRound(settings: { [key: string]: Json } | null | undefined): MemeRound {
  const round: MemeRound = {};
  if (!settings || typeof settings !== "object") return round;
  if (typeof settings.templateId === "string" && settings.templateId.length <= 64) round.templateId = settings.templateId;
  const topic = typeof settings.topic === "string" ? settings.topic.replace(/\s+/g, " ").trim().slice(0, TOPIC_MAX) : "";
  if (topic) round.topic = topic;
  const drop = settings.drop;
  if (drop && typeof drop === "object" && !Array.isArray(drop)) {
    const src = typeof drop.src === "string" ? drop.src : "";
    const width = dimension(drop.width);
    const height = dimension(drop.height);
    const okSrc = /^https:\/\//.test(src) || /^data:image\/(jpeg|png|webp|gif);base64,/.test(src);
    if (okSrc && width && height) {
      const c = drop.credit;
      const credit =
        c && typeof c === "object" && !Array.isArray(c) && typeof c.handle === "string" && typeof c.url === "string"
          ? { handle: c.handle.slice(0, 32), url: c.url.slice(0, 200) }
          : null;
      const name = typeof drop.name === "string" ? drop.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      const slots = parseDropSlots(drop.slots);
      round.drop = { src, width, height, credit, ...(name ? { name } : {}), ...(slots.length ? { slots } : {}) };
    }
  }
  return round;
}

function fraction(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)) : null;
}

/** Keeps up to MAX_DROP_SLOTS well-formed boxes that fit inside the image. */
export function parseDropSlots(value: Json | undefined): DropSlot[] {
  if (!Array.isArray(value)) return [];
  const slots: DropSlot[] = [];
  for (const raw of value) {
    if (slots.length >= MAX_DROP_SLOTS) break;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const x = fraction(raw.x);
    const y = fraction(raw.y);
    const w = fraction(raw.w);
    const h = fraction(raw.h);
    if (x === null || y === null || w === null || h === null || w < 0.08 || h < 0.04) continue;
    const label = typeof raw.label === "string" ? raw.label.replace(/\s+/g, " ").trim().slice(0, 24) : "";
    slots.push({
      id: `s${slots.length + 1}`,
      label: label || `Caption ${slots.length + 1}`,
      x: Math.min(x, 1 - w),
      y: Math.min(y, 1 - h),
      w,
      h,
      style: raw.style === "label" ? "label" : "impact",
    });
  }
  return slots;
}

/** Serializes a round for `CreateChallengeInput.settings`. */
export function roundToSettings(round: MemeRound): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  if (round.templateId) out.templateId = round.templateId;
  if (round.topic) out.topic = round.topic.slice(0, TOPIC_MAX);
  if (round.drop) {
    out.drop = {
      src: round.drop.src,
      width: round.drop.width,
      height: round.drop.height,
      credit: round.drop.credit ?? null,
      ...(round.drop.name ? { name: round.drop.name } : {}),
      ...(round.drop.slots?.length
        ? { slots: round.drop.slots.map(({ id, label, x, y, w, h, style }) => ({ id, label, x, y, w, h, style })) }
        : {}),
    };
  }
  return out;
}
