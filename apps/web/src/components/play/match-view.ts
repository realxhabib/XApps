/**
 * View helpers for N-player matches (seats, teams, placements). Pure and
 * shared by the play room, match cards, the arena and the challenge sheet.
 */
import { isMyTurn, ordinal, seatedPlayers, teamName } from "@/platform/match-utils";
import type { AppManifest, Match, MatchPlayer } from "@/platform/types";

export { isMyTurn, ordinal, seatedPlayers };

export interface TeamStyle {
  name: string;
  color: string;
  /** Second stop for gradients. */
  glow: string;
}

/** Team colors in team order (seat s plays for team s % teams), named like `teamName()`. */
export const TEAM_STYLES: TeamStyle[] = [
  { name: teamName(0), color: "#ff4d6d", glow: "#ff9a3d" },
  { name: teamName(1), color: "#5b74ff", glow: "#35e0ff" },
  { name: teamName(2), color: "#37e39b", glow: "#c6ff3d" },
  { name: teamName(3), color: "#ffc93d", glow: "#ff8a3d" },
];

export function teamStyle(team: number | null | undefined): TeamStyle | null {
  if (team === null || team === undefined || team < 0) return null;
  return TEAM_STYLES[team % TEAM_STYLES.length] ?? null;
}

/** Stable colors for free-for-all seats (bars, rings) when there are no teams. */
export const SEAT_COLORS = ["#5b74ff", "#ff5ca8", "#c6ff3d", "#ffc93d", "#35e0ff", "#a35cff", "#ff8a3d", "#37e39b"];

export function isSpectatorRow(p: MatchPlayer): boolean {
  return p.role === "spectator";
}

export function viewerIsSpectator(match: Match, viewerId: string | undefined): boolean {
  const me = viewerId ? match.players.find((p) => p.userId === viewerId) : undefined;
  return !!me && isSpectatorRow(me);
}

export function teamOf(match: Match, p: MatchPlayer): number | null {
  if (p.team !== null && p.team !== undefined) return p.team;
  if (match.teams > 0 && p.seat !== null) return p.seat % match.teams;
  return null;
}

export function maxSeats(match: Match): number {
  return Math.max(2, match.maxPlayers || 2, seatedPlayers(match).length);
}

/** More than a plain 1v1 (3+ seats, or team play). */
export function isMultiplayer(match: Match): boolean {
  return match.teams > 0 || maxSeats(match) > 2 || seatedPlayers(match).length > 2;
}

/** "1v1", "2v2", "2–6 players", "4 players". */
export function tableSizeLabel(app: Pick<AppManifest, "players" | "teams">): string {
  const { min, max } = app.players;
  const teams = app.teams ?? 0;
  if (teams >= 2) {
    const per = Math.max(1, Math.floor(max / teams));
    if (teams === 2) return `${per}v${per}`;
    return `${teams} teams of ${per}`;
  }
  if (min === 2 && max === 2) return "1v1";
  if (min === max) return `${max} players`;
  return `${min}–${max} players`;
}

export function tableSizeLabelForMatch(match: Match): string {
  const seats = maxSeats(match);
  if (match.teams >= 2) {
    const per = Math.max(1, Math.floor(seats / match.teams));
    return match.teams === 2 ? `${per}v${per}` : `${match.teams} teams of ${per}`;
  }
  return seats === 2 ? "1v1" : `${seats} players`;
}

export interface Placement {
  player: MatchPlayer;
  rank: number;
  /** Another player shares this rank. */
  tied: boolean;
}

function metric(match: Match, p: MatchPlayer): number | null {
  if (match.scoring === "votes") return match.votes[p.userId] ?? 0;
  return p.score;
}

/** Competition ranking (1, 1, 3) of comparable values; nulls go last. */
function rankValues<T>(items: T[], value: (item: T) => number | null, lowWins: boolean): Map<T, number> {
  const sorted = [...items].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return lowWins ? va - vb : vb - va;
  });
  const ranks = new Map<T, number>();
  sorted.forEach((item, i) => {
    const prev = sorted[i - 1];
    if (prev !== undefined && value(prev) === value(item)) ranks.set(item, ranks.get(prev) ?? i + 1);
    else ranks.set(item, i + 1);
  });
  return ranks;
}

/**
 * Final placements, best first. Uses the server's `rank` when present and
 * falls back to scores/votes (ties share a rank) for matches settled before v2.
 */
export function rankings(match: Match): Placement[] {
  const players = seatedPlayers(match).filter((p) => p.state !== "invited");
  const hasRanks = players.some((p) => p.rank !== null && p.rank !== undefined);
  let ranked: { player: MatchPlayer; rank: number }[];
  if (hasRanks) {
    ranked = players.map((p) => ({ player: p, rank: p.rank ?? players.length }));
  } else {
    const ranks = rankValues(players, (p) => (p.state === "left" ? null : metric(match, p)), match.scoring === "low");
    ranked = players.map((p) => ({ player: p, rank: ranks.get(p) ?? players.length }));
  }
  ranked.sort((a, b) => a.rank - b.rank || (a.player.seat ?? 0) - (b.player.seat ?? 0));
  return ranked.map((r) => ({ ...r, tied: ranked.filter((x) => x.rank === r.rank).length > 1 }));
}

export interface TeamRanking {
  team: number;
  style: TeamStyle;
  members: MatchPlayer[];
  score: number;
  votes: number;
  rank: number;
  winner: boolean;
}

/** Team totals and placements (team score = sum of its members' scores). */
export function teamRankings(match: Match): TeamRanking[] {
  if (match.teams < 2) return [];
  const players = seatedPlayers(match);
  const base = Array.from({ length: match.teams }, (_, team) => {
    const members = players.filter((p) => teamOf(match, p) === team);
    return {
      team,
      style: teamStyle(team) ?? TEAM_STYLES[0]!,
      members,
      score: members.reduce((s, p) => s + (p.score ?? 0), 0),
      votes: members.reduce((s, p) => s + (match.votes[p.userId] ?? 0), 0),
    };
  });
  const memberRank = (t: (typeof base)[number]) => {
    const ranks = t.members.map((m) => m.rank).filter((r): r is number => r !== null && r !== undefined);
    return ranks.length ? Math.min(...ranks) : null;
  };
  const serverRanked = base.every((t) => memberRank(t) !== null);
  const fallback = rankValues(base, (t) => (match.scoring === "votes" ? t.votes : t.score), match.scoring === "low");
  return base
    .map((t) => {
      const rank = serverRanked ? (memberRank(t) ?? match.teams) : (fallback.get(t) ?? match.teams);
      const winner = match.winnerTeam !== null && match.winnerTeam !== undefined ? match.winnerTeam === t.team : rank === 1 && match.status === "completed";
      return { ...t, rank, winner };
    })
    .sort((a, b) => a.rank - b.rank || a.team - b.team);
}

export type ViewerOutcome = { kind: "win" | "loss" | "draw" | "spectator"; rank: number | null; tied: boolean };

/** How the match went for the viewer, N-player aware. */
export function viewerOutcome(match: Match, viewerId: string | undefined): ViewerOutcome {
  const me = viewerId ? seatedPlayers(match).find((p) => p.userId === viewerId) : undefined;
  if (!me) return { kind: "spectator", rank: null, tied: false };
  if (match.teams >= 2) {
    const team = teamOf(match, me);
    const standings = teamRankings(match);
    const mine = standings.find((t) => t.team === team);
    if (match.winnerTeam === null || match.winnerTeam === undefined) {
      const top = standings.filter((t) => t.rank === 1);
      if (top.length > 1 && top.some((t) => t.team === team)) return { kind: "draw", rank: 1, tied: true };
    }
    return { kind: mine?.winner ? "win" : "loss", rank: mine?.rank ?? null, tied: false };
  }
  const place = rankings(match).find((p) => p.player.userId === me.userId);
  if (match.winnerId) return { kind: match.winnerId === me.userId ? "win" : "loss", rank: place?.rank ?? null, tied: place?.tied ?? false };
  if (me.result === "win" || me.result === "loss") return { kind: me.result, rank: place?.rank ?? null, tied: place?.tied ?? false };
  if (place && place.rank === 1) return { kind: "draw", rank: 1, tied: true };
  if (place && seatedPlayers(match).length > 2) return { kind: "loss", rank: place.rank, tied: place.tied };
  return { kind: "draw", rank: place?.rank ?? null, tied: place?.tied ?? false };
}

/** "2d 4h", "3h 12m", "12m", "40s". */
export function formatTimeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

