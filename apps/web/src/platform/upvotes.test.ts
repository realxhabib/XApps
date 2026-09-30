import { describe, expect, it } from "vitest";
import { OFFICIAL_APPS } from "./catalog";
import type { AppManifest } from "./types";
import { compareByUpvotes, sortApps, upvoteBlocker, withUpvote, withUpvoteResult } from "./upvotes";

const app = (slug: string, extra: Partial<AppManifest> = {}): AppManifest => ({
  ...OFFICIAL_APPS[0]!,
  slug,
  name: slug,
  ...extra,
});

describe("upvotes", () => {
  it("sorts by most upvoted, then plays, then newest", () => {
    const apps = [
      app("a", { upvotes: 3, playCount: 1, createdAt: "2026-01-01T00:00:00.000Z" }),
      app("b", { upvotes: 9, playCount: 0, createdAt: "2026-01-01T00:00:00.000Z" }),
      app("c", { upvotes: 3, playCount: 5, createdAt: "2026-01-01T00:00:00.000Z" }),
      app("d", { upvotes: undefined, playCount: 0, createdAt: "2026-03-01T00:00:00.000Z" }),
      app("e", { upvotes: 0, playCount: 0, createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(sortApps(apps, "top").map((a) => a.slug)).toEqual(["b", "c", "a", "d", "e"]);
    expect(sortApps(apps, "new").map((a) => a.slug)).toEqual(["d", "e", "a", "b", "c"]);
    expect(apps.map((a) => a.slug)).toEqual(["a", "b", "c", "d", "e"]);
    expect(compareByUpvotes(apps[0]!, apps[0]!)).toBe(0);
  });

  it("applies a toggle once (the optimistic update)", () => {
    const before = app("a", { upvotes: 4, upvoted: false });
    const on = withUpvote(before, true);
    expect(on).toMatchObject({ upvotes: 5, upvoted: true });
    expect(withUpvote(on, true)).toBe(on);
    expect(withUpvote(on, false)).toMatchObject({ upvotes: 4, upvoted: false });
    // Unknown state (placeholder data) counts as not upvoted; never below zero.
    expect(withUpvote(app("b"), true)).toMatchObject({ upvotes: 1, upvoted: true });
    expect(withUpvote(app("c", { upvotes: 0, upvoted: true }), false)).toMatchObject({ upvotes: 0, upvoted: false });
    expect(withUpvoteResult(on, { upvotes: 40, upvoted: true })).toMatchObject({ upvotes: 40, upvoted: true });
  });

  it("knows who can't upvote", () => {
    const mine = app("a", { developer: { id: "me", handle: "me", name: "Me" }, status: "published" });
    expect(upvoteBlocker(mine, "me")).toMatch(/your own app/);
    expect(upvoteBlocker(mine, "you")).toBeNull();
    expect(upvoteBlocker(mine, null)).toBeNull();
    expect(upvoteBlocker({ ...mine, status: "pending" }, "you")).toMatch(/published/);
  });
});
