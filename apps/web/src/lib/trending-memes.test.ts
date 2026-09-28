import { describe, expect, it } from "vitest";
import { postIdsFromGrok } from "./trending-memes";

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
    expect(postIdsFromGrok(response)).toEqual([
      "1901000000000000001",
      "1901000000000000002",
      "1901000000000000003",
      "1901000000000000004",
    ]);
  });

  it("ignores junk", () => {
    expect(postIdsFromGrok(null)).toEqual([]);
    expect(postIdsFromGrok({ output: "https://evil.com/x.com/a/status/123456" })).toEqual([]);
  });
});
