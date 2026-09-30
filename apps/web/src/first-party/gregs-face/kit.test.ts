import { describe, expect, it } from "vitest";
import { DEFAULT_FACE } from "./face";
import { featherCrop, kitScale, patchPad, patchRect, scaleRect, type Pixels } from "./kit";

const SKIN = [230, 180, 150] as const;

/** A skin-coloured image with a dark "feature" box and a band of "hair" along the top. */
function portrait(): Pixels {
  const width = 60;
  const height = 60;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const feature = x >= 20 && x < 40 && y >= 25 && y < 35;
      const hair = y < 18;
      const [r, g, b] = feature ? [20, 20, 30] : hair ? [180, 80, 30] : SKIN;
      data.set([r, g, b, 255], i);
    }
  }
  return { data, width, height };
}

const at = (p: Pixels, x: number, y: number) => Array.from(p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 4));

describe("blank face patch", () => {
  it("covers the feature with the surrounding skin, even next to hair", () => {
    const src = portrait();
    const out: Pixels = { ...src, data: new Uint8ClampedArray(src.data) };
    patchRect(src, out, { x: 20, y: 25, w: 20, h: 10 }, 4);
    for (const [x, y] of [
      [30, 30],
      [21, 26],
      [38, 33],
    ] as const) {
      const [r, g, b] = at(out, x, y);
      expect(Math.abs(r! - SKIN[0])).toBeLessThan(10);
      expect(Math.abs(g! - SKIN[1])).toBeLessThan(10);
      expect(Math.abs(b! - SKIN[2])).toBeLessThan(10);
    }
    // Outside the padded box nothing changes.
    expect(at(out, 5, 30)).toEqual([...SKIN, 255]);
    expect(at(out, 30, 5)).toEqual(at(src, 30, 5));
    // The source is untouched.
    expect(at(src, 30, 30)).toEqual([20, 20, 30, 255]);
  });
});

describe("feature sprite", () => {
  it("crops the rect with a soft, rounded edge and a solid middle", () => {
    const sprite = featherCrop(portrait(), { x: 20, y: 25, w: 20, h: 10 }, 0.8);
    expect(sprite.width).toBe(20);
    expect(sprite.height).toBe(10);
    expect(at(sprite, 10, 5)).toEqual([20, 20, 30, 255]);
    expect(at(sprite, 0, 0)[3]).toBeLessThan(20);
    expect(at(sprite, 1, 5)[3]).toBeLessThan(255);
    expect(at(sprite, 1, 5)[3]).toBeGreaterThan(at(sprite, 0, 0)[3]!);
    // A wide strip stays solid along its middle: only the short side sets the fade.
    const strip = featherCrop(portrait(), { x: 10, y: 25, w: 40, h: 10 }, 0.5);
    expect(at(strip, 5, 5)[3]).toBe(255);
  });
});

describe("kit geometry", () => {
  it("scales rects into the rendered image and pads them", () => {
    expect(kitScale(DEFAULT_FACE)).toBe(2);
    expect(kitScale({ width: 200 })).toBe(4);
    expect(kitScale({ width: 3000 })).toBe(1);
    expect(scaleRect({ x: 10, y: 20, w: 30, h: 40 }, 2, 1000, 1000)).toEqual({ x: 20, y: 40, w: 60, h: 80 });
    expect(scaleRect({ x: 90, y: 90, w: 30, h: 30 }, 1, 100, 100)).toEqual({ x: 90, y: 90, w: 10, h: 10 });
    expect(patchPad({ x: 0, y: 0, w: 264, h: 64 }, 2)).toBe(10);
    expect(patchPad({ x: 0, y: 0, w: 10, h: 10 }, 2)).toBe(6);
  });
});
