import type { NextRequest } from "next/server";

/**
 * Turns an X post link into its first photo, so a challenger can drop a meme
 * straight from their timeline. Uses X's public embed data (the same source
 * as embedded posts), which needs no API key.
 */

interface SyndicationPhoto {
  url?: string;
  width?: number;
  height?: number;
}

interface SyndicationTweet {
  __typename?: string;
  id_str?: string;
  text?: string;
  possibly_sensitive?: boolean;
  user?: { screen_name?: string };
  photos?: SyndicationPhoto[];
  mediaDetails?: { type?: string; media_url_https?: string; original_info?: { width?: number; height?: number } }[];
}

function postId(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/^\/[A-Za-z0-9_]{1,15}\/status(?:es)?\/(\d{5,25})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The token X's embed endpoint expects, derived from the post id. */
function embedToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

function error(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const id = postId(request.nextUrl.searchParams.get("url") ?? "");
  if (!id) return error("Paste a link to an X post, like x.com/someone/status/123…");

  let tweet: SyndicationTweet;
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${embedToken(id)}&lang=en`, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 3600 },
    });
    if (res.status === 404) return error("That post doesn't exist or isn't public.", 404);
    if (!res.ok) return error("X didn't answer. Try again in a moment.", 502);
    tweet = (await res.json()) as SyndicationTweet;
  } catch {
    return error("X didn't answer. Try again in a moment.", 502);
  }
  if (tweet.__typename && tweet.__typename !== "Tweet") return error("That post isn't available.", 404);
  if (tweet.possibly_sensitive) return error("That post is marked sensitive, so it can't be used here.", 422);

  const photo =
    tweet.photos?.find((p) => p.url?.startsWith("https://pbs.twimg.com/media/")) ??
    tweet.mediaDetails
      ?.filter((m) => m.type === "photo" && m.media_url_https?.startsWith("https://pbs.twimg.com/media/"))
      .map((m) => ({ url: m.media_url_https, width: m.original_info?.width, height: m.original_info?.height }))[0];
  if (!photo?.url || !photo.width || !photo.height) return error("That post has no photo to caption.", 422);

  const handle = tweet.user?.screen_name ?? "";
  return Response.json(
    {
      src: photo.url,
      width: photo.width,
      height: photo.height,
      credit: handle ? { handle, url: `https://x.com/${handle}/status/${id}` } : null,
      text: (tweet.text ?? "").slice(0, 280),
    },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=3600" } },
  );
}
