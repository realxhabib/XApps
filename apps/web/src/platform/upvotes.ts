/**
 * App upvotes: the rules both backends share (supabase/migrations/20261006000200_app_upvotes.sql)
 * and the marketplace's sort orders. Pure, so it is unit tested.
 */
import type { AppManifest, UpvoteResult } from "./types";

/** `set_app_upvote` calls per person per minute (the SQL rate limit). */
export const UPVOTES_PER_MINUTE = 30;

/** Marketplace orders: most upvoted, or newest first. */
export type AppSort = "top" | "new";

/** Most upvoted first; ties go to the most played, then the newest, then by name. */
export function compareByUpvotes(a: AppManifest, b: AppManifest): number {
  return (b.upvotes ?? 0) - (a.upvotes ?? 0) || b.playCount - a.playCount || compareByNewest(a, b);
}

/** Newest first; ties by name. */
export function compareByNewest(a: AppManifest, b: AppManifest): number {
  return b.createdAt.localeCompare(a.createdAt) || a.name.localeCompare(b.name);
}

/** A sorted copy. */
export function sortApps(apps: readonly AppManifest[], sort: AppSort): AppManifest[] {
  return [...apps].sort(sort === "new" ? compareByNewest : compareByUpvotes);
}

/** The app right after the viewer upvotes it (`on`) or takes the upvote back, before the backend answers. */
export function withUpvote(app: AppManifest, on: boolean): AppManifest {
  if ((app.upvoted ?? false) === on) return app;
  return { ...app, upvoted: on, upvotes: Math.max(0, (app.upvotes ?? 0) + (on ? 1 : -1)) };
}

/** The app with the backend's answer. */
export function withUpvoteResult(app: AppManifest, result: UpvoteResult): AppManifest {
  return { ...app, upvotes: result.upvotes, upvoted: result.upvoted };
}

/**
 * Why `viewerId` can't upvote `app` (null when they can; signed out is the caller's sign-in
 * prompt, not a blocker). Mirrors set_app_upvote: published apps only, and no self-upvotes.
 */
export function upvoteBlocker(app: Pick<AppManifest, "status" | "developer">, viewerId: string | null | undefined): string | null {
  if (viewerId && app.developer.id === viewerId) return "You can't upvote your own app";
  if (app.status !== "published") return "Only published apps can be upvoted";
  return null;
}
