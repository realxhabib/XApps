import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, statDefsError } from "@/platform/catalog";
import { target, type Point } from "./board";
import { earnedAchievements, gameStats, type DartsAchievement } from "./logic";

const T20 = target(20, "treble");
const S20 = target(20, "outer-single");
const S5 = target(5, "outer-single");
const S1 = target(1, "outer-single");
const BULL = target(25, "bull");
const OUTER = target(25, "outer-bull");
const MISS: Point = { x: 0, y: -200 };

/** Darts never land in exactly the same hole: spread repeats a few mm apart (same bed). */
function spread(...pts: Point[]): Point[] {
  return pts.map((p, i) => ({ x: p.x + ((i % 3) - 1) * 5, y: p.y }));
}

describe("Darts manifest", () => {
  const app = getOfficialApp("darts");

  it("is a 2–4 player score game with valid progress", () => {
    expect(app?.url).toBe("/embed/darts");
    expect(app?.scoring).toBe("high");
    expect(app?.players).toEqual({ min: 2, max: 4 });
    expect(app?.modes).toEqual(expect.arrayContaining(["live", "async", "practice"]));
    expect(statDefsError(app?.stats)).toBeNull();
    expect(achievementDefsError(app?.achievements)).toBeNull();
    expect(app?.stats?.length).toBeGreaterThanOrEqual(2);
    expect(app?.stats?.length).toBeLessThanOrEqual(4);
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
    const xp = (app?.achievements ?? []).reduce((s, a) => s + a.xp, 0);
    expect(xp).toBeLessThanOrEqual(500);
  });

  it("every id it can award is declared in the manifest", () => {
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: DartsAchievement[] = [
      "first_game",
      "winner",
      "bullseye",
      "ton_up",
      "hat_trick",
      "one_eighty",
      "treble_century",
      "shanghai",
      "bed_and_breakfast",
      "robin_hood",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it("every stat it reports is declared", () => {
    const declared = new Set(app?.stats?.map((s) => s.key));
    const stats = gameStats([T20, T20, T20, BULL, OUTER, S1, S1, S1, S1]);
    for (const key of Object.keys(stats)) expect(declared.has(key), key).toBe(true);
  });
});

describe("Darts achievements", () => {
  it("awards nothing for an ordinary half-thrown game", () => {
    expect(earnedAchievements(spread(S20, S1, S1, S20), false)).toEqual([]);
  });

  it("dart- and round-level ones land as they happen", () => {
    expect(earnedAchievements([BULL], false)).toEqual(["bullseye"]);
    expect(earnedAchievements([OUTER], false)).toEqual([]); // the outer bull isn't a bullseye
    expect(earnedAchievements(spread(T20, T20, S20), false)).toEqual(["ton_up"]);
    expect(earnedAchievements(spread(T20, T20, T20), false)).toEqual(["ton_up", "one_eighty"]);
    expect(earnedAchievements([BULL, OUTER, { x: 0, y: 11 }], false)).toEqual(["bullseye", "ton_up", "hat_trick"]); // 50 + 25 + 25
    expect(earnedAchievements([target(7, "inner-single"), target(7, "double"), target(7, "treble")], false)).toEqual(["shanghai"]);
    expect(earnedAchievements([S20, S5, S1], false)).toEqual(["bed_and_breakfast"]);
    expect(earnedAchievements([S20, { x: S20.x + 1, y: S20.y }], false)).toEqual(["robin_hood"]);
  });

  it("rounds must be complete, and robin hood only counts within a round", () => {
    expect(earnedAchievements(spread(T20, T20), false)).toEqual([]);
    // Dart 3 and dart 4 are in different rounds.
    expect(earnedAchievements([S1, S5, S20, { x: S20.x + 1, y: S20.y }], false)).not.toContain("robin_hood");
  });

  it("game-level ones wait for the final", () => {
    const big = spread(T20, T20, T20, T20, T20, T20, S20, S20, S20);
    expect(earnedAchievements(big, false)).not.toContain("treble_century");
    const final = earnedAchievements(big, true);
    expect(final).toContain("first_game");
    expect(final).toContain("treble_century");
    const small = spread(S1, S1, S1, S1, S1, S1, S1, S1, MISS);
    expect(earnedAchievements(small, true)).toEqual(["first_game"]);
  });
});

describe("Darts stats", () => {
  it("reports the total, bulls, 180s and a game", () => {
    expect(gameStats([T20, T20, T20, T20, T20, T20, BULL, OUTER, MISS])).toEqual({
      best_total: 360 + 75,
      bullseyes: 2,
      ton_80s: 2,
      games: 1,
    });
  });

  it("leaves out counters that didn't happen", () => {
    expect(gameStats([S1, S1, S1, S1, S1, S1, S1, S1, S1])).toEqual({ best_total: 9, games: 1 });
  });
});
