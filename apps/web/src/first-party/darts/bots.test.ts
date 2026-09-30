import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import { RADIUS, hitTest, target } from "./board";
import { BOT, botDart, botProfile, botSchedule, gaussian, hurrySchedule, planBot, spreadFor, type BotProfile } from "./bots";
import { MAX_TOTAL, TOTAL_DARTS, total } from "./logic";

const stream = (seed: string) => createRandom(seed).next;

/** Mean 9-dart total over many games for a fixed skill (always aiming at the T20). */
function meanTotal(skill: number, games = 400): number {
  const profile: BotProfile = { skill, paceMs: 2000, style: "t20" };
  const rand = stream(`mean:${skill}`);
  let sum = 0;
  for (let g = 0; g < games; g++) sum += total(Array.from({ length: TOTAL_DARTS }, () => botDart(profile, rand)));
  return sum / games;
}

describe("bot plans", () => {
  it("are deterministic for a seed and differ between seats", () => {
    expect(planBot(createRandom("m").fork("bot:1").next)).toEqual(planBot(createRandom("m").fork("bot:1").next));
    expect(planBot(createRandom("m").fork("bot:1").next)).not.toEqual(planBot(createRandom("m").fork("bot:2").next));
  });

  it("throw nine darts that stay near the board", () => {
    for (let i = 0; i < 200; i++) {
      const plan = planBot(stream(`near:${i}`));
      expect(plan.darts).toHaveLength(TOTAL_DARTS);
      for (const p of plan.darts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(RADIUS.edge + 12 + 1e-9);
      }
      const t = total(plan.darts);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(MAX_TOTAL);
    }
  });

  it("skills and paces fall in range", () => {
    for (let i = 0; i < 500; i++) {
      const p = botProfile(stream(`p:${i}`));
      expect(p.skill).toBeGreaterThanOrEqual(BOT.minSkill);
      expect(p.skill).toBeLessThanOrEqual(BOT.maxSkill);
      expect(p.paceMs).toBeGreaterThan(1500);
      expect(p.paceMs).toBeLessThan(3600);
    }
  });
});

describe("bot scatter", () => {
  it("tightens with skill", () => {
    expect(spreadFor(0)).toBe(BOT.worstSpread);
    expect(spreadFor(1)).toBe(BOT.bestSpread);
    expect(spreadFor(0.5)).toBeLessThan(spreadFor(0.2));
  });

  it("scores plausibly: weak bots ~pub level, strong bots much better, never superhuman", () => {
    const weak = meanTotal(BOT.minSkill);
    const mid = meanTotal(0.6);
    const strong = meanTotal(BOT.maxSkill);
    expect(weak).toBeGreaterThan(60);
    expect(weak).toBeLessThan(150);
    expect(mid).toBeGreaterThan(weak);
    expect(strong).toBeGreaterThan(mid);
    expect(strong).toBeGreaterThan(160);
    expect(strong).toBeLessThan(330);
  });

  it("clusters around the aim (strong bots hit the T20 bed often)", () => {
    const profile: BotProfile = { skill: BOT.maxSkill, paceMs: 2000, style: "t20" };
    const rand = stream("cluster");
    let trebles = 0;
    let twenties = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      const hit = hitTest(botDart(profile, rand));
      if (hit.label === "T20") trebles++;
      if (hit.number === 20) twenties++;
    }
    expect(trebles / n).toBeGreaterThan(0.12);
    expect(trebles / n).toBeLessThan(0.5);
    expect(twenties / n).toBeGreaterThan(0.4);
  });

  it("a bull specialist lands near the middle", () => {
    const profile: BotProfile = { skill: 0.8, paceMs: 2000, style: "bull" };
    const rand = stream("bull");
    let near = 0;
    for (let i = 0; i < 2000; i++) {
      const p = botDart(profile, rand);
      if (Math.hypot(p.x, p.y) < 40) near++;
    }
    expect(near / 2000).toBeGreaterThan(0.45);
    expect(target(25, "bull")).toEqual({ x: 0, y: 0 });
  });

  it("gaussian has the right mean and spread", () => {
    const rand = stream("g");
    const xs = Array.from({ length: 20000 }, () => gaussian(rand, 3, 2));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(3, 1);
    expect(sd).toBeCloseTo(2, 1);
  });
});

describe("bot pacing", () => {
  it("schedules nine increasing times with breaks between rounds", () => {
    const profile: BotProfile = { skill: 0.5, paceMs: 2400, style: "t20" };
    const times = botSchedule(profile, stream("s"));
    expect(times).toHaveLength(TOTAL_DARTS);
    expect(times[0]).toBeGreaterThanOrEqual(BOT.firstDartMs[0]);
    expect(times[0]).toBeLessThanOrEqual(BOT.firstDartMs[1]);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    // Round breaks: the gap into dart 4 is longer than the gap into dart 3 would be at worst pace.
    expect(times[3]! - times[2]!).toBeGreaterThan(BOT.roundBreakMs);
  });

  it("hurries the remaining darts without moving the ones already thrown", () => {
    const times = [1000, 3000, 5000, 9000, 11000, 13000, 17000, 19000, 21000];
    const hurried = hurrySchedule(times, 6000);
    expect(hurried.slice(0, 3)).toEqual([1000, 3000, 5000]);
    expect(hurried[3]).toBe(6000 + BOT.hurryMs);
    expect(hurried[8]).toBe(6000 + BOT.hurryMs * 6);
    for (let i = 0; i < times.length; i++) expect(hurried[i]!).toBeLessThanOrEqual(times[i]!);
  });
});
