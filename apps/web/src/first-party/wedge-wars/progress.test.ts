import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { achievementDefsError, getOfficialApp, manifestShapeError, statDefsError } from "@/platform/catalog";
import { earnedAchievements, finalStats, type MatchLog, type WedgeAchievement } from "./logic";

const log = (o: Partial<MatchLog> = {}): MatchLog => ({
  players: 2,
  rank: 2,
  weapon: "spinner",
  hpLeft: 0,
  dmgDealt: 40,
  kos: 0,
  firstKo: false,
  pitKos: 0,
  flameKos: 0,
  hammerHits: 0,
  bestFlipCm: 0,
  pulverized: false,
  ...o,
});

const ALL: WedgeAchievement[] = [
  "first_win",
  "first_blood",
  "flipped",
  "pit_boss",
  "untouchable",
  "flamed_out",
  "hammer_time",
  "last_standing",
  "pulverized",
];

describe("Wedge Wars manifest", () => {
  const app = getOfficialApp("wedge-wars");

  it("is a valid 2–4 player free-for-all with 4 stats and 6–10 achievements", () => {
    expect(app).toBeDefined();
    expect(manifestShapeError(app!)).toBeNull();
    expect(app?.players).toEqual({ min: 2, max: 4 });
    expect(app?.teams).toBe(0);
    expect(app?.spectators).toBe(true);
    expect(app?.modes).toEqual(["live", "practice"]);
    expect(app?.scoring).toBe("high");
    expect(app?.stats).toHaveLength(4);
    expect(statDefsError(app?.stats)).toBeNull();
    expect(achievementDefsError(app?.achievements)).toBeNull();
    expect(app?.achievements?.length).toBeGreaterThanOrEqual(6);
    expect(app?.achievements?.length).toBeLessThanOrEqual(10);
    expect(app?.achievements?.some((a) => a.secret)).toBe(true);
  });

  it("declares exactly the achievements the game can award", () => {
    expect(app?.achievements?.map((a) => a.id).sort()).toEqual([...ALL].sort());
  });

  it("the migration seeds the same manifest", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../../../../supabase/migrations/20261004000000_wedge_wars.sql", import.meta.url)), "utf8");
    const blocks = [...sql.matchAll(/\$json\$([\s\S]*?)\$json\$::jsonb/g)].map((m) => JSON.parse(m[1] as string));
    expect(blocks).toEqual([app?.stats, app?.achievements]);
    expect(sql).toContain("'wedge-wars'");
    expect(sql).toMatch(/2, 4, 0, true, false, false/);
    expect(sql).toContain("'{live,practice}'");
    expect(sql).toMatch(/on conflict \(slug\) do update/);
  });
});

describe("Wedge Wars achievements", () => {
  it("a plain loss earns nothing", () => {
    expect(earnedAchievements(log())).toEqual([]);
  });

  it("winning, and winning big", () => {
    expect(earnedAchievements(log({ rank: 1, hpLeft: 40 }))).toEqual(["first_win"]);
    expect(earnedAchievements(log({ rank: 1, hpLeft: 76 }))).toEqual(["first_win", "untouchable"]);
    expect(earnedAchievements(log({ rank: 1, hpLeft: 75 }))).not.toContain("untouchable");
    expect(earnedAchievements(log({ rank: 1, hpLeft: 10, players: 4 }))).toEqual(["first_win", "last_standing"]);
    expect(earnedAchievements(log({ rank: 2, hpLeft: 90, players: 4 }))).toEqual([]);
  });

  it("combat badges", () => {
    expect(earnedAchievements(log({ firstKo: true, kos: 1 }))).toEqual(["first_blood"]);
    expect(earnedAchievements(log({ bestFlipCm: 200 }))).toEqual(["flipped"]);
    expect(earnedAchievements(log({ bestFlipCm: 199 }))).toEqual([]);
    expect(earnedAchievements(log({ pitKos: 1 }))).toEqual(["pit_boss"]);
    expect(earnedAchievements(log({ flameKos: 1 }))).toEqual(["flamed_out"]);
    expect(earnedAchievements(log({ hammerHits: 5 }))).toEqual(["hammer_time"]);
    expect(earnedAchievements(log({ hammerHits: 4 }))).toEqual([]);
    expect(earnedAchievements(log({ pulverized: true }))).toEqual(["pulverized"]);
  });

  it("mid-match checks (rank unknown) never award win badges", () => {
    const mid = earnedAchievements(log({ rank: 99, hpLeft: 100, players: 4, pitKos: 1 }));
    expect(mid).toEqual(["pit_boss"]);
  });

  it("everything it can award is declared", () => {
    const every = earnedAchievements(
      log({ rank: 1, players: 4, hpLeft: 90, firstKo: true, bestFlipCm: 300, pitKos: 1, flameKos: 1, hammerHits: 6, pulverized: true }),
    );
    expect(every.sort()).toEqual([...ALL].sort());
  });
});

describe("Wedge Wars stats", () => {
  it("reports damage, KOs, wins and the best flip", () => {
    expect(finalStats(log({ rank: 1, dmgDealt: 123.6, kos: 2, bestFlipCm: 251.2 }))).toEqual({ damage_dealt: 124, kos: 2, wins: 1, best_flip: 251 });
    expect(finalStats(log({ dmgDealt: 0 }))).toEqual({ damage_dealt: 0, kos: 0, wins: 0 });
  });

  it("only reports declared keys", () => {
    const declared = new Set(getOfficialApp("wedge-wars")?.stats?.map((s) => s.key));
    for (const key of Object.keys(finalStats(log({ rank: 1, bestFlipCm: 10 })))) expect(declared.has(key)).toBe(true);
  });
});
