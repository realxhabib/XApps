/**
 * Demo mode's `app_analytics`: the same numbers the SQL function returns,
 * computed from the local match rows. Pure (takes the db and "now").
 */
import type { AppAnalytics, Profile } from "../types";
import { isPracticeBot } from "./seed";
import type { DemoDb, MatchRow } from "./store";

const DAY_MS = 86_400_000;
const ABANDONED = new Set(["cancelled", "declined", "expired"]);
const TAKEN = new Set(["joined", "submitted", "left"]);

/** `YYYY-MM-DD` (UTC) of an ISO timestamp or epoch ms. */
export function dayOf(at: string | number): string {
  return new Date(at).toISOString().slice(0, 10);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

interface Seat {
  userId: string;
  result: string | null;
  at: number;
}

/**
 * Mirrors `app_analytics` (supabase/migrations/…_shipping.sql). Test builds
 * are left out. Over the last `days` UTC days (every day present, oldest first):
 * - matchesCreated by creation day, matchesCompleted by end day, matchesAbandoned:
 *   created that day and now cancelled/declined/expired;
 * - players: distinct humans seated in matches created that day; newPlayers:
 *   humans whose first match of the app (ever) was that day;
 * - completionRate: of matches created in the window, the share completed;
 * - medianDurationSec: end − start (whole seconds) of started matches completed in the window;
 * - modes / tableSizes (max seats) of matches created in the window;
 * - retention (UTC days) of the window's new players whose first day is at least
 *   N days back: the share who played again on a day N+ days after it;
 * - topPlayers: most matches in the window, then wins, then handle (10);
 * - versions: matches created in the window by the version that was live.
 */
export function computeAnalytics(db: DemoDb, appSlug: string, days: number, now = Date.now()): AppAnalytics {
  const today = Date.parse(`${dayOf(now)}T00:00:00.000Z`);
  const start = today - (days - 1) * DAY_MS;
  const matches = Object.values(db.matches).filter((m) => m.appSlug === appSlug && !m.versionId);
  const recent = matches.filter((m) => Date.parse(m.createdAt) >= start);

  // Humans who took a seat (bots, spectators, open invites and declines don't count).
  const seats: Seat[] = matches.flatMap((m: MatchRow) =>
    m.players
      .filter((p) => p.role === "player" && !p.isBot && !isPracticeBot(p.userId) && TAKEN.has(p.state))
      .map((p) => ({ userId: p.userId, result: p.result, at: Date.parse(m.createdAt) })),
  );
  const firsts = new Map<string, number>();
  for (const s of seats) firsts.set(s.userId, Math.min(firsts.get(s.userId) ?? Infinity, s.at));
  const dayStart = (at: number) => Date.parse(`${dayOf(at)}T00:00:00.000Z`);
  const recentSeats = seats.filter((s) => s.at >= start);

  const series: AppAnalytics["series"] = [];
  const index = new Map<string, number>();
  for (let t = start; t <= today; t += DAY_MS) {
    index.set(dayOf(t), series.length);
    series.push({ date: dayOf(t), matchesCreated: 0, matchesCompleted: 0, matchesAbandoned: 0, players: 0, newPlayers: 0 });
  }
  const bump = (at: string | number, key: "matchesCreated" | "matchesCompleted" | "matchesAbandoned" | "newPlayers") => {
    const i = index.get(dayOf(at));
    if (i !== undefined) series[i]![key]++;
  };
  for (const m of recent) bump(m.createdAt, "matchesCreated");
  for (const m of matches) {
    if (m.status === "completed" && m.endedAt && Date.parse(m.endedAt) >= start) bump(m.endedAt, "matchesCompleted");
    if (ABANDONED.has(m.status) && Date.parse(m.createdAt) >= start) bump(m.createdAt, "matchesAbandoned");
  }
  for (const first of firsts.values()) if (first >= start) bump(first, "newPlayers");
  const dayPlayers = series.map(() => new Set<string>());
  for (const s of recentSeats) {
    const i = index.get(dayOf(s.at));
    if (i !== undefined) dayPlayers[i]!.add(s.userId);
  }
  series.forEach((row, i) => (row.players = dayPlayers[i]!.size));

  const completed = series.reduce((n, r) => n + r.matchesCompleted, 0);
  const createdCompleted = recent.filter((m) => m.status === "completed").length;
  const durations = matches
    .filter((m) => m.status === "completed" && m.endedAt && m.startedAt && Date.parse(m.endedAt) >= start)
    .map((m) => Math.max(0, Math.round((Date.parse(m.endedAt!) - Date.parse(m.startedAt!)) / 1000)));
  const med = median(durations);

  const count = <K>(keys: K[]) => {
    const out = new Map<K, number>();
    for (const k of keys) out.set(k, (out.get(k) ?? 0) + 1);
    return out;
  };

  const retention = (n: number): number | null => {
    let eligible = 0;
    let back = 0;
    for (const [userId, first] of firsts) {
      const firstDay = dayStart(first);
      if (first < start || firstDay + n * DAY_MS > today) continue;
      eligible++;
      if (seats.some((s) => s.userId === userId && dayStart(s.at) >= firstDay + n * DAY_MS)) back++;
    }
    return eligible ? round(back / eligible, 4) : null;
  };

  const perPlayer = new Map<string, { matches: number; wins: number }>();
  for (const s of recentSeats) {
    const row = perPlayer.get(s.userId) ?? { matches: 0, wins: 0 };
    row.matches++;
    if (s.result === "win") row.wins++;
    perPlayer.set(s.userId, row);
  }
  const topPlayers = [...perPlayer]
    .map(([userId, row]) => ({ profile: db.profiles[userId], ...row }))
    .filter((row): row is { profile: Profile; matches: number; wins: number } => !!row.profile)
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins || a.profile.handle.localeCompare(b.profile.handle))
    .slice(0, 10);

  const versionCreated = (id: string | null) => (id ? (db.versions?.[id]?.createdAt ?? "") : "");
  const versions = [...count(recent.map((m) => m.publishedVersionId ?? null))]
    .map(([versionId, matchCount]) => ({ versionId, version: versionId ? (db.versions?.[versionId]?.version ?? null) : null, matches: matchCount }))
    .sort((a, b) => b.matches - a.matches || versionCreated(b.versionId).localeCompare(versionCreated(a.versionId)));

  return {
    days,
    series,
    totals: {
      matches: recent.length,
      completed,
      players: new Set(recentSeats.map((s) => s.userId)).size,
      newPlayers: series.reduce((n, r) => n + r.newPlayers, 0),
    },
    completionRate: recent.length ? round(createdCompleted / recent.length, 4) : 0,
    medianDurationSec: med,
    modes: [...count(recent.map((m) => m.mode as string))]
      .map(([mode, n]) => ({ mode, matches: n }))
      .sort((a, b) => b.matches - a.matches || a.mode.localeCompare(b.mode)),
    tableSizes: [...count(recent.map((m) => m.maxPlayers))]
      .map(([players, n]) => ({ players, matches: n }))
      .sort((a, b) => a.players - b.players),
    retention: { d1: retention(1), d7: retention(7) },
    topPlayers,
    versions,
  };
}
