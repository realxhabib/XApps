/**
 * First-party ("official") apps as `public.apps` rows, for `npm run sync-apps`
 * (scripts/sync-apps.mjs). The catalog in ./catalog.ts is the source of truth:
 * deploys upsert these rows with the service role, so adding or changing a
 * first-party app needs no migration. Pure (no Supabase client, no env), so it
 * is unit tested and the script only does I/O.
 *
 * The columns are exactly the ones the seeding migrations write (see
 * supabase/migrations/20261004000000_wedge_wars.sql) plus `votes_to_win`.
 * Everything else on the row is platform-owned and never sent: `play_count`,
 * `created_at`, `developer_id` (null for official apps), `authority` (only
 * set_app_authority moves it) and `published_version_id` (official apps have no
 * `app_versions`; apps_register_version skips them).
 */
import { OFFICIAL_APPS, achievementDefsError, isSingleEmoji, manifestShapeError, statDefsError } from "./catalog";
import { CATEGORIES } from "./types";
import type { AchievementDef, AppCategory, AppManifest, AppStatus, PlayableMode, Scoring, StatDef } from "./types";

export interface OfficialAppRow {
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
  team_count: number;
  allow_spectators: boolean;
  has_setup: boolean;
  turn_based: boolean;
  scoring: Scoring;
  votes_to_win: number;
  duration_label: string;
  how_to: string[];
  tags: string[];
  official: true;
  status: AppStatus;
  stats: StatDef[];
  achievements: AchievementDef[];
}

/** The `public.apps` columns the sync writes (and compares), in migration order. */
export const OFFICIAL_APP_COLUMNS = [
  "slug",
  "name",
  "tagline",
  "description",
  "category",
  "icon",
  "accent_from",
  "accent_to",
  "url",
  "modes",
  "min_players",
  "max_players",
  "team_count",
  "allow_spectators",
  "has_setup",
  "turn_based",
  "scoring",
  "votes_to_win",
  "duration_label",
  "how_to",
  "tags",
  "official",
  "status",
  "stats",
  "achievements",
] as const satisfies readonly (keyof OfficialAppRow)[];

/** `apps.votes_to_win` default (the core migration seeds 5 for every app). */
export const DEFAULT_VOTES_TO_WIN = 5;

/** Only apps the catalog flags `official` are synced (the RPS example is a community app). */
export function officialCatalogApps(apps: readonly AppManifest[] = OFFICIAL_APPS): AppManifest[] {
  return apps.filter((app) => app.official === true);
}

/** Every slug in the catalog, official or not (the sync leaves the others to their owners). */
export function catalogSlugs(apps: readonly AppManifest[] = OFFICIAL_APPS): string[] {
  return apps.map((app) => app.slug);
}

/** Maps a catalog app to its `public.apps` row. Absent v2 fields take the column defaults. */
export function officialAppRow(app: AppManifest): OfficialAppRow {
  return {
    slug: app.slug,
    name: app.name,
    tagline: app.tagline,
    description: app.description,
    category: app.category,
    icon: app.icon,
    accent_from: app.accent[0],
    accent_to: app.accent[1],
    url: app.url,
    modes: [...app.modes],
    min_players: app.players?.min ?? 2,
    max_players: app.players?.max ?? 2,
    team_count: app.teams ?? 0,
    allow_spectators: app.spectators ?? true,
    has_setup: app.setup ?? false,
    turn_based: app.turnBased ?? false,
    scoring: app.scoring,
    votes_to_win: app.votesToWin ?? DEFAULT_VOTES_TO_WIN,
    duration_label: app.durationLabel,
    how_to: [...app.howTo],
    tags: [...app.tags],
    official: true,
    status: app.status,
    stats: (app.stats ?? []).map((s) => ({ ...s })),
    achievements: (app.achievements ?? []).map((a) => ({ ...a })),
  };
}

/** Rows for every official catalog app (throws on a row the database would reject). */
export function officialAppRows(apps: readonly AppManifest[] = OFFICIAL_APPS): OfficialAppRow[] {
  const rows = officialCatalogApps(apps).map(officialAppRow);
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.slug)) throw new Error(`Duplicate official app slug "${row.slug}" in the catalog`);
    seen.add(row.slug);
    const error = officialAppRowError(row);
    if (error) throw new Error(`Official app "${row.slug}": ${error}`);
  }
  return rows;
}

/** Postgres `char_length` counts code points, not UTF-16 units. */
const chars = (text: string) => [...text].length;
const HEX = /^#[0-9a-fA-F]{6}$/;
const MODES: readonly string[] = ["live", "async", "practice"];

/**
 * The `public.apps` checks (column checks, apps_player_range_check,
 * apps_team_count_check, apps_stats_check / apps_achievements_check) in JS,
 * so a bad catalog entry fails tests and the build before it reaches the
 * database. Returns an error message, or null.
 */
export function officialAppRowError(row: OfficialAppRow): string | null {
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(row.slug)) return "slug must be 3–40 of a–z, 0–9 and inner dashes";
  if (chars(row.name) < 2 || chars(row.name) > 40) return "name must be 2–40 characters";
  if (chars(row.tagline) > 90) return "tagline must be at most 90 characters";
  if (chars(row.description) > 1200) return "description must be at most 1200 characters";
  if (!CATEGORIES.some((c) => c.id === row.category)) return `unknown category "${row.category}"`;
  if (!isSingleEmoji(row.icon)) return "icon must be a single emoji";
  if (!HEX.test(row.accent_from) || !HEX.test(row.accent_to)) return "accent colors must be #rrggbb";
  if (!row.url.startsWith("/")) return "first-party apps are served same-origin (url must start with /)";
  if (!row.modes.length || row.modes.some((m) => !MODES.includes(m))) return "modes must be live, async and/or practice";
  if (new Set(row.modes).size !== row.modes.length) return "modes must not repeat";
  if (!["high", "low", "votes"].includes(row.scoring)) return `unknown scoring "${row.scoring}"`;
  if (!Number.isInteger(row.votes_to_win) || row.votes_to_win < 1 || row.votes_to_win > 101) {
    return "votesToWin must be 1–101";
  }
  if (chars(row.duration_label) > 30) return "durationLabel must be at most 30 characters";
  if (row.how_to.length > 6) return "howTo must have at most 6 steps";
  if (row.tags.length > 8) return "tags must have at most 8 entries";
  if (!["published", "pending", "rejected"].includes(row.status)) return `unknown status "${row.status}"`;
  return (
    manifestShapeError({
      players: { min: row.min_players, max: row.max_players },
      teams: row.team_count,
    }) ??
    statDefsError(row.stats) ??
    achievementDefsError(row.achievements)
  );
}

/* ---------------------------------------------------------------------- */
/* Sync plan                                                              */
/* ---------------------------------------------------------------------- */

/** What `public.apps` holds for a slug (the synced columns; others are ignored). */
export type ExistingAppRow = Partial<Record<(typeof OFFICIAL_APP_COLUMNS)[number], unknown>> & { slug: string };

export type SyncAction = "insert" | "update" | "unchanged" | "conflict";

export interface SyncStep {
  slug: string;
  action: SyncAction;
  /** Columns that differ (update). */
  changed: string[];
  /** Why the slug can't be synced (conflict). */
  reason?: string;
  row: OfficialAppRow;
}

/** JSON with sorted keys and without `undefined`, so jsonb (which reorders keys) compares equal. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      );
    }
    return v;
  });
}

/**
 * Compares the catalog rows with what the database holds. A slug held by a
 * community app (official = false) is a conflict: the sync never takes over
 * someone else's app.
 */
export function planOfficialAppSync(desired: readonly OfficialAppRow[], existing: readonly ExistingAppRow[]): SyncStep[] {
  const bySlug = new Map(existing.map((row) => [row.slug, row]));
  return desired.map((row) => {
    const current = bySlug.get(row.slug);
    if (!current) return { slug: row.slug, action: "insert", changed: [], row };
    if (current.official !== true) {
      return {
        slug: row.slug,
        action: "conflict",
        changed: [],
        reason: "the slug belongs to a community app (official = false); rename the first-party app or remove that row",
        row,
      };
    }
    const changed = OFFICIAL_APP_COLUMNS.filter((col) => canonicalJson(current[col]) !== canonicalJson(row[col]));
    return { slug: row.slug, action: changed.length ? "update" : "unchanged", changed, row };
  });
}
