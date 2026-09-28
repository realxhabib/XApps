/**
 * Rules shared by the app SDK and hosts: what counts as JSON, and which
 * requests a launch purpose / player role may make. Internal module; the
 * public surface re-exports what hosts need from `./host`.
 */
import type { Json, LaunchContext, RequestMethod } from "./protocol";

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
