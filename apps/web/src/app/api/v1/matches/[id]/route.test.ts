import { afterEach, describe, expect, it, vi } from "vitest";

const ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "xas_" + "ab".repeat(24);
const params = () => Promise.resolve({ id: ID });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function req(method: string, path = "", body?: unknown) {
  return new Request(`https://xapps.test/api/v1/matches/${ID}${path}`, {
    method,
    headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("/api/v1/matches/[id] in demo mode", () => {
  it("every route answers 501 with a clear message", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const responses = [
      await (await import("./route")).GET(req("GET"), { params: params() }),
      await (await import("./state/route")).PUT(req("PUT", "/state", { state: 1, expectedVersion: 0 }), { params: params() }),
      await (await import("./turn/route")).POST(req("POST", "/turn", {}), { params: params() }),
      await (await import("./round/route")).POST(req("POST", "/round", { round: 1 }), { params: params() }),
      await (await import("./result/route")).POST(req("POST", "/result", { ranks: { [ID]: 1 } }), { params: params() }),
    ];
    for (const res of responses) {
      expect(res.status).toBe(501);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body.error.code).toBe("not_configured");
      expect(body.error.message).toMatch(/demo mode/);
    }
  });
});

describe("/api/v1/matches/[id] with Supabase", () => {
  it("calls the RPCs through a cookieless supabase-js client", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    const rpc = vi.fn(async (fn: string) => ({
      data: fn === "app_api_get_match" ? { id: ID, stateVersion: 2 } : fn === "app_api_set_state" ? 3 : null,
      error: null,
    }));
    const createClient = vi.fn(() => ({ rpc }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    try {
      const get = await (await import("./route")).GET(req("GET"), { params: params() });
      expect(await get.json()).toEqual({ id: ID, stateVersion: 2 });
      const put = await (await import("./state/route")).PUT(req("PUT", "/state", { state: { a: 1 }, expectedVersion: 2 }), {
        params: params(),
      });
      expect(await put.json()).toEqual({ version: 3 });
      const result = await (await import("./result/route")).POST(
        req("POST", "/result", { scores: { [ID]: 5 }, leavers: [] }),
        { params: params() },
      );
      expect(await result.json()).toEqual({ ok: true });

      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createClient).toHaveBeenCalledWith(
        "https://proj.supabase.test",
        "sb_publishable_test",
        expect.objectContaining({ auth: expect.objectContaining({ persistSession: false }) }),
      );
      expect(rpc.mock.calls).toEqual([
        ["app_api_get_match", { p_secret: SECRET, p_match: ID }],
        ["app_api_set_state", { p_secret: SECRET, p_match: ID, p_state: { a: 1 }, p_expected_version: 2 }],
        ["app_api_report_result", { p_secret: SECRET, p_match: ID, p_result: { scores: { [ID]: 5 }, leavers: [] } }],
      ]);
    } finally {
      vi.doUnmock("@supabase/supabase-js");
    }
  });
});
