import { xPostId } from "./x-post";

/** Shapes and parsing for /api/trending-memes (shared with the challenge sheet). */

export interface TrendingMeme {
  id: string;
  title: string;
  src: string;
  width: number;
  height: number;
  /** The X post it came from. */
  credit: { handle: string; url: string } | null;
  /** imgflip template id, when the image is a known template. */
  imgflipId?: string;
}

export interface TrendingMemes {
  source: "grok" | "imgflip";
  updatedAt: string;
  memes: TrendingMeme[];
}

/** Every X post id mentioned anywhere in a Grok Responses API result (text, inline or listed citations), in order. */
export function postIdsFromGrok(response: unknown): string[] {
  return [...new Set(collectStrings(response).flatMap(extractPostIds))];
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
