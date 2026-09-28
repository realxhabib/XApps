import { parseDropSlots, type DropSlot } from "@/first-party/meme-duel/round";
import { xPostId } from "./x-post";

/** Shapes and parsing for /api/trending-memes (shared with the challenge sheet). */

export interface TrendingMeme {
  id: string;
  /** The format's name, e.g. "Two Buttons". */
  title: string;
  /** Why it's trending right now (from Grok). */
  why?: string;
  /** The blank original, never a captioned copy. */
  src: string;
  width: number;
  height: number;
  /** The X post the blank came from, when it came from X. */
  credit: { handle: string; url: string } | null;
  /** imgflip template id, when the format is a known template. */
  imgflipId?: string;
  /** Caption boxes Grok placed on the blank (fractions of the image). */
  slots?: DropSlot[];
  /** Viral posts using the format, to show where it comes from. */
  examples?: string[];
}

export interface TrendingMemes {
  source: "grok" | "imgflip";
  updatedAt: string;
  memes: TrendingMeme[];
}

/** One meme format Grok reported, before we find its original image. */
export interface GrokFormat {
  name: string;
  why: string;
  examples: string[];
  imgflipName: string | null;
  blankPost: string | null;
}

/** Every X post id mentioned anywhere in a Grok Responses API result (text, inline or listed citations), in order. */
export function postIdsFromGrok(response: unknown): string[] {
  return [...new Set(collectStrings(response).flatMap(extractPostIds))];
}

/** The model's answer text from a Responses API result. */
export function outputText(response: unknown): string {
  const output = (response as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return "";
  const parts: string[] = [];
  for (const item of output) {
    const content = (item as { content?: unknown })?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const text = (c as { type?: string; text?: unknown })?.text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

/** Pulls the first JSON object out of model text (tolerates ```json fences and chatter around it). */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Validates Grok's list of trending formats. Unknown fields are ignored; bad links dropped. */
export function parseFormats(value: unknown): GrokFormat[] {
  const formats = (value as { formats?: unknown } | null)?.formats;
  if (!Array.isArray(formats)) return [];
  const out: GrokFormat[] = [];
  for (const raw of formats.slice(0, 20)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = str(r.name, 60);
    if (!name) continue;
    const examples = Array.isArray(r.examples) ? r.examples.filter((e): e is string => typeof e === "string" && !!xPostId(e)).slice(0, 3) : [];
    const blank = typeof r.blank_post === "string" && xPostId(r.blank_post) ? r.blank_post : null;
    out.push({ name, why: str(r.why, 140), examples, imgflipName: str(r.imgflip_name, 80) || null, blankPost: blank });
  }
  return out;
}

/** Lowercase letters and digits only, for matching template names loosely. */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

/** Finds an imgflip template by name (exact after normalizing, then containment either way). */
export function matchImgflip<T extends { name: string }>(name: string, templates: T[]): T | undefined {
  const key = normalizeName(name);
  if (key.length < 3) return undefined;
  return (
    templates.find((t) => normalizeName(t.name) === key) ??
    templates.find((t) => {
      const other = normalizeName(t.name);
      const [short, long] = other.length < key.length ? [other, key] : [key, other];
      // Containment only when the names are close in length: "drake" alone shouldn't claim "Drake Hotline Bling".
      return short.length >= 5 && short.length / long.length >= 0.6 && long.includes(short);
    })
  );
}

/** Caption boxes from Grok's layout answer. */
export function parseLayout(value: unknown): DropSlot[] {
  return parseDropSlots((value as { slots?: never } | null)?.slots);
}

function collectStrings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out, depth + 1));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out, depth + 1));
  return out;
}

function extractPostIds(text: string): string[] {
  const links = text.match(/https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_/]+?\/status(?:es)?\/\d{5,25}/g) ?? [];
  return links.map((link) => xPostId(link)).filter((id): id is string => !!id);
}
