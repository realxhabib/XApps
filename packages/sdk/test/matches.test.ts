import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import {
  accessProblem,
  createHostCore,
  resolveHostHandler,
  validateRequest,
  type HostBridge,
  type HostHandlers,
} from "../src/host";
import { LIMITS, XAppsError, type Json, type LaunchContext, type PlayerInfo } from "../src/protocol";
import { createMemoryTransportPair } from "../src/transport";

const tick = () => new Promise((r) => setTimeout(r, 0));

function seat(id: string, n: number, extra: Partial<PlayerInfo> = {}): PlayerInfo {
  return { id, handle: id, name: id, avatarUrl: null, seat: n, isBot: false, submitted: false, score: null, team: null, role: "player", ...extra };
}

function makeContext(overrides: Partial<LaunchContext["match"]> = {}, purpose: LaunchContext["purpose"] = "match"): LaunchContext {
  return {
    purpose,
    app: { id: "app-1", slug: "demo", name: "Demo" },
    user: { id: "alice", handle: "alice", name: "Alice", avatarUrl: null },
    match: {
      id: "m1",
      mode: "live",
      status: "active",
      scoring: "high",
      seed: "seed-1",
      seat: 0,
      settings: {},
      players: [seat("alice", 0), seat("bob", 1), seat("cara", 2), seat("dan", 3)],
      minPlayers: 2,
      maxPlayers: 4,
      teams: 0,
      role: "player",
      state: null,
      stateVersion: 0,
      turn: null,
      turnDeadline: null,
      round: 0,
      ...overrides,
    },
    host: { name: "Test host", version: "0", origin: "memory://host" },
    locale: "en",
  };
}

/** A tiny authoritative "server" behind the host core, like the web host will be. */
function makeServer(context: LaunchContext, bridge: () => HostBridge) {
  const server = { state: context.match.state as Json | null, version: context.match.stateVersion, sets: 0 };
  const handlers: HostHandlers = {
    "state.get": () => ({ state: server.state, version: server.version }),
    "state.set": ({ state, expectedVersion }) => {
      server.sets++;
      if (expectedVersion !== server.version) throw new XAppsError("conflict", "state moved");
      server.state = state;
      server.version++;
      bridge().emitState(state, server.version, context.user.id);
      return { version: server.version };
    },
    "turn.end": ({ next }) => {
      const ids = context.match.players.map((p) => p.id);
      const current = context.match.turn ?? context.user.id;
      const target = next ?? (ids[(ids.indexOf(current) + 1) % ids.length] as string);
      context.match.turn = target;
      bridge().emitTurn(target, null);
      return null;
    },
    "round.set": ({ round }) => {
      context.match.round = round;
      bridge().emitRound(round);
      return null;
    },
  };
  return { server, handlers };
}

async function setup(context = makeContext(), extra: HostHandlers = {}) {
  const pair = createMemoryTransportPair();
  let host: HostBridge | null = null;
  const { server, handlers } = makeServer(context, () => host as HostBridge);
  const onRequestError = vi.fn();
  host = createHostCore(pair.host, { context: () => context, handlers: { ...handlers, ...extra }, onRequestError });
  const client = await connect({ transport: pair.app, timeoutMs: 1000 });
  return { host, client, context, server, onRequestError };
}

afterEach(() => resetConnection());

describe("players", () => {
  it("exposes N players, opponents, and me", async () => {
    const { client } = await setup();
    expect(client.purpose).toBe("match");
    expect(client.players.map((p) => p.id)).toEqual(["alice", "bob", "cara", "dan"]);
    expect(client.opponents.map((p) => p.id)).toEqual(["bob", "cara", "dan"]);
    expect(client.opponent?.id).toBe("bob");
    expect(client.teammates).toEqual([]);
    expect(client.role).toBe("player");
    expect(client.isSpectator).toBe(false);
    expect(client.isHost).toBe(true);
  });

  it("derives teammates in team play", async () => {
    const players = [0, 1, 2, 3].map((n) => seat(["alice", "bob", "cara", "dan"][n] as string, n, { team: n % 2 }));
    const { client } = await setup(makeContext({ teams: 2, players }));
    expect(client.me.team).toBe(0);
    expect(client.teammates.map((p) => p.id)).toEqual(["cara"]);
    expect(client.opponents.map((p) => p.id)).toEqual(["bob", "cara", "dan"]);
  });

  it("fills v2 defaults for contexts from v1 hosts", async () => {
    const v1 = makeContext();
    const legacy = JSON.parse(JSON.stringify(v1)) as Record<string, unknown> & { match: Record<string, unknown> };
    delete legacy.purpose;
    for (const key of ["minPlayers", "maxPlayers", "teams", "role", "state", "stateVersion", "turn", "turnDeadline", "round"]) {
      delete legacy.match[key];
    }
    legacy.match.players = [
      { id: "alice", handle: "alice", name: "Alice", avatarUrl: null, seat: 0, isBot: false, submitted: false, score: null },
      { id: "bob", handle: "bob", name: "Bob", avatarUrl: null, seat: 1, isBot: false, submitted: false, score: null },
    ];
    const pair = createMemoryTransportPair();
    createHostCore(pair.host, { context: () => legacy as unknown as LaunchContext, handlers: {} });
    const client = await connect({ transport: pair.app, timeoutMs: 1000 });
    expect(client.purpose).toBe("match");
    expect(client.role).toBe("player");
    expect(client.match).toMatchObject({ minPlayers: 2, maxPlayers: 2, teams: 0, state: null, stateVersion: 0, turn: null, round: 0 });
    expect(client.me).toMatchObject({ id: "alice", team: null, role: "player" });
    expect(client.opponent?.id).toBe("bob");
  });

  it("treats a spectator as nobody's opponent", async () => {
    const { client } = await setup(
      makeContext({ role: "spectator", seat: -1, players: [seat("bob", 0), seat("cara", 1), seat("alice", -1, { role: "spectator" })] }),
    );
    expect(client.isSpectator).toBe(true);
    expect(client.players.map((p) => p.id)).toEqual(["bob", "cara"]);
    expect(client.me).toMatchObject({ id: "alice", seat: -1, role: "spectator" });
    expect(client.opponents.map((p) => p.id)).toEqual(["bob", "cara"]);
    expect(client.isHost).toBe(false);
  });
});

describe("shared state", () => {
  it("round-trips get / set and keeps current + version fresh", async () => {
    const { client, server } = await setup();
    expect(await client.state.get()).toEqual({ state: null, version: 0 });
    const changes: Array<[Json | null, number, string | null]> = [];
    client.state.onChange((s, c) => changes.push([s, c.version, c.by]));
    await expect(client.state.set({ board: [1] })).resolves.toEqual({ state: { board: [1] }, version: 1 });
    expect(server.state).toEqual({ board: [1] });
    expect(client.state.current).toEqual({ board: [1] });
    expect(client.state.version).toBe(1);
    await tick();
    // Own write: host echo and the local apply produce exactly one change.
    expect(changes).toEqual([[{ board: [1] }, 1, "alice"]]);
  });

  it("applies state.change events from other players, ignoring stale ones", async () => {
    const { client, host } = await setup();
    const seen = vi.fn();
    client.state.onChange(seen);
    host.emitState({ n: 2 }, 2, "bob");
    host.emitState({ n: 1 }, 1, "cara");
    await tick();
    expect(client.state.current).toEqual({ n: 2 });
    expect(client.state.version).toBe(2);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ n: 2 }, { state: { n: 2 }, version: 2, by: "bob" });
  });

  it("takes newer state from match.update without regressing", async () => {
    const { client, host, context } = await setup();
    host.emitState({ n: 5 }, 5, "bob");
    host.emit("match.update", { match: { ...context.match, state: { n: 3 }, stateVersion: 3, status: "active" } });
    await tick();
    expect(client.state.version).toBe(5);
    host.emit("match.update", { match: { ...context.match, state: { n: 6 }, stateVersion: 6, turn: "bob", round: 2 } });
    await tick();
    expect(client.state.current).toEqual({ n: 6 });
    expect(client.turn.current).toBe("bob");
    expect(client.round.current).toBe(2);
  });

  it("fails set() with conflict when the version moved", async () => {
    const { client, server } = await setup();
    server.version = 4;
    await expect(client.state.set({ a: 1 })).rejects.toMatchObject({ code: "conflict" });
    await expect(client.state.set({ a: 1 }, 4)).resolves.toMatchObject({ version: 5 });
  });

  it("update() re-reads and retries on conflict", async () => {
    const { client, server } = await setup();
    server.state = { count: 10 };
    server.version = 7; // another player wrote; the client still thinks version 0
    const result = await client.state.update<{ count: number }>((s) => ({ count: (s?.count ?? 0) + 1 }));
    expect(result).toEqual({ state: { count: 11 }, version: 8 });
    expect(server.sets).toBe(2);
    expect(client.state.current).toEqual({ count: 11 });
  });

  it("update() gives up after the retry budget", async () => {
    const { client } = await setup(makeContext(), {
      "state.set": () => {
        throw new XAppsError("conflict", "always");
      },
    });
    const fn = vi.fn((s: Json | null) => s ?? 1);
    await expect(client.state.update(fn, { retries: 2 })).rejects.toMatchObject({ code: "conflict" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("update() hands the updater a private copy and can abort", async () => {
    const { client } = await setup();
    await client.state.set({ list: [1] });
    await client.state.update<{ list: number[] }>((draft) => {
      draft?.list.push(99);
      return undefined; // no write
    });
    expect(client.state.current).toEqual({ list: [1] });
    expect(client.state.version).toBe(1);
  });

  it("validates state on the client", async () => {
    const { client } = await setup();
    await expect(client.state.set({ big: "x".repeat(LIMITS.matchStateBytes) })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.state.set({ when: new Date() } as unknown as Json)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.state.set({ n: Number.NaN })).rejects.toMatchObject({ code: "invalid_params" });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(client.state.set(cyclic as Json)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.state.set(1, -1)).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("turns and rounds", () => {
  it("round-trips turn.end and fires onTurn", async () => {
    const { client } = await setup(makeContext({ turn: "alice" }));
    expect(client.turn.isMine).toBe(true);
    const turns = vi.fn();
    client.onTurn(turns);
    await client.turn.end();
    expect(client.turn.current).toBe("bob");
    expect(client.turn.isMine).toBe(false);
    expect(turns).toHaveBeenCalledWith({ turn: "bob", deadline: null });
  });

  it("passes the turn to a chosen player and rejects unknown ones", async () => {
    const { client } = await setup(makeContext({ turn: "alice" }));
    await client.turn.end("dan");
    expect(client.turn.current).toBe("dan");
    await expect(client.turn.end("zed")).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("round-trips round.set, fires onRound once, and refuses to go backwards", async () => {
    const { client, host } = await setup();
    const rounds = vi.fn();
    client.onRound(rounds);
    await client.round.set(2);
    await tick();
    expect(client.round.current).toBe(2);
    expect(rounds).toHaveBeenCalledTimes(1);
    host.emitRound(3);
    await tick();
    expect(client.round.current).toBe(3);
    await expect(client.round.set(1)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.round.set(1.5)).rejects.toMatchObject({ code: "invalid_params" });
  });
});

describe("spectators", () => {
  const spectating = () =>
    makeContext({ role: "spectator", seat: -1, players: [seat("bob", 0), seat("cara", 1)] });

  it("are refused locally for write methods", async () => {
    const { client } = await setup(spectating(), { "match.submit": () => ({ state: "waiting", result: null }), "room.send": () => null });
    await expect(client.submit({ score: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.room.send("x", 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.state.set({ a: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.state.update(() => 1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.turn.end()).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.round.set(1)).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.forfeit()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("are refused by the host even when a client skips the SDK checks", async () => {
    const submit = vi.fn(() => ({ state: "waiting" as const, result: null }));
    const { client, onRequestError } = await setup(spectating(), { "match.submit": submit, "room.send": () => null });
    for (const [method, params] of [
      ["match.submit", { score: 1 }],
      ["room.send", { type: "x", payload: 1 }],
      ["state.set", { state: 1, expectedVersion: 0 }],
      ["turn.end", {}],
      ["round.set", { round: 1 }],
    ] as const) {
      await expect(client.request(method, params as never)).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(submit).not.toHaveBeenCalled();
    expect(onRequestError).toHaveBeenCalledTimes(5);
  });

  it("can still read state and receive events", async () => {
    const { client, host } = await setup(spectating());
    await expect(client.state.get()).resolves.toEqual({ state: null, version: 0 });
    const onMessage = vi.fn();
    client.room.on("move", onMessage);
    host.emit("room.message", { type: "move", payload: 1, from: "bob", at: 1 });
    host.emitState({ a: 1 }, 1, "bob");
    await tick();
    expect(onMessage).toHaveBeenCalled();
    expect(client.state.current).toEqual({ a: 1 });
  });
});

describe("setup purpose", () => {
  it("submits settings and never starts a match", async () => {
    const submitSetup = vi.fn(() => null);
    const cancelSetup = vi.fn(() => null);
    const { client } = await setup(makeContext({ status: "open" }, "setup"), {
      ready: () => ({ startedAt: 5 }),
      submitSetup,
      cancelSetup,
    });
    expect(client.purpose).toBe("setup");
    expect(client.setup.active).toBe(true);
    const onStart = vi.fn();
    client.onStart(onStart);
    await client.ready();
    await tick();
    expect(onStart).not.toHaveBeenCalled();
    await client.setup.submit({ rounds: 5, theme: "cats" }, "5 rounds of cats");
    expect(submitSetup).toHaveBeenCalledWith({ settings: { rounds: 5, theme: "cats" }, summary: "5 rounds of cats" });
    await client.setup.cancel();
    expect(cancelSetup).toHaveBeenCalledWith({});
  });

  it("refuses match methods in setup purpose (client and host)", async () => {
    const { client } = await setup(makeContext({}, "setup"), { "room.send": () => null });
    await expect(client.state.get()).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.submit({ score: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("room.send", { type: "x", payload: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("turn.end", {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses setup methods in match purpose", async () => {
    const submitSetup = vi.fn(() => null);
    const { client } = await setup(makeContext(), { "setup.submit": submitSetup });
    await expect(client.setup.submit({ a: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("setup.submit", { settings: { a: 1 } })).rejects.toMatchObject({ code: "forbidden" });
    expect(submitSetup).not.toHaveBeenCalled();
  });

  it("answers unknown_method when the host has no setup handler", async () => {
    const { client } = await setup(makeContext({}, "setup"));
    await expect(client.setup.submit({ a: 1 })).rejects.toMatchObject({ code: "unknown_method" });
  });

  it("validates settings and summary on the client", async () => {
    const { client } = await setup(makeContext({}, "setup"), { "setup.submit": () => null });
    await expect(client.setup.submit({ blob: "x".repeat(LIMITS.setupSettingsBytes) })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.setup.submit({ a: 1 }, "x".repeat(LIMITS.setupSummaryLength + 1))).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.setup.submit([1] as unknown as { [k: string]: Json })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.setup.submit({ f: (() => 1) as unknown as Json })).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.setup.submit({ a: 1 }, "x".repeat(LIMITS.setupSummaryLength))).resolves.toBeNull();
  });
});

describe("host helpers", () => {
  it("resolves friendly handler aliases", async () => {
    const getState = vi.fn(() => ({ state: { hi: 1 } as Json, version: 3 }));
    const pair = createMemoryTransportPair();
    createHostCore(pair.host, { context: () => makeContext(), handlers: { getState } });
    const client = await connect({ transport: pair.app, timeoutMs: 1000 });
    await expect(client.state.get()).resolves.toEqual({ state: { hi: 1 }, version: 3 });
    expect(resolveHostHandler({ setState: () => ({ version: 1 }) }, "state.set")).toBeTypeOf("function");
    expect(resolveHostHandler({}, "turn.end")).toBeUndefined();
  });

  it("can take purpose/role from an access() option", async () => {
    const pair = createMemoryTransportPair();
    createHostCore(pair.host, {
      context: () => makeContext(),
      access: () => ({ purpose: "match", role: "spectator" }),
      handlers: { "state.set": () => ({ version: 1 }) },
    });
    const client = await connect({ transport: pair.app, timeoutMs: 1000 });
    await expect(client.request("state.set", { state: 1, expectedVersion: 0 })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("accessProblem covers purpose and role", () => {
    expect(accessProblem("state.set", { purpose: "match", match: { role: "player" } })).toBeNull();
    expect(accessProblem("state.get", { purpose: "match", match: { role: "spectator" } })).toBeNull();
    expect(accessProblem("ui.toast", { purpose: "setup" })).toBeNull();
    expect(accessProblem("storage.set", { purpose: "setup" })).toBeNull();
    expect(accessProblem("state.set", { purpose: "match", match: { role: "spectator" } })).toMatch(/spectator/);
    expect(accessProblem("setup.cancel", {})).toMatch(/setup/);
  });

  it("validates params of the new methods", () => {
    expect(validateRequest("state.get", {})).toBeNull();
    expect(validateRequest("state.set", { state: { a: [1, null] }, expectedVersion: 0 })).toBeNull();
    expect(validateRequest("state.set", { state: null, expectedVersion: 2 })).toBeNull();
    expect(validateRequest("state.set", { expectedVersion: 0 })).toMatch(/required/);
    expect(validateRequest("state.set", { state: 1, expectedVersion: -1 })).toMatch(/expectedVersion/);
    expect(validateRequest("state.set", { state: 1, expectedVersion: 0.5 })).toMatch(/expectedVersion/);
    expect(validateRequest("state.set", { state: "x".repeat(LIMITS.matchStateBytes), expectedVersion: 0 })).toMatch(/large/);
    expect(validateRequest("state.set", { state: { d: new Date() }, expectedVersion: 0 })).toMatch(/plain/);
    expect(validateRequest("turn.end", {})).toBeNull();
    expect(validateRequest("turn.end", { next: null })).toBeNull();
    expect(validateRequest("turn.end", { next: "bob" })).toBeNull();
    expect(validateRequest("turn.end", { next: 3 })).toMatch(/next/);
    expect(validateRequest("round.set", { round: 2 })).toBeNull();
    expect(validateRequest("round.set", { round: -1 })).toMatch(/round/);
    expect(validateRequest("setup.submit", { settings: { a: 1 }, summary: "hi" })).toBeNull();
    expect(validateRequest("setup.submit", { settings: [] })).toMatch(/object/);
    expect(validateRequest("setup.submit", { settings: { a: "x".repeat(5000) } })).toMatch(/large/);
    expect(validateRequest("setup.submit", { settings: {}, summary: "x".repeat(141) })).toMatch(/summary/);
    expect(validateRequest("setup.cancel", {})).toBeNull();
  });
});
