import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "@/platform/catalog";
import {
  EMPTY_RUN,
  PERFECT,
  earnedAchievements,
  recordStroke,
  resultProgress,
  runStats,
  type Analysis,
  type CircleAchievement,
  type Run,
} from "./logic";

const app = getOfficialApp("perfect-circle");

function play(...scores: number[]): Run {
  return scores.reduce<Run>(
    (run, accuracy) =>
      recordStroke(run, {
        ok: true,
        accuracy,
        deviation: 0,
        gap: 0,
        stroke: [],
        radius: 300,
        sweepDeg: 360,
        durationMs: 1500,
      } satisfies Analysis),
    EMPTY_RUN,
  );
}

describe("Perfect Circle manifest", () => {
  it("is a valid 2–8 player score game with practice, live and async", () => {
    expect(app).toBeDefined();
    expect(manifestShapeError(app!)).toBeNull();
    expect(app!.players).toEqual({ min: 2, max: 8 });
    expect(app!.scoring).toBe("high");
    expect([...app!.modes].sort()).toEqual(["async", "live", "practice"]);
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
    expect(app?.stats?.find((s) => s.key === "best_circle")).toMatchObject({ aggregate: "max", format: "percent" });
    expect(app?.stats?.find((s) => s.key === "perfect_circles")).toMatchObject({ aggregate: "sum" });
  });

  it("every achievement it can award is declared", () => {
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: CircleAchievement[] = [
      "first_circle",
      "well_rounded",
      "steady_hand",
      "perfect_circle",
      "hat_trick",
      "roundest",
      "photo_finish",
      "show_off",
      "its_an_egg",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
  });

  it("every stat it reports is declared", () => {
    const declared = new Set(app?.stats?.map((s) => s.key));
    const reported = { ...runStats(play(99, 98.5, 70)), ...resultProgress({ winnerId: "me", scores: { me: 99 } }, "me").stats };
    for (const key of Object.keys(reported)) expect(declared.has(key), key).toBe(true);
  });
});

describe("Perfect Circle achievements", () => {
  it("nothing before the first circle", () => {
    expect(earnedAchievements(EMPTY_RUN)).toEqual([]);
  });

  it("thresholds: 90, 95 and the 98% perfect circle", () => {
    expect(earnedAchievements(play(89.9))).toEqual(["first_circle"]);
    expect(earnedAchievements(play(90))).toEqual(["first_circle", "well_rounded"]);
    expect(earnedAchievements(play(94.9, 95))).toEqual(["first_circle", "well_rounded", "steady_hand"]);
    expect(earnedAchievements(play(PERFECT - 0.1))).not.toContain("perfect_circle");
    expect(earnedAchievements(play(PERFECT))).toContain("perfect_circle");
  });

  it("hat trick: three circles all 90%+", () => {
    expect(earnedAchievements(play(91, 92))).not.toContain("hat_trick");
    expect(earnedAchievements(play(91, 92, 90))).toContain("hat_trick");
    expect(earnedAchievements(play(91, 89.9, 99))).not.toContain("hat_trick");
  });

  it("it's an egg (secret): a scored circle under 50%", () => {
    expect(earnedAchievements(play(49.9))).toContain("its_an_egg");
    expect(earnedAchievements(play(50))).not.toContain("its_an_egg");
  });
});

describe("Perfect Circle stats", () => {
  it("best circle, perfect circles and circles drawn", () => {
    expect(runStats(play(97.3, 98.1, 99))).toEqual({ best_circle: 99, perfect_circles: 2, circles_drawn: 3 });
    expect(runStats(play(80.5))).toEqual({ best_circle: 80.5, circles_drawn: 1 });
    expect(runStats(EMPTY_RUN)).toEqual({});
  });
});

describe("Perfect Circle results", () => {
  it("a win counts, a close one is a photo finish", () => {
    expect(resultProgress({ winnerId: "me", scores: { me: 95, b1: 90, b2: 80 } }, "me")).toEqual({
      achievements: ["roundest"],
      stats: { wins: 1 },
    });
    expect(resultProgress({ winnerId: "me", scores: { me: 95.2, b1: 94.7 } }, "me").achievements).toEqual([
      "roundest",
      "photo_finish",
    ]);
  });

  it("losses and draws count for nothing", () => {
    expect(resultProgress({ winnerId: "b1", scores: { me: 90, b1: 91 } }, "me")).toEqual({ achievements: [], stats: {} });
    expect(resultProgress({ winnerId: null, scores: { me: 90, b1: 90 } }, "me")).toEqual({ achievements: [], stats: {} });
  });
});
