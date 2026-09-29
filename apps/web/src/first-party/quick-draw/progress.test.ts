import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import {
  FALSE_START,
  NO_DRAW,
  duelStats,
  earnedAchievements,
  resolveRound,
  type ReflexesAchievement,
  type RoundResult,
} from "./logic";

const tap = (ms: number): RoundResult => ({ ms, falseStart: false });
/** Outcomes of a duel from our seat: [mine, theirs] per round. */
const duel = (...rounds: [RoundResult, RoundResult][]) => rounds.map(([me, opp], i) => resolveRound(i + 1, me, opp));

describe("Reflexes achievements", () => {
  it("every id it can award is declared in the manifest", () => {
    const declared = getOfficialApp("quick-draw")?.achievements?.map((a) => a.id) ?? [];
    const all: ReflexesAchievement[] = [
      "duel_won",
      "under_200",
      "under_150",
      "flawless",
      "comeback",
      "photo_finish",
      "metronome",
      "twitchy",
    ];
    expect(declared.sort()).toEqual(all.sort());
  });

  it("awards nothing for an ordinary lost duel", () => {
    const outcomes = duel([tap(320), tap(250)], [tap(300), tap(260)], [tap(400), tap(240)]);
    expect(earnedAchievements(outcomes, true)).toEqual([]);
  });

  it("fast taps unlock as soon as the round is revealed, win or lose", () => {
    expect(earnedAchievements(duel([tap(199), tap(150)]), false)).toEqual(["under_200"]);
    expect(earnedAchievements(duel([tap(149), tap(300)]), false)).toEqual(["under_200", "under_150"]);
    expect(earnedAchievements(duel([tap(200), tap(300)]), false)).toEqual([]);
  });

  it("photo finish: a round won by 5 ms or less", () => {
    expect(earnedAchievements(duel([tap(245), tap(250)]), false)).toContain("photo_finish");
    expect(earnedAchievements(duel([tap(244), tap(250)]), false)).not.toContain("photo_finish");
    // Losing by a hair or a dead heat doesn't count.
    expect(earnedAchievements(duel([tap(250), tap(247)]), false)).not.toContain("photo_finish");
    expect(earnedAchievements(duel([tap(250), tap(250)]), false)).not.toContain("photo_finish");
  });

  it("twitchy: three false starts in one duel (secret)", () => {
    const two = duel([FALSE_START, tap(250)], [FALSE_START, tap(260)]);
    expect(earnedAchievements(two, false)).not.toContain("twitchy");
    const three = duel([FALSE_START, tap(250)], [FALSE_START, tap(260)], [FALSE_START, FALSE_START]);
    expect(earnedAchievements(three, false)).toContain("twitchy");
  });

  it("duel-level badges wait for the final", () => {
    const sweep = duel([tap(230), tap(300)], [tap(240), tap(310)], [tap(236), tap(290)]);
    expect(earnedAchievements(sweep, false)).toEqual([]);
    expect(earnedAchievements(sweep, true)).toEqual(["duel_won", "flawless", "metronome"]);
  });

  it("a 3–1 win is a win but not flawless", () => {
    const outcomes = duel([tap(230), tap(300)], [tap(400), tap(310)], [tap(236), tap(290)], [tap(280), tap(290)]);
    const earned = earnedAchievements(outcomes, true);
    expect(earned).toContain("duel_won");
    expect(earned).not.toContain("flawless");
    expect(earned).not.toContain("metronome"); // 230–400 is far too wide
  });

  it("comeback: win after falling 0–2 behind", () => {
    const outcomes = duel(
      [tap(300), tap(250)],
      [NO_DRAW, tap(260)],
      [tap(230), tap(300)],
      [tap(240), FALSE_START],
      [tap(235), tap(250)],
    );
    expect(earnedAchievements(outcomes, true)).toEqual(expect.arrayContaining(["duel_won", "comeback"]));
    // Trailing 0–1 and then winning isn't a comeback.
    const close = duel([tap(300), tap(250)], [tap(230), tap(300)], [tap(240), tap(300)], [tap(235), tap(250)]);
    expect(earnedAchievements(close, true)).not.toContain("comeback");
    // Falling 0–2 behind and losing isn't either.
    const lost = duel([tap(300), tap(250)], [tap(340), tap(250)], [tap(380), tap(250)]);
    expect(earnedAchievements(lost, true)).toEqual([]);
  });

  it("metronome needs three clean taps within 30 ms and no fouls", () => {
    const tight = duel([tap(250), tap(200)], [tap(270), tap(200)], [tap(280), tap(200)]);
    expect(earnedAchievements(tight, true)).toEqual(["metronome"]);
    const wide = duel([tap(250), tap(200)], [tap(270), tap(200)], [tap(281), tap(200)]);
    expect(earnedAchievements(wide, true)).toEqual([]);
    const foul = duel([tap(250), tap(300)], [FALSE_START, tap(200)], [tap(260), tap(300)], [tap(255), tap(300)]);
    expect(earnedAchievements(foul, true)).not.toContain("metronome");
  });
});

describe("Reflexes stats", () => {
  it("reports best reaction, rounds won and wins", () => {
    const sweep = duel([tap(230), tap(300)], [tap(212), tap(310)], [tap(236), tap(290)]);
    expect(duelStats(sweep)).toEqual({ best_reaction: 212, rounds_won: 3, duels_won: 1, perfect_duels: 1 });
    const loss = duel([tap(230), tap(200)], [FALSE_START, tap(310)], [tap(236), tap(290)], [tap(300), tap(200)]);
    expect(duelStats(loss)).toEqual({ best_reaction: 230, rounds_won: 1 });
  });

  it("leaves out what didn't happen", () => {
    expect(duelStats(duel([FALSE_START, tap(250)], [NO_DRAW, tap(250)], [FALSE_START, tap(250)]))).toEqual({});
  });
});
