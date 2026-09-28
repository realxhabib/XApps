import { postIdsFromGrok, type TrendingMeme, type TrendingMemes } from "@/lib/trending-memes";
import { fetchXPostPhoto } from "@/lib/x-post";

/**
 * Trending meme images for Meme Duel.
 *
 * With XAI_API_KEY set, Grok's X Search finds images going viral on X right
 * now and we keep the ones whose post has a usable photo. Without a key (or if
 * Grok fails) it falls back to imgflip's list of templates popular right now.
 * Results are cached for TRENDING_MEMES_REFRESH_HOURS (default 6) because
 * every Grok search is billed per post fetched.
 */

const REFRESH_MS = Math.max(1, Number(process.env.TRENDING_MEMES_REFRESH_HOURS) || 6) * 3_600_000;
const MAX_MEMES = 18;

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
  if (process.env.XAI_API_KEY) {
    try {
      const memes = await fromGrok(process.env.XAI_API_KEY);
      if (memes.length >= 4) return { source: "grok", updatedAt: new Date().toISOString(), memes };
    } catch (error) {
      console.warn("[trending-memes] Grok search failed, using imgflip", error);
    }
  }
  return { source: "imgflip", updatedAt: new Date().toISOString(), memes: await fromImgflip() };
}

/* ------------------------------------------------------------------ */
/* Grok (xAI Responses API + x_search)                                */
/* ------------------------------------------------------------------ */

const PROMPT = `Search X for meme images that are going viral right now (posted in the last 3 days).
I want single still images people are captioning, quote-posting or remixing: reaction images, new meme formats, funny photos.
Skip videos, screenshots of long text, ads, and anything sexual, hateful, gory, or targeting a private person.
Use at most 3 searches. Answer with only a JSON array of up to 20 post URLs (https://x.com/<handle>/status/<id>) whose post contains the image, most viral first.`;

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function fromGrok(key: string): Promise<TrendingMeme[]> {
  const res = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.XAI_MODEL || "grok-4.7",
      input: [{ role: "user", content: PROMPT }],
      tools: [{ type: "x_search", from_date: isoDay(-3), to_date: isoDay(0), enable_image_understanding: true }],
    }),
    signal: AbortSignal.timeout(90_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 200)}`);

  // Post links can show up in the answer text, its inline citations, or the citations list.
  const ids = postIdsFromGrok(await res.json()).slice(0, 30);
  const settled = await Promise.allSettled(ids.map((id) => fetchXPostPhoto(id)));
  const seen = new Set<string>();
  const memes: TrendingMeme[] = [];
  settled.forEach((result, i) => {
    if (result.status !== "fulfilled" || seen.has(result.value.src)) return;
    seen.add(result.value.src);
    const { src, width, height, credit, text } = result.value;
    const title = text.replace(/https:\/\/t\.co\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    memes.push({ id: `x-${ids[i]}`, title: title || (credit ? `@${credit.handle}` : "From X"), src, width, height, credit });
  });
  return memes.slice(0, MAX_MEMES);
}

/* ------------------------------------------------------------------ */
/* imgflip fallback                                                   */
/* ------------------------------------------------------------------ */

interface ImgflipMeme {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
  box_count: number;
}

async function fromImgflip(): Promise<TrendingMeme[]> {
  const res = await fetch("https://api.imgflip.com/get_memes", {
    signal: AbortSignal.timeout(10_000),
    next: { revalidate: 21_600 },
  });
  const body = (await res.json()) as { success?: boolean; data?: { memes?: ImgflipMeme[] } };
  if (!res.ok || !body.success || !body.data?.memes) throw new Error("imgflip unavailable");
  return body.data.memes
    .filter((m) => /^https:\/\/i\.imgflip\.com\/[a-z0-9]+\.(jpg|png)$/i.test(m.url) && m.box_count <= 4)
    .slice(0, MAX_MEMES)
    .map((m) => ({
      id: `imgflip-${m.id}`,
      imgflipId: m.id,
      title: m.name,
      src: m.url,
      width: m.width,
      height: m.height,
      credit: null,
    }));
}
