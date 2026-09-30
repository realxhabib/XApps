import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import { manifestOf } from "@/platform/shipping";
import { diffManifests } from "./manifest-diff";

describe("diffManifests: kind", () => {
  const manifest = manifestOf(getOfficialApp("rps-showdown")!);
  const side = (m = manifest) => ({ url: "https://example.com", manifest: m });

  it("reports a switch between game and app", () => {
    const change = diffManifests(side(), side({ ...manifest, kind: "app", category: "news" })).find((c) => c.key === "kind");
    expect(change).toEqual({ key: "kind", label: "Kind", kind: "changed", before: "Game", after: "App", long: undefined });
  });

  it("treats a manifest without kind as a game", () => {
    const legacy = { ...manifest };
    delete legacy.kind;
    expect(diffManifests(side(legacy), side()).some((c) => c.key === "kind")).toBe(false);
    expect(diffManifests(null, side(legacy)).find((c) => c.key === "kind")?.after).toBe("Game");
  });
});
