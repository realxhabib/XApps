import { describe, expect, it } from "vitest";
import {
  CUP_GAP,
  FORMATION_LABEL,
  RERACK_OPTIONS,
  cupWorld,
  formationSlots,
  frontCup,
  openingRack,
  rerack,
  rerackOptions,
  toWorld,
  type Formation,
} from "./geometry";
import { simulateThrow, idealThrow } from "./physics";
import {
  BOT_SKILL,
  DIFFICULTIES,
  F_BOUNCE,
  F_RIM,
  F_TIMEOUT,
  THROW_MS,
  actorOf,
  applyAction,
  applyStateAction,
  botPick,
  botRerack,
  botTarget,
  botThrow,
  gameAt,
  newGame,
  readPongState,
  replayFrom,
  rerackChoices,
  resumeClockAt,
  seededRandom,
  type Action,
  type GameState,
  type Seats,
} from "./logic";

const SEATS: Seats = ["alice", "bob"];
const T = (by: string, c: number, f = 0): Action => ({ k: "t", by, a: 0, p: 0.7, c, f, at: 1 });
const X = (by: string, c: number): Action => ({ k: "x", by, c, at: 1 });
const R = (by: string, f: Formation): Action => ({ k: "r", by, f, at: 1 });

function play(actions: Action[], from: GameState = newGame()): GameState {
  let g = from;
  for (const a of actions) {
    const next = applyAction(g, a, a.by === "alice" ? 0 : 1);
    if (!next) throw new Error(`illegal ${JSON.stringify(a)} at n=${g.n}`);
    g = next;
  }
  return g;
}

describe("re-rack layouts", () => {
  it("the opening rack is a 4-3-2-1 triangle of touching cups, apex to the shooter", () => {
    const rack = openingRack();
    expect(rack).toHaveLength(10);
    expect(new Set(rack.map((c) => c.id)).size).toBe(10);
    const rows = [...new Set(rack.map((c) => c.v))].sort((a, b) => a - b);
    expect(rows.map((v) => rack.filter((c) => c.v === v).length)).toEqual([4, 3, 2, 1]);
    const apex = rack.find((c) => c.v === rows[3])!;
    expect(apex.u).toBe(0);
    for (const a of rack) {
      for (const b of rack) {
        if (a !== b) expect(Math.hypot(a.u - b.u, a.v - b.v)).toBeGreaterThanOrEqual(CUP_GAP - 1e-3);
      }
    }
  });

  it.each(Object.entries(RERACK_OPTIONS).flatMap(([n, fs]) => fs.map((f) => [Number(n), f] as const)))(
    "%i cups → %s: right count, no overlaps, centred",
    (count, formation) => {
      const slots = formationSlots(formation, count)!;
      expect(slots).toHaveLength(count);
      for (const a of slots) {
        for (const b of slots) {
          if (a !== b) expect(Math.hypot(a.u - b.u, a.v - b.v)).toBeGreaterThanOrEqual(CUP_GAP - 1e-3);
        }
      }
      const meanU = slots.reduce((s, c) => s + c.u, 0) / count;
      expect(Math.abs(meanU)).toBeLessThan(0.03);
      expect(FORMATION_LABEL[formation]).toBeTruthy();
    },
  );

  it("specific shapes", () => {
    const u = (f: Formation, n: number) => formationSlots(f, n)!.map((s) => Math.round(s.u / (CUP_GAP / 2)));
    expect(u("triangle", 6)).toEqual([-2, 0, 2, -1, 1, 0]);
    expect(u("diamond", 4)).toEqual([0, -1, 1, 0]);
    expect(u("line", 3)).toEqual([0, 0, 0]);
    expect(u("pair", 2)).toEqual([-1, 1]);
    expect(formationSlots("diamond", 5)).toBeNull();
    expect(formationSlots("full", 6)).toBeNull();
  });

  it("re-racks keep cup ids and only exist at 6, 4, 3 and 2 cups", () => {
    const rack = openingRack().filter((c) => [0, 3, 5, 9].includes(c.id));
    const next = rerack(rack, "diamond")!;
    expect(next.map((c) => c.id).sort()).toEqual([0, 3, 5, 9]);
    expect(rerack(rack, "triangle")).toBeNull();
    for (const n of [10, 9, 8, 7, 5, 1, 0]) expect(rerackOptions(n)).toEqual([]);
    for (const n of [6, 4, 3, 2]) expect(rerackOptions(n).length).toBeGreaterThanOrEqual(2);
  });

  it("the front cup is the one closest to the shooter", () => {
    expect(frontCup(openingRack())?.id).toBe(9);
    expect(frontCup([])).toBeNull();
  });

  it("seat 1's frame is seat 0's turned around; each rack sits at its defender's end", () => {
    expect(toWorld(0, { x: 0.1, y: 0.3, z: 0.5 })).toEqual({ x: -0.1, y: 0.3, z: 0.5 });
    expect(toWorld(1, { x: 0.1, y: 0.3, z: 0.5 })).toEqual({ x: 0.1, y: 0.3, z: 2.44 - 0.5 });
    const apex = openingRack()[9]!;
    expect(cupWorld(1, apex).z).toBeGreaterThan(2); // bob's cups: far from alice
    expect(cupWorld(0, apex).z).toBeLessThan(0.5); // alice's cups: at her end
  });
});

describe("turns", () => {
  it("two balls a turn, then the other player", () => {
    let g = play([T("alice", -1)]);
    expect([g.turn, g.ball]).toEqual([0, 1]);
    g = play([T("alice", 9)], g);
    expect([g.turn, g.ball, g.turns]).toEqual([1, 0, 1]);
    expect(g.racks[1]).toHaveLength(9);
    expect(g.racks[0]).toHaveLength(10);
  });

  it("sink both and it's balls back: the same player goes again", () => {
    const g = play([T("alice", 9), T("alice", 8)]);
    expect([g.turn, g.ball, g.turns]).toEqual([0, 0, 0]);
    expect(g.stats[0].ballsBack).toBe(1);
    expect(applyAction(g, T("bob", -1), 1)).toBeNull();
  });

  it("rejects throws out of turn and cups that aren't there", () => {
    const g = newGame();
    expect(applyAction(g, T("bob", -1), 1)).toBeNull();
    const after = play([T("alice", 9)]);
    expect(applyAction(after, T("alice", 9), 0)).toBeNull();
    expect(applyAction(after, T("alice", 42), 0)).toBeNull();
    expect(applyAction(g, { k: "t", by: "alice", a: 0, p: 0.5, c: -1, f: F_BOUNCE, at: 1 }, 0)).toBeNull();
  });

  it("a bounce shot owes a bonus pick before the next ball", () => {
    let g = play([T("alice", 9, F_BOUNCE)]);
    expect(g.pendingPick).toBe(0);
    expect(actorOf(g)).toBe(0);
    expect(applyAction(g, T("alice", -1), 0)).toBeNull();
    expect(applyAction(g, X("bob", 3), 1)).toBeNull();
    g = play([X("alice", 3)], g);
    expect(g.pendingPick).toBeNull();
    expect(g.racks[1].map((c) => c.id)).not.toContain(3);
    expect(g.racks[1]).toHaveLength(8);
    expect([g.turn, g.ball]).toEqual([0, 1]);
    expect(g.stats[0]).toMatchObject({ made: 1, cups: 2, bounces: 1 });
  });

  it("a bounce on the second ball: pick, then balls back if both went in", () => {
    const g = play([T("alice", 9), T("alice", 8, F_BOUNCE), X("alice", 0)]);
    expect([g.turn, g.ball]).toEqual([0, 0]);
    expect(g.stats[0].ballsBack).toBe(1);
  });

  it("three in a row sets you on fire, a miss puts it out", () => {
    let g = play([T("alice", 9), T("alice", 8)]); // balls back
    expect(g.fire[0]).toBe(false);
    g = play([T("alice", 7)], g);
    expect(g.fire[0]).toBe(true);
    expect(g.stats[0].fires).toBe(1);
    g = play([T("alice", -1)], g);
    expect(g.fire[0]).toBe(false);
    expect(g.stats[0].bestStreak).toBe(3);
  });

  it("streaks carry over between turns", () => {
    const g = play([T("alice", -1), T("alice", 9), T("bob", -1), T("bob", -1), T("alice", 8), T("alice", 7)]);
    expect(g.fire[0]).toBe(true);
  });

  it("re-racks: once a game, at the start of a turn, at 6/4/3/2 cups", () => {
    const sixLeft = play([T("alice", 9), T("alice", 8), T("alice", 7), T("alice", 6)]);
    expect(sixLeft.racks[1]).toHaveLength(6);
    expect(rerackChoices(sixLeft, 0)).toEqual(["triangle", "zipper"]);
    expect(rerackChoices(sixLeft, 1)).toEqual([]);
    expect(applyAction(sixLeft, R("alice", "diamond"), 0)).toBeNull();
    const racked = play([R("alice", "triangle")], sixLeft);
    expect(racked.racks[1]).toHaveLength(6);
    expect(racked.stats[0].rerackUsed).toBe(true);
    expect(rerackChoices(racked, 0)).toEqual([]);
    expect(applyAction(racked, R("alice", "zipper"), 0)).toBeNull();
    // Mid-turn (second ball) re-racks aren't allowed.
    const mid = play([T("alice", -1)], sixLeft);
    expect(applyAction(mid, R("alice", "triangle"), 0)).toBeNull();
  });

  it("sinking the first ball after a re-rack earns re-rack and roll", () => {
    const sixLeft = play([T("alice", 9), T("alice", 8), T("alice", 7), T("alice", 6)]);
    const cup = play([R("alice", "triangle")], sixLeft).racks[1][0]!.id;
    const g = play([R("alice", "triangle"), T("alice", cup)], sixLeft);
    expect(g.stats[0].rerackMake).toBe(true);
    const miss = play([R("alice", "triangle"), T("alice", -1), T("alice", cup)], sixLeft);
    expect(miss.stats[0].rerackMake).toBe(false);
  });

  it("clearing the rack wins at once", () => {
    const ids = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const g = play(ids.map((c) => T("alice", c)));
    expect(g.winner).toBe(0);
    expect(g.over).toBe(true);
    expect(applyAction(g, T("alice", -1), 0)).toBeNull();
  });

  it("a bounce shot on the last-but-one cup wins without a pick", () => {
    const ids = [9, 8, 7, 6, 5, 4, 3, 2];
    let g = play(ids.map((c) => T("alice", c)));
    expect(g.racks[1]).toHaveLength(2);
    g = play([T("alice", 1, F_BOUNCE), X("alice", 0)], g);
    expect(g.winner).toBe(0);
  });

  it("tracks the worst deficit for comebacks", () => {
    const g = play([T("alice", 9), T("alice", 8), T("alice", 7), T("alice", 6), T("alice", 5), T("alice", -1)]);
    expect(g.stats[1].maxDeficit).toBe(5);
    expect(g.stats[0].maxDeficit).toBe(0);
  });
});

describe("shared state", () => {
  it("round-trips through the reducer, validating every action", () => {
    let state: unknown = null;
    const actions = [T("alice", 9, F_RIM), T("alice", -1), T("bob", 4), T("bob", -1)];
    for (const a of actions) {
      const res = applyStateAction(state, a, SEATS, { path: [0, 0, 340, -160, 30, 0, 400, 0], ev: [] });
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    const read = readPongState(state, SEATS)!;
    expect(read.log).toHaveLength(4);
    expect(read.game.racks.map((r) => r.length)).toEqual([9, 9]);
    expect(state).toMatchObject({ v: 1, cups: [9, 9], winner: null });
  });

  it("refuses wrong players, wrong turns and a stale turn holder", () => {
    expect(applyStateAction(null, T("mallory", -1), SEATS)).toEqual({ ok: false, reason: "not-a-player" });
    expect(applyStateAction(null, T("bob", -1), SEATS)).toEqual({ ok: false, reason: "wrong-turn" });
    expect(applyStateAction(null, T("alice", -1), SEATS, null, "bob")).toEqual({ ok: false, reason: "not-your-turn" });
    expect(applyStateAction({ log: "junk" }, T("alice", -1), SEATS)).toEqual({ ok: false, reason: "bad-state" });
  });

  it("reading rejects tampered logs", () => {
    expect(readPongState({ log: [T("bob", -1)] }, SEATS)).toBeNull();
    expect(readPongState({ log: [{ k: "t", by: "alice" }] }, SEATS)).toBeNull();
    expect(readPongState({ log: [T("alice", 77)] }, SEATS)).toBeNull();
    expect(readPongState(null, SEATS)?.log).toEqual([]);
  });

  it("keeps the trajectories of the latest run only (for replays)", () => {
    let state: unknown = null;
    const traj = { path: [0, 0, 0, 0, 10, 0, 0, 0], ev: [] };
    for (const a of [T("alice", -1), T("alice", -1), T("bob", 9), T("bob", 8), T("bob", -1)]) {
      const res = applyStateAction(state, a, SEATS, traj);
      if (!res.ok) throw new Error(res.reason);
      state = res.state;
    }
    const read = readPongState(state, SEATS)!;
    expect(read.recent.map((r) => r.n)).toEqual([2, 3, 4]);
    // Alice opens the game: she replays Bob's run. Bob has nothing to replay.
    expect(replayFrom(read.log, read.recent, "alice")).toBe(2);
    expect(replayFrom(read.log, read.recent, "bob")).toBe(5);
    expect(gameAt(read.log, SEATS, 2).racks[0]).toHaveLength(10);
  });

  it("a re-rack right before the run is replayed with it", () => {
    let state: unknown = null;
    const traj = { path: [0, 0, 0, 0, 10, 0, 0, 0], ev: [] };
    const actions = [T("alice", 9), T("alice", 8), T("alice", 7), T("alice", 6), R("alice", "triangle")];
    for (const a of actions) {
      const res = applyStateAction(state, a, SEATS, a.k === "t" ? traj : null);
      if (!res.ok) throw new Error(res.reason);
      state = res.state;
    }
    const read = readPongState(state, SEATS)!;
    const first = read.game.racks[1][0]!.id;
    const res = applyStateAction(state, T("alice", first), SEATS, traj);
    if (!res.ok) throw new Error(res.reason);
    const again = readPongState(res.state, SEATS)!;
    expect(replayFrom(again.log, again.recent, "bob")).toBe(0);
  });

  it("stays well under the 64 KB state limit in a long game", () => {
    let state: unknown = null;
    const rack = openingRack();
    const r = simulateThrow({ aim: 0.3, power: 1.1 }, rack);
    const traj = { path: Array.from({ length: 480 }, (_, i) => i), ev: [] };
    expect(r.path.length).toBeLessThan(150);
    for (let i = 0; i < 200; i++) {
      const by = i % 4 < 2 ? "alice" : "bob";
      const res = applyStateAction(state, T(by, -1), SEATS, traj);
      if (!res.ok) throw new Error(res.reason);
      state = res.state;
    }
    expect(JSON.stringify(state).length).toBeLessThan(40_000);
  });

  it("clock resumes fairly", () => {
    expect(resumeClockAt([], 10_000)).toBe(10_000);
    const log = [T("alice", -1)];
    expect(resumeClockAt(log, 1_000_000)).toBe(1_000_000 - THROW_MS + 8_000);
    expect(F_TIMEOUT).toBe(4);
  });
});

describe("bot", () => {
  const hitRate = (difficulty: (typeof DIFFICULTIES)[number], cups = openingRack(), n = 300) => {
    const random = seededRandom(7);
    let hits = 0;
    for (let i = 0; i < n; i++) if (simulateThrow(botThrow(cups, difficulty, random), cups).cup !== null) hits++;
    return hits / n;
  };

  it("accuracy follows difficulty", () => {
    const easy = hitRate("easy");
    const medium = hitRate("medium");
    const hard = hitRate("hard");
    expect(easy).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
    expect(easy).toBeGreaterThan(0.12);
    expect(easy).toBeLessThan(0.42);
    expect(hard).toBeGreaterThan(0.45);
    expect(hard).toBeLessThan(0.8);
  });

  it("a lone cup is much harder, even for the hard bot", () => {
    const lone = [{ id: 0, ...formationSlots("line", 2)![1]! }];
    expect(hitRate("hard", lone)).toBeLessThan(hitRate("hard"));
    expect(hitRate("easy", lone)).toBeLessThan(0.3);
  });

  it("is deterministic for a seeded source", () => {
    const a = botThrow(openingRack(), "medium", seededRandom(3));
    const b = botThrow(openingRack(), "medium", seededRandom(3));
    expect(a).toEqual(b);
    expect(BOT_SKILL.easy.aimSd).toBeGreaterThan(BOT_SKILL.hard.aimSd);
  });

  it("aims at cups that are there, preferring the front", () => {
    const rack = openingRack();
    const random = seededRandom(11);
    const picks = new Map<number, number>();
    for (let i = 0; i < 500; i++) {
      const c = botTarget(rack, random)!;
      picks.set(c.id, (picks.get(c.id) ?? 0) + 1);
    }
    expect(picks.get(9)! + picks.get(8)! + picks.get(7)!).toBeGreaterThan(picks.get(0)! + picks.get(3)! + picks.get(1)!);
    expect(botTarget([], random)).toBeNull();
    // The ideal throw it starts from really goes in.
    expect(simulateThrow(idealThrow(rack[5]!), rack).cup).toBe(5);
  });

  it("re-racks and picks legally", () => {
    const fourLeft = play([T("alice", 9), T("alice", 8), T("alice", 7), T("alice", 6), T("alice", 5), T("alice", 4)]);
    expect(fourLeft.racks[1]).toHaveLength(4);
    const f = botRerack(fourLeft, 0, "hard", () => 0);
    expect(f).toBe("diamond");
    expect(applyAction(fourLeft, R("alice", f!), 0)).not.toBeNull();
    expect(botRerack(newGame(), 0, "hard", () => 0)).toBeNull();
    const bounce = play([T("alice", 9, F_BOUNCE)]);
    const pick = botPick(bounce, 0)!;
    expect(applyAction(bounce, X("alice", pick), 0)).not.toBeNull();
  });
});
