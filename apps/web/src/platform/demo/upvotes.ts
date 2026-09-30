import { createRandom } from "@xapps/sdk";
import { BackendError } from "../backend";
import { getOfficialApp } from "../catalog";
import type { AppManifest, UpvoteResult } from "../types";
import { upvoteBlocker } from "../upvotes";
import { isPracticeBot, SHOWCASE_APPS } from "./seed";
import type { DemoDb, UpvoteRow } from "./store";

/**
 * Demo upvotes (mirrors supabase/migrations/20261006000200_app_upvotes.sql). Official and
 * showcase apps start with a plausible crowd (a seeded count plus some personas, computed from
 * the slug until someone changes them, so new catalog apps and reset worlds get them too), so
 * the marketplace's "Top" order has something to sort; apps people register start at zero.
 */

/** The upvotes an official or showcase app starts with (deterministic per slug); undefined for other apps. */
export function seededUpvotes(db: DemoDb, slug: string): UpvoteRow | undefined {
  const app = getOfficialApp(slug) ?? SHOWCASE_APPS.find((a) => a.slug === slug);
  if (!app) return undefined;
  // Seeded per slug, so an app's crowd doesn't depend on what else is in the catalog.
  const rng = createRandom(`xapps-upvotes:${slug}`);
  const crowd = app.official ? rng.int(24, 260) : rng.int(120, 380);
  const userIds = Object.values(db.profiles)
    .filter((p) => p.isBot && !isPracticeBot(p.id) && p.id !== app.developer.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter(() => rng.next() < 0.45)
    .map((p) => p.id);
  return { crowd, userIds };
}

/** Stored upvotes, or the seeded ones until someone changes them. */
function rowOf(db: DemoDb, slug: string): UpvoteRow | undefined {
  return db.upvotes?.[slug] ?? seededUpvotes(db, slug);
}

/** An app's count and whether `viewerId` upvoted it. */
export function upvoteState(db: DemoDb, slug: string, viewerId: string | null | undefined): UpvoteResult {
  const row = rowOf(db, slug);
  if (!row) return { upvotes: 0, upvoted: false };
  return { upvotes: row.crowd + row.userIds.length, upvoted: !!viewerId && row.userIds.includes(viewerId) };
}

/** The app with its upvotes as `viewerId` sees them. */
export function withUpvotes(db: DemoDb, app: AppManifest, viewerId: string | null | undefined): AppManifest {
  return { ...app, ...upvoteState(db, app.slug, viewerId) };
}

/**
 * `set_app_upvote` for `userId` on `app` (already resolved: it exists). Throws like the RPC:
 * hidden apps are not found (unless taking an upvote back), no self-upvotes, published apps only.
 */
export function setUpvote(db: DemoDb, app: AppManifest | null, userId: string, on: boolean, canSee: boolean): UpvoteResult {
  const had = !!app && (rowOf(db, app.slug)?.userIds.includes(userId) ?? false);
  const takingBack = !on && had;
  if (!app || (!canSee && !takingBack)) throw new BackendError("App not found", "not_found");
  if (on) {
    const blocker = upvoteBlocker(app, userId);
    if (blocker) throw new BackendError(blocker, app.developer.id === userId ? "forbidden" : "invalid");
    const row = rowOf(db, app.slug) ?? { crowd: 0, userIds: [] };
    if (!had) (db.upvotes ??= {})[app.slug] = { crowd: row.crowd, userIds: [...row.userIds, userId] };
  } else if (had) {
    const row = rowOf(db, app.slug)!;
    (db.upvotes ??= {})[app.slug] = { crowd: row.crowd, userIds: row.userIds.filter((id) => id !== userId) };
  }
  return upvoteState(db, app.slug, userId);
}
