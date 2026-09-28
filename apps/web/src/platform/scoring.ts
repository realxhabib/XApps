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

export interface Settlement {
  winnerId: string | null;
  results: Record<string, PlayerResult>;
  xp: Record<string, number>;
}

/** Decides a finished match. Pure — used by the demo backend and tests. */
export function settle(match: Pick<Match, "scoring" | "mode" | "votes" | "players">, forfeitBy?: string): Settlement {
  const humans = match.players.filter((p) => !p.isBot);
  let winnerId: string | null = null;

  if (forfeitBy) {
    winnerId = match.players.find((p) => p.userId !== forfeitBy)?.userId ?? null;
  } else if (match.scoring === "votes") {
    const tallies = match.players.map((p) => [p.userId, match.votes[p.userId] ?? 0] as const);
    const best = Math.max(...tallies.map((t) => t[1]));
    const leaders = tallies.filter((t) => t[1] === best);
    winnerId = leaders.length === 1 ? (leaders[0]?.[0] ?? null) : null;
  } else {
    const scored = match.players.filter((p): p is MatchPlayer & { score: number } => typeof p.score === "number");
    if (scored.length > 0) {
      const best =
        match.scoring === "high"
          ? Math.max(...scored.map((p) => p.score))
          : Math.min(...scored.map((p) => p.score));
      const leaders = scored.filter((p) => p.score === best);
      winnerId = leaders.length === 1 ? (leaders[0]?.userId ?? null) : null;
    }
  }

  const results: Record<string, PlayerResult> = {};
  const xp: Record<string, number> = {};
  for (const p of match.players) {
    const result: PlayerResult = winnerId === null ? "draw" : p.userId === winnerId ? "win" : "loss";
    results[p.userId] = result;
    if (p.isBot) {
      xp[p.userId] = 0;
    } else if (match.mode === "practice") {
      xp[p.userId] = XP.practice;
    } else {
      xp[p.userId] = result === "win" ? XP.win : result === "draw" ? XP.draw : XP.loss;
    }
  }
  void humans;
  return { winnerId, results, xp };
}

/** A human-readable one-liner about a finished match, used in feeds and share text. */
export function describeResult(match: Match, appName: string): string {
  const winner = match.players.find((p) => p.userId === match.winnerId);
  const loser = match.players.find((p) => p.userId !== match.winnerId);
  if (!winner || !loser) {
    const [a, b] = match.players;
    return `@${a?.profile.handle ?? "?"} and @${b?.profile.handle ?? "?"} drew in ${appName}`;
  }
  return `@${winner.profile.handle} beat @${loser.profile.handle} in ${appName}`;
}
