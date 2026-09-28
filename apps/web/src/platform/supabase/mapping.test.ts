import { describe, expect, it } from "vitest";
import type { Match, Profile } from "../types";
import { appInsert, challengeArgs, errorKind, normalizeMatch, toApp, toBackendError, type AppRow } from "./mapping";

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
