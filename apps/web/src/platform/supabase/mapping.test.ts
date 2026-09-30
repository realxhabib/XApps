import { describe, expect, it } from "vitest";
import { toAppLaunch, toAppLoose, toKind, toVersionManifest } from "./mapping";
import type { Match, Profile, RegisterAppInput, StatDef } from "../types";
import {
  appInsert,
  challengeArgs,
  errorKind,
  normalizeMatch,
  toApp,
  toBackendError,
  toSecret,
  toServerConfig,
  toWebhookDeliveries,
  type AppRow,
  toStatLeaderRows,
  toStatValues,
  toStorageKeys,
  toUnlocked,
  toUserAchievements,
  toUserStats,
  practiceArgs,
  quickMatchArgs,
  toAnalytics,
  toAppLogs,
  toAppVersion,
  toAppVersionResult,
  toAppVersions,
  toProfiles,
  toReviewQueue,
  toNotices,
} from "./mapping";

const profile = (id: string): Profile => ({
  id,
  handle: id,
  name: id,
  avatarUrl: null,
  bio: "",
  xp: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  streak: 0,
  bestStreak: 0,
  createdAt: "",
});

/** A match_json row as the v1 schema returns it (no v2 fields). */
const v1Match = {
  id: "m1",
  appSlug: "emoji-decode",
  mode: "live",
  status: "completed",
  scoring: "high",
  seed: "s",
  createdBy: "a",
  createdAt: "",
  startedAt: null,
  endedAt: null,
  winnerId: "a",
  isOpen: false,
  settings: {},
  votes: {},
  votesNeeded: 0,
  votingEndsAt: null,
  simulatedVotes: false,
  players: [
    { userId: "a", seat: 0, state: "submitted", isBot: false, score: 3, result: "win", xpDelta: 30, lastSeenAt: null, submission: null, profile: profile("a") },
    { userId: "b", seat: 1, state: "submitted", isBot: false, score: 1, result: "loss", xpDelta: 8, lastSeenAt: null, submission: null, profile: profile("b") },
  ],
} as unknown as Match;

const appRow: AppRow = {
  slug: "community",
  name: "Community",
  tagline: "",
  description: "",
  category: "games",
  icon: "🎲",
  accent_from: "#000",
  accent_to: "#fff",
  url: "https://x.test",
  modes: ["live"],
  min_players: 2,
  max_players: 2,
  scoring: "high",
  votes_to_win: 5,
  duration_label: "",
  how_to: [],
  tags: [],
  official: false,
  developer_id: null,
  status: "published",
  play_count: 0,
  created_at: "",
};

describe("normalizeMatch", () => {
  it("defaults v2 fields for a v1 match_json row", () => {
    const m = normalizeMatch(v1Match);
    expect(m).toMatchObject({
      minPlayers: 2,
      maxPlayers: 2,
      teams: 0,
      winnerTeam: null,
      spectatorCount: 0,
      state: null,
      stateVersion: 0,
      turnUserId: null,
      turnDeadline: null,
      round: 0,
    });
    expect(m.players.map((p) => [p.role, p.team, p.rank])).toEqual([
      ["player", null, 1],
      ["player", null, 2],
    ]);
  });

  it("keeps v2 fields when present", () => {
    const m = normalizeMatch({
      ...v1Match,
      minPlayers: 3,
      maxPlayers: 6,
      teams: 2,
      winnerTeam: 1,
      spectatorCount: 4,
      stateVersion: 7,
      state: { x: 1 },
      players: [{ ...v1Match.players[0]!, team: 0, role: "player", rank: 2 }, { ...v1Match.players[1]!, seat: null, role: "spectator", team: null, rank: null }],
    });
    expect(m).toMatchObject({ minPlayers: 3, maxPlayers: 6, teams: 2, winnerTeam: 1, spectatorCount: 4, stateVersion: 7 });
    expect(m.players.map((p) => [p.role, p.seat, p.team, p.rank])).toEqual([
      ["player", 0, 0, 2],
      ["spectator", null, null, null],
    ]);
  });
});

describe("apps", () => {
  it("reads v2 manifest columns with defaults", () => {
    expect(toApp(appRow)).toMatchObject({ players: { min: 2, max: 2 }, teams: 0, spectators: true, setup: false, turnBased: false });
    expect(toApp({ ...appRow, max_players: 4, team_count: 2, allow_spectators: false, has_setup: true, turn_based: true })).toMatchObject({
      players: { min: 2, max: 4 },
      teams: 2,
      spectators: false,
      setup: true,
      turnBased: true,
    });
  });

  it("gives official apps their catalog manifest with defaults", () => {
    expect(toApp({ ...appRow, slug: "meme-duel", official: true, play_count: 9 })).toMatchObject({
      name: "Meme Duel",
      setup: true,
      spectators: true,
      playCount: 9,
    });
  });

  it("only sends v2 columns when they differ from the defaults", () => {
    const base = {
      slug: "x",
      name: "x",
      tagline: "",
      description: "",
      category: "games" as const,
      icon: "x",
      accent: ["#000", "#fff"] as [string, string],
      url: "https://x.test",
      modes: ["live" as const],
      scoring: "high" as const,
      howTo: [],
    };
    expect(Object.keys(appInsert(base))).not.toContain("team_count");
    expect(appInsert({ ...base, players: { min: 2, max: 4 }, teams: 2, spectators: false, setup: true, turnBased: true })).toMatchObject({
      min_players: 2,
      max_players: 4,
      team_count: 2,
      allow_spectators: false,
      has_setup: true,
      turn_based: true,
    });
  });
});

describe("create_challenge args", () => {
  it("keeps the v1 call shape for a 1v1", () => {
    expect(challengeArgs({ appSlug: "a", mode: "live", opponentHandle: "@Bob" })).toEqual({
      p_app: "a",
      p_mode: "live",
      p_opponent: "bob",
      p_settings: {},
    });
  });

  it("names p_opponents and p_max_players for multiplayer", () => {
    expect(challengeArgs({ appSlug: "a", mode: "async", opponentHandle: "bob", opponentHandles: ["carol", "bob"], maxPlayers: 4 })).toEqual({
      p_app: "a",
      p_mode: "async",
      p_opponent: null,
      p_settings: {},
      p_opponents: ["carol", "bob"],
      p_max_players: 4,
    });
  });
});

describe("errors", () => {
  it("maps state conflicts to conflict", () => {
    expect(errorKind("40001")).toBe("conflict");
    expect(errorKind(undefined, "state_conflict")).toBe("conflict");
    const error = toBackendError({ code: "40001", message: "state_conflict" });
    expect(error.code).toBe("conflict");
  });

  it("keeps the v1 mappings", () => {
    expect(errorKind("42501")).toBe("forbidden");
    expect(errorKind("22023")).toBe("invalid");
    expect(errorKind("55000")).toBe("conflict");
    expect(errorKind("P0002")).toBe("not_found");
    expect(toBackendError({ code: "PGRST202", message: "missing" }).code).toBe("setup_required");
  });
});

describe("stage 2 mapping", () => {
  it("maps apps.authority, defaulting to client", () => {
    expect(toApp(appRow).authority).toBe("client");
    expect(toApp({ ...appRow, authority: null }).authority).toBe("client");
    expect(toApp({ ...appRow, authority: "server" }).authority).toBe("server");
  });

  it("reads get_app_server_config in camelCase, snake_case, or as a one-row set", () => {
    const expected = { secretPrefix: "xas_ab12", hasSecret: true, webhookUrl: "https://h.test", hasWebhook: true, authority: "server" };
    expect(toServerConfig(expected)).toEqual(expected);
    expect(
      toServerConfig([{ secret_prefix: "xas_ab12", has_secret: true, webhook_url: "https://h.test", has_webhook: true, authority: "server" }]),
    ).toEqual(expected);
    expect(toServerConfig(null)).toEqual({ secretPrefix: null, hasSecret: false, webhookUrl: null, hasWebhook: false, authority: "client" });
  });

  it("maps deliveries newest first, coercing numbers", () => {
    const rows = toWebhookDeliveries([
      { id: "1", event: "ping", matchId: null, createdAt: "2026-01-01T00:00:00Z", attempts: 1, deliveredAt: null, lastStatus: "500", lastError: "boom" },
      { id: "2", event: "match.ended", match_id: "m", created_at: "2026-01-02T00:00:00Z", attempts: 2, delivered_at: "2026-01-02T00:01:00Z", last_status: 200, last_error: null },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["2", "1"]);
    expect(rows[0]).toMatchObject({ matchId: "m", lastStatus: 200, deliveredAt: "2026-01-02T00:01:00Z", lastError: null });
    expect(rows[1]).toMatchObject({ lastStatus: 500, attempts: 1, lastError: "boom" });
    expect(toWebhookDeliveries(null)).toEqual([]);
  });

  it("reads secrets returned as text or wrapped", () => {
    expect(toSecret("xas_1")).toBe("xas_1");
    expect(toSecret({ secret: "whsec_1" })).toBe("whsec_1");
    expect(toSecret([{ rotate_app_secret: "xas_2" }])).toBe("xas_2");
    expect(toSecret(null)).toBeNull();
  });
});

describe("Stage 3 mapping", () => {
  const stat = { key: "best_time", label: "Best time", aggregate: "min", format: "ms" };
  const achievement = { id: "first_win", name: "First win", description: "Win", icon: "🏆", xp: 25, secret: true };

  it("maps apps.stats / apps.achievements, dropping malformed entries", () => {
    const app = toApp({ ...appRow, stats: [stat, { key: "Bad" }], achievements: [achievement, { id: "x", name: "", icon: "", xp: 500 }] });
    expect(app.stats).toEqual([stat]);
    expect(app.achievements).toEqual([achievement]);
    expect(toApp(appRow).stats).toEqual([]);
    const input = { ...appRow, accent: ["#000", "#fff"], howTo: [] } as unknown as RegisterAppInput;
    expect(appInsert({ ...input, stats: [stat as StatDef], achievements: [] })).toMatchObject({ stats: [stat] });
    expect(appInsert(input)).not.toHaveProperty("stats");
  });

  it("maps leaderboard rows, user stats and achievements", () => {
    const profile = { id: "u1", handle: "ada", name: "Ada", avatarUrl: null, bio: "", xp: 5, wins: 1, losses: 0, draws: 0, streak: 1, bestStreak: 1, createdAt: "2026-01-01T00:00:00Z", isBot: false };
    expect(toStatLeaderRows([{ rank: 1, profile, value: 812 }, { rank: 2, profile: null, value: 1 }])).toEqual([{ rank: 1, profile, value: 812 }]);
    expect(toStatLeaderRows([{ rank: "2", profile: { ...profile, avatar_url: "x", avatarUrl: undefined }, value: "3.5" }])[0]).toMatchObject({ rank: 2, value: 3.5 });
    expect(toUserStats([{ appSlug: "a", key: "k", value: 2, updatedAt: "t" }, { key: "k" }])).toEqual([{ appSlug: "a", key: "k", value: 2, updatedAt: "t" }]);
    expect(toUserAchievements([{ appSlug: "a", achievementId: "x", unlockedAt: "t" }])).toEqual([{ appSlug: "a", achievementId: "x", unlockedAt: "t" }]);
    expect(toStatValues({ runs: 3, bad: "x" })).toEqual({ runs: 3 });
    expect(toUnlocked({ unlocked: true })).toEqual({ unlocked: true });
    expect(toUnlocked(false)).toEqual({ unlocked: false });
    expect(toStorageKeys(["b", "a", "a"])).toEqual(["a", "b"]);
  });

  it("maps limits (54000) to rate_limited", () => {
    expect(errorKind("54000", "Too many stat reports — slow down")).toBe("rate_limited");
    expect(toBackendError({ code: "54000", message: "Storage is full (200 keys)" }).code).toBe("rate_limited");
  });
});

describe("Stage 4 mapping", () => {
  const manifest = {
    name: "Gizmo",
    tagline: "Tap fast",
    description: "",
    category: "games",
    kind: "game",
    icon: "🎲",
    iconImage: null,
    coverImage: null,
    accent: ["#000000", "#ffffff"],
    modes: ["live", "practice"],
    players: { min: 2, max: 4 },
    teams: 0,
    spectators: true,
    setup: false,
    turnBased: false,
    scoring: "high",
    howTo: ["Tap"],
    stats: [],
    achievements: [],
  };
  const versionJson = {
    id: "v1",
    appSlug: "gizmo",
    version: "1.1.0",
    url: "https://example.com/next",
    manifest,
    status: "in_review",
    notes: "Bigger tables",
    reviewNotes: null,
    createdAt: "2026-10-01T00:00:00Z",
    submittedAt: "2026-10-01T01:00:00Z",
    reviewedAt: null,
    publishedAt: null,
    supersededBy: null,
  };

  it("maps versions from camelCase json or snake_case rows", () => {
    expect(toAppVersion(versionJson)).toEqual(versionJson);
    const snake = toAppVersion({
      id: "v2",
      app_slug: "gizmo",
      version: "1.0.0",
      url: "https://example.com",
      manifest: { ...manifest, accent: undefined, accent_from: "#111111", accent_to: "#222222", how_to: ["x"], howTo: undefined, turn_based: true, turnBased: undefined },
      status: "weird",
      notes: null,
      review_notes: "ok",
      created_at: "2026-09-01T00:00:00Z",
      published_at: "2026-09-02T00:00:00Z",
    });
    expect(snake).toMatchObject({ id: "v2", appSlug: "gizmo", status: "draft", notes: "", reviewNotes: "ok", publishedAt: "2026-09-02T00:00:00Z", submittedAt: null });
    expect(snake!.manifest).toMatchObject({ accent: ["#111111", "#222222"], howTo: ["x"], turnBased: true, players: { min: 2, max: 4 } });
    expect(toAppVersion({ id: "x" })).toBeNull();
    expect(toAppVersions([versionJson, null, { nope: 1 }])).toHaveLength(1);
    expect(toAppVersions({ versions: [versionJson] })).toHaveLength(1);
    expect(toAppVersions(null)).toEqual([]);
    expect(toAppVersionResult([versionJson])!.id).toBe("v1");
    expect(toAppVersionResult({ version: versionJson })!.id).toBe("v1");
    expect(toAppVersionResult("v1")).toBeNull();
  });

  it("maps tester lists and admin profiles", () => {
    const ada = { ...profile("u1"), isAdmin: true };
    expect(toProfiles([ada, { profile: profile("u2") }, { junk: true }]).map((p) => [p.id, p.isAdmin])).toEqual([
      ["u1", true],
      ["u2", undefined],
    ]);
    expect(toProfiles({ testers: [profile("u3")] })).toHaveLength(1);
    expect(toProfiles(null)).toEqual([]);
  });

  it("maps the review queue with an apps row or a camelCase app", () => {
    const queue = toReviewQueue([
      { version: versionJson, app: { ...appRow, slug: "gizmo" }, developer: profile("dev"), published: { ...versionJson, id: "v0", version: "1.0.0", status: "published" } },
      { ...versionJson, id: "v9", appSlug: "", app: { slug: "camel", ...manifest, url: "https://c.example", developer: { id: "d2", handle: "dee", name: "Dee" }, status: "published" } },
      { version: versionJson, app: null },
    ]);
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ version: { id: "v1" }, app: { slug: "gizmo" }, developer: { id: "dev" }, published: { id: "v0" } });
    expect(queue[1]).toMatchObject({ version: { id: "v9", appSlug: "camel" }, app: { slug: "camel", name: "Gizmo", url: "https://c.example" }, developer: { handle: "dee" }, published: null });
  });

  it("maps analytics with defaults for missing parts", () => {
    const stats = toAnalytics(
      {
        days: 7,
        series: [{ date: "2026-09-29", matchesCreated: 3, matchesCompleted: "2", matchesAbandoned: 1, players: 4, newPlayers: 1 }],
        totals: { matches: 3, completed: 2, players: 4, newPlayers: 1 },
        completionRate: 66.7,
        medianDurationSec: 95,
        modes: [{ mode: "live", matches: 3 }],
        tableSizes: [{ players: 2, matches: 3 }],
        retention: { d1: 0.5, d7: null },
        topPlayers: [{ profile: profile("u1"), matches: 3, wins: 2 }, { profile: null, matches: 1, wins: 0 }],
        versions: [{ versionId: null, version: null, matches: 2 }, { version_id: "v1", version: "1.1.0", matches: 1 }],
      },
      7,
    );
    expect(stats.series[0]).toEqual({ date: "2026-09-29", matchesCreated: 3, matchesCompleted: 2, matchesAbandoned: 1, players: 4, newPlayers: 1 });
    expect(stats.completionRate).toBeCloseTo(0.667);
    expect(stats.retention).toEqual({ d1: 0.5, d7: null });
    expect(stats.topPlayers).toHaveLength(1);
    expect(stats.versions[1]).toEqual({ versionId: "v1", version: "1.1.0", matches: 1 });
    expect(toAnalytics(null, 30)).toMatchObject({ days: 30, series: [], totals: { matches: 0 }, completionRate: 0, medianDurationSec: null, retention: { d1: null, d7: null } });
  });

  it("maps logs (newest first, bad levels dropped)", () => {
    const logs = toAppLogs([
      { id: 1, app_slug: "gizmo", version_id: "v1", match_id: null, user_id: "u1", level: "info", message: "a", data: null, source: "app", created_at: "2026-09-29T00:00:01Z" },
      { id: "2", appSlug: "gizmo", level: "error", message: "b", data: { x: 1 }, source: "host", createdAt: "2026-09-29T00:00:02Z" },
      { id: "3", level: "loud", message: "c" },
    ]);
    expect(logs.map((l) => [l.id, l.level, l.source])).toEqual([
      ["2", "error", "host"],
      ["1", "info", "app"],
    ]);
    expect(logs[1]).toMatchObject({ appSlug: "gizmo", versionId: "v1", userId: "u1", data: null });
  });

  it("maps developer notices", () => {
    const notices = toNotices([
      { id: "n1", kind: "version_approved", appSlug: "gizmo", versionId: "v1", version: "1.1.0", message: "ok", createdAt: "2026-09-29T00:00:01Z", readAt: null },
      { id: "n2", kind: "version_rejected", app_slug: "gizmo", version: "1.2.0", message: "no", created_at: "2026-09-29T00:00:02Z", read_at: "2026-09-29T01:00:00Z" },
      { id: "n3", kind: "other" },
    ]);
    expect(notices.map((n) => [n.id, n.appSlug, n.readAt])).toEqual([
      ["n2", "gizmo", "2026-09-29T01:00:00Z"],
      ["n1", "gizmo", null],
    ]);
    expect(toNotices(null)).toEqual([]);
  });

  it("carries test-build fields on matches and p_version on match RPCs", () => {
    expect(normalizeMatch(v1Match as never)).toMatchObject({ versionId: null, versionUrl: null, versionLabel: null });
    expect(normalizeMatch({ ...v1Match, versionId: "v1", versionUrl: "https://example.com/next", version: "1.1.0" } as never)).toMatchObject({
      versionId: "v1",
      versionUrl: "https://example.com/next",
      versionLabel: "1.1.0",
    });
    expect(challengeArgs({ appSlug: "gizmo", mode: "live", versionId: "v1" })).toMatchObject({ p_version: "v1" });
    expect(challengeArgs({ appSlug: "gizmo", mode: "live" })).not.toHaveProperty("p_version");
    expect(practiceArgs("gizmo")).toEqual({ p_app: "gizmo" });
    expect(practiceArgs("gizmo", 3, "v1")).toEqual({ p_app: "gizmo", p_players: 3, p_version: "v1" });
    expect(quickMatchArgs("gizmo", null)).toEqual({ p_app: "gizmo" });
    expect(quickMatchArgs("gizmo", "v1")).toEqual({ p_app: "gizmo", p_version: "v1" });
  });
});

describe("standalone apps (kind)", () => {
  it("reads kind from apps rows: absent or unknown is a game", () => {
    expect(toApp(appRow).kind).toBe("game");
    expect(toApp({ ...appRow, kind: "app" }).kind).toBe("app");
    expect(toApp({ ...appRow, kind: null }).kind).toBe("game");
    expect(toKind("widget")).toBe("game");
    expect(toKind("app")).toBe("app");
  });

  it("official rows stay games", () => {
    expect(toApp({ ...appRow, slug: "quick-draw", official: true }).kind).toBe("game");
  });

  it("sends kind on registration only for apps", () => {
    const input: RegisterAppInput = {
      slug: "news-desk",
      name: "News Desk",
      tagline: "Headlines",
      description: "",
      category: "news",
      icon: "📰",
      accent: ["#000000", "#ffffff"],
      url: "https://news.example.com",
      modes: ["live"],
      scoring: "high",
      howTo: [],
    };
    expect(appInsert(input)).not.toHaveProperty("kind");
    expect(appInsert({ ...input, kind: "game" })).not.toHaveProperty("kind");
    expect(appInsert({ ...input, kind: "app" })).toMatchObject({ kind: "app", category: "news" });
  });

  it("carries kind and the new categories through version manifests", () => {
    expect(toVersionManifest({ name: "Old", category: "games" }).kind).toBe("game");
    expect(toVersionManifest({ name: "Desk", category: "finance", kind: "app" })).toMatchObject({ kind: "app", category: "finance" });
    expect(toAppLoose({ slug: "camel", name: "Camel", category: "tools", kind: "app", url: "https://c.example" })).toMatchObject({
      kind: "app",
      category: "tools",
    });
  });

  it("maps open_app results", () => {
    const row = { ...appRow, slug: "news-desk", kind: "app", category: "news", play_count: 7, developer: { handle: "bob", name: "Bob" } };
    expect(toAppLaunch({ ...row, versionId: null })).toMatchObject({
      app: { slug: "news-desk", kind: "app", playCount: 7, developer: { handle: "bob" } },
      versionId: null,
    });
    expect(toAppLaunch([{ ...row, versionId: "v9" }])).toMatchObject({ app: { slug: "news-desk" }, versionId: "v9" });
    expect(toAppLaunch(null)).toBeNull();
    expect(toAppLaunch({ versionId: "v9" })).toBeNull();
  });
});
