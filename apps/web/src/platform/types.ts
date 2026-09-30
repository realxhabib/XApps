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

export type AppCategory = "games" | "contests" | "debates" | "trivia" | "creative" | "social" | "news" | "tools" | "finance";

export const CATEGORIES: { id: AppCategory; label: string; emoji: string }[] = [
  { id: "games", label: "Games", emoji: "🎮" },
  { id: "contests", label: "Contests", emoji: "🏆" },
  { id: "debates", label: "Debates", emoji: "🔥" },
  { id: "trivia", label: "Trivia", emoji: "🧠" },
  { id: "creative", label: "Creative", emoji: "🎨" },
  { id: "social", label: "Social", emoji: "💬" },
  { id: "news", label: "News", emoji: "📰" },
  { id: "tools", label: "Tools", emoji: "🧰" },
  { id: "finance", label: "Finance", emoji: "📈" },
];

/**
 * What an app is. `game`: people play matches against each other (challenges,
 * lobbies, scoring, results). `app`: a standalone app people simply open (news,
 * analytics, trading, a meme maker…): the viewer arrives signed in with X and
 * gets storage, stats, achievements and media, but there are no matches.
 */
export type AppKind = "game" | "app";

/** An opened standalone app: the app as the viewer should run it (a test build's manifest for owners/testers). */
export interface AppLaunch {
  app: AppManifest;
  /** The test build being opened, or null for the live app. */
  versionId: string | null;
}

export type AppStatus = "published" | "pending" | "rejected";

/** An app's upvote count after the viewer upvoted it or took the upvote back. */
export interface UpvoteResult {
  upvotes: number;
  upvoted: boolean;
}

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
  /** A single emoji used as the app's glyph (and the fallback when `iconImage` is set). */
  icon: string;
  /** Uploaded square icon shown instead of the emoji: an image key (see `lib/app-images.ts`). */
  iconImage?: string | null;
  /** Uploaded 16:9 cover art for cards and the app page: an image key. */
  coverImage?: string | null;
  /** Two-stop accent gradient. */
  accent: [string, string];
  /** Where the app is served. Relative URLs are same-origin (first-party). */
  url: string;
  /** `game` (default) or a standalone `app` with no matches. */
  kind?: AppKind;
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
  /**
   * How many people upvoted the app (the marketplace sorts by it). The backends always set it;
   * optional so catalog entries don't have to declare it (read it as `app.upvotes ?? 0`).
   */
  upvotes?: number;
  /** Whether the signed-in viewer upvoted it (false or absent when signed out). */
  upvoted?: boolean;
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
  /** Can review app versions (Stage 4). */
  isAdmin?: boolean;
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
  /** Set for test builds (a non-published app version); never ranked. */
  versionId?: string | null;
  /** Where a test build is served (the play room loads this instead of the app's url). */
  versionUrl?: string | null;
  /** The test build's semver label ("1.1.0"), when the backend returns it. */
  versionLabel?: string | null;
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
  /** Play a non-published version (owner and testers only). */
  versionId?: string | null;
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
  /** Uploaded images (keys from `uploadAppImage`). */
  iconImage?: string | null;
  coverImage?: string | null;
  /** `game` (default) or a standalone `app`. */
  kind?: AppKind;
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

// ---------------------------------------------------------------- Stage 4

/** `superseded`: a newer submission of the same app replaced it in the review queue (one per app). */
export type AppVersionStatus = "draft" | "in_review" | "approved" | "rejected" | "published" | "retired" | "superseded";

/** The listing + capability fields a version carries (copied onto the app when published). */
export type VersionManifest = Pick<
  AppManifest,
  | "name"
  | "tagline"
  | "description"
  | "category"
  | "icon"
  | "iconImage"
  | "coverImage"
  | "kind"
  | "accent"
  | "modes"
  | "players"
  | "teams"
  | "spectators"
  | "setup"
  | "turnBased"
  | "scoring"
  | "votesToWin"
  | "howTo"
  | "stats"
  | "achievements"
>;

export interface AppVersion {
  id: string;
  appSlug: string;
  version: string;
  url: string;
  manifest: VersionManifest;
  status: AppVersionStatus;
  notes: string;
  reviewNotes: string | null;
  createdAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
  /** For `superseded` versions: the version label that replaced it in the queue. */
  supersededBy: string | null;
}

export interface ReviewItem {
  version: AppVersion;
  app: AppManifest;
  developer: Profile;
  /** The currently published version, if any (for diffing). */
  published: AppVersion | null;
  /** Earlier submissions this one replaced in the queue, newest first (e.g. ["1.1.1", "1.1.0"]). */
  replaces: string[];
}

export interface AppAnalytics {
  days: number;
  series: {
    date: string;
    matchesCreated: number;
    matchesCompleted: number;
    matchesAbandoned: number;
    players: number;
    newPlayers: number;
  }[];
  totals: { matches: number; completed: number; players: number; newPlayers: number };
  completionRate: number;
  medianDurationSec: number | null;
  modes: { mode: string; matches: number }[];
  tableSizes: { players: number; matches: number }[];
  retention: { d1: number | null; d7: number | null };
  topPlayers: { profile: Profile; matches: number; wins: number }[];
  versions: { versionId: string | null; version: string | null; matches: number }[];
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type DeveloperNoticeKind = "version_approved" | "version_rejected" | "version_published";

/** A review decision for one of the viewer's apps (`developer_notices`). */
export interface DeveloperNotice {
  id: string;
  kind: DeveloperNoticeKind;
  appSlug: string;
  versionId: string | null;
  /** The version label ("1.1.0"). */
  version: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface AppLogEntry {
  id: string;
  appSlug: string;
  versionId: string | null;
  matchId: string | null;
  userId: string | null;
  level: LogLevel;
  message: string;
  data: Json | null;
  source: "app" | "host";
  createdAt: string;
}
