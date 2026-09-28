import { describe, expect, it } from "vitest";
import { decideWinner, rankPlayers } from "../src/host";

describe("rankPlayers", () => {
  it("ranks a free for all, best first", () => {
    const r = rankPlayers(
      [
        { id: "a", score: 10 },
        { id: "b", score: 30 },
        { id: "c", score: 20 },
      ],
      "high",
    );
    expect(r.ranks).toEqual({ b: 1, c: 2, a: 3 });
    expect(r.order).toEqual(["b", "c", "a"]);
    expect(r.winnerId).toBe("b");
    expect(r.winnerTeam).toBeNull();
    expect(r.teamScores).toBeNull();
  });

  it("shares ranks on ties (competition ranking) and skips the next place", () => {
    const r = rankPlayers(
      [
        { id: "a", score: 5 },
        { id: "b", score: 9 },
        { id: "c", score: 5 },
        { id: "d", score: 1 },
      ],
      "high",
    );
    expect(r.ranks).toEqual({ b: 1, a: 2, c: 2, d: 4 });
    expect(r.winnerId).toBe("b");
  });

  it("has no winner when first place is shared", () => {
    const r = rankPlayers(
      [
        { id: "a", score: 3 },
        { id: "b", score: 3 },
        { id: "c", score: 1 },
      ],
      "high",
    );
    expect(r.ranks).toEqual({ a: 1, b: 1, c: 3 });
    expect(r.winnerId).toBeNull();
  });

  it("supports low scoring and places missing scores last", () => {
    const r = rankPlayers(
      [
        { id: "a", score: 300 },
        { id: "b", score: null },
        { id: "c", score: 180 },
        { id: "d", score: undefined },
      ],
      "low",
    );
    expect(r.ranks).toEqual({ c: 1, a: 2, b: 3, d: 3 });
    expect(r.winnerId).toBe("c");
    expect(rankPlayers([{ id: "a", score: null }], "high").winnerId).toBeNull();
  });

  it("sums team scores and gives every member the team's place", () => {
    const r = rankPlayers(
      [
        { id: "a", score: 4, team: 0 },
        { id: "b", score: 5, team: 1 },
        { id: "c", score: 3, team: 0 },
        { id: "d", score: 1, team: 1 },
      ],
      "high",
      { teams: 2 },
    );
    expect(r.teamScores).toEqual({ 0: 7, 1: 6 });
    expect(r.teamRanks).toEqual({ 0: 1, 1: 2 });
    expect(r.ranks).toEqual({ a: 1, c: 1, b: 2, d: 2 });
    expect(r.winnerTeam).toBe(0);
    expect(r.winnerId).toBeNull();
  });

  it("ties teams and handles teams that never scored", () => {
    const tie = rankPlayers(
      [
        { id: "a", score: 2, team: 0 },
        { id: "b", score: 2, team: 1 },
        { id: "c", score: null, team: 2 },
      ],
      "high",
      { teams: 3 },
    );
    expect(tie.ranks).toEqual({ a: 1, b: 1, c: 3 });
    expect(tie.teamScores).toEqual({ 0: 2, 1: 2, 2: null });
    expect(tie.winnerTeam).toBeNull();
  });

  it("keeps decideWinner working for N players", () => {
    expect(decideWinner({ a: 1, b: 7, c: 3 }, "high")).toBe("b");
    expect(decideWinner({ a: 1, b: 7, c: 1 }, "low")).toBeNull();
  });
});
