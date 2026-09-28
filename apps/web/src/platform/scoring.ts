import { groupResultLine, seatedPlayers } from "./match-utils";
import type { Match, MatchPlayer, PlayerResult } from "./types";

/** XP awarded when a match settles. Mirrored in supabase/migrations. */
export const XP = {
  win: 30,
  draw: 15,
  loss: 8,
  practice: 3,
  vote: 2,
} as const;

/** Total XP needed to reach `level` (level 1 starts at 0). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelInfo(xp: number): {
  level: number;
  current: number;
  next: number;
  progress: number;
} {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current, next, progress: Math.min(1, (xp - current) / (next - current)) };
}

export const LEVEL_TITLES = [
  "Lurker",
  "Reply Guy",
  "Poster",
  "Main Character",
  "Ratio Machine",
  "Timeline Legend",
  "Algorithm Whisperer",
  "Final Boss",
];

export function levelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, Math.floor((level - 1) / 2))] ?? "Lurker";
}

/** The fields settlement reads from each player. */
export type SettlePlayer = Pick<MatchPlayer, "userId" | "isBot" | "score" | "state"> &
  Partial<Pick<MatchPlayer, "seat" | "team" | "role">>;

export interface SettleInput {
  scoring: Match["scoring"];
  mode: Match["mode"];
  votes: Match["votes"];
  players: SettlePlayer[];
  /** 0 = free for all; 2–4 = team play. */
  teams?: number;
}

export interface Settlement {
  /** The unique first place in free-for-all; null on a tie or in team play. */
  winnerId: string | null;
  /** The unique first-place team in team play, else null. */
  winnerTeam: number | null;
  /** Placement per seated player (1 = first; ties share a rank, the next rank skips). */
  ranks: Record<string, number>;
  results: Record<string, PlayerResult>;
  xp: Record<string, number>;
}

/**
 * XP for a placement (mirrors `settle_match`): 1st earns the win reward, the
 * last placement the loss reward, and places in between are interpolated over
 * the highest rank handed out. When everyone shares 1st it's a draw.
 */
export function placementXp(rank: number, maxRank: number): number {
  if (maxRank <= 1) return XP.draw;
  return Math.round(XP.win - ((rank - 1) * (XP.win - XP.loss)) / (maxRank - 1));
}

/** Team index of a seated player (`seat % teams`), or null in free-for-all. */
export function teamForSeat(seat: number | null | undefined, teams: number | undefined): number | null {
  if (!teams || teams < 2 || typeof seat !== "number" || seat < 0) return null;
  return seat % teams;
}

/**
 * Decides a finished match for 2–8 players. Pure — used by the demo backend and
 * tests, and mirrors `settle_match` in supabase/migrations:
 *
 * - Every seated player except declines is placed (spectators never are).
 * - Players still in are ranked by score (high/low) or crowd votes; missing
 *   scores rank below every score; ties share a rank ("1, 1, 3").
 * - Players who left (and `forfeitBy`) share last place: one below everyone still in.
 * - Team play ranks the teams by the sum of their remaining members and each
 *   remaining member takes the team's placement; `winnerTeam` replaces `winnerId`.
 * - Unique 1st = win, shared 1st = draw, everyone else = loss.
 */
export function settle(match: SettleInput, forfeitBy?: string): Settlement {
  const teams = match.teams && match.teams >= 2 ? match.teams : 0;
  const placed = match.players.filter((p) => (p.role ?? "player") === "player" && p.state !== "declined");
  const gone = (p: SettlePlayer) => p.state === "left" || p.userId === forfeitBy;
  // Bigger is better: low scoring negates, missing scores sink to -Infinity.
  const keyOf = (p: SettlePlayer): number | null => {
    if (match.scoring === "votes") return match.votes[p.userId] ?? 0;
    if (typeof p.score !== "number") return null;
    return match.scoring === "low" ? -p.score : p.score;
  };

  const ranks: Record<string, number> = {};
  let top = 0;
  let winnerId: string | null = null;
  let winnerTeam: number | null = null;

  if (teams) {
    const teamOfPlayer = new Map(placed.map((p, i) => [p.userId, p.team ?? teamForSeat(p.seat ?? i, teams) ?? 0]));
    const teamOf = (p: SettlePlayer) => teamOfPlayer.get(p.userId)!;
    const byTeam = new Map<number, { alive: boolean; key: number }>();
    placed.forEach((p) => {
      const team = teamOf(p);
      const entry = byTeam.get(team) ?? { alive: false, key: -Infinity };
      if (!gone(p)) {
        entry.alive = true;
        const key = keyOf(p);
        if (key !== null) entry.key = entry.key === -Infinity ? key : entry.key + key;
      }
      byTeam.set(team, entry);
    });
    const alive = [...byTeam.values()].filter((t) => t.alive);
    const last = alive.length + 1;
    placed.forEach((p) => {
      const t = byTeam.get(teamOf(p))!;
      ranks[p.userId] = gone(p) || !t.alive ? last : 1 + alive.filter((o) => o.key > t.key).length;
    });
    const firstTeams = new Set(placed.filter((p) => ranks[p.userId] === 1).map(teamOf));
    top = firstTeams.size;
    if (top === 1) winnerTeam = [...firstTeams][0]!;
  } else {
    const remaining = placed.filter((p) => !gone(p));
    const keyed = (p: SettlePlayer) => keyOf(p) ?? -Infinity;
    for (const p of placed) {
      ranks[p.userId] = gone(p)
        ? remaining.length + 1
        : 1 + remaining.filter((q) => keyed(q) > keyed(p)).length;
    }
    const firsts = placed.filter((p) => ranks[p.userId] === 1);
    top = firsts.length;
    if (top === 1) winnerId = firsts[0]!.userId;
  }

  const maxRank = Math.max(1, ...Object.values(ranks));
  const results: Record<string, PlayerResult> = {};
  const xp: Record<string, number> = {};
  for (const p of placed) {
    const rank = ranks[p.userId]!;
    results[p.userId] = rank === 1 ? (top === 1 ? "win" : "draw") : "loss";
    xp[p.userId] = p.isBot ? 0 : match.mode === "practice" ? XP.practice : placementXp(rank, maxRank);
  }
  return { winnerId, winnerTeam, ranks, results, xp };
}

/** A human-readable one-liner about a finished match, used in feeds and share text. */
export function describeResult(match: Match, appName: string): string {
  const seated = seatedPlayers(match);
  if (seated.length > 2 || (match.teams ?? 0) >= 2) return groupResultLine(match, appName);
  const winner = seated.find((p) => p.userId === match.winnerId);
  const loser = seated.find((p) => p.userId !== match.winnerId);
  if (!winner || !loser) {
    const [a, b] = seated;
    return `@${a?.profile.handle ?? "?"} and @${b?.profile.handle ?? "?"} drew in ${appName}`;
  }
  return `@${winner.profile.handle} beat @${loser.profile.handle} in ${appName}`;
}
