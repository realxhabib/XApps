/**
 * Meme images come from a short allow list of hosts and are always loaded
 * through our own `/api/meme-image` proxy. Same-origin bytes keep canvases
 * untainted, so an entry can embed its image when it's submitted.
 */

const STORAGE_PATH = "/storage/v1/object/public/meme-drops/";

/** Hosts (and, for Supabase, the path) a meme image may come from. */
export function isAllowedMemeSource(src: string, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
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

/** The URL to put in `<img src>` or `fetch()` for a meme image. Data URLs (demo uploads) pass through. */
export function memeImageUrl(src: string): string {
  if (src.startsWith("data:image/")) return src;
  return `/api/meme-image?src=${encodeURIComponent(src)}`;
}
