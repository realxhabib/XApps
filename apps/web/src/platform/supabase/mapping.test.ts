import { describe, expect, it } from "vitest";
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
      setup: false,
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
