import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, statDefsError } from "@/platform/catalog";
import {
  ALL_ACHIEVEMENTS,
  F_BOUNCE,
  F_RIM,
  applyAction,
  earnedAchievements,
  gameStats,
  newGame,
  scoreFor,
  type Action,
  type GameState,
} from "./logic";

const T = (by: string, c: number, f = 0): Action => ({ k: "t", by, a: 0, p: 0.7, c, f, at: 1 });
const X = (by: string, c: number): Action => ({ k: "x", by, c, at: 1 });

function play(actions: Action[]): GameState {
  let g = newGame();
  for (const a of actions) {
    const next = applyAction(g, a, a.by === "alice" ? 0 : 1);
    if (!next) throw new Error(`illegal ${JSON.stringify(a)}`);
    g = next;
  }
  return g;
}

const ALL_BOB = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

describe("Cup Pong manifest", () => {
  const app = getOfficialApp("cup-pong");

  it("declares every achievement it can award, 2–4 stats and 6–10 achievements (≤ 500 XP, a secret or two)", () => {
    expect(app).toBeDefined();
    expect(app?.url).toBe("/embed/cup-pong");
    expect(app?.turnBased).toBe(true);
    expect(app?.achievements?.map((a) => a.id).sort()).toEqual([...ALL_ACHIEVEMENTS].sort());
    expect(app?.stats?.length).toBeGreaterThanOrEqual(2);
    expect(app?.stats?.length).toBeLessThanOrEqual(4);
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(statDefsError(app?.stats)).toBeNull();
    expect(achievementDefsError(app?.achievements)).toBeNull();
    expect(app?.achievements?.reduce((s, a) => s + a.xp, 0)).toBeLessThanOrEqual(500);
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
  });

  it("reports only declared stats", () => {
    const keys = new Set(app?.stats?.map((s) => s.key));
    const g = play([T("alice", 9, F_BOUNCE), X("alice", 8), T("alice", 7), T("alice", 6)]);
    for (const key of Object.keys(gameStats(g, 0, 0))) expect(keys.has(key), key).toBe(true);
  });
});

describe("Cup Pong achievements", () => {
  it("a clean sweep win, streaks and balls back", () => {
    const g = play(ALL_BOB.map((c) => T("alice", c)));
    const earned = earnedAchievements(g, 0);
    expect(earned).toEqual(expect.arrayContaining(["first_win", "clean_sweep", "on_fire", "balls_back", "heat_check"]));
    expect(earned).not.toContain("clutch");
    expect(earnedAchievements(g, 1)).toEqual([]);
  });

  it("bounce shots and rim rattlers unlock as they happen", () => {
    const g = play([T("alice", 9, F_BOUNCE), X("alice", 8), T("alice", 7, F_RIM)]);
    expect(earnedAchievements(g, 0)).toEqual(expect.arrayContaining(["bounce_shot", "rim_rattler", "balls_back"]));
    expect(earnedAchievements(g, 0)).not.toContain("first_win");
  });

  it("clutch and comeback: win on your last cup after trailing big", () => {
    // Alice sinks 9 of Bob's cups first; Bob then runs the table.
    const actions: Action[] = [];
    const bobCups = [9, 8, 7, 6, 5, 4, 3, 2, 1];
    for (let i = 0; i < bobCups.length; i += 2) {
      actions.push(T("alice", bobCups[i]!));
      actions.push(T("alice", bobCups[i + 1] ?? -1));
      if (bobCups[i + 1] !== undefined) {
        // balls back: alice keeps throwing — make her miss once to pass the turn.
        actions.push(T("alice", -1), T("alice", -1));
        actions.push(T("bob", -1), T("bob", -1));
      } else {
        actions.push(T("bob", -1), T("bob", -1));
      }
    }
    const trailing = play(actions);
    expect(trailing.racks[1]).toHaveLength(1);
    expect(trailing.turn).toBe(0);
    const g = play([...actions, T("alice", -1), T("alice", -1), ...[9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((c) => T("bob", c))]);
    expect(g.winner).toBe(1);
    expect(g.racks[1]).toHaveLength(1);
    expect(earnedAchievements(g, 1)).toEqual(expect.arrayContaining(["first_win", "clutch", "comeback"]));
    expect(scoreFor(g.winner, 1)).toBe(1);
    expect(scoreFor(g.winner, 0)).toBe(0);
  });

  it("a win because the opponent left only counts as a win", () => {
    const g = play([T("alice", 9)]);
    expect(earnedAchievements(g, 0, 0)).toEqual(["first_win"]);
    expect(gameStats(g, 0, 0)).toEqual({ cups_sunk: 1, wins: 1 });
  });

  it("stats: cups (bonus picks included), wins, bounces and fire streaks", () => {
    const g = play([T("alice", 9, F_BOUNCE), X("alice", 8), T("alice", 7), T("alice", 6)]);
    expect(gameStats(g, 0, null)).toEqual({ cups_sunk: 4, bounce_shots: 1, fire_streaks: 1 });
    expect(gameStats(newGame(), 1, null)).toEqual({});
  });
});
