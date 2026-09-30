import { describe, expect, it } from "vitest";
import { earnedAchievements, emptyRecord, knockoutCount, parseSettings, placeSuffix, pointsFor } from "./logic";
import { rollItem } from "./items";

describe("rules", () => {
  it("awards points by place", () => {
    expect([0, 1, 2, 7, 8].map(pointsFor)).toEqual([15, 12, 10, 1, 0]);
  });

  it("names places", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(placeSuffix)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("parses challenge settings", () => {
    expect(parseSettings({}).cup.id).toBe("solar");
    const s = parseSettings({ track: "europa", cc: 200, laps: 2, mirror: true, mode: "knockout" });
    expect(s.cup.tracks).toEqual(["europa"]);
    expect(s).toMatchObject({ cc: 200, laps: 2, mirror: true, knockout: true });
    expect(parseSettings({ cc: 999, laps: 40 })).toMatchObject({ cc: 150, laps: 3 });
  });

  it("knocks out racers but always leaves a final duel", () => {
    expect(knockoutCount(8, 2)).toBe(3);
    expect(knockoutCount(5, 1)).toBe(3);
    expect(knockoutCount(2, 1)).toBe(0);
    expect(knockoutCount(8, 0)).toBe(0);
    let alive = 8;
    for (let left = 2; left >= 1; left--) alive -= knockoutCount(alive, left);
    expect(alive).toBe(2);
  });

  it("never hands the leader a comeback item", () => {
    for (let i = 0; i < 200; i++) expect(["singularity", "emp", "warp"]).not.toContain(rollItem(0, 8, i / 200));
  });

  it("earns achievements", () => {
    const win = { ...emptyRecord("mars"), place: 0, purpleTurbos: 1, worstPlace: 7 };
    const got = earnedAchievements([win, win], { place: 0, complete: true });
    expect(got).toEqual(expect.arrayContaining(["liftoff", "champion", "flawless", "checkered", "ultra_turbo", "untouchable", "comeback"]));
  });
});
