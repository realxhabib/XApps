import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "@/platform/catalog";
import { FACE, PART_ORDER, type PartId } from "./face";
import {
  PERFECT_WITHIN,
  ZERO_AT,
  buildSlides,
  dropAt,
  earnedAchievements,
  faceScore,
  nextCrossing,
  nextStreak,
  runStats,
  soloAchievements,
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

  it("is a standalone app (no matches) with progress", () => {
    expect(app).toBeDefined();
    expect(app!.kind).toBe("app");
    expect(manifestShapeError(app!)).toBeNull();
    expect(app!.url).toBe("/embed/gregs-face");
    expect(app!.howTo.length).toBeLessThanOrEqual(3);
    expect(statDefsError(app!.stats)).toBeNull();
    expect(achievementDefsError(app!.achievements)).toBeNull();
    expect(app!.stats?.find((s) => s.key === "best_face")).toMatchObject({ aggregate: "max", format: "percent" });
    expect(app!.achievements?.some((a) => a.secret)).toBe(true);
    expect(app!.achievements?.reduce((sum, a) => sum + a.xp, 0)).toBeLessThanOrEqual(500);
  });

  it("every id it can award is declared, and every stat it reports", () => {
    const declared = app?.achievements?.map((a) => a.id) ?? [];
    const all: FaceAchievement[] = [
      "first_face",
      "spitting_image",
      "pixel_perfect",
      "steady_hands",
      "real_greg",
      "hat_trick",
      "face_factory",
      "on_a_roll",
      "show_and_tell",
      "picasso",
    ];
    expect([...declared].sort()).toEqual([...all].sort());
    const keys = app?.stats?.map((s) => s.key).sort();
    expect(keys).toEqual(["best_face", "faces_built", "perfect_parts"]);
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

  it("a real run earns something sensible", () => {
    const slides = buildSlides(createRandom("p"));
    const run = PART_ORDER.map((part, i) => dropAt(FACE, slides, part, nextCrossing(FACE, slides, part, 800) + (i - 1) * 45));
    const earned = earnedAchievements(run);
    expect(earned).toContain("first_face");
    expect(earned.includes("picasso")).toBe(faceScore(run) < 40);
  });
});

describe("Greg's Face solo progress", () => {
  it("counts 90 %+ faces in a row, and a weaker face resets the streak", () => {
    expect(nextStreak(0, 90)).toBe(1);
    expect(nextStreak(2, 97.5)).toBe(3);
    expect(nextStreak(2, 89.9)).toBe(0);
  });

  it("face factory at 10 faces built; on a roll at three in a row", () => {
    expect(soloAchievements({ facesBuilt: 9, streak: 2 })).toEqual([]);
    expect(soloAchievements({ facesBuilt: 10, streak: 0 })).toEqual(["face_factory"]);
    expect(soloAchievements({ facesBuilt: 3, streak: 3 })).toEqual(["on_a_roll"]);
    expect(soloAchievements({ facesBuilt: 40, streak: 5 })).toEqual(["face_factory", "on_a_roll"]);
  });

  it("three spitting images in a row are on a roll", () => {
    let streak = 0;
    for (const score of [92, 95, 90.4]) streak = nextStreak(streak, score);
    expect(soloAchievements({ facesBuilt: 3, streak })).toContain("on_a_roll");
  });
});

describe("Greg's Face stats", () => {
  it("reports the face, one more built, and perfect parts only when there are some", () => {
    expect(runStats(face(100, 80, 60))).toEqual({ best_face: 80, faces_built: 1, perfect_parts: 1 });
    expect(runStats(face(90, 80, 70))).toEqual({ best_face: 80, faces_built: 1 });
  });
});
