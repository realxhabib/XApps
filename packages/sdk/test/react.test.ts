import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { connect, resetConnection } from "../src/client";
import { createMockHost } from "../src/mock-host";
import { XAppsProvider, useMatchState, usePlayers, useRound, useSetup, useTurn } from "../src/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => resetConnection());

async function render(node: ReactNode, mockOptions: Parameters<typeof createMockHost>[0] = {}) {
  const mock = createMockHost({ quiet: true, readUrl: false, ...mockOptions });
  // XAppsProvider calls connect() with no transport; prime the shared client with the mock.
  const client = await connect({ transport: mock.transport, timeoutMs: 1000 });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(XAppsProvider, null, node));
  });
  return { mock, client, container, root };
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe("react hooks", () => {
  it("useMatchState, useTurn, useRound and usePlayers track the match", async () => {
    const seen: { state?: unknown; version?: number; turn?: string | null; isMine?: boolean; round?: number; players?: number; teammates?: string[] } = {};
    let api: ReturnType<typeof useMatchState<{ n: number }>> | null = null;
    let turnApi: ReturnType<typeof useTurn> | null = null;
    function Probe() {
      const state = useMatchState<{ n: number }>();
      const turn = useTurn();
      const { round } = useRound();
      const { players, teammates } = usePlayers();
      api = state;
      turnApi = turn;
      Object.assign(seen, {
        state: state.state,
        version: state.version,
        turn: turn.turn,
        isMine: turn.isMine,
        round,
        players: players.length,
        teammates: teammates.map((p) => p.id),
      });
      return null;
    }
    const { mock, root } = await render(createElement(Probe), { players: 4, teams: 2, turnBased: true });
    expect(seen).toMatchObject({ state: null, version: 0, turn: "you", isMine: true, round: 0, players: 4, teammates: ["bot2"] });

    await act(async () => {
      await api!.update((s) => ({ n: (s?.n ?? 0) + 1 }));
    });
    expect(seen).toMatchObject({ state: { n: 1 }, version: 1 });

    mock.setState({ n: 5 }, "bot");
    mock.setRound(2);
    await flush();
    expect(seen).toMatchObject({ state: { n: 5 }, version: 2, round: 2 });

    await act(async () => {
      await turnApi!.end();
    });
    await flush();
    expect(seen).toMatchObject({ turn: "bot", isMine: false });
    act(() => root.unmount());
  });

  it("useSetup exposes purpose, settings and submit", async () => {
    let setup: ReturnType<typeof useSetup> | null = null;
    function Probe() {
      setup = useSetup();
      return null;
    }
    const { mock, root } = await render(createElement(Probe), { purpose: "setup", settings: { rounds: 3 }, banner: false });
    expect(setup!).toMatchObject({ purpose: "setup", isSetup: true, settings: { rounds: 3 } });
    await act(async () => {
      await setup!.submit({ rounds: 9 }, "Nine rounds");
    });
    expect(mock.setup).toMatchObject({ status: "submitted", settings: { rounds: 9 } });
    act(() => root.unmount());
  });
});
