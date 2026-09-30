import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import { BALLS, HEAD_X, R, simulate, type Balls, type Vec } from "./physics";
import { chooseBotShot, pathClear, potCandidates } from "./bot";
import { checkCueSpot, judge, newGame, playShot, quantize, type Game, type Seat } from "./rules";

function tableOf(entries: [number, Vec][]): Balls {
  const balls: Balls = new Array(BALLS).fill(null);
  for (const [id, p] of entries) balls[id] = p;
  return balls;
}

function game(balls: Balls, over: Partial<Game> = {}): Game {
  return { ...newGame(createRandom("bot").next), balls, broken: true, bih: null, solids: 0, ...over };
}

/** Does the bot's error-free shot do what it planned? */
function idealOutcome(g: Game, seat: Seat, seed = "s") {
  const plan = chooseBotShot(g, seat, { level: "hard", random: createRandom(seed).next });
  const start = g.balls.slice();
  if (g.bih) start[0] = plan.ideal.cue;
  const sim = simulate(start, { angle: plan.ideal.angle, power: plan.ideal.power, spin: plan.ideal.spin }, { record: false });
  return { plan, sim, judged: judge({ ...g, balls: start }, seat, sim, plan.ideal.call) };
}

describe("geometry", () => {
  it("finds a straight-in pot and rejects blocked paths", () => {
    const balls = tableOf([
      [0, { x: 1.0, y: 0.56 }],
      [3, { x: 1.6, y: 0.56 }],
    ]);
    const cands = potCandidates(balls, balls[0]!, [3]);
    expect(cands.length).toBeGreaterThan(0);
    expect(pathClear(balls, balls[0]!, balls[3]!, [0, 3])).toBe(true);
    const blocked = tableOf([
      [0, { x: 1.0, y: 0.56 }],
      [3, { x: 1.6, y: 0.56 }],
      [12, { x: 1.3, y: 0.56 + R }],
    ]);
    expect(pathClear(blocked, blocked[0]!, blocked[3]!, [0, 3])).toBe(false);
  });
});

describe("bot shot selection", () => {
  it("takes the easy pot on its own ball, not the opponent's", () => {
    // Seat 0 has solids: the 2 hangs over the bottom-right corner; a stripe sits over the top-right.
    const balls = tableOf([
      [0, { x: 1.6, y: 0.4 }],
      [2, { x: 2.05, y: 0.2 }],
      [11, { x: 2.05, y: 0.92 }],
      [8, { x: 1.1, y: 0.8 }],
    ]);
    const { plan, sim, judged } = idealOutcome(game(balls), 0);
    expect(plan.kind).toBe("pot");
    expect(plan.target).toBe(2);
    expect(sim.firstHit).toBe(2);
    expect(sim.pocketed.map((p) => p.id)).toContain(2);
    expect(judged.summary.foul).toBeNull();
    expect(judged.summary.cont).toBe(true);
  });

  it("goes for the 8 when its group is cleared, calling the pocket it aims at", () => {
    const balls = tableOf([
      [0, { x: 1.4, y: 0.56 }],
      [8, { x: 1.9, y: 0.35 }],
      [10, { x: 0.6, y: 0.9 }],
    ]);
    const { plan, sim, judged } = idealOutcome(game(balls), 0);
    expect(plan.target).toBe(8);
    expect(plan.ideal.call).toBe(plan.pocket);
    expect(sim.pocketed.find((p) => p.id === 8)?.pocket).toBe(plan.pocket);
    expect(judged.game.winner).toBe(0);
  });

  it("never plans to pot the 8 early", () => {
    const balls = tableOf([
      [0, { x: 1.4, y: 0.56 }],
      [8, { x: 1.9, y: 0.35 }],
      [5, { x: 0.5, y: 0.2 }],
      [10, { x: 0.6, y: 0.9 }],
    ]);
    const { judged } = idealOutcome(game(balls), 0);
    expect(judged.game.winner).not.toBe(1);
  });

  it("places the cue ball legally with ball in hand (kitchen after a break scratch)", () => {
    const rack = newGame(createRandom("bih").next).balls;
    rack[0] = null;
    const g = game(rack, { bih: "kitchen", solids: null, broken: true });
    const plan = chooseBotShot(g, 1, { level: "medium", random: createRandom("x").next });
    expect(plan.input.cue).not.toBeNull();
    expect(plan.input.cue!.x).toBeLessThanOrEqual(HEAD_X);
    expect(checkCueSpot(g, plan.input.cue!)).toBe("ok");
  });

  it("uses ball in hand anywhere to set up a pot", () => {
    const balls = tableOf([
      [3, { x: 1.9, y: 0.3 }],
      [12, { x: 1.2, y: 0.6 }],
      [8, { x: 0.7, y: 0.8 }],
    ]);
    const g = game(balls, { bih: "anywhere" });
    const { plan, judged } = idealOutcome(g, 0);
    expect(plan.kind).toBe("pot");
    expect(checkCueSpot(g, plan.ideal.cue!)).toBe("ok");
    expect(judged.summary.potted).toContain(3);
  });

  it("plays a legal safety when nothing is makeable", () => {
    // Its only ball is frozen behind a wall of stripes: no pot, but a legal hit exists.
    const balls = tableOf([
      [0, { x: 0.4, y: 0.56 }],
      [4, { x: 2.2, y: 0.56 }],
      [9, { x: 2.1, y: 0.49 }],
      [10, { x: 2.1, y: 0.63 }],
      [11, { x: 2.15, y: 0.42 }],
      [13, { x: 2.15, y: 0.7 }],
      [8, { x: 1.2, y: 1.0 }],
    ]);
    const { plan, judged } = idealOutcome(game(balls), 0);
    expect(plan.kind).toBe("safety");
    expect(judged.summary.foul).toBeNull();
  });

  it("breaks hard at the rack", () => {
    const g = newGame(createRandom("brk").next);
    const plan = chooseBotShot(g, 0, { level: "medium", random: createRandom("b").next });
    expect(plan.kind).toBe("break");
    expect(plan.input.power).toBeGreaterThan(0.85);
    const res = playShot(g, 0, plan.input, { by: "bot", at: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.sim.firstHit).not.toBeNull();
  });

  it("a harder bot pots more often than an easy one", () => {
    const rate = (level: "easy" | "hard") => {
      let made = 0;
      for (let k = 0; k < 12; k++) {
        const random = createRandom(`${level}-${k}`).next;
        const balls = tableOf([
          [0, { x: 0.5 + random() * 0.6, y: 0.2 + random() * 0.7 }],
          [5, { x: 1.3 + random() * 0.6, y: 0.2 + random() * 0.7 }],
        ]);
        const g = game(balls, { solids: 0 });
        const plan = chooseBotShot(g, 0, { level, random });
        const sim = simulate(balls, { angle: plan.input.angle, power: plan.input.power, spin: plan.input.spin }, { record: false });
        if (sim.pocketed.some((p) => p.id === 5)) made++;
      }
      return made;
    };
    expect(rate("hard")).toBeGreaterThanOrEqual(rate("easy"));
    expect(rate("hard")).toBeGreaterThanOrEqual(8);
  });
});

describe("bot vs bot", () => {
  it("plays a whole game to a result", () => {
    let g = newGame(createRandom("match").next);
    const random = createRandom("moves").next;
    let shots = 0;
    while (g.winner === null && shots < 160) {
      const seat = g.turn;
      const plan = chooseBotShot(g, seat, { level: "medium", random });
      const res = playShot(g, seat, plan.input, { by: `bot${seat}`, at: shots });
      if (!res.ok) throw new Error(`shot ${shots}: ${res.reason}`);
      g = { ...res.game, balls: quantize(res.game.balls) };
      shots++;
    }
    expect(g.winner).not.toBeNull();
    expect(shots).toBeLessThan(160);
  }, 60_000);
});
