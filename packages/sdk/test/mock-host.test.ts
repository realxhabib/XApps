import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { createMockHost, type MockHostOptions } from "../src/mock-host";
import { LIMITS, type AchievementDef, type MatchResult, type StatDef } from "../src/protocol";

afterEach(() => resetConnection());

describe("mock host (standalone mode)", () => {
  it("connects automatically when the page is not embedded", async () => {
    const client = await connect({ mock: { quiet: true, startDelayMs: 0 } });
    expect(client.match.mode).toBe("sandbox");
    expect(client.opponent?.isBot).toBe(true);

    const started = new Promise<number>((resolve) => client.onStart(resolve));
    await client.ready();
    await expect(started).resolves.toBeTypeOf("number");

    const ended = new Promise((resolve) => client.onEnd(resolve));
    const first = await client.submit({ score: 5 });
    expect(first.state).toBe("waiting");
    const bot = client.opponent!;
    await client.submitFor(bot.id, { score: 2 });
    await expect(ended).resolves.toMatchObject({ winnerId: "you", scores: { you: 5, bot: 2 } });
  });

  it("refuses to submit for a human opponent", async () => {
    const client = await connect({ mock: { quiet: true } });
    await expect(client.submitFor("nobody", { score: 1 })).rejects.toMatchObject({ code: "internal" });
  });

  it("throws when mock mode is disabled", async () => {
    await expect(connect({ mock: false })).rejects.toMatchObject({ code: "not_connected" });
  });
});

describe("mock host (v2 matches)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function mockClient(options: MockHostOptions) {
    const mock = createMockHost({ quiet: true, startDelayMs: 0, readUrl: false, ...options });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
    return { mock, client };
  }

  it("seats N players with bots filling the table", async () => {
    const { client } = await mockClient({ players: 4 });
    expect(client.players.map((p) => p.id)).toEqual(["you", "bot", "bot2", "bot3"]);
    expect(client.opponents).toHaveLength(3);
    expect(client.match).toMatchObject({ minPlayers: 2, maxPlayers: 4, teams: 0 });
  });

  it("settles a 4-player match with ranks once everyone submitted", async () => {
    const { client } = await mockClient({ players: 4 });
    await client.ready();
    const ended = new Promise<MatchResult>((resolve) => client.onEnd(resolve));
    await client.submit({ score: 5 });
    await client.submitFor("bot", { score: 9 });
    await client.submitFor("bot2", { score: 5 });
    const last = await client.submitFor("bot3", { score: 1 });
    expect(last.state).toBe("final");
    const result = await ended;
    expect(result.winnerId).toBe("bot");
    expect(result.ranks).toEqual({ bot: 1, you: 2, bot2: 2, bot3: 4 });
  });

  it("plays teams: team sums decide, winnerTeam is set", async () => {
    const { client } = await mockClient({ players: 4, teams: 2 });
    expect(client.teammates.map((p) => p.id)).toEqual(["bot2"]);
    const ended = new Promise<MatchResult>((resolve) => client.onEnd(resolve));
    await client.submit({ score: 4 });
    await client.submitFor("bot", { score: 5 });
    await client.submitFor("bot2", { score: 3 });
    await client.submitFor("bot3", { score: 1 });
    const result = await ended;
    expect(result).toMatchObject({ winnerId: null, winnerTeam: 0 });
    expect(result.ranks).toMatchObject({ you: 1, bot2: 1, bot: 2, bot3: 2 });
  });

  it("keeps versioned state with conflicts", async () => {
    const { client, mock } = await mockClient({ players: 3, state: { moves: [] } });
    expect(client.state.version).toBe(1);
    await client.state.set({ moves: ["a"] });
    expect(mock.context.match.stateVersion).toBe(2);
    mock.setState({ moves: ["a", "b"] }, "bot");
    await expect(client.state.set({ moves: ["x"] }, 2)).rejects.toMatchObject({ code: "conflict" });
    await tick();
    expect(client.state.current).toEqual({ moves: ["a", "b"] });
    // update() starts from the latest known state.
    await client.state.update<{ moves: string[] }>((s) => ({ moves: [...(s?.moves ?? []), "c"] }));
    expect(mock.context.match.state).toEqual({ moves: ["a", "b", "c"] });
  });

  it("update() recovers from a write the client hasn't heard about yet", async () => {
    const { client, mock } = await mockClient({});
    const seen: number[] = [];
    client.state.onChange((_, change) => seen.push(change.version));
    mock.setState(1, "bot"); // event is in flight while update() runs
    const result = await client.state.update<number>((n) => (n ?? 0) + 10);
    expect(result.state).toBe(11);
    expect(mock.context.match.state).toBe(11);
    await tick();
    expect(seen).toEqual([1, 2]);
  });

  it("rotates turns around the table, and lets the app end bot turns", async () => {
    const { client } = await mockClient({ players: 3, turnBased: true });
    expect(client.turn.current).toBe("you");
    expect(client.turn.isMine).toBe(true);
    const turns: Array<string | null> = [];
    client.onTurn(({ turn }) => turns.push(turn));
    await client.turn.end();
    await client.turn.end(); // bot's turn, driven by the app
    await client.turn.end();
    expect(turns).toEqual(["bot", "bot2", "you"]);
    await client.turn.end("bot2");
    expect(client.turn.current).toBe("bot2");
  });

  it("refuses to end another human's turn", async () => {
    const { client, mock } = await mockClient({ players: 2, turnBased: true });
    mock.context.match.players[1]!.isBot = false;
    await client.turn.end();
    await expect(client.turn.end()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("counts rounds monotonically", async () => {
    const { client, mock } = await mockClient({});
    await client.round.set(1);
    mock.setRound(3);
    await tick();
    expect(client.round.current).toBe(3);
    await expect(client.request("round.set", { round: 2 })).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("lets a spectator watch bots but refuses writes", async () => {
    const { client } = await mockClient({ role: "spectator", players: 3 });
    expect(client.isSpectator).toBe(true);
    expect(client.players.every((p) => p.isBot)).toBe(true);
    await expect(client.state.set({ a: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(client.request("match.submit", { score: 1 })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("runs setup purpose: shows the submitted settings and never starts", async () => {
    const { client, mock } = await mockClient({ purpose: "setup", settings: { rounds: 3 } });
    expect(client.purpose).toBe("setup");
    expect(client.match.settings).toEqual({ rounds: 3 });
    const onStart = vi.fn();
    client.onStart(onStart);
    await client.ready();
    await new Promise((r) => setTimeout(r, 10));
    expect(onStart).not.toHaveBeenCalled();
    await client.setup.submit({ rounds: 7 }, "Best of 7");
    expect(mock.setup).toEqual({ status: "submitted", settings: { rounds: 7 }, summary: "Best of 7" });
    const banner = document.getElementById("xapps-mock-banner");
    expect(banner?.textContent).toContain("Best of 7");
    expect(banner?.querySelector("a")?.getAttribute("href")).toContain("xapps-settings=");
    banner?.remove();
  });

  it("reads ?xapps-purpose / ?xapps-settings / ?xapps-players from the URL", async () => {
    const settings = encodeURIComponent(JSON.stringify({ theme: "space" }));
    window.history.replaceState(null, "", `/?xapps-purpose=setup&xapps-settings=${settings}&xapps-players=3`);
    try {
      const mock = createMockHost({ quiet: true });
      expect(mock.context.purpose).toBe("setup");
      expect(mock.context.match.settings).toEqual({ theme: "space" });
      expect(mock.context.match.players).toHaveLength(3);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("mock host (media & data)", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const stats: StatDef[] = [
    { key: "best", label: "Best", aggregate: "max" },
    { key: "fastest", label: "Fastest", aggregate: "min", format: "ms" },
    { key: "total", label: "Total", aggregate: "sum" },
    { key: "latest", label: "Latest", aggregate: "last" },
  ];
  const achievements: AchievementDef[] = [{ id: "first_win", name: "First win", description: "Win once", icon: "🏆", xp: 10 }];

  async function mockClient(options: MockHostOptions = {}) {
    const mock = createMockHost({ quiet: true, startDelayMs: 0, readUrl: false, stats, achievements, ...options });
    const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
    return { mock, client };
  }

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uploads to an object URL with the image size", async () => {
    const createObjectURL = vi.fn(() => "blob:http://localhost/abc");
    const original = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true, writable: true });
    onTestFinished(() => {
      if (original) Object.defineProperty(URL, "createObjectURL", original);
      else delete (URL as { createObjectURL?: unknown }).createObjectURL;
    });
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 64, height: 48, close })));
    const { client, mock } = await mockClient();
    const file = new Blob([new Uint8Array(10)], { type: "image/png" });
    const ref = await client.media.upload(file, { alt: "dot" });
    expect(ref).toEqual({ url: "blob:http://localhost/abc", kind: "image", mime: "image/png", bytes: 10, width: 64, height: 48 });
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(close).toHaveBeenCalled();
    expect(mock.uploads).toMatchObject([{ url: ref.url, alt: "dot", file }]);
    // ...and the upload can go straight into an entry.
    const submitted = await client.submit({ display: { kind: "image", url: ref.url, alt: "dot" } });
    expect(submitted.state).toBe("waiting");
  });

  it("uploads audio/video without metadata where the environment can't decode it", async () => {
    const { client } = await mockClient();
    const ref = await client.media.upload(new Blob(["clip"], { type: "video/webm;codecs=vp8" }));
    expect(ref).toMatchObject({ kind: "video", mime: "video/webm", bytes: 4 });
    expect(ref.url).toMatch(/^blob:/);
    expect(ref.duration).toBeUndefined();
    await client.submit({ display: { kind: "video", url: ref.url, alt: "My clip" } });
  });

  it("enforces the daily upload count", async () => {
    const { client } = await mockClient({ probeMedia: false });
    const file = new Blob(["x"], { type: "image/gif" });
    for (let i = 0; i < LIMITS.media.uploadsPerDay; i++) await client.media.upload(file);
    await expect(client.media.upload(file)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("keeps user storage in localStorage and a read-only, seeded app scope", async () => {
    const { client, mock } = await mockClient({ appStorage: { "puzzle:today": { grid: [1, 2] }, config: { hard: true } } });
    await client.storage.set("save:1", { level: 2 });
    await client.storage.set("save:2", { level: 5 });
    await client.storage.set("prefs", { sound: false });
    await expect(client.storage.get("save:1")).resolves.toEqual({ level: 2 });
    await expect(client.storage.list({ prefix: "save:" })).resolves.toEqual(["save:1", "save:2"]);
    await client.storage.delete("save:1");
    await expect(client.storage.get("save:1")).resolves.toBeNull();
    await expect(client.storage.list()).resolves.toEqual(["prefs", "save:2"]);

    await expect(client.storage.get("puzzle:today", { scope: "app" })).resolves.toEqual({ grid: [1, 2] });
    await expect(client.storage.get("prefs", { scope: "app" })).resolves.toBeNull();
    await expect(client.storage.list({ scope: "app" })).resolves.toEqual(["config", "puzzle:today"]);
    await expect(client.request("storage.set", { key: "config", value: 1, scope: "app" } as never)).rejects.toMatchObject({
      code: "invalid_params",
    });
    mock.setAppStorage("season", 3);
    await expect(client.storage.get("season", { scope: "app" })).resolves.toBe(3);
  });

  it("caps user storage at storageKeysPerUser keys", async () => {
    const { client } = await mockClient();
    for (let i = 0; i < LIMITS.storageKeysPerUser; i++) localStorage.setItem(`xapps-mock:k${i}`, "1");
    await expect(client.storage.set("one_more", 1)).rejects.toMatchObject({ code: "invalid_params" });
    await expect(client.storage.set("k0", 2)).resolves.toBeNull(); // overwriting is fine
  });

  it("aggregates stats per declared def", async () => {
    const { client, mock } = await mockClient();
    expect(client.stats.defs.map((d) => d.key)).toEqual(["best", "fastest", "total", "latest"]);
    await expect(client.stats.report({ best: 5, fastest: 900, total: 2, latest: 7 })).resolves.toEqual({
      best: 5,
      fastest: 900,
      total: 2,
      latest: 7,
    });
    await expect(client.stats.report({ best: 3, fastest: 1200, total: 3, latest: 1 })).resolves.toEqual({
      best: 5,
      fastest: 900,
      total: 5,
      latest: 1,
    });
    expect(mock.stats).toEqual({ best: 5, fastest: 900, total: 5, latest: 1 });
    await expect(client.stats.report({ nope: 1 })).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("unlocks achievements once, emits achievement.unlock and shows a banner", async () => {
    const { client, mock } = await mockClient();
    const events: string[] = [];
    client.onAchievement(({ id, userId }, def) => events.push(`${id}:${userId}:${def?.icon}`));
    await expect(client.achievements.unlock("first_win")).resolves.toEqual({ unlocked: true });
    await expect(client.achievements.unlock("first_win")).resolves.toEqual({ unlocked: false });
    await tick();
    expect(events).toEqual(["first_win:you:🏆"]);
    expect(mock.achievements.has("first_win")).toBe(true);
    expect(client.achievements.unlocked.has("first_win")).toBe(true);
    const banner = document.getElementById("xapps-mock-achievement");
    expect(banner?.textContent).toContain("First win");
    expect(banner?.textContent).toContain("+10 XP");
    banner?.remove();
    await expect(client.achievements.unlock("undeclared")).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("refuses stats and achievements in setup purpose and for spectators", async () => {
    const setup = await mockClient({ purpose: "setup", banner: false });
    await expect(setup.client.stats.report({ best: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(setup.client.achievements.unlock("first_win")).rejects.toMatchObject({ code: "forbidden" });
    const file = new Blob(["x"], { type: "image/png" });
    await expect(setup.client.media.upload(file)).resolves.toMatchObject({ kind: "image" });
    resetConnection();
    const watching = await mockClient({ role: "spectator" });
    await expect(watching.client.media.upload(file)).rejects.toMatchObject({ code: "forbidden" });
    await expect(watching.client.storage.set("k", 1)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("reads ?xapps-stats / ?xapps-achievements from the URL", async () => {
    const s = encodeURIComponent(JSON.stringify([{ key: "best", aggregate: "max" }, { nope: true }]));
    const a = encodeURIComponent(JSON.stringify([{ id: "gg" }]));
    window.history.replaceState(null, "", `/?xapps-stats=${s}&xapps-achievements=${a}`);
    try {
      const mock = createMockHost({ quiet: true });
      expect(mock.context.app.stats).toEqual([{ key: "best", label: "best", aggregate: "max" }]);
      expect(mock.context.app.achievements).toEqual([{ id: "gg", name: "gg", description: "", icon: "🏆", xp: 0 }]);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});
