/**
 * Rules shared by the app SDK and hosts: what counts as JSON, and which
 * requests a launch purpose / player role may make. Internal module; the
 * public surface re-exports what hosts need from `./host`.
 */
import {
  LIMITS,
  byteLength,
  type AchievementDef,
  type Json,
  type LaunchContext,
  type MediaRef,
  type RequestMethod,
  type StatDef,
  type StorageScope,
} from "./protocol";

const MAX_DEPTH = 64;

/** Returns why `value` can't round-trip through JSON, or `null` when it can. */
export function jsonProblem(value: unknown, label = "value"): string | null {
  const seen = new Set<object>();
  const walk = (v: unknown, path: string, depth: number): string | null => {
    if (v === null) return null;
    switch (typeof v) {
      case "string":
      case "boolean":
        return null;
      case "number":
        return Number.isFinite(v) ? null : `${path} must be a finite number`;
      case "object":
        break;
      default:
        return `${path} is not JSON (${typeof v})`;
    }
    if (depth > MAX_DEPTH) return `${label} is nested too deeply`;
    const obj = v as object;
    if (seen.has(obj)) return `${path} is circular`;
    seen.add(obj);
    try {
      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
          const item: unknown = obj[i];
          if (item === undefined) return `${path}[${i}] is undefined`;
          const problem = walk(item, `${path}[${i}]`, depth + 1);
          if (problem) return problem;
        }
        return null;
      }
      // Plain objects only (any realm): Date, Map, class instances… don't survive JSON.
      const proto: unknown = Object.getPrototypeOf(obj);
      if (proto !== null && Object.getPrototypeOf(proto) !== null) return `${path} must be a plain object`;
      for (const [key, item] of Object.entries(obj)) {
        if (item === undefined) continue; // dropped by JSON, like JSON.stringify does
        const problem = walk(item, `${path}.${key}`, depth + 1);
        if (problem) return problem;
      }
      return null;
    } finally {
      seen.delete(obj);
    }
  };
  if (value === undefined) return `${label} is undefined`;
  return walk(value, label, 0);
}

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Deep copy of a JSON value (so callers can't mutate cached state). */
export function cloneJson<T extends Json | null>(value: T): T {
  return value === null || typeof value !== "object" ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Methods that act on a running match; refused while the app is in setup purpose. */
const MATCH_METHODS: ReadonlySet<RequestMethod> = new Set<RequestMethod>([
  "room.send",
  "match.submit",
  "match.forfeit",
  "state.get",
  "state.set",
  "turn.end",
  "round.set",
  // Progression belongs to played matches, not to the challenge sheet.
  "stats.report",
  "achievements.unlock",
]);

/** Methods only available in setup purpose. */
const SETUP_METHODS: ReadonlySet<RequestMethod> = new Set<RequestMethod>(["setup.submit", "setup.cancel"]);

/** Methods spectators may not call (they still receive every event). */
const SPECTATOR_BLOCKED: ReadonlySet<RequestMethod> = new Set<RequestMethod>([
  "room.send",
  "match.submit",
  "match.forfeit",
  "state.set",
  "turn.end",
  "round.set",
  "media.upload",
  "stats.report",
  "achievements.unlock",
  "storage.set",
  "storage.delete",
]);

type AccessContext = {
  purpose?: LaunchContext["purpose"];
  match?: { role?: LaunchContext["match"]["role"] } | null;
};

/**
 * Why the app may not call `method` given its launch purpose and role, or
 * `null` when it may. Hosts answer a non-null result with `forbidden`.
 * Contexts from v1 hosts (no `purpose`/`role`) count as a seated match player.
 */
export function accessProblem(method: RequestMethod, context: AccessContext): string | null {
  const purpose = context.purpose === "setup" ? "setup" : "match";
  if (purpose === "setup") {
    return MATCH_METHODS.has(method) ? `${method} is not available while setting up a challenge` : null;
  }
  if (SETUP_METHODS.has(method)) return `${method} is only available in setup mode`;
  if (context.match?.role === "spectator" && SPECTATOR_BLOCKED.has(method)) {
    return `spectators can't call ${method}`;
  }
  return null;
}

/* -------------------------------------------------------------------- */
/* Stage 3: media, entries, storage, stats, achievements                */
/* -------------------------------------------------------------------- */

export type MediaKind = MediaRef["kind"];

/** Max length of alt text (uploads and entries). */
export const ALT_TEXT_LENGTH = 1000;
/** Max length of a media URL in an entry. */
export const MEDIA_URL_LENGTH = 2048;
/** Stat keys and achievement ids: `^[a-z][a-z0-9_]{0,31}$`. */
export const MANIFEST_ID_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Duck-typed Blob check. A Blob posted from an iframe is an instance of the
 * *iframe's* `Blob`, so `instanceof Blob` fails on the host side.
 */
export function isBlobLike(value: unknown): value is Blob {
  const v = value as { arrayBuffer?: unknown; size?: unknown; type?: unknown } | null | undefined;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.arrayBuffer === "function" &&
    typeof v.size === "number" &&
    typeof v.type === "string"
  );
}

/** `"video/webm;codecs=vp9"` → `"video/webm"`. */
export function baseMime(mime: string): string {
  return String(mime).split(";")[0]!.trim().toLowerCase();
}

/** Which upload kind a mime type belongs to (`LIMITS.media`), or `null` when it isn't accepted. Parameters like `;codecs=…` are ignored. */
export function mediaKindOf(mime: string | null | undefined): MediaKind | null {
  if (typeof mime !== "string" || !mime) return null;
  const base = baseMime(mime);
  for (const kind of ["image", "audio", "video"] as const) {
    if ((LIMITS.media[kind].mimes as readonly string[]).includes(base)) return kind;
  }
  return null;
}

/** Why `file` can't be uploaded (`media.upload`), or `null`. */
export function mediaProblem(file: unknown, alt?: unknown): string | null {
  if (!isBlobLike(file)) return "file must be a Blob or File";
  const kind = mediaKindOf(file.type);
  if (!kind) {
    const allowed = (["image", "audio", "video"] as const).flatMap((k) => LIMITS.media[k].mimes).join(", ");
    return `unsupported type "${file.type || "unknown"}" (allowed: ${allowed})`;
  }
  if (file.size <= 0) return "file is empty";
  const max = LIMITS.media[kind].maxBytes;
  if (file.size > max) return `${kind} files can be at most ${Math.round(max / (1024 * 1024))} MB`;
  if (alt !== undefined && (typeof alt !== "string" || alt.length > ALT_TEXT_LENGTH)) {
    return `alt must be a string of at most ${ALT_TEXT_LENGTH} chars`;
  }
  return null;
}

/**
 * Why `url` can't be used as media in an entry, or `null`. Accepts absolute
 * http(s) URLs, same-origin paths (`/api/demo-media/…`) and `blob:` URLs (the
 * mock host's uploads). Hosts decide which of those they actually accept
 * (XApps only takes its own media storage).
 */
export function mediaUrlProblem(url: unknown, label = "url"): string | null {
  if (typeof url !== "string" || !url || url.length > MEDIA_URL_LENGTH) return `${label} must be a URL`;
  if (/[\s\\]/.test(url)) return `${label} must be an http(s) or same-origin URL`;
  if (/^https?:\/\/[^/]/i.test(url) || /^blob:/i.test(url)) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return null;
  return `${label} must be an http(s) or same-origin URL`;
}

const altProblem = (alt: unknown, label: string): string | null =>
  typeof alt === "string" && alt.trim().length > 0 && alt.length <= ALT_TEXT_LENGTH
    ? null
    : `${label} is required (at most ${ALT_TEXT_LENGTH} chars)`;

/** Why an entry's `display` is invalid, or `null`. */
export function displayProblem(display: unknown): string | null {
  if (!isPlainObject(display)) return "display must be an object";
  const d = display;
  switch (d.kind) {
    case "text":
      return typeof d.body === "string" && d.body.length <= 1000 ? null : "display.body must be ≤ 1000 chars";
    case "svg":
      return typeof d.svg === "string" && d.svg.trim().startsWith("<svg") ? null : "display.svg must be SVG markup";
    case "image":
      return mediaUrlProblem(d.url, "display.url");
    case "video":
      return (
        mediaUrlProblem(d.url, "display.url") ??
        altProblem(d.alt, "display.alt") ??
        (d.poster === undefined ? null : mediaUrlProblem(d.poster, "display.poster"))
      );
    case "audio":
      return (
        mediaUrlProblem(d.url, "display.url") ??
        altProblem(d.alt, "display.alt") ??
        (d.cover === undefined ? null : mediaUrlProblem(d.cover, "display.cover"))
      );
    case "gallery": {
      const { min, max } = LIMITS.galleryItems;
      if (!Array.isArray(d.items) || d.items.length < min || d.items.length > max) {
        return `display.items must hold ${min}–${max} images`;
      }
      for (let i = 0; i < d.items.length; i++) {
        const item: unknown = d.items[i];
        if (!isPlainObject(item)) return `display.items[${i}] must be { url, alt }`;
        const problem = mediaUrlProblem(item.url, `display.items[${i}].url`) ?? altProblem(item.alt, `display.items[${i}].alt`);
        if (problem) return problem;
      }
      return null;
    }
    default:
      return "unknown display kind";
  }
}

export function storageKeyProblem(key: unknown): string | null {
  return typeof key === "string" && key.length > 0 && key.length <= LIMITS.storageKeyLength
    ? null
    : `key must be a string of 1–${LIMITS.storageKeyLength} chars`;
}

export function storageScopeProblem(scope: unknown): string | null {
  return scope === undefined || scope === "user" || scope === "app" ? null : 'scope must be "user" or "app"';
}

export function storageValueProblem(value: unknown): string | null {
  const problem = jsonProblem(value, "value");
  if (problem) return problem;
  return byteLength(value) > LIMITS.storageValueBytes ? `value is larger than ${LIMITS.storageValueBytes / 1024} KB` : null;
}

export function storagePrefixProblem(prefix: unknown): string | null {
  return prefix === undefined || (typeof prefix === "string" && prefix.length <= LIMITS.storageKeyLength)
    ? null
    : `prefix must be a string of at most ${LIMITS.storageKeyLength} chars`;
}

export const isStorageScope = (value: unknown): value is StorageScope => value === "user" || value === "app";

/**
 * Why `values` can't be reported (`stats.report`), or `null`. With `defs`
 * (the manifest's stats), every key must be declared.
 */
export function statsProblem(values: unknown, defs?: readonly StatDef[] | null): string | null {
  if (!isPlainObject(values)) return "values must be an object of numbers";
  const entries = Object.entries(values);
  if (entries.length === 0) return "values is empty";
  if (entries.length > LIMITS.maxStats) return `at most ${LIMITS.maxStats} stats`;
  for (const [key, value] of entries) {
    if (!MANIFEST_ID_PATTERN.test(key)) return `"${key}" is not a valid stat key`;
    if (typeof value !== "number" || !Number.isFinite(value)) return `values.${key} must be a finite number`;
    if (defs && !defs.some((d) => d.key === key)) {
      return `"${key}" is not a declared stat (add it to your manifest's stats)`;
    }
  }
  return null;
}

/** Why `id` can't be unlocked, or `null`. With `defs` (the manifest's achievements), `id` must be declared. */
export function achievementProblem(id: unknown, defs?: readonly AchievementDef[] | null): string | null {
  if (typeof id !== "string" || !MANIFEST_ID_PATTERN.test(id)) return "id must be an achievement id";
  if (defs && !defs.some((d) => d.id === id)) {
    return `"${id}" is not a declared achievement (add it to your manifest's achievements)`;
  }
  return null;
}

/** Applies a stat's aggregate to the previous value (hosts and mocks). */
export function aggregateStat(aggregate: StatDef["aggregate"], previous: number | null | undefined, value: number): number {
  if (previous === null || previous === undefined) return value;
  switch (aggregate) {
    case "max":
      return Math.max(previous, value);
    case "min":
      return Math.min(previous, value);
    case "sum":
      return previous + value;
    default:
      return value;
  }
}
