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

export interface MemeDrop {
  /** https URL on an allowed host (see src/lib/meme-image.ts) or a data:image URL in demo mode. */
  src: string;
  width: number;
  height: number;
  /** Where the image came from, e.g. the X post it was pulled from. */
  credit?: { handle: string; url: string } | null;
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
      round.drop = { src, width, height, credit };
    }
  }
  return round;
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
    };
  }
  return out;
}
