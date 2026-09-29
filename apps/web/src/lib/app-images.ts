import { env } from "./env";

/**
 * Listing images for community apps: a square icon (shown instead of the
 * emoji) and a 16:9 cover (the art on cards and the app page).
 *
 * Manifests store an image *key*, never a URL, so every image comes from our
 * storage and passes review exactly as players will see it:
 *  - Supabase: `<uploader id>/<32 hex>.webp|jpg|png` in the public
 *    `app-images` bucket, which only allows inserts (no overwrite, no delete).
 *  - Demo mode: the processed image itself, as a small `data:` URL, so it
 *    survives dev-server restarts inside the demo database.
 */

export type AppImageKind = "icon" | "cover";

export const APP_IMAGES_BUCKET = "app-images";

/** Output sizes: icons are square, covers 16:9. Both are center-cropped. */
export const APP_IMAGE_SIZE: Record<AppImageKind, { width: number; height: number }> = {
  icon: { width: 512, height: 512 },
  cover: { width: 1600, height: 900 },
};

/** Uploads per developer per rolling 24 h. Mirrors `app_image_quota_ok`. */
export const APP_IMAGE_UPLOADS_PER_DAY = 40;
/** Stored bytes (after processing). Mirrors the bucket's file_size_limit. */
export const APP_IMAGE_MAX_BYTES = 1_500_000;
/** Demo keys are data URLs: base64 of at most ~300 KB. */
export const DEMO_APP_IMAGE_MAX_CHARS = 400_000;

/** Mirrors the `app_image_key_ok` SQL check. */
export const STORAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{32}\.(webp|jpg|png)$/;
const DATA_KEY_PATTERN = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Accepted uploads (before processing). */
export const APP_IMAGE_INPUT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"];

/** null when `key` is a valid image key (or absent), else a message. `demo` also allows data URLs. */
export function appImageKeyError(key: unknown, { demo = false }: { demo?: boolean } = {}): string | null {
  if (key === undefined || key === null) return null;
  if (typeof key !== "string") return "Images must be uploaded";
  if (STORAGE_KEY_PATTERN.test(key)) return null;
  if (demo && key.length <= DEMO_APP_IMAGE_MAX_CHARS && DATA_KEY_PATTERN.test(key)) return null;
  return "Images must be uploaded through XApps";
}

/** Where to load an image key from, or null when it isn't one. */
export function appImageSrc(key: string | null | undefined, supabaseUrl = env.supabaseUrl): string | null {
  if (!key) return null;
  if (DATA_KEY_PATTERN.test(key) && key.length <= DEMO_APP_IMAGE_MAX_CHARS) return key;
  if (STORAGE_KEY_PATTERN.test(key) && supabaseUrl) return `${supabaseUrl}/storage/v1/object/public/${APP_IMAGES_BUCKET}/${key}`;
  return null;
}

/**
 * Browser-side: center-crops and scales an uploaded image to its kind's size
 * and re-encodes it (WebP, else JPEG). Only pixels survive the canvas, so
 * metadata (like location) is dropped and anything that isn't a plain image
 * fails here. Transparent icons keep their transparency in WebP.
 */
export async function processAppImage(file: Blob, kind: AppImageKind): Promise<Blob> {
  if (!APP_IMAGE_INPUT_TYPES.includes(file.type)) throw new Error("Use a PNG, JPEG, WebP or GIF image");
  if (file.size > 20_000_000) throw new Error("That image is over 20 MB");
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image");
  }
  try {
    const { width, height } = APP_IMAGE_SIZE[kind];
    const minSide = kind === "icon" ? 128 : 480;
    if (Math.min(bitmap.width, bitmap.height) < Math.min(minSide, height)) {
      throw new Error(kind === "icon" ? "Icons need to be at least 128 × 128" : "Covers need to be at least 480 pixels tall");
    }
    // Largest centered crop with the target aspect ratio.
    const target = width / height;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (sw / sh > target) sw = Math.round(sh * target);
    else sh = Math.round(sw / target);
    const sx = Math.round((bitmap.width - sw) / 2);
    const sy = Math.round((bitmap.height - sh) / 2);
    const scale = Math.min(1, width / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that image");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.7, 0.55]) {
      const blob = await encode(canvas, "image/webp", quality);
      const out = blob && blob.type === "image/webp" ? blob : await encode(canvas, "image/jpeg", quality);
      if (out && out.size <= targetBytes(kind)) return out;
    }
    throw new Error("Couldn't make that image small enough. Try a simpler one");
  } finally {
    bitmap.close();
  }
}

/** Icons stay small; demo mode keeps images in the browser, so it gets a tighter budget. */
function targetBytes(kind: AppImageKind): number {
  return kind === "icon" ? 200_000 : 280_000;
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** A processed image as a data URL (demo keys). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that image"));
    reader.readAsDataURL(blob);
  });
}
