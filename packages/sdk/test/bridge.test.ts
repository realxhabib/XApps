import { afterEach, describe, expect, it, vi } from "vitest";
import { XAppsClient, connect, resetConnection } from "../src/client";
import { createHostCore, decideWinner, validateRequest, type HostHandlers } from "../src/host";
import type { LaunchContext, MatchResult } from "../src/protocol";
import { createMemoryTransportPair } from "../src/transport";

function makeContext(): LaunchContext {
  return {
    app: { id: "app-1", slug: "demo", name: "Demo" },
    user: { id: "alice", handle: "alice", name: "Alice", avatarUrl: null },
    match: {
      id: "m1",
      mode: "live",
      status: "active",
      scoring: "high",
      seed: "seed-1",
      seat: 0,
      settings: { rounds: 3 },
      players: [
        { id: "alice", handle: "alice", name: "Alice", avatarUrl: null, seat: 0, isBot: false, submitted: false, score: null },
        { id: "bob", handle: "bob", name: "Bob", avatarUrl: null, seat: 1, isBot: false, submitted: false, score: null },
      ],
    },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

async function setup(handlers: HostHandlers = {}) {
  const pair = createMemoryTransportPair();
  const context = makeContext();
  const onConnect = vi.fn();
  const host = createHostCore(pair.host, { context: () => context, handlers, onConnect });
  const client = await connect({ transport: pair.app, timeoutMs: 1000 });
  return { host, client, context, onConnect };
}

afterEach(() => resetConnection());

describe("handshake", () => {
  it("delivers the launch context", async () => {
    const { client, onConnect } = await setup();
    expect(client).toBeInstanceOf(XAppsClient);
    expect(client.user.handle).toBe("alice");
    expect(client.opponent?.id).toBe("bob");
    expect(client.isHost).toBe(true);
    expect(client.match.settings).toEqual({ rounds: 3 });
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("returns the same client for repeated connect() calls", async () => {
    const pair = createMemoryTransportPair();
    createHostCore(pair.host, { context: makeContext, handlers: {} });
    const [a, b] = await Promise.all([
      connect({ transport: pair.app, timeoutMs: 1000 }),
      connect({ transport: pair.app, timeoutMs: 1000 }),
    ]);
    expect(a).toBe(b);
  });

  it("times out when nobody answers", async () => {
    const pair = createMemoryTransportPair();
    await expect(connect({ transport: pair.app, timeoutMs: 50 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("seeds client.random from the match seed", async () => {
    const { client } = await setup();
    const { createRandom } = await import("../src/random");
    expect(client.random.next()).toEqual(createRandom("seed-1").next());
  });
});

describe("requests", () => {
  it("routes room.send to the host handler", async () => {
    const send = vi.fn(() => null);
    const { client } = await setup({ "room.send": send });
    await client.room.send("move", { col: 3 });
    expect(send).toHaveBeenCalledWith({ type: "move", payload: { col: 3 } });
  });

  it("rejects methods the host does not implement", async () => {
    const { client } = await setup({});
    await expect(client.ui.toast("hi")).rejects.toMatchObject({ code: "unknown_method" });
  });

  it("surfaces handler errors", async () => {
    const { client } = await setup({
      "storage.get": () => {
        throw new Error("boom");
      },
    });
    await expect(client.storage.get("k")).rejects.toMatchObject({ code: "internal", message: "boom" });
  });

  it("validates submissions on the client", async () => {
    const { client } = await setup({ "match.submit": () => ({ state: "waiting", result: null }) });
    expect(() => client.submit({ score: Number.NaN })).toThrow(/finite/);
  });

  it("returns submit results", async () => {
    const result: MatchResult = { matchId: "m1", status: "completed", winnerId: "alice", scores: { alice: 3, bob: 1 } };
    const { client } = await setup({ "match.submit": () => ({ state: "final", result }) });
    await expect(client.submit({ score: 3 })).resolves.toEqual({ state: "final", result });
  });

  it("rate limits room.send bursts", async () => {
    const { client } = await setup({ "room.send": () => null });
    const attempts = Array.from({ length: 40 }, (_, i) => client.room.send("tick", i).then(() => "ok", (e) => e.code));
    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((o) => o === "rate_limited").length).toBeGreaterThan(0);
  });
});

describe("events", () => {
  it("dispatches room messages by type", async () => {
    const { host, client } = await setup();
    const onMove = vi.fn();
    const onOther = vi.fn();
    client.room.on("move", onMove);
    client.room.on("chat", onOther);
    host.emit("room.message", { type: "move", payload: { col: 1 }, from: "bob", at: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(onMove).toHaveBeenCalledWith({ col: 1 }, "bob", expect.objectContaining({ type: "move" }));
    expect(onOther).not.toHaveBeenCalled();
  });

  it("fires onStart once, and immediately for late subscribers", async () => {
    const { host, client } = await setup();
    const early = vi.fn();
    client.onStart(early);
    host.emit("match.start", { at: 42 });
    host.emit("match.start", { at: 43 });
    await new Promise((r) => setTimeout(r, 0));
    expect(early).toHaveBeenCalledTimes(1);
    expect(early).toHaveBeenCalledWith(42);
    const late = vi.fn();
    client.onStart(late);
    await new Promise((r) => setTimeout(r, 0));
    expect(late).toHaveBeenCalledWith(42);
  });

  it("starts from ready() when the match already started", async () => {
    const { client } = await setup({ ready: () => ({ startedAt: 99 }) });
    const onStart = vi.fn();
    client.onStart(onStart);
    await client.ready();
    expect(onStart).toHaveBeenCalledWith(99);
    expect(client.hasStarted).toBe(true);
  });

  it("merges match updates into the context", async () => {
    const { host, client, context } = await setup();
    const updated = { ...context.match, status: "voting" as const };
    host.emit("match.update", { match: updated });
    await new Promise((r) => setTimeout(r, 0));
    expect(client.match.status).toBe("voting");
  });

  it("buffers events emitted before the app connects", async () => {
    const pair = createMemoryTransportPair();
    const host = createHostCore(pair.host, { context: makeContext, handlers: {} });
    host.emit("room.presence", { online: ["alice", "bob"] });
    const client = await connect({ transport: pair.app, timeoutMs: 1000 });
    const online = await new Promise<string[]>((resolve) => client.room.onPresence(resolve));
    expect(online).toEqual(["alice", "bob"]);
  });
});

describe("validateRequest", () => {
  it("accepts well-formed params", () => {
    expect(validateRequest("room.send", { type: "move", payload: { a: 1 } })).toBeNull();
    expect(validateRequest("match.submit", { score: 1, display: { kind: "text", body: "hi" } })).toBeNull();
  });

  it("rejects bad params", () => {
    expect(validateRequest("room.send", { type: "", payload: 1 })).toMatch(/type/);
    expect(validateRequest("match.submit", { display: { kind: "svg", svg: "<script>" } })).toMatch(/SVG/);
    expect(validateRequest("match.submit", { display: { kind: "image", url: "javascript:alert(1)" } })).toMatch(/https/);
    expect(validateRequest("social.share", { text: "x".repeat(300) })).toMatch(/long/);
    expect(validateRequest("storage.set", { key: "k", value: "x".repeat(20_000) })).toMatch(/large/);
  });
});

describe("decideWinner", () => {
  it("picks the highest or lowest score", () => {
    expect(decideWinner({ a: 3, b: 1 }, "high")).toBe("a");
    expect(decideWinner({ a: 300, b: 180 }, "low")).toBe("b");
  });
  it("returns null on ties or empty input", () => {
    expect(decideWinner({ a: 2, b: 2 }, "high")).toBeNull();
    expect(decideWinner({}, "high")).toBeNull();
  });
  it("ignores missing scores", () => {
    expect(decideWinner({ a: null, b: 1 }, "high")).toBe("b");
  });
});
