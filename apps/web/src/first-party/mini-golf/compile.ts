/**
 * Turns a hole's data into what the physics, the planner and the renderer
 * need: the height field, surface lookup, wall outline (from the floor
 * rectangles), static colliders and a distance-to-cup field.
 *
 * Pure and deterministic; compiled holes are cached per hole number.
 */

import type { Block, HeightFeature, Hole, Shape, Surface } from "./course";

/** Floor grid step: floor rectangles snap to it. */
export const GRID = 0.5;
/** Ball radius. */
export const BALL_R = 0.14;
/** Collision radius of wall and block edges (their faces sit on the floor edge). */
export const EDGE_R = 0.03;
/** Visual wall thickness and height above the turf. */
export const WALL_T = 0.22;
export const WALL_H = 0.3;
/** Depth of a water basin below the turf. */
export const WATER_DEPTH = 0.34;
/** Distance-field resolution. */
export const NAV_STEP = 0.25;

export type ColliderKind = "wall" | "block" | "bumper";

/** A static capsule: segment a→b inflated by `r`. Bumpers are zero-length capsules. */
export interface Capsule {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  kind: ColliderKind;
  /** Index into hole.bumpers for bumpers, else -1. */
  index: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** One straight run of the floor outline, with the outward normal. */
export interface WallEdge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
  /** Whether the wall box should extend past each end (outer corners). */
  extA: boolean;
  extB: boolean;
}

export interface CompiledHole {
  hole: Hole;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cols: number;
  rows: number;
  /** Floor occupancy per GRID cell. */
  cells: Uint8Array;
  edges: WallEdge[];
  /** Blocks after adding the windmill house. */
  blocks: Block[];
  capsules: Capsule[];
  isFloor(x: number, y: number): boolean;
  /** Physics height (ramps included). */
  height(x: number, y: number): number;
  /** Turf mesh height (ramps are drawn as their own meshes). */
  turfHeight(x: number, y: number): number;
  /** Writes ∂h/∂x, ∂h/∂y into `out`. */
  grad(x: number, y: number, out: [number, number]): void;
  /** Surface under a point (water first), or null for plain turf. */
  surfaceAt(x: number, y: number): Surface | null;
  /** Approximate rolling distance to the cup (Infinity off the floor). Built lazily. */
  navDistance(x: number, y: number): number;
}

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

/** Signed distance to a shape's edge (negative inside). Ellipses are approximated. */
export function shapeDistance(shape: Shape, x: number, y: number): number {
  switch (shape.kind) {
    case "circle":
      return Math.hypot(x - shape.x, y - shape.y) - shape.r;
    case "ellipse": {
      const k = Math.hypot((x - shape.x) / shape.rx, (y - shape.y) / shape.ry);
      return (k - 1) * Math.min(shape.rx, shape.ry);
    }
    case "rect": {
      const cx = (shape.x0 + shape.x1) / 2;
      const cy = (shape.y0 + shape.y1) / 2;
      const dx = Math.abs(x - cx) - (shape.x1 - shape.x0) / 2;
      const dy = Math.abs(y - cy) - (shape.y1 - shape.y0) / 2;
      const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
      return outside + Math.min(Math.max(dx, dy), 0);
    }
  }
}

function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/* ------------------------------------------------------------------ */
/* Height field                                                       */
/* ------------------------------------------------------------------ */

function featureHeight(f: HeightFeature, x: number, y: number): number {
  switch (f.kind) {
    case "hill": {
      const dx = x - f.x;
      const dy = y - f.y;
      return f.a * Math.exp(-(dx * dx + dy * dy) / (2 * f.s * f.s));
    }
    case "tier": {
      const c = f.axis === "x" ? x : y;
      return f.a * smoothstep((c - f.from) / (f.to - f.from));
    }
    case "ramp":
      return x >= f.x0 && x <= f.x1 && y >= f.y0 && y < f.y1 ? (f.a * (y - f.y0)) / (f.y1 - f.y0) : 0;
  }
}

function featureGrad(f: HeightFeature, x: number, y: number, out: [number, number]): void {
  switch (f.kind) {
    case "hill": {
      const dx = x - f.x;
      const dy = y - f.y;
      const s2 = f.s * f.s;
      const h = f.a * Math.exp(-(dx * dx + dy * dy) / (2 * s2));
      out[0] += (-h * dx) / s2;
      out[1] += (-h * dy) / s2;
      return;
    }
    case "tier": {
      const c = f.axis === "x" ? x : y;
      const span = f.to - f.from;
      const t = (c - f.from) / span;
      if (t <= 0 || t >= 1) return;
      const d = (f.a * 6 * t * (1 - t)) / span;
      if (f.axis === "x") out[0] += d;
      else out[1] += d;
      return;
    }
    case "ramp":
      if (x >= f.x0 && x <= f.x1 && y >= f.y0 && y < f.y1) out[1] += f.a / (f.y1 - f.y0);
      return;
  }
}

/* ------------------------------------------------------------------ */
/* Compile                                                            */
/* ------------------------------------------------------------------ */

function rectBlock(x0: number, y0: number, x1: number, y1: number): Block {
  return {
    points: [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
  };
}

function capsule(ax: number, ay: number, bx: number, by: number, r: number, kind: ColliderKind, index = -1): Capsule {
  return {
    ax,
    ay,
    bx,
    by,
    r,
    kind,
    index,
    minX: Math.min(ax, bx) - r,
    minY: Math.min(ay, by) - r,
    maxX: Math.max(ax, bx) + r,
    maxY: Math.max(ay, by) + r,
  };
}

/** Distance from p to segment ab. */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}

/** Houses of the windmill as two solid blocks either side of its tunnel. */
export function windmillBlocks(hole: Hole): Block[] {
  const w = hole.windmill;
  if (!w) return [];
  const left = w.x - w.width / 2;
  const right = w.x + w.width / 2;
  return [rectBlock(left, w.y0, w.x - w.tunnel / 2, w.y1), rectBlock(w.x + w.tunnel / 2, w.y0, right, w.y1)];
}

export function compileHole(hole: Hole): CompiledHole {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x0, y0, x1, y1] of hole.floor) {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  }
  const cols = Math.round((maxX - minX) / GRID);
  const rows = Math.round((maxY - minY) / GRID);
  const cells = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = minX + (i + 0.5) * GRID;
      const cy = minY + (j + 0.5) * GRID;
      if (hole.floor.some(([x0, y0, x1, y1]) => cx > x0 && cx < x1 && cy > y0 && cy < y1)) cells[j * cols + i] = 1;
    }
  }
  const cell = (i: number, j: number) => (i >= 0 && j >= 0 && i < cols && j < rows ? cells[j * cols + i]! : 0);
  const isFloor = (x: number, y: number) => {
    const i = Math.floor((x - minX) / GRID);
    const j = Math.floor((y - minY) / GRID);
    return cell(i, j) === 1;
  };

  /* Outline: unit edges between floor and non-floor cells, merged into runs. */
  const edges: WallEdge[] = [];
  const pushRun = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
    // An end extends (outer corner) unless the floor carries on past it on the inside.
    const ext = (px: number, py: number, dx: number, dy: number) => !isFloor(px + dx * 0.25 - nx * 0.25, py + dy * 0.25 - ny * 0.25);
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    edges.push({ ax, ay, bx, by, nx, ny, extA: ext(ax, ay, -dx, -dy), extB: ext(bx, by, dx, dy) });
  };
  // Horizontal edges: below (ny = -1) and above (ny = +1) each floor row.
  for (const side of [-1, 1] as const) {
    for (let j = 0; j < rows; j++) {
      let start = -1;
      for (let i = 0; i <= cols; i++) {
        const on = i < cols && cell(i, j) === 1 && cell(i, j + side) === 0;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          const y = minY + (side > 0 ? j + 1 : j) * GRID;
          pushRun(minX + start * GRID, y, minX + i * GRID, y, 0, side);
          start = -1;
        }
      }
    }
  }
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < cols; i++) {
      let start = -1;
      for (let j = 0; j <= rows; j++) {
        const on = j < rows && cell(i, j) === 1 && cell(i + side, j) === 0;
        if (on && start < 0) start = j;
        if (!on && start >= 0) {
          const x = minX + (side > 0 ? i + 1 : i) * GRID;
          pushRun(x, minY + start * GRID, x, minY + j * GRID, side, 0);
          start = -1;
        }
      }
    }
  }

  /* Static colliders. */
  const blocks = [...(hole.blocks ?? []), ...windmillBlocks(hole)];
  const capsules: Capsule[] = [];
  for (const e of edges) {
    capsules.push(capsule(e.ax + e.nx * EDGE_R, e.ay + e.ny * EDGE_R, e.bx + e.nx * EDGE_R, e.by + e.ny * EDGE_R, EDGE_R, "wall"));
  }
  for (const b of blocks) {
    const pts = b.points;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[(k + 1) % pts.length]!;
      // Offset outward (counter-clockwise polygon: the right-hand normal points out).
      const len = Math.hypot(bx - ax, by - ay);
      const nx = (by - ay) / len;
      const ny = -(bx - ax) / len;
      capsules.push(capsule(ax + nx * EDGE_R, ay + ny * EDGE_R, bx + nx * EDGE_R, by + ny * EDGE_R, EDGE_R, "block"));
    }
  }
  (hole.bumpers ?? []).forEach((b, i) => capsules.push(capsule(b.x, b.y, b.x, b.y, b.r, "bumper", i)));

  /* Height field. */
  const features = hole.heights ?? [];
  const waters = (hole.surfaces ?? []).filter((s) => s.type === "water");
  const others = (hole.surfaces ?? []).filter((s) => s.type !== "water");
  const basin = (x: number, y: number) => {
    let h = 0;
    for (const w of waters) {
      const d = shapeDistance(w.shape, x, y);
      if (d < 0) h = Math.min(h, -WATER_DEPTH * smoothstep(-d / 0.3));
    }
    return h;
  };
  const turfHeight = (x: number, y: number) => {
    let h = 0;
    for (const f of features) if (f.kind !== "ramp") h += featureHeight(f, x, y);
    return h + basin(x, y);
  };
  const height = (x: number, y: number) => {
    let h = 0;
    for (const f of features) h += featureHeight(f, x, y);
    return h + basin(x, y);
  };
  const grad = (x: number, y: number, out: [number, number]) => {
    out[0] = 0;
    out[1] = 0;
    for (const f of features) featureGrad(f, x, y, out);
  };
  const surfaceAt = (x: number, y: number): Surface | null => {
    for (const w of waters) if (shapeDistance(w.shape, x, y) < 0) return w;
    for (const s of others) if (shapeDistance(s.shape, x, y) < 0) return s;
    return null;
  };

  const compiled: CompiledHole = {
    hole,
    minX,
    minY,
    maxX,
    maxY,
    cols,
    rows,
    cells,
    edges,
    blocks,
    capsules,
    isFloor,
    height,
    turfHeight,
    grad,
    surfaceAt,
    navDistance: () => Infinity,
  };
  let nav: ((x: number, y: number) => number) | null = null;
  compiled.navDistance = (x, y) => {
    nav ??= buildNav(compiled);
    return nav(x, y);
  };
  return compiled;
}

/* ------------------------------------------------------------------ */
/* Distance to the cup (for the planner)                              */
/* ------------------------------------------------------------------ */

/** Tiny binary heap keyed by distance. */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.ids.length;
  }
  push(id: number, key: number) {
    const ids = this.ids;
    const keys = this.keys;
    ids.push(id);
    keys.push(key);
    let i = ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= keys[i]!) break;
      [ids[p], ids[i]] = [ids[i]!, ids[p]!];
      [keys[p], keys[i]] = [keys[i]!, keys[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const ids = this.ids;
    const keys = this.keys;
    const top: [number, number] = [ids[0]!, keys[0]!];
    const lastId = ids.pop()!;
    const lastKey = keys.pop()!;
    if (ids.length > 0) {
      ids[0] = lastId;
      keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < ids.length && keys[l]! < keys[m]!) m = l;
        if (r < ids.length && keys[r]! < keys[m]!) m = r;
        if (m === i) break;
        [ids[m], ids[i]] = [ids[i]!, ids[m]!];
        [keys[m], keys[i]] = [keys[i]!, keys[m]!];
        i = m;
      }
    }
    return top;
  }
}

function buildNav(c: CompiledHole): (x: number, y: number) => number {
  const { hole, minX, minY } = c;
  const cols = Math.round((c.maxX - c.minX) / NAV_STEP);
  const rows = Math.round((c.maxY - c.minY) / NAV_STEP);
  const cost = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = minX + (i + 0.5) * NAV_STEP;
      const y = minY + (j + 0.5) * NAV_STEP;
      let k = c.isFloor(x, y) ? 1 : 0;
      if (k) {
        for (const cap of c.capsules) {
          if (segmentDistance(x, y, cap.ax, cap.ay, cap.bx, cap.by) < cap.r + BALL_R * 0.6) {
            k = 0;
            break;
          }
        }
      }
      if (k) {
        const s = c.surfaceAt(x, y);
        if (s?.type === "water") k = 8;
        else if (s?.type === "sand") k = 2.5;
      }
      cost[j * cols + i] = k;
    }
  }
  const dist = new Float64Array(cols * rows).fill(Infinity);
  const index = (x: number, y: number) => {
    const i = Math.min(cols - 1, Math.max(0, Math.floor((x - minX) / NAV_STEP)));
    const j = Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / NAV_STEP)));
    return j * cols + i;
  };
  const heap = new Heap();
  const start = index(hole.cup.x, hole.cup.y);
  dist[start] = 0;
  heap.push(start, 0);
  const tubeEntries = new Map<number, number[]>();
  for (const t of hole.tubes ?? []) {
    const exit = index(t.to.x, t.to.y);
    tubeEntries.set(exit, [...(tubeEntries.get(exit) ?? []), index(t.from.x, t.from.y)]);
  }
  const relax = (id: number, d: number) => {
    if (d < dist[id]!) {
      dist[id] = d;
      heap.push(id, d);
    }
  };
  while (heap.size > 0) {
    const [id, d] = heap.pop();
    if (d > dist[id]!) continue;
    const i = id % cols;
    const j = (id - i) / cols;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nid = nj * cols + ni;
        const k = cost[nid]!;
        if (!k) continue;
        // No corner cutting past blocked cells.
        if (di && dj && (!cost[j * cols + ni] || !cost[nj * cols + i])) continue;
        relax(nid, d + (di && dj ? Math.SQRT2 : 1) * NAV_STEP * (k + cost[id]!) * 0.5);
      }
    }
    for (const entry of tubeEntries.get(id) ?? []) relax(entry, d + 0.5);
  }
  return (x, y) => {
    if (!c.isFloor(x, y)) return Infinity;
    const id = index(x, y);
    const d = dist[id]!;
    if (Number.isFinite(d)) return d;
    // Hugging an obstacle: take the best neighbour.
    let best = Infinity;
    const i = id % cols;
    const j = (id - i) / cols;
    for (let dj = -2; dj <= 2; dj++) {
      for (let di = -2; di <= 2; di++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        best = Math.min(best, dist[nj * cols + ni]! + Math.hypot(di, dj) * NAV_STEP);
      }
    }
    return best;
  };
}

const cache = new Map<Hole, CompiledHole>();

export function getCompiled(hole: Hole): CompiledHole {
  let c = cache.get(hole);
  if (!c) {
    c = compileHole(hole);
    cache.set(hole, c);
  }
  return c;
}
