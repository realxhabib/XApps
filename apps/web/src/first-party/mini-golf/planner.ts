/**
 * Shot planner: tries a fan of aims and powers through the real physics and
 * keeps the one that leaves the ball closest to the cup (by rolling distance,
 * so it finds bank shots, tubes and the jump on its own). Bots use it with
 * some wobble on top; the tests use it to prove every hole can be holed
 * within the stroke cap.
 *
 * It's a generator so the app can spread the work over frames; `planNow`
 * runs it in one go.
 */

import { getCompiled, type CompiledHole } from "./compile";
import type { Hole } from "./course";
import { simulateShot, type ShotResult } from "./physics";

export interface Plan {
  angle: number;
  power: number;
  result: ShotResult;
  /** Lower is better. Holed shots are ≤ −100. */
  score: number;
}

export interface PlanOptions {
  /** Aims tried around the full circle. */
  angles: number;
  powers: readonly number[];
  /** Best distinct aims refined with a fine grid. */
  seeds: number;
  /** Fine grid half-width in half-degree steps. */
  span: number;
}

/** Thorough: the course tests. */
export const THOROUGH: PlanOptions = { angles: 72, powers: [0.1, 0.16, 0.23, 0.31, 0.4, 0.5, 0.62, 0.76, 0.9, 1], seeds: 4, span: 5 };
/** Quick: bots on a phone (a few hundred simulations). */
export const QUICK: PlanOptions = { angles: 48, powers: [0.12, 0.2, 0.3, 0.42, 0.56, 0.72, 0.88, 1], seeds: 3, span: 3 };

const FINE_ANGLE = (0.5 * Math.PI) / 180;
const FINE_POWER = 0.02;
/** Simulations between yields. */
const CHUNK = 12;

export function scoreResult(course: CompiledHole, from: { x: number; y: number }, r: ShotResult): number {
  if (r.status === "holed") return -100;
  if (r.status === "water") return course.navDistance(from.x, from.y) + 6;
  let d = course.navDistance(r.x, r.y);
  if (!Number.isFinite(d)) d = 999;
  if (course.surfaceAt(r.x, r.y)?.type === "sand") d += 1;
  return d;
}

function evaluate(course: CompiledHole, from: { x: number; y: number }, angle: number, power: number, tick: number): Plan {
  const result = simulateShot(course, from, angle, power, tick);
  return { angle, power, result, score: scoreResult(course, from, result) };
}

/**
 * Plans a shot from `from`, struck on `tick`. Returns the best plans first.
 * Among holing shots it prefers the middle of a wide window (sturdier to
 * wobble), then the gentlest.
 */
export function* planShot(
  hole: Hole,
  from: { x: number; y: number },
  tick: number,
  options: PlanOptions = THOROUGH,
): Generator<void, Plan[], void> {
  const course = getCompiled(hole);
  const coarse: Plan[] = [];
  let n = 0;
  for (let a = 0; a < options.angles; a++) {
    const angle = (a / options.angles) * Math.PI * 2;
    for (const power of options.powers) {
      coarse.push(evaluate(course, from, angle, power, tick));
      if (++n % CHUNK === 0) yield;
    }
  }
  coarse.sort((p, q) => p.score - q.score);
  // Refine around the best few distinct aims.
  const seeds: Plan[] = [];
  for (const p of coarse) {
    if (seeds.length >= options.seeds) break;
    if (seeds.some((s) => Math.abs(angleDiff(s.angle, p.angle)) < 0.09 && Math.abs(s.power - p.power) < 0.08)) continue;
    seeds.push(p);
  }
  const refined: Plan[] = [];
  for (const seed of seeds) {
    const grid: Plan[][] = [];
    for (let i = -options.span; i <= options.span; i++) {
      const row: Plan[] = [];
      for (let j = -3; j <= 3; j++) {
        const power = Math.max(0.05, Math.min(1, seed.power + j * FINE_POWER));
        row.push(evaluate(course, from, seed.angle + i * FINE_ANGLE, power, tick));
        if (++n % CHUNK === 0) yield;
      }
      grid.push(row);
    }
    // Holing shots score by how many neighbours also hole.
    for (let i = 0; i < grid.length; i++) {
      const row = grid[i]!;
      for (let j = 0; j < row.length; j++) {
        const p = row[j]!;
        if (p.result.status === "holed") {
          let around = 0;
          for (let di = -2; di <= 2; di++) {
            for (let dj = -1; dj <= 1; dj++) if (grid[i + di]?.[j + dj]?.result.status === "holed") around++;
          }
          p.score = -100 - around - (1 - p.power) * 0.5;
        }
        refined.push(p);
      }
    }
  }
  return [...refined, ...coarse].sort((p, q) => p.score - q.score);
}

export function planNow(hole: Hole, from: { x: number; y: number }, tick: number, options: PlanOptions = THOROUGH): Plan[] {
  const gen = planShot(hole, from, tick, options);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
  }
}

export function angleDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
