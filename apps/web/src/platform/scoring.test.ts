import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import { levelInfo, settle, xpForLevel, XP } from "./scoring";
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
