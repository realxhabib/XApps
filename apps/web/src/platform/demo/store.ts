/**
 * The demo backend's "database": one JSON document in localStorage, shared by
 * every tab on this origin. Writes notify listeners in this tab directly and
 * in other tabs through the `storage` event, which is what makes two browser
 * tabs behave like two players on a live server.
 */
import type {
  AppManifest,
  Json,
  MatchPlayer,
  MatchMode,
  MatchStatus,
  PlayerResult,
  PlayerState,
  Profile,
  Scoring,
  SubmissionDisplay,
} from "../types";

export interface PlayerRow {
  userId: string;
  seat: number;
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
  players: PlayerRow[];
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

export interface DemoDb {
  version: 3;
  profiles: Record<string, Profile>;
  apps: Record<string, AppManifest>;
  playCounts: Record<string, number>;
  matches: Record<string, MatchRow>;
  votes: VoteRow[];
  storage: Record<string, Json>;
  appStats: Record<string, AppStatsRow>;
}

export const DB_KEY = "xapps:demo-db:v3";
const VIEWER_KEY = "xapps:demo-viewer";
const LAST_VIEWER_KEY = "xapps:demo-last-viewer";
const HUMANS_KEY = "xapps:demo-humans";

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: { raw: string | null; db: DemoDb } | null = null;
let seeder: (() => DemoDb) | null = null;

export function setSeeder(fn: () => DemoDb): void {
  seeder = fn;
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
      if (db.version === 3) {
        cache = { raw, db };
        return db;
      }
    } catch {
      // fall through to reseed
    }
  }
  if (!seeder) throw new Error("demo store has no seeder");
  const db = seeder();
  save(db, false);
  return db;
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

export function nowIso(): string {
  return new Date().toISOString();
}
