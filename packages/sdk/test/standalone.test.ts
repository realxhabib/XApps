import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { accessProblem, createHostCore, standaloneMatch, type HostHandlers } from "../src/host";
import { createMockHost, type MockHostOptions } from "../src/mock-host";
import { REQUEST_METHODS, type LaunchContext, type RequestMethod } from "../src/protocol";
import { XAppsProvider, useMatchStarted, useStandalone, useUser } from "../src/react";
import { createMemoryTransportPair } from "../src/transport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetConnection());

const tick = () => new Promise((r) => setTimeout(r, 0));

const user = { id: "alice", handle: "alice", name: "Alice", avatarUrl: null };

function appContext(match?: Partial<LaunchContext["match"]>): LaunchContext {
  return {
    purpose: "app",
    app: {
      id: "notes",
      slug: "notes",
      name: "Notes",
      stats: [{ key: "notes", label: "Notes", aggregate: "max" }],
      achievements: [{ id: "first_note", name: "First note", description: "", icon: "📌", xp: 10 }],
    },
    user,
    match: { ...standaloneMatch(user, { id: "app:notes" }), ...match },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

async function hosted(context: LaunchContext, handlers: HostHandlers = {}) {
  const pair = createMemoryTransportPair();
  const onRequestError = vi.fn();
  const host = createHostCore(pair.host, { context: () => context, handlers, onRequestError });
  const client = await connect({ transport: pair.app, timeoutMs: 1000 });
  return { host, client, onRequestError };
}

/** What purpose `app` may call. Every protocol method is listed, so a new one fails here until decided. */
const APP_ACCESS: Record<RequestMethod, boolean> = {
  ready: true,
  "room.send": false,
  "match.submit": false,
  "match.forfeit": false,
  "ui.toast": true,
  "ui.celebrate": true,
  "ui.haptic": true,
  "ui.status": true,
  "ui.scores": false,
  "ui.turn": false,
  "ui.resize": true,
  "social.share": true,
  "storage.get": true,
  "storage.set": true,
  "storage.delete": true,
  "storage.list": true,
  "media.upload": true,
  "stats.report": true,
  "achievements.unlock": true,
  log: true,
  "state.get": false,
  "state.set": false,
  "turn.end": false,
  "round.set": false,
  "setup.submit": false,
  "setup.cancel": false,
};

describe("purpose app: access rules", () => {
  it("decides every request method", () => {
    expect(Object.keys(APP_ACCESS).sort()).toEqual([...REQUEST_METHODS].sort());
    for (const method of REQUEST_METHODS) {
      const problem = accessProblem(method, { purpose: "app" });
      expect(problem === null, method).toBe(APP_ACCESS[method]);
    }
  });

  it("ignores roles (a standalone app has no spectators)", () => {
    expect(accessProblem("storage.set", { purpose: "app", match: { role: "spectator" } })).toBeNull();
    expect(accessProblem("state.set", { purpose: "app", match: { role: "player" } })).toMatch(/standalone/);
    expect(accessProblem("setup.submit", { purpose: "app" })).toMatch(/setup/);
  });

  it("leaves match and setup purposes unchanged", () => {
    expect(accessProblem("ui.scores", { purpose: "match" })).toBeNull();
    expect(accessProblem("ui.turn", { purpose: "setup" })).toBeNull();
    expect(accessProblem("stats.report", { purpose: "setup" })).toMatch(/setting up/);
    // Unknown purposes (and v1 hosts that send none) are matches.
    expect(accessProblem("setup.submit", { purpose: "later" as LaunchContext["purpose"] })).toMatch(/setup mode/);
  });
});

describe("purpose app: client", () => {
  it("keeps purpose app (no longer collapsed to match) with a one-player stub", async () => {
    const { client } = await hosted(appContext());
    expect(client.purpose).toBe("app");
    expect(client.isStandalone).toBe(true);
    expect(client.setup.active).toBe(false);
    expect(client.me).toMatchObject({ id: "alice", seat: 0, role: "player" });
    expect(client.players).toHaveLength(1);
    expect(client.opponents).toEqual([]);
    expect(client.isSpectator).toBe(false);
    expect(client.match).toMatchObject({ minPlayers: 1, maxPlayers: 1, teams: 0, role: "player" });
  });

  it("fills in the stub when the host sends little or odd match data", async () => {
    const context = appContext();
    const sparse = { ...context, match: { id: "x", role: "spectator", players: [] } as unknown as LaunchContext["match"] };
    const { client } = await hosted(sparse);
    expect(client.match.id).toBe("x");
    expect(client.me).toMatchObject({ id: "alice", handle: "alice", role: "player" });
    expect(client.role).toBe("player");
  });

  it("ready() resolves, and onStart / onEnd never fire", async () => {
    const { client, host } = await hosted(appContext(), { ready: () => ({ startedAt: 123 }) });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    client.onStart(onStart);
    client.onEnd(onEnd);
    await expect(client.ready()).resolves.toBeUndefined();
    host.emit("match.start", { at: 5 });
    host.emit("match.end", { result: { matchId: "x", status: "completed", winnerId: null, scores: {} } });
    await tick();
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
    expect(client.hasStarted).toBe(false);
    expect(client.finalResult).toBeNull();
  });

  it("refuses match-only calls on the client, before they reach the host", async () => {
    const handlers: HostHandlers = {
      "room.send": vi.fn(() => null),
      "match.submit": vi.fn(() => ({ state: "waiting" as const, result: null })),
      "state.get": vi.fn(() => ({ state: null, version: 0 })),
      "ui.scores": vi.fn(() => null),
    };
    const { client } = await hosted(appContext(), handlers);
    await expect(client.submit({ score: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.forfeit()).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.room.send("x", 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.state.get()).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.state.update(() => 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.turn.end()).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.round.set(1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.ui.setScores({ alice: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.ui.setTurn("alice")).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.setup.submit({ a: 1 })).rejects.toMatchObject({ code: "forbidden" });
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it("refuses match-only requests on the host too (hand-made requests)", async () => {
    const send = vi.fn(() => null);
    const { client, onRequestError } = await hosted(appContext(), { "room.send": send });
    await expect(client.request("room.send", { type: "x", payload: 1 })).rejects.toMatchObject({ code: "forbidden" });
    expect(send).not.toHaveBeenCalled();
    expect(onRequestError).toHaveBeenCalledWith("room.send", expect.objectContaining({ code: "forbidden" }));
  });

  it("uses storage, stats, achievements, media, logs and ui helpers", async () => {
    const store = new Map<string, unknown>();
    const handlers: HostHandlers = {
      "storage.set": ({ key, value }) => (store.set(key, value), null),
      "storage.get": ({ key }) => (store.get(key) as never) ?? null,
      "storage.list": () => [...store.keys()],
      "storage.delete": ({ key }) => (store.delete(key), null),
      "stats.report": ({ values }) => values,
      "achievements.unlock": () => ({ unlocked: true }),
      "media.upload": ({ file }) => ({ url: "https://cdn.test/a.png", kind: "image", mime: file.type, bytes: file.size }),
      log: vi.fn(() => null),
      "ui.toast": vi.fn(() => null),
      "ui.status": vi.fn(() => null),
      "ui.resize": vi.fn(() => null),
      "social.share": vi.fn(() => null),
    };
    const { client } = await hosted(appContext(), handlers);
    await client.storage.set("pins", ["a"]);
    await expect(client.storage.get("pins")).resolves.toEqual(["a"]);
    await expect(client.storage.list()).resolves.toEqual(["pins"]);
    await expect(client.stats.report({ notes: 3 })).resolves.toEqual({ notes: 3 });
    await expect(client.achievements.unlock("first_note")).resolves.toEqual({ unlocked: true });
    expect(client.achievements.unlocked.has("first_note")).toBe(true);
    const ref = await client.media.upload(new Blob(["x"], { type: "image/png" }));
    expect(ref.url).toBe("https://cdn.test/a.png");
    await client.ui.toast("saved");
    await client.ui.setStatus("3 notes");
    await client.ui.resize(400);
    await client.social.share("hi");
    client.log.info("opened");
    await tick();
    expect(handlers.log).toHaveBeenCalledWith({ level: "info", message: "opened" });
    await client.storage.delete("pins");
    expect(store.size).toBe(0);
  });

  it("v1-style contexts without a purpose still count as matches", async () => {
    const context = appContext();
    const legacy = { ...context, purpose: undefined } as unknown as LaunchContext;
    const { client } = await hosted(legacy);
    expect(client.purpose).toBe("match");
    expect(client.isStandalone).toBe(false);
  });
});

describe("purpose app: mock host", () => {
  async function mockClient(options: MockHostOptions = {}) {
    const mock = createMockHost({ quiet: true, readUrl: false, banner: false, startDelayMs: 0, purpose: "app", ...options });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
    return { mock, client };
  }

  it("seats you alone, with no bots and no match start", async () => {
    const { client } = await mockClient({ players: 4, teams: 2, role: "spectator", turnBased: true });
    expect(client.purpose).toBe("app");
    expect(client.players.map((p) => p.id)).toEqual(["you"]);
    expect(client.match).toMatchObject({ minPlayers: 1, maxPlayers: 1, teams: 0, role: "player", turn: null });
    const onStart = vi.fn();
    client.onStart(onStart);
    await client.ready();
    await new Promise((r) => setTimeout(r, 20));
    expect(onStart).not.toHaveBeenCalled();
    await expect(client.submit({ score: 1 })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps storage, stats, achievements and media working", async () => {
    const { mock, client } = await mockClient({
      stats: [{ key: "notes", label: "Notes", aggregate: "max" }],
      achievements: [{ id: "first_note", name: "First note", description: "", icon: "📌", xp: 10 }],
      probeMedia: false,
    });
    await client.storage.set("standalone-test", { ok: true });
    await expect(client.storage.get("standalone-test")).resolves.toEqual({ ok: true });
    await client.storage.delete("standalone-test");
    await expect(client.stats.report({ notes: 2 })).resolves.toEqual({ notes: 2 });
    await expect(client.stats.report({ notes: 1 })).resolves.toEqual({ notes: 2 });
    await expect(client.achievements.unlock("first_note")).resolves.toEqual({ unlocked: true });
    await expect(client.achievements.unlock("first_note")).resolves.toEqual({ unlocked: false });
    const ref = await client.media.upload(new Blob(["x"], { type: "image/png" }), { alt: "x" });
    expect(ref).toMatchObject({ kind: "image", mime: "image/png" });
    expect(mock.stats).toEqual({ notes: 2 });
    expect([...mock.achievements]).toEqual(["first_note"]);
    expect(mock.uploads).toHaveLength(1);
  });

  it("reads ?xapps-purpose=app", async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("xapps-purpose", "app");
    window.history.replaceState(null, "", url);
    try {
      const mock = createMockHost({ quiet: true });
      expect(mock.context.purpose).toBe("app");
      expect(mock.context.match.players).toHaveLength(1);
    } finally {
      url.searchParams.delete("xapps-purpose");
      window.history.replaceState(null, "", url);
    }
  });
});

describe("purpose app: react", () => {
  it("useStandalone and useUser", async () => {
    const mock = createMockHost({ quiet: true, readUrl: false, purpose: "app" });
    await connect({ transport: mock.transport, timeoutMs: 1000 });
    const seen: { standalone?: boolean; handle?: string; started?: boolean } = {};
    function Probe() {
      seen.standalone = useStandalone();
      seen.handle = useUser().handle;
      seen.started = useMatchStarted();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(XAppsProvider, null, createElement(Probe)));
    });
    expect(seen).toEqual({ standalone: true, handle: "you", started: false });
    act(() => root.unmount());
  });
});
