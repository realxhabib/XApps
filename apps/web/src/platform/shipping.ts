/**
 * Stage 4 (shipping) rules shared by both backends and the UI: version
 * labels, manifest checks, log limits and test-build labels. Pure — no
 * backend, no React.
 */
import { LIMITS } from "@xapps/sdk";
import { CATEGORIES, type AppManifest, type AppVersion, type AppVersionStatus, type LogLevel, type Match, type VersionManifest } from "./types";
import { manifestShapeError, withManifestDefaults } from "./catalog";

/** `1.2.3` (like `version_input_check`: three numbers, at most 32 characters). */
export const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
export const VERSION_NOTES_MAX = 2000;
export const REVIEW_NOTES_MAX = 2000;
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"] as const;
/** Kept per app in demo mode (the database keeps 7 days). */
export const LOG_CAP_PER_APP = 2000;
export const LOG_RETENTION_MS = 7 * 86_400_000;
export const LOG_PAGE_DEFAULT = 100;
export const LOG_PAGE_MAX = 500;
export const ANALYTICS_DAYS_DEFAULT = 30;
export const ANALYTICS_DAYS_MAX = 365;
/** Like the database: at most 200 versions and 50 testers per app. */
export const MAX_VERSIONS_PER_APP = 200;
export const MAX_TESTERS_PER_APP = 50;

/** Statuses the owner may still edit. */
export const EDITABLE_STATUSES: readonly AppVersionStatus[] = ["draft", "rejected"];

export const VERSION_STATUS_LABEL: Record<AppVersionStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Live",
  retired: "Retired",
};

/** Compares two semver labels numerically. */
export function compareSemver(a: string, b: string): number {
  const pa = SEMVER_PATTERN.exec(a);
  const pb = SEMVER_PATTERN.exec(b);
  if (!pa || !pb) return a.localeCompare(b);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

/** Newest first, like `list_app_versions` (created_at desc; semver breaks ties). */
export function sortVersions(versions: AppVersion[]): AppVersion[] {
  return [...versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || compareSemver(b.version, a.version));
}

export function versionLabelError(version: unknown): string | null {
  if (typeof version !== "string" || version.length > 32 || !SEMVER_PATTERN.test(version)) return "Versions look like 1.2.3";
  return null;
}

/** App/version URLs: https anywhere, http only on localhost while testing. */
export function versionUrlError(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return "Add the URL this version is served from";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Must be a full URL";
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && local)) return null;
  return "Use https (or http://localhost while testing)";
}

/** The listing + capability fields of an app, as a version manifest. */
export function manifestOf(app: AppManifest): VersionManifest {
  const full = withManifestDefaults(app);
  const manifest: VersionManifest = {
    name: full.name,
    tagline: full.tagline,
    description: full.description,
    category: full.category,
    icon: full.icon,
    accent: [full.accent[0], full.accent[1]],
    modes: [...full.modes],
    players: { min: full.players.min, max: full.players.max },
    teams: full.teams ?? 0,
    spectators: full.spectators ?? true,
    setup: full.setup ?? false,
    turnBased: full.turnBased ?? false,
    scoring: full.scoring,
    howTo: [...full.howTo],
    stats: full.stats ?? [],
    achievements: full.achievements ?? [],
  };
  if (full.votesToWin !== undefined) manifest.votesToWin = full.votesToWin;
  return manifest;
}

/** Validates a version manifest like `apps` rows are validated. Returns an error message, or null. */
export function versionManifestError(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return "The manifest must be an object";
  const m = manifest as Partial<VersionManifest>;
  if (typeof m.name !== "string" || m.name.trim().length < 2 || m.name.length > 40) return "Name must be 2–40 characters";
  if (typeof m.tagline !== "string" || !m.tagline.trim() || m.tagline.length > 90) return "Tagline must be 1–90 characters";
  if (m.description !== undefined && (typeof m.description !== "string" || m.description.length > 1200)) {
    return "Description is at most 1,200 characters";
  }
  if (!CATEGORIES.some((c) => c.id === m.category)) return "Pick a category";
  if (typeof m.icon !== "string" || !m.icon || m.icon.length > 16) return "Pick an emoji icon";
  if (!Array.isArray(m.accent) || m.accent.length !== 2 || !m.accent.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c))) {
    return "Accent is two hex colors";
  }
  if (!Array.isArray(m.modes) || !m.modes.length || !m.modes.every((x) => x === "live" || x === "async" || x === "practice")) {
    return "Pick at least one mode (live, async, practice)";
  }
  if (m.scoring !== "high" && m.scoring !== "low" && m.scoring !== "votes") return "Scoring is high, low or votes";
  if (m.votesToWin !== undefined && (!Number.isInteger(m.votesToWin) || m.votesToWin < 1 || m.votesToWin > 99)) {
    return "Votes to win must be 1–99";
  }
  if (m.howTo !== undefined && (!Array.isArray(m.howTo) || m.howTo.length > 3 || !m.howTo.every((x) => typeof x === "string" && x.length <= 120))) {
    return "How-to is up to 3 lines of 120 characters";
  }
  return manifestShapeError(m);
}

/** A manifest with defaults filled in (what gets stored). */
export function cleanManifest(manifest: VersionManifest): VersionManifest {
  const out: VersionManifest = {
    ...manifest,
    description: manifest.description ?? "",
    accent: [manifest.accent[0], manifest.accent[1]],
    players: manifest.players ? { min: manifest.players.min, max: manifest.players.max } : { min: 2, max: 2 },
    teams: manifest.teams ?? 0,
    spectators: manifest.spectators ?? true,
    setup: manifest.setup ?? false,
    turnBased: manifest.turnBased ?? false,
    howTo: (manifest.howTo ?? []).filter((x) => typeof x === "string" && x.trim()),
    stats: manifest.stats ?? [],
    achievements: manifest.achievements ?? [],
  };
  if (out.scoring === "votes") out.votesToWin = manifest.votesToWin ?? 5;
  else delete out.votesToWin;
  return out;
}

/** Copies a version's url + manifest onto an app (what players see once it's published). */
export function applyVersionToApp(app: AppManifest, version: Pick<AppVersion, "url" | "manifest">): AppManifest {
  return withManifestDefaults({ ...app, ...version.manifest, url: version.url });
}

/* ---------------------------------------------------------------------- */
/* Logs                                                                   */
/* ---------------------------------------------------------------------- */

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** Levels at or above `level` (the console's level filter). */
export function levelsFrom(level: LogLevel): LogLevel[] {
  return LOG_LEVELS.slice(LOG_LEVELS.indexOf(level));
}

export const LOG_LIMITS = {
  messageLength: LIMITS.logMessageLength,
  dataBytes: LIMITS.logDataBytes,
  perMinute: LIMITS.logsPerMinute,
} as const;

/* ---------------------------------------------------------------------- */
/* Test builds                                                            */
/* ---------------------------------------------------------------------- */

/** A match played on a non-published version: never ranked, labelled "Test build". */
export function isTestBuild(match: Pick<Match, "versionId"> | null | undefined): boolean {
  return !!match?.versionId;
}

/** "Test build v1.1.0" (or just "Test build" when the backend didn't say which). */
export function testBuildLabel(match: Pick<Match, "versionId" | "versionLabel">): string {
  return match.versionLabel ? `Test build v${match.versionLabel}` : "Test build";
}
