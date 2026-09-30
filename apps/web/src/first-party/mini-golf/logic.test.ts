import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import { HOLES, TOTAL_PAR } from "./course";
import {
  HOLE_COUNT,
  PICKUP_SCORE,
  STROKE_CAP,
  botSkill,
  earnedAchievements,
  formatToPar,
  holeCallout,
  parseBall,
  parseCard,
  rankTotals,
  roundScore,
  roundStats,
  scoreMark,
  toPar,
  type GolfAchievement,
  type HoleRecord,
} from "./logic";

const rec = (strokes: number, extra: Partial<HoleRecord> = {}): HoleRecord => ({
  strokes,
  holed: strokes <= STROKE_CAP,
  splashes: 0,
  finalBounces: 0,
  finalAir: false,
  ...extra,
});
/** A full round at par, with overrides by hole index. */
const round = (over: { [i: number]: HoleRecord } = {}): HoleRecord[] => HOLES.map((h, i) => over[i] ?? rec(h.par));

describe("scoring", () => {
  it("calls every hole", () => {
    expect(holeCallout(1, 3).label).toBe("Hole in one!");
    expect(holeCallout(1, 2).tone).toBe("ace");
    expect(holeCallout(1, 4).label).toBe("Hole in one!");
    expect(holeCallout(2, 5).label).toBe("Albatross!");
    expect(holeCallout(2, 4).label).toBe("Eagle!");
    expect(holeCallout(2, 3).label).toBe("Birdie!");
    expect(holeCallout(3, 3).label).toBe("Par");
    expect(holeCallout(4, 3).label).toBe("Bogey");
    expect(holeCallout(5, 3).label).toBe("Double bogey");
    expect(holeCallout(6, 3).label).toBe("Triple bogey");
    expect(holeCallout(6, 2).label).toBe("+4");
    expect(holeCallout(PICKUP_SCORE, 3, false).label).toBe("Picked up");
  });

  it("marks the card like a real scorecard", () => {
    expect(scoreMark(1, 2)).toBe("ace");
    expect(scoreMark(2, 4)).toBe("eagle");
    expect(scoreMark(2, 3)).toBe("birdie");
    expect(scoreMark(3, 3)).toBe("par");
    expect(scoreMark(4, 3)).toBe("bogey");
    expect(scoreMark(6, 3)).toBe("double");
  });

  it("keeps score to par for the holes played", () => {
    expect(toPar([])).toBe(0);
    expect(toPar([HOLES[0]!.par])).toBe(0);
    expect(toPar([1, HOLES[1]!.par + 2])).toBe(1 - HOLES[0]!.par + 2);
    expect(formatToPar(0)).toBe("E");
    expect(formatToPar(3)).toBe("+3");
    expect(formatToPar(-2)).toBe("−2");
  });

  it("the stroke cap bounds every hole, so a round always ends", () => {
    expect(PICKUP_SCORE).toBe(STROKE_CAP + 1);
    expect(roundScore(Array(HOLE_COUNT).fill(99))).toBe(HOLE_COUNT * PICKUP_SCORE);
    expect(roundScore(HOLES.map((h) => h.par))).toBe(TOTAL_PAR);
  });

  it("ranks low scores first and ties share a place (the platform's `low` scoring)", () => {
    expect(getOfficialApp("mini-golf")?.scoring).toBe("low");
    const ranks = rankTotals([
      { id: "a", total: 30 },
      { id: "b", total: 27 },
      { id: "c", total: 30 },
      { id: "d", total: 33 },
    ]);
    expect([...ranks.entries()]).toEqual([
      ["a", 2],
      ["b", 1],
      ["c", 2],
      ["d", 4],
    ]);
  });
});

describe("wire format", () => {
  it("accepts well-formed ball and card messages", () => {
    expect(parseBall({ h: 2, x: 1.25, y: 7.5, z: 0.1, s: 2, m: 1 })).toEqual({ h: 2, x: 1.25, y: 7.5, z: 0.1, s: 2, m: 1 });
    expect(parseCard({ card: [2, 3, 7], h: 3 })).toEqual({ card: [2, 3, 7], h: 3 });
    expect(parseCard({ card: HOLES.map((h) => h.par), h: HOLE_COUNT })).not.toBeNull();
  });

  it("drops anything malformed", () => {
    for (const bad of [null, [], "x", { h: 9, x: 0, y: 0, z: 0, s: 0, m: 0 }, { h: 0, x: Number.NaN, y: 0, z: 0, s: 0, m: 0 }, { h: 0, x: 0, y: 0 }]) {
      expect(parseBall(bad)).toBeNull();
    }
    for (const bad of [{ card: [0], h: 0 }, { card: [8], h: 0 }, { card: [2.5], h: 0 }, { card: Array(10).fill(2), h: 0 }, { card: [], h: 10 }, { card: "22", h: 0 }]) {
      expect(parseCard(bad)).toBeNull();
    }
  });
});

describe("bots", () => {
  it("better bots wobble less", () => {
    const weak = botSkill(0);
    const strong = botSkill(1);
    expect(strong.angleSd).toBeLessThan(weak.angleSd);
    expect(strong.powerSd).toBeLessThan(weak.powerSd);
    expect(strong.timing).toBeLessThan(weak.timing);
  });
});

describe("achievements", () => {
  it("every id it can award is declared in the manifest, ≤ 500 XP, with secrets", () => {
    const app = getOfficialApp("mini-golf");
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: GolfAchievement[] = [
      "first_round",
      "ace",
      "under_par",
      "hot_streak",
      "clean_card",
      "trick_shot",
      "airmail",
      "first_win",
      "fish_food",
      "double_ace",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
    expect(app?.achievements?.reduce((s, a) => s + a.xp, 0)).toBeLessThanOrEqual(500);
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
    expect(app?.stats?.map((s) => s.key).sort()).toEqual(["best_round", "holes_in_one", "rounds_played", "wins"]);
  });

  it("awards nothing for an ordinary hole", () => {
    expect(earnedAchievements([rec(3)])).toEqual([]);
  });

  it("aces, and a second ace (secret)", () => {
    expect(earnedAchievements([rec(1)])).toEqual(["ace"]);
    expect(earnedAchievements([rec(1), rec(3), rec(1)])).toEqual(["ace", "double_ace"]);
  });

  it("trick shots and airmail count only on the stroke that went in", () => {
    expect(earnedAchievements([rec(2, { finalBounces: 3 })])).toContain("trick_shot");
    expect(earnedAchievements([rec(2, { finalBounces: 2 })])).not.toContain("trick_shot");
    expect(earnedAchievements([rec(2, { finalAir: true })])).toContain("airmail");
    expect(earnedAchievements([rec(PICKUP_SCORE, { holed: false, finalAir: true, finalBounces: 5 })])).toEqual([]);
  });

  it("hot streak: three under-par holes in a row", () => {
    const birdie = (i: number) => rec(HOLES[i]!.par - 1);
    expect(earnedAchievements([birdie(0), birdie(1), rec(4), birdie(3)])).not.toContain("hot_streak");
    expect(earnedAchievements([rec(4), birdie(1), birdie(2), birdie(3)])).toContain("hot_streak");
  });

  it("fish food: three splashes in a round (secret)", () => {
    expect(earnedAchievements([rec(4, { splashes: 2 })])).not.toContain("fish_food");
    expect(earnedAchievements([rec(4, { splashes: 2 }), rec(3), rec(5, { splashes: 1 })])).toContain("fish_food");
  });

  it("round badges wait for all nine holes", () => {
    const eight = round().slice(0, 8);
    expect(earnedAchievements(eight)).toEqual([]);
    expect(earnedAchievements(round())).toEqual(["first_round", "clean_card"]);
    const under = round({ 4: rec(HOLES[4]!.par - 1) });
    expect(earnedAchievements(under)).toEqual(expect.arrayContaining(["first_round", "under_par", "clean_card"]));
    const bogey = round({ 2: rec(HOLES[2]!.par + 1) });
    expect(earnedAchievements(bogey)).toEqual(["first_round"]);
  });

  it("a win is only known after the match settles", () => {
    expect(earnedAchievements([rec(3)], { won: true })).toContain("first_win");
  });
});

describe("stats", () => {
  it("reports rounds, best round and aces once the round is in", () => {
    expect(roundStats(round().slice(0, 5))).toEqual({});
    expect(roundStats(round())).toEqual({ rounds_played: 1, best_round: TOTAL_PAR });
    expect(roundStats(round({ 0: rec(1), 3: rec(1) }))).toEqual({
      rounds_played: 1,
      best_round: TOTAL_PAR - (HOLES[0]!.par - 1) - (HOLES[3]!.par - 1),
      holes_in_one: 2,
    });
  });
});
