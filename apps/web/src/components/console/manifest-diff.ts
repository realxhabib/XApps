import { CATEGORIES, type AchievementDef, type StatDef, type VersionManifest } from "@/platform/types";
import { MODE_LABEL } from "@/platform/match-utils";
import { MANIFEST_DEFAULTS } from "@/platform/catalog";

/** A version's reviewable surface: where it's served plus its manifest. */
export interface ManifestSide {
  url: string;
  manifest: VersionManifest;
}

export type ChangeKind = "added" | "removed" | "changed";

export interface FieldChange {
  /** Stable key for lists, e.g. "tagline" or "stats.best_time". */
  key: string;
  /** Human label, e.g. "Tagline" or "Stat · best_time". */
  label: string;
  kind: ChangeKind;
  before: string | null;
  after: string | null;
  /** Long text renders as a block instead of inline. */
  long?: boolean;
}

const SCORING_LABEL: Record<string, string> = { high: "Highest score", low: "Lowest score", votes: "The crowd" };

function categoryLabel(id: string): string {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? `${c.emoji} ${c.label}` : id;
}

const yesNo = (v: boolean | undefined, fallback: boolean) => ((v ?? fallback) ? "On" : "Off");

function statText(s: StatDef): string {
  return `${s.label} · ${s.aggregate}${s.format && s.format !== "number" ? ` · ${s.format}` : ""}`;
}

function achievementText(a: AchievementDef): string {
  return `${a.icon} ${a.name} · ${a.xp} XP${a.secret ? " · secret" : ""} — ${a.description}`;
}

/** Scalar fields in display order: [key, label, formatter, long?]. */
const SCALARS: [string, string, (m: ManifestSide) => string, boolean?][] = [
  ["url", "App URL", (s) => s.url],
  ["name", "Name", (s) => s.manifest.name],
  ["tagline", "Tagline", (s) => s.manifest.tagline],
  ["description", "Description", (s) => s.manifest.description || "—", true],
  ["category", "Category", (s) => categoryLabel(s.manifest.category)],
  ["icon", "Icon", (s) => s.manifest.icon],
  ["accent", "Accent", (s) => s.manifest.accent.join(" → ")],
  ["modes", "Modes", (s) => s.manifest.modes.map((m) => MODE_LABEL[m]).join(", ") || "—"],
  [
    "players",
    "Players",
    (s) => {
      const p = s.manifest.players ?? MANIFEST_DEFAULTS.players;
      return p.min === p.max ? `${p.min}` : `${p.min}–${p.max}`;
    },
  ],
  ["teams", "Teams", (s) => (s.manifest.teams ? `${s.manifest.teams} teams` : "Free for all")],
  ["spectators", "Spectators", (s) => yesNo(s.manifest.spectators, MANIFEST_DEFAULTS.spectators)],
  ["turnBased", "Turn-based", (s) => yesNo(s.manifest.turnBased, MANIFEST_DEFAULTS.turnBased)],
  ["setup", "Custom setup", (s) => yesNo(s.manifest.setup, MANIFEST_DEFAULTS.setup)],
  ["scoring", "Who wins", (s) => SCORING_LABEL[s.manifest.scoring] ?? s.manifest.scoring],
  ["votesToWin", "Votes to win", (s) => (s.manifest.votesToWin != null ? String(s.manifest.votesToWin) : "—")],
];

/**
 * Field-level diff of two versions. `before` null means "nothing published
 * yet": every field is reported as added.
 */
export function diffManifests(before: ManifestSide | null, after: ManifestSide): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [key, label, fmt, long] of SCALARS) {
    const b = before ? fmt(before) : null;
    const a = fmt(after);
    if (b === a) continue;
    if (!before && (a === "—" || a === "")) continue;
    changes.push({ key, label, kind: b === null ? "added" : "changed", before: b, after: a, long });
  }

  // How to play: per step.
  const hb = before?.manifest.howTo ?? [];
  const ha = after.manifest.howTo ?? [];
  for (let i = 0; i < Math.max(hb.length, ha.length); i++) {
    const b = hb[i] ?? null;
    const a = ha[i] ?? null;
    if (b === a) continue;
    changes.push({ key: `howTo.${i}`, label: `How to play · step ${i + 1}`, kind: b === null ? "added" : a === null ? "removed" : "changed", before: b, after: a });
  }

  // Stats by key, achievements by id.
  diffById(changes, "stats", "Stat", before?.manifest.stats ?? [], after.manifest.stats ?? [], (s) => s.key, statText);
  diffById(changes, "achievements", "Achievement", before?.manifest.achievements ?? [], after.manifest.achievements ?? [], (a) => a.id, achievementText);
  return changes;
}

function diffById<T>(
  out: FieldChange[],
  group: string,
  noun: string,
  before: T[],
  after: T[],
  id: (item: T) => string,
  text: (item: T) => string,
) {
  const b = new Map(before.map((x) => [id(x), x]));
  const a = new Map(after.map((x) => [id(x), x]));
  for (const [key, item] of a) {
    const prev = b.get(key);
    const next = text(item);
    if (!prev) out.push({ key: `${group}.${key}`, label: `${noun} · ${key}`, kind: "added", before: null, after: next });
    else if (text(prev) !== next) out.push({ key: `${group}.${key}`, label: `${noun} · ${key}`, kind: "changed", before: text(prev), after: next });
  }
  for (const [key, item] of b) {
    if (!a.has(key)) out.push({ key: `${group}.${key}`, label: `${noun} · ${key}`, kind: "removed", before: text(item), after: null });
  }
}
