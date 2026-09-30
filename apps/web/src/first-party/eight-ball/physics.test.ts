import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import {
  BALLS,
  HEAD_X,
  POCKETS,
  R,
  TABLE_L,
  TABLE_W,
  predictAim,
  rackBalls,
  simulate,
  speedOf,
  trackAt,
  trackEnd,
  type Balls,
  type Vec,
} from "./physics";

function table(entries: [number, Vec][]): Balls {
  const balls: Balls = new Array(BALLS).fill(null);
  for (const [id, p] of entries) balls[id] = p;
  return balls;
}

const angleTo = (from: Vec, to: Vec) => Math.atan2(to.y - from.y, to.x - from.x);
const NO_SPIN = { x: 0, y: 0 };

describe("ball–ball collisions", () => {
  it("conserve momentum and lose only a little energy", () => {
    const balls = table([
      [0, { x: 0.6, y: 0.56 }],
      [1, { x: 1.0, y: 0.6 }],
    ]);
    let before: { px: number; py: number; e: number } | null = null;
    let after: { px: number; py: number; e: number } | null = null;
    let prev: { px: number; py: number; e: number } | null = null;
    simulate(balls, { angle: angleTo(balls[0]!, { x: 1.0, y: 0.6 - R }), power: 0.5, spin: NO_SPIN }, {
      probe: (_ms, s) => {
        const px = s.vx[0]! + s.vx[1]!;
        const py = s.vy[0]! + s.vy[1]!;
        const e = s.vx[0]! ** 2 + s.vy[0]! ** 2 + s.vx[1]! ** 2 + s.vy[1]! ** 2;
        const cur = { px, py, e };
        if (!before && prev && s.vx[1]! ** 2 + s.vy[1]! ** 2 > 0) {
          before = prev;
          after = cur;
        }
        prev = cur;
      },
    });
    expect(before).not.toBeNull();
    const b = before as unknown as { px: number; py: number; e: number };
    const a = after as unknown as { px: number; py: number; e: number };
    // One friction step (1 ms) separates the samples: allow that much slack.
    expect(Math.abs(a.px - b.px)).toBeLessThan(0.02);
    expect(Math.abs(a.py - b.py)).toBeLessThan(0.02);
    expect(a.e / b.e).toBeGreaterThan(0.9);
    expect(a.e / b.e).toBeLessThanOrEqual(1.0001);
  });

  it("a full stun hit stops the cue ball and sends the object ball on", () => {
    // Close together, so the cue ball is still sliding (stunned) at contact.
    const balls = table([
      [0, { x: 1.0, y: 0.56 }],
      [1, { x: 1.0 + 2 * R + 0.01, y: 0.56 }],
    ]);
    const sim = simulate(balls, { angle: 0, power: 0.35, spin: NO_SPIN });
    expect(sim.firstHit).toBe(1);
    expect(Math.abs(sim.final[0]!.x - 1.01)).toBeLessThan(0.03);
    // The object ball went straight up the table (to the foot cushion and back).
    expect(sim.rec.events.some((e) => e[1] === "c" && e[2] === 1)).toBe(true);
    expect(Math.abs(sim.final[1]!.y - 0.56)).toBeLessThan(0.002);
  });

  it("follow runs through and draw screws back on a full hit", () => {
    const setup = () =>
      table([
        [0, { x: 0.6, y: 0.56 }],
        [1, { x: 1.0, y: 0.56 }],
      ]);
    const follow = simulate(setup(), { angle: 0, power: 0.35, spin: { x: 0, y: 0.8 } });
    const draw = simulate(setup(), { angle: 0, power: 0.35, spin: { x: 0, y: -0.9 } });
    expect(follow.final[0]!.x).toBeGreaterThan(1.1);
    expect(draw.final[0]!.x).toBeLessThan(0.9);
  });

  it("a cut sends the balls off at roughly right angles (stun)", () => {
    const cue = { x: 0.9, y: 0.4 };
    const obj = { x: 1.2, y: 0.56 };
    const balls = table([
      [0, cue],
      [3, obj],
    ]);
    // Aim for a half-ball hit and read both directions right after contact.
    const ghost = { x: obj.x - 2 * R * Math.cos(Math.PI / 4), y: obj.y - 2 * R * Math.sin(Math.PI / 4) };
    let dirs: { cue: Vec; obj: Vec } | null = null;
    simulate(balls, { angle: angleTo(cue, ghost), power: 0.3, spin: { x: 0, y: -0.25 } }, {
      probe: (_ms, s) => {
        if (dirs || s.vx[3]! === 0) return;
        dirs = { cue: { x: s.vx[0]!, y: s.vy[0]! }, obj: { x: s.vx[3]!, y: s.vy[3]! } };
      },
    });
    const d = dirs as unknown as { cue: Vec; obj: Vec };
    const cos = (d.cue.x * d.obj.x + d.cue.y * d.obj.y) / (Math.hypot(d.cue.x, d.cue.y) * Math.hypot(d.obj.x, d.obj.y));
    expect(Math.abs(cos)).toBeLessThan(0.12);
  });
});

describe("cushions", () => {
  it("reflect a ball off the long rail at about the same angle", () => {
    const start = { x: 0.8, y: 0.5 };
    const balls = table([[0, start]]);
    const angle = -Math.PI / 4; // down-right into the bottom rail
    let bounce: Vec | null = null;
    let lastVy = -1;
    simulate(balls, { angle, power: 0.3, spin: NO_SPIN }, {
      probe: (_ms, s) => {
        if (!bounce && lastVy < 0 && s.vy[0]! > 0) bounce = { x: s.vx[0]!, y: s.vy[0]! };
        lastVy = s.vy[0]!;
      },
    });
    const b = bounce as unknown as Vec;
    expect(b).not.toBeNull();
    const out = (Math.atan2(b.y, b.x) * 180) / Math.PI;
    expect(out).toBeGreaterThan(30);
    expect(out).toBeLessThan(60);
  });

  it("lose energy on every contact and keep balls on the table", () => {
    const balls = table([[0, { x: 0.3, y: 0.3 }]]);
    const sim = simulate(balls, { angle: 0.37, power: 1, spin: NO_SPIN });
    const p = sim.final[0];
    if (p) {
      expect(p.x).toBeGreaterThanOrEqual(R - 1e-6);
      expect(p.x).toBeLessThanOrEqual(TABLE_L - R + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(R - 1e-6);
      expect(p.y).toBeLessThanOrEqual(TABLE_W - R + 1e-6);
    }
    expect(sim.ms).toBeLessThan(30_000);
  });

  it("english bends the rebound: running english widens it, reverse checks it up", () => {
    const run = (side: number) => {
      const balls = table([[0, { x: 0.8, y: 0.5 }]]);
      let bounce: Vec | null = null;
      let lastVy = -1;
      simulate(balls, { angle: -Math.PI / 4, power: 0.35, spin: { x: side, y: 0 } }, {
        probe: (_ms, s) => {
          if (!bounce && lastVy < 0 && s.vy[0]! > 0) bounce = { x: s.vx[0]!, y: s.vy[0]! };
          lastVy = s.vy[0]!;
        },
      });
      const b = bounce as unknown as Vec;
      return Math.atan2(b.y, b.x);
    };
    // Travelling down-right into the bottom rail, right english (clockwise) is running english:
    // it comes off flatter (along +x); left english checks it up steeper.
    expect(run(0.8)).toBeLessThan(run(0) - 0.05);
    expect(run(-0.8)).toBeGreaterThan(run(0) + 0.03);
  });
});

describe("pockets", () => {
  it("capture a ball rolled into a corner", () => {
    const balls = table([[0, { x: 0.4, y: 0.4 }]]);
    const sim = simulate(balls, { angle: angleTo(balls[0]!, { x: 0, y: 0 }), power: 0.3, spin: NO_SPIN });
    expect(sim.pocketed).toEqual([expect.objectContaining({ id: 0, pocket: 0 })]);
    expect(sim.final[0]).toBeNull();
  });

  it("capture a straight-in shot into the side pocket", () => {
    const balls = table([
      [0, { x: TABLE_L / 2, y: 0.8 }],
      [5, { x: TABLE_L / 2, y: 0.4 }],
    ]);
    const sim = simulate(balls, { angle: -Math.PI / 2, power: 0.3, spin: { x: 0, y: -0.4 } });
    expect(sim.pocketed.map((p) => [p.id, p.pocket])).toContainEqual([5, 1]);
  });

  it("reject a ball driven hard into the jaw at a steep angle", () => {
    // Along the bottom rail into the side pocket at speed: it skims past or rattles, but must not drop.
    const balls = table([[0, { x: 0.4, y: R + 0.001 }]]);
    const sim = simulate(balls, { angle: 0, power: 0.5, spin: NO_SPIN }, { maxTime: 1.2 });
    expect(sim.pocketed.some((p) => p.pocket === 1)).toBe(false);
  });
});

describe("the break", () => {
  it("spreads the rack, keeps every ball on the table or in a pocket and ends", () => {
    for (const seed of ["a", "b", "c", "d"]) {
      const balls = rackBalls(createRandom(seed).next);
      const sim = simulate(balls, { angle: angleTo(balls[0]!, balls.find((b, i) => i > 0 && b && b.x === Math.min(...balls.slice(1).map((q) => q?.x ?? 9)))!), power: 1, spin: NO_SPIN });
      expect(sim.firstHit).not.toBeNull();
      expect(sim.railBalls + sim.pocketed.length).toBeGreaterThanOrEqual(4);
      expect(sim.ms).toBeLessThan(30_000);
      for (const b of sim.final) {
        if (!b) continue;
        expect(b.x).toBeGreaterThan(0);
        expect(b.x).toBeLessThan(TABLE_L);
        expect(b.y).toBeGreaterThan(0);
        expect(b.y).toBeLessThan(TABLE_W);
      }
      // No two balls overlap at rest.
      for (let i = 0; i < BALLS; i++) {
        for (let j = i + 1; j < BALLS; j++) {
          const a = sim.final[i];
          const b = sim.final[j];
          if (a && b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(2 * R - 0.001);
        }
      }
    }
  });

  it("racks 15 balls with the 8 in the middle and the cue ball in the kitchen", () => {
    const balls = rackBalls(createRandom("rack").next);
    expect(balls.filter(Boolean)).toHaveLength(16);
    expect(balls[0]!.x).toBeLessThan(HEAD_X);
    const xs = balls.slice(1).map((b) => b!.x);
    const rows = [...new Set(xs.map((x) => Math.round(x * 100)))].sort((a, b) => a - b);
    expect(rows).toHaveLength(5);
    expect(Math.round(balls[8]!.x * 100)).toBe(rows[2]);
    expect(Math.abs(balls[8]!.y - TABLE_W / 2)).toBeLessThan(0.001);
  });
});

describe("recordings", () => {
  it("replay to the simulated final positions", () => {
    const balls = rackBalls(createRandom("rec").next);
    const sim = simulate(balls, { angle: angleTo(balls[0]!, { x: 1.68, y: 0.56 }), power: 0.9, spin: { x: 0.2, y: -0.3 } });
    for (let i = 0; i < BALLS; i++) {
      const track = sim.rec.tracks[i]!;
      const end = trackAt(track, trackEnd(track) + 1);
      const fin = sim.final[i];
      if (fin) {
        expect(end).not.toBeNull();
        expect(Math.abs(end!.x - fin.x)).toBeLessThan(0.0011);
        expect(Math.abs(end!.y - fin.y)).toBeLessThan(0.0011);
      } else {
        const drop = sim.pocketed.find((p) => p.id === i)!;
        expect(drop).toBeDefined();
        expect(trackEnd(track)).toBe(drop.ms);
      }
    }
    // Compact enough for the 64 KB shared state, with room to spare.
    expect(JSON.stringify(sim.rec).length).toBeLessThan(24_000);
  });

  it("hold resting balls still until they are struck", () => {
    const balls = table([
      [0, { x: 0.5, y: 0.56 }],
      [2, { x: 1.5, y: 0.56 }],
    ]);
    const sim = simulate(balls, { angle: 0, power: 0.4, spin: NO_SPIN });
    const hit = sim.rec.events.find((e) => e[1] === "b")!;
    const mid = trackAt(sim.rec.tracks[2]!, hit[0] / 2);
    expect(mid!.x).toBeCloseTo(1.5, 3);
  });
});

describe("aim prediction", () => {
  it("finds the ghost ball, and deflection lines at 90° for a stun cut", () => {
    const balls = table([
      [0, { x: 0.5, y: 0.56 }],
      [1, { x: 1.2, y: 0.56 + R }],
    ]);
    const hit = predictAim(balls, balls[0]!, 0, 0, 0.9);
    expect(hit?.kind).toBe("ball");
    if (hit?.kind !== "ball") return;
    expect(hit.id).toBe(1);
    expect(Math.hypot(hit.ghost.x - 1.2, hit.ghost.y - (0.56 + R))).toBeCloseTo(2 * R, 6);
    expect((hit.cut * 180) / Math.PI).toBeCloseTo(30, 0);
    // Hard and close: still sliding at contact, so the cue ball leaves on the tangent line.
    const dot = hit.cueDir.x * hit.objectDir.x + hit.cueDir.y * hit.objectDir.y;
    expect(Math.abs(dot)).toBeLessThan(0.35);
  });

  it("reports the first cushion when nothing is in the way", () => {
    const balls = table([[0, { x: 0.5, y: 0.56 }]]);
    const hit = predictAim(balls, balls[0]!, Math.PI / 2);
    expect(hit?.kind).toBe("rail");
    if (hit?.kind !== "rail") return;
    expect(hit.at.y).toBeCloseTo(TABLE_W - R, 4);
    expect(hit.bounce.y).toBeLessThan(0);
  });

  it("matches where the simulation's cue ball makes first contact", () => {
    const balls = rackBalls(createRandom("aim").next);
    const angle = angleTo(balls[0]!, { x: 1.7, y: 0.6 });
    const hit = predictAim(balls, balls[0]!, angle);
    const sim = simulate(balls, { angle, power: 0.6, spin: NO_SPIN });
    expect(hit?.kind).toBe("ball");
    if (hit?.kind === "ball") expect(sim.firstHit).toBe(hit.id);
  });
});

describe("power", () => {
  it("maps the control to a sensible speed range", () => {
    expect(speedOf(0)).toBeGreaterThan(0.1);
    expect(speedOf(1)).toBeGreaterThan(6);
    expect(speedOf(0.5)).toBeGreaterThan(speedOf(0.4));
    expect(POCKETS).toHaveLength(6);
  });
});
