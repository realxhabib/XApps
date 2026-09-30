import type { StatStanding } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "@/platform/catalog";
import {
  BOARD_STAT,
  CENTURY,
  EMPTY_SESSION,
  PERFECT,
  SITTING,
  boardRows,
  circleStats,
  earnedAchievements,
  percentileLabel,
  recordStroke,
  standingMoment,
  totalAchievements,
  type Analysis,
  type CircleAchievement,
  type Session,
} from "./logic";

const app = getOfficialApp("perfect-circle");

function play(...scores: number[]): Session {
  return scores.reduce<Session>(
    (session, accuracy) =>
      recordStroke(session, {
        ok: true,
        accuracy,
        deviation: 0,
        gap: 0,
        stroke: [],
        radius: 300,
        sweepDeg: 360,
        durationMs: 1500,
      } satisfies Analysis),
    EMPTY_SESSION,
  );
}

describe("Perfect Circle manifest", () => {
  it("is a standalone app with no matches", () => {
    expect(app).toBeDefined();
    expect(app!.kind).toBe("app");
    expect(manifestShapeError(app!)).toBeNull();
    expect(app!.url).toBe("/embed/perfect-circle");
  });

  it("declares 2–4 stats and 6–10 achievements, one of them secret", () => {
    expect(app?.stats?.length).toBeGreaterThanOrEqual(2);
    expect(app?.stats?.length).toBeLessThanOrEqual(4);
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(statDefsError(app?.stats)).toBeNull();
    expect(achievementDefsError(app?.achievements)).toBeNull();
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
    expect(app?.stats?.find((s) => s.key === BOARD_STAT)).toMatchObject({ aggregate: "max", format: "percent" });
    expect(app?.stats?.find((s) => s.key === "perfect_circles")).toMatchObject({ aggregate: "sum" });
    expect(app?.stats?.find((s) => s.key === "circles_drawn")).toMatchObject({ aggregate: "sum" });
    expect(app?.stats?.some((s) => s.key === "wins")).toBe(false);
  });

  it("every achievement it can award is declared", () => {
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: CircleAchievement[] = [
      "first_circle",
      "well_rounded",
      "steady_hand",
      "perfect_circle",
      "hat_trick",
      "in_the_groove",
      "century",
      "show_off",
      "its_an_egg",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it("every stat it reports is declared", () => {
    const declared = new Set(app?.stats?.map((s) => s.key));
    for (const key of Object.keys(circleStats(99))) expect(declared.has(key), key).toBe(true);
  });
});

describe("Perfect Circle achievements", () => {
  it("nothing before the first circle", () => {
    expect(earnedAchievements(EMPTY_SESSION)).toEqual([]);
  });

  it("thresholds: 90, 95 and the 98% perfect circle", () => {
    expect(earnedAchievements(play(89.9))).toEqual(["first_circle"]);
    expect(earnedAchievements(play(90))).toEqual(["first_circle", "well_rounded"]);
    expect(earnedAchievements(play(94.9, 95))).toEqual(["first_circle", "well_rounded", "steady_hand"]);
    expect(earnedAchievements(play(PERFECT - 0.1))).not.toContain("perfect_circle");
    expect(earnedAchievements(play(PERFECT))).toContain("perfect_circle");
  });

  it("hat trick: three circles in a row, all 90%+", () => {
    expect(earnedAchievements(play(91, 92))).not.toContain("hat_trick");
    expect(earnedAchievements(play(91, 92, 90))).toContain("hat_trick");
    expect(earnedAchievements(play(91, 89.9, 99, 93))).not.toContain("hat_trick");
    expect(earnedAchievements(play(70, 80, 91, 89.9, 99, 93, 90.5))).toContain("hat_trick");
  });

  it("in the groove: ten circles in one sitting", () => {
    expect(earnedAchievements(play(...Array<number>(SITTING - 1).fill(80)))).not.toContain("in_the_groove");
    expect(earnedAchievements(play(...Array<number>(SITTING).fill(80)))).toContain("in_the_groove");
  });

  it("century: a hundred circles in all, from the reported totals", () => {
    expect(totalAchievements({ circles_drawn: CENTURY - 1 })).toEqual([]);
    expect(totalAchievements({ circles_drawn: CENTURY, best_circle: 90 })).toEqual(["century"]);
    expect(totalAchievements({})).toEqual([]);
  });

  it("it's an egg (secret): a scored circle under 50%", () => {
    expect(earnedAchievements(play(49.9))).toContain("its_an_egg");
    expect(earnedAchievements(play(50))).not.toContain("its_an_egg");
  });
});

describe("Perfect Circle stats", () => {
  it("every circle reports itself: best (max), perfect ones and circles drawn (sums)", () => {
    expect(circleStats(97.3)).toEqual({ best_circle: 97.3, circles_drawn: 1 });
    expect(circleStats(PERFECT)).toEqual({ best_circle: PERFECT, circles_drawn: 1, perfect_circles: 1 });
  });
});

describe("Perfect Circle worldwide board", () => {
  const person = (id: string) => ({ id, handle: id, name: id.toUpperCase(), avatarUrl: null });
  const standing = (me: StatStanding["me"], total = 2380, top = ["a", "b", "c", "d", "e", "f"]): StatStanding => ({
    key: BOARD_STAT,
    top: top.map((id, i) => ({ rank: i + 1, player: person(id), value: 99.5 - i })),
    me,
    total,
  });

  it("percentiles", () => {
    expect(percentileLabel(14, 2380)).toBe("Top 1%");
    expect(percentileLabel(1, 2380)).toBe("Top 1%");
    expect(percentileLabel(50, 2380)).toBe("Top 3%");
    expect(percentileLabel(5, 10)).toBe("Top 50%");
    expect(percentileLabel(8, 10)).toBe("Better than 20%");
    expect(percentileLabel(10, 10)).toBeNull();
    expect(percentileLabel(1, 1)).toBeNull();
    expect(percentileLabel(3, 2)).toBeNull();
    expect(percentileLabel(0, 10)).toBeNull();
  });

  it("moments: a personal best, places climbed and a debut", () => {
    const before = standing({ rank: 226, value: 91 });
    const after = standing({ rank: 14, value: 97 });
    expect(standingMoment(before, after, 97, 91)).toEqual({ personalBest: true, climbed: 212, debut: false });
    expect(standingMoment(after, after, 93, 97)).toEqual({ personalBest: false, climbed: 0, debut: false });
    // First circle ever: on the board, but not a "personal best".
    expect(standingMoment(standing(null), after, 97, null)).toEqual({ personalBest: false, climbed: 0, debut: true });
    // Nothing known before (the first fetch failed): no claims.
    expect(standingMoment(null, after, 97, null)).toEqual({ personalBest: false, climbed: 0, debut: false });
    // Others passed you meanwhile: never "climbed" a negative amount.
    expect(standingMoment(after, standing({ rank: 20, value: 97 }), 90, 97).climbed).toBe(0);
  });

  it("rows: the top five, then you underneath when you're not in it", () => {
    const rows = boardRows(standing({ rank: 14, value: 97 }), "me");
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 14]);
    expect(rows[5]).toMatchObject({ me: true, player: null, gap: true, value: 97 });
    expect(rows.slice(0, 5).every((r) => !r.me)).toBe(true);
  });

  it("rows: you in the top five are highlighted in place", () => {
    const rows = boardRows(standing({ rank: 2, value: 98.5 }, 10, ["a", "me", "c"]), "me");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ me: true, rank: 2 });
    // Right under the top rows: no gap.
    expect(boardRows(standing({ rank: 6, value: 90 }), "me").at(-1)).toMatchObject({ me: true, gap: false });
  });

  it("rows: an empty board, and no standing of your own", () => {
    expect(boardRows(standing(null, 0, []), "me")).toEqual([]);
    expect(boardRows(standing(null), "me")).toHaveLength(5);
  });
});
