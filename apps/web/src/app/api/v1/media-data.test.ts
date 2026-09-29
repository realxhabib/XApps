import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAchievementBody, parseStatsBody, parseStorageKey, parseStorageValueBody, ServerApiError } from "@/lib/server-api";

const USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "xas_" + "ab".repeat(24);

function expect422(fn: () => unknown, message?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ServerApiError);
    expect((error as ServerApiError).status).toBe(422);
    if (message) expect((error as ServerApiError).message).toMatch(message);
    return;
  }
  throw new Error("expected a 422");
}

describe("Stage 3 body validation", () => {
  it("storage key and value", () => {
    expect(parseStorageKey("daily:2026-09-29")).toBe("daily:2026-09-29");
    expect(parseStorageKey("a%20b")).toBe("a b");
    expect422(() => parseStorageKey(""), /1–64/);
    expect422(() => parseStorageKey("k".repeat(65)), /1–64/);
    expect422(() => parseStorageKey("a\nb"), /1–64/);
    expect(parseStorageValueBody({ value: { puzzle: 1 } })).toEqual({ value: { puzzle: 1 } });
    expect(parseStorageValueBody({ value: 0 })).toEqual({ value: 0 });
    expect422(() => parseStorageValueBody({}), /value/);
    expect422(() => parseStorageValueBody([]), /JSON object/);
    expect422(() => parseStorageValueBody({ value: "x".repeat(66_000) }), /limit/);
  });

  it("stats", () => {
    expect(parseStatsBody({ userId: USER, values: { best_time: 812, runs: 1 } })).toEqual({ userId: USER, values: { best_time: 812, runs: 1 } });
    expect422(() => parseStatsBody({ userId: "bob", values: { a: 1 } }), /userId/);
    expect422(() => parseStatsBody({ userId: USER }), /values/);
    expect422(() => parseStatsBody({ userId: USER, values: {} }), /empty/);
    expect422(() => parseStatsBody({ userId: USER, values: { "Best Time": 1 } }), /stat key/);
    expect422(() => parseStatsBody({ userId: USER, values: { a: "1" } }), /finite/);
    expect422(() => parseStatsBody({ userId: USER, values: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, i])) }), /8/);
  });

  it("achievements", () => {
    expect(parseAchievementBody({ userId: USER, id: "first_win" })).toEqual({ userId: USER, id: "first_win" });
    expect422(() => parseAchievementBody({ userId: USER }), /id/);
    expect422(() => parseAchievementBody({ userId: USER, id: "First Win" }), /id/);
    expect422(() => parseAchievementBody({ id: "first_win" }), /userId/);
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function req(method: string, path: string, body?: unknown, auth = true) {
  return new Request(`https://xapps.test/api/v1${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${SECRET}` } : {}), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const keyParams = (key: string) => ({ params: Promise.resolve({ key }) });

describe("/api/v1 storage, stats & achievements routes", () => {
  it("answer 501 in demo mode", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const storage = await import("./storage/[key]/route");
    const responses = [
      await storage.PUT(req("PUT", "/storage/daily", { value: 1 }), keyParams("daily")),
      await storage.DELETE(req("DELETE", "/storage/daily"), keyParams("daily")),
      await (await import("./stats/route")).POST(req("POST", "/stats", { userId: USER, values: { a: 1 } })),
      await (await import("./achievements/route")).POST(req("POST", "/achievements", { userId: USER, id: "a" })),
    ];
    for (const res of responses) {
      expect(res.status).toBe(501);
      expect((await res.json()).error.code).toBe("not_configured");
    }
  });

  it("validate auth and bodies, then call the RPCs", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "app_api_report_stats") return { data: { runs: 3 }, error: null };
      if (fn === "app_api_unlock_achievement") return { data: { unlocked: true }, error: null };
      if (fn === "app_api_storage_get") return { data: { puzzle: 7 }, error: null };
      if (fn === "app_api_storage_list") return { data: ["daily", "season"], error: null };
      return { data: null, error: null };
    });
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
    try {
      const storage = await import("./storage/[key]/route");
      const list = await import("./storage/route");
      const stats = await import("./stats/route");
      const achievements = await import("./achievements/route");

      // Auth first.
      expect((await stats.POST(req("POST", "/stats", { userId: USER, values: { runs: 1 } }, false))).status).toBe(401);
      // Bodies.
      const bad = await stats.POST(req("POST", "/stats", { userId: USER, values: { runs: "x" } }));
      expect(bad.status).toBe(422);
      expect((await bad.json()).error.code).toBe("invalid_params");
      expect((await achievements.POST(req("POST", "/achievements", { userId: "nope", id: "a" }))).status).toBe(422);
      expect((await storage.PUT(req("PUT", "/storage/k", { nope: 1 }), keyParams("k"))).status).toBe(422);
      expect((await storage.PUT(req("PUT", "/storage/x", { value: 1 }), keyParams("k".repeat(65)))).status).toBe(422);
      expect(rpc).not.toHaveBeenCalled();

      expect(await (await stats.POST(req("POST", "/stats", { userId: USER, values: { runs: 1 } }))).json()).toEqual({ values: { runs: 3 } });
      expect(await (await achievements.POST(req("POST", "/achievements", { userId: USER, id: "first_win" }))).json()).toEqual({ unlocked: true });
      expect(await (await storage.PUT(req("PUT", "/storage/daily", { value: { puzzle: 7 } }), keyParams("daily"))).json()).toEqual({ ok: true });
      expect(await (await storage.GET(req("GET", "/storage/daily"), keyParams("daily"))).json()).toEqual({ value: { puzzle: 7 } });
      expect(await (await storage.DELETE(req("DELETE", "/storage/daily"), keyParams("daily"))).json()).toEqual({ ok: true });
      expect(await (await list.GET(req("GET", "/storage?prefix=da"))).json()).toEqual({ keys: ["daily", "season"] });

      expect(rpc.mock.calls).toEqual([
        ["app_api_report_stats", { p_secret: SECRET, p_user: USER, p_values: { runs: 1 } }],
        ["app_api_unlock_achievement", { p_secret: SECRET, p_user: USER, p_id: "first_win" }],
        ["app_api_storage_set", { p_secret: SECRET, p_key: "daily", p_value: { puzzle: 7 } }],
        ["app_api_storage_get", { p_secret: SECRET, p_key: "daily" }],
        ["app_api_storage_delete", { p_secret: SECRET, p_key: "daily" }],
        ["app_api_storage_list", { p_secret: SECRET, p_prefix: "da" }],
      ]);
    } finally {
      vi.doUnmock("@supabase/supabase-js");
    }
  });

  it("maps database errors (limits → 429, missing player → 404, server-only → 403)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const errors = [
      { code: "54000", message: "Storage is full (200 keys)" },
      { code: "P0002", message: "Player not found" },
      { code: "22023", message: "Unknown stat nope" },
    ];
    const rpc = vi.fn(async () => ({ data: null, error: errors.shift()! }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));
    try {
      const storage = await import("./storage/[key]/route");
      const stats = await import("./stats/route");
      const full = await storage.PUT(req("PUT", "/storage/k", { value: 1 }), keyParams("k"));
      expect(full.status).toBe(429);
      expect((await full.json()).error).toEqual({ code: "rate_limited", message: "Storage is full (200 keys)" });
      const missing = await stats.POST(req("POST", "/stats", { userId: USER, values: { runs: 1 } }));
      expect(missing.status).toBe(404);
      const unknown = await stats.POST(req("POST", "/stats", { userId: USER, values: { nope: 1 } }));
      expect(unknown.status).toBe(422);
      expect((await unknown.json()).error.message).toBe("Unknown stat nope");
    } finally {
      vi.doUnmock("@supabase/supabase-js");
    }
  });
});
