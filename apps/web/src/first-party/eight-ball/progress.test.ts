import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import { achievementDefsError, getOfficialApp, statDefsError } from "@/platform/catalog";
import { BALLS, type Balls, type Vec } from "./physics";
import { earnedAchievements, gameStats, type PoolAchievement } from "./progress";
import { newGame, type Game, type LastShot, type ShotSummary } from "./rules";

const ALL: PoolAchievement[] = [
  "first_win",
  "hat_trick",
  "double_down",
  "bank_shot",
  "break_and_run",
  "whitewash",
  "comeback",
  "golden_break",
  "self_destruct",
];

function tableOf(ids: number[]): Balls {
  const balls: Balls = new Array(BALLS).fill(null);
  balls[0] = { x: 0.5, y: 0.5 };
  ids.forEach((id, k) => (balls[id] = { x: 1 + k * 0.07, y: 0.3 } as Vec));
  return balls;
}

function summary(over: Partial<ShotSummary> = {}): ShotSummary {
  return {
    foul: null,
    potted: [],
    pockets: [],
    scratch: false,
    assigned: null,
    cont: false,
    own: 0,
    banked: [],
    win: null,
    reason: null,
    respotted: false,
    brk: false,
    ...over,
  };
}

function last(seat: 0 | 1, out: Partial<ShotSummary>): LastShot {
  return { n: 5, by: seat === 0 ? "a" : "b", seat, kind: "shot", at: 0, strike: null, rec: null, out: summary(out) };
}

function game(over: Partial<Game>): Game {
  return { ...newGame(createRandom("p").next), broken: true, bih: null, solids: 0, ...over };
}

describe("8-Ball manifest", () => {
  const app = getOfficialApp("eight-ball");

  it("declares every achievement the game can award, within the platform's limits", () => {
    expect(app?.achievements?.map((a) => a.id).sort()).toEqual([...ALL].sort());
    expect(achievementDefsError(app?.achievements)).toBeNull();
    expect(statDefsError(app?.stats)).toBeNull();
    const xp = (app?.achievements ?? []).reduce((sum, a) => sum + a.xp, 0);
    expect(xp).toBeLessThanOrEqual(500);
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
    expect(app?.stats?.length).toBeGreaterThanOrEqual(2);
    expect(app?.stats?.length).toBeLessThanOrEqual(4);
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(app?.turnBased).toBe(true);
    expect(app?.url).toBe("/embed/eight-ball");
  });

  it("reports only declared stats", () => {
    const keys = new Set(app?.stats?.map((s) => s.key));
    const g = game({ winner: 0, reason: "eight", potted: [8, 3], best: [5, 2], clean: true, balls: tableOf([9, 10]) });
    for (const key of Object.keys(gameStats(g, 0))) expect(keys.has(key), key).toBe(true);
  });
});

describe("8-Ball achievements", () => {
  it("shot moments: doubles, banks and runs of three", () => {
    const g = game({ balls: tableOf([3, 4, 8, 9]), best: [3, 0], last: last(0, { own: 2, potted: [1, 2], banked: [2], cont: true }) });
    expect(earnedAchievements(g, 0)).toEqual(["hat_trick", "double_down", "bank_shot"]);
    expect(earnedAchievements(g, 1)).toEqual([]);
  });

  it("a foul earns nothing for the shot", () => {
    const g = game({ balls: tableOf([3, 4, 8, 9]), last: last(0, { own: 0, potted: [1, 2], banked: [2], foul: "scratch" }) });
    expect(earnedAchievements(g, 0)).toEqual([]);
  });

  it("break and run, whitewash", () => {
    const g = game({
      balls: tableOf([9, 10, 11, 12, 13, 14, 15]),
      winner: 0,
      reason: "eight",
      clean: true,
      best: [8, 0],
      last: last(0, { own: 1, potted: [8], win: 0, reason: "eight" }),
    });
    expect(earnedAchievements(g, 0)).toEqual(["hat_trick", "first_win", "break_and_run", "whitewash"]);
    expect(gameStats(g, 0)).toMatchObject({ wins: 1, best_run: 8, break_and_runs: 1 });
    expect(gameStats(g, 1)).toEqual({});
  });

  it("comeback: the opponent was on the 8", () => {
    const g = game({ solids: 1, balls: tableOf([]), winner: 0, reason: "eight", last: last(0, { own: 1, potted: [8], win: 0, reason: "eight" }) });
    expect(earnedAchievements(g, 0)).toContain("comeback");
  });

  it("golden break (secret)", () => {
    const g = game({ solids: null, winner: 0, reason: "golden_break", balls: tableOf([1, 2, 9]), last: last(0, { brk: true, potted: [8], win: 0 }) });
    expect(earnedAchievements(g, 0)).toEqual(["first_win", "golden_break"]);
  });

  it("self-destruct (secret) for the player who sank the 8 at the wrong moment", () => {
    const g = game({ winner: 1, reason: "early_eight", balls: tableOf([2, 9]), last: last(0, { potted: [8], win: 1, reason: "early_eight" }) });
    expect(earnedAchievements(g, 0)).toEqual(["self_destruct"]);
    expect(earnedAchievements(g, 1)).toEqual(["first_win"]);
  });
});
