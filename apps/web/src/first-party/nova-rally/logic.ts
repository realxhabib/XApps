/**
 * Pure Grand Prix rules: points, settings, standings, stats, achievements and
 * what gets submitted. No three.js, no SDK calls.
 */

import type { Json } from "@xapps/sdk";
import { CUPS, TRACKS, type Cup } from "./tracks";

export const FIELD_SIZE = 8;
export const LAPS = 3;
/** Points by finishing place (1st..8th). */
export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1] as const;

export type SpeedClass = 100 | 150 | 200;

export interface GpSettings {
  cup: Cup;
  cc: SpeedClass;
  laps: number;
  /** Tracks run in mirror image. */
  mirror: boolean;
  /** Knockout: the slowest racers are eliminated at the end of every lap but the last. */
  knockout: boolean;
  /** Battle: three shield orbs each, last ship flying wins. */
  battle: boolean;
}

export const SPEED_CLASSES: readonly { cc: SpeedClass; label: string; blurb: string }[] = [
  { cc: 100, label: "100cc", blurb: "Relaxed" },
  { cc: 150, label: "150cc", blurb: "Standard" },
  { cc: 200, label: "200cc", blurb: "Blistering" },
];

/** Top-speed and CPU skill scaling per class. */
export function classScale(cc: SpeedClass): { speed: number; accel: number; cpu: number } {
  if (cc === 100) return { speed: 0.84, accel: 0.9, cpu: 0.8 };
  if (cc === 200) return { speed: 1.22, accel: 1.15, cpu: 1.08 };
  return { speed: 1, accel: 1, cpu: 1 };
}

export function parseSettings(raw: { [key: string]: Json } | null | undefined): GpSettings {
  const cupId = typeof raw?.cup === "string" ? raw.cup : "solar";
  let cup = CUPS.find((c) => c.id === cupId) ?? CUPS[0]!;
  if (typeof raw?.track === "string" && TRACKS.some((t) => t.id === raw.track)) {
    cup = { id: `single:${raw.track}`, name: "Single Race", icon: "🏁", tracks: [raw.track] };
  }
  const cc = raw?.cc === 100 || raw?.cc === 200 ? raw.cc : 150;
  const laps = typeof raw?.laps === "number" && raw.laps >= 1 && raw.laps <= 5 ? Math.round(raw.laps) : LAPS;
  return { cup, cc, laps, mirror: raw?.mirror === true, knockout: raw?.mode === "knockout", battle: raw?.mode === "battle" };
}

/** How many racers drop out when the leader completes a lap in knockout (never below two left). */
export function knockoutCount(alive: number, lapsLeft: number): number {
  if (lapsLeft <= 0 || alive <= 2) return 0;
  return Math.max(1, Math.min(alive - 2, Math.floor((alive - 2) / lapsLeft)));
}

/** Battle length in seconds and starting orbs. */
export const BATTLE_SECONDS = 150;
export const BATTLE_ORBS = 3;

export function pointsFor(place: number): number {
  return POINTS[place] ?? 0;
}

export function placeSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--.--";
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** What a player did in one race, for stats and achievements. */
export interface RaceRecord {
  track: string;
  place: number;
  time: number;
  bestLap: number;
  hitsLanded: number;
  timesHit: number;
  purpleTurbos: number;
  turbos: number;
  tricks: number;
  maxCoins: number;
  rocketStart: boolean;
  worstPlace: number;
  singularityOnLeader: boolean;
  falls: number;
}

export function emptyRecord(track: string): RaceRecord {
  return {
    track,
    place: 7,
    time: 0,
    bestLap: Infinity,
    hitsLanded: 0,
    timesHit: 0,
    purpleTurbos: 0,
    turbos: 0,
    tricks: 0,
    maxCoins: 0,
    rocketStart: false,
    worstPlace: 0,
    singularityOnLeader: false,
    falls: 0,
  };
}

export function gpStats(records: readonly RaceRecord[], gpPlace: number): { [key: string]: number } {
  const best = Math.min(...records.map((r) => r.bestLap));
  return {
    races_won: records.filter((r) => r.place === 0).length,
    podiums: records.filter((r) => r.place <= 2).length,
    hits_landed: records.reduce((a, r) => a + r.hitsLanded, 0),
    mini_turbos: records.reduce((a, r) => a + r.turbos, 0),
    cups_played: 1,
    ...(gpPlace === 0 ? { wins: 1 } : {}),
    ...(Number.isFinite(best) ? { best_lap: Math.round(best * 100) / 100 } : {}),
  };
}

export function earnedAchievements(records: readonly RaceRecord[], gp: { place: number; complete: boolean }): string[] {
  const out = new Set<string>();
  if (gp.complete) out.add("liftoff");
  if (gp.complete && gp.place === 0) out.add("champion");
  if (gp.complete && records.length > 1 && records.every((r) => r.place === 0)) out.add("flawless");
  for (const r of records) {
    if (r.place === 0) out.add("checkered");
    if (r.purpleTurbos > 0) out.add("ultra_turbo");
    if (r.hitsLanded >= 3) out.add("sharpshooter");
    if (r.rocketStart) out.add("rocket_start");
    if (r.place === 0 && r.timesHit === 0) out.add("untouchable");
    if (r.maxCoins >= 10) out.add("stardust");
    if (r.place === 0 && r.worstPlace >= 6) out.add("comeback");
    if (r.tricks >= 5) out.add("showboat");
    if (r.singularityOnLeader) out.add("event_horizon");
  }
  return [...out];
}

export function submissionBody(points: number, place: number, races: readonly { track: string; place: number }[]): string {
  const names = races.map((r) => `${TRACKS.find((t) => t.id === r.track)?.name ?? r.track}: ${placeSuffix(r.place + 1)}`);
  return `${placeSuffix(place + 1)} overall · ${points} pts\n${names.join(" · ")}`;
}

