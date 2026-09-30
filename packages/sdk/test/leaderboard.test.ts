import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { accessProblem, createHostCore, rankStatValues, standaloneMatch, validateRequest, type HostHandlers } from "../src/host";
import { createMockHost, type MockHostOptions } from "../src/mock-host";
import type { LaunchContext, StatDef, StatStanding } from "../src/protocol";
import { XAppsProvider, useStatStanding, type StatStandingHook } from "../src/react";
import { createMemoryTransportPair } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetConnection());

const STATS: StatDef[] = [
  { key: "best", label: "Best", aggregate: "max", format: "percent" },
  { key: "fastest", label: "Fastest", aggregate: "min", format: "ms" },
];

const user = { id: "alice", handle: "alice", name: "Alice", avatarUrl: null };

function context(purpose: LaunchContext["purpose"], role: "player" | "spectator" = "player"): LaunchContext {
  return {
    purpose,
    app: { id: "circle", slug: "circle", name: "Circle", stats: STATS },
    user,
    match: { ...standaloneMatch(user, { id: "m1" }), role, seat: role === "spectator" ? -1 : 0 },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

const board = (key: string): StatStanding => ({
  key,
  top: [{ rank: 1, player: { id: "bob", handle: "bob", name: "Bob", avatarUrl: null }, value: 99 }],
  me: { rank: 14, value: 81 },
  total: 2380,
});

async function hosted(ctx: LaunchContext, handlers: HostHandlers = {}) {
  const pair = createMemoryTransportPair();
  const onRequestError = vi.fn();
  createHostCore(pair.host, { context: () => ctx, handlers, onRequestError });
  const client = await connect({ transport: pair.app, timeoutMs: 1000 });
  return { client, onRequestError };
}

describe("stats.leaderboard: access", () => {
  it("is read-only: every purpose and role may call it", () => {
    for (const purpose of ["match", "setup", "app"] as const) {
      expect(accessProblem("stats.leaderboard", { purpose }), purpose).toBeNull();
      expect(accessProblem("stats.leaderboard", { purpose, match: { role: "spectator" } }), purpose).toBeNull();
    }
    expect(accessProblem("stats.leaderboard", {})).toBeNull();
  });

  it("validates key and limit on the host", () => {
    expect(validateRequest("stats.leaderboard", { key: "best" })).toBeNull();
    expect(validateRequest("stats.leaderboard", { key: "best", limit: 500 })).toBeNull();
    expect(validateRequest("stats.leaderboard", { key: "Best!" })).toMatch(/stat key/);
    expect(validateRequest("stats.leaderboard", {})).toMatch(/stat key/);
    expect(validateRequest("stats.leaderboard", { key: "best", limit: 0 })).toMatch(/limit/);
    expect(validateRequest("stats.leaderboard", { key: "best", limit: 2.5 })).toMatch(/limit/);
  });
});

describe("stats.leaderboard: client and host core", () => {
  it("answers for spectators and in setup purpose too", async () => {
    for (const ctx of [context("match", "spectator"), context("setup"), context("app")]) {
      resetConnection();
      const handler = vi.fn(({ key }: { key: string }) => board(key));
      const { client } = await hosted(ctx, { "stats.leaderboard": handler });
      await expect(client.stats.leaderboard("best")).resolves.toEqual(board("best"));
    }
  });

  it("sends the limit clamped (default 10, max 50) and accepts the statLeaderboard alias", async () => {
    const handler = vi.fn(({ key }: { key: string; limit?: number }) => board(key));
    const { client } = await hosted(context("app"), { statLeaderboard: handler });
    await client.stats.leaderboard("best");
    await client.stats.leaderboard("fastest", { limit: 3 });
    await client.stats.leaderboard("best", { limit: 400 });
    expect(handler.mock.calls.map(([p]) => p)).toEqual([
      { key: "best", limit: 10 },
      { key: "fastest", limit: 3 },
      { key: "best", limit: 50 },
    ]);
    // Hand-made requests are clamped by the host core as well.
    await client.request("stats.leaderboard", { key: "best", limit: 1000 });
    expect(handler).toHaveBeenLastCalledWith({ key: "best", limit: 50 });
  });

  it("refuses undeclared stats and bad limits with invalid_params, before the host", async () => {
    const handler = vi.fn(({ key }: { key: string }) => board(key));
    const { client, onRequestError } = await hosted(context("match"), { "stats.leaderboard": handler });
    await expect(client.stats.leaderboard("wins")).rejects.toMatchObject({ code: "invalid_params", message: /not a declared stat/ });
    await expect(client.stats.leaderboard("best", { limit: 0 })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.stats.leaderboard("")).rejects.toMatchObject({ code: "invalid_params" });
    expect(handler).not.toHaveBeenCalled();
    // The host core checks the manifest too.
    await expect(client.request("stats.leaderboard", { key: "wins" })).rejects.toMatchObject({ code: "invalid_params" });
    expect(onRequestError).toHaveBeenCalledWith("stats.leaderboard", expect.objectContaining({ code: "invalid_params" }));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("rankStatValues", () => {
  it("ranks like the platform: best first by aggregate, ties share a rank", () => {
    const rows = [
      { id: "a", value: 10 },
      { id: "b", value: 30 },
      { id: "c", value: 10 },
      { id: "d", value: 5 },
    ];
    expect(rankStatValues(rows, "max").map((r) => [r.rank, r.id])).toEqual([
      [1, "b"],
      [2, "a"],
      [2, "c"],
      [4, "d"],
    ]);
    expect(rankStatValues(rows, "min").map((r) => [r.rank, r.id])).toEqual([
      [1, "d"],
      [2, "a"],
      [2, "c"],
      [4, "b"],
    ]);
  });
});

describe("stats.leaderboard: mock host", () => {
  async function mockClient(options: MockHostOptions = {}) {
    const mock = createMockHost({ quiet: true, readUrl: false, banner: false, purpose: "app", stats: STATS, ...options });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
    return { mock, client };
  }

  it("ranks your reported value among a handful of made-up players", async () => {
    const { client } = await mockClient();
    const before = await client.stats.leaderboard("best");
    expect(before.me).toBeNull();
    expect(before.total).toBeGreaterThanOrEqual(5);
    expect(before.top.length).toBe(Math.min(10, before.total));
    expect(before.top.every((r) => r.value >= 0 && r.value <= 100)).toBe(true); // percent

    await client.stats.report({ best: 50 });
    const after = await client.stats.leaderboard("best");
    expect(after.total).toBe(before.total + 1);
    expect(after.me?.value).toBe(50);
    expect(after.top.find((r) => r.player.id === "you")).toMatchObject({ rank: after.me!.rank, value: 50 });
    // Best first, ranks never go down the board, and the crowd stays put between reads.
    const values = after.top.map((r) => r.value);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(after.top.filter((r) => r.player.id !== "you").map((r) => r.value)).toEqual(before.top.map((r) => r.value));
    await expect(client.stats.leaderboard("best", { limit: 2 })).resolves.toMatchObject({ top: [{ rank: 1 }, { rank: 2 }] });
  });

  it("spreads the crowd around your first value, lowest first for min stats", async () => {
    const { client } = await mockClient();
    await client.stats.report({ fastest: 800 });
    const s = await client.stats.leaderboard("fastest");
    const values = s.top.map((r) => r.value);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(Math.min(...values)).toBeLessThan(800);
    expect(Math.max(...values)).toBeGreaterThan(800);
    expect(s.me!.rank).toBeGreaterThan(1);
    expect(s.me!.rank).toBeLessThan(s.total);
  });

  it("takes explicit crowd values, or none", async () => {
    const { client } = await mockClient({ leaderboard: { best: [90, 70, 70] } });
    await client.stats.report({ best: 70 });
    const s = await client.stats.leaderboard("best");
    expect(s.top.map((r) => [r.rank, r.value])).toEqual([
      [1, 90],
      [2, 70],
      [2, 70],
      [2, 70],
    ]);
    expect(s.me).toEqual({ rank: 2, value: 70 });
    expect(s.total).toBe(4);

    resetConnection();
    const alone = await mockClient({ leaderboard: false });
    await expect(alone.client.stats.leaderboard("best")).resolves.toEqual({ key: "best", top: [], me: null, total: 0 });
    await alone.client.stats.report({ best: 12 });
    const mine = await alone.client.stats.leaderboard("best");
    expect(mine).toMatchObject({ me: { rank: 1, value: 12 }, total: 1 });
    expect(mine.top[0]!.player).toEqual({ id: "you", handle: "you", name: "You", avatarUrl: null });
  });

  it("works in match purpose too, and refuses undeclared stats", async () => {
    const { client } = await mockClient({ purpose: "match" });
    await expect(client.stats.leaderboard("best")).resolves.toMatchObject({ key: "best", me: null });
    await expect(client.request("stats.leaderboard", { key: "nope" })).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("useStatStanding", () => {
  it("reads on mount, refreshes on demand, and skips a null key", async () => {
    const mock = createMockHost({ quiet: true, readUrl: false, banner: false, purpose: "app", stats: STATS, leaderboard: { best: [60] } });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
    const seen: { best?: StatStandingHook; none?: StatStandingHook } = {};
    function Probe() {
      seen.best = useStatStanding("best");
      seen.none = useStatStanding(null);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(XAppsProvider, null, createElement(Probe)));
    });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(seen.best).toMatchObject({ loading: false, error: null, standing: { key: "best", me: null, total: 1 } });
    expect(seen.none).toMatchObject({ standing: null, loading: false, error: null });

    await client.stats.report({ best: 75 });
    await act(async () => seen.best!.refresh());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(seen.best!.standing).toMatchObject({ me: { rank: 1, value: 75 }, total: 2 });
    act(() => root.unmount());
  });

  it("reports errors (an undeclared stat)", async () => {
    const mock = createMockHost({ quiet: true, readUrl: false, banner: false, purpose: "app", stats: STATS });
    await connect({ transport: mock.transport, timeoutMs: 1000 });
    let hook: StatStandingHook | undefined;
    function Probe() {
      hook = useStatStanding("wins");
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(XAppsProvider, null, createElement(Probe)));
    });
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(hook).toMatchObject({ standing: null, loading: false });
    expect(hook!.error).toMatchObject({ code: "invalid_params" });
    act(() => root.unmount());
  });
});
