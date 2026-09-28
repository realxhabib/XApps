import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, resetConnection } from "../src/client";
import { createMockHost, type MockHostOptions } from "../src/mock-host";
import type { MatchResult } from "../src/protocol";

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
