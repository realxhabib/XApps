import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import {
  ROUNDS,
  buildQuestions,
  earnedAchievements,
  finalStats,
  scoreRounds,
  type AnswerMap,
  type TriviaAchievement,
  type TriviaState,
} from "./logic";

const questions = buildQuestions(createRandom("progress-seed"));
const right = (round: number) => (questions[round - 1] as (typeof questions)[number]).correct;
const wrong = (round: number) => (right(round) + 1) % 4;

/** One player's picks: "R" right, "W" wrong, "-" no answer; `ms` per answer. */
type Script = string;
function answers(scripts: { [id: string]: Script }, ms: { [id: string]: number } = {}): AnswerMap[] {
  return Array.from({ length: ROUNDS }, (_, i) => {
    const map: AnswerMap = {};
    for (const [id, script] of Object.entries(scripts)) {
      const c = script[i];
      if (c === "R") map[id] = { choice: right(i + 1), ms: ms[id] ?? 5_000 };
      else if (c === "W") map[id] = { choice: wrong(i + 1), ms: ms[id] ?? 5_000 };
    }
    return map;
  });
}

function finalState(rounds: AnswerMap[]): TriviaState {
  return { v: 1, round: ROUNDS, phase: "final", startedAt: 0, driver: "me", answers: {}, history: rounds };
}

/** The reveal of `round` (1-based): earlier rounds in history, this one's answers on the table. */
function revealState(rounds: AnswerMap[], round: number): TriviaState {
  return {
    v: 1,
    round,
    phase: "reveal",
    startedAt: 0,
    driver: "me",
    answers: rounds[round - 1] ?? {},
    history: rounds.slice(0, round - 1),
  };
}

const earned = (scripts: { [id: string]: Script }, ms: { [id: string]: number } = {}, me = "me") =>
  earnedAchievements(questions, finalState(answers(scripts, ms)), Object.keys(scripts), me);

describe("Trivia Royale achievements", () => {
  it("every id it can award is declared in the manifest", () => {
    const declared = getOfficialApp("trivia-royale")?.achievements?.map((a) => a.id) ?? [];
    const all: TriviaAchievement[] = [
      "crowned",
      "perfect_game",
      "speed_demon",
      "on_fire",
      "podium",
      "lone_genius",
      "clutch",
      "host_with_most",
      "gloriously_wrong",
    ];
    expect(declared.sort()).toEqual(all.sort());
  });

  it("8 for 8 at a 1v1 table", () => {
    expect(earned({ me: "RRRRRRRR", bot: "RWRWRWRW" })).toEqual(["on_fire", "crowned", "perfect_game"]);
  });

  it("nothing for a middling loss", () => {
    expect(earned({ me: "RWRWRWWW", bot: "RRRRWRRR" })).toEqual([]);
  });

  it("speed demon: a right answer within 2 s", () => {
    expect(earned({ me: "RWWWWWWW", bot: "RRRRRRRR" }, { me: 2_000 })).toContain("speed_demon");
    expect(earned({ me: "RWWWWWWW", bot: "RRRRRRRR" }, { me: 2_001 })).not.toContain("speed_demon");
    // Fast but wrong doesn't count.
    expect(earned({ me: "WWWWWWWW", bot: "RRRRRRRR" }, { me: 900 })).not.toContain("speed_demon");
  });

  it("on fire: five right in a row", () => {
    expect(earned({ me: "WRRRRRWW", bot: "RRRRRRRR" })).toContain("on_fire");
    expect(earned({ me: "RRRRWRRR", bot: "RRRRRRRR" })).not.toContain("on_fire");
  });

  it("lone genius needs a table of three or more", () => {
    expect(earned({ me: "RWWWWWWW", a: "WWWWWWWW", b: "W-WWWWWW" })).toContain("lone_genius");
    expect(earned({ me: "RWWWWWWW", a: "RWWWWWWW", b: "WWWWWWWW" })).not.toContain("lone_genius");
    expect(earned({ me: "RWWWWWWW", a: "WWWWWWWW" })).not.toContain("lone_genius");
  });

  it("per-answer badges unlock at that round's reveal; table ones wait for the final", () => {
    const rounds = answers({ me: "RRRRRRRR", bot: "WWWWWWWW" }, { me: 1_500 });
    const ids = ["me", "bot"];
    expect(earnedAchievements(questions, revealState(rounds, 1), ids, "me")).toEqual(["speed_demon"]);
    expect(earnedAchievements(questions, revealState(rounds, 4), ids, "me")).toEqual(["speed_demon"]);
    expect(earnedAchievements(questions, revealState(rounds, 5), ids, "me")).toEqual(["speed_demon", "on_fire"]);
    expect(earnedAchievements(questions, finalState(rounds), ids, "me")).toEqual([
      "speed_demon",
      "on_fire",
      "crowned",
      "perfect_game",
    ]);
    // A question still open reveals nothing.
    const open: TriviaState = { ...revealState(rounds, 1), phase: "question" };
    expect(earnedAchievements(questions, open, ids, "me")).toEqual([]);
  });

  it("podium: top three at a table of four or more", () => {
    const four = { a: "RRRRRRRR", b: "RRRRRRRW", me: "RRRRRWWW", c: "WWWWWWWW" };
    expect(earned(four)).toContain("podium");
    expect(earned({ a: "RRRRRRRR", b: "RRRRRRRW", me: "RRRRRWWW" })).not.toContain("podium");
    expect(earned({ ...four, d: "RRRRRRWW" })).not.toContain("podium");
  });

  it("double or nothing: take the sole lead on the final round", () => {
    // Level going into round 8 (same picks, same times), then only I get the double round right.
    expect(earned({ me: "RRWRRWRR", bot: "RRWRRWRW" })).toEqual(expect.arrayContaining(["crowned", "clutch"]));
    // Already leading before the last round: a win, not a clutch one.
    expect(earned({ me: "RRRRRRRR", bot: "WWWWWWWW" })).not.toContain("clutch");
  });

  it("host with the most: win a full table of eight", () => {
    const table = { me: "RRRRRRRR", a: "RRRRRRRW", b: "RWRRRRRW", c: "WWWWWWWW", d: "W", e: "", f: "RRRR", g: "WR" };
    expect(earned(table)).toContain("host_with_most");
    expect(earned(table, {}, "a")).not.toContain("host_with_most");
    const seven = Object.fromEntries(Object.entries(table).filter(([id]) => id !== "g"));
    expect(earned(seven)).not.toContain("host_with_most");
  });

  it("a tie for first is not a win", () => {
    expect(earned({ me: "RRRRRRRR", bot: "RRRRRRRR" })).not.toContain("crowned");
  });

  it("gloriously wrong: answer all eight, miss all eight (secret)", () => {
    expect(earned({ me: "WWWWWWWW", bot: "RRRRRRRR" })).toEqual(["gloriously_wrong"]);
    expect(earned({ me: "WWWWWWW-", bot: "RRRRRRRR" })).toEqual([]);
  });

  it("spectators and strangers earn nothing", () => {
    expect(earned({ a: "RRRRRRRR", b: "WWWWWWWW" }, {}, "me")).toEqual([]);
    expect(earnedAchievements(questions, null, ["me"], "me")).toEqual([]);
  });
});

describe("Trivia Royale stats", () => {
  it("reports score, correct answers, best streak and crowns", () => {
    const ids = ["me", "bot"];
    const table = scoreRounds(questions, answers({ me: "RRRWRRWR", bot: "WWWWWWWW" }), ids);
    const mine = table.find((s) => s.id === "me");
    expect(finalStats(table, "me")).toEqual({ best_score: mine?.total, correct_answers: 6, best_streak: 3, crowns: 1 });
    expect(finalStats(table, "bot")).toEqual({ best_score: 0 });
    expect(finalStats(table, "nobody")).toEqual({});
  });
});
