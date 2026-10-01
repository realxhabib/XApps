import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_APPS } from "../catalog";
import { isOutage, noteHealthy, useHealth } from "../health";
import { profileFromAuthUser } from "./mapping";
import { SupabaseBackend } from "./supabase-backend";

type Result = { data: unknown; error: { code?: string; message: string } | null; status: number };

/** A Supabase client whose every table read answers `result` (a chainable, awaitable query). */
function fakeClient(result: Result, user: Record<string, unknown> | null = { id: "u1", created_at: "2026-01-01T00:00:00Z", user_metadata: { user_name: "greg", full_name: "Greg", avatar_url: "https://pbs.twimg.com/a_normal.jpg" } }) {
  const query = (): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "in", "limit"]) q[m] = () => q;
    q.maybeSingle = () => q;
    q.then = (resolve: (r: Result) => unknown) => Promise.resolve(result).then(resolve);
    return q;
  };
  return {
    from: query,
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }) },
  } as unknown as SupabaseClient;
}

const DOWN: Result = { data: null, error: { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }, status: 503 };

afterEach(() => noteHealthy());

describe("database outages", () => {
  it("tells outages from ordinary errors", () => {
    expect(isOutage(DOWN.error, 503)).toBe(true);
    expect(isOutage({ message: "upstream connect error" }, 502)).toBe(true);
    expect(isOutage({ code: "PGRST002", message: "" })).toBe(true);
    expect(isOutage({ message: "TypeError: Failed to fetch" }, 0)).toBe(true);
    expect(isOutage({ code: "42501", message: "permission denied" }, 403)).toBe(false);
    expect(isOutage({ code: "23505", message: "duplicate key" }, 409)).toBe(false);
    expect(isOutage(null, 503)).toBe(false);
  });

  it("lists the built-in apps and flags the outage", async () => {
    const apps = await new SupabaseBackend(fakeClient(DOWN)).listApps();
    expect(apps.map((a) => a.slug)).toEqual(OFFICIAL_APPS.map((a) => a.slug));
    expect(apps.every((a) => a.upvotes === 0 && !a.upvoted)).toBe(true);
    expect(useHealth.getState().downSince).not.toBeNull();
  });

  it("opens a built-in app's page and explains the rest", async () => {
    const backend = new SupabaseBackend(fakeClient(DOWN));
    expect((await backend.getApp(OFFICIAL_APPS[0]!.slug))?.name).toBe(OFFICIAL_APPS[0]!.name);
    await expect(backend.getApp("someones-community-app")).rejects.toThrow(/can't reach its database/);
  });

  it("keeps the viewer signed in from the session", async () => {
    const viewer = await new SupabaseBackend(fakeClient(DOWN)).getViewer();
    expect(viewer).toMatchObject({ id: "u1", handle: "greg", name: "Greg", avatarUrl: "https://pbs.twimg.com/a_400x400.jpg", xp: 0 });
    expect(await new SupabaseBackend(fakeClient(DOWN, null)).getViewer()).toBeNull();
  });

  it("clears the outage on the next good answer", async () => {
    await new SupabaseBackend(fakeClient(DOWN)).listApps();
    expect(useHealth.getState().downSince).not.toBeNull();
    await new SupabaseBackend(fakeClient({ data: [], error: null, status: 200 })).listApps();
    expect(useHealth.getState().downSince).toBeNull();
  });

  it("still fails real errors", async () => {
    const backend = new SupabaseBackend(fakeClient({ data: null, error: { code: "42501", message: "permission denied for table apps" }, status: 403 }));
    await expect(backend.listApps()).rejects.toThrow(/permission denied/);
    expect(useHealth.getState().downSince).toBeNull();
  });

  it("builds a stand-in profile from sparse metadata", () => {
    expect(profileFromAuthUser({ id: "x", user_metadata: { preferred_username: "@sam" } })).toMatchObject({ handle: "sam", name: "sam", avatarUrl: null });
  });
});
