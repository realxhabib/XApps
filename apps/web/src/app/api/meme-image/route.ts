import type { NextRequest } from "next/server";
import { isAllowedMemeSource } from "@/lib/meme-image";

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Serves meme images from allow-listed hosts (imgflip templates, X photos,
 * our Supabase bucket) same-origin, so the Meme Duel canvas can read them.
 */
export async function GET(request: NextRequest) {
  const src = request.nextUrl.searchParams.get("src") ?? "";
  if (!isAllowedMemeSource(src)) return new Response("Image source not allowed", { status: 400 });

  let upstream: Response;
  try {
    upstream = await fetch(src, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    return new Response("Couldn't fetch image", { status: 502 });
  }
  const type = upstream.headers.get("content-type") ?? "";
  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (!upstream.ok || !/^image\/(jpeg|png|gif|webp)$/.test(type.split(";")[0].trim()) || length > MAX_BYTES) {
    return new Response("Not an image", { status: 502 });
  }
  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response("Image too large", { status: 413 });

  return new Response(body, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
