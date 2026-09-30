import type { AppImageKind } from "@/lib/app-images";
import type {
  AppAnalytics,
  AppLogEntry,
  AppVersion,
  DeveloperNotice,
  LogLevel,
  ReviewItem,
  VersionManifest,
  AppAuthority,
  MediaRef,
  StatLeaderRow,
  StatStanding,
  StorageScope,
  UserAchievement,
  UserStat,
  AppServerConfig,
  WebhookDelivery,
  AppLaunch,
  AppManifest,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  Profile,
  RegisterAppInput,
  SubmitInput,
  UpvoteResult,
} from "./types";

/* ---------------------------------------------------------------------- */
/* Realtime room                                                          */
/* ---------------------------------------------------------------------- */

/** Everything that travels through a match room. */
export type RoomEvent =
  /** App traffic from `xapps.room.send`. */
  | { kind: "app"; type: string; payload: Json }
  /** Seat 0 tells everyone to start the intro. */
  | { kind: "start"; at: number }
  /** Emoji reaction from the HUD. */
  | { kind: "reaction"; emoji: string }
  /** The sender unlocked one of the app's achievements (so the others' hosts and apps hear about it). */
  | { kind: "achievement"; id: string };

export interface RoomPeer {
  userId: string;
  ready: boolean;
}

export interface RoomTransport {
  send(event: RoomEvent): void;
  onEvent(handler: (event: RoomEvent, from: string, at: number) => void): () => void;
  /** Update our presence payload (joins presence on first call). */
  track(state: { ready: boolean }): void;
  /** Everyone currently connected, including us. */
  onPresence(handler: (peers: RoomPeer[]) => void): () => void;
  close(): void;
}

/* ---------------------------------------------------------------------- */
/* Backend                                                                */
/* ---------------------------------------------------------------------- */

export interface Backend {
  readonly kind: "supabase" | "demo";

  // Session ------------------------------------------------------------
  getViewer(): Promise<Profile | null>;
  onViewerChange(handler: (viewer: Profile | null) => void): () => void;
  signInWithX(next?: string): Promise<void>;
  signOut(): Promise<void>;

  // Catalog ------------------------------------------------------------
  listApps(): Promise<AppManifest[]>;
  getApp(slug: string): Promise<AppManifest | null>;
  /**
   * Opens a standalone (`kind: "app"`) app: records the open (it counts toward the app's
   * play count) and returns the app to run. `versionId` opens a test build (owner and testers only).
   * Refuses games, which are played through matches.
   */
  openApp(appSlug: string, versionId?: string | null): Promise<AppLaunch>;
  registerApp(input: RegisterAppInput): Promise<AppManifest>;
  listMyApps(): Promise<AppManifest[]>;
  /**
   * Upvotes (`on`) or takes back the viewer's upvote on an app; idempotent. Resolves with the
   * app's new count. Signed in only; only published apps can be upvoted, never your own
   * (taking an upvote back always works). Rate limited (`UPVOTES_PER_MINUTE`).
   */
  setUpvote(appSlug: string, on: boolean): Promise<UpvoteResult>;

  // App server settings (owner only, Stage 2) ---------------------------
  /** False when the backend has no server API or webhooks (demo mode). */
  readonly serverApi: boolean;
  getAppServerConfig(appSlug: string): Promise<AppServerConfig>;
  /** Returns the new secret. It can't be read again. */
  rotateAppSecret(appSlug: string): Promise<string>;
  /** Returns the new signing secret when the URL is set or changed, null when cleared. */
  setAppWebhook(appSlug: string, url: string | null): Promise<string | null>;
  rotateWebhookSecret(appSlug: string): Promise<string>;
  setAppAuthority(appSlug: string, authority: AppAuthority): Promise<void>;
  listWebhookDeliveries(appSlug: string): Promise<WebhookDelivery[]>;
  sendTestWebhook(appSlug: string): Promise<void>;

  // Shipping (Stage 4) ---------------------------------------------------
  listAppVersions(appSlug: string): Promise<AppVersion[]>;
  createAppVersion(appSlug: string, input: { version: string; url: string; manifest: VersionManifest; notes?: string }): Promise<AppVersion>;
  updateAppVersion(versionId: string, input: { url?: string; manifest?: VersionManifest; notes?: string }): Promise<AppVersion>;
  /** Sends a draft or rejected version to review; any other version of the app in review is superseded. */
  submitAppVersion(versionId: string): Promise<AppVersion>;
  /**
   * Edits a version that's in review: saves the changes as the next patch version (1.1.0 → 1.1.1),
   * submits it and supersedes the edited one. Resolves with the new version.
   */
  reviseAppVersion(versionId: string, input: { url?: string; manifest?: VersionManifest; notes?: string }): Promise<AppVersion>;
  withdrawAppVersion(versionId: string): Promise<AppVersion>;
  publishAppVersion(versionId: string): Promise<AppVersion>;
  listAppTesters(appSlug: string): Promise<Profile[]>;
  addAppTester(appSlug: string, handle: string): Promise<Profile[]>;
  removeAppTester(appSlug: string, userId: string): Promise<Profile[]>;
  /** Admins only. */
  listReviewQueue(): Promise<ReviewItem[]>;
  reviewAppVersion(versionId: string, decision: "approve" | "reject", notes: string): Promise<AppVersion>;
  /** Owner/admin analytics for the last `days` days. */
  appAnalytics(appSlug: string, days?: number): Promise<AppAnalytics>;
  logAppEvent(entry: { appSlug: string; matchId: string | null; level: LogLevel; message: string; data?: Json; source: "app" | "host" }): Promise<void>;
  listAppLogs(appSlug: string, filter?: { level?: LogLevel; matchId?: string; before?: string; limit?: number }): Promise<AppLogEntry[]>;
  /** Review decisions for the viewer's apps, newest first. */
  listMyNotices(limit?: number): Promise<DeveloperNotice[]>;
  /** Marks these notices (default: all unread) read; resolves to how many changed. */
  markNoticesRead(ids?: string[]): Promise<number>;

  // People -------------------------------------------------------------
  getProfile(handle: string): Promise<Profile | null>;
  searchProfiles(query: string): Promise<Profile[]>;
  leaderboard(appSlug?: string): Promise<LeaderRow[]>;

  // Matches ------------------------------------------------------------
  createChallenge(input: CreateChallengeInput): Promise<Match>;
  /** Join someone who's waiting, or open a new public lobby (with `versionId`: a test-build lobby for owner/testers). */
  quickMatch(appSlug: string, versionId?: string | null): Promise<Match>;
  /** Solo match against bots the app drives (`players` seats, default the app's minimum). */
  startPractice(appSlug: string, players?: number, versionId?: string | null): Promise<Match>;
  /** Creator starts a lobby early once the minimum is seated. */
  startMatch(matchId: string): Promise<Match>;
  /** Watch a match without a seat. */
  spectate(matchId: string): Promise<Match>;
  /** Invite more people (by handle) into a match's free seats. */
  inviteToMatch(matchId: string, handles: string[]): Promise<Match>;
  /** Compare-and-set the shared match state. Throws BackendError "conflict" if the version moved. */
  updateState(matchId: string, state: Json, expectedVersion: number): Promise<{ version: number; match: Match }>;
  /** Pass the turn (default: next seated player still in the match). */
  endTurn(matchId: string, next?: string | null): Promise<Match>;
  setRound(matchId: string, round: number): Promise<Match>;
  /** Accept an invite or take the empty seat of an open challenge. */
  joinMatch(matchId: string): Promise<Match>;
  declineMatch(matchId: string): Promise<Match>;
  cancelMatch(matchId: string): Promise<Match>;
  getMatch(matchId: string): Promise<Match | null>;
  markStarted(matchId: string): Promise<Match>;
  heartbeat(matchId: string): Promise<void>;
  /** Opponent vanished mid-match — the server checks their last heartbeat. */
  claimForfeit(matchId: string): Promise<Match>;
  forfeit(matchId: string): Promise<Match>;
  submit(matchId: string, input: SubmitInput): Promise<Match>;
  vote(matchId: string, choiceUserId: string): Promise<Match>;

  listMyMatches(): Promise<Match[]>;
  /** Contests waiting for the crowd that the viewer can judge. */
  listVotingMatches(): Promise<Match[]>;
  listRecentActivity(): Promise<Match[]>;
  listUserMatches(userId: string): Promise<Match[]>;

  // Realtime -----------------------------------------------------------
  watchMatch(matchId: string, handler: (match: Match) => void): () => void;
  /** Fires whenever anything relevant to the viewer's matches changes. */
  watchInbox(handler: () => void): () => void;
  openRoom(matchId: string, viewerId: string): RoomTransport;

  // Per-app storage ----------------------------------------------------
  storageGet(appSlug: string, key: string, scope?: StorageScope): Promise<Json | null>;
  storageSet(appSlug: string, key: string, value: Json): Promise<void>;
  storageDelete(appSlug: string, key: string): Promise<void>;
  storageList(appSlug: string, prefix?: string, scope?: StorageScope): Promise<string[]>;

  // Media, stats & achievements (Stage 3) -------------------------------
  /** Validates and stores a file for the viewer under an app; returns a public URL. */
  uploadMedia(appSlug: string, file: Blob): Promise<MediaRef>;
  /**
   * Stores a listing image the developer picked (already processed with `processAppImage`) and
   * returns its key for a manifest's `iconImage` / `coverImage`. Uploads are never overwritten.
   */
  uploadAppImage(file: Blob, kind: AppImageKind): Promise<string>;
  /** Applies each stat's aggregate; returns the new values. Refused for server-authoritative apps. */
  reportStats(appSlug: string, values: { [key: string]: number }): Promise<{ [key: string]: number }>;
  statLeaderboard(appSlug: string, key: string): Promise<StatLeaderRow[]>;
  /**
   * A stat's leaderboard (`limit` rows: default 10, clamped to 1–50) with the viewer's rank and
   * how many people have a value. Anyone may read it; `me` is null when signed out.
   */
  statStanding(appSlug: string, key: string, limit?: number): Promise<StatStanding>;
  userStats(userId: string): Promise<UserStat[]>;
  /** `unlocked` is false if the viewer already had it. Refused for server-authoritative apps. */
  unlockAchievement(appSlug: string, id: string): Promise<{ unlocked: boolean }>;
  userAchievements(userId: string): Promise<UserAchievement[]>;

  /** Demo-only helpers (persona switching, reset). */
  readonly demo?: DemoControls;
}

export interface DemoControls {
  personas(): Profile[];
  signInAs(input: { handle: string; name?: string }): Promise<Profile>;
  switchTo(profileId: string): Promise<void>;
  /** Make the signed-in demo user a reviewer (admin) or not. */
  setAdmin(on: boolean): Promise<Profile>;
  reset(): void;
}

export class BackendError extends Error {
  constructor(
    message: string,
    readonly code:
      | "unauthenticated"
      | "not_found"
      | "forbidden"
      | "conflict"
      | "invalid"
      | "setup_required"
      /** A quota or rate limit (uploads per day, stat reports per minute). */
      | "rate_limited"
      | "internal" = "internal",
  ) {
    super(message);
    this.name = "BackendError";
  }
}
