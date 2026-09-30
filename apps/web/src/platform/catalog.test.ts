import { describe, expect, it } from "vitest";
import { OFFICIAL_APPS, achievementDefsError, getOfficialApp, manifestShapeError, statDefsError, withManifestDefaults } from "./catalog";

/** First-party apps that declare stats + achievements. The catalog is the source of truth: `npm run sync-apps` writes it to Supabase. */
const WITH_PROGRESS = ["quick-draw", "four-in-a-row", "wedge-wars"];

describe("official catalog", () => {
  it("every official manifest is valid (strict one-emoji icons)", () => {
    for (const app of OFFICIAL_APPS) {
      // Standalone apps (kind app) have no matches: only their progress is checked here (the sync
      // gives them harmless match columns, see official-apps.ts).
      const shape = app.kind === "app" ? { stats: app.stats, achievements: app.achievements } : app;
      expect(manifestShapeError(shape), app.slug).toBeNull();
    }
  });

  it.each(WITH_PROGRESS)("%s declares 2–4 stats and 6–10 achievements", (slug) => {
    const app = getOfficialApp(slug);
    expect(app?.stats?.length).toBeGreaterThanOrEqual(2);
    expect(app?.stats?.length).toBeLessThanOrEqual(4);
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(statDefsError(app?.stats)).toBeNull();
    expect(achievementDefsError(app?.achievements)).toBeNull();
    // A couple of harder ones stay a surprise.
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
    for (const a of app?.achievements ?? []) expect(a.description.length, a.id).toBeGreaterThan(0);
  });
});

describe("app kind", () => {
  it("defaults to a game; official apps are games unless they say kind app", () => {
    for (const app of OFFICIAL_APPS) expect(withManifestDefaults(app).kind, app.slug).toBe(app.kind === "app" ? "app" : "game");
    expect(withManifestDefaults({ ...OFFICIAL_APPS[0]!, kind: undefined }).kind).toBe("game");
    expect(withManifestDefaults({ ...OFFICIAL_APPS[0]!, kind: "app" }).kind).toBe("app");
  });

  it("official standalone apps are served from /embed and declare no match-only features", () => {
    for (const app of OFFICIAL_APPS.filter((a) => a.kind === "app")) {
      expect(app.url, app.slug).toBe(`/embed/${app.slug}`);
      expect(app.setup ?? false, app.slug).toBe(false);
      expect(app.turnBased ?? false, app.slug).toBe(false);
      expect(app.teams ?? 0, app.slug).toBe(0);
    }
  });
});
