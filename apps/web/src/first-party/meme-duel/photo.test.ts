import { createRandom, LIMITS } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { isAllowedMemeSource } from "@/lib/meme-image";
import {
  ENCODE_LADDER,
  SUBMISSION_BUDGET,
  fitToBudget,
  ladderFor,
  scaleToFit,
  submissionBytes,
  type EncodeStep,
} from "./budget";
import { CANVAS_WIDTH, MAX_CANVAS_HEIGHT, MIN_CANVAS_HEIGHT, containRect, fitCanvas } from "./canvas";
import {
  botCaptionsFor,
  captionRange,
  clampCaptionPosition,
  defaultCaptionPosition,
  entryAlt,
  entryToJson,
  hasCaption,
  makeBotEntry,
  pickTemplate,
  resolveTemplate,
  sanitizeEntry,
  sanitizePositions,
  slotAt,
  slotBounds,
  slotWithPosition,
} from "./logic";
import { DROP_BOT_CAPTIONS, DROP_TEMPLATE_ID, PHOTO_BOT_CAPTIONS, PHOTO_TEMPLATES, dropTemplate, getPhotoTemplate } from "./photo-templates";
import { layoutCaption, positionedSlot, renderCaptionSvg, renderMemeSvg, slotFrame } from "./render";
import { parseRound } from "./round";
import { MEME_TEMPLATES, canvasOf, getTemplate, type MemeTemplate } from "./templates";

const DRAKE = "imgflip-181913649";
const drake = () => getPhotoTemplate(DRAKE) as MemeTemplate;

/** A fake base64 JPEG of about `bytes` characters. */
function fakeJpeg(bytes: number): string {
  return `data:image/jpeg;base64,${"A".repeat(Math.max(4, bytes - 23 - (bytes % 4)))}`;
}

describe("rounds from match settings", () => {
  const rng = () => createRandom("seed-1").fork("meme-duel:template");

  it("empty settings pick a photo template from the match seed, the same on both clients", () => {
    const a = pickTemplate(rng(), {});
    const b = resolveTemplate(rng(), parseRound(undefined));
    expect(a.id).toBe(b.id);
    expect(a.photo).toBeDefined();
    expect(PHOTO_TEMPLATES).toContain(a);
  });

  it("different seeds spread over the catalog", () => {
    const ids = new Set(Array.from({ length: 40 }, (_, i) => pickTemplate(createRandom(`m${i}`).fork("meme-duel:template"), null).id));
    expect(ids.size).toBeGreaterThan(10);
  });

  it("honors a photo or original templateId", () => {
    expect(pickTemplate(rng(), { templateId: DRAKE }).id).toBe(DRAKE);
    expect(pickTemplate(rng(), { templateId: "pov" }).id).toBe("pov");
  });

  it("a drop wins over templateId and becomes a top/bottom photo template", () => {
    const settings = {
      templateId: DRAKE,
      topic: "  Monday   mornings ",
      drop: { src: "https://pbs.twimg.com/media/abc.jpg", width: 1200, height: 675, credit: { handle: "someone", url: "https://x.com/someone/status/1" } },
    };
    const round = parseRound(settings);
    expect(round.topic).toBe("Monday mornings");
    const template = pickTemplate(rng(), settings);
    expect(template.id).toBe(DROP_TEMPLATE_ID);
    expect(template.photo?.src).toBe("https://pbs.twimg.com/media/abc.jpg");
    expect(template.photo?.credit?.handle).toBe("someone");
    expect(template.name).toBe("@someone's drop");
    expect(canvasOf(template)).toEqual({ width: 600, height: 338 });
    expect(template.slots.map((s) => s.id)).toEqual(["top", "bottom"]);
  });

  it("malformed drops are ignored (seeded pick instead)", () => {
    const template = pickTemplate(rng(), { drop: { src: "javascript:alert(1)", width: 10, height: "x" } });
    expect(template.id).not.toBe(DROP_TEMPLATE_ID);
    expect(template.photo).toBeDefined();
  });

  it("puts the topic in alt text and data, and keeps drop refs small", () => {
    const template = dropTemplate({ src: "https://pbs.twimg.com/media/abc.jpg", width: 800, height: 800 });
    const entry = sanitizeEntry({ templateId: DROP_TEMPLATE_ID, captions: { top: "hello", bottom: "there" } }, template);
    const round = { topic: "Monday mornings" };
    expect(entryAlt(entry, template, round.topic)).toBe("Topic: Monday mornings — hello / there");
    const json = entryToJson(entry, template, round);
    expect(json.topic).toBe("Monday mornings");
    expect(json.drop).toEqual({ src: "https://pbs.twimg.com/media/abc.jpg", width: 800, height: 800 });

    const demo = dropTemplate({ src: `data:image/jpeg;base64,${"A".repeat(40_000)}`, width: 800, height: 800 });
    const demoJson = entryToJson(sanitizeEntry({ captions: { top: "x" } }, demo), demo);
    expect(demoJson.drop?.src).toBeNull();
    expect(submissionBytes(demoJson)).toBeLessThan(500);
  });
});

describe("canvas", () => {
  it("follows the aspect ratio within limits", () => {
    expect(fitCanvas(1200, 800)).toEqual({ width: 600, height: 400 });
    expect(fitCanvas(600, 908)).toEqual({ width: 600, height: 908 });
    expect(fitCanvas(3000, 500).height).toBe(MIN_CANVAS_HEIGHT);
    expect(fitCanvas(500, 3000).height).toBe(MAX_CANVAS_HEIGHT);
    expect(fitCanvas(0, 0)).toEqual({ width: 600, height: 600 });
  });

  it("letterboxes extreme images and fills the canvas otherwise", () => {
    expect(containRect({ width: 600, height: 400 }, 1200, 800)).toEqual({ x: 0, y: 0, width: 600, height: 400 });
    const tall = containRect(fitCanvas(500, 3000), 500, 3000);
    expect(tall.height).toBe(MAX_CANVAS_HEIGHT);
    expect(tall.x).toBeGreaterThan(0);
    expect(tall.x * 2 + tall.width).toBeCloseTo(CANVAS_WIDTH, 0);
  });
});

describe("photo templates", () => {
  it("has a solid catalog with unique ids that don't clash with the originals", () => {
    expect(PHOTO_TEMPLATES.length).toBeGreaterThanOrEqual(36);
    expect(PHOTO_TEMPLATES.length).toBeLessThanOrEqual(45);
    const ids = [...PHOTO_TEMPLATES, ...MEME_TEMPLATES].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of PHOTO_TEMPLATES) {
      expect(t.id).toMatch(/^imgflip-\d+$/);
      expect(getTemplate(t.id)).toBe(t);
    }
  });

  it("load from allowed hosts and keep their aspect ratio", () => {
    for (const t of PHOTO_TEMPLATES) {
      const photo = t.photo!;
      expect(isAllowedMemeSource(photo.src, ""), t.id).toBe(true);
      const canvas = canvasOf(t);
      expect(canvas.width).toBe(600);
      expect(canvas.height).toBe(Math.round((600 * photo.height) / photo.width));
    }
  });

  it("every slot is unique, labelled and fully inside the canvas", () => {
    for (const t of PHOTO_TEMPLATES) {
      const canvas = canvasOf(t);
      expect(t.slots.length, t.id).toBeGreaterThan(0);
      expect(new Set(t.slots.map((s) => s.id)).size, t.id).toBe(t.slots.length);
      for (const slot of t.slots) {
        const f = slotFrame(slot);
        const where = `${t.id}.${slot.id}`;
        expect(slot.label, where).toBeTruthy();
        expect(f.x, where).toBeGreaterThanOrEqual(0);
        expect(f.y, where).toBeGreaterThanOrEqual(0);
        expect(f.x + f.width, where).toBeLessThanOrEqual(canvas.width);
        expect(f.y + f.height, where).toBeLessThanOrEqual(canvas.height);
        expect(slot.maxLength, where).toBeGreaterThan(0);
      }
    }
  });

  it("slots of the same template don't overlap each other", () => {
    for (const t of PHOTO_TEMPLATES) {
      const boxes = t.slots.map((s) => slotBounds(s, canvasOf(t)));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${t.id}: ${t.slots[i]!.id} / ${t.slots[j]!.id}`).toBe(false);
        }
      }
    }
  });

  it("every template has 2–4 bot captions that match its slots and fit without mush", () => {
    for (const t of PHOTO_TEMPLATES) {
      const bank = PHOTO_BOT_CAPTIONS[t.id];
      expect(bank?.length, t.id).toBeGreaterThanOrEqual(2);
      expect(bank!.length, t.id).toBeLessThanOrEqual(4);
      for (const captions of bank!) {
        expect(Object.keys(captions).sort(), t.id).toEqual(t.slots.map((s) => s.id).sort());
        for (const slot of t.slots) {
          const text = captions[slot.id]!;
          const where = `${t.id}.${slot.id}: ${text}`;
          expect(text.length, where).toBeLessThanOrEqual(slot.maxLength);
          const { lines, size } = layoutCaption(slot, text);
          expect(lines.length, where).toBeLessThanOrEqual(slot.maxLines);
          expect(size, where).toBeGreaterThanOrEqual(Math.min(slot.size, 14));
          const words = new Set(text.toUpperCase().split(/\s+/));
          for (const line of lines) for (const w of line.toUpperCase().split(" ")) expect(words, where).toContain(w);
        }
      }
    }
  });

  it("bots caption drops from the generic pool", () => {
    const template = dropTemplate({ src: "https://pbs.twimg.com/media/x.jpg", width: 1000, height: 1000 });
    expect(botCaptionsFor(template)).toBe(DROP_BOT_CAPTIONS);
    for (const captions of DROP_BOT_CAPTIONS) {
      for (const slot of template.slots) {
        const { lines } = layoutCaption(slot, captions[slot.id as "top" | "bottom"]);
        expect(lines.length).toBeLessThanOrEqual(slot.maxLines);
      }
    }
    const entry = makeBotEntry(template, createRandom("bot").next);
    expect(entry.templateId).toBe(DROP_TEMPLATE_ID);
    expect(hasCaption(entry, template)).toBe(true);
    expect(sanitizeEntry(entry, template)).toEqual(entry);
  });

  it("bot entries on photo templates are valid and deterministic", () => {
    for (const t of PHOTO_TEMPLATES) {
      const a = makeBotEntry(t, createRandom(t.id).next);
      expect(a).toEqual(makeBotEntry(t, createRandom(t.id).next));
      expect(a.templateId).toBe(t.id);
      expect(hasCaption(a, t)).toBe(true);
      expect(sanitizeEntry(a)).toEqual(a);
    }
  });

  it("keeps mocking case on Spongebob, uppercases classic impact", () => {
    const sponge = getTemplate("imgflip-102156234");
    expect(layoutCaption(sponge.slots[1]!, "pLeAsE").lines).toEqual(["pLeAsE"]);
    expect(layoutCaption(getTemplate("imgflip-61544").slots[0]!, "found").lines).toEqual(["FOUND"]);
  });
});

describe("caption positions", () => {
  const t = drake();
  const canvas = canvasOf(t);
  const slot = t.slots[0]!;

  it("defaults to the center of the slot's frame", () => {
    const f = slotFrame(slot);
    expect(defaultCaptionPosition(slot, canvas)).toEqual({ x: (f.x + f.width / 2) / 600, y: (f.y + f.height / 2) / 600 });
  });

  it("clamps so the whole frame stays on the canvas and rejects junk", () => {
    const range = captionRange(slot, canvas);
    expect(clampCaptionPosition(slot, canvas, { x: -5, y: 99 })).toEqual({
      x: Math.round(range.minX * 10_000) / 10_000,
      y: Math.round(range.maxY * 10_000) / 10_000,
    });
    expect(clampCaptionPosition(slot, canvas, { x: Number.NaN, y: 0.5 })).toBeUndefined();
    expect(clampCaptionPosition(slot, canvas, { x: Infinity, y: 0.5 })).toBeUndefined();
    expect(clampCaptionPosition(slot, canvas, { x: "0.5", y: 0.5 })).toBeUndefined();
    expect(clampCaptionPosition(slot, canvas, null)).toBeUndefined();
  });

  it("full-width captions can only move vertically", () => {
    const top = getTemplate("imgflip-61544").slots[0]!;
    const range = captionRange(top, canvasOf(getTemplate("imgflip-61544")));
    expect(range.maxX - range.minX).toBeLessThan(0.06);
    expect(range.maxY - range.minY).toBeGreaterThan(0.5);
  });

  it("sanitizes: known slots only, clamped, finite, rounded; defaults dropped", () => {
    const home = defaultCaptionPosition(slot, canvas);
    const positions = sanitizePositions(
      {
        no: { x: 0.323456789, y: 0.3 },
        yes: { x: 9, y: -9 },
        evil: { x: 0.5, y: 0.5 },
        junk: "x",
      },
      t,
    );
    expect(Object.keys(positions).sort()).toEqual(["no", "yes"]);
    expect(positions.no).toEqual({ x: 0.3235, y: 0.3 });
    for (const p of Object.values(positions)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
    expect(sanitizePositions({ no: home }, t)).toEqual({});
    expect(sanitizePositions({ no: { x: Number.NaN, y: 1 } }, t)).toEqual({});
    expect(sanitizePositions("nope", t)).toEqual({});
  });

  it("sanitizeEntry keeps positions for photo templates only", () => {
    const moved = sanitizeEntry({ templateId: DRAKE, captions: { no: "a" }, positions: { no: { x: 0.3, y: 0.3 } } });
    expect(moved.positions).toEqual({ no: { x: 0.3, y: 0.3 } });
    const still = sanitizeEntry({ templateId: DRAKE, captions: { no: "a" } });
    expect("positions" in still).toBe(false);
    const original = sanitizeEntry({ templateId: "stone-face", captions: { top: "a" }, positions: { top: { x: 0.5, y: 0.5 } } });
    expect("positions" in original).toBe(false);
    expect(entryToJson(moved).positions).toEqual({ no: { x: 0.3, y: 0.3 } });
  });

  it("moves the rendered caption and the tap target", () => {
    const pos = { x: 0.3, y: 0.2 };
    const moved = positionedSlot(slot, canvas, pos);
    const f = slotFrame(moved);
    expect(f.x + f.width / 2).toBeCloseTo(0.3 * 600, 0);
    expect(f.y + f.height / 2).toBeCloseTo(0.2 * 600, 0);
    expect(positionedSlot(slot, canvas, { x: Number.NaN, y: 1 })).toBe(slot);
    expect(slotWithPosition(t, slot, { no: pos }).x).toBe(moved.x);
    expect(slotAt(t, { x: 0.3, y: 0.2 }, { no: pos })?.id).toBe("no");

    const entry = sanitizeEntry({ templateId: DRAKE, captions: { no: "moved" }, positions: { no: pos } });
    const svg = renderMemeSvg(entry);
    expect(svg).toContain(`<tspan x="${moved.x}"`);
  });
});

describe("rendering photo entries", () => {
  const t = drake();

  it("embeds a data: image and uses the template's canvas", () => {
    const entry = sanitizeEntry({ templateId: DRAKE, captions: { no: "a", yes: "b" } });
    const href = fakeJpeg(200);
    const svg = renderMemeSvg(entry, { imageHref: href, title: "Topic: <x> & y" });
    expect(svg).toContain(`<image href="${href}"`);
    expect(svg).toContain('viewBox="0 0 600 600"');
    expect(svg).toContain("<title>Topic: &lt;x&gt; &amp; y</title>");
    const wide = getTemplate("imgflip-112126428");
    expect(renderMemeSvg({ templateId: wide.id, captions: {}, stickers: [] })).toContain('viewBox="0 0 600 400"');
  });

  it("never embeds remote or malformed image URLs", () => {
    const entry = { templateId: DRAKE, captions: {}, stickers: [] };
    for (const href of ["https://i.imgflip.com/30b1gx.jpg", "data:image/svg+xml;base64,AAAA", 'data:image/jpeg;base64,AA"/><script>']) {
      const svg = renderMemeSvg(entry, { imageHref: href });
      expect(svg).not.toContain("<image");
      expect(svg).not.toContain("<script");
    }
  });

  it("draws drops through an explicit template", () => {
    const template = dropTemplate({ src: "https://pbs.twimg.com/media/x.jpg", width: 400, height: 1600 });
    const entry = sanitizeEntry({ captions: { top: "tall" } }, template);
    const svg = renderMemeSvg(entry, { template, imageHref: fakeJpeg(100) });
    expect(svg).toContain(`viewBox="0 0 600 ${MAX_CANVAS_HEIGHT}"`);
    // Letterboxed: the image is narrower than the canvas and centered.
    expect(svg).toMatch(/<image [^>]*x="(\d+(\.\d)?)"/);
    expect(svg).toContain("TALL");
  });

  it("renders a single caption for the editor", () => {
    const svg = renderCaptionSvg(t.slots[0]!, "<b>hi</b>", true, 10);
    expect(svg).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(svg).toMatch(/^<svg [^>]*viewBox="[\d. -]+" overflow="visible">/);
  });
});

describe("size budget", () => {
  it("stays comfortably under the SDK limit", () => {
    expect(SUBMISSION_BUDGET).toBeLessThanOrEqual(56 * 1024);
    expect(SUBMISSION_BUDGET).toBeLessThan(LIMITS.submissionBytes);
  });

  it("measures JSON bytes the way the SDK does", () => {
    expect(submissionBytes({ a: "é" })).toBe(new TextEncoder().encode('{"a":"é"}').length);
    // Quotes in SVG markup get escaped in JSON: they cost two bytes.
    expect(submissionBytes('"')).toBe(4);
  });

  it("scales down but never up", () => {
    expect(scaleToFit(1200, 800, 560)).toEqual({ width: 560, height: 373 });
    expect(scaleToFit(300, 900, 560)).toEqual({ width: 187, height: 560 });
    expect(scaleToFit(200, 100, 560)).toEqual({ width: 200, height: 100 });
  });

  it("skips resolutions a small image can't reach", () => {
    const steps = ladderFor(400, 300);
    expect(Math.max(...steps.map((s) => s.side))).toBe(400);
    expect(new Set(steps.map((s) => `${s.side}|${s.quality}`)).size).toBe(steps.length);
    expect(ladderFor(4000, 3000)).toEqual([...ENCODE_LADDER]);
  });

  it("returns the best-looking step that fits", async () => {
    // Pretend bytes scale with side² × quality.
    const encode = (s: EncodeStep) => fakeJpeg(Math.round(s.side * s.side * s.quality * 0.25));
    const tried: EncodeStep[] = [];
    const fitted = await fitToBudget(
      ENCODE_LADDER,
      (s) => {
        tried.push(s);
        return encode(s);
      },
      (href) => ({ data: { templateId: DRAKE }, display: { kind: "svg", svg: `<svg><image href="${href}"/></svg>`, alt: "x" } }),
    );
    expect(fitted.bytes).toBeLessThanOrEqual(SUBMISSION_BUDGET);
    expect(tried.at(-1)).toEqual(fitted.step);
    // Every earlier step was over budget.
    for (const step of tried.slice(0, -1)) expect(encode(step).length).toBeGreaterThan(SUBMISSION_BUDGET - 200);
  });

  it("counts the whole submission, not just the image", async () => {
    const big = "x".repeat(20_000);
    const fitted = await fitToBudget(
      ENCODE_LADDER,
      (s) => fakeJpeg(s.side * 70),
      (href) => ({ data: { note: big }, display: { svg: href } }),
    );
    expect(fitted.bytes).toBeLessThanOrEqual(SUBMISSION_BUDGET);
    expect(fitted.step.side).toBeLessThan(560);
  });

  it("throws when nothing fits", async () => {
    await expect(fitToBudget(ENCODE_LADDER, () => fakeJpeg(200_000), (href) => ({ href }))).rejects.toThrow(/too large/);
  });

  it("a real photo entry with stickers and long captions leaves room for the image", () => {
    const t = getTemplate("imgflip-93895088");
    const captions = Object.fromEntries(t.slots.map((s) => [s.id, "W".repeat(s.maxLength)]));
    const stickers = [0.2, 0.5, 0.8].map((v) => ({ emoji: "🔥", x: v, y: v, scale: 2, rotate: 20 }));
    const entry = sanitizeEntry({ templateId: t.id, captions, stickers, positions: { one: { x: 0.3, y: 0.3 } } });
    const svg = renderMemeSvg(entry, { title: entryAlt(entry, t, "a".repeat(80)) });
    const overhead = submissionBytes({ data: entryToJson(entry, t, { topic: "a".repeat(80) }), display: { kind: "svg", svg, alt: "a".repeat(400) } });
    // At least ~40 KB left for the JPEG.
    expect(SUBMISSION_BUDGET - overhead).toBeGreaterThan(40_000);
  });
});
