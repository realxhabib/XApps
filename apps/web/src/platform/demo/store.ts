/**
 * The demo backend's "database": one JSON document in localStorage, shared by
 * every tab on this origin. Writes notify listeners in this tab directly and
 * in other tabs through the `storage` event, which is what makes two browser
 * tabs behave like two players on a live server.
 */
import type {
  AppLogEntry,
  DeveloperNotice,
  AppManifest,
  AppVersion,
  Json,
  MatchPlayer,
  MatchMode,
  MatchStatus,
  PlayerResult,
  PlayerRole,
  PlayerState,
  Profile,
  Scoring,
  SubmissionDisplay,
} from "../types";

export interface PlayerRow {
  userId: string;
  /** Null for spectators. */
  seat: number | null;
  team: number | null;
  role: PlayerRole;
  rank: number | null;
  state: PlayerState;
  isBot: boolean;
  score: number | null;
  submission: { data?: Json; display?: SubmissionDisplay } | null;
  result: PlayerResult;
  xpDelta: number;
  lastSeenAt: string | null;
}

export interface MatchRow {
  id: string;
  appSlug: string;
  mode: Exclude<MatchMode, "sandbox">;
  status: MatchStatus;
  scoring: Scoring;
  seed: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  winnerId: string | null;
  isOpen: boolean;
  settings: { [key: string]: Json };
  votes: { [userId: string]: number };
  votesNeeded: number;
  votingEndsAt: string | null;
  simulatedVotes: boolean;
  /** Seated players and spectators. */
  players: PlayerRow[];
  minPlayers: number;
  maxPlayers: number;
  teams: number;
  winnerTeam: number | null;
  state: Json | null;
  stateVersion: number;
  turnUserId: string | null;
  turnDeadline: string | null;
  round: number;
  /** Stage 4: a test build of this app version (never ranked). Absent on older rows. */
  versionId?: string | null;
  /** Stage 4: the app's live version when the match was created (analytics' per-version split). */
  publishedVersionId?: string | null;
}

export interface VoteRow {
  matchId: string;
  voterId: string;
  choiceId: string;
  at: string;
}

export interface AppStatsRow {
  played: number;
  wins: number;
  losses: number;
  draws: number;
  xp: number;
}

/** Stage 2 credentials, like `app_credentials`: only hashes and a display prefix are kept. */
export interface CredentialRow {
  secretHash: string | null;
  secretPrefix: string | null;
  webhookUrl: string | null;
  /** The real table keeps the signing secret to sign with; demo mode never sends, so a hash will do. */
  webhookSecretHash: string | null;
  createdAt: string;
  rotatedAt: string | null;
}

export interface WebhookDeliveryRow {
  id: string;
  appSlug: string;
  event: string;
  matchId: string | null;
  createdAt: string;
  attempts: number;
  deliveredAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

/** Stage 3: one player's value for one stat (`app_user_stats`). */
export interface UserStatRow {
  value: number;
  updatedAt: string;
}

/** Stage 3: an upload recorded for the rolling 24 h quota (`media_uploads`). */
export interface MediaUploadRow {
  appSlug: string;
  userId: string;
  url: string;
  bytes: number;
  mime: string;
  createdAt: string;
}

/** Stage 4: `app_versions` (plus who reviewed it). */
export interface VersionRow extends AppVersion {
  reviewedBy: string | null;
}

export interface DemoDb {
  version: 4;
  profiles: Record<string, Profile>;
  apps: Record<string, AppManifest>;
  playCounts: Record<string, number>;
  matches: Record<string, MatchRow>;
  votes: VoteRow[];
  storage: Record<string, Json>;
  appStats: Record<string, AppStatsRow>;
  /** Stage 2 (added without a version bump; absent in older demo databases). */
  credentials?: Record<string, CredentialRow>;
  webhookDeliveries?: WebhookDeliveryRow[];
  /** Stage 3 (also optional). App-scope storage by `app:key`; user scope stays in `storage` (`app:user:key`). */
  appStorage?: Record<string, Json>;
  /** Stat values by `app:user:key`. */
  userStats?: Record<string, UserStatRow>;
  /** Unlock time by `app:user:achievementId`. */
  achievements?: Record<string, string>;
  mediaUploads?: MediaUploadRow[];
  /** Showcase community apps already added once (so deleting one keeps it gone). */
  showcaseSeeded?: string[];
  /** Stage 4 (optional too): versions by id, the published version per app, testers per app, logs. */
  versions?: Record<string, VersionRow>;
  publishedVersions?: Record<string, string>;
  testers?: Record<string, string[]>;
  logs?: AppLogEntry[];
  /** Review decisions for developers (`developer_notices`). */
  notices?: (DeveloperNotice & { userId: string })[];
  /** App upvotes by app slug (optional too; official and showcase apps have seeded ones until changed). */
  upvotes?: Record<string, UpvoteRow>;
}

/** An app's upvotes (`app_upvotes` + `apps.upvotes`): a seeded crowd count plus who upvoted (personas and people). */
export interface UpvoteRow {
  crowd: number;
  userIds: string[];
}

export const DB_VERSION = 4 as const;
export const DB_KEY = "xapps:demo-db:v4";
/** Older databases we try to upgrade (newest first) before reseeding. */
const LEGACY_KEYS = ["xapps:demo-db:v3"];
const VIEWER_KEY = "xapps:demo-viewer";
const LAST_VIEWER_KEY = "xapps:demo-last-viewer";
const HUMANS_KEY = "xapps:demo-humans";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: { raw: string | null; db: DemoDb } | null = null;
let seeder: (() => DemoDb) | null = null;
let upgrader: ((old: unknown) => DemoDb | null) | null = null;

/** `upgrade` turns an older database into the current shape, or returns null to reseed. */
export function setSeeder(fn: () => DemoDb, upgrade?: (old: unknown) => DemoDb | null): void {
  seeder = fn;
  upgrader = upgrade ?? null;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function load(): DemoDb {
  const ls = storage();
  const raw = ls?.getItem(DB_KEY) ?? null;
  if (cache && cache.raw === raw) return cache.db;
  if (raw) {
    try {
      const db = JSON.parse(raw) as DemoDb;
      if (db.version === DB_VERSION) {
        cache = { raw, db };
        return db;
      }
    } catch {
      // fall through to reseed
    }
  }
  const upgraded = upgradeLegacy(ls);
  if (upgraded) {
    save(upgraded, false);
    return upgraded;
  }
  if (!seeder) throw new Error("demo store has no seeder");
  const db = seeder();
  save(db, false);
  return db;
}

/** Carries an older demo database forward (matches, profiles, stats) instead of wiping it. */
function upgradeLegacy(ls: Storage | null): DemoDb | null {
  if (!ls || !upgrader) return null;
  for (const key of LEGACY_KEYS) {
    let raw: string | null = null;
    try {
      raw = ls.getItem(key);
    } catch {
      return null;
    }
    if (!raw) continue;
    try {
      ls.removeItem(key);
    } catch {
      // ignore
    }
    try {
      const db = upgrader(JSON.parse(raw));
      if (db && db.version === DB_VERSION) return db;
    } catch {
      // Unreadable: reseed.
    }
    return null;
  }
  return null;
}

function save(db: DemoDb, notify = true): void {
  const raw = JSON.stringify(db);
  cache = { raw, db };
  try {
    storage()?.setItem(DB_KEY, raw);
  } catch {
    // Quota exceeded: keep working in memory for this tab.
  }
  if (notify) emit();
}

/** Read-modify-write against the freshest copy, then notify. */
export function mutate<T>(fn: (db: DemoDb) => T): T {
  // Always start from what's on disk so writes from other tabs aren't lost.
  cache = null;
  const db = structuredClone(load());
  const result = fn(db);
  save(db);
  return result;
}

/** Like `mutate`, but only writes (and notifies) when `fn` reports a change. */
export function mutateIfChanged(fn: (db: DemoDb) => boolean): boolean {
  cache = null;
  const db = structuredClone(load());
  const changed = fn(db);
  if (changed) save(db);
  return changed;
}

export function reset(): void {
  storage()?.removeItem(DB_KEY);
  cache = null;
  load();
  emit();
}

function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === DB_KEY) {
      cache = null;
      emit();
    }
    if (event.key === null) {
      cache = null;
      emit();
    }
  });
}

/* ---------------------------------------------------------------------- */
/* Viewer identity (per tab)                                              */
/* ---------------------------------------------------------------------- */

export function getViewerId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(VIEWER_KEY) ?? window.localStorage.getItem(LAST_VIEWER_KEY);
  } catch {
    return null;
  }
}

export function setViewerId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) {
      window.sessionStorage.setItem(VIEWER_KEY, id);
      window.localStorage.setItem(LAST_VIEWER_KEY, id);
    } else {
      window.sessionStorage.removeItem(VIEWER_KEY);
      window.localStorage.removeItem(LAST_VIEWER_KEY);
    }
  } catch {
    // ignore
  }
}

/* ---------------------------------------------------------------------- */
/* Which personas are being played by a human in some tab                 */
/* ---------------------------------------------------------------------- */

export function markHuman(profileId: string): void {
  const ls = storage();
  if (!ls) return;
  try {
    const humans = JSON.parse(ls.getItem(HUMANS_KEY) ?? "{}") as Record<string, number>;
    humans[profileId] = Date.now();
    ls.setItem(HUMANS_KEY, JSON.stringify(humans));
  } catch {
    // ignore
  }
}

export function isHumanOnline(profileId: string): boolean {
  const ls = storage();
  if (!ls) return false;
  try {
    const humans = JSON.parse(ls.getItem(HUMANS_KEY) ?? "{}") as Record<string, number>;
    return Date.now() - (humans[profileId] ?? 0) < 9_000;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

export function hydratePlayer(db: DemoDb, row: PlayerRow): MatchPlayer {
  const profile =
    db.profiles[row.userId] ??
    ({
      id: row.userId,
      handle: "unknown",
      name: "Unknown player",
      avatarUrl: null,
      bio: "",
      xp: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      streak: 0,
      bestStreak: 0,
      createdAt: new Date(0).toISOString(),
    } satisfies Profile);
  return { ...row, profile };
}

export function newPlayerRow(userId: string, seat: number | null, extra: Partial<PlayerRow> = {}): PlayerRow {
  return {
    userId,
    seat,
    team: null,
    role: "player",
    rank: null,
    state: "joined",
    isBot: false,
    score: null,
    submission: null,
    result: null,
    xpDelta: 0,
    lastSeenAt: null,
    ...extra,
  };
}

/** Defaults for the v2 match columns (a 1v1, free for all, no state/turns/rounds). */
export const MATCH_V2_DEFAULTS = {
  minPlayers: 2,
  maxPlayers: 2,
  teams: 0,
  winnerTeam: null,
  state: null,
  stateVersion: 0,
  turnUserId: null,
  turnDeadline: null,
  round: 0,
} satisfies Partial<MatchRow>;

export function nowIso(): string {
  return new Date().toISOString();
}
