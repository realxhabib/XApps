/**
 * Reads public X posts through X's embed data (what embedded posts use), which
 * needs no API key. Server-side only.
 */

export interface XPostPhoto {
  src: string;
  width: number;
  height: number;
  credit: { handle: string; url: string } | null;
  text: string;
}

export class XPostError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface SyndicationTweet {
  __typename?: string;
  text?: string;
  possibly_sensitive?: boolean;
  user?: { screen_name?: string };
  photos?: { url?: string; width?: number; height?: number }[];
  mediaDetails?: { type?: string; media_url_https?: string; original_info?: { width?: number; height?: number } }[];
}

/** The post id from an x.com / twitter.com status link, or null. */
export function xPostId(link: string): string | null {
  try {
    const url = new URL(link.trim());
    if (!/^(www\.|mobile\.)?(x|twitter)\.com$/.test(url.hostname)) return null;
    return url.pathname.match(/^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d{5,25})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The token X's embed endpoint expects, derived from the post id. */
function embedToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

/** The first photo of a public, non-sensitive post. Throws XPostError with a friendly message. */
export async function fetchXPostPhoto(id: string): Promise<XPostPhoto> {
  let tweet: SyndicationTweet;
  try {
    const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${embedToken(id)}&lang=en`, {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 3600 },
    });
    if (res.status === 404) throw new XPostError("That post doesn't exist or isn't public.", 404);
    if (!res.ok) throw new XPostError("X didn't answer. Try again in a moment.", 502);
    tweet = (await res.json()) as SyndicationTweet;
  } catch (error) {
    if (error instanceof XPostError) throw error;
    throw new XPostError("X didn't answer. Try again in a moment.", 502);
  }
  if (tweet.__typename && tweet.__typename !== "Tweet") throw new XPostError("That post isn't available.", 404);
  if (tweet.possibly_sensitive) throw new XPostError("That post is marked sensitive, so it can't be used here.", 422);

  const photo =
    tweet.photos?.find((p) => p.url?.startsWith("https://pbs.twimg.com/media/")) ??
    tweet.mediaDetails
      ?.filter((m) => m.type === "photo" && m.media_url_https?.startsWith("https://pbs.twimg.com/media/"))
      .map((m) => ({ url: m.media_url_https, width: m.original_info?.width, height: m.original_info?.height }))[0];
  if (!photo?.url || !photo.width || !photo.height) throw new XPostError("That post has no photo to caption.", 422);

  const handle = tweet.user?.screen_name ?? "";
  return {
    src: photo.url,
    width: photo.width,
    height: photo.height,
    credit: handle ? { handle, url: `https://x.com/${handle}/status/${id}` } : null,
    text: (tweet.text ?? "").slice(0, 280),
  };
}
