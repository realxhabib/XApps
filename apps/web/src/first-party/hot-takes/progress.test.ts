import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import {
  TAKE_LIMIT,
  lockInAchievements,
  lockInStats,
  resultProgress,
  type HotTakesAchievement,
  type LockIn,
} from "./logic";

const lockIn = (patch: Partial<LockIn> = {}): LockIn => ({
  take: "Pineapple on pizza is the only honest topping.",
  spice: 1,
  remainingMs: 40_000,
  forced: false,
  ...patch,
});

describe("Hot Takes achievements", () => {
  it("every id it can award is declared in the manifest", () => {
    const declared = getOfficialApp("hot-takes")?.achievements?.map((a) => a.id) ?? [];
    const all: HotTakesAchievement[] = [
      "first_take",
      "ghost_pepper",
      "every_char",
      "crowd_pleaser",
      "too_hot",
      "short_sweet",
      "shutout",
      "buzzer_beater",
    ];
    expect(declared.sort()).toEqual(all.sort());
  });

  it("locking in a take", () => {
    expect(lockInAchievements(lockIn())).toEqual(["first_take"]);
    expect(lockInAchievements(lockIn({ spice: 3 }))).toEqual(["first_take", "ghost_pepper"]);
    expect(lockInStats()).toEqual({ takes: 1 });
  });

  it("every last character: exactly 280, emoji counted as one", () => {
    expect(lockInAchievements(lockIn({ take: "a".repeat(TAKE_LIMIT) }))).toContain("every_char");
    expect(lockInAchievements(lockIn({ take: "a".repeat(TAKE_LIMIT - 1) }))).not.toContain("every_char");
    expect(lockInAchievements(lockIn({ take: `${"a".repeat(TAKE_LIMIT - 1)}🔥` }))).toContain("every_char");
  });

  it("buzzer beater: locked in by hand with 5 s or less left (secret)", () => {
    expect(lockInAchievements(lockIn({ remainingMs: 5_000 }))).toContain("buzzer_beater");
    expect(lockInAchievements(lockIn({ remainingMs: 5_001 }))).not.toContain("buzzer_beater");
    // The live clock auto-submitting doesn't count, and neither does a soft clock that already ran out.
    expect(lockInAchievements(lockIn({ remainingMs: 300, forced: true }))).not.toContain("buzzer_beater");
    expect(lockInAchievements(lockIn({ remainingMs: -12_000 }))).not.toContain("buzzer_beater");
    expect(lockInAchievements(lockIn({ remainingMs: null }))).not.toContain("buzzer_beater");
  });
});

describe("Hot Takes results", () => {
  const mild = { take: "Cereal is soup. Milk is broth. Deal with it, breakfast people.", spice: 1 as const };

  it("a win with votes on both sides", () => {
    expect(resultProgress({ winnerId: "me", votes: { me: 5, opp: 3 } }, "me", "opp", mild)).toEqual({
      achievements: ["crowd_pleaser"],
      stats: { votes: 5, wins: 1 },
    });
  });

  it("spice, length and shutout badges", () => {
    const nuclear = { take: "Cereal is soup.", spice: 3 as const };
    expect(resultProgress({ winnerId: "me", votes: { me: 5, opp: 0 } }, "me", "opp", nuclear).achievements).toEqual([
      "crowd_pleaser",
      "too_hot",
      "short_sweet",
      "shutout",
    ]);
    // Without our take (a later session), only the vote-based ones.
    expect(resultProgress({ winnerId: "me", votes: { me: 5 } }, "me", "opp", null).achievements).toEqual([
      "crowd_pleaser",
      "shutout",
    ]);
  });

  it("a loss still counts the votes you got", () => {
    expect(resultProgress({ winnerId: "opp", votes: { me: 2, opp: 5 } }, "me", "opp", mild)).toEqual({
      achievements: [],
      stats: { votes: 2 },
    });
    expect(resultProgress({ winnerId: null, votes: {} }, "me", "opp", mild)).toEqual({ achievements: [], stats: {} });
  });
});
