import { describe, expect, it } from "vitest";
import { BALL_R, GRID, compileHole, segmentDistance } from "./compile";
import { HOLES, TOTAL_PAR } from "./course";
import { STROKE_CAP } from "./logic";
import { HZ, simulateShot } from "./physics";
import { THOROUGH, planNow } from "./planner";

describe("course layout", () => {
  it("has nine holes numbered in order, par 2–4", () => {
    expect(HOLES.map((h) => h.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const h of HOLES) {
      expect(h.par).toBeGreaterThanOrEqual(2);
      expect(h.par).toBeLessThanOrEqual(4);
    }
    expect(TOTAL_PAR).toBe(HOLES.reduce((s, h) => s + h.par, 0));
  });

  it.each(HOLES.map((h) => [h.name, h] as const))("%s is well formed", (_, hole) => {
    const c = compileHole(hole);
    for (const r of hole.floor) {
      for (const v of r) expect(Math.abs(v / GRID - Math.round(v / GRID))).toBeLessThan(1e-9);
      expect(r[2]).toBeGreaterThan(r[0]);
      expect(r[3]).toBeGreaterThan(r[1]);
    }
    for (const p of [hole.tee, hole.cup]) {
      expect(c.isFloor(p.x, p.y)).toBe(true);
      expect(c.surfaceAt(p.x, p.y)).toBeNull();
      // Clear of every rail, block and bumper.
      for (const cap of c.capsules) expect(segmentDistance(p.x, p.y, cap.ax, cap.ay, cap.bx, cap.by)).toBeGreaterThan(cap.r + BALL_R);
    }
    // The outline is closed: every corner joins exactly two runs.
    const ends = new Map<string, number>();
    for (const e of c.edges) {
      for (const k of [`${e.ax},${e.ay}`, `${e.bx},${e.by}`]) ends.set(k, (ends.get(k) ?? 0) + 1);
    }
    for (const n of ends.values()) expect(n % 2).toBe(0);
    // The tee can reach the cup (tubes and jumps count).
    expect(Number.isFinite(c.navDistance(hole.tee.x, hole.tee.y))).toBe(true);
    // A ball left on the tee stays put.
    expect(simulateShot(c, hole.tee, 0, 0).status).toBe("rest");
    expect(hole.flyover.length).toBeGreaterThan(0);
  });
});

describe("every hole can be played within the stroke cap", () => {
  it("hole 1 falls to a scripted straight putt", () => {
    const hole = HOLES[0]!;
    const c = compileHole(hole);
    // Straight up the middle, over the hump.
    const r = simulateShot(c, hole.tee, Math.PI / 2, 0.49, 2 * HZ);
    expect(r.status).toBe("holed");
  });

  it.each(HOLES.map((h) => [h.number, h.name, h] as const))(
    "hole %i (%s): the planner holes out in par or better",
    (_, __, hole) => {
      const c = compileHole(hole);
      let pos = { ...hole.tee };
      let tick = 2 * HZ;
      let strokes = 0;
      let holed = false;
      while (strokes < STROKE_CAP && !holed) {
        const best = planNow(hole, pos, tick, THOROUGH)[0]!;
        // Replaying the chosen shot gives exactly what the planner saw.
        const r = simulateShot(c, pos, best.angle, best.power, tick);
        expect(r).toEqual(best.result);
        strokes += r.status === "water" ? 2 : 1;
        if (r.status === "holed") holed = true;
        else if (r.status === "rest") pos = { x: r.x, y: r.y };
        tick += r.ticks + 2 * HZ;
      }
      expect(holed).toBe(true);
      expect(strokes).toBeLessThanOrEqual(hole.par);
    },
    60_000,
  );
});
