import type { LaunchContext, MatchResult, PlayerInfo } from "@xapps/sdk";
import { getOfficialApp } from "./catalog";
import type { AppManifest, Match, MatchPlayer, PlayableMode, PlayerRole, Profile } from "./types";

/* ---------------------------------------------------------------------- */
/* Who's who                                                              */
/* ---------------------------------------------------------------------- */

/** The viewer's own row — seated or spectating. */
export function playerOf(match: Match, userId: string | undefined): MatchPlayer | undefined {
  return userId ? match.players.find((p) => p.userId === userId) : undefined;
}

function isSeated(p: MatchPlayer): boolean {
  return (p.role ?? "player") === "player" && p.seat !== null && p.state !== "declined";
}

/** Everyone holding (or invited to) a seat, by seat. Spectators and declines are left out. */
export function seatedPlayers(match: Pick<Match, "players">): MatchPlayer[] {
  return match.players.filter(isSeated).sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

/** Seated players who are actually in the game (joined or submitted — not invited, not gone). */
export function activePlayers(match: Pick<Match, "players">): MatchPlayer[] {
  return seatedPlayers(match).filter((p) => p.state === "joined" || p.state === "submitted");
}

/** The viewer's spectator row, when they're watching rather than playing. */
export function spectatorOf(match: Match, userId: string | undefined): MatchPlayer | undefined {
  return userId ? match.players.find((p) => p.userId === userId && p.role === "spectator") : undefined;
}

export function isSpectator(match: Match, userId: string | undefined): boolean {
  return !!spectatorOf(match, userId);
}

/** "player" when seated, "spectator" when watching, null when not in the match at all. */
export function roleOf(match: Match, userId: string | undefined): PlayerRole | null {
  const me = playerOf(match, userId);
  if (!me) return null;
  return isSeated(me) ? "player" : "spectator";
}

/** The first other seated player — the opponent in a 1v1. */
export function opponentOf(match: Match, userId: string | undefined): MatchPlayer | undefined {
  return seatedPlayers(match).find((p) => p.userId !== userId);
}

/** Every other seated player. */
export function opponentsOf(match: Match, userId: string | undefined): MatchPlayer[] {
  return seatedPlayers(match).filter((p) => p.userId !== userId);
}

export function teamOf(match: Match, userId: string | undefined): number | null {
  const me = playerOf(match, userId);
  return me && isSeated(me) ? me.team : null;
}

/** Other seated players on the viewer's team (empty in free-for-all). */
export function teammatesOf(match: Match, userId: string | undefined): MatchPlayer[] {
  const team = teamOf(match, userId);
  if (team === null) return [];
  return seatedPlayers(match).filter((p) => p.userId !== userId && p.team === team);
}

export const TEAM_NAMES = ["Red", "Blue", "Green", "Gold"] as const;

/** "Red team", "Blue team"… */
export function teamName(team: number): string {
  return `${TEAM_NAMES[team] ?? `Team ${team + 1}`} team`;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/* ---------------------------------------------------------------------- */
/* Lobby                                                                  */
/* ---------------------------------------------------------------------- */

export type SeatState = "filled" | "invited" | "open" | "left";

export interface SeatSlot {
  seat: number;
  team: number | null;
  state: SeatState;
  player: MatchPlayer | null;
}

/** One slot per seat (`maxPlayers`), for the lobby's seat grid. */
export function seatGrid(match: Match): SeatSlot[] {
  const bySeat = new Map(seatedPlayers(match).map((p) => [p.seat as number, p]));
  const count = Math.max(match.maxPlayers ?? 2, ...[...bySeat.keys()].map((s) => s + 1));
  return Array.from({ length: count }, (_, seat) => {
    const player = bySeat.get(seat) ?? null;
    const state: SeatState = !player
      ? "open"
      : player.state === "invited"
        ? "invited"
        : player.state === "left"
          ? "left"
          : "filled";
    return { seat, team: match.teams >= 2 ? seat % match.teams : null, state, player };
  });
}

/** Seats nobody holds yet (invites count as held). */
export function openSeats(match: Match): number {
  return seatGrid(match).filter((s) => s.state === "open").length;
}

export function isLobby(match: Match): boolean {
  return match.status === "open" || match.status === "pending";
}

/** The creator can start a lobby early once the minimum is seated. */
export function canStartMatch(match: Match, viewerId: string | undefined): boolean {
  return (
    !!viewerId &&
    isLobby(match) &&
    match.createdBy === viewerId &&
    activePlayers(match).length >= (match.minPlayers ?? 2)
  );
}

/** Someone outside the match can watch it. */
export function canSpectate(match: Match, app: Pick<AppManifest, "spectators"> | null | undefined, viewerId: string | undefined): boolean {
  if (!viewerId || app?.spectators === false || match.mode === "practice") return false;
  if (!["open", "pending", "active", "voting"].includes(match.status)) return false;
  return !playerOf(match, viewerId);
}

/* ---------------------------------------------------------------------- */
/* Turns                                                                  */
/* ---------------------------------------------------------------------- */

export function turnPlayer(match: Match): MatchPlayer | undefined {
  return match.turnUserId ? match.players.find((p) => p.userId === match.turnUserId) : undefined;
}

export function isMyTurn(match: Match, viewerId: string | undefined): boolean {
  return !!viewerId && match.status === "active" && match.turnUserId === viewerId;
}

/** Inbox flag: an async turn-based match is waiting on the viewer's move. */
export function isYourTurn(match: Match, viewerId: string | undefined): boolean {
  return isMyTurn(match, viewerId) && match.mode === "async";
}

/** Inbox flag: the viewer has something to do (an invite, their turn, or an async match they haven't played). */
export function needsAttention(match: Match, viewerId: string | undefined): boolean {
  const me = playerOf(match, viewerId);
  if (!me || !isSeated(me)) return false;
  if (me.state === "invited" && isLobby(match)) return true;
  if (isYourTurn(match, viewerId)) return true;
  return match.status === "active" && match.mode === "async" && me.state === "joined" && !match.turnUserId;
}

/* ---------------------------------------------------------------------- */
/* Results                                                                */
/* ---------------------------------------------------------------------- */

export function isFinished(match: Match): boolean {
  return ["completed", "cancelled", "declined", "expired"].includes(match.status);
}

/** Seated players best-first (by rank once settled, else by seat). */
export function placements(match: Match): MatchPlayer[] {
  return seatedPlayers(match)
    .filter((p) => p.state !== "invited")
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.seat ?? 0) - (b.seat ?? 0));
}

export interface TeamStanding {
  team: number;
  name: string;
  /** Sum of members' scores (or votes for crowd-judged apps). */
  score: number;
  rank: number | null;
  players: MatchPlayer[];
}

/** Per-team totals, best-first, in team play (empty in free-for-all). */
export function teamStandings(match: Match): TeamStanding[] {
  if (!match.teams || match.teams < 2) return [];
  const byTeam = new Map<number, MatchPlayer[]>();
  for (const p of seatedPlayers(match)) {
    if (p.team === null || p.state === "invited") continue;
    byTeam.set(p.team, [...(byTeam.get(p.team) ?? []), p]);
  }
  return [...byTeam.entries()]
    .map(([team, players]) => ({
      team,
      name: teamName(team),
      score: players.reduce(
        (sum, p) => sum + (match.scoring === "votes" ? (match.votes[p.userId] ?? 0) : (p.score ?? 0)),
        0,
      ),
      rank: players[0]?.rank ?? null,
      players,
    }))
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.team - b.team);
}

export function toMatchResult(match: Match): MatchResult {
  const scores: Record<string, number | null> = {};
  const xp: Record<string, number> = {};
  const ranks: Record<string, number> = {};
  for (const p of seatedPlayers(match)) {
    scores[p.userId] = p.score;
    xp[p.userId] = p.xpDelta;
    if (typeof p.rank === "number") ranks[p.userId] = p.rank;
  }
  return {
    matchId: match.id,
    status: match.status,
    winnerId: match.winnerId,
    winnerTeam: match.winnerTeam ?? null,
    ranks,
    scores,
    votes: match.votes,
    xp,
  };
}

/* ---------------------------------------------------------------------- */
/* Launch context                                                         */
/* ---------------------------------------------------------------------- */

export function toPlayerInfo(p: MatchPlayer): PlayerInfo {
  return {
    id: p.userId,
    handle: p.profile.handle,
    name: p.profile.name,
    avatarUrl: p.profile.avatarUrl,
    seat: p.seat ?? -1,
    isBot: p.isBot,
    submitted: p.state === "submitted",
    score: p.score,
    team: p.team ?? null,
    role: p.role ?? "player",
  };
}

export function toLaunchMatch(match: Match, viewerId: string): LaunchContext["match"] {
  const me = playerOf(match, viewerId);
  const seated = !!me && isSeated(me);
  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    scoring: match.scoring,
    seed: match.seed,
    players: seatedPlayers(match).map(toPlayerInfo),
    seat: seated ? (me.seat ?? -1) : -1,
    settings: match.settings,
    minPlayers: match.minPlayers ?? 2,
    maxPlayers: match.maxPlayers ?? 2,
    teams: match.teams ?? 0,
    role: seated ? "player" : "spectator",
    state: match.state ?? null,
    stateVersion: match.stateVersion ?? 0,
    turn: match.turnUserId ?? null,
    turnDeadline: match.turnDeadline ?? null,
    round: match.round ?? 0,
  };
}

const HOST = { name: "XApps", version: "0.2.0" };

function localeOf(): string {
  return typeof navigator !== "undefined" ? navigator.language : "en";
}

export function buildLaunchContext(app: AppManifest, match: Match, viewer: Profile, origin: string): LaunchContext {
  return {
    purpose: "match",
    app: { id: app.slug, slug: app.slug, name: app.name },
    user: { id: viewer.id, handle: viewer.handle, name: viewer.name, avatarUrl: viewer.avatarUrl },
    match: toLaunchMatch(match, viewer.id),
    host: { ...HOST, origin },
    locale: localeOf(),
  };
}

/**
 * Context for opening a `setup: true` app inside the challenge sheet. The match
 * is a stub: the app's seat range and teams, the viewer alone in seat 0, no state.
 */
export function buildSetupContext(
  app: AppManifest,
  viewer: Profile,
  origin: string,
  options: { mode?: PlayableMode; maxPlayers?: number; settings?: Match["settings"] } = {},
): LaunchContext {
  const teams = app.teams ?? 0;
  const mode = options.mode ?? app.modes.find((m) => m !== "practice") ?? "async";
  return {
    purpose: "setup",
    app: { id: app.slug, slug: app.slug, name: app.name },
    user: { id: viewer.id, handle: viewer.handle, name: viewer.name, avatarUrl: viewer.avatarUrl },
    match: {
      id: `setup-${app.slug}`,
      mode,
      status: "open",
      scoring: app.scoring,
      seed: `setup-${app.slug}-${viewer.id}`,
      players: [
        {
          id: viewer.id,
          handle: viewer.handle,
          name: viewer.name,
          avatarUrl: viewer.avatarUrl,
          seat: 0,
          isBot: false,
          submitted: false,
          score: null,
          team: teams >= 2 ? 0 : null,
          role: "player",
        },
      ],
      seat: 0,
      settings: options.settings ?? {},
      minPlayers: app.players.min,
      maxPlayers: options.maxPlayers ?? app.players.max,
      teams,
      role: "player",
      state: null,
      stateVersion: 0,
      turn: null,
      turnDeadline: null,
      round: 0,
    },
    host: { ...HOST, origin },
    locale: localeOf(),
  };
}

/* ---------------------------------------------------------------------- */
/* Copy                                                                   */
/* ---------------------------------------------------------------------- */

export const MODE_LABEL: Record<PlayableMode, string> = {
  live: "Live",
  async: "Play anytime",
  practice: "Practice",
};

function appNameOf(match: Match, appName?: string): string {
  return appName ?? getOfficialApp(match.appSlug)?.name ?? "match";
}

function isGroup(match: Match): boolean {
  return seatedPlayers(match).length > 2 || (match.maxPlayers ?? 2) > 2 || (match.teams ?? 0) >= 2;
}

/** "a 4-player Trivia Royale" */
function tableLabel(match: Match, appName?: string): string {
  const seated = isLobby(match) ? 0 : placements(match).length;
  const n = Math.max(2, seated || (match.maxPlayers ?? 2));
  return `a ${n}-player ${appNameOf(match, appName)}`;
}

/** Third-person result for 3+ players or team play ("@a won a 4-player Trivia Royale"). */
export function groupResultLine(match: Match, appName?: string): string {
  const table = tableLabel(match, appName);
  if (match.teams >= 2 && match.winnerTeam !== null && match.winnerTeam !== undefined) {
    return `${teamName(match.winnerTeam)} won ${table}`;
  }
  const winner = match.winnerId ? match.players.find((p) => p.userId === match.winnerId) : undefined;
  if (winner) return `@${winner.profile.handle} won ${table}`;
  const tied = placements(match).filter((p) => p.rank === 1);
  if (tied.length > 1 && tied.length < placements(match).length) {
    return `${tied.map((p) => `@${p.profile.handle}`).join(" and ")} tied for 1st in ${table}`;
  }
  return `${table[0]?.toUpperCase()}${table.slice(1)} ended in a tie`;
}

function waitingOn(players: MatchPlayer[]): string {
  if (players.length === 1) return `@${players[0]!.profile.handle}`;
  return `${players.length} players`;
}

/**
 * One-line summary of where a match stands. Written from the viewer's point of
 * view ("You beat @x"), or in third person when `subject` is someone else.
 * Reads well for 1v1, free-for-all tables and team play.
 */
export function matchHeadline(
  match: Match,
  viewerId: string | undefined,
  subject?: { id: string; handle: string },
  appName?: string,
): string {
  const group = isGroup(match);
  const seated = seatedPlayers(match);
  const turn = turnPlayer(match);

  if (subject && subject.id !== viewerId) {
    const who = `@${subject.handle}`;
    if (group) {
      const table = tableLabel(match, appName);
      const them = seated.find((p) => p.userId === subject.id);
      if (match.status === "completed") {
        if (match.teams >= 2 && match.winnerTeam !== null) {
          return them?.team === match.winnerTeam ? `${who}'s ${teamName(match.winnerTeam)} won ${table}` : groupResultLine(match, appName);
        }
        if (match.winnerId === subject.id) return `${who} won ${table}`;
        if (them?.rank) return `${who} placed ${ordinal(them.rank)} in ${table}`;
        return groupResultLine(match, appName);
      }
      if (match.status === "voting") return `${who} in ${table} — crowd is voting`;
      return `${who} is playing ${table}`;
    }
    const other = opponentOf(match, subject.id);
    const vs = other ? `@${other.profile.handle}` : "a challenger";
    if (match.status === "completed") {
      if (!match.winnerId) return `${who} drew with ${vs}`;
      return match.winnerId === subject.id ? `${who} beat ${vs}` : `${vs} beat ${who}`;
    }
    if (match.status === "voting") return `${who} vs ${vs} — crowd is voting`;
    return `${who} vs ${vs}`;
  }

  const me = playerOf(match, viewerId);
  const seatedMe = me && isSeated(me) ? me : undefined;
  const watching = !!me && !seatedMe;
  const opponent = opponentOf(match, viewerId);
  const them = opponent ? `@${opponent.profile.handle}` : "a challenger";
  const creator = match.players.find((p) => p.userId === match.createdBy);
  const byCreator = creator ? `@${creator.profile.handle}` : "Someone";

  if (group) {
    const table = tableLabel(match, appName);
    const filled = activePlayers(match).length;
    const invited = seated.filter((p) => p.state === "invited" && p.userId !== viewerId);
    switch (match.status) {
      case "open":
      case "pending":
        if (seatedMe?.state === "invited") return `${byCreator} invited you to ${table}`;
        if (!seatedMe) return `Open table · ${filled}/${match.maxPlayers} seated`;
        if (invited.length && !openSeats(match)) return `Waiting for ${waitingOn(invited)} to accept`;
        return `Waiting for players · ${filled}/${match.maxPlayers}`;
      case "active": {
        if (watching) return `Watching ${table}`;
        if (turn && match.mode === "async") {
          return turn.userId === viewerId ? "Your turn" : `@${turn.profile.handle}'s turn`;
        }
        if (seatedMe?.state === "submitted") {
          const left = activePlayers(match).filter((p) => p.state !== "submitted");
          return left.length ? `Waiting for ${waitingOn(left)}` : "Waiting for results";
        }
        return match.mode === "async" ? "Your turn" : "Live now";
      }
      case "voting":
        return "The crowd is voting";
      case "completed":
        if (!seatedMe) return groupResultLine(match, appName);
        if (match.teams >= 2 && match.winnerTeam !== null) {
          return seatedMe.team === match.winnerTeam ? "Your team won" : `${teamName(match.winnerTeam)} won`;
        }
        if (match.winnerId === viewerId) return `You won ${table}`;
        if (seatedMe.rank === 1) return `You tied for 1st in ${table}`;
        if (seatedMe.rank) return `You placed ${ordinal(seatedMe.rank)} of ${placements(match).length}`;
        return groupResultLine(match, appName);
      case "declined":
        return "Declined";
      case "cancelled":
        return "Cancelled";
      case "expired":
        return "Expired";
    }
  }

  switch (match.status) {
    case "open":
      if (seatedMe?.state === "invited") return `${byCreator} challenged you`;
      return seatedMe ? "Waiting for a challenger" : "Open challenge";
    case "pending":
      if (seatedMe?.state === "invited") return `${them} challenged you`;
      return seatedMe?.state === "submitted" ? `Waiting for ${them} to play` : `Waiting for ${them} to accept`;
    case "active":
      if (watching) return `Watching ${seated.map((p) => `@${p.profile.handle}`).join(" vs ")}`;
      if (turn && match.mode === "async") return turn.userId === viewerId ? "Your turn" : `${them}'s turn`;
      if (seatedMe?.state === "submitted") return `Waiting for ${them}`;
      return match.mode === "async" ? "Your turn" : "Live now";
    case "voting":
      return "The crowd is voting";
    case "completed":
      if (!match.winnerId) return `Draw with ${them}`;
      return match.winnerId === viewerId ? `You beat ${them}` : seatedMe ? `${them} won` : "Finished";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
  }
}
