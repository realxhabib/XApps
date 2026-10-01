import { resetFakeBrowser } from "../demo/fake-browser";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import { OFFICIAL_APPS } from "../catalog";
import { isOfflineMatch, noteHealthy } from "../health";
import { SupabaseBackend } from "./supabase-backend";

type Result = { data: unknown; error: { code?: string; message: string } | null; status: number };

const DOWN: Result = { data: null, error: { code: "PGRST002", message: "Could not query the database for the schema cache. Retrying." }, status: 503 };
const USER = { id: "5b0c6e2e-0000-4000-8000-000000000001", created_at: "2026-01-01T00:00:00Z", user_metadata: { user_name: "greg", full_name: "Greg" } };

/** A Supabase client whose every RPC answers `rpc`, signed in as USER (or signed out). */
function fakeClient(rpc: Result, user: typeof USER | null = USER) {
  const calls: string[] = [];
  const client = {
    rpc: async (fn: string) => {
      calls.push(fn);
      return rpc;
    },
    auth: { getSession: async () => ({ data: { session: user ? { user } : null } }) },
  } as unknown as SupabaseClient;
  return { client, calls };
}

let live: SupabaseBackend[] = [];
function backendWith(rpc: Result, user: typeof USER | null = USER) {
  const { client, calls } = fakeClient(rpc, user);
  const backend = new SupabaseBackend(client);
  live.push(backend);
  return { backend, calls };
}

afterEach(() => {
  for (const b of live) (b as unknown as { offline: { dispose(): void } | null }).offline?.dispose();
  live = [];
  noteHealthy();
  resetFakeBrowser();
});

const game = OFFICIAL_APPS.find((a) => a.kind !== "app" && a.modes.includes("practice"))!;

describe("offline practice (database down)", () => {
  it("starts a practice on this device, seating the real viewer against bots", async () => {
    const { backend } = backendWith(DOWN);
    const match = await backend.startPractice(game.slug);
    expect(isOfflineMatch(match.id)).toBe(true);
    expect(match.mode).toBe("practice");
    const me = match.players.find((p) => p.userId === USER.id);
    expect(me?.profile.handle).toBe("greg");
    expect(match.players.filter((p) => p.isBot).length).toBeGreaterThan(0);
  });

  it("keeps every later call for that match local, even from a fresh backend (a reload)", async () => {
    const { backend } = backendWith(DOWN);
    const match = await backend.startPractice(game.slug);
    const { backend: reloaded, calls } = backendWith(DOWN);
    const again = await reloaded.getMatch(match.id);
    expect(again?.id).toBe(match.id);
    await reloaded.heartbeat(match.id);
    await reloaded.logAppEvent({ appSlug: game.slug, matchId: match.id, level: "info", message: "hi", source: "app" });
    expect(calls).toEqual([]);
  });

  it("still uses the server when it answers, and never goes offline for real errors", async () => {
    const { backend } = backendWith({ data: null, error: { code: "42501", message: "permission denied" }, status: 403 });
    await expect(backend.startPractice(game.slug)).rejects.toThrow(/permission denied/);
  });

  it("needs a signed-in viewer, a built-in app and no test build", async () => {
    await expect(backendWith(DOWN, null).backend.startPractice(game.slug)).rejects.toThrow(/Sign in/);
    await expect(backendWith(DOWN).backend.startPractice("someones-community-app")).rejects.toThrow(/can't reach its database/);
    await expect(backendWith(DOWN).backend.startPractice(game.slug, undefined, "v-123")).rejects.toThrow(/can't reach its database/);
  });

  it("tells offline match ids from real ones", () => {
    expect(isOfflineMatch("m-abc123def456")).toBe(true);
    expect(isOfflineMatch(USER.id)).toBe(false);
    expect(isOfflineMatch(null)).toBe(false);
  });
});
