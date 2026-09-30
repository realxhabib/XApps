import { describe, expect, it } from "vitest";
import { CARD_POINTS, circleArt, circleSvg, decodeCard, encodeCard, shareText } from "./card";
import { BOARD, analyzeStroke, synthCircle } from "./logic";

describe("Perfect Circle share cards", () => {
  const stroke = synthCircle({ radius: 320, harmonics: [{ k: 2, amp: 0.02, phase: 0.3 }] });

  it("round-trips the score and the circle through a short URL-safe code", () => {
    const code = encodeCard({ accuracy: 97.3, stroke });
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(220);
    const card = decodeCard(code);
    expect(card?.accuracy).toBe(97.3);
    expect(card?.stroke).toHaveLength(CARD_POINTS);
    // Quantised to 1/255 of the board: the redrawn circle is the same circle.
    const redrawn = analyzeStroke(card!.stroke);
    const original = analyzeStroke(stroke);
    expect(redrawn.radius).toBeCloseTo(original.radius, -1);
    for (const p of card!.stroke) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(BOARD);
    }
  });

  it("keeps 100.0 and 0.0", () => {
    expect(decodeCard(encodeCard({ accuracy: 100, stroke }))?.accuracy).toBe(100);
    expect(decodeCard(encodeCard({ accuracy: 0, stroke }))?.accuracy).toBe(0);
  });

  it("refuses anything it didn't write", () => {
    expect(decodeCard("")).toBeNull();
    expect(decodeCard("not a code!")).toBeNull();
    expect(decodeCard("AQ")).toBeNull();
    expect(decodeCard("x".repeat(500))).toBeNull();
    const code = encodeCard({ accuracy: 50, stroke });
    // Wrong version byte.
    expect(decodeCard(`B${code.slice(1)}`)).toBeNull();
    // Score over 100.0 (tenths 1001 = 0x03E9).
    const bytes = Uint8Array.from(atob(code.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (code.length % 4)) % 4)), (c) => c.charCodeAt(0));
    bytes[1] = 0x03;
    bytes[2] = 0xe9;
    const forged = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeCard(forged)).toBeNull();
  });

  it("share text", () => {
    expect(shareText(97.3)).toBe("I drew a 97.3% perfect circle on XApps 🎯 Can you beat it?");
    expect(shareText(88)).toContain("88.0%");
  });

  it("colours each segment and finds the ideal circle", () => {
    const art = circleArt(stroke, 500);
    expect(art.center).toEqual({ x: 250, y: 250 });
    expect(art.radius).toBeCloseTo(160, -1);
    expect(art.segments.length).toBeLessThanOrEqual(120);
    expect(art.segments.every((s) => /^rgb\(\d+,\d+,\d+\)$/.test(s.color))).toBe(true);
  });

  it("renders a self-contained SVG entry", () => {
    const svg = circleSvg(stroke, 97.3);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("97.3%");
    expect(svg).not.toMatch(/<script|href=/);
    expect(new TextEncoder().encode(svg).length).toBeLessThan(16_000);
    expect(circleSvg(stroke, null)).not.toContain("<text");
  });
});
