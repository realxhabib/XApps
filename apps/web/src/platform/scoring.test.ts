import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import { levelInfo, placementXp, settle, xpForLevel, XP } from "./scoring";
import type { MatchPlayer, Profile } from "./types";

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

const player = (id: string, seat: number, extra: Partial<MatchPlayer> = {}): MatchPlayer => ({
  userId: id,
  seat,
  team: null,
  role: "player",
  rank: null,
  state: "submitted",
  isBot: false,
  score: null,
  submission: null,
  result: null,
  xpDelta: 0,
  lastSeenAt: null,
  profile: profile(id),
  ...extra,
});

describe("settle", () => {
  it("awards the higher score in high scoring", () => {
    const s = settle({ scoring: "high", mode: "live", votes: {}, players: [player("a", 0, { score: 3 }), player("b", 1, { score: 1 })] });
    expect(s.winnerId).toBe("a");
    expect(s.xp).toEqual({ a: XP.win, b: XP.loss });
  });

  it("awards the lower score in low scoring and draws on ties", () => {
    expect(
      settle({ scoring: "low", mode: "live", votes: {}, players: [player("a", 0, { score: 300 }), player("b", 1, { score: 210 })] }).winnerId,
    ).toBe("b");
    const tie = settle({ scoring: "high", mode: "live", votes: {}, players: [player("a", 0, { score: 2 }), player("b", 1, { score: 2 })] });
    expect(tie.winnerId).toBeNull();
    expect(tie.results).toEqual({ a: "draw", b: "draw" });
  });

  it("uses votes for crowd-judged apps", () => {
    const s = settle({ scoring: "votes", mode: "async", votes: { a: 2, b: 5 }, players: [player("a", 0), player("b", 1)] });
    expect(s.winnerId).toBe("b");
  });

  it("gives the other player the win on forfeit", () => {
    const s = settle({ scoring: "high", mode: "live", votes: {}, players: [player("a", 0, { score: 9 }), player("b", 1)] }, "a");
    expect(s.winnerId).toBe("b");
  });

  it("gives bots no XP and practice a flat reward", () => {
    const s = settle({
      scoring: "high",
      mode: "practice",
      votes: {},
      players: [player("a", 0, { score: 1 }), player("bot", 1, { score: 0, isBot: true })],
    });
    expect(s.xp).toEqual({ a: XP.practice, bot: 0 });
  });
});

describe("settle: N players", () => {
  const four = (scores: Array<number | null>, extra: Partial<MatchPlayer>[] = []) =>
    scores.map((score, i) => player(["a", "b", "c", "d"][i]!, i, { score, ...extra[i] }));

  it("ranks with shared places and skips after a tie (1, 1, 3, 4)", () => {
    const s = settle({ scoring: "high", mode: "live", votes: {}, players: four([10, 30, 30, 5]) });
    expect(s.ranks).toEqual({ a: 3, b: 1, c: 1, d: 4 });
    expect(s.winnerId).toBeNull();
    expect(s.results).toEqual({ a: "loss", b: "draw", c: "draw", d: "loss" });
    expect(s.xp).toEqual({ a: 15, b: 30, c: 30, d: 8 });
  });

  it("interpolates XP over the highest rank handed out", () => {
    expect([1, 2, 3].map((r) => placementXp(r, 3))).toEqual([30, 19, 8]);
    expect(placementXp(2, 5)).toBe(25); // 24.5 rounds up, like Postgres
    expect(placementXp(1, 1)).toBe(XP.draw);
    const s = settle({ scoring: "high", mode: "live", votes: {}, players: four([9, 1, 1, 1]) });
    expect(s.ranks).toEqual({ a: 1, b: 2, c: 2, d: 2 });
    expect(s.xp).toEqual({ a: 30, b: 8, c: 8, d: 8 });
    expect(s.winnerId).toBe("a");
  });

  it("treats everyone tied as a draw worth draw XP", () => {
    const s = settle({ scoring: "low", mode: "async", votes: {}, players: four([4, 4, 4, 4]) });
    expect(Object.values(s.ranks)).toEqual([1, 1, 1, 1]);
    expect(Object.values(s.xp)).toEqual([XP.draw, XP.draw, XP.draw, XP.draw]);
  });

  it("places missing scores below every score and leavers below everyone still in", () => {
    const s = settle(
      { scoring: "low", mode: "live", votes: {}, players: four([50, null, 20, 1], [{}, {}, {}, { state: "left" }]) },
    );
    expect(s.ranks).toEqual({ c: 1, a: 2, b: 3, d: 4 });
    expect(s.winnerId).toBe("c");
  });

  it("ranks crowd votes for N entries", () => {
    const s = settle({ scoring: "votes", mode: "async", votes: { a: 1, b: 5, c: 3 }, players: four([null, null, null]) });
    expect(s.ranks).toEqual({ a: 3, b: 1, c: 2 });
  });

  it("sums team scores, gives members the team's place, and puts a team's leavers last", () => {
    const players = four([5, 10, 5, 1], [{ team: 0 }, { team: 1 }, { team: 0 }, { team: 1 }]);
    const s = settle({ scoring: "high", mode: "live", votes: {}, teams: 2, players });
    expect(s.winnerTeam).toBe(1);
    expect(s.winnerId).toBeNull();
    expect(s.ranks).toEqual({ a: 2, b: 1, c: 2, d: 1 });
    expect(s.results).toEqual({ a: "loss", b: "win", c: "loss", d: "win" });

    players[3]!.state = "left";
    const left = settle({ scoring: "high", mode: "live", votes: {}, teams: 2, players });
    // Team 1 is now just b (10) vs team 0 (10): tied for 1st, d placed last.
    expect(left.ranks).toEqual({ a: 1, b: 1, c: 1, d: 3 });
    expect(left.winnerTeam).toBeNull();
    expect(left.results.d).toBe("loss");
  });

  it("ignores spectators and declined invites", () => {
    const s = settle({
      scoring: "high",
      mode: "live",
      votes: {},
      players: [
        player("a", 0, { score: 2 }),
        player("b", 1, { score: 1 }),
        player("x", 2, { state: "declined" }),
        player("s", 0, { role: "spectator", seat: null }),
      ],
    });
    expect(Object.keys(s.ranks)).toEqual(["a", "b"]);
  });
});

describe("levels", () => {
  it("starts at level 1 and grows quadratically", () => {
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(xpForLevel(2)).level).toBe(2);
    expect(levelInfo(xpForLevel(5) - 1).level).toBe(4);
  });

  it("reports progress within the level", () => {
    const info = levelInfo(150);
    expect(info.level).toBe(2);
    expect(info.progress).toBeCloseTo(0.25);
  });
});

describe("sdk alias", () => {
  it("resolves @xapps/sdk from source", () => {
    expect(createRandom("x").int(1, 1)).toBe(1);
  });
});
