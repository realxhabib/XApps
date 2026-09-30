import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import { BALLS, FOOT_SPOT, HEAD_X, R, TABLE_W, type Balls, type SimResult, type Vec } from "./physics";
import {
  checkCueSpot,
  judge,
  legalTargets,
  needsCall,
  newGame,
  onEight,
  playShot,
  readState,
  timeoutFoul,
  toStateJson,
  type Game,
  type Seat,
} from "./rules";

/** A table with the given balls; everything else pocketed. */
function tableOf(ids: number[], cue: Vec | null = { x: 0.5, y: 0.56 }): Balls {
  const balls: Balls = new Array(BALLS).fill(null);
  balls[0] = cue;
  ids.forEach((id, k) => {
    balls[id] = { x: 1.0 + (k % 5) * 0.12, y: 0.2 + Math.floor(k / 5) * 0.2 };
  });
  return balls;
}

function game(over: Partial<Game> = {}): Game {
  return { ...newGame(createRandom("rules").next), broken: true, bih: null, ...over };
}

/** A made-up simulation outcome: `potted` drop in order (cue ball = 0), `final` is the table afterwards. */
function sim(start: Balls, o: { firstHit?: number | null; potted?: [number, number][]; rail?: boolean; railBalls?: number; banked?: number[] }): SimResult {
  const final = start.slice();
  const pocketed = (o.potted ?? []).map(([id, pocket], k) => {
    final[id] = null;
    return { id, pocket, ms: 100 + k * 50 };
  });
  return {
    final,
    pocketed,
    firstHit: o.firstHit === undefined ? null : o.firstHit,
    railAfterContact: o.rail ?? false,
    railBalls: o.railBalls ?? 0,
    banked: o.banked ?? [],
    cueRailsBeforeHit: 0,
    ms: 1000,
    rec: { ms: 1000, tracks: [], events: [] },
  };
}

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const SOLIDS_SEAT0 = { solids: 0 as Seat };

describe("the break", () => {
  const start = () => game({ broken: false, bih: "kitchen", balls: tableOf(ALL) });

  it("potting a ball keeps the table, which stays open", () => {
    const g = start();
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 1, potted: [[3, 0]], railBalls: 5 }), null);
    expect(summary.foul).toBeNull();
    expect(summary.cont).toBe(true);
    expect(next.turn).toBe(0);
    expect(next.solids).toBeNull();
    expect(next.broken).toBe(true);
    expect(next.bih).toBeNull();
    expect(next.run).toBe(1);
  });

  it("fewer than four balls to a cushion and nothing down is a foul", () => {
    const g = start();
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 1, railBalls: 3 }), null);
    expect(summary.foul).toBe("weak_break");
    expect(next.turn).toBe(1);
    expect(next.bih).toBe("kitchen");
  });

  it("a scratch on the break: ball in hand behind the head string", () => {
    const g = start();
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 1, potted: [[0, 2], [9, 3]], railBalls: 6 }), null);
    expect(summary.foul).toBe("scratch");
    expect(next.turn).toBe(1);
    expect(next.bih).toBe("kitchen");
    expect(next.balls[0]).toBeNull();
    expect(next.balls[9]).toBeNull(); // stays down
  });

  it("the 8 on the break wins (golden break)", () => {
    const g = start();
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 1, potted: [[8, 4]], railBalls: 6 }), null);
    expect(summary.win).toBe(0);
    expect(next.winner).toBe(0);
    expect(next.reason).toBe("golden_break");
  });

  it("the 8 and the cue ball on the break: the 8 comes back to the foot spot", () => {
    const g = start();
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 1, potted: [[8, 4], [0, 0]], railBalls: 6 }), null);
    expect(summary.win).toBeNull();
    expect(summary.foul).toBe("scratch");
    expect(summary.respotted).toBe(true);
    expect(next.balls[8]).not.toBeNull();
    expect(Math.abs(next.balls[8]!.y - FOOT_SPOT.y)).toBeLessThan(1e-9);
  });
});

describe("open table and groups", () => {
  it("the first ball legally potted decides the groups (a solid first hit may pot a stripe)", () => {
    const g = game({ balls: tableOf(ALL) });
    const { game: next, summary } = judge(g, 1, sim(g.balls, { firstHit: 2, potted: [[11, 5]], rail: true }), null);
    expect(summary.foul).toBeNull();
    expect(summary.assigned).toBe(0); // seat 1 has stripes → seat 0 solids
    expect(next.solids).toBe(0);
    expect(summary.cont).toBe(true);
    expect(next.turn).toBe(1);
  });

  it("when two groups drop at once, the first one down counts", () => {
    const g = game({ balls: tableOf(ALL) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 2, potted: [[4, 1], [12, 3]], rail: true }), null);
    expect(next.solids).toBe(0);
  });

  it("hitting the 8 first on an open table is a foul", () => {
    const g = game({ balls: tableOf(ALL) });
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 8, rail: true }), null);
    expect(summary.foul).toBe("wrong_ball");
    expect(next.turn).toBe(1);
    expect(next.bih).toBe("anywhere");
  });

  it("legal targets follow the group, then the 8", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([2, 8, 9, 10]) });
    expect(legalTargets(g, 0)).toEqual([2]);
    expect(legalTargets(g, 1)).toEqual([9, 10]);
    const cleared = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9, 10]) });
    expect(onEight(cleared, 0)).toBe(true);
    expect(needsCall(cleared, 0)).toBe(true);
    expect(legalTargets(cleared, 0)).toEqual([8]);
    expect(legalTargets(game({ balls: tableOf([3, 8, 12]) }), 1)).toEqual([3, 12]);
  });
});

describe("fouls", () => {
  const g = () => game({ ...SOLIDS_SEAT0, balls: tableOf(ALL) });

  it("wrong ball first", () => {
    const { game: next, summary } = judge(g(), 0, sim(g().balls, { firstHit: 10, potted: [[3, 0]], rail: true }), null);
    expect(summary.foul).toBe("wrong_ball");
    expect(summary.own).toBe(0);
    expect(next.turn).toBe(1);
    expect(next.bih).toBe("anywhere");
    expect(next.potted[0]).toBe(0);
  });

  it("no ball hit", () => {
    const { summary } = judge(g(), 0, sim(g().balls, { firstHit: null, rail: true }), null);
    expect(summary.foul).toBe("no_hit");
  });

  it("no cushion after contact and nothing potted", () => {
    const { summary } = judge(g(), 0, sim(g().balls, { firstHit: 3, rail: false }), null);
    expect(summary.foul).toBe("no_rail");
  });

  it("scratch: the cue ball comes off, the opponent places it anywhere", () => {
    const { game: next, summary } = judge(g(), 0, sim(g().balls, { firstHit: 3, potted: [[3, 0], [0, 2]], rail: true }), null);
    expect(summary.foul).toBe("scratch");
    expect(summary.cont).toBe(false);
    expect(next.balls[0]).toBeNull();
    expect(next.bih).toBe("anywhere");
    expect(next.turn).toBe(1);
  });

  it("a legal miss passes the turn without ball in hand", () => {
    const { game: next, summary } = judge(g(), 0, sim(g().balls, { firstHit: 3, rail: true }), null);
    expect(summary.foul).toBeNull();
    expect(next.turn).toBe(1);
    expect(next.bih).toBeNull();
  });

  it("potting only the opponent's ball ends the visit", () => {
    const { game: next, summary } = judge(g(), 0, sim(g().balls, { firstHit: 3, potted: [[12, 3]], rail: true }), null);
    expect(summary.foul).toBeNull();
    expect(summary.cont).toBe(false);
    expect(next.turn).toBe(1);
  });

  it("running out the shot clock", () => {
    const next = timeoutFoul(g(), 0, { by: "a", at: 1 })!;
    expect(next.turn).toBe(1);
    expect(next.bih).toBe("anywhere");
    expect(next.last?.out.foul).toBe("timeout");
    expect(timeoutFoul(g(), 1, { by: "b", at: 1 })).toBeNull();
  });
});

describe("the 8 ball", () => {
  it("potted early loses", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf(ALL) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 3, potted: [[8, 2]], rail: true }), 2);
    expect(next.winner).toBe(1);
    expect(next.reason).toBe("early_eight");
  });

  it("potting your last ball and the 8 on the same shot still loses", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([5, 8, 9]) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 5, potted: [[5, 1], [8, 2]], rail: true }), 2);
    expect(next.reason).toBe("early_eight");
    expect(next.winner).toBe(1);
  });

  it("in the called pocket wins", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9, 10]), run: 3, best: [3, 1] });
    const { game: next, summary } = judge(g, 0, sim(g.balls, { firstHit: 8, potted: [[8, 3]], rail: true }), 3);
    expect(summary.win).toBe(0);
    expect(next.winner).toBe(0);
    expect(next.reason).toBe("eight");
    expect(next.best[0]).toBe(4);
  });

  it("in another pocket loses", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9]) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 8, potted: [[8, 5]], rail: true }), 3);
    expect(next.winner).toBe(1);
    expect(next.reason).toBe("wrong_pocket");
  });

  it("with a scratch loses", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9]) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 8, potted: [[8, 3], [0, 0]], rail: true }), 3);
    expect(next.winner).toBe(1);
    expect(next.reason).toBe("scratch_eight");
  });

  it("after hitting the wrong ball first loses", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9]) });
    const { game: next } = judge(g, 0, sim(g.balls, { firstHit: 9, potted: [[8, 3]], rail: true }), 3);
    expect(next.winner).toBe(1);
    expect(next.reason).toBe("foul_eight");
  });

  it("a shot on the 8 must call a pocket", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([8, 9]) });
    const input = { angle: 0, power: 0.3, spin: { x: 0, y: 0 }, cue: null, call: null };
    expect(playShot(g, 0, input, { by: "a", at: 0 })).toEqual({ ok: false, reason: "call-pocket" });
    const ok = playShot(g, 0, { ...input, call: 2 }, { by: "a", at: 0 });
    expect(ok.ok).toBe(true);
  });
});

describe("runs and records", () => {
  it("count balls per visit and keep the best", () => {
    let g = game({ ...SOLIDS_SEAT0, balls: tableOf(ALL) });
    for (const id of [1, 2, 3]) {
      g = judge(g, 0, sim(g.balls, { firstHit: id, potted: [[id, 0]], rail: true }), null).game;
    }
    expect(g.run).toBe(3);
    expect(g.best[0]).toBe(3);
    expect(g.potted[0]).toBe(3);
    g = judge(g, 0, sim(g.balls, { firstHit: 4, rail: true }), null).game;
    expect(g.run).toBe(0);
    expect(g.best[0]).toBe(3);
    expect(g.turn).toBe(1);
  });
});

describe("ball in hand", () => {
  it("in the kitchen after a break scratch, anywhere free otherwise", () => {
    const g = game({ balls: tableOf([1, 2]), bih: "kitchen" });
    expect(checkCueSpot(g, { x: HEAD_X - 0.05, y: 0.5 })).toBe("ok");
    expect(checkCueSpot(g, { x: HEAD_X + 0.05, y: 0.5 })).toBe("kitchen");
    const any = { ...g, bih: "anywhere" as const };
    expect(checkCueSpot(any, { x: HEAD_X + 0.05, y: 0.5 })).toBe("ok");
    expect(checkCueSpot(any, { x: 1.0 + R, y: 0.2 })).toBe("overlap");
    expect(checkCueSpot(any, { x: 1.5, y: TABLE_W })).toBe("off-table");
  });

  it("a shot needs a legal cue spot", () => {
    const g = game({ ...SOLIDS_SEAT0, balls: tableOf([1, 9], null), bih: "anywhere" });
    const input = { angle: 0, power: 0.3, spin: { x: 0, y: 0 }, cue: { x: 1.0, y: 0.2 }, call: null };
    expect(playShot(g, 0, input, { by: "a", at: 0 })).toEqual({ ok: false, reason: "bad-cue" });
    expect(playShot(g, 0, { ...input, cue: { x: 0.5, y: 0.2 } }, { by: "a", at: 0 }).ok).toBe(true);
    expect(playShot(g, 1, { ...input, cue: { x: 0.5, y: 0.2 } }, { by: "a", at: 0 })).toEqual({ ok: false, reason: "wrong-turn" });
  });
});

describe("shared state", () => {
  it("round-trips through JSON, recording included", () => {
    const g = newGame(createRandom("state").next);
    const res = playShot(g, 0, { angle: 0, power: 1, spin: { x: 0, y: 0 }, cue: g.balls[0], call: null }, { by: "you", at: 123 });
    if (!res.ok) throw new Error(res.reason);
    const json = JSON.parse(JSON.stringify(toStateJson(res.game)));
    const back = readState(json);
    expect(back).not.toBe("bad");
    expect(back).not.toBeNull();
    const read = back as Game;
    expect(read.n).toBe(1);
    expect(read.last?.rec?.tracks.length).toBe(16);
    expect(read.last?.out).toEqual(res.summary);
    for (let i = 0; i < BALLS; i++) {
      const a = res.game.balls[i];
      const b = read.balls[i];
      if (!a) expect(b).toBeNull();
      else expect(Math.hypot(a.x - b!.x, a.y - b!.y)).toBeLessThan(0.0001);
    }
    expect(JSON.stringify(json).length).toBeLessThan(40_000);
  });

  it("rejects malformed states and treats an empty one as a fresh rack", () => {
    expect(readState(null)).toBeNull();
    expect(readState({ v: 2 })).toBe("bad");
    expect(readState({ ...toStateJson(game()), balls: [[1, 2]] })).toBe("bad");
    expect(readState({ ...toStateJson(game()), turn: 3 })).toBe("bad");
  });
});
