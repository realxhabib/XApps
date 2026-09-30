import { describe, expect, it } from "vitest";
import { CUP_H, TABLE_L, formationSlots, openingRack, type Cup } from "./geometry";
import {
  EV_RIM,
  EV_SINK,
  EV_TABLE,
  HAND,
  MAX_POWER,
  decodeEvents,
  decodePath,
  encodeEvents,
  encodePath,
  flickPower,
  flickSpeedFor,
  idealThrow,
  launchVelocity,
  normalizeThrow,
  previewArc,
  samplePath,
  simulateThrow,
  throwFromFlick,
} from "./physics";

const rack = openingRack();
const lone = (slot: { u: number; v: number }, id = 0): Cup[] => [{ id, ...slot }];
const outcome = (r: ReturnType<typeof simulateThrow>) => `${r.cup ?? "-"}${r.bounce ? "b" : ""}${r.rim ? "r" : ""}`;

describe("throw → trajectory", () => {
  it("is deterministic for the same input", () => {
    for (const input of [
      { aim: 0, power: 0.7 },
      { aim: -0.13, power: 0.66 },
      { aim: 0.31, power: 0.205 },
      { aim: 0.9, power: 1.1 },
    ]) {
      const a = simulateThrow(input, rack);
      const b = simulateThrow({ ...input }, rack.map((c) => ({ ...c })));
      expect(b).toEqual(a);
      expect(encodePath(b.path)).toEqual(encodePath(a.path));
    }
  });

  it("quantises inputs, so tiny float noise can't change the result", () => {
    const a = simulateThrow({ aim: 0.12341, power: 0.678901 }, rack);
    const b = simulateThrow({ aim: 0.123409999, power: 0.67890099 }, rack);
    expect(a.input).toEqual({ aim: 0.1234, power: 0.6789 });
    expect(b).toEqual(a);
  });

  it("clamps wild inputs", () => {
    expect(normalizeThrow({ aim: 7, power: -3 })).toEqual({ aim: 1, power: 0 });
    expect(normalizeThrow({ aim: Number.NaN, power: 99 })).toEqual({ aim: 0, power: MAX_POWER });
  });

  it("launches from the hand, up and down the table", () => {
    const v = launchVelocity({ aim: 0, power: 0.5 });
    expect(v.x).toBe(0);
    expect(v.y).toBeGreaterThan(2);
    expect(v.z).toBeGreaterThan(2);
    expect(launchVelocity({ aim: 0.5, power: 0.5 }).x).toBeGreaterThan(0);
    expect(launchVelocity({ aim: 0, power: 0.9 }).z).toBeGreaterThan(v.z);
  });

  it("the ideal throw sinks every cup of a full rack, clean", () => {
    for (const cup of rack) {
      const r = simulateThrow(idealThrow(cup), rack);
      expect(r.cup, `cup ${cup.id}`).toBe(cup.id);
      expect(r.end).toBe("sink");
      expect(r.bounce).toBe(false);
      expect(r.events.at(-1)?.kind).toBe(EV_SINK);
    }
  });

  it("a clean make ends on the drink, inside the cup", () => {
    const target = rack[9]!;
    const r = simulateThrow(idealThrow(target), rack);
    const end = r.path.at(-1)!;
    expect(end.y).toBeLessThan(CUP_H);
    expect(Math.hypot(end.x - target.u, end.z - (TABLE_L - target.v))).toBeLessThan(0.03);
    expect(r.duration).toBeGreaterThan(700);
    expect(r.duration).toBeLessThan(1400);
  });

  it("way short, long or wide misses", () => {
    expect(simulateThrow({ aim: 0, power: 1.2 }, rack).cup).toBeNull();
    expect(simulateThrow({ aim: 1, power: 0.7 }, rack).cup).toBeNull();
    expect(simulateThrow({ aim: -1, power: 0.7 }, rack).cup).toBeNull();
    const long = simulateThrow({ aim: 0, power: 1.2 }, rack);
    expect(long.end).toBe("out");
  });

  it("paths start in the hand and are time-ordered", () => {
    const r = simulateThrow({ aim: 0.2, power: 0.5 }, rack);
    expect(r.path[0]).toEqual({ t: 0, ...HAND });
    for (let i = 1; i < r.path.length; i++) expect(r.path[i]!.t).toBeGreaterThan(r.path[i - 1]!.t);
  });
});

describe("cup hit detection", () => {
  const slot = formationSlots("line", 2)![0]!;
  const cups = lone(slot, 4);
  const ideal = idealThrow(slot);

  it("has a power window of a few percent around the ideal throw", () => {
    const row = [-0.04, -0.02, -0.01, 0, 0.01, 0.02, 0.04].map((dp) => simulateThrow({ ...ideal, power: ideal.power + dp }, cups).cup);
    expect(row[0]).toBeNull();
    expect(row.slice(2, 5)).toEqual([4, 4, 4]);
    expect(row[6]).toBeNull();
  });

  it("has an aim window around the ideal throw", () => {
    const row = [-0.2, -0.04, 0, 0.04, 0.2].map((da) => simulateThrow({ ...ideal, aim: ideal.aim + da }, cups).cup);
    expect(row).toEqual([null, 4, 4, 4, null]);
  });

  it("rim shots rattle: some go in after touching the rim, some pop out", () => {
    const results = [];
    for (let dp = -0.04; dp <= 0.04; dp += 0.0025) results.push(simulateThrow({ ...ideal, power: ideal.power + dp }, cups));
    expect(results.some((r) => r.cup === 4 && r.rim)).toBe(true);
    expect(results.some((r) => r.cup === null && r.events.some((e) => e.kind === EV_RIM))).toBe(true);
  });

  it("a hot ball (on fire) finds the cup more often", () => {
    let cold = 0;
    let hot = 0;
    for (let dp = -0.05; dp <= 0.05; dp += 0.0025) {
      for (let da = -0.12; da <= 0.12; da += 0.02) {
        const input = { aim: ideal.aim + da, power: ideal.power + dp };
        if (simulateThrow(input, cups).cup !== null) cold++;
        if (simulateThrow(input, cups, { fire: true }).cup !== null) hot++;
      }
    }
    expect(hot).toBeGreaterThan(cold * 1.3);
  });

  it("removed cups can't be hit", () => {
    const r = simulateThrow(idealThrow(rack[9]!), rack.filter((c) => c.id !== 9));
    expect(r.cup).not.toBe(9);
  });

  it("soft tosses can bounce off the table and in (a bounce shot)", () => {
    const bounces = [];
    for (let p = 0.05; p <= 0.4; p += 0.01) {
      for (let a = -0.2; a <= 0.2; a += 0.05) {
        const r = simulateThrow({ aim: a, power: p }, rack);
        if (r.cup !== null && r.bounce) bounces.push(r);
      }
    }
    expect(bounces.length).toBeGreaterThan(3);
    for (const r of bounces) {
      const table = r.events.findIndex((e) => e.kind === EV_TABLE);
      const sink = r.events.findIndex((e) => e.kind === EV_SINK);
      expect(table).toBeGreaterThanOrEqual(0);
      expect(table).toBeLessThan(sink);
    }
  });

  it("the full rack is much easier to hit than a lone cup", () => {
    let full = 0;
    let single = 0;
    for (let p = 0.4; p <= 0.9; p += 0.01) {
      for (let a = -0.4; a <= 0.4; a += 0.05) {
        if (simulateThrow({ aim: a, power: p }, rack).cup !== null) full++;
        if (simulateThrow({ aim: a, power: p }, cups).cup !== null) single++;
      }
    }
    expect(full).toBeGreaterThan(single * 4);
  });

  it("known outcomes stay put (physics regression)", () => {
    const inputs: [number, number][] = [[0, 0.7], [0, 0.8], [-0.1, 0.72], [0.1, 0.72], [-0.3, 0.8], [0, 0.2], [0.1, 0.2], [0, 1.1]];
    const grid = inputs.map(([aim, power]) => outcome(simulateThrow({ aim, power }, rack)));
    expect(grid).toEqual(["9", "5", "-", "-", "4r", "6br", "8b", "-"]);
  });
});

describe("compact trajectories", () => {
  it("round-trip within a millimetre", () => {
    const r = simulateThrow({ aim: -0.2, power: 0.64 }, rack);
    const path = decodePath(encodePath(r.path))!;
    expect(path).toHaveLength(r.path.length);
    path.forEach((p, i) => {
      expect(Math.abs(p.x - r.path[i]!.x)).toBeLessThanOrEqual(0.0005);
      expect(Math.abs(p.y - r.path[i]!.y)).toBeLessThanOrEqual(0.0005);
    });
    const events = decodeEvents(encodeEvents(r.events))!;
    expect(events.map((e) => [e.t, e.kind, e.cup])).toEqual(r.events.map((e) => [e.t, e.kind, e.cup]));
  });

  it("stay small enough for the shared state", () => {
    for (const p of [0.1, 0.5, 0.7, 1.2]) {
      const r = simulateThrow({ aim: 0.1, power: p }, rack);
      expect(JSON.stringify({ path: encodePath(r.path), ev: encodeEvents(r.events) }).length).toBeLessThan(4000);
    }
  });

  it("reject junk", () => {
    expect(decodePath("nope")).toBeNull();
    expect(decodePath([0, 1, 2])).toBeNull();
    expect(decodePath([5, 0, 0, 0, 1, 0, 0, 0])).toBeNull(); // time goes backwards
    expect(decodeEvents([0, 99, 0, 0])).toBeNull();
  });

  it("sample by time, interpolating between points", () => {
    const path = decodePath([0, 0, 0, 0, 100, 1000, 2000, 3000])!;
    expect(samplePath(path, 50)).toEqual({ x: 0.5, y: 1, z: 1.5 });
    expect(samplePath(path, -5)).toEqual({ x: 0, y: 0, z: 0 });
    expect(samplePath(path, 500)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("aiming aids and swipes", () => {
  it("the arc preview follows the real flight", () => {
    const input = { aim: 0.1, power: 0.6 };
    const arc = previewArc(input, 0.4);
    const r = simulateThrow(input, []);
    expect(arc[0]).toEqual(HAND);
    // Early in the flight nothing has been hit yet: the preview and the path agree.
    const mid = arc[6]!;
    const near = r.path.reduce((best, p) => Math.min(best, Math.hypot(p.x - mid.x, p.y - mid.y, p.z - mid.z)), Infinity);
    expect(near).toBeLessThan(0.1);
  });

  it("a faster flick throws further; leaning aims", () => {
    const slow = throwFromFlick({ dx: 0, dy: -200, ms: 150, height: 800 })!;
    const fast = throwFromFlick({ dx: 0, dy: -400, ms: 150, height: 800 })!;
    expect(fast.power).toBeGreaterThan(slow.power);
    expect(throwFromFlick({ dx: 60, dy: -300, ms: 150, height: 800 })!.aim).toBeGreaterThan(0);
    expect(throwFromFlick({ dx: -60, dy: -300, ms: 150, height: 800 })!.aim).toBeLessThan(0);
    expect(throwFromFlick({ dx: 0, dy: 50, ms: 150, height: 800 })).toBeNull();
  });

  it("flick speed and power are inverses", () => {
    for (const p of [0, 0.2, 0.5, 0.8, 1]) expect(flickPower(flickSpeedFor(p))).toBeCloseTo(p, 6);
  });
});
