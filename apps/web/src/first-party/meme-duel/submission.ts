/**
 * Browser side of photo entries: loads the round's image through the
 * same-origin proxy, encodes it as a small JPEG and builds a self-contained
 * submission that fits the size budget. Encodings are cached per image, so
 * the bot's entry and a retried submit reuse the work.
 */
import type { Submission } from "@xapps/sdk";
import { memeImageUrl } from "@/lib/meme-image";
import { ENCODE_LADDER, fitToBudget, ladderFor, scaleToFit, submissionBytes, type EncodeStep } from "./budget";
import { entryAlt, entryToJson } from "./logic";
import { renderMemeSvg } from "./render";
import type { MemeRound } from "./round";
import type { MemeEntry, MemePhoto, MemeTemplate } from "./templates";

/** The URL the editor and encoder load. A retry adds a throwaway param so a failed fetch isn't reused. */
export function photoUrl(src: string, attempt = 0): string {
  const url = memeImageUrl(src);
  return attempt > 0 && !url.startsWith("data:") ? `${url}&r=${attempt}` : url;
}

const sources = new Map<string, Promise<HTMLImageElement>>();
const encodings = new Map<string, string>();

/** Cache key for an image: remix uploads are long data: URLs, so key those by a short fingerprint. */
function cacheKey(src: string): string {
  return src.startsWith("data:") ? `data:${src.length}:${src.slice(-48)}` : src;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => (img.naturalWidth > 0 ? resolve(img) : reject(new Error("empty image")));
    img.onerror = () => reject(new Error("image failed to load"));
    img.src = url;
  });
}

/** The decoded image for a photo (cached; a failure is forgotten so the next call retries). */
export function photoSource(photo: MemePhoto, attempt = 0): Promise<HTMLImageElement> {
  const key = cacheKey(photo.src);
  const cached = sources.get(key);
  if (cached) return cached;
  const promise = loadImage(photoUrl(photo.src, attempt));
  sources.set(key, promise);
  promise.catch(() => {
    if (sources.get(key) === promise) sources.delete(key);
  });
  return promise;
}

/** The editor already loaded this image: reuse its element instead of fetching again. */
export function primePhotoSource(photo: MemePhoto, img: HTMLImageElement): void {
  if (!img.complete || img.naturalWidth === 0) return;
  const key = cacheKey(photo.src);
  if (!sources.has(key)) sources.set(key, Promise.resolve(img));
}

/** JPEG data URL of the image at one ladder step (cached). */
export function encodePhoto(img: HTMLImageElement, src: string, step: EncodeStep): string {
  const size = scaleToFit(img.naturalWidth, img.naturalHeight, step.side);
  const key = `${cacheKey(src)}|${size.width}x${size.height}|${step.quality}`;
  const hit = encodings.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d canvas");
  // Transparent PNGs/GIFs get the same dark backdrop as the letterbox.
  ctx.fillStyle = "#0b0b10";
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size.width, size.height);
  const url = canvas.toDataURL("image/jpeg", step.quality);
  if (!url.startsWith("data:image/jpeg;base64,")) throw new Error("jpeg encoding unsupported");
  encodings.set(key, url);
  return url;
}

/**
 * Loads and encodes the first ladder step in the background (right after the
 * editor shows the image) so locking in is instant.
 */
export function warmPhoto(photo: MemePhoto): void {
  photoSource(photo)
    .then((img) => {
      const run = () => {
        try {
          encodePhoto(img, photo.src, ladderFor(img.naturalWidth, img.naturalHeight)[0] ?? ENCODE_LADDER[0]!);
        } catch {
          // Submitting retries (and reports) this.
        }
      };
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 200);
    })
    .catch(() => {});
}

export interface BuiltSubmission {
  submission: Required<Pick<Submission, "data" | "display">>;
  svg: string;
  alt: string;
  bytes: number;
}

/**
 * The entry as submitted: `data` stays small (ids, captions, stickers,
 * positions) and `display` is a self-contained SVG with the photo embedded.
 * A remix embeds the player's upload the same way (never in `data`).
 * `handle` is the author's, for a remix's alt text.
 */
export async function buildSubmission(
  entry: MemeEntry,
  template: MemeTemplate,
  round: MemeRound,
  handle?: string,
): Promise<BuiltSubmission> {
  const alt = entryAlt(entry, template, round.topic, handle);
  const data = entryToJson(entry, template, round);
  const make = (imageHref?: string) => {
    const svg = renderMemeSvg(entry, { template, imageHref, title: alt });
    return { submission: { data, display: { kind: "svg" as const, svg, alt } }, svg, alt, bytes: 0 };
  };
  if (!template.photo) {
    const built = make();
    return { ...built, bytes: submissionBytes(built.submission) };
  }
  const photo = template.photo;
  const img = await photoSource(photo);
  const fitted = await fitToBudget(
    ladderFor(img.naturalWidth, img.naturalHeight),
    (step) => encodePhoto(img, photo.src, step),
    make,
    undefined,
    (built) => submissionBytes(built.submission),
  );
  return { ...fitted.value, bytes: fitted.bytes };
}
