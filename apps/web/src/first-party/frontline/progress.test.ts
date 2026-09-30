import { describe, expect, it } from "vitest";
import { getOfficialApp } from "@/platform/catalog";
import { earnedAchievements, emptyLog, finalStats } from "./progress";

describe("progress", () => {
  const app = getOfficialApp("frontline")!;

  it("every achievement it can award and every stat it reports is declared in the catalog", () => {
    const ids = new Set(app.achievements!.map((a) => a.id));
    const everything = earnedAchievements({ kills: 20, deaths: 0, headshots: 9, bestStreak: 12, firstBlood: true, pistolKills: 2, longestSnipe: 80, airborneKills: 1, won: true });
    expect(everything.length).toBe(ids.size);
    for (const id of everything) expect(ids.has(id), id).toBe(true);
    const keys = new Set(app.stats!.map((s) => s.key));
    for (const key of Object.keys(finalStats(emptyLog()))) expect(keys.has(key), key).toBe(true);
  });

  it("awards by the thresholds", () => {
    expect(earnedAchievements(emptyLog())).toEqual([]);
    expect(earnedAchievements({ ...emptyLog(), bestStreak: 3 })).toEqual(["radar_sweep"]);
    expect(earnedAchievements({ ...emptyLog(), bestStreak: 7 })).toEqual(["radar_sweep", "unstoppable"]);
    expect(earnedAchievements({ ...emptyLog(), headshots: 4 })).toEqual([]);
    expect(earnedAchievements({ ...emptyLog(), headshots: 5 })).toEqual(["headhunter"]);
    expect(earnedAchievements({ ...emptyLog(), longestSnipe: 44.9 })).toEqual([]);
    expect(earnedAchievements({ ...emptyLog(), longestSnipe: 45 })).toEqual(["long_shot"]);
    // Flawless needs a real win: five kills and no deaths.
    expect(earnedAchievements({ ...emptyLog(), won: true, kills: 4 })).toEqual(["first_win"]);
    expect(earnedAchievements({ ...emptyLog(), won: true, kills: 5 })).toEqual(["first_win", "flawless"]);
    expect(earnedAchievements({ ...emptyLog(), won: true, kills: 9, deaths: 1 })).toEqual(["first_win"]);
  });

  it("reports kills, best streak, headshots and a win", () => {
    expect(finalStats({ ...emptyLog(), kills: 7, bestStreak: 4, headshots: 2, won: false })).toEqual({ kills: 7, best_streak: 4, headshots: 2, wins: 0 });
    expect(finalStats({ ...emptyLog(), won: true }).wins).toBe(1);
  });
});
