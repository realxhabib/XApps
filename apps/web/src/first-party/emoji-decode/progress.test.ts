import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import {
  EMPTY_RUN,
  INTRO_GRACE_MS,
  QUESTION_MS,
  buildMatch,
  earnedAchievements,
  recordAnswer,
  resultProgress,
  runStats,
  type DecodeAchievement,
  type RunState,
} from "./logic";

const questions = buildMatch(createRandom("progress-seed"));

/** Plays a run: "R" right, "W" wrong, "-" timed out; each answer `elapsedMs` after the puzzle appeared. */
function play(script: string, elapsedMs: number | number[] = 5_000): RunState {
  let run = EMPTY_RUN;
  [...script].forEach((c, i) => {
    const q = questions[i];
    if (!q) return;
    const elapsed = Array.isArray(elapsedMs) ? (elapsedMs[i] ?? 5_000) : elapsedMs;
    const remaining = Math.max(0, Math.min(QUESTION_MS, QUESTION_MS - (elapsed - INTRO_GRACE_MS)));
    const choice = c === "R" ? q.correctIndex : c === "W" ? (q.correctIndex + 1) % q.options.length : null;
    run = recordAnswer(run, q, choice, c === "-" ? 0 : remaining, elapsed).run;
  });
  return run;
}

describe("Emoji Decode achievements", () => {
  it("every id it can award is declared in the manifest", () => {
    const declared = getOfficialApp("emoji-decode")?.achievements?.map((a) => a.id) ?? [];
    const all: DecodeAchievement[] = [
      "first_win",
      "fluent",
      "lightning",
      "on_a_roll",
      "score_1500",
      "speed_reader",
      "photo_finish",
      "lost_in_translation",
    ];
    expect(declared.sort()).toEqual(all.sort());
  });

  it("lightning read: decoded within 2 s, the moment it lands", () => {
    expect(earnedAchievements(play("R", 2_000))).toEqual(["lightning"]);
    expect(earnedAchievements(play("R", 2_001))).toEqual([]);
    expect(earnedAchievements(play("W", 900))).toEqual([]);
  });

  it("on a roll: five in a row", () => {
    expect(earnedAchievements(play("RRRR"))).toEqual([]);
    expect(earnedAchievements(play("WRRRRR"))).toEqual(["on_a_roll"]);
  });

  it("whole-match badges wait for the eighth answer", () => {
    const seven = play("RRRRRRR", 3_000);
    expect(earnedAchievements(seven)).not.toContain("fluent");
    const eight = play("RRRRRRRR", 3_000);
    expect(eight.total).toBeGreaterThanOrEqual(1_500);
    expect(earnedAchievements(eight)).toEqual(["on_a_roll", "fluent", "score_1500", "speed_reader"]);
  });

  it("the 1,500 club needs speed as well as accuracy", () => {
    const slow = play("RRRRRRRR", 6_000);
    expect(slow.total).toBeLessThan(1_500);
    expect(earnedAchievements(slow)).toEqual(["on_a_roll", "fluent"]);
  });

  it("speed reader: six or more decoded, averaging under 4 s", () => {
    expect(earnedAchievements(play("RRWRRWRR", 3_900))).toContain("speed_reader");
    expect(earnedAchievements(play("RRWRRWRR", 4_000))).not.toContain("speed_reader");
    expect(earnedAchievements(play("RRWRRWWR", 1_000))).not.toContain("speed_reader");
  });

  it("lost in translation: all eight missed (secret)", () => {
    expect(earnedAchievements(play("WWWW----"))).toEqual(["lost_in_translation"]);
    expect(earnedAchievements(play("WWWW---R"))).not.toContain("lost_in_translation");
  });
});

describe("Emoji Decode stats", () => {
  it("reports score, puzzles decoded and the fastest decode", () => {
    const run = play("RWRRWRRW", [3_000, 900, 2_400, 5_000, 1_000, 6_000, 2_500, 800]);
    expect(runStats(run)).toEqual({ best_score: run.total, puzzles_decoded: 5, fastest_decode: 2_400 });
    expect(runStats(play("WWWWWWWW"))).toEqual({ best_score: 0 });
  });
});

describe("Emoji Decode results", () => {
  it("a win counts, a close one is a photo finish", () => {
    expect(resultProgress({ winnerId: "me", scores: { me: 900, bot: 700 } }, "me")).toEqual({
      achievements: ["first_win"],
      stats: { wins: 1 },
    });
    expect(resultProgress({ winnerId: "me", scores: { me: 900, bot: 875 } }, "me").achievements).toEqual([
      "first_win",
      "photo_finish",
    ]);
  });

  it("losses and draws count for nothing", () => {
    expect(resultProgress({ winnerId: "bot", scores: { me: 900, bot: 901 } }, "me")).toEqual({ achievements: [], stats: {} });
    expect(resultProgress({ winnerId: null, scores: { me: 900, bot: 900 } }, "me")).toEqual({ achievements: [], stats: {} });
  });
});
