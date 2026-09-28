import type {
  AppManifest,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  Profile,
  RegisterAppInput,
  SubmitInput,
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
  | { kind: "reaction"; emoji: string };

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
  registerApp(input: RegisterAppInput): Promise<AppManifest>;
  listMyApps(): Promise<AppManifest[]>;

  // People -------------------------------------------------------------
  getProfile(handle: string): Promise<Profile | null>;
  searchProfiles(query: string): Promise<Profile[]>;
  leaderboard(appSlug?: string): Promise<LeaderRow[]>;

  // Matches ------------------------------------------------------------
  createChallenge(input: CreateChallengeInput): Promise<Match>;
  /** Stores an image the viewer dropped into a challenge and returns its URL (a data URL in demo mode). */
  uploadImage(image: Blob): Promise<string>;
  /** Join someone who's waiting, or open a new public lobby. */
  quickMatch(appSlug: string): Promise<Match>;
  /** Solo match against bots the app drives (`players` seats, default the app's minimum). */
  startPractice(appSlug: string, players?: number): Promise<Match>;
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
  storageGet(appSlug: string, key: string): Promise<Json | null>;
  storageSet(appSlug: string, key: string, value: Json): Promise<void>;

  /** Demo-only helpers (persona switching, reset). */
  readonly demo?: DemoControls;
}

export interface DemoControls {
  personas(): Profile[];
  signInAs(input: { handle: string; name?: string }): Promise<Profile>;
  switchTo(profileId: string): Promise<void>;
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
      | "internal" = "internal",
  ) {
    super(message);
    this.name = "BackendError";
  }
}
