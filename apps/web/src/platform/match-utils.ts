import type { LaunchContext, MatchResult, PlayerInfo } from "@xapps/sdk";
import type { AppManifest, Match, MatchPlayer, PlayableMode, Profile } from "./types";

export function playerOf(match: Match, userId: string | undefined): MatchPlayer | undefined {
  return userId ? match.players.find((p) => p.userId === userId) : undefined;
}

export function opponentOf(match: Match, userId: string | undefined): MatchPlayer | undefined {
  return match.players.find((p) => p.userId !== userId && p.state !== "declined");
}

export function isFinished(match: Match): boolean {
  return ["completed", "cancelled", "declined", "expired"].includes(match.status);
}

export function toMatchResult(match: Match): MatchResult {
  const scores: Record<string, number | null> = {};
  const xp: Record<string, number> = {};
  for (const p of match.players) {
    scores[p.userId] = p.score;
    xp[p.userId] = p.xpDelta;
  }
  return { matchId: match.id, status: match.status, winnerId: match.winnerId, scores, votes: match.votes, xp };
}

export function toPlayerInfo(p: MatchPlayer): PlayerInfo {
  return {
    id: p.userId,
    handle: p.profile.handle,
    name: p.profile.name,
    avatarUrl: p.profile.avatarUrl,
    seat: p.seat,
    isBot: p.isBot,
    submitted: p.state === "submitted",
    score: p.score,
  };
}

export function toLaunchMatch(match: Match, viewerId: string): LaunchContext["match"] {
  const players = match.players.filter((p) => p.state !== "declined").map(toPlayerInfo);
  return {
    id: match.id,
    mode: match.mode,
    status: match.status,
    scoring: match.scoring,
    seed: match.seed,
    players,
    seat: playerOf(match, viewerId)?.seat ?? 0,
    settings: match.settings,
  };
}

export function buildLaunchContext(app: AppManifest, match: Match, viewer: Profile, origin: string): LaunchContext {
  return {
    app: { id: app.slug, slug: app.slug, name: app.name },
    user: { id: viewer.id, handle: viewer.handle, name: viewer.name, avatarUrl: viewer.avatarUrl },
    match: toLaunchMatch(match, viewer.id),
    host: { name: "XApps", version: "0.1.0", origin },
    locale: typeof navigator !== "undefined" ? navigator.language : "en",
  };
}

export const MODE_LABEL: Record<PlayableMode, string> = {
  live: "Live",
  async: "Play anytime",
  practice: "Practice",
};

/**
 * One-line summary of where a match stands. Written from the viewer's point of
 * view ("You beat @x"), or in third person when `subject` is someone else.
 */
export function matchHeadline(match: Match, viewerId: string | undefined, subject?: { id: string; handle: string }): string {
  if (subject && subject.id !== viewerId) {
    const who = `@${subject.handle}`;
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
  const opponent = opponentOf(match, viewerId);
  const them = opponent ? `@${opponent.profile.handle}` : "a challenger";
  switch (match.status) {
    case "open":
      return me ? "Waiting for a challenger" : "Open challenge";
    case "pending":
      if (me?.state === "invited") return `${them} challenged you`;
      return me?.state === "submitted" ? `Waiting for ${them} to play` : `Waiting for ${them} to accept`;
    case "active":
      if (me?.state === "submitted") return `Waiting for ${them}`;
      return match.mode === "async" ? "Your turn" : "Live now";
    case "voting":
      return "The crowd is voting";
    case "completed":
      if (!match.winnerId) return `Draw with ${them}`;
      return match.winnerId === viewerId ? `You beat ${them}` : me ? `${them} won` : "Finished";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
  }
}
