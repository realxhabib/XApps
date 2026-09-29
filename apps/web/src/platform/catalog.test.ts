import { describe, expect, it } from "vitest";
import { OFFICIAL_APPS, achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "./catalog";

/** First-party apps that declare stats + achievements. The catalog is the source of truth: `npm run sync-apps` writes it to Supabase. */
const WITH_PROGRESS = ["quick-draw", "four-in-a-row", "trivia-royale", "emoji-decode", "hot-takes"];

describe("official catalog", () => {
  it("every official manifest is valid (strict one-emoji icons)", () => {
    for (const app of OFFICIAL_APPS) {
      expect(manifestShapeError(app), app.slug).toBeNull();
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
