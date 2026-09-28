/**
 * Remixes: a player swaps the round's template for their own finished image
 * (made in whatever editor they like). The remix is theirs alone: the
 * opponent keeps captioning the round's template, and the entry records which
 * template it remixes but never the uploaded bytes (those are embedded in the
 * display SVG through the usual size budget).
 *
 * Uploads are never used as-is: the file is decoded with createImageBitmap
 * and re-encoded as a JPEG on a canvas, which drops EXIF/metadata and
 * anything that isn't pixels.
 */
import { scaleToFit } from "./budget";
import { fitCanvas } from "./canvas";
import { PHOTO_BACKGROUND } from "./photo-templates";
import type { CaptionSlot, MemeTemplate } from "./templates";

export const REMIX_TEMPLATE_ID = "remix";
export const REMIX_CAPTION_ID = "remix-caption";
/** Biggest file we'll try to decode. */
export const REMIX_MAX_BYTES = 15 * 1024 * 1024;
/** Longest side kept for the editor (the entry itself is re-encoded smaller on submit). */
export const REMIX_DISPLAY_SIDE = 1080;
const REMIX_QUALITY = 0.88;
const MIN_SIDE = 16;

export interface RemixImage {
  /** Changes with every upload (keys the editor's image). */
  id: number;
  /** `data:image/jpeg;base64,…`, already downscaled and stripped. */
  src: string;
  width: number;
  height: number;
}

export type RemixProblem = "type" | "size" | "decode" | "tiny";

export class RemixError extends Error {
  constructor(readonly problem: RemixProblem) {
    super(`remix upload rejected: ${problem}`);
  }
}

export function remixProblemMessage(problem: RemixProblem): string {
  switch (problem) {
    case "type":
      return "That's not an image — try a JPG, PNG, WebP or GIF";
    case "size":
      return "That image is over 15 MB — try a smaller one";
    case "tiny":
      return "That image is too small to remix";
    default:
      return "Couldn't read that image — try another one";
  }
}

/** Cheap checks before decoding: raster images only (no SVG), at most 15 MB. */
export function checkRemixFile(file: { type: string; size: number }): RemixProblem | null {
  const type = file.type.toLowerCase();
  if (!type.startsWith("image/") || type.includes("svg")) return "type";
  if (file.size > REMIX_MAX_BYTES) return "size";
  if (file.size <= 0) return "decode";
  return null;
}

/** The first image among pasted/dropped files (null when there's none). */
export function firstImageFile<T extends { type: string }>(files: ArrayLike<T> | null | undefined): T | null {
  if (!files) return null;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file && file.type.toLowerCase().startsWith("image/")) return file;
  }
  return null;
}

/** An optional caption for a remix: classic bottom text, hidden until they type. */
function remixCaption(h: number): CaptionSlot {
  return {
    id: REMIX_CAPTION_ID,
    label: "Extra caption",
    placeholder: "optional — your image is the meme",
    x: 300,
    y: h - 14,
    width: 568,
    maxLines: 2,
    size: h < 400 ? 38 : 44,
    align: "middle",
    valign: "bottom",
    style: "impact",
    maxLength: 70,
  };
}

/** The player's image standing in for `base`: its own canvas (same aspect rules as drops) and one optional caption. */
export function remixTemplate(base: MemeTemplate, image: Pick<RemixImage, "src" | "width" | "height">): MemeTemplate {
  const canvas = fitCanvas(image.width, image.height);
  return {
    id: REMIX_TEMPLATE_ID,
    name: base.name,
    background: PHOTO_BACKGROUND,
    scene: [],
    slots: [remixCaption(canvas.height)],
    canvas,
    photo: { src: image.src, width: image.width, height: image.height },
    remixOf: base,
  };
}

let remixSeq = 0;

/**
 * Decodes an uploaded image and re-encodes it as a JPEG (≤ REMIX_DISPLAY_SIDE
 * on its long side, EXIF orientation applied, metadata dropped). Throws a
 * RemixError for anything that isn't a usable raster image.
 */
export async function readRemixFile(file: Blob): Promise<RemixImage> {
  const problem = checkRemixFile(file);
  if (problem) throw new RemixError(problem);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new RemixError("decode");
  }
  try {
    if (bitmap.width < MIN_SIDE || bitmap.height < MIN_SIDE) throw new RemixError("tiny");
    const size = scaleToFit(bitmap.width, bitmap.height, REMIX_DISPLAY_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new RemixError("decode");
    // Transparent PNGs get the same dark backdrop as letterboxed photos.
    ctx.fillStyle = PHOTO_BACKGROUND[0];
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    const src = canvas.toDataURL("image/jpeg", REMIX_QUALITY);
    if (!src.startsWith("data:image/jpeg;base64,")) throw new RemixError("decode");
    remixSeq += 1;
    return { id: remixSeq, src, width: size.width, height: size.height };
  } finally {
    bitmap.close();
  }
}
