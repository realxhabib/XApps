/**
 * Meme images come from a short allow list of hosts and are always loaded
 * through our own `/api/meme-image` proxy. Same-origin bytes keep canvases
 * untainted, so an entry can embed its image when it's submitted.
 *
 * Drops uploaded with `media.upload` (Stage 3) are accepted too: `app-media`
 * public URLs go through the proxy, demo-media paths are already same-origin.
 */
import { demoMediaId, isAppMediaUrl } from "./media";

const STORAGE_PATH = "/storage/v1/object/public/meme-drops/";

/** Hosts (and, for Supabase, the path) a meme image may come from. */
export function isAllowedMemeSource(src: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (supabaseUrl && isAppMediaUrl(src, supabaseUrl) && mediaIsImage(url.pathname)) return true;
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  if (url.hostname === "i.imgflip.com") return /^\/(?:[24]\/)?[a-z0-9]+\.(jpg|jpeg|png|gif)$/i.test(url.pathname);
  if (url.hostname === "pbs.twimg.com") return url.pathname.startsWith("/media/");
  if (supabaseUrl) {
    try {
      const base = new URL(supabaseUrl);
      return url.hostname === base.hostname && url.pathname.startsWith(STORAGE_PATH);
    } catch {
      return false;
    }
  }
  return false;
}

/** Uploaded media in the `app-media` bucket may be audio or video; only images are memes. */
function mediaIsImage(pathname: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(pathname);
}

/** The URL to put in `<img src>` or `fetch()` for a meme image. Data URLs and demo uploads pass through. */
export function memeImageUrl(src: string): string {
  if (src.startsWith("data:image/")) return src;
  const demoId = demoMediaId(src);
  if (demoId) return `/api/demo-media/${demoId}`;
  return `/api/meme-image?src=${encodeURIComponent(src)}`;
}

/** A link that downloads the original image (for remixing in another editor). Null for data URLs. */
export function memeDownloadUrl(src: string): string | null {
  if (src.startsWith("data:")) return null;
  const demoId = demoMediaId(src);
  if (demoId) return `/api/demo-media/${demoId}?download=1`;
  return `/api/meme-image?src=${encodeURIComponent(src)}&download=1`;
}
