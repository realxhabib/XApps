import type {
  AchievementDef,
  Json,
  MediaRef,
  StatDef,
  StorageScope,
  MatchMode,
  MatchStatus,
  PlayerRole,
  Scoring,
  SubmissionDisplay,
} from "@xapps/sdk";

export type { AchievementDef, Json, MatchMode, MatchStatus, MediaRef, PlayerRole, Scoring, StatDef, StorageScope, SubmissionDisplay };

export type AppCategory = "games" | "contests" | "debates" | "trivia" | "creative" | "social";

export const CATEGORIES: { id: AppCategory; label: string; emoji: string }[] = [
  { id: "games", label: "Games", emoji: "🎮" },
  { id: "contests", label: "Contests", emoji: "🏆" },
  { id: "debates", label: "Debates", emoji: "🔥" },
  { id: "trivia", label: "Trivia", emoji: "🧠" },
  { id: "creative", label: "Creative", emoji: "🎨" },
  { id: "social", label: "Social", emoji: "💬" },
];

export type AppStatus = "published" | "pending" | "rejected";

export type AppAuthority = "client" | "server";

/** Owner-only view of an app's server settings (Stage 2). Secrets are never readable after creation. */
export interface AppServerConfig {
  secretPrefix: string | null;
  hasSecret: boolean;
  webhookUrl: string | null;
  hasWebhook: boolean;
  authority: AppAuthority;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  matchId: string | null;
  createdAt: string;
  attempts: number;
  deliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

/** Modes a user can pick when starting a match (practice is always available). */
export type PlayableMode = Extract<MatchMode, "live" | "async" | "practice">;

export interface AppManifest {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  /** A single emoji used as the app's glyph. */
  icon: string;
  /** Two-stop accent gradient. */
  accent: [string, string];
  /** Where the app is served. Relative URLs are same-origin (first-party). */
  url: string;
  modes: PlayableMode[];
  /** Seats per match: 2 ≤ min ≤ max ≤ 8. */
  players: { min: number; max: number };
  /** 0 = free for all; 2–4 = team play (seat s plays for team s % teams). */
  teams?: number;
  /** Others may watch live matches (default true). */
  spectators?: boolean;
  /** The app renders its own challenge setup screen (setup purpose). */
  setup?: boolean;
  /** Players take turns (live or over days); the host shows turn UI and "your turn" inbox items. */
  turnBased?: boolean;
  /** Who settles matches: players' clients (default) or the app's server via the server API. */
  authority?: AppAuthority;
  /** Per-player stats with leaderboards (Stage 3). */
  stats?: StatDef[];
  /** Achievements the app can unlock (Stage 3). */
  achievements?: AchievementDef[];
  scoring: Scoring;
  /** For `votes` scoring: votes needed to decide a match. */
  votesToWin?: number;
  /** Rough length of a match, shown on cards. */
  durationLabel: string;
  howTo: string[];
  official: boolean;
  developer: { id: string | null; handle: string; name: string };
  status: AppStatus;
  playCount: number;
  createdAt: string;
  tags: string[];
}

export interface Profile {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  bio: string;
  xp: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  createdAt: string;
  /** Demo personas the app can drive as bots. */
  isBot?: boolean;
}

export type PlayerState = "invited" | "joined" | "submitted" | "declined" | "left";
export type PlayerResult = "win" | "loss" | "draw" | null;

export interface MatchPlayer {
  userId: string;
  /** Null for spectators. */
  seat: number | null;
  /** Team index in team play, else null. */
  team: number | null;
  role: PlayerRole;
  /** Final placement once settled (1 = first; ties share a rank). */
  rank: number | null;
  state: PlayerState;
  isBot: boolean;
  score: number | null;
  submission: { data?: Json; display?: SubmissionDisplay } | null;
  result: PlayerResult;
  xpDelta: number;
  lastSeenAt: string | null;
  profile: Profile;
}

export interface Match {
  id: string;
  appSlug: string;
  mode: PlayableMode;
  status: MatchStatus;
  scoring: Scoring;
  seed: string;
  createdBy: string;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  winnerId: string | null;
  /** Anyone with the link can take the empty seat. */
  isOpen: boolean;
  settings: { [key: string]: Json };
  votes: { [userId: string]: number };
  votesNeeded: number;
  votingEndsAt: string | null;
  /** Seated players by seat, plus the viewer's own row if they're spectating. */
  players: MatchPlayer[];
  /** Practice contests are judged by a simulated crowd. */
  simulatedVotes: boolean;
  minPlayers: number;
  maxPlayers: number;
  teams: number;
  /** Winning team in team play. */
  winnerTeam: number | null;
  spectatorCount: number;
  /** Shared, persistent match state written by the app. */
  state: Json | null;
  stateVersion: number;
  turnUserId: string | null;
  turnDeadline: string | null;
  round: number;
}

export interface LeaderRow {
  rank: number;
  profile: Profile;
  wins: number;
  played: number;
  xp: number;
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: "win" | "draw" | "challenge" | "voting";
  match: Match;
}

export interface CreateChallengeInput {
  appSlug: string;
  mode: Exclude<PlayableMode, "practice">;
  /** Invite a specific person; leave empty for an open challenge link. */
  opponentHandle?: string | null;
  /** Invite several people (multiplayer apps). Merged with `opponentHandle`. */
  opponentHandles?: string[];
  /** Table size for multiplayer apps, within the app's range. */
  maxPlayers?: number;
  /** How the challenger set up the round; the app reads it as `match.settings` (max 4 KB). */
  settings?: { [key: string]: Json };
}

export interface RegisterAppInput {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  icon: string;
  accent: [string, string];
  url: string;
  modes: PlayableMode[];
  scoring: Scoring;
  howTo: string[];
  /** Seats per match (default 2–2): 2 ≤ min ≤ max ≤ 8. */
  players?: { min: number; max: number };
  /** 0 = free for all (default); 2–4 = team play, `players.max` a multiple of it. */
  teams?: number;
  /** Others may watch (default true). */
  spectators?: boolean;
  /** The app renders its own challenge setup screen (default false). */
  setup?: boolean;
  /** Players take turns (default false). */
  turnBased?: boolean;
  /** Per-player stats with leaderboards (≤ 8). */
  stats?: StatDef[];
  /** Achievements the app can unlock (≤ 30, ≤ 500 XP in total). */
  achievements?: AchievementDef[];
}

export interface SubmitInput {
  playerId?: string;
  score?: number;
  data?: Json;
  display?: SubmissionDisplay;
}

export interface StatLeaderRow {
  rank: number;
  profile: Profile;
  value: number;
}

export interface UserStat {
  appSlug: string;
  key: string;
  value: number;
  updatedAt: string;
}

export interface UserAchievement {
  appSlug: string;
  achievementId: string;
  unlockedAt: string;
}
