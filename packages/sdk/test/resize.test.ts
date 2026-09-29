import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { HANDLER_ALIASES, createHostCore, validateRequest, type HostHandlers } from "../src/host";
import { createMockHost } from "../src/mock-host";
import { LIMITS, type LaunchContext } from "../src/protocol";
import { XAppsProvider, useAutoResize } from "../src/react";
import { createMemoryTransportPair } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
      seed: "s",
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

async function setup(handlers: HostHandlers, context = makeContext()) {
  const pair = createMemoryTransportPair();
  const onRequestError = vi.fn();
  createHostCore(pair.host, { context: () => context, handlers, onRequestError });
  const client = await connect({ transport: pair.app, timeoutMs: 1000, captureErrors: false });
  return { client, onRequestError };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A controllable ResizeObserver stand-in (jsdom has none). */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(readonly callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.push(element);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    if (!this.disconnected) this.callback();
  }
}

/** An element whose measured height we control. */
function sizedElement(initial: number) {
  const el = document.createElement("div");
  let height = initial;
  el.getBoundingClientRect = () => ({ height, width: 100, top: 0, left: 0, bottom: height, right: 100, x: 0, y: 0, toJSON() {} });
  return {
    el,
    set(next: number) {
      height = next;
    },
  };
}

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  resetConnection();
  vi.unstubAllGlobals();
});

describe("ui.resize", () => {
  it("sends whole, clamped CSS px", async () => {
    const heights: number[] = [];
    const { client } = await setup({ "ui.resize": ({ height }) => (heights.push(height), null) });
    await client.ui.resize(300.2);
    await client.ui.resize(40);
    await client.ui.resize(99_999);
    expect(heights).toEqual([301, LIMITS.frameHeight.min, LIMITS.frameHeight.max]);
    await expect(client.ui.resize(Number.NaN)).rejects.toMatchObject({ code: "invalid_params" });
    expect(heights).toHaveLength(3);
  });

  it("is validated and clamped by the host too, and accepts the `resize` alias", async () => {
    expect(HANDLER_ALIASES["ui.resize"]).toBe("resize");
    expect(validateRequest("ui.resize", { height: 480 })).toBeNull();
    expect(validateRequest("ui.resize", { height: 1e9 })).toBeNull();
    expect(validateRequest("ui.resize", { height: "480" })).toMatch(/height/);
    expect(validateRequest("ui.resize", {})).toMatch(/height/);

    const resize = vi.fn(() => null);
    const { client } = await setup({ resize });
    await client.request("ui.resize", { height: 3 }); // raw request skips the client's clamp
    await client.request("ui.resize", { height: 640.5 });
    expect(resize.mock.calls).toEqual([[{ height: 120 }], [{ height: 641 }]]);
    await expect(client.request("ui.resize", { height: Number.POSITIVE_INFINITY })).rejects.toMatchObject({
      code: "invalid_params",
    });
  });

  it("is allowed for spectators and in setup purpose", async () => {
    const heights: number[] = [];
    const handlers: HostHandlers = { "ui.resize": ({ height }) => (heights.push(height), null) };
    const spectator = await setup(handlers, makeContext({ role: "spectator" }));
    await spectator.client.ui.resize(200);
    resetConnection();
    const setupPurpose = await setup(handlers, makeContext({ purpose: "setup" }));
    await setupPurpose.client.ui.resize(220);
    expect(heights).toEqual([200, 220]);
  });
});

describe("ui.autoResize", () => {
  it("reports the height once, then throttled changes only", async () => {
    const heights: number[] = [];
    const { client } = await setup({ "ui.resize": ({ height }) => (heights.push(height), null) });
    const box = sizedElement(300);
    const stop = client.ui.autoResize({ element: box.el, intervalMs: 40 });
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed).toEqual([box.el]);
    await tick(5);
    expect(heights).toEqual([300]);

    // A burst of changes inside one interval → one request with the latest height.
    box.set(320);
    observer.fire();
    box.set(350.5);
    observer.fire();
    observer.fire();
    await tick(10);
    expect(heights).toEqual([300]);
    await tick(50);
    expect(heights).toEqual([300, 351]);

    // Unchanged height: nothing new.
    observer.fire();
    await tick(60);
    expect(heights).toEqual([300, 351]);

    stop();
    expect(observer.disconnected).toBe(true);
    box.set(500);
    observer.fire();
    await tick(60);
    expect(heights).toEqual([300, 351]);
  });

  it("never rejects when the host doesn't support ui.resize, and stops on destroy", async () => {
    const { client, onRequestError } = await setup({});
    const box = sizedElement(400);
    client.ui.autoResize({ element: box.el, intervalMs: 0 });
    await tick(10);
    expect(onRequestError).toHaveBeenCalledWith("ui.resize", expect.objectContaining({ code: "unknown_method" }));
    client.destroy();
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });

  it("measures document.documentElement by default", async () => {
    const heights: number[] = [];
    const { client } = await setup({ "ui.resize": ({ height }) => (heights.push(height), null) });
    const stop = client.ui.autoResize();
    expect(FakeResizeObserver.instances[0]!.observed).toEqual([document.documentElement]);
    await tick(5);
    expect(heights).toEqual([LIMITS.frameHeight.min]); // jsdom lays nothing out: 0 → clamped
    stop();
  });
});

describe("useAutoResize", () => {
  it("runs while mounted", async () => {
    const heights: number[] = [];
    const pair = createMemoryTransportPair();
    createHostCore(pair.host, { context: () => makeContext(), handlers: { "ui.resize": ({ height }) => (heights.push(height), null) } });
    await connect({ transport: pair.app, timeoutMs: 1000, captureErrors: false });
    const box = sizedElement(260);
    function Probe() {
      useAutoResize(true, { element: box.el, intervalMs: 0 });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(XAppsProvider, null, createElement(Probe)));
    });
    await act(async () => tick(5));
    expect(heights).toEqual([260]);
    const observer = FakeResizeObserver.instances.at(-1)!;
    act(() => root.unmount());
    expect(observer.disconnected).toBe(true);
  });
});

describe("mock host ui.resize", () => {
  it("is a console.debug no-op (silent when quiet)", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const mock = createMockHost({ readUrl: false });
      const client = await connect({ transport: mock.transport, timeoutMs: 1000, captureErrors: false });
      vi.spyOn(console, "info").mockImplementation(() => {});
      await expect(client.ui.resize(333)).resolves.toBeNull();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining("[xapps mock]"), expect.any(String), "resize", 333);
      resetConnection();
      debug.mockClear();
      const quiet = createMockHost({ readUrl: false, quiet: true });
      const quietClient = await connect({ transport: quiet.transport, timeoutMs: 1000, captureErrors: false });
      await quietClient.ui.resize(333);
      expect(debug).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
