import { describe, expect, it } from "vitest";
import { getOfficialApp } from "./catalog";
import { describeResult } from "./scoring";
import {
  buildLaunchContext,
  buildSetupContext,
  canStartMatch,
  isYourTurn,
  matchHeadline,
  needsAttention,
  opponentOf,
  opponentsOf,
  placements,
  seatGrid,
  seatedPlayers,
  spectatorOf,
  teamStandings,
  teammatesOf,
  toLaunchMatch,
  toMatchResult,
} from "./match-utils";
import type { Match, MatchPlayer, Profile } from "./types";

const profile = (id: string): Profile => ({
  id,
  handle: id,
  name: id.toUpperCase(),
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

const player = (id: string, seat: number | null, extra: Partial<MatchPlayer> = {}): MatchPlayer => ({
  userId: id,
  seat,
  team: null,
  role: "player",
  rank: null,
  state: "joined",
  isBot: false,
  score: null,
  submission: null,
  result: null,
  xpDelta: 0,
  lastSeenAt: null,
  profile: profile(id),
  ...extra,
});

const match = (players: MatchPlayer[], extra: Partial<Match> = {}): Match => ({
  id: "m1",
  appSlug: "wedge-wars",
  mode: "live",
  status: "active",
  scoring: "high",
  seed: "seed",
  createdBy: "a",
  createdAt: "",
  startedAt: null,
  endedAt: null,
  winnerId: null,
  isOpen: false,
  settings: {},
  votes: {},
  votesNeeded: 5,
  votingEndsAt: null,
  players,
  simulatedVotes: false,
  minPlayers: 2,
  maxPlayers: Math.max(2, players.filter((p) => p.role === "player").length),
  teams: 0,
  winnerTeam: null,
  spectatorCount: 0,
  state: null,
  stateVersion: 0,
  turnUserId: null,
  turnDeadline: null,
  round: 0,
  ...extra,
});

const app = getOfficialApp("wedge-wars")!;

describe("who's who", () => {
  it("separates seated players from the viewer's spectator row", () => {
    const m = match([player("a", 0), player("b", 1), player("c", 2), player("s", null, { role: "spectator" })], { spectatorCount: 1 });
    expect(seatedPlayers(m).map((p) => p.userId)).toEqual(["a", "b", "c"]);
    expect(opponentsOf(m, "a").map((p) => p.userId)).toEqual(["b", "c"]);
    expect(opponentOf(m, "a")?.userId).toBe("b");
    expect(spectatorOf(m, "s")?.role).toBe("spectator");
    expect(spectatorOf(m, "a")).toBeUndefined();
  });

  it("finds teammates in team play", () => {
    const m = match(
      [player("a", 0, { team: 0 }), player("b", 1, { team: 1 }), player("c", 2, { team: 0 }), player("d", 3, { team: 1 })],
      { teams: 2, maxPlayers: 4 },
    );
    expect(teammatesOf(m, "a").map((p) => p.userId)).toEqual(["c"]);
    expect(teammatesOf(match([player("a", 0), player("b", 1)]), "a")).toEqual([]);
  });

  it("lays out a seat grid and knows when the creator can start", () => {
    const m = match([player("a", 0), player("b", 1, { state: "invited" }), player("c", 3)], { status: "open", maxPlayers: 5, isOpen: true });
    expect(seatGrid(m).map((s) => s.state)).toEqual(["filled", "invited", "open", "filled", "open"]);
    expect(canStartMatch(m, "a")).toBe(true);
    expect(canStartMatch(m, "c")).toBe(false);
    expect(canStartMatch({ ...m, minPlayers: 3 }, "a")).toBe(false);
  });
});

describe("launch context", () => {
  it("builds a v2 match context with purpose, roles and new fields", () => {
    const m = match([player("a", 0), player("b", 1, { team: null }), player("c", 2)], {
      maxPlayers: 4,
      state: { board: [] },
      stateVersion: 3,
      turnUserId: "b",
      round: 2,
    });
    const ctx = buildLaunchContext(app, m, profile("a"), "https://x.test");
    expect(ctx.purpose).toBe("match");
    expect(ctx.match).toMatchObject({
      seat: 0,
      role: "player",
      minPlayers: 2,
      maxPlayers: 4,
      teams: 0,
      state: { board: [] },
      stateVersion: 3,
      turn: "b",
      round: 2,
    });
    expect(ctx.match.players.map((p) => [p.id, p.seat, p.role, p.team])).toEqual([
      ["a", 0, "player", null],
      ["b", 1, "player", null],
      ["c", 2, "player", null],
    ]);
  });

  it("gives spectators seat -1 and keeps them out of players", () => {
    const m = match([player("a", 0), player("b", 1), player("s", null, { role: "spectator" })]);
    const launch = toLaunchMatch(m, "s");
    expect(launch.seat).toBe(-1);
    expect(launch.role).toBe("spectator");
    expect(launch.players.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("builds a setup context with a stub match", () => {
    const ctx = buildSetupContext({ ...app, players: { min: 2, max: 6 }, teams: 2 }, profile("a"), "https://x.test");
    expect(ctx.purpose).toBe("setup");
    expect(ctx.match).toMatchObject({ seat: 0, role: "player", minPlayers: 2, maxPlayers: 6, teams: 2, state: null, stateVersion: 0 });
    expect(ctx.match.players).toHaveLength(1);
    expect(ctx.match.players[0]).toMatchObject({ id: "a", seat: 0, team: 0 });
  });
});

describe("results", () => {
  const finished = match(
    [
      player("a", 0, { score: 10, rank: 3, result: "loss", state: "submitted" }),
      player("b", 1, { score: 30, rank: 1, result: "win", state: "submitted" }),
      player("c", 2, { score: 20, rank: 2, result: "loss", state: "submitted" }),
      player("d", 3, { score: 5, rank: 4, result: "loss", state: "submitted" }),
    ],
    { status: "completed", winnerId: "b", maxPlayers: 4 },
  );

  it("includes ranks and winnerTeam in the SDK result", () => {
    const result = toMatchResult(finished);
    expect(result.ranks).toEqual({ a: 3, b: 1, c: 2, d: 4 });
    expect(result.winnerTeam).toBeNull();
    expect(placements(finished).map((p) => p.userId)).toEqual(["b", "c", "a", "d"]);
  });

  it("writes headlines for 3+ players", () => {
    expect(matchHeadline(finished, "b")).toBe("You won a 4-player Wedge Wars");
    expect(matchHeadline(finished, "a")).toBe("You placed 3rd of 4");
    expect(matchHeadline(finished, "z", { id: "b", handle: "b" })).toBe("@b won a 4-player Wedge Wars");
    expect(matchHeadline(finished, "z", { id: "c", handle: "c" })).toBe("@c placed 2nd in a 4-player Wedge Wars");
    expect(describeResult(finished, "Relay")).toBe("@b won a 4-player Relay");
  });

  it("still names a retired app in old matches", () => {
    const old = { ...finished, appSlug: "trivia-royale" };
    expect(matchHeadline(old, "b")).toBe("You won a 4-player Trivia Royale");
    expect(matchHeadline({ ...finished, appSlug: "gone-app" }, "b")).toBe("You won a 4-player match");
  });

  it("writes team headlines", () => {
    const teams = match(
      [
        player("a", 0, { team: 0, rank: 2, score: 1 }),
        player("b", 1, { team: 1, rank: 1, score: 3 }),
        player("c", 2, { team: 0, rank: 2, score: 1 }),
        player("d", 3, { team: 1, rank: 1, score: 3 }),
      ],
      { status: "completed", teams: 2, winnerTeam: 1, maxPlayers: 4 },
    );
    expect(matchHeadline(teams, "b")).toBe("Your team won");
    expect(matchHeadline(teams, "a")).toBe("Blue team won");
    expect(describeResult(teams, "Relay")).toBe("Blue team won a 4-player Relay");
    expect(teamStandings(teams).map((t) => [t.team, t.score, t.rank])).toEqual([
      [1, 6, 1],
      [0, 2, 2],
    ]);
  });

  it("keeps 1v1 headlines exactly as before", () => {
    const duel = match([player("a", 0), player("b", 1)], { status: "completed", winnerId: "a" });
    expect(matchHeadline(duel, "a")).toBe("You beat @b");
    expect(matchHeadline(duel, "b")).toBe("@a won");
    expect(describeResult(duel, "Reflexes")).toBe("@a beat @b in Reflexes");
  });
});

describe("inbox", () => {
  it("flags async turns waiting on the viewer", () => {
    const m = match([player("a", 0), player("b", 1)], { mode: "async", turnUserId: "a" });
    expect(isYourTurn(m, "a")).toBe(true);
    expect(isYourTurn(m, "b")).toBe(false);
    expect(isYourTurn({ ...m, mode: "live" }, "a")).toBe(false);
    expect(needsAttention(m, "a")).toBe(true);
    expect(needsAttention(m, "b")).toBe(false);
    expect(matchHeadline(m, "b")).toBe("@a's turn");
    expect(matchHeadline(m, "a")).toBe("Your turn");
  });

  it("flags invites", () => {
    const m = match([player("a", 0), player("b", 1, { state: "invited" }), player("c", 2, { state: "invited" })], {
      status: "pending",
      maxPlayers: 3,
      appSlug: "wedge-wars",
    });
    expect(needsAttention(m, "b")).toBe(true);
    expect(matchHeadline(m, "b")).toBe("@a invited you to a 3-player Wedge Wars");
    expect(matchHeadline(m, "a")).toBe("Waiting for 2 players to accept");
  });
});
