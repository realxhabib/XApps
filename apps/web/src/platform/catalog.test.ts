import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OFFICIAL_APPS, achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "./catalog";

/** First-party apps whose stats + achievements ship in 20261002000200_first_party_progress.sql. */
const WITH_PROGRESS = ["quick-draw", "four-in-a-row", "trivia-royale", "emoji-decode", "hot-takes"];

const migration = readFileSync(
  fileURLToPath(new URL("../../../../supabase/migrations/20261002000200_first_party_progress.sql", import.meta.url)),
  "utf8",
);

/** `{ slug: { stats, achievements } }` as the migration writes them. */
function migrationManifests(): Record<string, { stats: unknown; achievements: unknown }> {
  const out: Record<string, { stats: unknown; achievements: unknown }> = {};
  const re = /stats = \$json\$([\s\S]*?)\$json\$::jsonb,\s*achievements = \$json\$([\s\S]*?)\$json\$::jsonb\s*where slug = '([a-z0-9-]+)';/g;
  for (const m of migration.matchAll(re)) {
    out[m[3] as string] = { stats: JSON.parse(m[1] as string), achievements: JSON.parse(m[2] as string) };
  }
  return out;
}

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

  it("the progress migration matches the catalog exactly", () => {
    const sql = migrationManifests();
    expect(Object.keys(sql).sort()).toEqual([...WITH_PROGRESS].sort());
    for (const slug of WITH_PROGRESS) {
      const app = getOfficialApp(slug);
      expect(sql[slug], slug).toEqual({ stats: app?.stats, achievements: app?.achievements });
    }
  });
});
