import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import {
  countBlocks,
  earnedAchievements,
  gameStats,
  replay,
  winningColumns,
  type FourAchievement,
  type GameState,
} from "./logic";

function game(moves: number[]): GameState {
  const state = replay(moves);
  if (!state) throw new Error(`illegal sequence ${moves.join(",")}`);
  return state;
}

const LIVE = { async: false };
/** Seat 0 wins on the bottom row with its fourth disc. */
const QUICK = [0, 0, 1, 1, 2, 2, 3];
/** Seat 0 wins on the (0,0)→(3,3) diagonal with its sixth disc. */
const DIAGONAL = [0, 1, 1, 2, 3, 2, 2, 3, 6, 3, 3];
/** Seat 0 fills the gap in 0 1 2 _ 4: five in a row. */
const FIVE = [0, 6, 1, 6, 4, 5, 2, 5, 3];
/** Seat 1 blocks seat 0's 0 1 2 on the bottom row. */
const BLOCK = [0, 6, 1, 6, 2, 3];
/** Seat 0's last disc completes a diagonal and another line at once. */
const DOUBLE = [3, 5, 3, 0, 3, 6, 5, 0, 1, 6, 1, 0, 4, 5, 1, 4, 4, 1, 5, 3, 2];
/** Seat 1 blocks three would-be fours (the game is still going). */
const WALL = [1, 3, 5, 2, 6, 1, 5, 2, 3, 0, 2, 4, 5, 5, 6, 4, 6, 2, 0, 1, 3, 4, 4, 4, 3, 4, 6];
/** 42 discs, no four anywhere. */
const DRAW = [4, 0, 2, 6, 6, 0, 2, 6, 6, 0, 0, 2, 0, 0, 5, 1, 5, 4, 2, 4, 2, 3, 1, 5, 6, 1, 4, 2, 5, 5, 1, 1, 1, 5, 6, 3, 3, 3, 4, 3, 3, 4];
/** Seat 1's 42nd disc makes four. */
const LAST_DISC_WINS = [
  3, 2, 0, 0, 6, 0, 0, 5, 5, 0, 5, 1, 1, 3, 2, 0, 5, 5, 2, 6, 5, 4, 2, 2, 6, 6, 2, 4, 6, 6, 3, 4, 4, 3, 4, 1, 1, 3, 1, 3, 4, 1,
];

describe("Four in a Row achievements", () => {
  it("every id it can award is declared in the manifest", () => {
    const declared = getOfficialApp("four-in-a-row")?.achievements?.map((a) => a.id) ?? [];
    const all: FourAchievement[] = [
      "first_win",
      "diagonal",
      "quick_four",
      "blocker",
      "the_wall",
      "marathon",
      "pen_pal",
      "long_line",
      "double_trouble",
    ];
    expect(declared.sort()).toEqual(all.sort());
  });

  it("a quick horizontal win", () => {
    expect(earnedAchievements(game(QUICK), 0, LIVE)).toEqual(["first_win", "quick_four"]);
    expect(earnedAchievements(game(QUICK), 1, LIVE)).toEqual([]);
  });

  it("diagonal and five-in-a-row wins", () => {
    expect(earnedAchievements(game(DIAGONAL), 0, LIVE)).toEqual(["first_win", "diagonal", "quick_four"]);
    expect(earnedAchievements(game(FIVE), 0, LIVE)).toEqual(["first_win", "quick_four", "long_line"]);
  });

  it("quick four means seven or fewer of your own discs", () => {
    const g = game(DOUBLE);
    expect(g.discs.filter((d) => d.seat === 0).length).toBe(11);
    expect(earnedAchievements(g, 0, LIVE)).not.toContain("quick_four");
  });

  it("double trouble: one disc, two lines (secret)", () => {
    const g = game(DOUBLE);
    expect(g.winLines.length).toBeGreaterThanOrEqual(2);
    expect(earnedAchievements(g, 0, LIVE)).toEqual(["first_win", "diagonal", "double_trouble"]);
  });

  it("blocks count the moment they happen, for the blocker only", () => {
    expect(winningColumns(game(BLOCK.slice(0, 5)), 0)).toEqual([3]);
    expect(countBlocks(BLOCK, 1)).toBe(1);
    expect(countBlocks(BLOCK, 0)).toBe(0);
    expect(earnedAchievements(game(BLOCK), 1, LIVE)).toEqual(["blocker"]);
    expect(earnedAchievements(game(BLOCK), 0, LIVE)).toEqual([]);
  });

  it("the wall: three blocks in one game", () => {
    expect(countBlocks(WALL, 1)).toBeGreaterThanOrEqual(3);
    expect(earnedAchievements(game(WALL), 1, LIVE)).toEqual(["blocker", "the_wall"]);
  });

  it("a winning move isn't counted as a block", () => {
    // Seat 1 threatens col 3 on row 1, seat 0 wins on the bottom row instead of blocking.
    expect(countBlocks(QUICK, 0)).toBe(0);
  });

  it("marathon: all 42 cells, draw or last-disc win", () => {
    expect(earnedAchievements(game(DRAW), 0, LIVE)).toContain("marathon");
    expect(earnedAchievements(game(DRAW), 1, LIVE)).toContain("marathon");
    expect(earnedAchievements(game(LAST_DISC_WINS), 1, LIVE)).toEqual(expect.arrayContaining(["marathon", "first_win"]));
    expect(earnedAchievements(game(LAST_DISC_WINS), 0, LIVE)).not.toContain("first_win");
  });

  it("turn-based win only in play-anytime games", () => {
    expect(earnedAchievements(game(QUICK), 0, { async: true })).toContain("pen_pal");
    expect(earnedAchievements(game(QUICK), 1, { async: true })).not.toContain("pen_pal");
  });

  it("a win because the opponent left counts as a win, but not as a line", () => {
    const g = game([3, 3, 4]);
    expect(earnedAchievements(g, 1, { async: true, winner: 1 })).toEqual(["first_win", "pen_pal"]);
    expect(earnedAchievements(g, 0, { async: false, winner: 1 })).toEqual([]);
  });
});

describe("Four in a Row stats", () => {
  it("reports wins, discs used and the winning line", () => {
    expect(gameStats(game(QUICK), 0)).toEqual({ wins: 1, fastest_win: 4, longest_line: 4 });
    expect(gameStats(game(FIVE), 0)).toEqual({ wins: 1, fastest_win: 5, longest_line: 5 });
    expect(gameStats(game(DIAGONAL), 0)).toEqual({ wins: 1, fastest_win: 6, longest_line: 4 });
  });

  it("losses, draws and abandon wins", () => {
    expect(gameStats(game(QUICK), 1)).toEqual({});
    expect(gameStats(game(DRAW), 0)).toEqual({});
    expect(gameStats(game([3, 3, 4]), 1, 1)).toEqual({ wins: 1 });
  });
});
