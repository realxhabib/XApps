import { describe, expect, it } from "vitest";
import { OFFICIAL_APPS, getOfficialApp } from "./catalog";
import {
  OFFICIAL_APP_COLUMNS,
  canonicalJson,
  catalogSlugs,
  officialAppRow,
  officialAppRowError,
  officialAppRows,
  officialCatalogApps,
  planOfficialAppSync,
  type OfficialAppRow,
} from "./official-apps";
import type { AppManifest } from "./types";

const base: AppManifest = {
  slug: "test-app",
  name: "Test App",
  tagline: "A tagline.",
  description: "A description.",
  category: "games",
  icon: "🎯",
  accent: ["#112233", "#aabbcc"],
  url: "/embed/test-app",
  modes: ["live", "practice"],
  players: { min: 2, max: 2 },
  scoring: "high",
  durationLabel: "~1 min",
  howTo: ["Step one.", "Step two."],
  official: true,
  developer: { id: null, handle: "xapps", name: "XApps Studio" },
  status: "published",
  playCount: 123,
  createdAt: "2026-09-01T00:00:00.000Z",
  tags: ["a", "b"],
};

describe("officialAppRow", () => {
  it("maps a manifest to exactly the seeded columns, with column defaults for absent fields", () => {
    expect(officialAppRow(base)).toEqual({
      slug: "test-app",
      name: "Test App",
      tagline: "A tagline.",
      description: "A description.",
      category: "games",
      icon: "🎯",
      accent_from: "#112233",
      accent_to: "#aabbcc",
      url: "/embed/test-app",
      modes: ["live", "practice"],
      min_players: 2,
      max_players: 2,
      team_count: 0,
      allow_spectators: true,
      has_setup: false,
      turn_based: false,
      scoring: "high",
      votes_to_win: 5,
      duration_label: "~1 min",
      how_to: ["Step one.", "Step two."],
      tags: ["a", "b"],
      official: true,
      status: "published",
      stats: [],
      achievements: [],
      kind: "game",
    });
  });

  it("syncs kind: official apps are games unless the catalog says otherwise", () => {
    for (const app of OFFICIAL_APPS.filter((a) => a.official)) expect(officialAppRow(app).kind, app.slug).toBe(app.kind ?? "game");
    expect(officialAppRow(base).kind).toBe("game");
    expect(officialAppRow({ ...base, kind: "app" }).kind).toBe("app");
    expect(officialAppRowError({ ...officialAppRow(base), kind: "widget" as never })).toMatch(/kind/);
    expect(OFFICIAL_APP_COLUMNS).toContain("kind");
  });

  it("gives a standalone app (kind app) harmless match columns: it has no matches", () => {
    const app: AppManifest = {
      ...base,
      kind: "app",
      category: "tools",
      modes: [],
      players: { min: 1, max: 1 },
      teams: 2,
      setup: true,
      turnBased: true,
      spectators: false,
      stats: [{ key: "best", label: "Best", aggregate: "max", format: "percent" }],
    };
    const row = officialAppRow(app);
    expect(row).toMatchObject({
      kind: "app",
      modes: ["live", "practice"],
      min_players: 2,
      max_players: 2,
      team_count: 0,
      has_setup: false,
      turn_based: false,
      allow_spectators: false,
      stats: [{ key: "best", label: "Best", aggregate: "max", format: "percent" }],
    });
    expect(officialAppRowError(row)).toBeNull();
    expect(officialAppRows([app]).map((r) => r.slug)).toEqual(["test-app"]);
    // Valid match fields are kept as declared.
    expect(officialAppRow({ ...app, modes: ["live"], players: { min: 2, max: 4 } })).toMatchObject({ modes: ["live"], min_players: 2, max_players: 4 });
    // Games are still held to the table's checks.
    expect(() => officialAppRows([{ ...base, modes: [] }])).toThrow(/modes/);
  });

  it("carries v2 fields, votes and progress through", () => {
    const row = officialAppRow({
      ...base,
      players: { min: 2, max: 8 },
      teams: 2,
      spectators: false,
      setup: true,
      turnBased: true,
      scoring: "votes",
      votesToWin: 7,
      stats: [{ key: "wins", label: "Wins", aggregate: "sum", format: "number" }],
      achievements: [{ id: "first", name: "First", description: "Win once.", icon: "🏆", xp: 10, secret: true }],
    });
    expect(row).toMatchObject({
      min_players: 2,
      max_players: 8,
      team_count: 2,
      allow_spectators: false,
      has_setup: true,
      turn_based: true,
      scoring: "votes",
      votes_to_win: 7,
      stats: [{ key: "wins", label: "Wins", aggregate: "sum", format: "number" }],
      achievements: [{ id: "first", name: "First", description: "Win once.", icon: "🏆", xp: 10, secret: true }],
    });
  });

  it("never sends platform-owned columns", () => {
    const row = officialAppRow(base) as unknown as Record<string, unknown>;
    for (const col of ["play_count", "upvotes", "created_at", "updated_at", "developer_id", "authority", "published_version_id"]) {
      expect(row, col).not.toHaveProperty(col);
    }
  });

  it("does not share arrays with the catalog", () => {
    const row = officialAppRow(base);
    row.tags.push("c");
    expect(base.tags).toEqual(["a", "b"]);
  });
});

describe("official catalog rows", () => {
  it("syncs every app flagged official, and only those", () => {
    const slugs = officialCatalogApps().map((a) => a.slug);
    expect(slugs).toEqual(OFFICIAL_APPS.filter((a) => a.official).map((a) => a.slug));
    expect(slugs).toContain("wedge-wars");
    // The RPS example is listed in the catalog as a community app.
    expect(slugs).not.toContain("rps-showdown");
    expect(catalogSlugs()).toContain("rps-showdown");
  });

  it("every row has exactly the synced columns and passes the table checks", () => {
    const rows = officialAppRows();
    expect(rows.length).toBe(officialCatalogApps().length);
    for (const row of rows) {
      expect(Object.keys(row).sort(), row.slug).toEqual([...OFFICIAL_APP_COLUMNS].sort());
      expect(officialAppRowError(row), row.slug).toBeNull();
    }
  });

  it("mirrors the catalog entry (e.g. Wedge Wars)", () => {
    const app = getOfficialApp("wedge-wars")!;
    const row = officialAppRows().find((r) => r.slug === "wedge-wars")!;
    expect(row).toMatchObject({
      name: app.name,
      min_players: app.players.min,
      max_players: app.players.max,
      how_to: app.howTo,
      stats: app.stats,
      achievements: app.achievements,
    });
  });

  it("rejects duplicate slugs and rows the database would refuse", () => {
    expect(() => officialAppRows([base, base])).toThrow(/Duplicate/);
    expect(() => officialAppRows([{ ...base, tags: Array(9).fill("t") }])).toThrow(/tags/);
    expect(officialAppRows([{ ...base, official: false }])).toEqual([]);
  });
});

describe("officialAppRowError", () => {
  const row = officialAppRow(base);
  it.each<[string, Partial<OfficialAppRow>, RegExp]>([
    ["slug", { slug: "Bad Slug" }, /slug/],
    ["name", { name: "X" }, /name/],
    ["tagline", { tagline: "x".repeat(91) }, /tagline/],
    ["description", { description: "x".repeat(1201) }, /description/],
    ["icon", { icon: "ab" }, /icon/],
    ["accent", { accent_to: "red" }, /accent/],
    ["url", { url: "https://example.com" }, /same-origin/],
    ["modes", { modes: [] }, /modes/],
    ["votes", { votes_to_win: 0 }, /votesToWin/],
    ["duration", { duration_label: "x".repeat(31) }, /durationLabel/],
    ["howTo", { how_to: Array(7).fill("s") }, /howTo/],
    ["players", { min_players: 3, max_players: 2 }, /Players/],
    ["teams", { max_players: 3, team_count: 2 }, /multiple/],
    ["stats", { stats: [{ key: "Bad", label: "x", aggregate: "sum", format: "number" }] }, /./],
  ])("%s", (_name, patch, message) => {
    expect(officialAppRowError({ ...row, ...patch })).toMatch(message);
  });

  it("counts characters like Postgres (code points)", () => {
    expect(officialAppRowError({ ...row, tagline: "🔥".repeat(90) })).toBeNull();
  });
});

describe("planOfficialAppSync", () => {
  const row = officialAppRow(base);
  const withStats = officialAppRow({
    ...base,
    slug: "with-stats",
    stats: [{ key: "wins", label: "Wins", aggregate: "sum", format: "number" }],
  });

  it("inserts new slugs, updates changed columns, leaves equal rows alone", () => {
    const plan = planOfficialAppSync(
      [row, withStats, { ...row, slug: "brand-new" }],
      [
        { ...row, tagline: "Old tagline.", tags: ["a"] },
        // jsonb reorders object keys; that is not a change.
        { ...withStats, stats: [{ format: "number", aggregate: "sum", label: "Wins", key: "wins" }] },
      ],
    );
    expect(plan.map(({ slug, action, changed }) => ({ slug, action, changed }))).toEqual([
      { slug: "test-app", action: "update", changed: ["tagline", "tags"] },
      { slug: "with-stats", action: "unchanged", changed: [] },
      { slug: "brand-new", action: "insert", changed: [] },
    ]);
  });

  it("refuses to take over a community app's slug", () => {
    const [step] = planOfficialAppSync([row], [{ ...row, official: false }]);
    expect(step?.action).toBe("conflict");
    expect(step?.reason).toMatch(/community app/);
  });

  it("canonicalJson ignores key order and undefined", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] })).toBe(canonicalJson({ a: [{ d: 2 }], b: 1 }));
  });
});
