/**
 * Stage 3 media rules shared by both backends, the demo media route, the
 * host bridge and EntryView: which files an app may upload (`LIMITS.media`),
 * where uploads live, and which URLs the platform accepts as media anywhere
 * (entries, meme drops, state). `isAllowedMediaUrl()` is the single check.
 */
import { LIMITS, type MediaRef, type SubmissionDisplay } from "@xapps/sdk";
import { env, isSupabaseConfigured } from "./env";

export type MediaKind = MediaRef["kind"];

export const APP_MEDIA_BUCKET = "app-media";
const APP_MEDIA_PREFIX = `/storage/v1/object/public/${APP_MEDIA_BUCKET}/`;
/** `<app_slug>/<user_id>/<file>` inside the bucket (the path rule of `record_media_upload`). */
const APP_MEDIA_OBJECT = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]\/[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Demo-mode uploads are served by `/api/demo-media/<id>` (32 hex chars). */
export const DEMO_MEDIA_PREFIX = "/api/demo-media/";
export const DEMO_MEDIA_ID = /^[0-9a-f]{32}$/;

const KIND_LABEL: Record<MediaKind, string> = { image: "Images", audio: "Audio files", video: "Videos" };

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "weba",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** `"video/mp4; codecs=avc1"` → `"video/mp4"`. */
export function baseMime(type: string | null | undefined): string {
  return (type ?? "").split(";")[0]!.trim().toLowerCase();
}

/** The media kind for an allowed MIME type, or null when uploads of that type aren't allowed. */
export function mediaKindOf(mime: string | null | undefined): MediaKind | null {
  const clean = baseMime(mime);
  for (const kind of ["image", "audio", "video"] as const) {
    if ((LIMITS.media[kind].mimes as readonly string[]).includes(clean)) return kind;
  }
  return null;
}

export function mediaExtension(mime: string): string {
  return EXTENSIONS[baseMime(mime)] ?? "bin";
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** Why a file can't be uploaded (type or size), or null when it's fine. */
export function mediaProblem(mime: string | null | undefined, bytes: number): string | null {
  const kind = mediaKindOf(mime);
  if (!kind) {
    return `Uploads must be images (JPEG, PNG, WebP, GIF), audio (MP3, M4A, Ogg, WebM, WAV) or video (MP4, WebM, MOV)${mime ? `, not ${baseMime(mime)}` : ""}`;
  }
  if (!Number.isFinite(bytes) || bytes <= 0) return "That file is empty";
  const max = LIMITS.media[kind].maxBytes;
  if (bytes > max) return `${KIND_LABEL[kind]} can be up to ${megabytes(max)}`;
  return null;
}

/** Why another upload would exceed the rolling 24 h quota (per user per app), or null. */
export function mediaQuotaProblem(recent: { bytes: number }[], nextBytes: number): string | null {
  if (recent.length >= LIMITS.media.uploadsPerDay) {
    return `Upload limit reached: ${LIMITS.media.uploadsPerDay} files per app per day`;
  }
  const used = recent.reduce((sum, r) => sum + r.bytes, 0);
  if (used + nextBytes > LIMITS.media.bytesPerDay) {
    return `Upload limit reached: ${megabytes(LIMITS.media.bytesPerDay)} per app per day`;
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* Allowed media URLs                                                     */
/* ---------------------------------------------------------------------- */

export interface MediaUrlOptions {
  /** Supabase project URL (default: NEXT_PUBLIC_SUPABASE_URL). */
  supabaseUrl?: string;
  /** Origin that serves `/api/demo-media` (default: the current page's origin). */
  origin?: string | null;
  /** Accept demo-media URLs (default: only when Supabase isn't configured). */
  demo?: boolean;
}

function currentOrigin(): string | null {
  const location = (globalThis as { location?: { origin?: string } }).location;
  return typeof location?.origin === "string" ? location.origin : null;
}

/** The demo upload id in `/api/demo-media/<id>` (relative, or absolute on `origin`), else null. */
export function demoMediaId(src: string, origin: string | null = currentOrigin()): string | null {
  if (typeof src !== "string") return null;
  let path: string;
  if (src.startsWith(DEMO_MEDIA_PREFIX)) {
    path = src;
  } else {
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return null;
    }
    if (!origin || url.origin !== origin || url.search || url.hash || url.username || url.password) return null;
    path = url.pathname;
  }
  if (!path.startsWith(DEMO_MEDIA_PREFIX)) return null;
  const id = path.slice(DEMO_MEDIA_PREFIX.length);
  return DEMO_MEDIA_ID.test(id) ? id : null;
}

/** True for a public URL of an object in our `app-media` bucket. */
export function isAppMediaUrl(src: string, supabaseUrl = env.supabaseUrl): boolean {
  if (typeof src !== "string" || !supabaseUrl) return false;
  let url: URL;
  let base: URL;
  try {
    url = new URL(src);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) return false;
  if (!url.pathname.startsWith(APP_MEDIA_PREFIX)) return false;
  return APP_MEDIA_OBJECT.test(url.pathname.slice(APP_MEDIA_PREFIX.length));
}

/** An uploaded image's object key (`<app_slug>/<user_id>/<file>`) that X can show as a card. */
const SHAREABLE_IMAGE = /\.(png|jpe?g|webp|gif)$/i;

export function isShareableImageKey(key: string): boolean {
  return typeof key === "string" && APP_MEDIA_OBJECT.test(key) && SHAREABLE_IMAGE.test(key);
}

/** The object key of an `app-media` image URL, or null (other URLs, audio and video). */
export function shareableImageKey(src: string, supabaseUrl = env.supabaseUrl): string | null {
  if (!isAppMediaUrl(src, supabaseUrl)) return null;
  const key = new URL(src).pathname.slice(APP_MEDIA_PREFIX.length);
  return isShareableImageKey(key) ? key : null;
}

/** Public URL of an `app-media` object key (null without Supabase). */
export function appMediaPublicUrl(key: string, supabaseUrl = env.supabaseUrl): string | null {
  return supabaseUrl ? `${supabaseUrl}${APP_MEDIA_PREFIX}${key}` : null;
}

/**
 * The URL to post to X for `social.share`: an uploaded image becomes our
 * `/s/<key>` page, whose card metadata shows the image (X only renders a card
 * for pages with og/twitter tags, never for a bare image URL).
 */
export function shareLinkFor(url: string | undefined, origin: string, supabaseUrl = env.supabaseUrl): string | undefined {
  if (!url) return url;
  const key = shareableImageKey(url, supabaseUrl);
  return key ? `${origin}/s/${key}` : url;
}

/**
 * The single check for media URLs the platform accepts (entries, meme drops,
 * state): our `app-media` public URLs, and `/api/demo-media/<id>` in demo mode.
 */
export function isAllowedMediaUrl(src: string, options: MediaUrlOptions = {}): boolean {
  const supabaseUrl = options.supabaseUrl ?? env.supabaseUrl;
  if (isAppMediaUrl(src, supabaseUrl)) return true;
  const demo = options.demo ?? (options.supabaseUrl !== undefined ? !supabaseUrl : !isSupabaseConfigured);
  return demo && demoMediaId(src, options.origin === undefined ? currentOrigin() : options.origin) !== null;
}

/** Makes a demo-media path absolute so apps on other origins can load it too. */
export function absoluteMediaUrl(src: string, origin: string | null = currentOrigin()): string {
  if (!origin || !src.startsWith("/")) return src;
  return new URL(src, origin).toString();
}

/* ---------------------------------------------------------------------- */
/* Entry displays                                                         */
/* ---------------------------------------------------------------------- */

const MAX_ALT = 300;

function altProblem(alt: unknown, what: string): string | null {
  if (typeof alt !== "string" || !alt.trim()) return `${what} needs alt text`;
  return alt.length > MAX_ALT ? `${what} alt text must be at most ${MAX_ALT} characters` : null;
}

/**
 * Checks the media URLs of an entry's display (the submit paths of both
 * backends). Video, audio and gallery media must be files uploaded with
 * `media.upload`; images keep the v1 rule (any https URL) or an upload.
 */
export function displayProblem(display: SubmissionDisplay | null | undefined, options: MediaUrlOptions = {}): string | null {
  if (!display) return null;
  const allowed = (url: unknown): url is string => typeof url === "string" && isAllowedMediaUrl(url, options);
  const upload = "must be a file uploaded with xapps.media.upload()";
  switch (display.kind) {
    case "text":
    case "svg":
      return null;
    case "image":
      if (typeof display.url !== "string" || !(allowed(display.url) || /^https:\/\//.test(display.url))) {
        return "Image entries need an https URL or a file uploaded with xapps.media.upload()";
      }
      return null;
    case "video":
      if (!allowed(display.url)) return `Video entries ${upload}`;
      if (display.poster !== undefined && !allowed(display.poster)) return `A video poster ${upload}`;
      return altProblem(display.alt, "A video");
    case "audio":
      if (!allowed(display.url)) return `Audio entries ${upload}`;
      if (display.cover !== undefined && !allowed(display.cover)) return `An audio cover ${upload}`;
      return altProblem(display.alt, "An audio entry");
    case "gallery": {
      const items = display.items;
      const { min, max } = LIMITS.galleryItems;
      if (!Array.isArray(items) || items.length < min || items.length > max) return `A gallery has ${min}–${max} images`;
      for (const item of items) {
        if (!item || typeof item !== "object" || !allowed(item.url)) return `Gallery images ${upload}`;
        const alt = altProblem(item.alt, "Every gallery image");
        if (alt) return alt;
      }
      return null;
    }
    default:
      return "Unknown entry kind";
  }
}

/* ---------------------------------------------------------------------- */
/* Magic bytes (demo media route)                                         */
/* ---------------------------------------------------------------------- */

const ascii = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

/**
 * True when the file's first bytes plausibly match its declared type, so a
 * page can't be uploaded as "image/png". Deliberately loose within a family
 * (an MP4 container may hold audio or video).
 */
export function bytesMatchMime(bytes: Uint8Array, mime: string): boolean {
  const type = baseMime(mime);
  if (bytes.length < 12) return false;
  switch (type) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/png":
      return bytes[0] === 0x89 && ascii(bytes, 1, "PNG");
    case "image/gif":
      return ascii(bytes, 0, "GIF8");
    case "image/webp":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP");
    case "audio/wav":
      return ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WAVE");
    case "audio/ogg":
      return ascii(bytes, 0, "OggS");
    case "audio/webm":
    case "video/webm":
      return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    case "audio/mp4":
    case "video/mp4":
    case "video/quicktime":
      return ascii(bytes, 4, "ftyp") || ascii(bytes, 4, "moov") || ascii(bytes, 4, "mdat") || ascii(bytes, 4, "wide") || ascii(bytes, 4, "free");
    case "audio/mpeg":
      // ID3 tag, or an MPEG frame sync.
      return ascii(bytes, 0, "ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    default:
      return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Browser helpers                                                        */
/* ---------------------------------------------------------------------- */

/** Width/height for images, duration (seconds) for audio/video. Best effort: `{}` when it can't tell. */
export async function probeMedia(file: Blob, kind: MediaKind): Promise<Pick<MediaRef, "width" | "height" | "duration">> {
  try {
    if (kind === "image") {
      if (typeof createImageBitmap !== "function") return {};
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    }
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return {};
    const url = URL.createObjectURL(file);
    try {
      const element = document.createElement(kind);
      element.preload = "metadata";
      element.muted = true;
      const meta = await new Promise<{ duration?: number; width?: number; height?: number }>((resolve) => {
        const timer = setTimeout(() => resolve({}), 5_000);
        element.onloadedmetadata = () => {
          clearTimeout(timer);
          const video = kind === "video" ? (element as HTMLVideoElement) : null;
          resolve({
            duration: Number.isFinite(element.duration) ? Math.round(element.duration * 100) / 100 : undefined,
            width: video?.videoWidth || undefined,
            height: video?.videoHeight || undefined,
          });
        };
        element.onerror = () => {
          clearTimeout(timer);
          resolve({});
        };
        element.src = url;
      });
      element.removeAttribute("src");
      return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return {};
  }
}

/** Uploads a file to the demo media route (demo mode only). Returns its path. */
export async function postDemoMedia(file: Blob): Promise<{ id: string; url: string }> {
  const response = await fetch(DEMO_MEDIA_PREFIX.slice(0, -1), {
    method: "POST",
    headers: { "content-type": baseMime(file.type) || "application/octet-stream" },
    body: file,
  });
  const body = (await response.json().catch(() => null)) as { id?: string; url?: string; error?: { message?: string } } | null;
  if (!response.ok || !body?.id || !body.url) {
    throw new Error(body?.error?.message ?? `Upload failed (${response.status})`);
  }
  return { id: body.id, url: body.url };
}

/* ---------------------------------------------------------------------- */
/* Stat values                                                            */
/* ---------------------------------------------------------------------- */

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** Formats a stat value per its manifest `format` (`percent` values are 0–100). */
export function formatStat(value: number, format: "number" | "ms" | "percent" = "number"): string {
  if (!Number.isFinite(value)) return "–";
  if (format === "percent") return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value)}%`;
  if (format === "ms") {
    const sign = value < 0 ? "-" : "";
    const ms = Math.abs(value);
    if (ms < 1000) return `${sign}${Math.round(ms)} ms`;
    if (ms < 60_000) return `${sign}${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = (ms % 60_000) / 1000;
    if (minutes < 60) return `${sign}${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
    return `${sign}${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return numberFormat.format(value);
}
