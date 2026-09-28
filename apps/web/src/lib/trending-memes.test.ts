import { describe, expect, it } from "vitest";
import { extractJson, matchImgflip, outputText, parseFormats, parseLayout, postIdsFromGrok } from "./trending-memes";

describe("postIdsFromGrok", () => {
  it("finds post links in text, annotations and citations, deduped in order", () => {
    const response = {
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: '["https://x.com/alice/status/1901000000000000001", "https://twitter.com/bob/status/1901000000000000002?s=20"]',
              annotations: [{ type: "url_citation", url: "https://x.com/carol/status/1901000000000000003" }],
            },
          ],
        },
      ],
      citations: ["https://x.com/alice/status/1901000000000000001", "https://example.com/not-a-post", "https://x.com/i/web/status/1901000000000000004"],
    };
    expect(postIdsFromGrok(response)).toEqual(["1901000000000000001", "1901000000000000002", "1901000000000000003", "1901000000000000004"]);
  });

  it("ignores junk", () => {
    expect(postIdsFromGrok(null)).toEqual([]);
    expect(postIdsFromGrok({ output: "https://evil.com/x.com/a/status/123456" })).toEqual([]);
  });
});

describe("Grok answers", () => {
  it("reads output text and pulls JSON out of fenced chatter", () => {
    const response = { output: [{ type: "message", content: [{ type: "output_text", text: 'Here you go:\n```json\n{"formats":[]}\n```' }] }] };
    expect(extractJson(outputText(response))).toEqual({ formats: [] });
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });

  it("validates formats", () => {
    const formats = parseFormats({
      formats: [
        {
          name: "  Two   Buttons ",
          why: "everyone is choosing",
          examples: ["https://x.com/a/status/1901000000000000001", "not a link", 7],
          imgflip_name: "Two Buttons",
          blank_post: "https://evil.com/status/1",
        },
        { name: "", why: "no name" },
        "junk",
        { name: "New Thing", blank_post: "https://x.com/b/status/1901000000000000009" },
      ],
    });
    expect(formats).toEqual([
      { name: "Two Buttons", why: "everyone is choosing", examples: ["https://x.com/a/status/1901000000000000001"], imgflipName: "Two Buttons", blankPost: null },
      { name: "New Thing", why: "", examples: [], imgflipName: null, blankPost: "https://x.com/b/status/1901000000000000009" },
    ]);
    expect(parseFormats(null)).toEqual([]);
  });

  it("matches imgflip names loosely", () => {
    const templates = [{ name: "Drake Hotline Bling" }, { name: "Two Buttons" }, { name: "Bernie I Am Once Again Asking For Your Support" }];
    expect(matchImgflip("two buttons", templates)?.name).toBe("Two Buttons");
    expect(matchImgflip("Drake", templates)).toBeUndefined(); // too loose to trust
    expect(matchImgflip("Bernie Once Again Asking", templates)).toBeUndefined();
    expect(matchImgflip("drake hotline bling meme", templates)?.name).toBe("Drake Hotline Bling");
    expect(matchImgflip("", templates)).toBeUndefined();
  });

  it("sanitizes caption layouts", () => {
    const slots = parseLayout({
      slots: [
        { label: "Button A", x: 0.1, y: 0.05, w: 0.3, h: 0.1, style: "label" },
        { label: "Sweating guy", x: 0.9, y: 0.95, w: 0.4, h: 0.2 },
        { label: "tiny", x: 0.1, y: 0.1, w: 0.01, h: 0.01 },
        { label: "nan", x: Number.NaN, y: 0, w: 0.5, h: 0.2 },
      ],
    });
    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ id: "s1", label: "Button A", style: "label" });
    // Pushed back inside the image.
    expect(slots[1].x + slots[1].w).toBeLessThanOrEqual(1);
    expect(slots[1].y + slots[1].h).toBeLessThanOrEqual(1);
    expect(slots[1].style).toBe("impact");
  });
});
