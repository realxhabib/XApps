import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { SUBMISSION_BUDGET, fitToBudget, ENCODE_LADDER, submissionBytes } from "./budget";
import { containRect, fitCanvas } from "./canvas";
import {
  botCaptionsFor,
  entryAlt,
  entryToJson,
  hasCaption,
  makeBotEntry,
  pickTemplate,
  sanitizeEntry,
} from "./logic";
import {
  DROP_BOT_CAPTIONS,
  DROP_SLOT_BOT_CAPTIONS,
  DROP_TEMPLATE_ID,
  dropSlotToCaption,
  dropTemplate,
  getPhotoTemplate,
} from "./photo-templates";
import {
  REMIX_CAPTION_ID,
  REMIX_MAX_BYTES,
  REMIX_TEMPLATE_ID,
  checkRemixFile,
  firstImageFile,
  remixTemplate,
} from "./remix";
import { layoutCaption, renderMemeSvg, slotFrame } from "./render";
import { parseDropSlots, parseRound, type DropSlot } from "./round";
import { canvasOf, type CaptionSlot, type MemeTemplate } from "./templates";

const TWO_BUTTONS = getPhotoTemplate("imgflip-87743020") as MemeTemplate;
const SRC = "https://i.imgflip.com/1g8my4.jpg";

/** Boxes the way Grok places them: one per panel/person/button, a little inset. */
function gridSlots(count: number, style: DropSlot["style"] | "mixed" = "mixed"): DropSlot[] {
  const cols = count <= 3 ? 1 : 2;
  const rows = Math.ceil(count / cols);
  return parseDropSlots(
    Array.from({ length: count }, (_, i) => ({
      label: `Panel ${i + 1}`,
      x: (i % cols) / cols + 0.03,
      y: Math.floor(i / cols) / rows + 0.02,
      w: 1 / cols - 0.06,
      h: Math.min(0.22, 1 / rows - 0.04),
      style: style === "mixed" ? (i % 2 ? "label" : "impact") : style,
    })),
  );
}

/** The same boxes as plain JSON settings. */
const asJson = (slots: DropSlot[]) => slots.map(({ label, x, y, w, h, style }) => ({ label, x, y, w, h, style }));

/** Everything a slot draws at full size (a label's tag + shadow included) stays on the canvas. */
function expectInside(slot: CaptionSlot, canvas: { width: number; height: number }, where: string) {
  const f = slotFrame(slot);
  const padX = slot.style === "label" ? slot.size * 0.5 : 0;
  const padY = slot.style === "label" ? slot.size * 0.28 : 0;
  const eps = 0.5;
  expect(f.x - padX, where).toBeGreaterThanOrEqual(-eps);
  expect(f.y - padY, where).toBeGreaterThanOrEqual(-eps);
  expect(f.x + f.width + padX, where).toBeLessThanOrEqual(canvas.width + eps);
  expect(f.y + f.height + padY + (slot.style === "label" ? 4 : 0), where).toBeLessThanOrEqual(canvas.height + eps);
}

describe("drops with placed caption boxes", () => {
  it("uses the format's name and the placed boxes", () => {
    const settings = {
      drop: {
        src: SRC,
        width: 600,
        height: 908,
        name: "  Two   Buttons ",
        slots: [
          { label: "Left button", x: 0.08, y: 0.1, w: 0.3, h: 0.1, style: "label" },
          { label: "Right button", x: 0.52, y: 0.06, w: 0.3, h: 0.1, style: "label" },
          { label: "Sweating guy", x: 0.05, y: 0.82, w: 0.9, h: 0.16, style: "impact" },
        ],
      },
    };
    const template = pickTemplate(createRandom("x").fork("meme-duel:template"), settings);
    expect(template.id).toBe(DROP_TEMPLATE_ID);
    expect(template.name).toBe("Two Buttons");
    expect(template.slots.map((s) => [s.id, s.label, s.style])).toEqual([
      ["s1", "Left button", "label"],
      ["s2", "Right button", "label"],
      ["s3", "Sweating guy", "impact"],
    ]);
    const canvas = canvasOf(template);
    expect(canvas).toEqual(fitCanvas(600, 908));
    // Centered in its box (the boxes here fit comfortably).
    const guy = template.slots[2]!;
    expect(guy.x).toBeCloseTo(300, 0);
    expect(guy.y).toBeCloseTo((0.82 + 0.08) * canvas.height, 0);
    expect(guy.size).toBeGreaterThan(30);
    for (const slot of template.slots) expectInside(slot, canvas, slot.id);
  });

  it("falls back to top/bottom text and the handle when a drop has no boxes", () => {
    const template = dropTemplate({ src: SRC, width: 800, height: 800, credit: { handle: "someone", url: "https://x.com/someone" } });
    expect(template.name).toBe("@someone's drop");
    expect(template.slots.map((s) => s.id)).toEqual(["top", "bottom"]);
    expect(dropTemplate({ src: SRC, width: 800, height: 800 }).name).toBe("The drop");
    expect(dropTemplate({ src: SRC, width: 800, height: 800, name: "Stonks" }).name).toBe("Stonks");
  });

  it("keeps 1–6 boxes inside the canvas for any aspect ratio, including letterboxed images", () => {
    const sizes = [
      [600, 908],
      [1200, 675],
      [3000, 600], // wider than 2.2:1 → letterboxed
      [500, 2000], // taller than 1:1.6 → letterboxed
      [1000, 1000],
    ];
    for (const [w, h] of sizes) {
      for (let n = 1; n <= 6; n++) {
        const template = dropTemplate({ src: SRC, width: w!, height: h!, slots: gridSlots(n) });
        const canvas = canvasOf(template);
        expect(template.slots, `${w}x${h}/${n}`).toHaveLength(n);
        for (const slot of template.slots) {
          expectInside(slot, canvas, `${w}x${h}/${n}/${slot.id}`);
          expect(slot.maxLines).toBeGreaterThanOrEqual(1);
          expect(slot.maxLines).toBeLessThanOrEqual(4);
          expect(slot.size).toBeGreaterThanOrEqual(14);
          expect(slot.size).toBeLessThanOrEqual(slot.style === "label" ? 30 : 46);
        }
      }
    }
  });

  it("maps boxes onto the image area, not the letterbox", () => {
    const canvas = fitCanvas(3000, 600);
    const image = containRect(canvas, 3000, 600);
    expect(image.y).toBeGreaterThan(0);
    const slot = dropSlotToCaption({ id: "s1", label: "Top", x: 0.1, y: 0.1, w: 0.8, h: 0.3, style: "impact" }, canvas, image);
    const f = slotFrame(slot);
    expect(f.y + f.height / 2).toBeCloseTo(image.y + 0.25 * image.height, 0);
  });

  it("survives extreme boxes: tiny, edge-hugging and full-image", () => {
    const canvas = fitCanvas(1200, 675);
    const image = containRect(canvas, 1200, 675);
    const boxes: DropSlot[] = [
      { id: "s1", label: "tiny", x: 0, y: 0, w: 0.08, h: 0.04, style: "label" },
      { id: "s2", label: "corner", x: 0.92, y: 0.96, w: 0.08, h: 0.04, style: "impact" },
      { id: "s3", label: "all", x: 0, y: 0, w: 1, h: 1, style: "label" },
      { id: "s4", label: "strip", x: 0, y: 0.45, w: 1, h: 0.04, style: "impact" },
      { id: "s5", label: "tower", x: 0.9, y: 0, w: 0.1, h: 1, style: "impact" },
    ];
    for (const box of boxes) expectInside(dropSlotToCaption(box, canvas, image), canvas, box.label);
  });

  it("bots caption any number of boxes with sets that fit", () => {
    for (let n = 1; n <= 6; n++) {
      expect(DROP_SLOT_BOT_CAPTIONS[n]!.length, `n=${n}`).toBeGreaterThanOrEqual(3);
      for (const style of ["impact", "label"] as const) {
        const template = dropTemplate({ src: SRC, width: 900, height: 900, slots: gridSlots(n, style) });
        const bank = botCaptionsFor(template);
        expect(bank.length).toBe(DROP_SLOT_BOT_CAPTIONS[n]!.length);
        for (const captions of bank) {
          expect(Object.keys(captions).sort()).toEqual(template.slots.map((s) => s.id).sort());
          for (const slot of template.slots) {
            const text = captions[slot.id]!;
            const where = `${n}/${style}/${slot.id}: ${text}`;
            expect(text.length, where).toBeGreaterThan(0);
            expect(text.length, where).toBeLessThanOrEqual(slot.maxLength);
            const { lines, size } = layoutCaption(slot, text);
            expect(lines.length, where).toBeLessThanOrEqual(slot.maxLines);
            // Readable, and no word broken in two.
            expect(size, where).toBeGreaterThanOrEqual(Math.min(slot.size, 14));
            const words = new Set(text.toUpperCase().split(/\s+/));
            for (const line of lines) for (const w of line.toUpperCase().split(" ")) expect(words, where).toContain(w);
          }
        }
        const entry = makeBotEntry(template, createRandom(`bot${n}`).next);
        expect(hasCaption(entry, template)).toBe(true);
        expect(template.slots.every((s) => entry.captions[s.id])).toBe(true);
        expect(sanitizeEntry(entry, template)).toEqual(entry);
      }
    }
    // No boxes: the classic top/bottom pool.
    expect(botCaptionsFor(dropTemplate({ src: SRC, width: 900, height: 900 }))).toBe(DROP_BOT_CAPTIONS);
  });

  it("records the format's name with the drop reference", () => {
    const round = parseRound({ topic: "Mondays", drop: { src: SRC, width: 600, height: 908, name: "Two Buttons", slots: asJson(gridSlots(2)) } });
    const template = dropTemplate(round.drop!);
    const entry = sanitizeEntry({ templateId: DROP_TEMPLATE_ID, captions: { s1: "a", s2: "b" } }, template);
    expect(entryToJson(entry, template, round).drop).toEqual({ src: SRC, width: 600, height: 908, name: "Two Buttons" });
  });
});

describe("remixes", () => {
  const upload = { src: `data:image/jpeg;base64,${"A".repeat(4000)}`, width: 1080, height: 720 };

  it("stand in for the round's template with their own canvas and one optional caption", () => {
    const remix = remixTemplate(TWO_BUTTONS, upload);
    expect(remix.id).toBe(REMIX_TEMPLATE_ID);
    expect(remix.remixOf).toBe(TWO_BUTTONS);
    expect(remix.name).toBe("Two Buttons");
    expect(canvasOf(remix)).toEqual(fitCanvas(1080, 720));
    expect(remix.photo).toEqual(upload);
    expect(remix.slots.map((s) => s.id)).toEqual([REMIX_CAPTION_ID]);
    expectInside(remix.slots[0]!, canvasOf(remix), "remix caption");
  });

  it("go in without a caption, and never put the upload in data", () => {
    const remix = remixTemplate(TWO_BUTTONS, upload);
    const stickers = [{ emoji: "🔥", x: 0.3, y: 0.4, scale: 1.2, rotate: 10 }];
    const entry = sanitizeEntry({ templateId: remix.id, captions: {}, stickers }, remix);
    expect(entry.templateId).toBe(REMIX_TEMPLATE_ID);
    expect(entry.stickers).toHaveLength(1);
    const json = entryToJson(entry, remix, { topic: "Mondays" });
    expect(json).toMatchObject({ remix: true, templateId: TWO_BUTTONS.id, topic: "Mondays", stickers });
    expect(JSON.stringify(json)).not.toContain("data:");
    expect(json.drop).toBeUndefined();
    expect(entryAlt(entry, remix, "Mondays", "me")).toBe("@me's remix of Two Buttons — Topic: Mondays");
    expect(entryAlt({ ...entry, captions: { [REMIX_CAPTION_ID]: "big mood" } }, remix, undefined, "@me")).toBe(
      "@me's remix of Two Buttons: big mood",
    );
  });

  it("of a drop keep the drop reference (the shared image, not the upload)", () => {
    const round = parseRound({ drop: { src: SRC, width: 600, height: 908, name: "Two Buttons", slots: asJson(gridSlots(3)) } });
    const drop = dropTemplate(round.drop!);
    const remix = remixTemplate(drop, upload);
    const json = entryToJson(sanitizeEntry({ captions: {} }, remix), remix, round);
    expect(json.templateId).toBe(DROP_TEMPLATE_ID);
    expect(json.remix).toBe(true);
    expect(json.drop).toEqual({ src: SRC, width: 600, height: 908, name: "Two Buttons" });
  });

  it("embed the upload in the display and fit the budget", async () => {
    const remix = remixTemplate(TWO_BUTTONS, upload);
    const entry = sanitizeEntry(
      { captions: { [REMIX_CAPTION_ID]: "W".repeat(70) }, stickers: [0.2, 0.5, 0.8].map((v) => ({ emoji: "🔥", x: v, y: v, scale: 2 })) },
      remix,
    );
    const alt = entryAlt(entry, remix, "a".repeat(80), "someone_with_a_long_handle");
    const data = entryToJson(entry, remix, { topic: "a".repeat(80) });
    const jpeg = (bytes: number) => `data:image/jpeg;base64,${"A".repeat(bytes - (bytes % 4))}`;
    const sizes = [90_000, 70_000, 52_000, 40_000];
    let i = 0;
    const fitted = await fitToBudget(
      ENCODE_LADDER,
      () => jpeg(sizes[Math.min(i++, sizes.length - 1)]!),
      (href) => ({ data, display: { kind: "svg" as const, svg: renderMemeSvg(entry, { template: remix, imageHref: href, title: alt }), alt } }),
    );
    expect(fitted.bytes).toBeLessThanOrEqual(SUBMISSION_BUDGET);
    expect(fitted.value.display.svg).toContain("<image href=\"data:image/jpeg;base64,");
    expect(submissionBytes(fitted.value.data)).toBeLessThan(1000);
  });

  it("accept raster images up to 15 MB only", () => {
    expect(checkRemixFile({ type: "image/jpeg", size: 2_000_000 })).toBeNull();
    expect(checkRemixFile({ type: "image/png", size: REMIX_MAX_BYTES })).toBeNull();
    expect(checkRemixFile({ type: "image/webp", size: REMIX_MAX_BYTES + 1 })).toBe("size");
    expect(checkRemixFile({ type: "image/svg+xml", size: 1000 })).toBe("type");
    expect(checkRemixFile({ type: "text/html", size: 1000 })).toBe("type");
    expect(checkRemixFile({ type: "", size: 1000 })).toBe("type");
    expect(checkRemixFile({ type: "image/gif", size: 0 })).toBe("decode");
  });

  it("pick the first image among pasted or dropped files", () => {
    const files = [{ type: "text/plain" }, { type: "image/png", name: "a" }, { type: "image/jpeg" }];
    expect(firstImageFile(files)).toBe(files[1]);
    expect(firstImageFile([{ type: "application/pdf" }])).toBeNull();
    expect(firstImageFile(null)).toBeNull();
  });
});
