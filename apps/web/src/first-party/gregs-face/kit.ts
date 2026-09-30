/**
 * Turns a plain portrait + three rects (face.ts) into the game's assets:
 *
 *  - the blank face: every part rect is covered with a skin patch, filled by
 *    interpolating the colours just outside it (a Coons patch over the four
 *    edges, outliers like hair or shadow swapped for the median), given a
 *    whisper of grain, blurred, and feathered into the photo;
 *  - one sprite per feature: the rect cropped from the original with a
 *    feathered alpha edge, so it blends wherever it lands.
 *
 * The pixel work is plain typed-array code (`patchRect`, `featherCrop`) so
 * it's testable without a DOM; `buildFaceKit` wires it to a canvas.
 */
import { DEFAULT_FACE, PART_ORDER, type FaceConfig, type FaceRect, type PartId } from "./face";

export interface Pixels {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export interface FaceKit {
  face: FaceConfig;
  /** Assets are rendered at `scale` × the config's pixel size. */
  scale: number;
  blank: HTMLCanvasElement;
  blankUrl: string;
  sprites: Record<PartId, HTMLCanvasElement>;
  spriteUrls: Record<PartId, string>;
  /** The untouched portrait (for the pre-game and the share card). */
  photoUrl: string;
  /** Frees the object URLs. */
  dispose(): void;
}

type RGB = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (edge: number, x: number) => {
  if (edge <= 0) return x > 0 ? 1 : 0;
  const t = clamp(x / edge, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Integer rect scaled and clamped to the image. */
export function scaleRect(r: FaceRect, scale: number, width: number, height: number): FaceRect {
  const x = clamp(Math.round(r.x * scale), 0, width);
  const y = clamp(Math.round(r.y * scale), 0, height);
  return {
    x,
    y,
    w: clamp(Math.round((r.x + r.w) * scale), x, width) - x,
    h: clamp(Math.round((r.y + r.h) * scale), y, height) - y,
  };
}

/** Margin between a part rect and its patch, where the patch fades into the photo. */
export function patchPad(rect: FaceRect, scale: number): number {
  return Math.max(Math.round(3 * scale), Math.round(0.16 * Math.min(rect.w, rect.h)));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Box blur of a 1-D run of colours (edge-clamped). */
function blurLine(line: RGB[], radius: number): RGB[] {
  if (radius < 1 || line.length < 2) return line;
  return line.map((_, i) => {
    const acc: RGB = [0, 0, 0];
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      const c = line[clamp(k, 0, line.length - 1)]!;
      acc[0] += c[0];
      acc[1] += c[1];
      acc[2] += c[2];
      n++;
    }
    return [acc[0] / n, acc[1] / n, acc[2] / n];
  });
}

/** Separable box blur of an RGB float buffer, in place, `passes` times. */
function blurBuffer(buf: Float32Array, w: number, h: number, radius: number, passes = 2): void {
  if (radius < 1) return;
  const tmp = new Float32Array(buf.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) sum += buf[(y * w + clamp(x + k, 0, w - 1)) * 3 + c]!;
          tmp[(y * w + x) * 3 + c] = sum / (2 * radius + 1);
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) sum += tmp[(clamp(y + k, 0, h - 1) * w + x) * 3 + c]!;
          buf[(y * w + x) * 3 + c] = sum / (2 * radius + 1);
        }
      }
    }
  }
}

/** Deterministic per-pixel grain in [-1, 1]. */
function grain(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}

/**
 * Covers `rect` (plus `pad`) in `out` with skin interpolated from `src`'s
 * pixels just outside the padded box. `src` and `out` may be the same
 * buffer, but sampling from the untouched original keeps neighbouring
 * patches independent.
 */
export function patchRect(src: Pixels, out: Pixels, rect: FaceRect, pad: number, fallback: RGB = [240, 200, 180]): void {
  const { width: W, height: H } = src;
  const x0 = clamp(rect.x - pad, 0, W - 1);
  const y0 = clamp(rect.y - pad, 0, H - 1);
  const x1 = clamp(rect.x + rect.w + pad, x0 + 1, W); // exclusive
  const y1 = clamp(rect.y + rect.h + pad, y0 + 1, H);
  const pw = x1 - x0;
  const ph = y1 - y0;
  const band = Math.max(2, Math.round(pad / 2));

  const px = (x: number, y: number): RGB => {
    const i = (clamp(y, 0, H - 1) * W + clamp(x, 0, W - 1)) * 4;
    return [src.data[i]!, src.data[i + 1]!, src.data[i + 2]!];
  };
  const avg = (samples: RGB[]): RGB => {
    const acc: RGB = [0, 0, 0];
    for (const s of samples) {
      acc[0] += s[0];
      acc[1] += s[1];
      acc[2] += s[2];
    }
    return samples.length ? [acc[0] / samples.length, acc[1] / samples.length, acc[2] / samples.length] : fallback;
  };

  // Raw edge samples: a `band`-thick strip on each side, just outside the box.
  const strip = (count: number, at: (i: number, k: number) => [number, number]) =>
    Array.from({ length: count }, (_, i) =>
      avg(Array.from({ length: band }, (_, k) => at(i, k)).map(([x, y]) => px(x, y))),
    );
  let top = strip(pw, (i, k) => [x0 + i, y0 - 1 - k]);
  let bottom = strip(pw, (i, k) => [x0 + i, y1 + k]);
  let left = strip(ph, (i, k) => [x0 - 1 - k, y0 + i]);
  let right = strip(ph, (i, k) => [x1 + k, y0 + i]);

  // Hair, brows or shadow on an edge: anything far from the median skin tone becomes the median.
  const all = [...top, ...bottom, ...left, ...right];
  const skin: RGB = [median(all.map((c) => c[0])), median(all.map((c) => c[1])), median(all.map((c) => c[2]))];
  const dist = (c: RGB) => Math.hypot(c[0] - skin[0], c[1] - skin[1], c[2] - skin[2]);
  const spread = median(all.map(dist));
  const limit = Math.max(24, spread * 3);
  const tame = (line: RGB[]) => line.map((c) => (dist(c) > limit ? skin : c));
  const soften = Math.max(1, Math.round(Math.min(pw, ph) / 6));
  top = blurLine(tame(top), soften);
  bottom = blurLine(tame(bottom), soften);
  left = blurLine(tame(left), soften);
  right = blurLine(tame(right), soften);

  // Coons patch: blend opposite edges, minus the bilinear corner term.
  const corner = (a: RGB, b: RGB): RGB => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const c00 = corner(top[0]!, left[0]!);
  const c10 = corner(top[pw - 1]!, right[0]!);
  const c01 = corner(bottom[0]!, left[ph - 1]!);
  const c11 = corner(bottom[pw - 1]!, right[ph - 1]!);
  const grainAmp = Math.min(5, Math.max(1, spread / 3));
  const buf = new Float32Array(pw * ph * 3);
  for (let j = 0; j < ph; j++) {
    const fy = ph === 1 ? 0.5 : j / (ph - 1);
    for (let i = 0; i < pw; i++) {
      const fx = pw === 1 ? 0.5 : i / (pw - 1);
      const t = top[i]!;
      const b = bottom[i]!;
      const l = left[j]!;
      const r = right[j]!;
      const n = grain(x0 + i, y0 + j) * grainAmp;
      for (let c = 0; c < 3; c++) {
        const edges = (1 - fy) * t[c]! + fy * b[c]! + (1 - fx) * l[c]! + fx * r[c]!;
        const bilinear =
          (1 - fx) * (1 - fy) * c00[c]! + fx * (1 - fy) * c10[c]! + (1 - fx) * fy * c01[c]! + fx * fy * c11[c]!;
        buf[(j * pw + i) * 3 + c] = edges - bilinear + n;
      }
    }
  }
  blurBuffer(buf, pw, ph, Math.max(1, Math.round(pad / 4)));

  // Feather: opaque over the part rect, fading out across the pad.
  for (let j = 0; j < ph; j++) {
    const y = y0 + j;
    const dy = Math.min(y - y0 + 0.5, y1 - y - 0.5);
    for (let i = 0; i < pw; i++) {
      const x = x0 + i;
      const dx = Math.min(x - x0 + 0.5, x1 - x - 0.5);
      const a = smooth(pad, dx) * smooth(pad, dy);
      const o = (y * W + x) * 4;
      const s = (j * pw + i) * 3;
      for (let c = 0; c < 3; c++) out.data[o + c] = buf[s + c]! * a + src.data[o + c]! * (1 - a);
    }
  }
}

/**
 * Copies `rect` out of `src` with a soft oval alpha mask: solid in the middle,
 * fading out over `softness` × half the short side and fully clear in the
 * corners, so the skin around a feature melts away wherever it lands instead
 * of reading as a pasted rectangle.
 */
export function featherCrop(src: Pixels, rect: FaceRect, softness = 0.9): Pixels {
  const { x: rx, y: ry, w, h } = rect;
  const data = new Uint8ClampedArray(w * h * 4);
  const fade = Math.max(1, clamp(softness, 0, 1) * (Math.min(w, h) / 2));
  for (let j = 0; j < h; j++) {
    const ey = Math.max(0, fade - Math.min(j + 0.5, h - j - 0.5)) / fade;
    for (let i = 0; i < w; i++) {
      const ex = Math.max(0, fade - Math.min(i + 0.5, w - i - 0.5)) / fade;
      const a = 1 - smooth(1, Math.hypot(ex, ey));
      const s = ((ry + j) * src.width + (rx + i)) * 4;
      const o = (j * w + i) * 4;
      data[o] = src.data[s]!;
      data[o + 1] = src.data[s + 1]!;
      data[o + 2] = src.data[s + 2]!;
      data[o + 3] = Math.round(src.data[s + 3]! * a);
    }
  }
  return { data, width: w, height: h };
}

/* ---------------------------------------------------------------------- */
/* Browser                                                                */
/* ---------------------------------------------------------------------- */

function hexToRgb(hex: string | undefined): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return [240, 200, 180];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    if (/^https?:/i.test(src) && !src.startsWith(window.location.origin)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Couldn't load ${src}`));
    img.src = src;
  });
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function toUrl(c: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    c.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/** Rendering scale: small photos are upscaled so they stay smooth on big screens (1–4×). */
export function kitScale(face: Pick<FaceConfig, "width">): number {
  return clamp(Math.round(800 / face.width), 1, 4);
}

/** Loads the portrait and builds the blank face and the three sprites. */
export async function buildFaceKit(face: FaceConfig): Promise<FaceKit> {
  const img = await loadImage(face.src);
  const scale = kitScale(face);
  const W = Math.round(face.width * scale);
  const H = Math.round(face.height * scale);
  const base = canvas(W, H);
  const ctx = base.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No 2D canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, W, H);
  const original: Pixels = { data: ctx.getImageData(0, 0, W, H).data, width: W, height: H };
  const photoUrl = await toUrl(base);

  const blankPixels: Pixels = { data: new Uint8ClampedArray(original.data), width: W, height: H };
  const sprites = {} as Record<PartId, HTMLCanvasElement>;
  for (const id of PART_ORDER) {
    const rect = scaleRect(face.parts[id], scale, W, H);
    patchRect(original, blankPixels, rect, patchPad(rect, scale), hexToRgb(face.skin));
    const crop = featherCrop(original, rect);
    const c = canvas(crop.width, crop.height);
    c.getContext("2d")!.putImageData(new ImageData(crop.data, crop.width, crop.height), 0, 0);
    sprites[id] = c;
  }
  const blank = canvas(W, H);
  blank.getContext("2d")!.putImageData(new ImageData(blankPixels.data, W, H), 0, 0);

  const [blankUrl, ...spriteList] = await Promise.all([blank, ...PART_ORDER.map((id) => sprites[id])].map(toUrl));
  const spriteUrls = Object.fromEntries(PART_ORDER.map((id, i) => [id, spriteList[i]!])) as Record<PartId, string>;
  const urls = [photoUrl, blankUrl!, ...spriteList];
  return {
    face,
    scale,
    blank,
    blankUrl: blankUrl!,
    sprites,
    spriteUrls,
    photoUrl,
    dispose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
  };
}

/** `buildFaceKit(face)`, falling back to the shipped stand-in if the configured photo won't load. */
export async function buildFaceKitWithFallback(face: FaceConfig): Promise<FaceKit> {
  try {
    return await buildFaceKit(face);
  } catch (error) {
    if (face === DEFAULT_FACE) throw error;
    console.warn("[gregs-face] face image failed, using the stand-in", error);
    return buildFaceKit(DEFAULT_FACE);
  }
}
