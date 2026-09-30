/**
 * Greg's Face — the face everyone rebuilds. This is the ONE place to change it.
 *
 * The game never needs a hand-edited "blank" face or cut-out features: at
 * runtime it loads `src`, then
 *   - builds the blank face by covering each part rect with a soft skin patch
 *     (colours sampled from just outside the rect, feathered and blurred), and
 *   - crops each part rect out of the original as a feature sprite (feathered
 *     alpha edge).
 * So any portrait works as long as the three rects are right.
 *
 * ── Swapping in the real photo of Greg ────────────────────────────────────
 * 1. Save the photo as `apps/web/public/first-party/gregs-face/greg.jpg`
 *    (a portrait of roughly 200×190 works; bigger is better, e.g. 600×570).
 * 2. Set `src` to "/first-party/gregs-face/greg.jpg" and `width` / `height`
 *    to the photo's pixel size.
 * 3. Set the three rects in THAT photo's pixel coordinates (open it in any
 *    image editor and read the cursor position):
 *      eyes  – one box around both eyes (brows optional: leave them out and
 *              they stay on the blank face as a hint),
 *      nose  – the nose from just below the eyes to under the nostrils,
 *      mouth – the lips with a few pixels of skin around them.
 *    Keep the boxes snug, with a little skin inside every edge, and make sure
 *    they don't overlap and that there's skin just outside each one (that's
 *    what the blank patch is coloured from).
 * 4. Optional: `skin` is a fallback tone used only if sampling fails.
 * That's it: no other file changes. `npm test` checks the rects are sane.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * `FACE` is the meme photo (`greg.jpg`). `DEFAULT_FACE` is an illustrated
 * stand-in (`greg.svg`) used if the photo fails to load.
 */

export type PartId = "eyes" | "nose" | "mouth";

/** A box in image pixel coordinates (top-left origin). */
export interface FaceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceConfig {
  /** Public path (or same-origin URL) of the portrait. SVGs need width/height attributes. */
  src: string;
  /** Pixel size of the image; every rect is in these coordinates. */
  width: number;
  height: number;
  /** Who it is, for copy ("I built Greg's face 87% right"). */
  name: string;
  /** Where each feature really is. */
  parts: Record<PartId, FaceRect>;
  /** Fallback skin tone for the blank patches (CSS hex). */
  skin?: string;
}

/** The order features are dropped in. */
export const PART_ORDER: readonly PartId[] = ["eyes", "nose", "mouth"];

export const PART_LABEL: Record<PartId, string> = { eyes: "Eyes", nose: "Nose", mouth: "Mouth" };

/** The illustrated stand-in that ships with the repo. */
export const DEFAULT_FACE: FaceConfig = {
  src: "/first-party/gregs-face/greg.svg",
  width: 400,
  height: 380,
  name: "Greg",
  parts: {
    eyes: { x: 134, y: 182, w: 132, h: 32 },
    nose: { x: 176, y: 220, w: 48, h: 46 },
    mouth: { x: 170, y: 272, w: 60, h: 32 },
  },
  skin: "#f5d2bb",
};

/** Greg himself: the meme photo (200×188 original, upscaled 3× so it draws smoothly). */
export const PHOTO_FACE: FaceConfig = {
  src: "/first-party/gregs-face/greg.jpg",
  width: 600,
  height: 564,
  name: "Greg",
  parts: {
    eyes: { x: 188, y: 266, w: 200, h: 42 },
    nose: { x: 238, y: 310, w: 90, h: 114 },
    mouth: { x: 214, y: 432, w: 142, h: 36 },
  },
  skin: "#e7b49b",
};

/** The face the game uses (the cartoon stands in if the photo can't load). */
export const FACE: FaceConfig = PHOTO_FACE;

/** Problems with a face config (empty when it's usable). Pure, so tests can check `FACE`. */
export function faceConfigProblems(face: FaceConfig): string[] {
  const problems: string[] = [];
  if (!face.src) problems.push("src is empty");
  if (!(face.width > 0) || !(face.height > 0)) problems.push("width and height must be positive");
  const rects = PART_ORDER.map((id) => [id, face.parts[id]] as const);
  for (const [id, r] of rects) {
    if (!r || !(r.w > 0) || !(r.h > 0)) {
      problems.push(`${id}: the rect needs a positive size`);
      continue;
    }
    if (r.x < 0 || r.y < 0 || r.x + r.w > face.width || r.y + r.h > face.height) {
      problems.push(`${id}: the rect must sit inside the ${face.width}×${face.height} image`);
    }
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [ia, a] = rects[i]!;
      const [ib, b] = rects[j]!;
      if (!a || !b) continue;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        problems.push(`${ia} and ${ib} overlap`);
      }
    }
  }
  return problems;
}
