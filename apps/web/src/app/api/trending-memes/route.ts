import { getPhotoTemplate } from "@/first-party/meme-duel/photo-templates";
import {
  extractJson,
  matchImgflip,
  outputText,
  parseFormats,
  parseLayout,
  type GrokFormat,
  type TrendingMeme,
  type TrendingMemes,
} from "@/lib/trending-memes";
import { fetchXPostPhoto, xPostId } from "@/lib/x-post";

/**
 * Trending meme templates for Meme Duel.
 *
 * With XAI_API_KEY set, Grok does the work in two passes:
 *   1. X Search: which meme formats are going viral on X right now, with
 *      example posts, the classic template name if it is one, and a post
 *      that shows the blank original.
 *   2. For each format, we fetch the ORIGINAL blank image (imgflip's clean
 *      copy for known templates, else the blank post's photo) and Grok looks
 *      at it to place the caption boxes. Formats without a findable original
 *      are skipped: nobody wants to caption over someone else's caption.
 * Without a key (or if Grok fails) it falls back to imgflip's popular list.
 * Results are cached for TRENDING_MEMES_REFRESH_HOURS (default 6): X Search
 * bills per post it reads.
 */

const REFRESH_MS = Math.max(1, Number(process.env.TRENDING_MEMES_REFRESH_HOURS) || 6) * 3_600_000;
const MAX_MEMES = 18;
const MODEL = process.env.XAI_MODEL || "grok-4.7";

let cache: { at: number; data: TrendingMemes } | null = null;
let inflight: Promise<TrendingMemes> | null = null;

export async function GET() {
  if (!cache || Date.now() - cache.at > REFRESH_MS) {
    inflight ??= load().finally(() => {
      inflight = null;
    });
    try {
      cache = { at: Date.now(), data: await inflight };
    } catch {
      if (!cache) return Response.json({ error: "Couldn't load trending memes" }, { status: 502 });
    }
  }
  const seconds = Math.round(REFRESH_MS / 1000);
  return Response.json(cache.data, {
    headers: { "Cache-Control": `public, max-age=600, s-maxage=${seconds}, stale-while-revalidate=${seconds}` },
  });
}

async function load(): Promise<TrendingMemes> {
  const imgflip = await imgflipTemplates().catch(() => [] as ImgflipMeme[]);
  if (process.env.XAI_API_KEY) {
    try {
      const memes = await fromGrok(process.env.XAI_API_KEY, imgflip);
      if (memes.length >= 4) return { source: "grok", updatedAt: new Date().toISOString(), memes };
      console.warn(`[trending-memes] Grok found only ${memes.length} usable templates, using imgflip`);
    } catch (error) {
      console.warn("[trending-memes] Grok failed, using imgflip", error);
    }
  }
  if (!imgflip.length) throw new Error("No trending source available");
  return { source: "imgflip", updatedAt: new Date().toISOString(), memes: imgflip.slice(0, MAX_MEMES).map(fromImgflip) };
}

/* ------------------------------------------------------------------ */
/* Grok                                                               */
/* ------------------------------------------------------------------ */

const FIND_PROMPT = `You are scouting meme formats for a caption-battle game.
Search X for meme FORMATS (templates people caption and remix) that are going viral right now — the last 7 days — plus classic templates having a big moment this week.
For each format give:
- "name": what people call the format
- "why": one short line on why it's trending now
- "examples": up to 3 URLs of viral posts using it (https://x.com/<handle>/status/<id>)
- "imgflip_name": the imgflip template name if it's a known template (e.g. "Two Buttons", "Distracted Boyfriend"), else null
- "blank_post": the URL of a post that shows the ORIGINAL image with no captions added (search things like "<format> template" or "blank <format>"), else null
Skip anything sexual, hateful, gory, or targeting a private person, and formats that are video-only.
Use at most 4 searches. Answer with only JSON: {"formats":[...]} with up to 15 formats, most viral first.`;

function layoutPrompt(name: string): string {
  return `This is the blank meme template "${name}". Where do people put caption text on it?
Give 1–6 caption boxes as fractions of the image (0..1): x, y = top-left corner, w, h = size.
Place each box where that caption belongs (on the person/object/panel it labels), not overlapping faces when avoidable.
"style": "impact" for classic white outlined meme text over the photo, "label" for short dark text on a white tag stuck on something.
"label": a 1–3 word name for the box (e.g. "Top text", "Button A", "Boyfriend").
Answer with only JSON: {"slots":[{"label":"...","x":0,"y":0,"w":0,"h":0,"style":"impact"}]}`;
}

async function grok(key: string, body: object, timeoutMs: number): Promise<unknown> {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, ...body }),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function fromGrok(key: string, imgflip: ImgflipMeme[]): Promise<TrendingMeme[]> {
  const found = await grok(
    key,
    {
      input: [{ role: "user", content: FIND_PROMPT }],
      tools: [{ type: "x_search", from_date: isoDay(-7), to_date: isoDay(0), enable_image_understanding: true }],
    },
    120_000,
  );
  const formats = parseFormats(extractJson(outputText(found)));

  const resolved = await Promise.all(formats.map((format) => resolveOriginal(format, imgflip).catch(() => null)));
  const seen = new Set<string>();
  const memes = resolved.filter((m): m is TrendingMeme => {
    if (!m || seen.has(m.src)) return false;
    seen.add(m.src);
    return true;
  });

  // Pass 2: Grok places caption boxes on each blank we don't already have a hand-made layout for.
  await Promise.all(
    memes.map(async (meme) => {
      if (meme.imgflipId && getPhotoTemplate(`imgflip-${meme.imgflipId}`)) return;
      try {
        const layout = await grok(
          key,
          {
            input: [
              {
                role: "user",
                content: [
                  { type: "input_image", image_url: meme.src, detail: "high" },
                  { type: "input_text", text: layoutPrompt(meme.title) },
                ],
              },
            ],
          },
          45_000,
        );
        const slots = parseLayout(extractJson(outputText(layout)));
        if (slots.length) meme.slots = slots;
      } catch {
        // No layout: the game falls back to top/bottom text, and captions can be dragged.
      }
    }),
  );
  return memes.slice(0, MAX_MEMES);
}

/** Finds the blank original for a format: imgflip's clean copy, else the blank post's photo. */
async function resolveOriginal(format: GrokFormat, imgflip: ImgflipMeme[]): Promise<TrendingMeme | null> {
  const base = {
    title: format.name,
    why: format.why || undefined,
    examples: format.examples.length ? format.examples : undefined,
  };
  const known = format.imgflipName ? matchImgflip(format.imgflipName, imgflip) : matchImgflip(format.name, imgflip);
  if (known) return { ...fromImgflip(known), ...base, title: known.name };

  const id = format.blankPost ? xPostId(format.blankPost) : null;
  if (!id) return null;
  const photo = await fetchXPostPhoto(id);
  return { id: `x-${id}`, ...base, src: photo.src, width: photo.width, height: photo.height, credit: photo.credit };
}

/* ------------------------------------------------------------------ */
/* imgflip                                                            */
/* ------------------------------------------------------------------ */

interface ImgflipMeme {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  box_count: number;
}

async function imgflipTemplates(): Promise<ImgflipMeme[]> {
  const res = await fetch("https://api.imgflip.com/get_memes", {
    signal: AbortSignal.timeout(10_000),
    next: { revalidate: 21_600 },
  });
  const body = (await res.json()) as { success?: boolean; data?: { memes?: ImgflipMeme[] } };
  if (!res.ok || !body.success || !body.data?.memes) throw new Error("imgflip unavailable");
  return body.data.memes.filter((m) => /^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/i.test(m.url) && m.box_count <= 6);
}

function fromImgflip(m: ImgflipMeme): TrendingMeme {
  return { id: `imgflip-${m.id}`, imgflipId: m.id, title: m.name, src: m.url, width: m.width, height: m.height, credit: null };
}
