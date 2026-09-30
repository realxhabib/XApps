import { describe, expect, it } from "vitest";
import { FEATURED_APPS, FEATURED_FALLBACK, OFFICIAL_APPS, getOfficialApp } from "./catalog";
import { RETIRED_APPS, appForSlug, getRetiredApp, isRetiredApp, retiredAppManifest } from "./retired-apps";

describe("retired first-party apps", () => {
  it("are gone from the catalog and the home page lists", () => {
    for (const { slug } of RETIRED_APPS) {
      expect(getOfficialApp(slug), slug).toBeUndefined();
      expect([...FEATURED_APPS, ...FEATURED_FALLBACK], slug).not.toContain(slug);
    }
    expect(OFFICIAL_APPS.some((a) => isRetiredApp(a.slug))).toBe(false);
  });

  it("keep their name and colors for history, never playable", () => {
    const app = retiredAppManifest("trivia-royale");
    expect(app).toMatchObject({ slug: "trivia-royale", name: "Trivia Royale", icon: "👑", retired: true, status: "rejected", url: "", modes: [] });
    expect(retiredAppManifest("some-old-app")).toMatchObject({ slug: "some-old-app", name: "Retired app", retired: true, official: false });
  });

  it("resolve a match's app: listed, then catalog, then the retired stand-in", () => {
    expect(appForSlug("quick-draw")?.name).toBe("Reflexes");
    expect(appForSlug("hot-takes")).toMatchObject({ name: "Hot Takes", retired: true });
    expect(appForSlug("emoji-decode", [])).toMatchObject({ name: "Emoji Decode", retired: true });
    expect(appForSlug("unknown-app")).toBeUndefined();
    expect(getRetiredApp("quick-draw")).toBeUndefined();
  });
});
