import { describe, expect, it, vi } from "vitest";
import {
  mapPgError,
  parseBearer,
  parseResultBody,
  parseRoundBody,
  parseStateBody,
  parseTurnBody,
  respondMatch,
  respondOk,
  respondVersion,
  runServerApi,
  ServerApiError,
  type RpcCall,
} from "./server-api";

const SECRET = "xas_" + "0123456789abcdef".repeat(3);
const ID = "11111111-1111-4111-8111-111111111111";
const P1 = "22222222-2222-4222-8222-222222222222";
const P2 = "33333333-3333-4333-8333-333333333333";

function expect422(fn: () => unknown, message?: RegExp) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ServerApiError);
    expect((error as ServerApiError).status).toBe(422);
    expect((error as ServerApiError).code).toBe("invalid_params");
    if (message) expect((error as ServerApiError).message).toMatch(message);
    return;
  }
  throw new Error("expected a 422");
}

describe("parseBearer", () => {
  it("accepts `Bearer xas_<48 hex>`", () => {
    expect(parseBearer(`Bearer ${SECRET}`)).toBe(SECRET);
    expect(parseBearer(`bearer  ${SECRET} `)).toBe(SECRET);
  });

  it("rejects missing or malformed headers", () => {
    for (const header of [
      null,
      undefined,
      "",
      SECRET,
      `Basic ${SECRET}`,
      "Bearer",
      "Bearer xas_123",
      `Bearer ${SECRET.toUpperCase()}`,
      `Bearer ${SECRET}0`,
      `Bearer whsec_${"0".repeat(48)}`,
      `Bearer ${SECRET} extra`,
    ]) {
      expect(parseBearer(header)).toBeNull();
    }
  });
});

describe("body validation", () => {
  it("state", () => {
    expect(parseStateBody({ state: { a: 1 }, expectedVersion: 0 })).toEqual({ state: { a: 1 }, expectedVersion: 0 });
    expect(parseStateBody({ state: null, expectedVersion: 3 })).toEqual({ state: null, expectedVersion: 3 });
    expect422(() => parseStateBody(undefined), /JSON object/);
    expect422(() => parseStateBody([]), /JSON object/);
    expect422(() => parseStateBody({ expectedVersion: 0 }), /state/);
    expect422(() => parseStateBody({ state: 1 }), /expectedVersion/);
    expect422(() => parseStateBody({ state: 1, expectedVersion: -1 }), /expectedVersion/);
    expect422(() => parseStateBody({ state: 1, expectedVersion: 1.5 }), /expectedVersion/);
    expect422(() => parseStateBody({ state: 1, expectedVersion: "1" }), /expectedVersion/);
    expect422(() => parseStateBody({ state: "x".repeat(70_000), expectedVersion: 0 }), /limit/);
  });

  it("turn", () => {
    expect(parseTurnBody(undefined)).toEqual({ next: null });
    expect(parseTurnBody({})).toEqual({ next: null });
    expect(parseTurnBody({ next: null })).toEqual({ next: null });
    expect(parseTurnBody({ next: P1 })).toEqual({ next: P1 });
    expect422(() => parseTurnBody({ next: "bob" }), /next/);
    expect422(() => parseTurnBody({ next: 1 }), /next/);
    expect422(() => parseTurnBody("x"));
  });

  it("round", () => {
    expect(parseRoundBody({ round: 0 })).toEqual({ round: 0 });
    expect(parseRoundBody({ round: 7 })).toEqual({ round: 7 });
    expect422(() => parseRoundBody({}), /round/);
    expect422(() => parseRoundBody({ round: -1 }), /round/);
    expect422(() => parseRoundBody({ round: 2.5 }), /round/);
  });

  it("result", () => {
    expect(parseResultBody({ scores: { [P1]: 10, [P2]: -2.5 } })).toEqual({ scores: { [P1]: 10, [P2]: -2.5 } });
    expect(parseResultBody({ ranks: { [P1]: 1, [P2]: 1 }, leavers: [P2, P2] })).toEqual({
      ranks: { [P1]: 1, [P2]: 1 },
      leavers: [P2],
    });
    // Both are passed through; SQL lets ranks win.
    expect(parseResultBody({ scores: { [P1]: 1 }, ranks: { [P1]: 1 }, extra: true })).toEqual({
      scores: { [P1]: 1 },
      ranks: { [P1]: 1 },
    });
    expect422(() => parseResultBody({}), /scores.*ranks/);
    expect422(() => parseResultBody({ scores: {} }), /empty/);
    expect422(() => parseResultBody({ scores: [1] }), /scores/);
    expect422(() => parseResultBody({ scores: { alice: 1 } }), /player id/);
    expect422(() => parseResultBody({ scores: { [P1]: "1" } }), /finite/);
    expect422(() => parseResultBody({ ranks: { [P1]: 0 } }), /positive/);
    expect422(() => parseResultBody({ ranks: { [P1]: 1.5 } }), /positive/);
    expect422(() => parseResultBody({ scores: { [P1]: 1 }, leavers: "x" }), /leavers/);
    expect422(() => parseResultBody({ scores: { [P1]: 1 }, leavers: ["bob"] }), /leavers/);
  });
});

describe("mapPgError", () => {
  const cases: [{ code?: string; message?: string }, number, string][] = [
    [{ code: "28000", message: "bad" }, 401, "unauthorized"],
    [{ code: "P0001", message: "invalid_secret" }, 401, "unauthorized"],
    [{ code: "42501", message: "Match belongs to another app" }, 403, "forbidden"],
    [{ code: "P0002", message: "Match not found" }, 404, "not_found"],
    [{ code: "40001", message: "state moved" }, 409, "conflict"],
    [{ code: "P0001", message: "state_conflict" }, 409, "conflict"],
    [{ code: "55000", message: "Match already settled" }, 409, "invalid_state"],
    [{ code: "22023", message: "Unknown player" }, 422, "invalid_params"],
    [{ code: "22P02", message: "invalid input syntax for type uuid" }, 422, "invalid_params"],
    [{ code: "PGRST202", message: "Could not find the function" }, 500, "internal"],
    [{ code: "XX000", message: "boom" }, 500, "internal"],
    [{}, 500, "internal"],
  ];
  it.each(cases)("%o → %i %s", (error, status, code) => {
    const mapped = mapPgError(error);
    expect(mapped.status).toBe(status);
    expect(mapped.code).toBe(code);
  });

  it("passes useful messages through, hides secrets and internals", () => {
    expect(mapPgError({ code: "55000", message: "Match already settled" }).message).toBe("Match already settled");
    expect(mapPgError({ code: "28000", message: "secret hash abc does not match" }).message).toBe("Invalid app secret");
    expect(mapPgError({ code: "P0001", message: "state_conflict" }).message).toMatch(/re-read/);
    expect(mapPgError({ code: "XX000", message: "relation x does not exist" }).message).toBe("Internal error");
  });
});

describe("response shapes", () => {
  it("match / version / ok", () => {
    expect(respondMatch({ id: ID })).toEqual({ id: ID });
    expect(() => respondMatch(null)).toThrow(ServerApiError);
    expect(respondVersion(4)).toEqual({ version: 4 });
    expect(respondVersion({ version: 5 })).toEqual({ version: 5 });
    expect(() => respondVersion("x")).toThrow(ServerApiError);
    expect(respondOk()).toEqual({ ok: true });
  });
});

describe("runServerApi", () => {
  const params = Promise.resolve({ id: ID });

  function request(init: { auth?: string | null; body?: string; method?: string } = {}) {
    const headers = new Headers();
    if (init.auth !== null) headers.set("authorization", init.auth ?? `Bearer ${SECRET}`);
    return new Request(`https://xapps.test/api/v1/matches/${ID}/state`, {
      method: init.method ?? "PUT",
      headers,
      body: init.body,
    });
  }

  const stateRoute = {
    parse: parseStateBody,
    rpc: "app_api_set_state",
    args: (b: { state: unknown; expectedVersion: number }) => ({ p_state: b.state, p_expected_version: b.expectedVersion }),
    respond: respondVersion,
  };

  async function run(req: Request, rpc: RpcCall, configured = true, p = params) {
    const res = await runServerApi(req, p, stateRoute, { configured, rpc });
    return { res, status: res.status, body: await res.json() };
  }

  it("calls the RPC with the secret, match and args", async () => {
    const rpc = vi.fn<RpcCall>(async () => ({ data: 8, error: null }));
    const { res, status, body } = await run(request({ body: JSON.stringify({ state: { a: 1 }, expectedVersion: 7 }) }), rpc);
    expect(status).toBe(200);
    expect(body).toEqual({ version: 8 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).toHaveBeenCalledWith("app_api_set_state", {
      p_secret: SECRET,
      p_match: ID,
      p_state: { a: 1 },
      p_expected_version: 7,
    });
  });

  it("501 in demo mode, before anything else", async () => {
    const rpc = vi.fn<RpcCall>();
    const { status, body, res } = await run(request({ auth: null }), rpc, false);
    expect(status).toBe(501);
    expect(body.error.code).toBe("not_configured");
    expect(body.error.message).toMatch(/Supabase/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("401 without a well-formed bearer secret", async () => {
    const rpc = vi.fn<RpcCall>();
    for (const auth of [null, "Bearer nope"]) {
      const { status, body } = await run(request({ auth, body: "{}" }), rpc);
      expect(status).toBe(401);
      expect(body.error.code).toBe("unauthorized");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404 for ids that aren't uuids", async () => {
    const rpc = vi.fn<RpcCall>();
    const { status } = await run(request({ body: "{}" }), rpc, true, Promise.resolve({ id: "nope" }));
    expect(status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("422 for bad JSON and bad shapes", async () => {
    const rpc = vi.fn<RpcCall>();
    for (const body of ["{", "", JSON.stringify({ state: 1 })]) {
      const res = await run(request({ body }), rpc);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("invalid_params");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps RPC errors", async () => {
    const rpc = vi.fn<RpcCall>(async () => ({ data: null, error: { code: "40001", message: "state_conflict" } }));
    const { status, body } = await run(request({ body: JSON.stringify({ state: 1, expectedVersion: 0 }) }), rpc);
    expect(status).toBe(409);
    expect(body.error.code).toBe("conflict");
  });

  it("500 when the RPC throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn<RpcCall>(async () => {
      throw new Error("socket hang up");
    });
    const { status, body } = await run(request({ body: JSON.stringify({ state: 1, expectedVersion: 0 }) }), rpc);
    expect(status).toBe(500);
    expect(body).toEqual({ error: { code: "internal", message: "Internal error" } });
    spy.mockRestore();
  });
});
