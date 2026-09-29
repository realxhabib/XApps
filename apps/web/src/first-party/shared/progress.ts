import type { XAppsClient } from "@xapps/sdk";

/**
 * Stats & achievements for first-party apps, through the public SDK only.
 *
 * Both helpers are fire-and-forget: they never throw, never block gameplay,
 * and do nothing for spectators, bots or outside a match (setup purpose).
 * Each app decides *what* was earned in its pure `logic.ts`; these just send it.
 */

type Client = Pick<XAppsClient, "purpose" | "isSpectator" | "me" | "stats" | "achievements">;

/** Whether this client may record progress for its own player. */
export function canTrackProgress(xapps: Client): boolean {
  return xapps.purpose === "match" && !xapps.isSpectator && !xapps.me.isBot;
}

/**
 * Reports the finite values among `values` (null/undefined are skipped, and
 * keys the manifest doesn't declare are dropped when the host sent the defs).
 */
export function reportStats(xapps: Client, values: { [key: string]: number | null | undefined }, tag = "xapps"): void {
  if (!canTrackProgress(xapps)) return;
  const declared = xapps.stats.defs;
  const clean: { [key: string]: number } = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (declared.length > 0 && !declared.some((d) => d.key === key)) continue;
    clean[key] = value;
  }
  if (Object.keys(clean).length === 0) return;
  try {
    xapps.stats.report(clean).catch((error: unknown) => console.warn(`[${tag}] stats.report failed`, error));
  } catch (error) {
    console.warn(`[${tag}] stats.report failed`, error);
  }
}

/** Errors worth retrying later (the request may succeed next time). */
const TRANSIENT = new Set(["timeout", "not_connected", "rate_limited", "internal"]);

const isTransient = (error: unknown): boolean =>
  !(error instanceof Error && "code" in error && typeof error.code === "string" && !TRANSIENT.has(error.code));

/** Ids already requested per client, so re-renders and repeated checks send each one once. */
const requested = new WeakMap<object, Set<string>>();

/**
 * Unlocks each of `ids` once per session, in order (the host shows the unlock
 * moment for new ones). A request that failed for a transient reason (timeout,
 * rate limit…) may be retried by a later call.
 */
export function unlockAchievements(xapps: Client, ids: Iterable<string>, tag = "xapps"): void {
  if (!canTrackProgress(xapps)) return;
  let sent = requested.get(xapps);
  if (!sent) {
    sent = new Set();
    requested.set(xapps, sent);
  }
  const declared = xapps.achievements.defs;
  for (const id of ids) {
    if (sent.has(id) || xapps.achievements.unlocked.has(id)) continue;
    if (declared.length > 0 && !declared.some((d) => d.id === id)) continue;
    sent.add(id);
    const retry = (error: unknown) => {
      if (isTransient(error)) sent.delete(id);
      console.warn(`[${tag}] achievements.unlock(${id}) failed`, error);
    };
    try {
      xapps.achievements.unlock(id).catch(retry);
    } catch (error) {
      retry(error);
    }
  }
}
