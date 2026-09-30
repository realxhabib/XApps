import { describe, expect, it } from "vitest";
import { BALL_R, compileHole } from "./compile";
import { HOLES, type Hole } from "./course";
import { CAPTURE_SPEED, CUP_R, HZ, MAX_SPEED, Sim, WALL_E, gateClosed, simulateShot, type SimEvent } from "./physics";

/** A flat 10 × 20 box with the cup far away (tests add features on top). */
function box(extra: Partial<Hole> = {}): Hole {
  return {
    number: 99,
    name: "Test",
    par: 3,
    blurb: "",
    floor: [[0, 0, 10, 20]],
    tee: { x: 5, y: 2 },
    cup: { x: 9, y: 19 },
    flyover: [{ x: 5, y: 2 }],
    accent: "#fff",
    ...extra,
  };
}

function runUntil(sim: Sim, done: (s: Sim) => boolean, maxTicks = 20 * HZ): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxTicks && !done(sim); i++) {
    sim.step();
    events.push(...sim.events);
    sim.events = [];
  }
  return events;
}

describe("walls", () => {
  it("reflect the ball with restitution and keep it on the floor", () => {
    const c = compileHole(box());
    const sim = new Sim(c, 8, 10);
    sim.shoot(0, 0.5); // straight at the right wall
    const before = sim.vx;
    let vxBefore = before;
    const events = runUntil(sim, (s) => {
      if (s.vx > 0) vxBefore = s.vx;
      return s.vx < 0;
    });
    expect(events.some((e) => e.type === "wall")).toBe(true);
    expect(sim.vx).toBeLessThan(0);
    // Bounces back at roughly WALL_E of the incoming speed.
    expect(-sim.vx / vxBefore).toBeGreaterThan(WALL_E - 0.1);
    expect(-sim.vx / vxBefore).toBeLessThan(WALL_E + 0.05);
    runUntil(sim, (s) => s.status !== "rolling");
    expect(sim.x).toBeGreaterThan(BALL_R - 0.01);
    expect(sim.x).toBeLessThan(10 - BALL_R + 0.01);
  });

  it("never lets a full-power ball through a rail", () => {
    const c = compileHole(box());
    for (let a = 0; a < 24; a++) {
      const r = simulateShot(c, { x: 5, y: 10 }, (a / 24) * Math.PI * 2, 1);
      expect(c.isFloor(r.x, r.y)).toBe(true);
      expect(r.x).toBeGreaterThan(0);
      expect(r.x).toBeLessThan(10);
      expect(r.y).toBeGreaterThan(0);
      expect(r.y).toBeLessThan(20);
    }
  });

  it("bumpers kick the ball back harder than rails", () => {
    const c = compileHole(box({ bumpers: [{ x: 5, y: 12, r: 0.3 }] }));
    const sim = new Sim(c, 5, 8);
    sim.shoot(Math.PI / 2, 0.3);
    let incoming = 0;
    runUntil(sim, (s) => {
      if (s.vy > 0) incoming = s.vy;
      return s.vy < 0;
    });
    expect(-sim.vy).toBeGreaterThan(incoming * WALL_E);
  });
});

describe("slopes", () => {
  it("accelerate the ball downhill", () => {
    // Falls away toward +y: 1.6 over 10 units is steeper than the turf can hold.
    const c = compileHole(box({ heights: [{ kind: "tier", axis: "y", from: 5, to: 15, a: -1.6 }] }));
    const sim = new Sim(c, 5, 10);
    sim.shoot(0, 0.05); // a nudge sideways
    runUntil(sim, () => false, HZ);
    expect(sim.vy).toBeGreaterThan(0.3);
  });

  it("carry a putt further downhill than uphill", () => {
    const c = compileHole(box({ heights: [{ kind: "tier", axis: "y", from: 0, to: 20, a: -0.9 }] }));
    const down = simulateShot(c, { x: 5, y: 8 }, Math.PI / 2, 0.25);
    const upHill = simulateShot(c, { x: 5, y: 12 }, -Math.PI / 2, 0.25);
    expect(down.y - 8).toBeGreaterThan(12 - upHill.y + 0.5);
  });

  it("leaves a ball at rest on gentle ground", () => {
    const c = compileHole(box({ heights: [{ kind: "hill", x: 5, y: 10, a: 0.05, s: 3 }] }));
    const sim = new Sim(c, 6, 11);
    runUntil(sim, () => false, HZ);
    expect(sim.status).toBe("rest");
    expect(sim.x).toBe(6);
  });
});

describe("sand", () => {
  it("stops the ball much sooner than turf", () => {
    const turf = compileHole(box());
    const sand = compileHole(box({ surfaces: [{ type: "sand", shape: { kind: "rect", x0: 0, y0: 4, x1: 10, y1: 20 } }] }));
    const a = simulateShot(turf, { x: 5, y: 3 }, Math.PI / 2, 0.35);
    const b = simulateShot(sand, { x: 5, y: 3 }, Math.PI / 2, 0.35);
    expect(a.y - 3).toBeGreaterThan(2 * (b.y - 3));
  });
});

describe("the cup", () => {
  const c = compileHole(box({ cup: { x: 5, y: 10 } }));

  it(`captures a ball rolling over it slower than ${CAPTURE_SPEED} u/s`, () => {
    const sim = new Sim(c, 4, 10);
    sim.shoot(0, 0.1);
    sim.vx = CAPTURE_SPEED * 0.8;
    const events = runUntil(sim, (s) => s.status !== "rolling");
    expect(sim.status).toBe("holed");
    expect(events.some((e) => e.type === "cup")).toBe(true);
  });

  it("lets a hot putt lip out and roll on", () => {
    const sim = new Sim(c, 3.5, 10);
    sim.shoot(0, 0.1);
    sim.vx = CAPTURE_SPEED * 2.2;
    const events = runUntil(sim, (s) => s.status !== "rolling");
    expect(sim.status).toBe("rest");
    expect(events.some((e) => e.type === "lip")).toBe(true);
    expect(sim.x).toBeGreaterThan(5 + CUP_R);
  });

  it("drops a slow ball that just catches the edge", () => {
    const sim = new Sim(c, 4.55, 10 + CUP_R * 0.85);
    sim.shoot(0, 0.1);
    sim.vx = 1;
    runUntil(sim, (s) => s.status !== "rolling");
    expect(sim.status).toBe("holed");
  });
});

describe("hazards and gadgets", () => {
  it("water ends the shot where the ball went in", () => {
    const c = compileHole(box({ surfaces: [{ type: "water", shape: { kind: "circle", x: 5, y: 10, r: 1.5 } }] }));
    const r = simulateShot(c, { x: 5, y: 3 }, Math.PI / 2, 0.6);
    expect(r.status).toBe("water");
    expect(r.splash).not.toBeNull();
    expect(Math.hypot(r.x - 5, r.y - 10)).toBeLessThan(1.6);
  });

  it("a tube carries the ball to its exit", () => {
    const hole = HOLES.find((h) => h.name === "Tube Station")!;
    const c = compileHole(hole);
    const t = hole.tubes![0]!;
    const sim = new Sim(c, t.from.x, t.from.y - 0.4);
    sim.shoot(Math.PI / 2, 0.2);
    const events = runUntil(sim, (s) => s.status === "rest" || s.status === "holed");
    expect(events.some((e) => e.type === "tube-in")).toBe(true);
    expect(events.some((e) => e.type === "tube-out")).toBe(true);
    expect(sim.y).toBeGreaterThan(9); // the upper green, a separate island
  });

  it("the ramp launches a fast ball into the air", () => {
    const hole = HOLES.find((h) => h.name === "Big Air")!;
    const c = compileHole(hole);
    const r = simulateShot(c, { x: 2, y: 3 }, Math.PI / 2, 0.8);
    expect(r.stats.airTicks).toBeGreaterThan(HZ * 0.2);
    expect(r.status).not.toBe("water");
    expect(r.y).toBeGreaterThan(10.5);
  });

  it("the windmill's sails turn back a ball at the mouth when they're down", () => {
    const hole = HOLES.find((h) => h.name === "The Windmill")!;
    const w = hole.windmill!;
    const c = compileHole(hole);
    // Find a tick when a sail hangs across the mouth for a while.
    let tick = 0;
    while (!(gateClosed(w, tick / HZ) && gateClosed(w, (tick + 0.15 * HZ) / HZ))) tick++;
    const sim = new Sim(c, w.x, w.y0 - 0.35, tick);
    sim.shoot(Math.PI / 2, 0.12);
    runUntil(sim, (s) => s.vy < 0 || s.y > w.y0 + 0.5, 0.3 * HZ);
    expect(sim.vy).toBeLessThan(0);
    expect(sim.y).toBeLessThan(w.y0);
  });
});

describe("determinism", () => {
  it("replays a shot identically, moving obstacles included", () => {
    for (const hole of HOLES) {
      const c = compileHole(hole);
      const a = simulateShot(c, hole.tee, 1.4, 0.83, 1234);
      const b = simulateShot(compileHole(hole), hole.tee, 1.4, 0.83, 1234);
      expect(b).toEqual(a);
    }
  });

  it("caps launch speed at full power", () => {
    const c = compileHole(box());
    const sim = new Sim(c, 5, 5);
    sim.shoot(Math.PI / 2, 3);
    expect(sim.speed).toBeCloseTo(MAX_SPEED, 5);
  });
});
