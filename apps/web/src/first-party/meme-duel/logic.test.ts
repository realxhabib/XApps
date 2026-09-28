import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  EDGE_MARGIN,
  MAX_STICKERS,
  SCALE_MAX,
  SCALE_MIN,
  botFollowUpDelayMs,
  botSubmitDelayMs,
  clampPosition,
  clampScale,
  clampSticker,
  cleanCaptionInput,
  entryAlt,
  entryToJson,
  formatClock,
  handleTransform,
  hasCaption,
  makeBotEntry,
  normalizeRotation,
  outcomeFor,
  pickTemplate,
  pinchTransform,
  randomStickerPlacement,
  sanitizeCaption,
  sanitizeEntry,
  scatterStickers,
  shortestTurn,
  slotAt,
  slotBounds,
  stickerRadius,
  truncateSafe,
  type Rand,
} from "./logic";
import { escapeXml, layoutCaption, renderMemeSvg, svgToDataUrl } from "./render";
import { BOT_CAPTIONS, MEME_TEMPLATES, STICKERS, getTemplate, type MemeEntry } from "./templates";

/** Deterministic Rand for tests. */
function seeded(seed = "test"): Rand {
  return createRandom(seed).next;
}

/**
 * Minimal XML well-formedness check: every tag closes in order, attributes
 * are quoted, and text contains no raw `<` or stray `&`.
 */
function assertWellFormed(xml: string): void {
  const stack: string[] = [];
  const token = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = token.exec(xml))) {
    consumed = token.lastIndex;
    const [, closing, name, , selfClosing, text] = match;
    if (text !== undefined) {
      expect(text).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
      continue;
    }
    if (closing) expect(stack.pop()).toBe(name);
    else if (!selfClosing) stack.push(name as string);
  }
  expect(consumed).toBe(xml.length);
  expect(stack).toEqual([]);
}

describe("sticker math", () => {
  it("clamps positions inside the canvas and handles junk", () => {
    expect(clampPosition(-3)).toBe(EDGE_MARGIN);
    expect(clampPosition(7)).toBe(1 - EDGE_MARGIN);
    expect(clampPosition(0.3)).toBe(0.3);
    expect(clampPosition(Number.NaN)).toBe(0.5);
    expect(clampPosition("0.2")).toBe(0.5);
  });

  it("clamps scale", () => {
    expect(clampScale(0.01)).toBe(SCALE_MIN);
    expect(clampScale(99)).toBe(SCALE_MAX);
    expect(clampScale(Infinity)).toBe(1);
    expect(clampScale(1.4)).toBe(1.4);
  });

  it("normalizes rotation into (-180, 180]", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(190)).toBe(-170);
    expect(normalizeRotation(-190)).toBe(170);
    expect(normalizeRotation(540)).toBe(180);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(720.04)).toBe(0);
    expect(normalizeRotation(Number.NaN)).toBe(0);
  });

  it("finds the shortest turn", () => {
    expect(shortestTurn(170, -170)).toBe(20);
    expect(shortestTurn(-170, 170)).toBe(-20);
    expect(shortestTurn(10, 40)).toBe(30);
  });

  it("clampSticker keeps emoji and fixes every field", () => {
    expect(clampSticker({ emoji: "🔥", x: 2, y: -1, scale: 10, rotate: 370 })).toEqual({
      emoji: "🔥",
      x: 1 - EDGE_MARGIN,
      y: EDGE_MARGIN,
      scale: SCALE_MAX,
      rotate: 10,
    });
  });

  it("corner handle scales with distance and rotates with angle", () => {
    const center = { x: 100, y: 100 };
    const start = { x: 150, y: 100 };
    const doubled = handleTransform(center, start, { x: 200, y: 100 }, 1, 0);
    expect(doubled.scale).toBeCloseTo(2);
    expect(doubled.rotate).toBeCloseTo(0);
    const quarter = handleTransform(center, start, { x: 100, y: 150 }, 1, 10);
    expect(quarter.scale).toBeCloseTo(1);
    expect(quarter.rotate).toBeCloseTo(100);
    expect(handleTransform(center, start, { x: 1000, y: 100 }, 1, 0).scale).toBe(SCALE_MAX);
    expect(handleTransform(center, start, { x: 101, y: 100 }, 1, 0).scale).toBe(SCALE_MIN);
  });

  it("pinch scales by finger distance and rotates by finger angle", () => {
    const result = pinchTransform({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 50 }, { x: 50, y: 200 }, 1, 0);
    expect(result.scale).toBeCloseTo(1.5);
    expect(result.rotate).toBeCloseTo(90);
  });

  it("sticker radius follows scale", () => {
    expect(stickerRadius(2)).toBeCloseTo(stickerRadius(1) * 2);
  });
});

describe("captions", () => {
  it("truncates without splitting emoji", () => {
    expect(truncateSafe("ab😂", 3)).toBe("ab");
    expect(truncateSafe("ab😂", 4)).toBe("ab😂");
    expect(truncateSafe("hello", 10)).toBe("hello");
  });

  it("keeps trailing spaces while typing but strips control chars", () => {
    expect(cleanCaptionInput("hello ", 20)).toBe("hello ");
    expect(cleanCaptionInput("a\u0000b\u0007c\nd", 20)).toBe("abc d");
    expect(cleanCaptionInput("x".repeat(30), 10)).toHaveLength(10);
    expect(cleanCaptionInput("bad\uD800surrogate", 30)).toBe("badsurrogate");
  });

  it("sanitizes final captions", () => {
    expect(sanitizeCaption("  so   much\tspace  ", 40)).toBe("so much space");
    expect(sanitizeCaption(42, 40)).toBe("");
    expect(sanitizeCaption("abc def", 4)).toBe("abc");
  });
});

describe("sanitizeEntry", () => {
  it("falls back to a known template and keeps only its slots", () => {
    const entry = sanitizeEntry({ templateId: "nope", captions: { top: " hi ", evil: "x" }, stickers: [] }, "stone-face");
    expect(entry.templateId).toBe("stone-face");
    expect(entry.captions).toEqual({ top: "hi", bottom: "" });
  });

  it("survives garbage input", () => {
    const entry = sanitizeEntry("lol");
    expect(entry.templateId).toBe(MEME_TEMPLATES[0]!.id);
    expect(entry.stickers).toEqual([]);
    expect(sanitizeEntry(null, "pov").templateId).toBe("pov");
  });

  it("enforces caption limits", () => {
    const slot = getTemplate("two-buttons").slots[0]!;
    const entry = sanitizeEntry({ templateId: "two-buttons", captions: { [slot.id]: "x".repeat(500) } });
    expect(entry.captions[slot.id]).toHaveLength(slot.maxLength);
  });

  it("filters unknown stickers, caps the count and clamps placement", () => {
    const entry = sanitizeEntry({
      templateId: "pov",
      stickers: [
        { emoji: "<script>", x: 0.5, y: 0.5, scale: 1, rotate: 0 },
        { emoji: "🔥", x: Number.NaN, y: 3, scale: 0, rotate: 725 },
        { emoji: "💀", x: 0.2, y: 0.2, scale: 1, rotate: 0 },
        { emoji: "😂", x: 0.3, y: 0.3, scale: 1, rotate: 0 },
        { emoji: "👀", x: 0.4, y: 0.4, scale: 1, rotate: 0 },
        "junk",
      ],
    });
    expect(entry.stickers).toHaveLength(MAX_STICKERS);
    expect(entry.stickers.map((s) => s.emoji)).toEqual(["🔥", "💀", "😂"]);
    expect(entry.stickers[0]).toEqual({ emoji: "🔥", x: 0.5, y: 1 - EDGE_MARGIN, scale: SCALE_MIN, rotate: 5 });
  });

  it("drops editor-only fields like sticker ids", () => {
    const entry = sanitizeEntry({ templateId: "pov", stickers: [{ id: "s1", emoji: "🔥", x: 0.5, y: 0.5, scale: 1, rotate: 0 }] });
    expect(Object.keys(entry.stickers[0]!).sort()).toEqual(["emoji", "rotate", "scale", "x", "y"]);
  });
});

describe("entry helpers", () => {
  const entry: MemeEntry = { templateId: "pov", captions: { pov: "you blinked" }, stickers: [] };

  it("hasCaption needs real text", () => {
    expect(hasCaption(entry)).toBe(true);
    expect(hasCaption({ templateId: "pov", captions: { pov: "   " } })).toBe(false);
    expect(hasCaption({ templateId: "stone-face", captions: { top: "", bottom: "x" } })).toBe(true);
  });

  it("alt text joins captions with prefixes", () => {
    expect(entryAlt(entry)).toBe("POV: you blinked");
    expect(entryAlt({ templateId: "stone-face", captions: { top: "a", bottom: "b" }, stickers: [] })).toBe("a / b");
    expect(entryAlt({ templateId: "stone-face", captions: {}, stickers: [] })).toBe("Stone Face meme");
  });

  it("entryToJson is a plain copy", () => {
    const json = entryToJson({ ...entry, stickers: [{ emoji: "🔥", x: 0.1, y: 0.2, scale: 1, rotate: 3 }] });
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  it("formats the clock", () => {
    expect(formatClock(120_000)).toBe("2:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(5_500)).toBe("0:06");
    expect(formatClock(-10)).toBe("0:00");
  });

  it("maps results to outcomes", () => {
    expect(outcomeFor({ winnerId: "me" }, "me")).toBe("win");
    expect(outcomeFor({ winnerId: "them" }, "me")).toBe("lose");
    expect(outcomeFor({ winnerId: null }, "me")).toBe("draw");
  });
});

describe("template choice", () => {
  it("is identical for the same match seed", () => {
    const a = pickTemplate(createRandom("match-1").fork("template"));
    const b = pickTemplate(createRandom("match-1").fork("template"));
    expect(a.id).toBe(b.id);
  });

  it("honors settings.templateId", () => {
    expect(pickTemplate(createRandom("x"), { templateId: "bar-chart" }).id).toBe("bar-chart");
    expect(MEME_TEMPLATES).toContain(pickTemplate(createRandom("x"), { templateId: "missing" }));
  });
});

describe("placement", () => {
  it("keeps stickers off the captions when there is room", () => {
    const template = getTemplate("stone-face");
    const rand = seeded("place");
    for (let i = 0; i < 20; i++) {
      const s = randomStickerPlacement(template, "🔥", rand);
      const r = stickerRadius(s.scale);
      for (const slot of template.slots) {
        const b = slotBounds(slot);
        const overlaps = s.x + r > b.x && s.x - r < b.x + b.w && s.y + r > b.y && s.y - r < b.y + b.h;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("finds the slot under a canvas point", () => {
    const template = getTemplate("stone-face");
    expect(slotAt(template, { x: 0.5, y: 0.08 })?.id).toBe("top");
    expect(slotAt(template, { x: 0.5, y: 0.93 })?.id).toBe("bottom");
    expect(slotAt(template, { x: 0.5, y: 0.5 })).toBeUndefined();
  });

  it("scatter keeps emoji and extra fields, moves stickers", () => {
    const template = getTemplate("pov");
    const stickers = [
      { id: "a", emoji: "🔥", x: 0.5, y: 0.5, scale: 1, rotate: 0 },
      { id: "b", emoji: "💀", x: 0.5, y: 0.5, scale: 1, rotate: 0 },
    ];
    const next = scatterStickers(template, stickers, seeded("dice"));
    expect(next.map((s) => [s.id, s.emoji])).toEqual([
      ["a", "🔥"],
      ["b", "💀"],
    ]);
    expect(next[0]!.x !== 0.5 || next[0]!.y !== 0.5).toBe(true);
    expect(Math.hypot(next[0]!.x - next[1]!.x, next[0]!.y - next[1]!.y)).toBeGreaterThan(0.05);
  });
});

describe("bot", () => {
  it("builds a valid, deterministic entry from its caption bank", () => {
    for (const template of MEME_TEMPLATES) {
      const a = makeBotEntry(template, seeded(template.id));
      const b = makeBotEntry(template, seeded(template.id));
      expect(a).toEqual(b);
      expect(a.templateId).toBe(template.id);
      expect(hasCaption(a)).toBe(true);
      expect(a.stickers).toHaveLength(1);
      expect(STICKERS).toContain(a.stickers[0]!.emoji);
      expect(sanitizeEntry(a)).toEqual(a);
      expect(BOT_CAPTIONS[template.id]!.map((c) => c[template.slots[0]!.id] ?? "")).toContain(a.captions[template.slots[0]!.id]);
    }
  });

  it("times its submission 15–40s in, or a few seconds after the human", () => {
    expect(botSubmitDelayMs(() => 0)).toBe(15_000);
    expect(botSubmitDelayMs(() => 0.999999)).toBeLessThanOrEqual(40_000);
    expect(botFollowUpDelayMs(() => 0)).toBe(2_500);
    expect(botFollowUpDelayMs(() => 0.999999)).toBeLessThanOrEqual(5_000);
  });
});

describe("templates", () => {
  it("have unique ids and slot ids, and bot captions that fit", () => {
    expect(new Set(MEME_TEMPLATES.map((t) => t.id)).size).toBe(MEME_TEMPLATES.length);
    for (const template of MEME_TEMPLATES) {
      expect(new Set(template.slots.map((s) => s.id)).size).toBe(template.slots.length);
      const bank = BOT_CAPTIONS[template.id];
      expect(bank?.length).toBeGreaterThan(0);
      for (const captions of bank ?? []) {
        for (const [id, text] of Object.entries(captions)) {
          const slot = template.slots.find((s) => s.id === id);
          expect(slot, `${template.id}.${id}`).toBeDefined();
          expect(text.length).toBeLessThanOrEqual(slot!.maxLength);
        }
      }
    }
  });

  it("bot captions fit their slots without shrinking into mush or breaking words", () => {
    for (const template of MEME_TEMPLATES) {
      for (const captions of BOT_CAPTIONS[template.id] ?? []) {
        for (const slot of template.slots) {
          const text = captions[slot.id];
          if (!text) continue;
          const full = slot.prefix ? `${slot.prefix} ${text}` : text;
          const { lines, size } = layoutCaption(slot, full);
          expect(lines.length).toBeLessThanOrEqual(slot.maxLines);
          expect(size).toBeGreaterThanOrEqual(slot.size * 0.42);
          // Every wrapped word is a whole word of the caption.
          const words = new Set(full.toUpperCase().split(/\s+/));
          for (const line of lines) for (const w of line.toUpperCase().split(" ")) expect(words).toContain(w);
        }
      }
    }
  });
});

describe("renderMemeSvg", () => {
  it("escapes script-like captions and stays well-formed", () => {
    const entry = sanitizeEntry({
      templateId: "nobody-me",
      captions: { me: `<script>alert("x")</script> & 'friends' ]]> <!-- -->` },
      stickers: [{ emoji: "🔥", x: 0.5, y: 0.5, scale: 1, rotate: 0 }],
    });
    const svg = renderMemeSvg(entry);
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("<!--");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg.startsWith("<svg")).toBe(true);
    assertWellFormed(svg);
  });

  it("escapes every template in every mode", () => {
    for (const template of MEME_TEMPLATES) {
      const captions = Object.fromEntries(template.slots.map((s) => [s.id, `</text><script>1</script>"'&`]));
      const entry = sanitizeEntry({ templateId: template.id, captions, stickers: [{ emoji: "💀", x: 0.3, y: 0.3, scale: 1.2, rotate: 12 }] });
      for (const options of [{}, { placeholders: true }, { placeholders: true, withoutStickers: true }]) {
        const svg = renderMemeSvg(entry, options);
        expect(svg).not.toMatch(/<script/i);
        assertWellFormed(svg);
      }
      assertWellFormed(renderMemeSvg({ templateId: template.id, captions: {}, stickers: [] }, { placeholders: true }));
    }
  });

  it("drops characters XML forbids and never throws on lone surrogates", () => {
    const svg = renderMemeSvg({
      templateId: "pov",
      captions: { pov: "a\u0000b\u0008c \uD83D tail 😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂😂" },
      stickers: [],
    });
    expect(svg).not.toMatch(/[\u0000-\u0008]/);
    expect(() => svgToDataUrl(svg)).not.toThrow();
    assertWellFormed(svg);
  });

  it("never writes NaN for broken sticker data", () => {
    const svg = renderMemeSvg({
      templateId: "pov",
      captions: {},
      stickers: [{ emoji: "🔥", x: Number.NaN, y: Number.NaN, scale: Number.NaN, rotate: Number.NaN }],
    });
    expect(svg).not.toContain("NaN");
  });

  it("escapeXml covers all five specials", () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;");
  });

  it("shrinks long captions to fit instead of overflowing", () => {
    const slot = getTemplate("stone-face").slots[0]!;
    const long = layoutCaption(slot, "when you finally understand the assignment but it was due yesterday at noon");
    expect(long.lines.length).toBeLessThanOrEqual(slot.maxLines);
    expect(long.size).toBeLessThan(slot.size);
    for (const width of long.widths) expect(width).toBeLessThanOrEqual(slot.width);
  });

  it("splits huge unbroken words between graphemes, never inside an emoji", () => {
    const slot = getTemplate("two-buttons").slots[0]!;
    const { lines } = layoutCaption(slot, "👨‍👩‍👧".repeat(12));
    for (const line of lines) expect(line.replaceAll("👨‍👩‍👧", "")).toBe("");
  });
});
