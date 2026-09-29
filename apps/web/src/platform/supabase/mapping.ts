/**
 * Pure row ↔ model mapping for the Supabase backend. Kept free of the Supabase
 * client and env so it can be unit tested, and tolerant of the v1 schema: every
 * v2 field has a default until the stage-1 migration is applied.
 */
import { getOfficialApp, toAchievementDefs, toStatDefs, withManifestDefaults } from "../catalog";
import type {
  AppAuthority,
  AppCategory,
  AppServerConfig,
  AppManifest,
  AppStatus,
  CreateChallengeInput,
  Match,
  MatchPlayer,
  PlayableMode,
  Profile,
  RegisterAppInput,
  Scoring,
  StatLeaderRow,
  UserAchievement,
  UserStat,
  WebhookDelivery,
} from "../types";
import { BackendError } from "../backend";

export interface AppRow {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: AppCategory;
  icon: string;
  accent_from: string;
  accent_to: string;
  url: string;
  modes: PlayableMode[];
  min_players: number;
  max_players: number;
  /** v2 columns (absent on the v1 schema). */
  team_count?: number | null;
  allow_spectators?: boolean | null;
  has_setup?: boolean | null;
  turn_based?: boolean | null;
  /** Stage 2 column (absent before the trust migration). */
  authority?: AppAuthority | null;
  /** Stage 3 columns (absent before the media & data migration). */
  stats?: unknown;
  achievements?: unknown;
  scoring: Scoring;
  votes_to_win: number;
  duration_label: string;
  how_to: string[];
  tags: string[];
  official: boolean;
  developer_id: string | null;
  status: AppStatus;
  play_count: number;
  created_at: string;
  developer?: { handle: string; name: string } | null;
}

export function toApp(row: AppRow): AppManifest {
  const official = row.official ? getOfficialApp(row.slug) : undefined;
  if (official) {
    const stats = toStatDefs(row.stats);
    const achievements = toAchievementDefs(row.achievements);
    return withManifestDefaults({
      ...official,
      playCount: row.play_count,
      authority: toAuthority(row.authority),
      // The catalog wins; the row fills in what the catalog doesn't declare.
      stats: official.stats?.length ? official.stats : stats,
      achievements: official.achievements?.length ? official.achievements : achievements,
    });
  }
  return withManifestDefaults({
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    category: row.category,
    icon: row.icon,
    accent: [row.accent_from, row.accent_to],
    url: row.url,
    modes: row.modes,
    players: { min: row.min_players ?? 2, max: row.max_players ?? 2 },
    teams: row.team_count ?? 0,
    spectators: row.allow_spectators ?? true,
    setup: row.has_setup ?? false,
    turnBased: row.turn_based ?? false,
    authority: toAuthority(row.authority),
    stats: toStatDefs(row.stats),
    achievements: toAchievementDefs(row.achievements),
    scoring: row.scoring,
    votesToWin: row.votes_to_win,
    durationLabel: row.duration_label || "Community",
    howTo: row.how_to,
    official: row.official,
    developer: {
      id: row.developer_id,
      handle: row.developer?.handle ?? "community",
      name: row.developer?.name ?? "Community developer",
    },
    status: row.status,
    playCount: row.play_count,
    createdAt: row.created_at,
    tags: row.tags,
  });
}

/**
 * The insert for `apps`. v2 columns are only sent when they differ from their
 * defaults, so registering a plain 1v1 app still works on the v1 schema.
 */
export function appInsert(input: RegisterAppInput): Record<string, unknown> {
  const row: Record<string, unknown> = {
    slug: input.slug,
    name: input.name,
    tagline: input.tagline,
    description: input.description,
    category: input.category,
    icon: input.icon,
    accent_from: input.accent[0],
    accent_to: input.accent[1],
    url: input.url,
    modes: input.modes,
    scoring: input.scoring,
    how_to: input.howTo,
  };
  if (input.players && (input.players.min !== 2 || input.players.max !== 2)) {
    row.min_players = input.players.min;
    row.max_players = input.players.max;
  }
  if (input.teams) row.team_count = input.teams;
  if (input.spectators === false) row.allow_spectators = false;
  if (input.setup) row.has_setup = true;
  if (input.turnBased) row.turn_based = true;
  if (input.stats?.length) row.stats = input.stats;
  if (input.achievements?.length) row.achievements = input.achievements;
  return row;
}

type RawPlayer = Partial<MatchPlayer> & Pick<MatchPlayer, "userId" | "profile">;
type RawMatch = Partial<Match> & Pick<Match, "id" | "players">;

function toPlayer(raw: RawPlayer, match: RawMatch): MatchPlayer {
  const role = raw.role ?? "player";
  const seat = raw.seat ?? null;
  const teams = match.teams ?? 0;
  // v1 rows have no rank: derive it from a settled 1v1 result.
  const derivedRank =
    match.status === "completed" && raw.result && role === "player" ? (raw.result === "loss" ? 2 : 1) : null;
  return {
    userId: raw.userId,
    seat: role === "spectator" ? null : seat,
    team: raw.team ?? (teams >= 2 && typeof seat === "number" ? seat % teams : null),
    role,
    rank: raw.rank ?? derivedRank,
    state: raw.state ?? "joined",
    isBot: raw.isBot ?? false,
    score: raw.score ?? null,
    submission: raw.submission ?? null,
    result: raw.result ?? null,
    xpDelta: raw.xpDelta ?? 0,
    lastSeenAt: raw.lastSeenAt ?? null,
    profile: raw.profile,
  };
}

/** `match_json` → `Match`, filling in v2 fields the v1 schema doesn't return. */
export function normalizeMatch(raw: RawMatch): Match {
  const players = (raw.players ?? []).map((p) => toPlayer(p as RawPlayer, raw));
  const seatedCount = players.filter((p) => p.role === "player").length;
  const maxPlayers = raw.maxPlayers ?? Math.max(2, seatedCount);
  return {
    ...(raw as Match),
    players,
    minPlayers: raw.minPlayers ?? Math.min(2, maxPlayers),
    maxPlayers,
    teams: raw.teams ?? 0,
    winnerTeam: raw.winnerTeam ?? null,
    spectatorCount: raw.spectatorCount ?? 0,
    state: raw.state ?? null,
    stateVersion: raw.stateVersion ?? 0,
    turnUserId: raw.turnUserId ?? null,
    turnDeadline: raw.turnDeadline ?? null,
    round: raw.round ?? 0,
    settings: raw.settings ?? {},
    votes: raw.votes ?? {},
  };
}

/** Maps a Postgres/PostgREST error code (and message) to a BackendError code. */
export function errorKind(code: string | undefined, message = ""): BackendError["code"] {
  if (code === "40001" || /state_conflict/i.test(message)) return "conflict";
  switch (code) {
    case "28000":
      return "unauthenticated";
    case "P0002":
      return "not_found";
    case "42501":
      return "forbidden";
    case "22023":
    case "23514":
      return "invalid";
    case "55000":
    case "23505":
      return "conflict";
    case "54000":
      // Limits: storage keys, stat reports / unlocks per minute (the SDK sees `rate_limited`).
      return "rate_limited";
    default:
      return "internal";
  }
}

/** True when PostgREST can't find our tables/functions (the migration isn't applied). */
export function isSchemaMissing(code: string | undefined): boolean {
  return code === "PGRST205" || code === "PGRST202" || code === "42P01" || code === "42883";
}

export function toBackendError(error: { code?: string; message?: string } | null | undefined, fallback = "Something went wrong"): BackendError {
  const code = error?.code;
  if (isSchemaMissing(code)) {
    return new BackendError(
      "Supabase is connected, but the XApps database schema isn't installed yet. Run the SQL in supabase/migrations.",
      "setup_required",
    );
  }
  const message = error?.message || fallback;
  const kind = errorKind(code, message);
  return new BackendError(kind === "conflict" && /state_conflict/i.test(message) ? "The match state changed — try again" : message, kind);
}

/**
 * `create_challenge` arguments. The v2 parameters are only named when used, so
 * a plain 1v1 challenge still resolves against the v1 function signature.
 */
export function challengeArgs(input: CreateChallengeInput): Record<string, unknown> {
  const handles = [
    ...new Set(
      [...(input.opponentHandles ?? []), input.opponentHandle ?? ""]
        .map((h) => h.replace(/^@/, "").trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  const args: Record<string, unknown> = {
    p_app: input.appSlug,
    p_mode: input.mode,
    p_opponent: handles.length === 1 ? handles[0] : null,
    p_settings: input.settings ?? {},
  };
  if (handles.length > 1) args.p_opponents = handles;
  if (typeof input.maxPlayers === "number") args.p_max_players = input.maxPlayers;
  return args;
}

/* ---------------------------------------------------------------------- */
/* Stage 2: app server settings                                           */
/* ---------------------------------------------------------------------- */

export function toAuthority(value: unknown): AppAuthority {
  return value === "server" ? "server" : "client";
}

type Loose = Record<string, unknown>;

/** Reads `camelKey`, falling back to its snake_case twin (defensive against either RPC style). */
function pick(raw: Loose, camelKey: string): unknown {
  if (camelKey in raw) return raw[camelKey];
  const snake = camelKey.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return raw[snake];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** An RPC that returns one row may come back as the object, a one-row array, or null. */
function firstRow(data: unknown): Loose | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Loose) : null;
}

/** `get_app_server_config` → `AppServerConfig`. */
export function toServerConfig(data: unknown): AppServerConfig {
  const raw = firstRow(data) ?? {};
  const secretPrefix = str(pick(raw, "secretPrefix"));
  const webhookUrl = str(pick(raw, "webhookUrl"));
  const hasSecret = pick(raw, "hasSecret");
  const hasWebhook = pick(raw, "hasWebhook");
  return {
    secretPrefix,
    hasSecret: typeof hasSecret === "boolean" ? hasSecret : !!secretPrefix,
    webhookUrl,
    hasWebhook: typeof hasWebhook === "boolean" ? hasWebhook : !!webhookUrl,
    authority: toAuthority(pick(raw, "authority")),
  };
}

/** One row of `list_webhook_deliveries` → `WebhookDelivery`. */
export function toWebhookDelivery(raw: Loose): WebhookDelivery {
  return {
    id: String(pick(raw, "id") ?? ""),
    event: str(pick(raw, "event")) ?? "unknown",
    matchId: str(pick(raw, "matchId")),
    createdAt: str(pick(raw, "createdAt")) ?? new Date(0).toISOString(),
    attempts: num(pick(raw, "attempts")) ?? 0,
    deliveredAt: str(pick(raw, "deliveredAt")),
    lastStatus: num(pick(raw, "lastStatus")),
    lastError: str(pick(raw, "lastError")),
  };
}

/** `list_webhook_deliveries` returns a jsonb array or a set of rows; either way, newest first. */
export function toWebhookDeliveries(data: unknown): WebhookDelivery[] {
  const rows = Array.isArray(data) ? data : data && typeof data === "object" && Array.isArray((data as Loose).deliveries) ? ((data as Loose).deliveries as unknown[]) : [];
  return rows
    .filter((r): r is Loose => !!r && typeof r === "object")
    .map(toWebhookDelivery)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** A secret-returning RPC (`text`), tolerating a `{ secret }` object or a one-row array. */
export function toSecret(data: unknown): string | null {
  if (typeof data === "string") return data || null;
  const row = firstRow(data);
  if (!row) return null;
  for (const key of ["secret", "signingSecret", "signing_secret", "webhookSecret", "webhook_secret"]) {
    if (typeof row[key] === "string" && row[key]) return row[key] as string;
  }
  const values = Object.values(row).filter((v): v is string => typeof v === "string" && v.length > 0);
  return values.length === 1 ? values[0]! : null;
}

/* ---------------------------------------------------------------------- */
/* Stage 3: storage, stats & achievements                                 */
/* ---------------------------------------------------------------------- */

/** `profile_json` (camelCase), tolerating snake_case. */
export function toProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Loose;
  const id = str(pick(p, "id"));
  const handle = str(pick(p, "handle"));
  if (!id || !handle) return null;
  return {
    id,
    handle,
    name: str(pick(p, "name")) ?? handle,
    avatarUrl: str(pick(p, "avatarUrl")),
    bio: typeof p.bio === "string" ? p.bio : "",
    xp: num(pick(p, "xp")) ?? 0,
    wins: num(pick(p, "wins")) ?? 0,
    losses: num(pick(p, "losses")) ?? 0,
    draws: num(pick(p, "draws")) ?? 0,
    streak: num(pick(p, "streak")) ?? 0,
    bestStreak: num(pick(p, "bestStreak")) ?? 0,
    createdAt: str(pick(p, "createdAt")) ?? new Date(0).toISOString(),
    isBot: pick(p, "isBot") === true,
  };
}

function rows(data: unknown): Loose[] {
  return (Array.isArray(data) ? data : []).filter((r): r is Loose => !!r && typeof r === "object");
}

/** `app_stat_leaderboard` → `[{ rank, profile, value }]`. */
export function toStatLeaderRows(data: unknown): StatLeaderRow[] {
  const out: StatLeaderRow[] = [];
  for (const r of rows(data)) {
    const profile = toProfile(r.profile);
    const value = num(r.value);
    if (!profile || value === null) continue;
    out.push({ rank: num(r.rank) ?? out.length + 1, profile, value });
  }
  return out;
}

/** `user_stats` → `[{ appSlug, key, value, updatedAt }]`. */
export function toUserStats(data: unknown): UserStat[] {
  const out: UserStat[] = [];
  for (const r of rows(data)) {
    const appSlug = str(pick(r, "appSlug"));
    const key = str(r.key);
    const value = num(r.value);
    if (!appSlug || !key || value === null) continue;
    out.push({ appSlug, key, value, updatedAt: str(pick(r, "updatedAt")) ?? new Date(0).toISOString() });
  }
  return out;
}

/** `list_user_achievements` → `[{ appSlug, achievementId, unlockedAt }]`. */
export function toUserAchievements(data: unknown): UserAchievement[] {
  const out: UserAchievement[] = [];
  for (const r of rows(data)) {
    const appSlug = str(pick(r, "appSlug"));
    const achievementId = str(pick(r, "achievementId"));
    if (!appSlug || !achievementId) continue;
    out.push({ appSlug, achievementId, unlockedAt: str(pick(r, "unlockedAt")) ?? new Date(0).toISOString() });
  }
  return out;
}

/** `report_stats` → `{ [key]: number }`. */
export function toStatValues(data: unknown): { [key: string]: number } {
  const raw = firstRow(data);
  const out: { [key: string]: number } = {};
  if (!raw) return out;
  for (const [key, value] of Object.entries(raw)) {
    const n = num(value);
    if (n !== null) out[key] = n;
  }
  return out;
}

/** `unlock_achievement` → `{ unlocked }` (tolerating a bare boolean). */
export function toUnlocked(data: unknown): { unlocked: boolean } {
  if (typeof data === "boolean") return { unlocked: data };
  const raw = firstRow(data);
  return { unlocked: raw?.unlocked === true };
}

/** `storage_list` (text[] or rows) → sorted keys. */
export function toStorageKeys(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const keys = data
    .map((k) => (typeof k === "string" ? k : k && typeof k === "object" ? str((k as Loose).key) : null))
    .filter((k): k is string => !!k);
  return [...new Set(keys)].sort();
}
