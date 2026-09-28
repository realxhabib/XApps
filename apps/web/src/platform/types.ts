import type {
  Json,
  MatchMode,
  MatchStatus,
  Scoring,
  SubmissionDisplay,
} from "@xapps/sdk";

export type { Json, MatchMode, MatchStatus, Scoring, SubmissionDisplay };

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
  players: { min: number; max: number };
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
  seat: number;
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
  players: MatchPlayer[];
  /** Practice contests are judged by a simulated crowd. */
  simulatedVotes: boolean;
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
}

export interface SubmitInput {
  playerId?: string;
  score?: number;
  data?: Json;
  display?: SubmissionDisplay;
}
