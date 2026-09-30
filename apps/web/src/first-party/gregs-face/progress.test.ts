import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "@/platform/catalog";
import { FACE, PART_ORDER, type PartId } from "./face";
import {
  PERFECT_WITHIN,
  ZERO_AT,
  buildSlides,
  earnedAchievements,
  faceScore,
  planBot,
  resultProgress,
  runStats,
  type Drop,
  type FaceAchievement,
} from "./logic";

/** A drop with a given accuracy (the error that produces it). */
function drop(part: PartId, accuracy: number): Drop {
  const err = accuracy === 100 ? PERFECT_WITHIN / 2 : ZERO_AT * (1 - accuracy / 100);
  return { part, atMs: 1_000, u: 0.5, x: 0, err, accuracy, perfect: accuracy === 100, auto: false };
}
const face = (...acc: number[]) => acc.map((a, i) => drop(PART_ORDER[i]!, a));

describe("Greg's Face manifest", () => {
  const app = getOfficialApp("gregs-face");

  it("is a 2–8 player score game with progress", () => {
    expect(app).toBeDefined();
    expect(manifestShapeError(app!)).toBeNull();
    expect(app!.scoring).toBe("high");
    expect(app!.players).toEqual({ min: 2, max: 8 });
    expect([...app!.modes].sort()).toEqual(["async", "live", "practice"]);
    expect(app!.url).toBe("/embed/gregs-face");
    expect(statDefsError(app!.stats)).toBeNull();
    expect(achievementDefsError(app!.achievements)).toBeNull();
    expect(app!.stats?.find((s) => s.key === "best_face")).toMatchObject({ aggregate: "max", format: "percent" });
    expect(app!.achievements?.some((a) => a.secret)).toBe(true);
  });

  it("every id it can award is declared, and every stat it reports", () => {
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: FaceAchievement[] = [
      "first_face",
      "first_win",
      "spitting_image",
      "pixel_perfect",
      "steady_hands",
      "real_greg",
      "hat_trick",
      "head_of_table",
      "show_and_tell",
      "picasso",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
    const keys = app?.stats?.map((s) => s.key).sort();
    expect(keys).toEqual(["best_face", "faces_built", "perfect_parts", "wins"]);
  });
});

describe("Greg's Face achievements", () => {
  it("pixel perfect lands with the drop", () => {
    expect(earnedAchievements(face(100))).toEqual(["pixel_perfect"]);
    expect(earnedAchievements(face(99.9))).toEqual([]);
  });

  it("whole-face badges wait for the mouth", () => {
    expect(earnedAchievements(face(95, 95))).toEqual([]);
    expect(earnedAchievements(face(95, 95, 95))).toEqual(["first_face", "spitting_image", "steady_hands"]);
  });

  it("thresholds: 90 %, 97 %, every part 85 %", () => {
    expect(earnedAchievements(face(99, 99, 72))).toEqual(["first_face", "spitting_image"]);
    expect(earnedAchievements(face(100, 97, 95))).toEqual([
      "pixel_perfect",
      "first_face",
      "spitting_image",
      "real_greg",
      "steady_hands",
    ]);
    expect(earnedAchievements(face(85, 85, 85))).toEqual(["first_face", "steady_hands"]);
    expect(earnedAchievements(face(84.9, 99, 99))).toEqual(["first_face", "spitting_image"]);
  });

  it("hat trick: three perfect parts", () => {
    expect(earnedAchievements(face(100, 100, 100))).toContain("hat_trick");
    expect(earnedAchievements(face(100, 100, 99.9))).not.toContain("hat_trick");
  });

  it("picasso: a face under 40 % (secret)", () => {
    expect(earnedAchievements(face(20, 40, 50))).toEqual(["first_face", "picasso"]);
    expect(earnedAchievements(face(40, 40, 40))).not.toContain("picasso");
  });

  it("a real bot run earns something sensible", () => {
    const slides = buildSlides(createRandom("p"));
    const run = planBot(FACE, slides, createRandom("p::bot:x"));
    const earned = earnedAchievements(run.drops);
    expect(earned).toContain("first_face");
    expect(earned.includes("picasso")).toBe(faceScore(run.drops) < 40);
  });
});

describe("Greg's Face stats", () => {
  it("reports the face, one more built, and perfect parts only when there are some", () => {
    expect(runStats(face(100, 80, 60))).toEqual({ best_face: 80, faces_built: 1, perfect_parts: 1 });
    expect(runStats(face(90, 80, 70))).toEqual({ best_face: 80, faces_built: 1 });
  });
});

describe("Greg's Face results", () => {
  it("a win counts; a win at a table of four or more is head of the table", () => {
    expect(resultProgress({ winnerId: "me", scores: { me: 90, b: 80 } }, "me")).toEqual({
      achievements: ["first_win"],
      stats: { wins: 1 },
    });
    expect(resultProgress({ winnerId: "me", scores: { me: 90, b: 80, c: 70, d: 60 } }, "me").achievements).toEqual([
      "first_win",
      "head_of_table",
    ]);
  });

  it("losses and ties count for nothing", () => {
    expect(resultProgress({ winnerId: "b", scores: { me: 70, b: 80 } }, "me")).toEqual({ achievements: [], stats: {} });
    expect(resultProgress({ winnerId: null, scores: { me: 80, b: 80 } }, "me")).toEqual({ achievements: [], stats: {} });
  });
});
