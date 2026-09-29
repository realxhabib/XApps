import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { HANDLER_ALIASES, createHostCore, validateRequest, type HostHandlers } from "../src/host";
import { createMockHost } from "../src/mock-host";
import { LIMITS, type LaunchContext, type RequestParams } from "../src/protocol";
import { createMemoryTransportPair, type AppTransport } from "../src/transport";

type LogParams = RequestParams<"log">;

// Node's process (vitest runs in Node; the SDK's tsconfig has no Node types).
type Listener = (...args: unknown[]) => void;
const proc = (globalThis as unknown as { process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void } })
  .process;

function makeContext(overrides: { role?: "player" | "spectator"; purpose?: "match" | "setup" } = {}): LaunchContext {
  const role = overrides.role ?? "player";
  return {
    purpose: overrides.purpose ?? "match",
    app: { id: "app-1", slug: "demo", name: "Demo" },
    user: { id: "alice", handle: "alice", name: "Alice", avatarUrl: null },
    match: {
      id: "m1",
      mode: "live",
      status: "active",
      scoring: "high",
      seed: "seed-1",
      seat: role === "spectator" ? -1 : 0,
      settings: {},
      players: [
        { id: role === "spectator" ? "carol" : "alice", handle: "a", name: "A", avatarUrl: null, seat: 0, isBot: false, submitted: false, score: null, team: null, role: "player" },
        { id: "bob", handle: "bob", name: "Bob", avatarUrl: null, seat: 1, isBot: false, submitted: false, score: null, team: null, role: "player" },
      ],
      minPlayers: 2,
      maxPlayers: 2,
      teams: 0,
      role,
      state: null,
      stateVersion: 0,
      turn: null,
      turnDeadline: null,
      round: 0,
    },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function setup(
  handlers: HostHandlers = {},
  options: { context?: LaunchContext; captureErrors?: boolean; wrap?: (t: AppTransport) => AppTransport } = {},
) {
  const pair = createMemoryTransportPair();
  const context = options.context ?? makeContext();
  const onRequestError = vi.fn();
  const host = createHostCore(pair.host, { context: () => context, handlers, onRequestError });
  const transport = options.wrap ? options.wrap(pair.app) : pair.app;
  const client = await connect({ transport, timeoutMs: 1000, captureErrors: options.captureErrors });
  return { host, client, onRequestError };
}

afterEach(() => {
  resetConnection();
  vi.useRealTimers();
});

describe("xapps.log", () => {
  it("round-trips every level to the host handler", async () => {
    const received: LogParams[] = [];
    const { client } = await setup({ log: (p) => (received.push(p), null) });
    expect(client.log.debug("d")).toBeUndefined();
    client.log.info("hello", { round: 2 });
    client.log.warn("careful");
    client.log.error("boom", { code: 7 });
    await tick();
    expect(received).toEqual([
      { level: "debug", message: "d" },
      { level: "info", message: "hello", data: { round: 2 } },
      { level: "warn", message: "careful" },
      { level: "error", message: "boom", data: { code: 7 } },
    ]);
  });

  it("accepts the friendly handler alias logEvent", async () => {
    expect(HANDLER_ALIASES.log).toBe("logEvent");
    const logEvent = vi.fn(() => null);
    const { client } = await setup({ logEvent });
    client.log.info("via alias");
    await tick();
    expect(logEvent).toHaveBeenCalledWith({ level: "info", message: "via alias" });
  });

  it("truncates long messages with an ellipsis and drops oversized data with a note", async () => {
    const received: LogParams[] = [];
    const { client } = await setup({ log: (p) => (received.push(p), null) });
    client.log.info("x".repeat(2000), { blob: "y".repeat(LIMITS.logDataBytes + 10) });
    client.log.warn("not json", { when: new Date() } as never);
    await tick();
    const [long, weird] = received;
    expect(long?.message).toHaveLength(LIMITS.logMessageLength);
    expect(long?.message.endsWith("…")).toBe(true);
    expect(long?.data).toEqual({ dropped: expect.stringMatching(/bytes \(max 4096\)/) });
    expect(weird?.data).toEqual({ dropped: expect.stringMatching(/not JSON/) });
    expect(validateRequest("log", long)).toBeNull();
  });

  it("never throws or rejects, even when the host lacks a handler or is gone", async () => {
    const unhandled = vi.fn();
    proc.on("unhandledRejection", unhandled);
    try {
      const { client, onRequestError } = await setup({});
      expect(() => client.log.error("no handler")).not.toThrow();
      expect(() => client.log.info(undefined as unknown as string, (() => 1) as never)).not.toThrow();
      await tick(5);
      expect(onRequestError).toHaveBeenCalledWith("log", expect.objectContaining({ code: "unknown_method" }));
      client.destroy();
      expect(() => client.log.warn("after destroy")).not.toThrow();
      await tick(5);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      proc.off("unhandledRejection", unhandled);
    }
  });

  it("drops entries past 60 per minute on the client, then refills", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const received: LogParams[] = [];
    const { client } = await setup({ log: (p) => (received.push(p), null) });
    for (let i = 0; i < 100; i++) client.log.info(`#${i}`);
    await tick();
    expect(received).toHaveLength(LIMITS.logsPerMinute);
    expect(received.at(-1)?.message).toBe("#59");
    vi.setSystemTime(Date.now() + 5_000); // 5 s → 5 more tokens
    for (let i = 0; i < 10; i++) client.log.info(`later ${i}`);
    await tick();
    expect(received).toHaveLength(LIMITS.logsPerMinute + 5);
  });

  it("is allowed for spectators and in setup purpose", async () => {
    const received: LogParams[] = [];
    const spectator = await setup({ log: (p) => (received.push(p), null) }, { context: makeContext({ role: "spectator" }) });
    spectator.client.log.info("watching");
    await tick();
    expect(received).toEqual([{ level: "info", message: "watching" }]);
    expect(spectator.onRequestError).not.toHaveBeenCalled();
    resetConnection();
    const setupPurpose = await setup({ log: (p) => (received.push(p), null) }, { context: makeContext({ purpose: "setup" }) });
    setupPurpose.client.log.warn("setting up");
    await tick();
    expect(received).toHaveLength(2);
    expect(setupPurpose.onRequestError).not.toHaveBeenCalled();
  });
});

describe("host validation of log", () => {
  it("checks level, message and data", () => {
    expect(validateRequest("log", { level: "info", message: "ok" })).toBeNull();
    expect(validateRequest("log", { level: "info", message: "", data: { a: [1, 2] } })).toBeNull();
    expect(validateRequest("log", { level: "fatal", message: "x" })).toMatch(/level/);
    expect(validateRequest("log", { level: "info" })).toMatch(/message/);
    expect(validateRequest("log", { level: "info", message: "x".repeat(501) })).toMatch(/500/);
    expect(validateRequest("log", { level: "info", message: "x", data: "y".repeat(5000) })).toMatch(/4096/);
    expect(validateRequest("log", { level: "info", message: "x", data: { n: Number.NaN } })).toMatch(/finite/);
  });

  it("answers invalid hand-made requests with invalid_params", async () => {
    const pair = createMemoryTransportPair();
    const log = vi.fn(() => null);
    createHostCore(pair.host, { context: () => makeContext(), handlers: { log } });
    const client = await connect({ transport: pair.app, timeoutMs: 1000, captureErrors: false });
    await expect(client.request("log", { level: "loud" as never, message: "x" })).rejects.toMatchObject({
      code: "invalid_params",
    });
    expect(log).not.toHaveBeenCalled();
  });

  it("drops (answers ok, skips the handler) past the per-minute budget", async () => {
    const pair = createMemoryTransportPair();
    const log = vi.fn(() => null);
    const onRequestError = vi.fn();
    createHostCore(pair.host, { context: () => makeContext(), handlers: { log }, onRequestError });
    const client = await connect({ transport: pair.app, timeoutMs: 1000, captureErrors: false });
    // Bypass the client's own bucket with raw requests.
    const results = await Promise.all(
      Array.from({ length: 70 }, (_, i) => client.request("log", { level: "debug", message: String(i) })),
    );
    expect(results.every((r) => r === null)).toBe(true);
    expect(log).toHaveBeenCalledTimes(LIMITS.logsPerMinute);
    expect(onRequestError).not.toHaveBeenCalled();
  });
});

describe("automatic error capture", () => {
  const fireError = (error: unknown, message: string) =>
    window.dispatchEvent(new ErrorEvent("error", { error, message, filename: "https://app.test/main.js", lineno: 3, colno: 9 }));
  const fireRejection = (reason: unknown) => {
    const event = new Event("unhandledrejection");
    Object.assign(event, { reason });
    window.dispatchEvent(event);
  };

  it("sends uncaught errors and unhandled rejections as error logs with a trimmed stack", async () => {
    const received: LogParams[] = [];
    await setup({ log: (p) => (received.push(p), null) });
    const error = new Error("kaboom");
    error.stack = ["Error: kaboom", ...Array.from({ length: 40 }, (_, i) => `    at fn${i} (main.js:${i}:1)`)].join("\n");
    fireError(error, "Uncaught Error: kaboom");
    fireRejection(new TypeError("nope"));
    fireRejection("plain reason");
    await tick();
    expect(received).toHaveLength(3);
    const [uncaught, rejected, plain] = received;
    expect(uncaught).toMatchObject({
      level: "error",
      message: "Uncaught Error: kaboom",
      data: { kind: "error", source: "https://app.test/main.js", line: 3, column: 9 },
    });
    const stack = (uncaught?.data as { stack: string }).stack;
    expect(stack.split("\n").length).toBeLessThanOrEqual(12);
    expect(rejected).toMatchObject({ level: "error", message: "Unhandled rejection: TypeError: nope" });
    expect(plain).toMatchObject({ message: "Unhandled rejection: plain reason", data: { kind: "unhandledrejection" } });
  });

  it("installs its listeners once: reconnecting never duplicates reports", async () => {
    const received: LogParams[] = [];
    const add = vi.spyOn(window, "addEventListener");
    await setup({ log: (p) => (received.push(p), null) });
    resetConnection();
    await setup({ log: (p) => (received.push(p), null) });
    resetConnection();
    await setup({ log: (p) => (received.push(p), null) });
    const errorListeners = add.mock.calls.filter(([type]) => type === "error" || type === "unhandledrejection");
    // Earlier tests in this file may already have installed them; never more than one pair.
    expect(errorListeners.length).toBeLessThanOrEqual(2);
    add.mockRestore();
    fireError(new Error("once"), "once");
    await tick();
    expect(received.filter((p) => p.message === "once")).toHaveLength(1);
  });

  it("stays quiet with captureErrors: false", async () => {
    const received: LogParams[] = [];
    await setup({ log: (p) => (received.push(p), null) }, { captureErrors: false });
    fireError(new Error("ignored"), "ignored");
    fireRejection(new Error("ignored too"));
    await tick();
    expect(received).toEqual([]);
  });

  it("never recurses when logging itself fails", async () => {
    let posts = 0;
    const wrap = (t: AppTransport): AppTransport => ({
      ...t,
      post(message) {
        if (message.type === "request" && message.method === "log") {
          posts++;
          // A failing transport inside the error handler would raise another error event.
          window.dispatchEvent(new ErrorEvent("error", { error: new Error("transport failed"), message: "transport failed" }));
          throw new Error("transport failed");
        }
        t.post(message);
      },
    });
    const unhandled = vi.fn();
    proc.on("unhandledRejection", unhandled);
    try {
      await setup({ log: () => null }, { wrap });
      expect(() => fireError(new Error("first"), "first")).not.toThrow();
      await tick(5);
      expect(posts).toBe(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      proc.off("unhandledRejection", unhandled);
    }
  });
});

describe("mock host logs", () => {
  it("keeps entries in mock.logs and prints them with a prefix", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const mock = createMockHost({ readUrl: false, startDelayMs: 0 });
      const client = await connect({ transport: mock.transport, timeoutMs: 1000, captureErrors: false });
      client.log.info("hello mock", { a: 1 });
      client.log.error("bad thing");
      await tick();
      expect(mock.logs).toEqual([
        { level: "info", message: "hello mock", data: { a: 1 }, at: expect.any(Number) },
        { level: "error", message: "bad thing", at: expect.any(Number) },
      ]);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("[xapps log] info"), expect.any(String), "hello mock", { a: 1 });
      expect(error).toHaveBeenCalledWith(expect.stringContaining("[xapps log] error"), expect.any(String), "bad thing");
    } finally {
      info.mockRestore();
      error.mockRestore();
    }
  });

  it("stays silent when quiet, but still records", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const mock = createMockHost({ readUrl: false, quiet: true });
      const client = await connect({ transport: mock.transport, timeoutMs: 1000, captureErrors: false });
      client.log.debug("shh");
      await tick();
      expect(mock.logs.map((l) => l.message)).toEqual(["shh"]);
      expect(debug).not.toHaveBeenCalled();
    } finally {
      debug.mockRestore();
    }
  });

  it("records spectators' logs too", async () => {
    const mock = createMockHost({ readUrl: false, quiet: true, role: "spectator" });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000, captureErrors: false });
    client.log.warn("spectating");
    await tick();
    expect(mock.logs).toHaveLength(1);
  });
});
