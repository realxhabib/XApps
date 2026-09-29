// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { XAppsError } from "../src/protocol";
import {
  createServerClient,
  signWebhook,
  verifyWebhook,
  type ServerMatch,
  type WebhookEvent,
} from "../src/server";

const SECRET = "whsec_" + "ab".repeat(24);
const NOW = 1_790_000_000;

function match(overrides: Partial<ServerMatch> = {}): ServerMatch {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    appSlug: "demo",
    mode: "live",
    status: "active",
    scoring: "high",
    seed: "s",
    createdBy: "alice",
    createdAt: "2026-09-28T00:00:00Z",
    startedAt: null,
    endedAt: null,
    winnerId: null,
    isOpen: false,
    settings: {},
    votes: {},
    votesNeeded: 0,
    votingEndsAt: null,
    players: [],
    simulatedVotes: false,
    minPlayers: 2,
    maxPlayers: 2,
    teams: 0,
    winnerTeam: null,
    spectatorCount: 0,
    state: null,
    stateVersion: 0,
    turnUserId: null,
    turnDeadline: null,
    round: 0,
    ...overrides,
  };
}

const event = {
  id: "evt_1",
  type: "match.ended",
  createdAt: "2026-09-28T00:00:00Z",
  app: { slug: "demo" },
  match: match({ status: "completed" }),
  reason: "server_timeout",
};
const body = JSON.stringify(event);

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(XAppsError);
  expect((error as XAppsError).code).toBe(code);
}

describe("webhook signatures", () => {
  it("round-trips sign → verify and returns the typed event", async () => {
    const header = await signWebhook(body, SECRET, NOW);
    expect(header).toMatch(/^t=1790000000,v1=[0-9a-f]{64}$/);
    const verified: WebhookEvent = await verifyWebhook(body, header, SECRET, { now: NOW + 10 });
    expect(verified).toEqual(event);
    if (verified.type === "match.ended") expect(verified.reason).toBe("server_timeout");
  });

  it("matches an independent HMAC-SHA256 over `t.body`", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${NOW}.${body}`)));
    const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await signWebhook(body, SECRET, NOW)).toBe(`t=${NOW},v1=${hex}`);
  });

  it("accepts raw bytes and a Date for now", async () => {
    const header = await signWebhook(body, SECRET, NOW);
    const verified = await verifyWebhook(new TextEncoder().encode(body), header, SECRET, {
      now: new Date(NOW * 1000),
    });
    expect(verified.id).toBe("evt_1");
  });

  it("rejects a tampered body", async () => {
    const header = await signWebhook(body, SECRET, NOW);
    await expectCode(verifyWebhook(body.replace("evt_1", "evt_2"), header, SECRET, { now: NOW }), "invalid_signature");
  });

  it("rejects the wrong secret", async () => {
    const header = await signWebhook(body, "whsec_other", NOW);
    await expectCode(verifyWebhook(body, header, SECRET, { now: NOW }), "invalid_signature");
  });

  it("rejects a tampered timestamp", async () => {
    const header = (await signWebhook(body, SECRET, NOW)).replace(`t=${NOW}`, `t=${NOW + 1}`);
    await expectCode(verifyWebhook(body, header, SECRET, { now: NOW }), "invalid_signature");
  });

  it("rejects stale (and far-future) timestamps", async () => {
    const header = await signWebhook(body, SECRET, NOW);
    await expectCode(verifyWebhook(body, header, SECRET, { now: NOW + 301 }), "stale_signature");
    await expectCode(verifyWebhook(body, header, SECRET, { now: NOW - 301 }), "stale_signature");
    await expect(verifyWebhook(body, header, SECRET, { now: NOW + 300 })).resolves.toBeTruthy();
    await expect(verifyWebhook(body, header, SECRET, { now: NOW + 3600, toleranceSeconds: 3600 })).resolves.toBeTruthy();
  });

  it("uses the clock by default", async () => {
    vi.useFakeTimers({ now: NOW * 1000 });
    try {
      const header = await signWebhook(body, SECRET);
      expect(header.startsWith(`t=${NOW},`)).toBe(true);
      await expect(verifyWebhook(body, header, SECRET)).resolves.toBeTruthy();
      vi.setSystemTime((NOW + 600) * 1000);
      await expectCode(verifyWebhook(body, header, SECRET), "stale_signature");
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts any of several v1 signatures (secret rotation)", async () => {
    const oldSig = (await signWebhook(body, "whsec_old", NOW)).split(",")[1];
    const newSig = (await signWebhook(body, SECRET, NOW)).split(",")[1];
    const header = `t=${NOW},${oldSig}, ${newSig}`;
    expect((await verifyWebhook(body, header, SECRET, { now: NOW })).id).toBe("evt_1");
    expect((await verifyWebhook(body, header, "whsec_old", { now: NOW })).id).toBe("evt_1");
    await expectCode(verifyWebhook(body, header, "whsec_third", { now: NOW }), "invalid_signature");
  });

  it("rejects missing or malformed headers", async () => {
    for (const header of [null, "", "garbage", `t=${NOW}`, "v1=abcd", `t=abc,v1=${"0".repeat(64)}`, `t=${NOW},v1=zz`]) {
      await expectCode(verifyWebhook(body, header, SECRET, { now: NOW }), "invalid_signature");
    }
  });

  it("normalizes ping events and reports bodies that aren't events", async () => {
    const ping = JSON.stringify({ id: "evt_p", type: "ping", createdAt: "2026-09-28T00:00:00Z", app: "demo" });
    const verified = await verifyWebhook(ping, await signWebhook(ping, SECRET, NOW), SECRET, { now: NOW });
    expect(verified).toMatchObject({ type: "ping", app: { slug: "demo" }, match: null });

    const junk = "[1,2]";
    await expectCode(verifyWebhook(junk, await signWebhook(junk, SECRET, NOW), SECRET, { now: NOW }), "invalid_payload");
  });
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(responder: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const SECRET_KEY = "xas_" + "0f".repeat(24);
const ID = "11111111-1111-4111-8111-111111111111";

describe("createServerClient", () => {
  it("sends the right requests", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === "GET") return Response.json(match({ stateVersion: 3 }));
      if (call.url.endsWith("/state")) return Response.json({ version: 4 });
      return Response.json({ ok: true });
    });
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test/", fetch });

    expect((await api.getMatch(ID)).stateVersion).toBe(3);
    expect(await api.setState(ID, { board: [1] }, 3)).toEqual({ version: 4 });
    await api.endTurn(ID);
    await api.endTurn(ID, "bob");
    await api.setRound(ID, 2);
    await api.reportResult(ID, { scores: { alice: 10, bob: 7 } }, { leavers: ["cara"] });
    await api.reportResult(ID, { ranks: { alice: 2, bob: 1 } });

    const base = `https://xapps.test/api/v1/matches/${ID}`;
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["GET", base, undefined],
      ["PUT", `${base}/state`, { state: { board: [1] }, expectedVersion: 3 }],
      ["POST", `${base}/turn`, {}],
      ["POST", `${base}/turn`, { next: "bob" }],
      ["POST", `${base}/round`, { round: 2 }],
      ["POST", `${base}/result`, { scores: { alice: 10, bob: 7 }, leavers: ["cara"] }],
      ["POST", `${base}/result`, { ranks: { alice: 2, bob: 1 } }],
    ]);
    for (const c of calls) expect(c.headers.Authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(calls[0]!.headers["Content-Type"]).toBeUndefined();
    expect(calls[1]!.headers["Content-Type"]).toBe("application/json");
  });

  it("maps error JSON to XAppsError", async () => {
    const { fetch } = fakeFetch(() =>
      Response.json({ error: { code: "conflict", message: "State version moved" } }, { status: 409 }),
    );
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    const error = await api.setState(ID, 1, 0).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XAppsError);
    expect(error).toMatchObject({ code: "conflict", message: "State version moved" });
  });

  it("falls back to status codes without an error body", async () => {
    const statuses: [number, string][] = [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [409, "conflict"],
      [422, "invalid_params"],
      [501, "not_configured"],
      [502, "internal"],
    ];
    for (const [status, code] of statuses) {
      const { fetch } = fakeFetch(() => new Response("nope", { status }));
      const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
      await expectCode(api.getMatch(ID), code);
    }
  });

  it("wraps network failures", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expectCode(api.getMatch(ID), "network");
  });

  it("validates arguments locally", async () => {
    const { fetch, calls } = fakeFetch(() => Response.json({}));
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expectCode(api.setState(ID, 1, -1), "invalid_params");
    await expectCode(api.setRound(ID, 1.5), "invalid_params");
    await expectCode(api.reportResult(ID, {} as never), "invalid_params");
    expect(calls).toHaveLength(0);
    expect(() => createServerClient({ secret: "", baseUrl: "https://x" })).toThrow(XAppsError);
  });

  it("updateState re-reads and retries on conflict", async () => {
    let version = 0;
    let state: { n: number } = { n: 0 };
    let sets = 0;
    const { fetch, calls } = fakeFetch((call) => {
      if (call.method === "GET") {
        // Someone else writes between our read and our first write.
        const snapshot = match({ state, stateVersion: version });
        if (sets === 0) {
          state = { n: state.n + 100 };
          version++;
        }
        return Response.json(snapshot);
      }
      sets++;
      const { expectedVersion, state: next } = call.body as { expectedVersion: number; state: { n: number } };
      if (expectedVersion !== version) {
        return Response.json({ error: { code: "conflict", message: "moved" } }, { status: 409 });
      }
      state = next;
      version++;
      return Response.json({ version });
    });
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    const seen: number[] = [];
    const result = await api.updateState<{ n: number }>(ID, (s, m) => {
      seen.push(m.stateVersion);
      return { n: (s?.n ?? 0) + 1 };
    });
    expect(result).toEqual({ state: { n: 101 }, version: 2 });
    expect(seen).toEqual([0, 1]);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "GET", "PUT"]);
  });

  it("updateState gives up after `retries` and skips writes for undefined", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === "GET"
        ? Response.json(match({ state: { n: 1 }, stateVersion: 5 }))
        : Response.json({ error: { code: "conflict", message: "moved" } }, { status: 409 }),
    );
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expectCode(
      api.updateState(ID, () => ({ n: 2 }), { retries: 2 }),
      "conflict",
    );
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(3);

    calls.length = 0;
    expect(await api.updateState(ID, () => undefined)).toEqual({ state: { n: 1 }, version: 5 });
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("doesn't retry other errors", async () => {
    const { fetch, calls } = fakeFetch((call) =>
      call.method === "GET"
        ? Response.json(match())
        : Response.json({ error: { code: "invalid_state", message: "Match already settled" } }, { status: 409 }),
    );
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expectCode(api.updateState(ID, () => 1), "invalid_state");
    expect(calls).toHaveLength(2);
  });

  it("writes app storage, reports stats and unlocks achievements", async () => {
    const { fetch, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/stats")) return Response.json({ values: { best: 12 } });
      if (call.url.endsWith("/achievements")) return Response.json({ unlocked: true });
      if (call.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ ok: true });
    });
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await api.storageSet("puzzle:2026-09-29", { grid: [1, 2, 3] });
    await api.storageDelete("puzzle/old key");
    await expect(api.reportStats("alice", { best: 12 })).resolves.toEqual({ best: 12 });
    await expect(api.unlockAchievement("alice", "first_win")).resolves.toEqual({ unlocked: true });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["PUT", "https://xapps.test/api/v1/storage/puzzle%3A2026-09-29", { value: { grid: [1, 2, 3] } }],
      ["DELETE", "https://xapps.test/api/v1/storage/puzzle%2Fold%20key", undefined],
      ["POST", "https://xapps.test/api/v1/stats", { userId: "alice", values: { best: 12 } }],
      ["POST", "https://xapps.test/api/v1/achievements", { userId: "alice", id: "first_win" }],
    ]);
    for (const c of calls) expect(c.headers.Authorization).toBe(`Bearer ${SECRET_KEY}`);
    expect(calls[1]!.headers["Content-Type"]).toBeUndefined();
  });

  it("maps errors and validates the new methods locally", async () => {
    const { fetch } = fakeFetch(() => Response.json({ error: { code: "forbidden", message: "Not your app" } }, { status: 403 }));
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expectCode(api.storageSet("k", 1), "forbidden");
    await expectCode(api.unlockAchievement("alice", "gg"), "forbidden");

    const local = fakeFetch(() => Response.json({}));
    const checked = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch: local.fetch });
    await expectCode(checked.storageSet("", 1), "invalid_params");
    await expectCode(checked.storageSet("k", "x".repeat(64 * 1024)), "invalid_params");
    await expectCode(checked.storageSet("k", undefined as never), "invalid_params");
    await expectCode(checked.storageDelete("x".repeat(65)), "invalid_params");
    await expectCode(checked.reportStats("", { best: 1 }), "invalid_params");
    await expectCode(checked.reportStats("alice", { best: Number.NaN }), "invalid_params");
    await expectCode(checked.reportStats("alice", {}), "invalid_params");
    await expectCode(checked.unlockAchievement("alice", "Not An Id"), "invalid_params");
    expect(local.calls).toHaveLength(0);
  });

  it("tolerates a bare values object from POST /stats and non-boolean unlocked", async () => {
    const { fetch } = fakeFetch((call) =>
      call.url.endsWith("/stats") ? Response.json({ best: 3 }) : Response.json({ unlocked: "yes" }),
    );
    const api = createServerClient({ secret: SECRET_KEY, baseUrl: "https://xapps.test", fetch });
    await expect(api.reportStats("alice", { best: 3 })).resolves.toEqual({ best: 3 });
    await expect(api.unlockAchievement("alice", "gg")).resolves.toEqual({ unlocked: false });
  });
});

describe("player webhook events", () => {
  it("verifies achievement.unlocked events", async () => {
    const unlocked = JSON.stringify({
      id: "evt_a",
      type: "achievement.unlocked",
      createdAt: "2026-09-29T00:00:00Z",
      app: { slug: "demo" },
      match: null,
      userId: "alice",
      achievementId: "first_win",
    });
    const event = await verifyWebhook(unlocked, await signWebhook(unlocked, SECRET, NOW), SECRET, { now: NOW });
    expect(event.type).toBe("achievement.unlocked");
    if (event.type === "achievement.unlocked") {
      expect(event.achievementId).toBe("first_win");
      expect(event.userId).toBe("alice");
      expect(event.match).toBeNull();
    }
  });
});
