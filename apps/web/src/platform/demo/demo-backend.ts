import { appImageKeyError, blobToDataUrl, type AppImageKind } from "@/lib/app-images";
import { LIMITS, createRandom, randomId } from "@xapps/sdk";
import { byteLength } from "@xapps/sdk/protocol";
import { isBlobLike } from "@xapps/sdk/host";
import { absoluteMediaUrl, displayProblem, mediaKindOf, mediaProblem, mediaQuotaProblem, postDemoMedia, probeMedia } from "@/lib/media";
import { BackendError, type Backend, type DemoControls, type RoomTransport } from "../backend";
import {
  OFFICIAL_APPS,
  getOfficialApp,
  manifestShapeError,
  toAchievementDefs,
  toStatDefs,
  withManifestDefaults,
} from "../catalog";
import { isRetiredApp } from "../retired-apps";
import { XP, teamForSeat } from "../scoring";
import {
  EDITABLE_STATUSES,
  LOG_CAP_PER_APP,
  LOG_LIMITS,
  LOG_PAGE_DEFAULT,
  LOG_PAGE_MAX,
  LOG_RETENTION_MS,
  ANALYTICS_DAYS_DEFAULT,
  ANALYTICS_DAYS_MAX,
  MAX_TESTERS_PER_APP,
  MAX_VERSIONS_PER_APP,
  REVIEW_NOTES_MAX,
  VERSION_NOTES_MAX,
  applyVersionToApp,
  cleanManifest,
  isLogLevel,
  isStandaloneApp,
  levelsFrom,
  manifestOf,
  nextRevisionVersion,
  notAGameMessage,
  notAnAppMessage,
  sortVersions,
  versionLabelError,
  versionManifestError,
  versionUrlError,
} from "../shipping";
import type {
  AppAnalytics,
  AppLaunch,
  AppLogEntry,
  AppVersion,
  DeveloperNotice,
  LogLevel,
  ReviewItem,
  VersionManifest,
  AppAuthority,
  AppManifest,
  AppServerConfig,
  CreateChallengeInput,
  Json,
  LeaderRow,
  Match,
  MediaRef,
  PlayableMode,
  Profile,
  RegisterAppInput,
  StatLeaderRow,
  StatStanding,
  StorageScope,
  SubmitInput,
  UserAchievement,
  UpvoteResult,
  UserStat,
  WebhookDelivery,
} from "../types";
import { UPVOTES_PER_MINUTE } from "../upvotes";
import { computeAnalytics } from "./analytics";
import { createDemoRoom } from "./room";
import { addPersonaContest, applySettlement, buildSeed, ensureShowcase, isPracticeBot, newMatchId, PRACTICE_BOTS, upgradeDb } from "./seed";
import {
  credentialsFor,
  deliveriesFor,
  newAppSecret,
  newWebhookSecret,
  recordWebhook,
  SECRET_PREFIX_LENGTH,
  sha256Hex,
  webhookUrlError,
} from "./server-settings";
import {
  MATCH_V2_DEFAULTS,
  getViewerId,
  hydratePlayer,
  isHumanOnline,
  load,
  markHuman,
  mutate,
  mutateIfChanged,
  newPlayerRow,
  nowIso,
  reset,
  setSeeder,
  setViewerId,
  subscribe,
  type DemoDb,
  type MatchRow,
  type PlayerRow,
  type VersionRow,
} from "./store";
import { setUpvote as applyUpvote, withUpvotes } from "./upvotes";

setSeeder(buildSeed, upgradeDb);

const SIM_LEADER_KEY = "xapps:demo-sim-leader";
const INVITED_KEY = "xapps:demo-invited";
const TAB_ID = randomId(8);
const SESSION_START = Date.now();
/** Async turns time out after three days. */
export const TURN_TIMEOUT_MS = 3 * 86_400_000;
/** A player who hasn't sent a heartbeat for this long can be claimed against. */
const CLAIM_AFTER_MS = 45_000;

/* ---------------------------------------------------------------------- */
/* Row helpers                                                            */
/* ---------------------------------------------------------------------- */

/** Rows that hold a seat (any state), by seat. */
function seatRows(row: MatchRow): PlayerRow[] {
  return row.players
    .filter((p) => p.role === "player" && p.seat !== null)
    .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
}

/** Seated players who are in the game: joined or submitted (not invited, declined or gone). */
function inRows(row: MatchRow): PlayerRow[] {
  return seatRows(row).filter((p) => p.state === "joined" || p.state === "submitted");
}

function freeSeatList(row: MatchRow): number[] {
  const held = new Set(seatRows(row).map((p) => p.seat));
  const free: number[] = [];
  for (let seat = 0; seat < row.maxPlayers; seat++) if (!held.has(seat)) free.push(seat);
  return free;
}

function takeSeat(row: MatchRow, userId: string, extra: Partial<PlayerRow> = {}): PlayerRow {
  const seat = freeSeatList(row)[0];
  if (seat === undefined) throw new BackendError("This table is full", "conflict");
  const player = newPlayerRow(userId, seat, { team: teamForSeat(seat, row.teams), ...extra });
  row.players.push(player);
  return player;
}

function isLobby(row: MatchRow): boolean {
  return row.status === "open" || row.status === "pending";
}

function setTurn(row: MatchRow, userId: string | null): void {
  row.turnUserId = userId;
  row.turnDeadline = row.mode === "async" && userId ? new Date(Date.now() + TURN_TIMEOUT_MS).toISOString() : null;
}

/** Mirrors next_turn_user: the next seated player still in after `fromUserId`'s seat, wrapping around. */
function nextTurnAfter(row: MatchRow, fromUserId: string | null): string | null {
  const ins = inRows(row);
  if (!ins.length) return null;
  const fromSeat = row.players.find((p) => p.userId === fromUserId)?.seat ?? -1;
  return (ins.find((p) => (p.seat ?? 0) > fromSeat) ?? ins[0])!.userId;
}

/** Mirrors teams_ready: every team has a seated player who is in. */
function teamsReady(row: MatchRow): boolean {
  if (row.teams < 2) return true;
  const ins = inRows(row);
  for (let team = 0; team < row.teams; team++) if (!ins.some((p) => p.team === team)) return false;
  return true;
}

/** open/pending → active. Turn-based apps hand the first turn to the lowest seat. */
function activate(db: DemoDb, row: MatchRow): void {
  row.status = "active";
  recordWebhook(db, row.appSlug, "match.started", row.id);
  if (appForRow(db, row)?.turnBased && !row.turnUserId) setTurn(row, inRows(row)[0]?.userId ?? null);
}

/**
 * Mirrors try_activate: live tables start once no invite is outstanding and
 * every seat is taken (or the table isn't open to anyone else); async ones as
 * soon as the minimum is seated. Every team needs a player either way.
 */
function tryActivate(db: DemoDb, row: MatchRow): boolean {
  if (!isLobby(row)) return false;
  const seats = seatRows(row);
  const seated = inRows(row).length;
  const invited = seats.filter((p) => p.state === "invited").length;
  const taken = seats.length;
  if (seated < row.minPlayers || !teamsReady(row)) return false;
  if (row.mode !== "async" && (invited > 0 || (taken < row.maxPlayers && row.isOpen))) return false;
  row.isOpen = row.isOpen && taken < row.maxPlayers;
  activate(db, row);
  return true;
}

/**
 * Mirrors maybe_settle: once play is over — every seated player still in has
 * submitted, fewer than two remain, a team is empty, or only bots remain — the
 * match settles (or goes to the crowd). Pending invites count as still in.
 */
function maybeSettle(db: DemoDb, row: MatchRow): boolean {
  if (row.status !== "active") return false;
  const alive = seatRows(row).filter((p) => p.state === "invited" || p.state === "joined" || p.state === "submitted");
  const humans = alive.filter((p) => !p.isBot).length;
  const pending = alive.filter((p) => p.state !== "submitted").length;
  let teamEmpty = false;
  for (let team = 0; row.teams >= 2 && team < row.teams; team++) if (!alive.some((p) => p.team === team)) teamEmpty = true;
  if (alive.length < 2 || humans === 0 || teamEmpty) {
    applySettlement(db, row);
    return true;
  }
  if (pending > 0) return false;
  if (row.scoring === "votes") {
    // Demo mode keeps a (fast) simulated crowd, practice included, so voting can be watched.
    row.status = "voting";
    row.votingEndsAt = new Date(Date.now() + (row.simulatedVotes ? 60_000 : 3 * 60_000)).toISOString();
    if (row.mode === "practice") row.simulatedVotes = true;
  } else {
    applySettlement(db, row);
  }
  return true;
}

/** Someone was marked left: pass their turn on, then settle if play is over. */
function afterLeave(db: DemoDb, row: MatchRow, userId: string): void {
  if (row.turnUserId === userId) setTurn(row, nextTurnAfter(row, userId));
  maybeSettle(db, row);
}

/** A quick-match lobby nobody else joined in this long is dead. Mirrors expire_idle_lobbies. */
export const QUICK_LOBBY_TTL_MS = 10 * 60_000;
/** A live table or invite that hasn't started in this long is dead too. */
export const LIVE_TABLE_TTL_MS = 2 * 3_600_000;

/**
 * Mirrors expire_idle_lobbies: expires dead lobbies, and cancels a retired app's unfinished matches (only
 * `userId`'s, when given). Returns whether any changed.
 */
export function expireIdleLobbies(db: DemoDb, now = Date.now(), userId?: string): boolean {
  let changed = false;
  for (const m of Object.values(db.matches)) {
    if (userId && !m.players.some((p) => p.userId === userId)) continue;
    // Mirrors sync-apps: a retired app's unfinished matches are cancelled (older demo data has some).
    if (isRetiredApp(m.appSlug) && (m.status === "open" || m.status === "pending" || m.status === "active")) {
      m.status = "cancelled";
      m.updatedAt = nowIso();
      changed = true;
      continue;
    }
    if (m.status !== "open" && m.status !== "pending") continue;
    const age = now - Date.parse(m.createdAt);
    const joined = m.players.filter((p) => p.role === "player" && p.state === "joined").length;
    const quickAlone = m.settings.quick === true && m.status === "open" && age > QUICK_LOBBY_TTL_MS && joined < 2;
    const staleLive = m.mode === "live" && age > LIVE_TABLE_TTL_MS;
    if (quickAlone || staleLive) {
      m.status = "expired";
      m.updatedAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

/** Mirrors expire_turn: the holder of an overdue async turn forfeits and the turn moves on. */
function expireTurn(db: DemoDb, row: MatchRow, now = Date.now()): boolean {
  if (row.status !== "active" || !row.turnUserId || !row.turnDeadline || Date.parse(row.turnDeadline) >= now) return false;
  const holder = seatRows(row).find((p) => p.userId === row.turnUserId && p.state !== "declined");
  if (holder) holder.state = "left";
  setTurn(row, nextTurnAfter(row, row.turnUserId));
  maybeSettle(db, row);
  return true;
}

function hydrate(db: DemoDb, row: MatchRow, viewerId = getViewerId()): Match {
  const seated = row.players.filter((p) => p.role === "player").sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
  const spectators = row.players.filter((p) => p.role === "spectator");
  const mine = spectators.find((p) => p.userId === viewerId);
  return {
    id: row.id,
    appSlug: row.appSlug,
    mode: row.mode,
    status: row.status,
    scoring: row.scoring,
    seed: row.seed,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    winnerId: row.winnerId,
    isOpen: row.isOpen,
    settings: row.settings,
    votes: row.votes,
    votesNeeded: row.votesNeeded,
    votingEndsAt: row.votingEndsAt,
    simulatedVotes: row.simulatedVotes,
    players: [...seated, ...(mine ? [mine] : [])].map((p) => hydratePlayer(db, p)),
    minPlayers: row.minPlayers,
    maxPlayers: row.maxPlayers,
    teams: row.teams,
    winnerTeam: row.winnerTeam,
    spectatorCount: spectators.length,
    state: row.state,
    stateVersion: row.stateVersion,
    turnUserId: row.turnUserId,
    turnDeadline: row.turnDeadline,
    round: row.round,
    versionId: row.versionId ?? null,
    versionUrl: row.versionId ? (db.versions?.[row.versionId]?.url ?? null) : null,
    versionLabel: row.versionId ? (db.versions?.[row.versionId]?.version ?? null) : null,
  };
}

function byRecent(a: MatchRow, b: MatchRow): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** The first `limit` rows of a sorted stat board, ranked like SQL `rank()`: equal values share a rank. */
function rankBoard(db: DemoDb, rows: readonly { userId: string; value: number }[], limit: number): StatLeaderRow[] {
  const out: StatLeaderRow[] = [];
  rows.slice(0, limit).forEach((row, i) => {
    const prev = out[i - 1];
    const rank = prev && prev.value === row.value ? prev.rank : i + 1;
    out.push({ rank, profile: db.profiles[row.userId]!, value: row.value });
  });
  return out;
}

function isSeatedIn(row: MatchRow, userId: string): boolean {
  return row.players.some((p) => p.userId === userId && p.role === "player");
}

function appFor(db: DemoDb, slug: string, viewerId = getViewerId()): AppManifest | null {
  const official = getOfficialApp(slug);
  if (official) return withUpvotes(db, withManifestDefaults({ ...official, playCount: db.playCounts[slug] ?? 0 }), viewerId);
  const community = db.apps[slug];
  return community ? withUpvotes(db, withManifestDefaults(community), viewerId) : null;
}

/** The rules a match plays by: the app, or for a test build the version's manifest and url. */
function appForRow(db: DemoDb, row: Pick<MatchRow, "appSlug" | "versionId">): AppManifest | null {
  const app = appFor(db, row.appSlug);
  const version = row.versionId ? db.versions?.[row.versionId] : undefined;
  return app && version ? applyVersionToApp(app, version) : app;
}

/* ---------------------------------------------------------------------- */
/* Stage 4 rules (mirroring supabase/migrations/…_shipping.sql)           */
/* ---------------------------------------------------------------------- */

function publicVersion(row: VersionRow): AppVersion {
  const copy: Partial<VersionRow> = structuredClone(row);
  delete copy.reviewedBy;
  copy.supersededBy ??= null;
  return copy as AppVersion;
}

/** One submission per app in review: `next` takes the place of any other (like submit_app_version). */
function supersedeQueued(db: DemoDb, next: VersionRow): void {
  for (const other of Object.values(db.versions ?? {})) {
    if (other.appSlug === next.appSlug && other.status === "in_review" && other.id !== next.id) {
      other.status = "superseded";
      other.supersededBy = next.version;
    }
  }
}

/** The app's developer or one of its testers may play its unpublished versions. */
export function canTest(db: DemoDb, appSlug: string, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const app = db.apps[appSlug];
  if (!app) return false;
  return app.developer.id === userId || (db.testers?.[appSlug] ?? []).includes(userId);
}

/** A test build others can't see: the owner, testers and anyone at the table may. */
function hiddenFrom(db: DemoDb, row: MatchRow, viewerId: string | null): boolean {
  if (!row.versionId) return false;
  return !canTest(db, row.appSlug, viewerId) && !row.players.some((p) => p.userId === viewerId);
}

/**
 * Mirrors the `p_version` check of create_challenge/start_practice/quick_match:
 * owner/testers only, the version must belong to the app and not be retired.
 * The live version is just the app (no test build), so it returns null.
 */
function testVersionFor(db: DemoDb, appSlug: string, versionId: string | null | undefined, viewerId: string): VersionRow | null {
  if (!versionId) return null;
  const version = db.versions?.[versionId];
  if (!version || version.appSlug !== appSlug) throw new BackendError("Version not found", "not_found");
  if (!canTest(db, appSlug, viewerId)) throw new BackendError("Only the developer and testers can play test builds", "forbidden");
  if (version.status === "published") throw new BackendError("That version is live — play the app itself", "invalid");
  return version;
}

/** Mirrors `require_game`: matches are for games; standalone apps are opened (`openApp`). */
function requireGame(app: AppManifest): void {
  if (isStandaloneApp(app)) throw new BackendError(notAGameMessage(app.name), "invalid");
}

/** Mirrors matches_set_version: non-test matches remember the app's live version. */
function stampVersion(db: DemoDb, row: MatchRow): void {
  row.publishedVersionId = row.versionId ? null : (db.publishedVersions?.[row.appSlug] ?? null);
}

/** Log rows younger than the retention window, at most `LOG_CAP_PER_APP` per app (newest kept). */
function pruneLogs(logs: AppLogEntry[], now = Date.now()): AppLogEntry[] {
  const fresh = logs.filter((l) => now - Date.parse(l.createdAt) < LOG_RETENTION_MS);
  const perApp = new Map<string, number>();
  const kept: AppLogEntry[] = [];
  for (let i = fresh.length - 1; i >= 0; i--) {
    const log = fresh[i]!;
    const n = perApp.get(log.appSlug) ?? 0;
    if (n >= LOG_CAP_PER_APP) continue;
    perApp.set(log.appSlug, n + 1);
    kept.push(log);
  }
  return kept.reverse();
}

/** Mirrors notify_developer. */
function notifyDeveloper(db: DemoDb, app: AppManifest, version: VersionRow, kind: DeveloperNotice["kind"], message: string): void {
  if (!app.developer.id) return;
  (db.notices ??= []).push({
    id: `n-${randomId(12)}`,
    userId: app.developer.id,
    kind,
    appSlug: app.slug,
    versionId: version.id,
    version: version.version,
    message: message.slice(0, 2400),
    createdAt: nowIso(),
    readAt: null,
  });
  // Keep the demo database small.
  if (db.notices.length > 500) db.notices = db.notices.slice(-500);
}

/** Mirrors version_authority_check: crowd-judged apps can't be server-authoritative. */
function authorityCheck(app: AppManifest, manifest: VersionManifest): void {
  if (app.authority === "server" && manifest.scoring === "votes") {
    throw new BackendError("Crowd-judged apps can't be server-authoritative", "invalid");
  }
}

function newVersionId(): string {
  return `v-${randomId(12)}`;
}

/** Mirrors create_challenge: an object, `quick` reserved. Demo allows room for a data-URL image. */
function challengeSettings(settings: CreateChallengeInput["settings"]): { [key: string]: Json } {
  if (!settings) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) throw new BackendError("Challenge settings must be an object", "invalid");
  if (JSON.stringify(settings).length > 700_000) throw new BackendError("Challenge settings are too large", "invalid");
  const rest = { ...settings };
  delete rest.quick;
  return rest;
}

function cleanHandle(handle: string): string {
  return handle.replace(/^@/, "").trim().toLowerCase();
}

/* ---------------------------------------------------------------------- */
/* Stage 3 rules (mirroring supabase/migrations/…_media_and_data.sql)      */
/* ---------------------------------------------------------------------- */

const STAT_LIMIT = 1e15;

function storageKeyCheck(key: unknown): asserts key is string {
  if (typeof key !== "string" || key.length < 1 || key.length > LIMITS.storageKeyLength) {
    throw new BackendError(`Storage keys are 1–${LIMITS.storageKeyLength} characters`, "invalid");
  }
}

/** Mirrors `apply_stats`: each declared stat's aggregate; `updatedAt` only moves when the value changes. */
export function applyStats(db: DemoDb, app: AppManifest, userId: string, values: unknown): { [key: string]: number } {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new BackendError("Stats must be an object of numbers", "invalid");
  }
  const entries = Object.entries(values as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) throw new BackendError("Report at least one stat", "invalid");
  // Validate everything first so a bad value doesn't leave a half-applied report.
  for (const [key, value] of entries) {
    if (!app.stats?.some((s) => s.key === key)) throw new BackendError(`Unknown stat ${key}`, "invalid");
    if (typeof value !== "number" || !Number.isFinite(value)) throw new BackendError(`Stat ${key} must be a finite number`, "invalid");
    if (Math.abs(value) > STAT_LIMIT) throw new BackendError(`Stat ${key} is out of range`, "invalid");
  }
  db.userStats ??= {};
  const result: { [key: string]: number } = {};
  for (const [key, raw] of entries) {
    const value = raw as number;
    const aggregate = app.stats!.find((s) => s.key === key)!.aggregate;
    const id = `${app.slug}:${userId}:${key}`;
    const previous = db.userStats[id];
    let next: number;
    if (!previous) next = value;
    else if (aggregate === "max") next = Math.max(previous.value, value);
    else if (aggregate === "min") next = Math.min(previous.value, value);
    else if (aggregate === "sum") next = Math.min(Math.max(previous.value + value, -STAT_LIMIT), STAT_LIMIT);
    else next = value;
    if (!previous || previous.value !== next) db.userStats[id] = { value: next, updatedAt: nowIso() };
    result[key] = next;
  }
  return result;
}

/** Mirrors `grant_achievement`: a declared id, unlocked once, its XP added to the profile once. */
export function grantAchievement(db: DemoDb, app: AppManifest, userId: string, id: string): { unlocked: boolean } {
  const def = app.achievements?.find((a) => a.id === id);
  if (!def) throw new BackendError(`Unknown achievement ${id}`, "invalid");
  db.achievements ??= {};
  const key = `${app.slug}:${userId}:${id}`;
  if (db.achievements[key]) return { unlocked: false };
  db.achievements[key] = nowIso();
  const profile = db.profiles[userId];
  if (profile && def.xp > 0) profile.xp += def.xp;
  return { unlocked: true };
}

/**
 * Local, zero-config backend. Every tab shares one localStorage database,
 * personas act as bots, and BroadcastChannel carries live match traffic.
 */
/** When a submission is re-checked after it's written (see `submit`). */
export const LOST_WRITE_CHECKS_MS = [250, 1_000, 3_000];

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private viewerListeners = new Set<(viewer: Profile | null) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      // Community apps every demo lists (added to databases from before they existed too).
      mutateIfChanged(ensureShowcase);
      this.timer = setInterval(() => this.tick(), 1_200);
      // Keep our persona marked as human-controlled.
      const id = getViewerId();
      if (id) markHuman(id);
    }
  }

  /**
   * Plays as an outside profile (offline practice in the Supabase backend while
   * its database is down): keeps it in the local database under the same id,
   * so the match seats the real viewer.
   */
  adoptViewer(profile: Profile): void {
    mutate((db) => {
      const local = db.profiles[profile.id];
      db.profiles[profile.id] = local ? { ...local, handle: profile.handle, name: profile.name, avatarUrl: profile.avatarUrl } : { ...profile };
    });
    if (getViewerId() !== profile.id) setViewerId(profile.id);
    markHuman(profile.id);
  }

  /* ---------------------------------------------------------------- */
  /* Session                                                          */
  /* ---------------------------------------------------------------- */

  async getViewer(): Promise<Profile | null> {
    const id = getViewerId();
    if (!id) return null;
    const profile = load().profiles[id];
    return profile ?? null;
  }

  onViewerChange(handler: (viewer: Profile | null) => void): () => void {
    this.viewerListeners.add(handler);
    // Profile edits (XP after a match) also count as viewer changes.
    const unsubscribe = subscribe(() => {
      const id = getViewerId();
      handler(id ? (load().profiles[id] ?? null) : null);
    });
    return () => {
      this.viewerListeners.delete(handler);
      unsubscribe();
    };
  }

  private async notifyViewer() {
    const viewer = await this.getViewer();
    this.viewerListeners.forEach((h) => h(viewer));
  }

  async signInWithX(): Promise<void> {
    throw new BackendError(
      "Sign in with X needs Supabase. Add your project keys to .env.local — or keep exploring the demo.",
      "invalid",
    );
  }

  async signOut(): Promise<void> {
    setViewerId(null);
    await this.notifyViewer();
  }

  readonly demo: DemoControls = {
    personas: () =>
      Object.values(load().profiles)
        .filter((p) => !isPracticeBot(p.id))
        .sort((a, b) => b.xp - a.xp),
    signInAs: async ({ handle, name }) => {
      const clean = cleanHandle(handle);
      if (!/^[a-z0-9_]{2,15}$/.test(clean)) {
        throw new BackendError("Handles are 2–15 letters, numbers or underscores.", "invalid");
      }
      const profile = mutate((db) => {
        const existing = Object.values(db.profiles).find((p) => p.handle.toLowerCase() === clean);
        if (existing) return existing;
        const created: Profile = {
          id: `u-${randomId(10)}`,
          handle: clean,
          name: name?.trim() || clean,
          avatarUrl: null,
          bio: "Trying out XApps",
          xp: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          streak: 0,
          bestStreak: 0,
          createdAt: nowIso(),
        };
        db.profiles[created.id] = created;
        return created;
      });
      setViewerId(profile.id);
      markHuman(profile.id);
      await this.notifyViewer();
      return profile;
    },
    switchTo: async (profileId) => {
      if (!load().profiles[profileId]) throw new BackendError("No such persona", "not_found");
      setViewerId(profileId);
      markHuman(profileId);
      await this.notifyViewer();
    },
    setAdmin: async (on) => {
      const viewer = this.requireViewer();
      const profile = mutate((db) => {
        const me = db.profiles[viewer.id]!;
        if (on) me.isAdmin = true;
        else delete me.isAdmin;
        return me;
      });
      await this.notifyViewer();
      return profile;
    },
    reset: () => {
      reset();
      setViewerId(null);
      void this.notifyViewer();
    },
  };

  private requireViewer(): Profile {
    const id = getViewerId();
    const profile = id ? load().profiles[id] : undefined;
    if (!profile) throw new BackendError("Sign in to play", "unauthenticated");
    return profile;
  }

  /* ---------------------------------------------------------------- */
  /* Catalog                                                          */
  /* ---------------------------------------------------------------- */

  async listApps(): Promise<AppManifest[]> {
    const db = load();
    const viewerId = getViewerId();
    const community = Object.values(db.apps)
      .filter((app) => app.status === "published" || app.developer.id === viewerId)
      .map(withManifestDefaults);
    return [...OFFICIAL_APPS.map((a) => withManifestDefaults({ ...a, playCount: db.playCounts[a.slug] ?? 0 })), ...community].map((app) =>
      withUpvotes(db, app, viewerId),
    );
  }

  async getApp(slug: string): Promise<AppManifest | null> {
    return appFor(load(), slug);
  }

  /**
   * Mirrors `open_app`: the live app (published, or the viewer's own) for anyone,
   * signed in or not, counting the open; a test build (owner/testers, signed in)
   * as its version describes it, not counted. Games are refused.
   */
  async openApp(appSlug: string, versionId?: string | null): Promise<AppLaunch> {
    const viewerId = getViewerId();
    if (versionId) {
      // A test build: read-only (it doesn't count), and not through playable_app, so
      // testers of an app that isn't published yet can open it.
      const db = load();
      if (!viewerId || !db.profiles[viewerId]) throw new BackendError("Sign in to open test builds", "unauthenticated");
      const version = db.versions?.[versionId];
      const listed = appFor(db, appSlug);
      if (!listed || !version || version.appSlug !== appSlug) throw new BackendError("Version not found", "not_found");
      if (!canTest(db, appSlug, viewerId)) throw new BackendError("Only the developer and testers can open test builds", "forbidden");
      if (version.status === "published") throw new BackendError("That version is live — open the app itself", "invalid");
      const app = applyVersionToApp(listed, version);
      if (!isStandaloneApp(app)) throw new BackendError(notAnAppMessage(app.name), "invalid");
      return { app, versionId: version.id };
    }
    return mutate((db) => {
      const listed = this.requireApp(db, appSlug);
      if (!isStandaloneApp(listed)) throw new BackendError(notAnAppMessage(listed.name), "invalid");
      // Every open counts. Official apps count in playCounts (like settlement), community apps on their row.
      const community = db.apps[appSlug];
      if (community) community.playCount = (community.playCount ?? 0) + 1;
      else db.playCounts[appSlug] = (db.playCounts[appSlug] ?? 0) + 1;
      return { app: appFor(db, appSlug) ?? listed, versionId: null };
    });
  }

  async registerApp(input: RegisterAppInput): Promise<AppManifest> {
    const viewer = this.requireViewer();
    const shapeError =
      manifestShapeError(input) ??
      appImageKeyError(input.iconImage, { demo: true }) ??
      appImageKeyError(input.coverImage, { demo: true }) ??
      (input.kind !== undefined && input.kind !== "game" && input.kind !== "app" ? "Kind must be game or app" : null);
    if (shapeError) throw new BackendError(shapeError, "invalid");
    return mutate((db) => {
      // A retired first-party app keeps its slug (its row stays in public.apps).
      if (getOfficialApp(input.slug) || isRetiredApp(input.slug) || db.apps[input.slug]) {
        throw new BackendError("That slug is taken", "conflict");
      }
      const now = nowIso();
      const app = withManifestDefaults({
        ...input,
        kind: input.kind ?? "game",
        players: input.players ? { min: input.players.min, max: input.players.max } : { min: 2, max: 2 },
        stats: toStatDefs(input.stats ?? []),
        achievements: toAchievementDefs(input.achievements ?? []),
        votesToWin: input.scoring === "votes" ? 5 : undefined,
        durationLabel: "Community",
        official: false,
        developer: { id: viewer.id, handle: viewer.handle, name: viewer.name },
        // Demo mode auto-approves so you can try your app right away.
        status: "published",
        playCount: 0,
        createdAt: now,
        tags: ["community"],
      });
      db.apps[app.slug] = app;
      // Like the database, registering creates 1.0.0 in review. Demo mode then
      // approves and publishes it on the spot; later versions go through the queue.
      const version: VersionRow = {
        id: newVersionId(),
        appSlug: app.slug,
        version: "1.0.0",
        url: app.url,
        manifest: manifestOf(app),
        status: "published",
        notes: "First release",
        reviewNotes: "Auto-approved in demo mode",
        createdAt: now,
        submittedAt: now,
        reviewedAt: now,
        publishedAt: now,
        supersededBy: null,
        reviewedBy: null,
      };
      (db.versions ??= {})[version.id] = version;
      (db.publishedVersions ??= {})[app.slug] = version.id;
      return withUpvotes(db, app, viewer.id);
    });
  }

  async listMyApps(): Promise<AppManifest[]> {
    const viewerId = getViewerId();
    if (!viewerId) return [];
    const db = load();
    return Object.values(db.apps)
      .filter((a) => a.developer.id === viewerId)
      .map((a) => withUpvotes(db, withManifestDefaults(a), viewerId));
  }

  private upvoteHits: number[] = [];

  /** Mirrors `set_app_upvote` (including its per-minute limit, kept per tab here). */
  async setUpvote(appSlug: string, on: boolean): Promise<UpvoteResult> {
    const viewer = this.requireViewer();
    const now = Date.now();
    this.upvoteHits = this.upvoteHits.filter((at) => now - at < 60_000);
    if (this.upvoteHits.length >= UPVOTES_PER_MINUTE) throw new BackendError("Too many upvotes — slow down", "rate_limited");
    const result = mutate((db) => {
      const app = appFor(db, appSlug, viewer.id);
      const canSee = !!app && (app.status === "published" || canTest(db, appSlug, viewer.id));
      return applyUpvote(db, app, viewer.id, on, canSee);
    });
    this.upvoteHits.push(now);
    return result;
  }

  /* ---------------------------------------------------------------- */
  /* App server settings (owner only)                                 */
  /* ---------------------------------------------------------------- */

  /** The server API and webhooks need Supabase; everything below is a local preview. */
  readonly serverApi = false;

  /** Mirrors the owner RPCs' check: the caller must be the app's developer. */
  private requireOwnedApp(db: DemoDb, appSlug: string): AppManifest {
    const viewer = this.requireViewer();
    const app = db.apps[appSlug];
    if (!app) {
      if (getOfficialApp(appSlug)) throw new BackendError("Only the app's developer can manage its server settings", "forbidden");
      throw new BackendError("App not found", "not_found");
    }
    if (app.developer.id !== viewer.id) {
      throw new BackendError("Only the app's developer can manage its server settings", "forbidden");
    }
    return app;
  }

  async getAppServerConfig(appSlug: string): Promise<AppServerConfig> {
    const db = load();
    const app = this.requireOwnedApp(db, appSlug);
    const creds = db.credentials?.[appSlug];
    return {
      secretPrefix: creds?.secretHash ? creds.secretPrefix : null,
      hasSecret: !!creds?.secretHash,
      webhookUrl: creds?.webhookUrl ?? null,
      hasWebhook: !!creds?.webhookUrl,
      authority: app.authority ?? "client",
    };
  }

  async rotateAppSecret(appSlug: string): Promise<string> {
    this.requireOwnedApp(load(), appSlug);
    const secret = newAppSecret();
    const hash = await sha256Hex(secret);
    mutate((db) => {
      this.requireOwnedApp(db, appSlug);
      const creds = credentialsFor(db, appSlug);
      // The old secret stops working immediately: only the new hash is kept.
      if (creds.secretHash) creds.rotatedAt = nowIso();
      creds.secretHash = hash;
      creds.secretPrefix = secret.slice(0, SECRET_PREFIX_LENGTH);
    });
    return secret;
  }

  async setAppWebhook(appSlug: string, url: string | null): Promise<string | null> {
    this.requireOwnedApp(load(), appSlug);
    const clean = url?.trim() || null;
    if (clean) {
      const invalid = webhookUrlError(clean);
      if (invalid) throw new BackendError(invalid, "invalid");
    }
    const secret = newWebhookSecret();
    const hash = await sha256Hex(secret);
    return mutate((db) => {
      this.requireOwnedApp(db, appSlug);
      const creds = credentialsFor(db, appSlug);
      if (!clean) {
        creds.webhookUrl = null;
        creds.webhookSecretHash = null;
        return null;
      }
      // Same URL again: nothing changes and the current signing secret stays valid.
      if (creds.webhookUrl === clean && creds.webhookSecretHash) return null;
      creds.webhookUrl = clean;
      creds.webhookSecretHash = hash;
      return secret;
    });
  }

  async rotateWebhookSecret(appSlug: string): Promise<string> {
    this.requireOwnedApp(load(), appSlug);
    const secret = newWebhookSecret();
    const hash = await sha256Hex(secret);
    mutate((db) => {
      this.requireOwnedApp(db, appSlug);
      const creds = credentialsFor(db, appSlug);
      if (!creds.webhookUrl) throw new BackendError("Add a webhook URL first", "invalid");
      creds.webhookSecretHash = hash;
      creds.rotatedAt = nowIso();
    });
    return secret;
  }

  async setAppAuthority(appSlug: string, authority: AppAuthority): Promise<void> {
    if (authority !== "client" && authority !== "server") throw new BackendError("Authority is client or server", "invalid");
    mutate((db) => {
      const app = this.requireOwnedApp(db, appSlug);
      if (authority === "server") {
        if (app.scoring === "votes") throw new BackendError("Crowd-judged apps can't be server-authoritative", "invalid");
        if (!db.credentials?.[appSlug]?.secretHash) throw new BackendError("Create an app secret first", "invalid");
      }
      db.apps[appSlug] = { ...app, authority };
    });
  }

  async listWebhookDeliveries(appSlug: string): Promise<WebhookDelivery[]> {
    const db = load();
    this.requireOwnedApp(db, appSlug);
    return deliveriesFor(db, appSlug);
  }

  async sendTestWebhook(appSlug: string): Promise<void> {
    mutate((db) => {
      this.requireOwnedApp(db, appSlug);
      if (!db.credentials?.[appSlug]?.webhookUrl) throw new BackendError("Add a webhook URL first", "invalid");
      recordWebhook(db, appSlug, "ping", null);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Shipping (Stage 4): versions, testers, review, analytics, logs    */
  /* ---------------------------------------------------------------- */

  /** Mirrors the version RPCs' owner check (official apps are managed in code). */
  private requireAppOwner(db: DemoDb, appSlug: string): AppManifest {
    const viewer = this.requireViewer();
    const app = db.apps[appSlug];
    if (!app) {
      if (getOfficialApp(appSlug)) throw new BackendError("Official apps are managed in code", "forbidden");
      throw new BackendError("App not found", "not_found");
    }
    if (app.developer.id !== viewer.id) throw new BackendError("Only the app's developer can do that", "forbidden");
    return app;
  }

  /** A version the viewer owns (by id), inside a mutation. */
  private ownedVersion(db: DemoDb, versionId: string): VersionRow {
    const version = db.versions?.[versionId];
    if (!version) throw new BackendError("Version not found", "not_found");
    this.requireAppOwner(db, version.appSlug);
    return version;
  }

  /** Mirrors insight_app: the developer, or any admin (versions list, analytics, logs). */
  private requireInsight(db: DemoDb, appSlug: string): void {
    const viewer = this.requireViewer();
    if (viewer.isAdmin) {
      if (!db.apps[appSlug] && !getOfficialApp(appSlug)) throw new BackendError("App not found", "not_found");
      return;
    }
    const app = db.apps[appSlug];
    if (!app) throw new BackendError(getOfficialApp(appSlug) ? "Only the app's developer can see this" : "App not found", getOfficialApp(appSlug) ? "forbidden" : "not_found");
    if (app.developer.id !== viewer.id) throw new BackendError("Only the app's developer can see this", "forbidden");
  }

  private requireAdmin(): Profile {
    const viewer = this.requireViewer();
    if (!viewer.isAdmin) throw new BackendError("Only reviewers can do that", "forbidden");
    return viewer;
  }

  /** Apps registered before Stage 4 get their listing as a published 1.0.0 the first time it's needed. */
  private ensureVersions(db: DemoDb, appSlug: string): boolean {
    const app = db.apps[appSlug];
    if (!app || Object.values(db.versions ?? {}).some((v) => v.appSlug === appSlug)) return false;
    const at = app.createdAt;
    const version: VersionRow = {
      id: newVersionId(),
      appSlug,
      version: "1.0.0",
      url: app.url,
      manifest: manifestOf(app),
      status: app.status === "published" ? "published" : app.status === "rejected" ? "rejected" : "in_review",
      notes: "First version",
      reviewNotes: null,
      createdAt: at,
      submittedAt: at,
      reviewedAt: app.status === "published" ? at : null,
      publishedAt: app.status === "published" ? at : null,
      supersededBy: null,
      reviewedBy: null,
    };
    (db.versions ??= {})[version.id] = version;
    if (version.status === "published") (db.publishedVersions ??= {})[appSlug] = version.id;
    return true;
  }

  private versionsOf(db: DemoDb, appSlug: string): AppVersion[] {
    return sortVersions(
      Object.values(db.versions ?? {})
        .filter((v) => v.appSlug === appSlug)
        .map(publicVersion),
    );
  }

  async listAppVersions(appSlug: string): Promise<AppVersion[]> {
    this.requireInsight(load(), appSlug);
    mutateIfChanged((db) => this.ensureVersions(db, appSlug));
    return this.versionsOf(load(), appSlug);
  }

  async createAppVersion(
    appSlug: string,
    input: { version: string; url: string; manifest: VersionManifest; notes?: string },
  ): Promise<AppVersion> {
    const label = typeof input.version === "string" ? input.version.trim() : input.version;
    const labelProblem = versionLabelError(label);
    if (labelProblem) throw new BackendError(labelProblem, "invalid");
    const notes = (input.notes ?? "").trim();
    if (notes.length > VERSION_NOTES_MAX) throw new BackendError("Release notes are at most 2,000 characters", "invalid");
    return mutate((db) => {
      const app = this.requireAppOwner(db, appSlug);
      // Like create_app_version: a missing url or manifest copies the app's current one.
      const url = input.url?.trim() || app.url;
      const manifest = input.manifest ?? manifestOf(app);
      const problem = versionUrlError(url) ?? versionManifestError(manifest);
      if (problem) throw new BackendError(problem, "invalid");
      this.ensureVersions(db, appSlug);
      if (Object.values(db.versions ?? {}).filter((v) => v.appSlug === appSlug).length >= MAX_VERSIONS_PER_APP) {
        throw new BackendError(`An app can have at most ${MAX_VERSIONS_PER_APP} versions`, "rate_limited");
      }
      if (Object.values(db.versions ?? {}).some((v) => v.appSlug === appSlug && v.version === label)) {
        throw new BackendError(`Version ${label} already exists`, "conflict");
      }
      const version: VersionRow = {
        id: newVersionId(),
        appSlug,
        version: label,
        url,
        manifest: cleanManifest(manifest),
        status: "draft",
        notes,
        reviewNotes: null,
        createdAt: nowIso(),
        submittedAt: null,
        reviewedAt: null,
        publishedAt: null,
        supersededBy: null,
        reviewedBy: null,
      };
      (db.versions ??= {})[version.id] = version;
      return publicVersion(version);
    });
  }

  async updateAppVersion(versionId: string, input: { url?: string; manifest?: VersionManifest; notes?: string }): Promise<AppVersion> {
    if (input.url !== undefined) {
      const problem = versionUrlError(input.url);
      if (problem) throw new BackendError(problem, "invalid");
    }
    if (input.manifest !== undefined) {
      const problem = versionManifestError(input.manifest);
      if (problem) throw new BackendError(problem, "invalid");
    }
    if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > VERSION_NOTES_MAX)) {
      throw new BackendError("Release notes are at most 2,000 characters", "invalid");
    }
    return mutate((db) => {
      const version = this.ownedVersion(db, versionId);
      if (!EDITABLE_STATUSES.includes(version.status)) {
        throw new BackendError("Only drafts and rejected versions can be edited — create a new version", "conflict");
      }
      if (input.url !== undefined) version.url = input.url.trim();
      if (input.manifest !== undefined) version.manifest = cleanManifest(input.manifest);
      if (input.notes !== undefined) version.notes = input.notes;
      return publicVersion(version);
    });
  }

  async submitAppVersion(versionId: string): Promise<AppVersion> {
    return mutate((db) => {
      const version = this.ownedVersion(db, versionId);
      if (!EDITABLE_STATUSES.includes(version.status)) throw new BackendError("Only drafts and rejected versions can be submitted", "conflict");
      const app = db.apps[version.appSlug]!;
      authorityCheck(app, version.manifest);
      supersedeQueued(db, version);
      version.status = "in_review";
      version.submittedAt = nowIso();
      // A new app that was turned down is back in review.
      if (!db.publishedVersions?.[app.slug] && app.status === "rejected") db.apps[app.slug] = { ...app, status: "pending" };
      return publicVersion(version);
    });
  }

  async reviseAppVersion(versionId: string, input: { url?: string; manifest?: VersionManifest; notes?: string }): Promise<AppVersion> {
    if (input.url !== undefined) {
      const problem = versionUrlError(input.url);
      if (problem) throw new BackendError(problem, "invalid");
    }
    if (input.manifest !== undefined) {
      const problem = versionManifestError(input.manifest);
      if (problem) throw new BackendError(problem, "invalid");
    }
    if (input.notes !== undefined && (typeof input.notes !== "string" || input.notes.length > VERSION_NOTES_MAX)) {
      throw new BackendError("Release notes are at most 2,000 characters", "invalid");
    }
    return mutate((db) => {
      const edited = this.ownedVersion(db, versionId);
      if (edited.status !== "in_review") throw new BackendError("Only versions in review can be edited this way", "conflict");
      const siblings = Object.values(db.versions ?? {}).filter((v) => v.appSlug === edited.appSlug);
      if (siblings.length >= MAX_VERSIONS_PER_APP) {
        throw new BackendError(`An app can have at most ${MAX_VERSIONS_PER_APP} versions`, "rate_limited");
      }
      const manifest = input.manifest !== undefined ? cleanManifest(input.manifest) : structuredClone(edited.manifest);
      authorityCheck(db.apps[edited.appSlug]!, manifest);
      const now = nowIso();
      const next: VersionRow = {
        id: newVersionId(),
        appSlug: edited.appSlug,
        version: nextRevisionVersion(edited.version, siblings.map((v) => v.version)),
        url: input.url?.trim() || edited.url,
        manifest,
        status: "in_review",
        notes: input.notes ?? edited.notes,
        reviewNotes: null,
        createdAt: now,
        submittedAt: now,
        reviewedAt: null,
        publishedAt: null,
        supersededBy: null,
        reviewedBy: null,
      };
      supersedeQueued(db, next);
      db.versions![next.id] = next;
      return publicVersion(next);
    });
  }

  async withdrawAppVersion(versionId: string): Promise<AppVersion> {
    return mutate((db) => {
      const version = this.ownedVersion(db, versionId);
      if (version.status !== "in_review") throw new BackendError("Only versions in review can be withdrawn", "conflict");
      version.status = "draft";
      version.submittedAt = null;
      return publicVersion(version);
    });
  }

  async publishAppVersion(versionId: string): Promise<AppVersion> {
    return mutate((db) => {
      const version = this.ownedVersion(db, versionId);
      if (version.status !== "approved") throw new BackendError("Only approved versions can be published", "conflict");
      this.publish(db, version);
      return publicVersion(version);
    });
  }

  /** Copies the version onto the app and retires the previously published one. */
  private publish(db: DemoDb, version: VersionRow): void {
    const now = nowIso();
    const current = db.apps[version.appSlug];
    if (current) authorityCheck(current, version.manifest);
    for (const other of Object.values(db.versions ?? {})) {
      if (other.appSlug === version.appSlug && other.status === "published" && other.id !== version.id) other.status = "retired";
    }
    version.status = "published";
    version.publishedAt = now;
    (db.publishedVersions ??= {})[version.appSlug] = version.id;
    const app = db.apps[version.appSlug];
    if (app) db.apps[version.appSlug] = { ...applyVersionToApp(app, version), status: "published" };
  }

  private testersOf(db: DemoDb, appSlug: string): Profile[] {
    // In the order they were added (like app_testers_json).
    return (db.testers?.[appSlug] ?? []).map((id) => db.profiles[id]).filter((p): p is Profile => !!p);
  }

  async listAppTesters(appSlug: string): Promise<Profile[]> {
    const db = load();
    this.requireAppOwner(db, appSlug);
    return this.testersOf(db, appSlug);
  }

  async addAppTester(appSlug: string, handle: string): Promise<Profile[]> {
    const clean = cleanHandle(handle ?? "");
    return mutate((db) => {
      const app = this.requireAppOwner(db, appSlug);
      const profile = Object.values(db.profiles).find((p) => p.handle.toLowerCase() === clean);
      if (!clean || !profile || isPracticeBot(profile.id)) throw new BackendError(`@${clean || "?"} hasn't joined XApps yet`, "not_found");
      if (profile.id === app.developer.id) throw new BackendError("You can always play your own test builds", "invalid");
      const list = ((db.testers ??= {})[appSlug] ??= []);
      if (!list.includes(profile.id)) {
        if (list.length >= MAX_TESTERS_PER_APP) throw new BackendError(`An app can have at most ${MAX_TESTERS_PER_APP} testers`, "rate_limited");
        list.push(profile.id);
      }
      return this.testersOf(db, appSlug);
    });
  }

  async removeAppTester(appSlug: string, userId: string): Promise<Profile[]> {
    return mutate((db) => {
      this.requireAppOwner(db, appSlug);
      if (db.testers?.[appSlug]) db.testers[appSlug] = db.testers[appSlug].filter((id) => id !== userId);
      return this.testersOf(db, appSlug);
    });
  }

  async listReviewQueue(): Promise<ReviewItem[]> {
    this.requireAdmin();
    const db = load();
    const items: ReviewItem[] = [];
    const queue = Object.values(db.versions ?? {})
      .filter((v) => v.status === "in_review")
      .sort((a, b) => (a.submittedAt ?? a.createdAt).localeCompare(b.submittedAt ?? b.createdAt));
    /** The chain of submissions `label` replaced, newest first. */
    const replacedBy = (appSlug: string, label: string): string[] => {
      const earlier = Object.values(db.versions ?? {})
        .filter((v) => v.appSlug === appSlug && v.status === "superseded" && v.supersededBy === label)
        .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt));
      return earlier.flatMap((v) => [v.version, ...replacedBy(appSlug, v.version)]);
    };
    for (const version of queue) {
      const app = appFor(db, version.appSlug);
      if (!app) continue;
      const developer = (app.developer.id && db.profiles[app.developer.id]) || null;
      const publishedId = db.publishedVersions?.[version.appSlug];
      const published = publishedId && db.versions?.[publishedId] ? publicVersion(db.versions[publishedId]) : null;
      items.push({
        version: publicVersion(version),
        app,
        developer: developer ?? {
          id: app.developer.id ?? "unknown",
          handle: app.developer.handle,
          name: app.developer.name,
          avatarUrl: null,
          bio: "",
          xp: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          streak: 0,
          bestStreak: 0,
          createdAt: app.createdAt,
        },
        published,
        replaces: replacedBy(version.appSlug, version.version),
      });
    }
    return items;
  }

  async reviewAppVersion(versionId: string, decision: "approve" | "reject", notes: string): Promise<AppVersion> {
    const admin = this.requireAdmin();
    if (decision !== "approve" && decision !== "reject") throw new BackendError("Decide approve or reject", "invalid");
    const clean = typeof notes === "string" ? notes.trim() : "";
    if (clean.length > REVIEW_NOTES_MAX) throw new BackendError("Review notes are at most 2,000 characters", "invalid");
    if (decision === "reject" && !clean) throw new BackendError("Tell the developer what to fix", "invalid");
    return mutate((db) => {
      const version = db.versions?.[versionId];
      if (!version) throw new BackendError("Version not found", "not_found");
      if (version.status === "superseded") {
        throw new BackendError(`v${version.version} was replaced by v${version.supersededBy ?? "a newer submission"}. Review that one instead`, "conflict");
      }
      if (version.status !== "in_review") throw new BackendError("That version isn't in review", "conflict");
      version.status = decision === "approve" ? "approved" : "rejected";
      version.reviewNotes = clean || null;
      version.reviewedAt = nowIso();
      version.reviewedBy = admin.id;
      // With nothing live yet, approving publishes the version (the app goes live);
      // rejecting marks the app rejected. Either way the developer gets a notice.
      const app = db.apps[version.appSlug];
      if (!app) return publicVersion(version);
      const label = `${app.name} ${version.version}`;
      const reviewer = clean ? ` Reviewer notes: ${clean}` : "";
      const nothingLive = !db.publishedVersions?.[version.appSlug];
      if (decision === "approve" && nothingLive) {
        this.publish(db, version);
        notifyDeveloper(db, app, version, "version_published", `${label} was approved and is now live.${reviewer}`);
      } else if (decision === "approve") {
        notifyDeveloper(db, app, version, "version_approved", `${label} was approved. Publish it when you're ready.${reviewer}`);
      } else {
        if (nothingLive) db.apps[version.appSlug] = { ...app, status: "rejected" };
        notifyDeveloper(db, app, version, "version_rejected", `${label} was not approved: ${clean}`);
      }
      return publicVersion(version);
    });
  }

  async listMyNotices(limit = 50): Promise<DeveloperNotice[]> {
    const id = getViewerId();
    if (!id) throw new BackendError("Sign in to see your notices", "unauthenticated");
    const n = Math.min(200, Math.max(1, Math.floor(limit)));
    return (load().notices ?? [])
      .filter((x) => x.userId === id)
      .slice()
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, n)
      .map((x) => ({
        id: x.id,
        kind: x.kind,
        appSlug: x.appSlug,
        versionId: x.versionId,
        version: x.version,
        message: x.message,
        createdAt: x.createdAt,
        readAt: x.readAt,
      }));
  }

  async markNoticesRead(ids?: string[]): Promise<number> {
    const viewer = this.requireViewer();
    let changed = 0;
    mutateIfChanged((db) => {
      const now = nowIso();
      for (const notice of db.notices ?? []) {
        if (notice.userId !== viewer.id || notice.readAt || (ids && !ids.includes(notice.id))) continue;
        notice.readAt = now;
        changed++;
      }
      return changed > 0;
    });
    return changed;
  }

  async appAnalytics(appSlug: string, days = ANALYTICS_DAYS_DEFAULT): Promise<AppAnalytics> {
    const db = load();
    this.requireInsight(db, appSlug);
    const window = Math.floor(days ?? ANALYTICS_DAYS_DEFAULT);
    if (!Number.isFinite(window) || window < 1 || window > ANALYTICS_DAYS_MAX) {
      throw new BackendError(`Pick 1 to ${ANALYTICS_DAYS_MAX} days`, "invalid");
    }
    return computeAnalytics(db, appSlug, window);
  }

  async logAppEvent(entry: {
    appSlug: string;
    matchId: string | null;
    level: LogLevel;
    message: string;
    data?: Json;
    source: "app" | "host";
  }): Promise<void> {
    const viewer = this.requireViewer();
    if (!isLogLevel(entry.level)) throw new BackendError("Level is debug, info, warn or error", "invalid");
    const message = typeof entry.message === "string" ? entry.message.trim().slice(0, LOG_LIMITS.messageLength) : "";
    if (!message) throw new BackendError("A log message is required", "invalid");
    if (entry.source !== "app" && entry.source !== "host") throw new BackendError("Source is app or host", "invalid");
    const data = entry.data === undefined ? null : entry.data;
    if (data !== null && byteLength(data) > LOG_LIMITS.dataBytes) throw new BackendError("Log data is at most 4 KB", "invalid");
    mutateIfChanged((db) => {
      const app = appFor(db, entry.appSlug);
      if (!app) throw new BackendError("App not found", "not_found");
      let versionId: string | null = db.publishedVersions?.[entry.appSlug] ?? null;
      if (entry.matchId) {
        const row = db.matches[entry.matchId];
        if (!row || row.appSlug !== entry.appSlug) throw new BackendError("Match not found", "not_found");
        // Players and spectators of the match, or the developer/testers.
        if (!row.players.some((p) => p.userId === viewer.id) && !canTest(db, entry.appSlug, viewer.id)) {
          throw new BackendError("Not your match", "forbidden");
        }
        versionId = row.versionId ?? row.publishedVersionId ?? versionId;
      } else if (
        !canTest(db, entry.appSlug, viewer.id) &&
        // A standalone app has no matches: its viewers log outside one (like log_app_event).
        !(isStandaloneApp(app) && (app.official || app.status === "published" || app.developer.id === viewer.id))
      ) {
        throw new BackendError("Only the developer and testers can log outside a match", "forbidden");
      }
      const now = Date.now();
      const logs = pruneLogs(db.logs ?? [], now);
      // Same limit as the SDK: past it, entries are dropped silently.
      const recent = logs.filter((l) => l.appSlug === entry.appSlug && l.userId === viewer.id && now - Date.parse(l.createdAt) < 60_000);
      if (recent.length >= LOG_LIMITS.perMinute) {
        if (logs.length === (db.logs ?? []).length) return false;
        db.logs = logs;
        return true;
      }
      logs.push({
        id: `log-${randomId(12)}`,
        appSlug: entry.appSlug,
        versionId,
        matchId: entry.matchId ?? null,
        userId: viewer.id,
        level: entry.level,
        message,
        data: data === null ? null : structuredClone(data),
        source: entry.source,
        createdAt: new Date(now).toISOString(),
      });
      db.logs = pruneLogs(logs, now);
      return true;
    });
  }

  async listAppLogs(appSlug: string, filter: { level?: LogLevel; matchId?: string; before?: string; limit?: number } = {}): Promise<AppLogEntry[]> {
    const db = load();
    this.requireInsight(db, appSlug);
    if (filter.level !== undefined && !isLogLevel(filter.level)) throw new BackendError("Level is debug, info, warn or error", "invalid");
    const levels = filter.level ? new Set(levelsFrom(filter.level)) : null;
    const limit = Math.min(LOG_PAGE_MAX, Math.max(1, Math.floor(filter.limit ?? LOG_PAGE_DEFAULT)));
    return pruneLogs(db.logs ?? [])
      .filter((l) => l.appSlug === appSlug)
      .filter((l) => !levels || levels.has(l.level))
      .filter((l) => !filter.matchId || l.matchId === filter.matchId)
      .filter((l) => !filter.before || l.createdAt < filter.before)
      // Stored oldest first: reverse, then a stable sort keeps same-millisecond entries newest first.
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((l) => structuredClone(l));
  }

  /* ---------------------------------------------------------------- */
  /* People                                                           */
  /* ---------------------------------------------------------------- */

  async getProfile(handle: string): Promise<Profile | null> {
    const clean = handle.replace(/^@/, "").toLowerCase();
    return Object.values(load().profiles).find((p) => p.handle.toLowerCase() === clean) ?? null;
  }

  async searchProfiles(query: string): Promise<Profile[]> {
    const q = query.replace(/^@/, "").trim().toLowerCase();
    const viewerId = getViewerId();
    return Object.values(load().profiles)
      .filter((p) => !isPracticeBot(p.id) && p.id !== viewerId)
      .filter((p) => !q || p.handle.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 8);
  }

  async leaderboard(appSlug?: string): Promise<LeaderRow[]> {
    const db = load();
    const people = Object.values(db.profiles).filter((p) => !isPracticeBot(p.id));
    const rows = people
      .map((profile) => {
        if (!appSlug) {
          return { profile, wins: profile.wins, played: profile.wins + profile.losses + profile.draws, xp: profile.xp };
        }
        const stats = db.appStats[`${appSlug}:${profile.id}`];
        return { profile, wins: stats?.wins ?? 0, played: stats?.played ?? 0, xp: stats?.xp ?? 0 };
      })
      .filter((row) => !appSlug || row.played > 0)
      .sort((a, b) => b.xp - a.xp || b.wins - a.wins);
    return rows.slice(0, 50).map((row, i) => ({ ...row, rank: i + 1 }));
  }

  /* ---------------------------------------------------------------- */
  /* Matches                                                          */
  /* ---------------------------------------------------------------- */

  private baseMatch(app: AppManifest, mode: PlayableMode, createdBy: string, version?: VersionRow | null): MatchRow {
    const now = nowIso();
    return {
      versionId: version?.id ?? null,
      ...MATCH_V2_DEFAULTS,
      id: newMatchId(),
      appSlug: app.slug,
      mode,
      status: "pending",
      scoring: app.scoring,
      seed: randomId(16),
      createdBy,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null,
      winnerId: null,
      isOpen: false,
      settings: {},
      votes: {},
      votesNeeded: app.votesToWin ?? 5,
      votingEndsAt: null,
      simulatedVotes: false,
      players: [],
      minPlayers: app.players.min,
      maxPlayers: app.players.max,
      teams: app.teams ?? 0,
    };
  }

  /** Resolves invite handles (deduped; practice bots can't be invited, personas can; test builds: testers only). */
  private resolveInvitees(db: DemoDb, rawHandles: string[], viewerId: string, testApp?: AppManifest | null): Profile[] {
    const seen = new Set<string>();
    const out: Profile[] = [];
    for (const handle of rawHandles.map(cleanHandle)) {
      if (!handle || seen.has(handle)) continue;
      seen.add(handle);
      const profile = Object.values(db.profiles).find((p) => p.handle.toLowerCase() === handle);
      if (!profile || isPracticeBot(profile.id)) throw new BackendError(`@${handle} hasn't joined XApps yet`, "not_found");
      if (profile.id === viewerId) throw new BackendError("You can't challenge yourself", "invalid");
      if (testApp && !canTest(db, testApp.slug, profile.id)) {
        throw new BackendError(`@${profile.handle} isn't a tester of ${testApp.name}`, "forbidden");
      }
      if (!out.some((p) => p.id === profile.id)) out.push(profile);
    }
    return out;
  }

  private invite(row: MatchRow, profile: Profile): void {
    // Personas nobody is playing right now are driven by the app as bots.
    const bot = !!profile.isBot && !isHumanOnline(profile.id);
    takeSeat(row, profile.id, { state: "invited", isBot: bot });
  }

  async createChallenge(input: CreateChallengeInput): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const listed = appFor(db, input.appSlug);
      if (!listed) throw new BackendError("App not found", "not_found");
      const version = testVersionFor(db, input.appSlug, input.versionId, viewer.id);
      const app = version ? applyVersionToApp(listed, version) : listed;
      requireGame(app);
      if (!app.modes.includes(input.mode)) throw new BackendError(`${app.name} doesn't support ${input.mode} play`, "invalid");
      const { min, max } = app.players;
      const teams = app.teams ?? 0;

      const invitees = this.resolveInvitees(
        db,
        [input.opponentHandle ?? "", ...(input.opponentHandles ?? [])],
        viewer.id,
        version ? app : null,
      );
      const k = invitees.length;
      if (k > max - 1) {
        throw new BackendError(`You can invite up to ${max - 1} ${max === 2 ? "person" : "people"} to ${app.name}`, "invalid");
      }
      let size: number;
      if (typeof input.maxPlayers === "number") {
        if (!Number.isInteger(input.maxPlayers) || input.maxPlayers < min || input.maxPlayers > max) {
          throw new BackendError(`${app.name} is played by ${min} to ${max} players`, "invalid");
        }
        if (teams > 0 && input.maxPlayers % teams !== 0) {
          throw new BackendError(`Pick a table size that splits into ${teams} teams`, "invalid");
        }
        if (input.maxPlayers < k + 1) throw new BackendError("That table is too small for everyone you invited", "invalid");
        size = input.maxPlayers;
      } else if (k === 0) {
        size = max;
      } else {
        size = Math.max(k + 1, min);
        if (teams > 0) size = Math.min(max, Math.ceil(size / teams) * teams);
      }

      const row = this.baseMatch(app, input.mode, viewer.id, version);
      row.maxPlayers = size;
      row.minPlayers = Math.min(size, Math.max(min, teams));
      row.settings = challengeSettings(input.settings);
      takeSeat(row, viewer.id);
      for (const invitee of invitees) this.invite(row, invitee);
      row.isOpen = k + 1 < size;
      row.status = row.isOpen ? "open" : "pending";
      stampVersion(db, row);
      db.matches[row.id] = row;
      recordWebhook(db, row.appSlug, "match.created", row.id);
      return hydrate(db, row, viewer.id);
    });
  }

  async quickMatch(appSlug: string, versionId?: string | null): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const listed = appFor(db, appSlug);
      if (!listed) throw new BackendError("App not found", "not_found");
      const version = testVersionFor(db, appSlug, versionId, viewer.id);
      const app = version ? applyVersionToApp(listed, version) : listed;
      requireGame(app);
      // My dead lobbies go first, so a new press doesn't stack another one on top.
      expireIdleLobbies(db, Date.now(), viewer.id);
      const cutoff = Date.now() - 10 * 60_000;
      // Test builds only meet the same build.
      const quickLobbies = Object.values(db.matches)
        .filter((m) => m.appSlug === appSlug && m.status === "open" && m.settings.quick === true)
        .filter((m) => (m.versionId ?? null) === (version?.id ?? null))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const recent = quickLobbies.filter((m) => Date.parse(m.createdAt) > cutoff);

      // Already waiting in a lobby with company.
      const mine = recent.find((m) => isSeatedIn(m, viewer.id) && seatRows(m).length >= 2);
      if (mine) return hydrate(db, mine, viewer.id);

      // Join someone else's lobby with a free seat.
      const waiting = recent.find(
        (m) => m.isOpen && !m.players.some((p) => p.userId === viewer.id) && seatRows(m).length < m.maxPlayers,
      );
      if (waiting) {
        // My own empty lobby is no longer needed.
        for (const m of quickLobbies) {
          if (m.createdBy === viewer.id && seatRows(m).length < 2) {
            m.status = "cancelled";
            m.updatedAt = nowIso();
          }
        }
        takeSeat(waiting, viewer.id);
        if (seatRows(waiting).length >= waiting.maxPlayers) waiting.isOpen = false;
        tryActivate(db, waiting);
        waiting.updatedAt = nowIso();
        return hydrate(db, waiting, viewer.id);
      }

      const own = recent.find((m) => m.createdBy === viewer.id);
      if (own) return hydrate(db, own, viewer.id);

      const row = this.baseMatch(app, app.modes.includes("live") ? "live" : "async", viewer.id, version);
      row.minPlayers = Math.min(app.players.max, Math.max(app.players.min, app.teams ?? 0));
      takeSeat(row, viewer.id);
      row.status = "open";
      row.isOpen = true;
      row.settings = { quick: true };
      stampVersion(db, row);
      db.matches[row.id] = row;
      recordWebhook(db, row.appSlug, "match.created", row.id);
      return hydrate(db, row, viewer.id);
    });
  }

  async startPractice(appSlug: string, players?: number, versionId?: string | null): Promise<Match> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const listed = appFor(db, appSlug);
      if (!listed) throw new BackendError("App not found", "not_found");
      const version = testVersionFor(db, appSlug, versionId, viewer.id);
      const app = version ? applyVersionToApp(listed, version) : listed;
      requireGame(app);
      const teams = app.teams ?? 0;
      const seats = players ?? Math.min(app.players.max, Math.max(app.players.min, teams));
      if (!Number.isInteger(seats) || seats < app.players.min || seats > app.players.max || seats < teams) {
        throw new BackendError(`${app.name} is played by ${app.players.min} to ${app.players.max} players`, "invalid");
      }
      const row = this.baseMatch(app, "practice", viewer.id, version);
      row.maxPlayers = seats;
      row.minPlayers = Math.min(seats, Math.max(app.players.min, teams));
      takeSeat(row, viewer.id);
      // One distinct practice bot per extra seat.
      for (const bot of PRACTICE_BOTS.slice(0, seats - 1)) takeSeat(row, bot.id, { isBot: true });
      row.simulatedVotes = app.scoring === "votes";
      row.votesNeeded = 5;
      recordWebhook(db, row.appSlug, "match.created", row.id);
      activate(db, row);
      stampVersion(db, row);
      db.matches[row.id] = row;
      return hydrate(db, row, viewer.id);
    });
  }

  private withMatch(matchId: string, fn: (db: DemoDb, row: MatchRow, viewerId: string | null) => void): Match {
    return mutate((db) => {
      const row = db.matches[matchId];
      const viewerId = getViewerId();
      // Someone else's practice match doesn't exist as far as you're concerned.
      if (!row || (row.mode === "practice" && row.createdBy !== viewerId) || hiddenFrom(db, row, viewerId)) {
        throw new BackendError("Match not found", "not_found");
      }
      fn(db, row, viewerId);
      row.updatedAt = nowIso();
      return hydrate(db, row, viewerId);
    });
  }

  /** The viewer's seat in the match, joined or submitted; spectators and leavers are refused. */
  private requirePlayer(row: MatchRow, viewerId: string, what: string): PlayerRow {
    const me = row.players.find((p) => p.userId === viewerId);
    if (!me || me.role !== "player" || (me.state !== "joined" && me.state !== "submitted")) {
      throw new BackendError(me?.role === "spectator" ? `Spectators can't ${what}` : `Only seated players can ${what}`, "forbidden");
    }
    return me;
  }

  async joinMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      const me = row.players.find((p) => p.userId === viewer.id);
      const asyncRunning = row.status === "active" && row.mode === "async";
      if (me?.role === "player") {
        // Accepting an invite keeps your seat.
        if (me.state === "invited") {
          if (!isLobby(row) && !asyncRunning) throw new BackendError("This challenge is no longer open", "conflict");
          me.state = "joined";
        }
      } else if (row.versionId && !canTest(db, row.appSlug, viewer.id)) {
        throw new BackendError("Only the developer and testers can join a test build", "forbidden");
      } else if (
        row.isOpen &&
        row.mode !== "practice" &&
        (row.status === "open" || asyncRunning) &&
        seatRows(row).length < row.maxPlayers
      ) {
        // Open seats of a lobby (or a running async match); a spectator sits down.
        if (me) row.players = row.players.filter((p) => p !== me);
        takeSeat(row, viewer.id);
        if (seatRows(row).length >= row.maxPlayers) row.isOpen = false;
      } else {
        throw new BackendError("This challenge is no longer open", "conflict");
      }
      tryActivate(db, row);
    });
  }

  async startMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.createdBy !== viewer.id) throw new BackendError("Only the challenger can start the match", "forbidden");
      if (!isLobby(row)) throw new BackendError("This match has already started", "conflict");
      if (inRows(row).length < row.minPlayers) throw new BackendError(`Waiting for at least ${row.minPlayers} players`, "conflict");
      if (!teamsReady(row)) throw new BackendError("Every team needs at least one player", "conflict");
      // Unanswered invites are withdrawn and the remaining seats close.
      row.players = row.players.filter((p) => !(p.role === "player" && p.state === "invited"));
      row.isOpen = false;
      activate(db, row);
    });
  }

  async spectate(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.players.some((p) => p.userId === viewer.id)) return; // already seated or watching
      if (row.mode === "practice") throw new BackendError("Practice matches can't be watched", "forbidden");
      if (row.versionId && !canTest(db, row.appSlug, viewer.id)) {
        throw new BackendError("Only the developer and testers can watch a test build", "forbidden");
      }
      const app = appForRow(db, row);
      if (!app || app.spectators === false) throw new BackendError("This app doesn't allow spectators", "forbidden");
      if (!["open", "pending", "active", "voting"].includes(row.status)) throw new BackendError("This match is over", "conflict");
      row.players.push(newPlayerRow(viewer.id, null, { role: "spectator" }));
    });
  }

  async inviteToMatch(matchId: string, handles: string[]): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.mode === "practice") throw new BackendError("Practice matches are solo", "invalid");
      this.requirePlayer(row, viewer.id, "invite people");
      if (!isLobby(row) && !(row.status === "active" && row.mode === "async")) {
        throw new BackendError("This match isn't taking new players", "conflict");
      }
      const invitees = this.resolveInvitees(db, handles, viewer.id, row.versionId ? appForRow(db, row) : null).filter(
        (p) => !row.players.some((x) => x.userId === p.id && x.role === "player"),
      );
      const free = freeSeatList(row).length;
      if (invitees.length > free) {
        throw new BackendError(free ? `Only ${free} ${free === 1 ? "seat is" : "seats are"} left` : "This table is full", "invalid");
      }
      for (const invitee of invitees) {
        row.players = row.players.filter((p) => p.userId !== invitee.id); // a spectator gets a seat
        this.invite(row, invitee);
      }
      if (freeSeatList(row).length === 0) {
        row.isOpen = false;
        if (row.status === "open") row.status = "pending";
      }
      tryActivate(db, row);
    });
  }

  async updateState(matchId: string, state: Json, expectedVersion: number): Promise<{ version: number; match: Match }> {
    const viewer = this.requireViewer();
    if (state === undefined) throw new BackendError("State must be JSON", "invalid");
    let version = 0;
    const match = this.withMatch(matchId, (_db, row) => {
      this.requirePlayer(row, viewer.id, "change the match state");
      if (row.status !== "active") throw new BackendError("This match isn't running", "conflict");
      if (state !== null && byteLength(state) > LIMITS.matchStateBytes) {
        throw new BackendError("Match state is too large (max 64 KB)", "invalid");
      }
      if (row.stateVersion !== expectedVersion) throw new BackendError("state_conflict", "conflict");
      row.state = structuredClone(state);
      row.stateVersion += 1;
      version = row.stateVersion;
    });
    return { version, match };
  }

  async endTurn(matchId: string, next?: string | null): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      this.requirePlayer(row, viewer.id, "pass the turn");
      if (row.status !== "active") throw new BackendError("This match isn't running", "conflict");
      if (row.turnUserId && row.turnUserId !== viewer.id) {
        // The app drives bots, so the human may pass a bot's turn. (SQL limits this to
        // practice; demo personas play as bots in real matches too.)
        const holder = row.players.find((p) => p.userId === row.turnUserId);
        if (!holder?.isBot) throw new BackendError("It's not your turn", "forbidden");
      }
      if (next) {
        if (!inRows(row).some((p) => p.userId === next)) {
          throw new BackendError("The next turn must go to a seated player", "invalid");
        }
        setTurn(row, next);
      } else {
        setTurn(row, nextTurnAfter(row, row.turnUserId ?? viewer.id));
      }
      recordWebhook(db, row.appSlug, "match.turn", row.id);
    });
  }

  async setRound(matchId: string, round: number): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (_db, row) => {
      this.requirePlayer(row, viewer.id, "set the round");
      if (row.status !== "active") throw new BackendError("This match isn't running", "conflict");
      if (!Number.isInteger(round) || round < row.round || round > 1_000_000) {
        throw new BackendError("Rounds only go forward", "invalid");
      }
      row.round = round;
    });
  }

  async declineMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      const me = row.players.find((p) => p.userId === viewer.id && p.role === "player");
      if (!me || me.state !== "invited") throw new BackendError("Nothing to decline", "invalid");
      if (row.maxPlayers <= 2) {
        // 1v1: declining ends the challenge (v1).
        me.state = "declined";
        row.status = "declined";
        return;
      }
      // Multiplayer: the invite is withdrawn and the seat frees up.
      row.players = row.players.filter((p) => p !== me);
      if (isLobby(row)) {
        if (!row.isOpen && seatRows(row).length < row.minPlayers) {
          row.status = "declined";
          return;
        }
        tryActivate(db, row);
      } else {
        maybeSettle(db, row);
      }
    });
  }

  async cancelMatch(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (_db, row) => {
      if (row.createdBy !== viewer.id) throw new BackendError("Only the challenger can cancel", "forbidden");
      if (!isLobby(row)) throw new BackendError("Too late to cancel", "conflict");
      row.status = "cancelled";
    });
  }

  async getMatch(matchId: string): Promise<Match | null> {
    const db = load();
    const row = db.matches[matchId];
    return row && !hiddenFrom(db, row, getViewerId()) ? hydrate(db, row) : null;
  }

  async markStarted(matchId: string): Promise<Match> {
    return this.withMatch(matchId, (_db, row) => {
      row.startedAt = row.startedAt ?? nowIso();
    });
  }

  async heartbeat(matchId: string): Promise<void> {
    const id = getViewerId();
    if (!id) return;
    markHuman(id);
    mutate((db) => {
      const p = db.matches[matchId]?.players.find((x) => x.userId === id);
      if (p) p.lastSeenAt = nowIso();
    });
  }

  async claimForfeit(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.status !== "active" || !row.startedAt) throw new BackendError("Match isn't running", "conflict");
      if (!inRows(row).some((p) => p.userId === viewer.id)) throw new BackendError("Not your match", "forbidden");
      const quietFor = row.mode === "async" ? TURN_TIMEOUT_MS : CLAIM_AFTER_MS;
      const startedAt = Date.parse(row.startedAt);
      const lastSeen = (p: PlayerRow) => (p.lastSeenAt ? Date.parse(p.lastSeenAt) : startedAt);
      const others = seatRows(row).filter((p) => p.userId !== viewer.id && !p.isBot && p.state === "joined");
      const quiet = others
        .filter((p) => lastSeen(p) <= Date.now() - quietFor)
        .sort((a, b) => lastSeen(a) - lastSeen(b) || (a.seat ?? 0) - (b.seat ?? 0))[0];
      if (!quiet) {
        if (others.length) throw new BackendError("Your opponent is still connected", "conflict");
        throw new BackendError("No opponent to claim against", "invalid");
      }
      quiet.state = "left";
      afterLeave(db, row, quiet.userId);
    });
  }

  async forfeit(matchId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (!["active", "pending", "open"].includes(row.status)) throw new BackendError("Match already over", "conflict");
      const me = row.players.find((p) => p.userId === viewer.id);
      if (!me) throw new BackendError("Not your match", "forbidden");
      if (me.role === "spectator") {
        // Spectators just stop watching.
        row.players = row.players.filter((p) => p !== me);
        return;
      }
      if (seatRows(row).length < 2) {
        row.status = "cancelled";
        return;
      }
      if (row.maxPlayers <= 2 || row.mode === "practice") {
        // 1v1 and practice: the other side wins, as in v1.
        applySettlement(db, row, viewer.id);
        return;
      }
      if (isLobby(row)) {
        if (row.createdBy === viewer.id) {
          row.status = "cancelled";
          return;
        }
        // Leaving a lobby frees your seat.
        row.players = row.players.filter((p) => p !== me);
        row.isOpen = row.isOpen || row.status === "open";
        if (!row.isOpen && seatRows(row).length < row.minPlayers) {
          row.status = "cancelled";
          return;
        }
        tryActivate(db, row);
        return;
      }
      me.state = "left";
      afterLeave(db, row, me.userId);
    });
  }

  async submit(matchId: string, input: SubmitInput): Promise<Match> {
    const viewer = this.requireViewer();
    const targetId = input.playerId ?? viewer.id;
    const match = this.applySubmit(matchId, input, viewer.id);
    // Tabs share one localStorage document, and Chromium syncs it between tabs asynchronously: when two
    // players submit within a few milliseconds, each tab can start from a copy without the other's entry
    // and the later write erases the earlier one. Check again shortly after and re-apply a lost entry.
    for (const delay of LOST_WRITE_CHECKS_MS) {
      setTimeout(() => {
        if (getViewerId() !== viewer.id) return;
        const row = load().matches[matchId];
        const target = row?.players.find((p) => p.userId === targetId);
        if (!row || !target || target.state !== "joined" || !["active", "open", "pending"].includes(row.status)) return;
        try {
          this.applySubmit(matchId, input, viewer.id);
        } catch {
          // Decided or changed meanwhile: nothing to repair.
        }
      }, delay);
    }
    return match;
  }

  private applySubmit(matchId: string, input: SubmitInput, viewerId: string): Match {
    const viewer = { id: viewerId };
    return this.withMatch(matchId, (db, row) => {
      const me = row.players.find((p) => p.userId === viewer.id);
      if (!me) throw new BackendError("Not in this match", "forbidden");
      if (me.role !== "player") throw new BackendError("Spectators can't submit", "forbidden");
      const targetId = input.playerId ?? viewer.id;
      const target = row.players.find((p) => p.userId === targetId);
      if (!target || target.role !== "player") throw new BackendError("Not in this match", "forbidden");
      if (targetId !== viewer.id && !target.isBot) throw new BackendError("You can only submit for yourself or a bot", "forbidden");
      if (!["active", "open", "pending"].includes(row.status)) throw new BackendError("This match is already decided", "conflict");
      if (isLobby(row) && row.mode !== "async") throw new BackendError("This match hasn't started", "conflict");
      if (target.state === "submitted") throw new BackendError("Already submitted", "conflict");
      if (["left", "declined"].includes(target.state) || ["left", "declined"].includes(me.state)) {
        throw new BackendError("You're out of this match", "conflict");
      }
      if (row.scoring !== "votes" && typeof input.score !== "number") {
        throw new BackendError("A score is required", "invalid");
      }
      if (typeof input.score === "number" && (Number.isNaN(input.score) || Math.abs(input.score) > 1e9)) {
        throw new BackendError("Invalid score", "invalid");
      }
      // Demo uploads live on /api/demo-media, whatever the environment says.
      const mediaError = displayProblem(input.display, { demo: true });
      if (mediaError) throw new BackendError(mediaError, "invalid");
      target.state = "submitted";
      target.score = typeof input.score === "number" ? input.score : null;
      target.submission = { data: input.data, display: input.display };
      target.lastSeenAt = nowIso();
      recordWebhook(db, row.appSlug, "match.submitted", row.id);
      // An invitee playing an async match counts as having joined.
      tryActivate(db, row);
      maybeSettle(db, row);
    });
  }

  async vote(matchId: string, choiceUserId: string): Promise<Match> {
    const viewer = this.requireViewer();
    return this.withMatch(matchId, (db, row) => {
      if (row.status !== "voting" || row.mode === "practice") throw new BackendError("Voting is closed", "conflict");
      if (isSeatedIn(row, viewer.id)) throw new BackendError("You can't judge your own match", "forbidden");
      if (row.versionId && !canTest(db, row.appSlug, viewer.id)) throw new BackendError("Voting is closed", "forbidden");
      if (!seatRows(row).some((p) => p.userId === choiceUserId && p.state === "submitted")) {
        throw new BackendError("Invalid choice", "invalid");
      }
      if (db.votes.some((v) => v.matchId === matchId && v.voterId === viewer.id)) {
        throw new BackendError("You already voted", "conflict");
      }
      db.votes.push({ matchId, voterId: viewer.id, choiceId: choiceUserId, at: nowIso() });
      row.votes[choiceUserId] = (row.votes[choiceUserId] ?? 0) + 1;
      const me = db.profiles[viewer.id];
      if (me && !row.versionId) me.xp += XP.vote;
      if ((row.votes[choiceUserId] ?? 0) >= row.votesNeeded) applySettlement(db, row);
    });
  }

  async listMyMatches(): Promise<Match[]> {
    const id = getViewerId();
    if (!id) return [];
    mutateIfChanged((draft) => expireIdleLobbies(draft, Date.now(), id));
    const db = load();
    return Object.values(db.matches)
      .filter((m) => isSeatedIn(m, id))
      .sort(byRecent)
      .slice(0, 60)
      .map((m) => hydrate(db, m, id));
  }

  async listVotingMatches(): Promise<Match[]> {
    const id = getViewerId();
    const db = load();
    const voted = new Set(db.votes.filter((v) => v.voterId === id).map((v) => v.matchId));
    return Object.values(db.matches)
      .filter((m) => m.status === "voting" && m.mode !== "practice" && !m.versionId && !voted.has(m.id))
      .filter((m) => !id || !isSeatedIn(m, id))
      .sort(byRecent)
      .map((m) => hydrate(db, m, id));
  }

  async listRecentActivity(): Promise<Match[]> {
    const db = load();
    return Object.values(db.matches)
      .filter(
        (m) =>
          m.mode !== "practice" &&
          !m.versionId &&
          ["completed", "voting", "active"].includes(m.status) &&
          seatRows(m).filter((p) => p.state !== "declined" && p.state !== "invited").length >= 2,
      )
      .sort(byRecent)
      .slice(0, 30)
      .map((m) => hydrate(db, m));
  }

  async listUserMatches(userId: string): Promise<Match[]> {
    const db = load();
    return Object.values(db.matches)
      .filter((m) => m.mode !== "practice" && !m.versionId && isSeatedIn(m, userId))
      .filter((m) => ["completed", "voting", "active"].includes(m.status))
      .sort(byRecent)
      .slice(0, 20)
      .map((m) => hydrate(db, m));
  }

  /* ---------------------------------------------------------------- */
  /* Realtime                                                         */
  /* ---------------------------------------------------------------- */

  watchMatch(matchId: string, handler: (match: Match) => void): () => void {
    let last = "";
    const check = () => {
      const db = load();
      const row = db.matches[matchId];
      if (!row) return;
      const signature = JSON.stringify(row);
      if (signature === last) return;
      last = signature;
      handler(hydrate(db, row));
    };
    check();
    return subscribe(check);
  }

  watchInbox(handler: () => void): () => void {
    return subscribe(handler);
  }

  openRoom(matchId: string, viewerId: string): RoomTransport {
    return createDemoRoom(matchId, viewerId);
  }

  /* ---------------------------------------------------------------- */
  /* Storage                                                          */
  /* ---------------------------------------------------------------- */

  /** Mirrors `playable_app`: the app must exist (official, published, or the viewer's own). */
  private requireApp(db: DemoDb, appSlug: string): AppManifest {
    const app = appFor(db, appSlug);
    if (!app || (!app.official && app.status !== "published" && app.developer.id !== getViewerId())) {
      throw new BackendError("App not found", "not_found");
    }
    return app;
  }

  async storageGet(appSlug: string, key: string, scope: StorageScope = "user"): Promise<Json | null> {
    const userId = this.storageScopeUser(scope);
    storageKeyCheck(key);
    const db = load();
    this.requireApp(db, appSlug);
    const value = userId ? db.storage[`${appSlug}:${userId}:${key}`] : db.appStorage?.[`${appSlug}:${key}`];
    return value ?? null;
  }

  async storageSet(appSlug: string, key: string, value: Json): Promise<void> {
    const viewer = this.requireViewer();
    storageKeyCheck(key);
    if (value === undefined || value === null) throw new BackendError("A value is required (use delete to remove a key)", "invalid");
    if (byteLength(value) > LIMITS.storageValueBytes) throw new BackendError("Storage values are limited to 64 KB", "invalid");
    mutate((db) => {
      this.requireApp(db, appSlug);
      const prefix = `${appSlug}:${viewer.id}:`;
      const id = prefix + key;
      if (!(id in db.storage)) {
        const count = Object.keys(db.storage).filter((k) => k.startsWith(prefix)).length;
        if (count >= LIMITS.storageKeysPerUser) {
          throw new BackendError(`Storage is full (${LIMITS.storageKeysPerUser} keys)`, "conflict");
        }
      }
      db.storage[id] = structuredClone(value);
    });
  }

  async storageDelete(appSlug: string, key: string): Promise<void> {
    const viewer = this.requireViewer();
    storageKeyCheck(key);
    mutate((db) => {
      this.requireApp(db, appSlug);
      delete db.storage[`${appSlug}:${viewer.id}:${key}`];
    });
  }

  async storageList(appSlug: string, prefix?: string, scope: StorageScope = "user"): Promise<string[]> {
    const userId = this.storageScopeUser(scope);
    if (prefix !== undefined && (typeof prefix !== "string" || prefix.length > LIMITS.storageKeyLength)) {
      throw new BackendError(`Prefixes are at most ${LIMITS.storageKeyLength} characters`, "invalid");
    }
    const db = load();
    this.requireApp(db, appSlug);
    const base = userId ? `${appSlug}:${userId}:` : `${appSlug}:`;
    const source = userId ? db.storage : (db.appStorage ?? {});
    return Object.keys(source)
      .filter((k) => k.startsWith(base))
      .map((k) => k.slice(base.length))
      .filter((k) => !prefix || k.startsWith(prefix))
      .sort();
  }

  /** Mirrors `storage_scope_user`: user scope needs a signed-in viewer, app scope is public. */
  private storageScopeUser(scope: StorageScope): string | null {
    if (scope !== "user" && scope !== "app") throw new BackendError("Storage scope is user or app", "invalid");
    return scope === "app" ? null : this.requireViewer().id;
  }

  /* ---------------------------------------------------------------- */
  /* Media, stats & achievements (Stage 3)                            */
  /* ---------------------------------------------------------------- */

  async uploadMedia(appSlug: string, file: Blob): Promise<MediaRef> {
    const viewer = this.requireViewer();
    this.requireApp(load(), appSlug);
    if (!isBlobLike(file)) throw new BackendError("Upload a file", "invalid");
    const problem = mediaProblem(file.type, file.size);
    if (problem) throw new BackendError(problem, "invalid");
    const kind = mediaKindOf(file.type)!;
    const since = Date.now() - 86_400_000;
    const recent = (load().mediaUploads ?? []).filter(
      (u) => u.appSlug === appSlug && u.userId === viewer.id && Date.parse(u.createdAt) > since,
    );
    const quota = mediaQuotaProblem(recent, file.size);
    if (quota) throw new BackendError(quota, "rate_limited");

    const [stored, meta] = await Promise.all([
      postDemoMedia(file).catch((error: unknown) => {
        throw new BackendError(error instanceof Error ? error.message : "Upload failed", "invalid");
      }),
      probeMedia(file, kind),
    ]);
    const url = absoluteMediaUrl(stored.url);
    const mime = file.type.split(";")[0]!.trim().toLowerCase();
    mutate((db) => {
      const keep = (db.mediaUploads ?? []).filter((u) => Date.parse(u.createdAt) > since);
      keep.push({ appSlug, userId: viewer.id, url, bytes: file.size, mime, createdAt: nowIso() });
      db.mediaUploads = keep;
    });
    return { url, kind, mime, bytes: file.size, ...meta };
  }

  async uploadAppImage(file: Blob, kind: AppImageKind): Promise<string> {
    this.requireViewer();
    if (!isBlobLike(file)) throw new BackendError("Upload an image", "invalid");
    if (!/^image\/(webp|jpeg|png)$/.test(file.type)) throw new BackendError("Images are uploaded as WebP, JPEG or PNG", "invalid");
    // Demo images live in the demo database itself (as data URLs), so they outlast the dev server.
    const key = await blobToDataUrl(file);
    if (appImageKeyError(key, { demo: true })) throw new BackendError(`That ${kind} is too large for demo mode`, "invalid");
    return key;
  }

  /** Mirrors `report_stats` / `apply_stats`. */
  async reportStats(appSlug: string, values: { [key: string]: number }): Promise<{ [key: string]: number }> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const app = this.requireApp(db, appSlug);
      if (app.authority === "server") throw new BackendError(`${app.name} reports stats from its server`, "forbidden");
      return applyStats(db, app, viewer.id, values);
    });
  }

  /** Mirrors `app_stat_leaderboard`: best first (min ascending), ties share a rank, earlier holders first. */
  async statLeaderboard(appSlug: string, key: string): Promise<StatLeaderRow[]> {
    const db = load();
    const board = this.statBoard(db, appSlug, key);
    return rankBoard(db, board.rows, 50);
  }

  /**
   * Mirrors `app_stat_standing`: the leaderboard's first `limit` rows (default 10, clamped to 1–50),
   * the viewer's rank (1 + everyone strictly ahead, so ties share it) and value, and the total.
   */
  async statStanding(appSlug: string, key: string, limit?: number): Promise<StatStanding> {
    const db = load();
    const { def, rows } = this.statBoard(db, appSlug, key);
    const viewerId = getViewerId();
    const mine = viewerId ? rows.find((r) => r.userId === viewerId) : undefined;
    const me = mine
      ? {
          rank: 1 + rows.filter((r) => (def.aggregate === "min" ? r.value < mine.value : r.value > mine.value)).length,
          value: mine.value,
        }
      : null;
    const n = Math.min(Math.max(Math.floor(Number.isFinite(limit) ? (limit as number) : 10), 1), 50);
    return { key, top: rankBoard(db, rows, n), me, total: rows.length };
  }

  /** A declared stat's values (people only, bots excluded), best first, earlier holders first. */
  private statBoard(db: DemoDb, appSlug: string, key: string) {
    const app = this.requireApp(db, appSlug);
    const def = app.stats?.find((s) => s.key === key);
    if (!def) throw new BackendError(`Unknown stat ${key}`, "invalid");
    const prefix = `${appSlug}:`;
    const suffix = `:${key}`;
    const rows = Object.entries(db.userStats ?? {})
      .filter(([k]) => k.startsWith(prefix) && k.endsWith(suffix))
      .map(([k, row]) => ({ userId: k.slice(prefix.length, -suffix.length), ...row }))
      .filter((r) => db.profiles[r.userId] && !isPracticeBot(r.userId));
    const better = (a: number, b: number) => (def.aggregate === "min" ? a - b : b - a);
    rows.sort((a, b) => better(a.value, b.value) || a.updatedAt.localeCompare(b.updatedAt) || a.userId.localeCompare(b.userId));
    return { def, rows };
  }

  /** Mirrors `user_stats`: declared stats of apps the viewer can see, by app then manifest order. */
  async userStats(userId: string): Promise<UserStat[]> {
    const db = load();
    const out: UserStat[] = [];
    for (const [k, row] of Object.entries(db.userStats ?? {})) {
      const [appSlug, user, key] = k.split(":");
      if (user !== userId || !appSlug || !key) continue;
      const app = this.visibleApp(db, appSlug);
      if (!app?.stats?.some((s) => s.key === key)) continue;
      out.push({ appSlug, key, value: row.value, updatedAt: row.updatedAt });
    }
    const order = (s: UserStat) => this.visibleApp(db, s.appSlug)?.stats?.findIndex((d) => d.key === s.key) ?? 0;
    return out.sort((a, b) => a.appSlug.localeCompare(b.appSlug) || order(a) - order(b));
  }

  /** Mirrors `unlock_achievement` / `grant_achievement`: once per player; the XP is added once. */
  async unlockAchievement(appSlug: string, id: string): Promise<{ unlocked: boolean }> {
    const viewer = this.requireViewer();
    return mutate((db) => {
      const app = this.requireApp(db, appSlug);
      if (app.authority === "server") throw new BackendError(`${app.name} unlocks achievements from its server`, "forbidden");
      return grantAchievement(db, app, viewer.id, id);
    });
  }

  /** Mirrors `list_user_achievements`: newest first, declared achievements of visible apps only. */
  async userAchievements(userId: string): Promise<UserAchievement[]> {
    const db = load();
    const out: UserAchievement[] = [];
    for (const [k, unlockedAt] of Object.entries(db.achievements ?? {})) {
      const [appSlug, user, achievementId] = k.split(":");
      if (user !== userId || !appSlug || !achievementId) continue;
      if (!this.visibleApp(db, appSlug)?.achievements?.some((a) => a.id === achievementId)) continue;
      out.push({ appSlug, achievementId, unlockedAt });
    }
    return out.sort(
      (a, b) => b.unlockedAt.localeCompare(a.unlockedAt) || a.appSlug.localeCompare(b.appSlug) || a.achievementId.localeCompare(b.achievementId),
    );
  }

  private visibleApp(db: DemoDb, appSlug: string): AppManifest | null {
    const app = appFor(db, appSlug);
    if (!app) return null;
    return app.official || app.status === "published" || app.developer.id === getViewerId() ? app : null;
  }

  /* ---------------------------------------------------------------- */
  /* Simulation: bots accept invites, fill lobbies and the crowd votes  */
  /* ---------------------------------------------------------------- */

  private isSimLeader(): boolean {
    try {
      const raw = localStorage.getItem(SIM_LEADER_KEY);
      const leader = raw ? (JSON.parse(raw) as { tab: string; at: number }) : null;
      if (!leader || leader.tab === TAB_ID || Date.now() - leader.at > 4_000) {
        localStorage.setItem(SIM_LEADER_KEY, JSON.stringify({ tab: TAB_ID, at: Date.now() }));
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /** One step of the simulated world. Runs on a timer in the leader tab (public for tests). */
  tick(): void {
    const viewerId = getViewerId();
    if (viewerId) markHuman(viewerId);
    if (!this.isSimLeader()) return;

    const now = Date.now();
    mutateIfChanged((draft) => {
      let changed = false;
      const personas = Object.values(draft.profiles).filter((p) => p.isBot && !isPracticeBot(p.id));
      const humanInvolved = (row: MatchRow) =>
        seatRows(row).some((p) => !p.isBot || isHumanOnline(p.userId));

      for (const row of Object.values(draft.matches)) {
        const age = now - Date.parse(row.createdAt);

        // Bots accept invites after a short, human-feeling pause (one per table per tick).
        const asyncRunning = row.status === "active" && row.mode === "async";
        if ((isLobby(row) || asyncRunning) && age > 1_800) {
          const invitedBot = seatRows(row).find((p) => p.isBot && p.state === "invited");
          if (invitedBot) {
            invitedBot.state = "joined";
            tryActivate(draft, row);
            row.updatedAt = nowIso();
            changed = true;
          }
        }

        // Nobody picked up the quick-match lobby — personas hop in until it's full.
        if (
          row.status === "open" &&
          row.settings.quick === true &&
          row.isOpen &&
          age > 5_000 &&
          seatRows(row).length < row.maxPlayers
        ) {
          const firstGuest = seatRows(row).length === 1;
          if (firstGuest || Math.random() < 0.5) {
            const taken = new Set(row.players.map((p) => p.userId));
            const candidates = personas.filter(
              (p) => !taken.has(p.id) && !isHumanOnline(p.id) && (!row.versionId || canTest(draft, row.appSlug, p.id)),
            );
            const bot = candidates[Math.floor(Math.random() * candidates.length)];
            if (bot) {
              takeSeat(row, bot.id, { isBot: true });
              if (seatRows(row).length >= row.maxPlayers) row.isOpen = false;
              tryActivate(draft, row);
              row.updatedAt = nowIso();
              changed = true;
            }
          }
        }

        // An async turn past its deadline forfeits the turn holder (finalize_due_matches).
        if (expireTurn(draft, row, now)) {
          row.updatedAt = nowIso();
          changed = true;
        }

        // Invites nobody answered within a week stop holding up a running async match.
        if (asyncRunning && age > 7 * 86_400_000 && seatRows(row).some((p) => p.state === "invited")) {
          row.players = row.players.filter((p) => !(p.role === "player" && p.state === "invited"));
          maybeSettle(draft, row);
          row.updatedAt = nowIso();
          changed = true;
        }

        if (row.status !== "voting") continue;
        // The crowd trickles in: fast for your matches, slow for background ones.
        const deadlinePassed = row.votingEndsAt ? Date.parse(row.votingEndsAt) < now : false;
        const pace = row.mode === "practice" || row.simulatedVotes ? 0.7 : humanInvolved(row) ? 0.4 : 0.015;
        if (Math.random() < pace) {
          const already = new Set(draft.votes.filter((v) => v.matchId === row.id).map((v) => v.voterId));
          const voters = personas.filter(
            (p) =>
              !already.has(p.id) &&
              !row.players.some((pl) => pl.userId === p.id) &&
              !isHumanOnline(p.id) &&
              // Only testers judge test builds.
              (!row.versionId || canTest(draft, row.appSlug, p.id)),
          );
          const voter = voters[Math.floor(Math.random() * voters.length)];
          const entries = seatRows(row).filter((p) => p.state === "submitted");
          if (voter && entries.length) {
            // Slight preference for the longer, more effortful entry.
            const weight = (p: PlayerRow) => 1 + Math.min(1, JSON.stringify(p.submission ?? "").length / 2_000);
            const total = entries.reduce((sum, p) => sum + weight(p), 0);
            let roll = Math.random() * total;
            const choice = entries.find((p) => (roll -= weight(p)) < 0) ?? entries[entries.length - 1]!;
            draft.votes.push({ matchId: row.id, voterId: voter.id, choiceId: choice.userId, at: nowIso() });
            row.votes[choice.userId] = (row.votes[choice.userId] ?? 0) + 1;
            row.updatedAt = nowIso();
            changed = true;
            if ((row.votes[choice.userId] ?? 0) >= row.votesNeeded) applySettlement(draft, row);
          }
        }
        if (row.status === "voting" && deadlinePassed) {
          applySettlement(draft, row);
          changed = true;
        }
      }

      // Keep the Arena stocked with fresh persona contests.
      const background = Object.values(draft.matches).filter(
        (m) => m.status === "voting" && !seatRows(m).some((p) => !p.isBot),
      ).length;
      if (background < 4) {
        const rng = createRandom(randomId(8));
        addPersonaContest(draft, rng, 0, true);
        changed = true;
      }

      // Once per session, a persona challenges the newcomer so invites can be seen live.
      if (viewerId && now - SESSION_START > 25_000 && !sessionStorage.getItem(INVITED_KEY)) {
        const viewer = draft.profiles[viewerId];
        const busy = Object.values(draft.matches).some(
          (m) => isLobby(m) && m.players.some((p) => p.userId === viewerId && p.state === "invited"),
        );
        const challenger = personas.find((p) => p.id !== viewerId && !isHumanOnline(p.id));
        if (viewer && !viewer.isBot && !busy && challenger) {
          sessionStorage.setItem(INVITED_KEY, "1");
          const official = OFFICIAL_APPS.filter((a) => a.official && a.kind !== "app");
          const app = withManifestDefaults(official[Math.floor(Math.random() * official.length)] ?? OFFICIAL_APPS[0]!);
          const mode: PlayableMode = app.modes.includes("async") ? "async" : "live";
          const row = this.baseMatch(app, mode, challenger.id);
          row.maxPlayers = Math.max(2, app.players.min);
          takeSeat(row, challenger.id, { isBot: true });
          takeSeat(row, viewerId, { state: "invited" });
          row.status = "pending";
          draft.matches[row.id] = row;
          changed = true;
        }
      }
      return changed;
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
