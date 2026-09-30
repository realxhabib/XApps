/**
 * 8-Ball Pool — canvas drawing. No React.
 *
 * - The table (wood, cushions, felt, pockets, diamonds) is painted once per
 *   size into an offscreen canvas.
 * - Balls are ray-traced per pixel into small sprites: a real sphere with its
 *   own orientation, so numbers and stripes roll with the ball, lit by one
 *   overhead lamp (diffuse + two specular lobes + a felt-tinted rim). A sprite
 *   is only repainted when its ball turned.
 * - The cue, guides and markers are vector paths drawn every frame.
 *
 * The table can lie landscape (head on the left) or portrait (head at the
 * bottom); `View` maps table metres to CSS pixels either way.
 */

import { HEAD_X, POCKETS, R, SEGMENTS, TABLE_L, TABLE_W, type Pocket, type Vec } from "./physics";

/** Cushion rubber, nose to wood (m). */
export const CUSHION = 0.044;
/** Wooden rail (m). */
export const WOOD = 0.082;
export const BORDER = CUSHION + WOOD;
export const OUTER_L = TABLE_L + 2 * BORDER;
export const OUTER_W = TABLE_W + 2 * BORDER;

export interface View {
  portrait: boolean;
  /** CSS px per metre. */
  s: number;
  /** CSS px of the table origin's axes (see toScreen). */
  ox: number;
  oy: number;
  width: number;
  height: number;
  dpr: number;
}

/** Fits the whole table (rails included) into `width` × `height` CSS px. */
export function makeView(width: number, height: number, portrait: boolean, dpr: number): View {
  const s = portrait ? Math.min(width / OUTER_W, height / OUTER_L) : Math.min(width / OUTER_L, height / OUTER_W);
  const w = (portrait ? OUTER_W : OUTER_L) * s;
  const h = (portrait ? OUTER_L : OUTER_W) * s;
  return { portrait, s, ox: (width - w) / 2 + BORDER * s, oy: (height - h) / 2 + BORDER * s, width, height, dpr };
}

export function toScreen(v: View, p: Vec): Vec {
  return v.portrait
    ? { x: v.ox + (TABLE_W - p.y) * v.s, y: v.oy + (TABLE_L - p.x) * v.s }
    : { x: v.ox + p.x * v.s, y: v.oy + (TABLE_W - p.y) * v.s };
}

export function toTable(v: View, x: number, y: number): Vec {
  return v.portrait
    ? { x: TABLE_L - (y - v.oy) / v.s, y: TABLE_W - (x - v.ox) / v.s }
    : { x: (x - v.ox) / v.s, y: TABLE_W - (y - v.oy) / v.s };
}

/** A table-space direction in screen space. */
export function dirToScreen(v: View, d: Vec): Vec {
  return v.portrait ? { x: -d.y, y: -d.x } : { x: d.x, y: -d.y };
}

/** Screen angle (radians, y down) of table angle `a`. */
export function angleToScreen(v: View, a: number): number {
  const d = dirToScreen(v, { x: Math.cos(a), y: Math.sin(a) });
  return Math.atan2(d.y, d.x);
}

/* ------------------------------------------------------------------------ */
/* Palette                                                                  */
/* ------------------------------------------------------------------------ */

export const BALL_COLORS: readonly (readonly [number, number, number])[] = [
  [246, 243, 234], // cue
  [248, 196, 20], // 1 yellow
  [28, 76, 196], // 2 blue
  [214, 40, 34], // 3 red
  [96, 44, 150], // 4 purple
  [246, 120, 24], // 5 orange
  [18, 132, 72], // 6 green
  [128, 30, 38], // 7 maroon
  [20, 20, 24], // 8 black
  [248, 196, 20],
  [28, 76, 196],
  [214, 40, 34],
  [96, 44, 150],
  [246, 120, 24],
  [18, 132, 72],
  [128, 30, 38],
];

export const ballCss = (id: number): string => {
  const [r, g, b] = BALL_COLORS[id] ?? [200, 200, 200];
  return `rgb(${r} ${g} ${b})`;
};

const FELT = "#17744e";
const FELT_DARK = "#0c4a31";
const CUSHION_TOP = "#1b8057";
const CUSHION_EDGE = "#0e5236";

/* ------------------------------------------------------------------------ */
/* Static table                                                             */
/* ------------------------------------------------------------------------ */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Screen rect of a table-space rectangle. */
function rectOf(v: View, x0: number, y0: number, x1: number, y1: number) {
  const a = toScreen(v, { x: x0, y: y0 });
  const b = toScreen(v, { x: x1, y: y1 });
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function jawsOf(p: Pocket) {
  return SEGMENTS.filter((s) => s.kind === "jaw" && Math.hypot(s.a.x - (p.side ? p.x : p.x), s.a.y - p.y) < 0.16);
}

/** Paints the table into `ctx` (already scaled for the device pixel ratio). */
export function paintTable(ctx: CanvasRenderingContext2D, v: View): void {
  const s = v.s;
  const P = (x: number, y: number) => toScreen(v, { x, y });
  const outer = rectOf(v, -BORDER, -BORDER, TABLE_L + BORDER, TABLE_W + BORDER);
  const inner = rectOf(v, -CUSHION, -CUSHION, TABLE_L + CUSHION, TABLE_W + CUSHION);
  const bed = rectOf(v, 0, 0, TABLE_L, TABLE_W);

  // Drop shadow under the whole table.
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / 0.55)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  roundRect(ctx, outer.x, outer.y, outer.w, outer.h, 0.06 * s);
  ctx.fillStyle = "#3b1d0e";
  ctx.fill();
  ctx.restore();

  // Wood: a warm walnut with grain and a lit bevel.
  ctx.save();
  roundRect(ctx, outer.x, outer.y, outer.w, outer.h, 0.06 * s);
  ctx.clip();
  const wood = ctx.createLinearGradient(outer.x, outer.y, outer.x + outer.w * 0.3, outer.y + outer.h);
  wood.addColorStop(0, "#7a3f1d");
  wood.addColorStop(0.5, "#5c2c13");
  wood.addColorStop(1, "#40200e");
  ctx.fillStyle = wood;
  ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
  const rand = rng(7);
  const along = !v.portrait;
  ctx.lineCap = "round";
  for (let k = 0; k < 260; k++) {
    const t = rand();
    ctx.strokeStyle = rand() < 0.5 ? `rgb(30 12 4 / ${0.08 + rand() * 0.14})` : `rgb(160 90 45 / ${0.05 + rand() * 0.08})`;
    ctx.lineWidth = 0.4 + rand() * 1.4;
    ctx.beginPath();
    if (along) {
      const y = outer.y + t * outer.h;
      const x0 = outer.x + rand() * outer.w * 0.6;
      const len = outer.w * (0.2 + rand() * 0.6);
      ctx.moveTo(x0, y);
      ctx.bezierCurveTo(x0 + len * 0.3, y + (rand() - 0.5) * 4, x0 + len * 0.7, y + (rand() - 0.5) * 4, x0 + len, y + (rand() - 0.5) * 3);
    } else {
      const x = outer.x + t * outer.w;
      const y0 = outer.y + rand() * outer.h * 0.6;
      const len = outer.h * (0.2 + rand() * 0.6);
      ctx.moveTo(x, y0);
      ctx.bezierCurveTo(x + (rand() - 0.5) * 4, y0 + len * 0.3, x + (rand() - 0.5) * 4, y0 + len * 0.7, x + (rand() - 0.5) * 3, y0 + len);
    }
    ctx.stroke();
  }
  ctx.restore();
  // Bevel: light on the outer top-left edge, a dark lip where the wood meets the cushion.
  ctx.save();
  roundRect(ctx, outer.x + 1, outer.y + 1, outer.w - 2, outer.h - 2, 0.06 * s);
  ctx.strokeStyle = "rgb(255 220 180 / 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Pocket liners (leather cups set into the wood).
  for (const p of POCKETS) {
    const c = P(p.x, p.y);
    const r = (p.side ? 0.064 : 0.07) * s;
    const g = ctx.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, r);
    g.addColorStop(0, "#050302");
    g.addColorStop(0.75, "#1c130d");
    g.addColorStop(1, "#3a2a1c");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Cushions.
  ctx.save();
  ctx.fillStyle = CUSHION_TOP;
  ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
  // A soft dark edge where the rubber meets the wood.
  ctx.strokeStyle = "rgb(0 0 0 / 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(inner.x, inner.y, inner.w, inner.h);
  ctx.restore();

  // Pocket throats between the jaws.
  for (const p of POCKETS) {
    const jaws = jawsOf(p);
    if (jaws.length < 2) continue;
    const [j1, j2] = jaws as [(typeof SEGMENTS)[number], (typeof SEGMENTS)[number]];
    const back = { x: p.x - p.facing.x * 0.06, y: p.y - p.facing.y * 0.06 };
    const pts = [j1.a, j1.b, back, j2.b, j2.a].map((q) => P(q.x, q.y));
    ctx.beginPath();
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    const c = P(p.x, p.y);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 0.11 * s);
    g.addColorStop(0, "#020202");
    g.addColorStop(1, CUSHION_EDGE);
    ctx.fillStyle = g;
    ctx.fill();
    // The jaw faces catch a little light.
    ctx.strokeStyle = "rgb(255 255 255 / 0.10)";
    ctx.lineWidth = 1;
    for (const j of [j1, j2]) {
      const a = P(j.a.x, j.a.y);
      const b = P(j.b.x, j.b.y);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  // Cloth.
  ctx.save();
  ctx.beginPath();
  ctx.rect(bed.x, bed.y, bed.w, bed.h);
  ctx.clip();
  ctx.fillStyle = FELT;
  ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
  const cx = bed.x + bed.w / 2;
  const cy = bed.y + bed.h / 2;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(bed.w, bed.h) * 0.62);
  glow.addColorStop(0, "rgb(120 255 190 / 0.10)");
  glow.addColorStop(0.55, "rgb(0 0 0 / 0)");
  glow.addColorStop(1, "rgb(0 20 10 / 0.42)");
  ctx.fillStyle = glow;
  ctx.fillRect(bed.x, bed.y, bed.w, bed.h);
  // Nap: fine speckle.
  const speck = rng(3);
  const count = Math.min(9000, Math.floor(bed.w * bed.h * 0.06));
  for (let k = 0; k < count; k++) {
    ctx.fillStyle = speck() < 0.5 ? "rgb(255 255 255 / 0.035)" : "rgb(0 0 0 / 0.05)";
    ctx.fillRect(bed.x + speck() * bed.w, bed.y + speck() * bed.h, 1, 1);
  }
  // Cushion shadow on the cloth.
  const edge = 0.02 * s;
  for (const [x, y, w, h, gx0, gy0, gx1, gy1] of [
    [bed.x, bed.y, bed.w, edge, 0, bed.y, 0, bed.y + edge],
    [bed.x, bed.y + bed.h - edge, bed.w, edge, 0, bed.y + bed.h, 0, bed.y + bed.h - edge],
    [bed.x, bed.y, edge, bed.h, bed.x, 0, bed.x + edge, 0],
    [bed.x + bed.w - edge, bed.y, edge, bed.h, bed.x + bed.w, 0, bed.x + bed.w - edge, 0],
  ] as const) {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, "rgb(0 0 0 / 0.35)");
    g.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  }
  // Head string and spots.
  const h0 = P(HEAD_X, 0);
  const h1 = P(HEAD_X, TABLE_W);
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = "rgb(255 255 255 / 0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(h0.x, h0.y);
  ctx.lineTo(h1.x, h1.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const spot of [
    { x: HEAD_X, y: TABLE_W / 2 },
    { x: TABLE_L * 0.75, y: TABLE_W / 2 },
  ]) {
    const q = P(spot.x, spot.y);
    ctx.fillStyle = "rgb(255 255 255 / 0.22)";
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(1.2, 0.005 * s), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = FELT_DARK;
  ctx.lineWidth = 1;
  ctx.strokeRect(bed.x + 0.5, bed.y + 0.5, bed.w - 1, bed.h - 1);

  // Holes, with depth.
  for (const p of POCKETS) {
    const c = P(p.x, p.y);
    const r = (p.side ? 0.05 : 0.055) * s;
    const g = ctx.createRadialGradient(c.x - r * 0.25, c.y - r * 0.3, r * 0.1, c.x, c.y, r);
    g.addColorStop(0, "#000");
    g.addColorStop(0.7, "#060606");
    g.addColorStop(1, "#1b1b1b");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(255 255 255 / 0.07)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Diamonds (sights) on the wood.
  const mid = CUSHION + WOOD * 0.5;
  const sights: Vec[] = [];
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    sights.push({ x: (TABLE_L * k) / 8, y: -mid }, { x: (TABLE_L * k) / 8, y: TABLE_W + mid });
  }
  for (let k = 1; k < 4; k++) sights.push({ x: -mid, y: (TABLE_W * k) / 4 }, { x: TABLE_L + mid, y: (TABLE_W * k) / 4 });
  const d = Math.max(2.2, 0.011 * s);
  for (const sp of sights) {
    const q = P(sp.x, sp.y);
    const g = ctx.createLinearGradient(q.x - d, q.y - d, q.x + d, q.y + d);
    g.addColorStop(0, "#fffaf0");
    g.addColorStop(1, "#b9ad98");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y - d);
    ctx.lineTo(q.x + d * 0.6, q.y);
    ctx.lineTo(q.x, q.y + d);
    ctx.lineTo(q.x - d * 0.6, q.y);
    ctx.closePath();
    ctx.fill();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------------ */
/* Ball orientation                                                         */
/* ------------------------------------------------------------------------ */

/** 3×3 rotation (row-major), local → table. Columns are the ball's local axes. */
export type Orientation = Float64Array;

export function identity(): Orientation {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

/** A resting orientation for ball `id`: number mostly facing up, a little tilt and twist. */
export function restingOrientation(id: number): Orientation {
  const r = rng(id * 7919 + 13);
  const m = identity();
  rotate(m, { x: 0, y: 0, z: 1 }, r() * Math.PI * 2);
  rotate(m, { x: 1, y: 0, z: 0 }, (r() - 0.5) * 0.7);
  rotate(m, { x: 0, y: 1, z: 0 }, (r() - 0.5) * 0.7);
  return m;
}

/** m ← Rot(axis, angle) · m. */
export function rotate(m: Orientation, axis: { x: number; y: number; z: number }, angle: number): void {
  const len = Math.hypot(axis.x, axis.y, axis.z);
  if (len < 1e-12 || angle === 0) return;
  const x = axis.x / len;
  const y = axis.y / len;
  const z = axis.z / len;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const r00 = t * x * x + c;
  const r01 = t * x * y - s * z;
  const r02 = t * x * z + s * y;
  const r10 = t * x * y + s * z;
  const r11 = t * y * y + c;
  const r12 = t * y * z - s * x;
  const r20 = t * x * z - s * y;
  const r21 = t * y * z + s * x;
  const r22 = t * z * z + c;
  for (let col = 0; col < 3; col++) {
    const a = m[col] as number;
    const b = m[3 + col] as number;
    const d = m[6 + col] as number;
    m[col] = r00 * a + r01 * b + r02 * d;
    m[3 + col] = r10 * a + r11 * b + r12 * d;
    m[6 + col] = r20 * a + r21 * b + r22 * d;
  }
}

/** Rolls a ball by a table displacement (no slip): about ẑ × d by |d|/R. */
export function roll(m: Orientation, dx: number, dy: number): void {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-7) return;
  rotate(m, { x: -dy, y: dx, z: 0 }, dist / R);
}

/* ------------------------------------------------------------------------ */
/* Ball sprites (per-pixel)                                                 */
/* ------------------------------------------------------------------------ */

const DECAL = 0.52; // angular radius of the number circle
const COS_DECAL = Math.cos(DECAL);
const SIN_DECAL = Math.sin(DECAL);
const STRIPE = 0.6; // |local x| below this is the coloured band
const TEX = 64;

// Light from the top-left, a little in front (screen space, y down).
const L = normalize3(-0.42, -0.55, 0.72);
const H = normalize3(L[0], L[1], L[2] + 1);
const H2 = normalize3(0.35, 0.45, 1.6); // faint secondary lamp

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const m = Math.hypot(x, y, z);
  return [x / m, y / m, z / m];
}

interface Sprite {
  canvas: HTMLCanvasElement;
  image: ImageData;
  key: string;
}

export class BallPainter {
  private digits: (Uint8ClampedArray | null)[] = [];
  private sprites = new Map<number, Sprite>();
  private shadow: HTMLCanvasElement | null = null;
  private shadowSize = 0;

  constructor() {
    for (let id = 0; id < 16; id++) this.digits.push(id === 0 ? null : makeDigit(id));
  }

  /** Draws ball `id` centred at (x, y) CSS px with radius `r` CSS px. */
  draw(ctx: CanvasRenderingContext2D, v: View, id: number, x: number, y: number, r: number, m: Orientation, opts: { alpha?: number; dim?: number } = {}) {
    const rp = r * v.dpr;
    const size = Math.ceil(rp * 2 + 2);
    const key = `${size}|${v.portrait ? 1 : 0}|${Array.from(m, (n) => Math.round(n * 400)).join(",")}`;
    let sprite = this.sprites.get(id);
    if (!sprite || sprite.canvas.width !== size) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const c2 = canvas.getContext("2d");
      if (!c2) return;
      sprite = { canvas, image: c2.createImageData(size, size), key: "" };
      this.sprites.set(id, sprite);
    }
    if (sprite.key !== key) {
      this.paint(sprite, id, rp, m, v.portrait);
      sprite.key = key;
    }
    ctx.save();
    if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
    const half = size / 2 / v.dpr;
    ctx.drawImage(sprite.canvas, x - half, y - half, size / v.dpr, size / v.dpr);
    if (opts.dim) {
      ctx.fillStyle = `rgb(0 0 0 / ${opts.dim})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Soft contact shadow, offset away from the lamp. */
  drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1) {
    const size = Math.ceil(r * 4);
    if (!this.shadow || this.shadowSize !== size) {
      const c = document.createElement("canvas");
      c.width = size * 2;
      c.height = size * 2;
      const g2 = c.getContext("2d");
      if (!g2) return;
      const g = g2.createRadialGradient(size, size, 0, size, size, size);
      g.addColorStop(0, "rgb(0 0 0 / 0.55)");
      g.addColorStop(0.45, "rgb(0 0 0 / 0.32)");
      g.addColorStop(1, "rgb(0 0 0 / 0)");
      g2.fillStyle = g;
      g2.fillRect(0, 0, size * 2, size * 2);
      this.shadow = c;
      this.shadowSize = size;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.shadow, x + r * 0.32 - r * 1.25, y + r * 0.45 - r * 1.1, r * 2.5, r * 2.2);
    ctx.restore();
  }

  private paint(sprite: Sprite, id: number, rp: number, m: Orientation, portrait: boolean) {
    const { image } = sprite;
    const data = image.data;
    const size = image.width;
    const c = size / 2;
    const base = BALL_COLORS[id] as readonly [number, number, number];
    const stripe = id >= 9;
    const cue = id === 0;
    const tex = this.digits[id] ?? null;
    // Screen normal (x, y down) → table normal.
    const a = portrait ? 0 : 1;
    const b = portrait ? -1 : 0;
    const cc = portrait ? -1 : 0;
    const d = portrait ? 0 : -1;
    const m0 = m[0] as number, m1 = m[1] as number, m2 = m[2] as number;
    const m3 = m[3] as number, m4 = m[4] as number, m5 = m[5] as number;
    const m6 = m[6] as number, m7 = m[7] as number, m8 = m[8] as number;
    const inv = 1 / rp;
    const edgeLimit = (1 + inv) * (1 + inv);
    for (let py = 0; py < size; py++) {
      const sy = (py + 0.5 - c) * inv;
      for (let px = 0; px < size; px++) {
        const o = (py * size + px) * 4;
        const sx = (px + 0.5 - c) * inv;
        const d2 = sx * sx + sy * sy;
        if (d2 >= edgeLimit) {
          data[o + 3] = 0;
          continue;
        }
        const dist = Math.sqrt(d2);
        const cover = Math.min(1, Math.max(0, (1 - dist) * rp + 0.5));
        let nx = sx;
        let ny = sy;
        let nz = 0;
        if (d2 < 1) nz = Math.sqrt(1 - d2);
        else {
          nx = sx / dist;
          ny = sy / dist;
        }
        const tx = a * nx + b * ny;
        const ty = cc * nx + d * ny;
        const lx = m0 * tx + m3 * ty + m6 * nz;
        const ly = m1 * tx + m4 * ty + m7 * nz;
        const lz = m2 * tx + m5 * ty + m8 * nz;

        let r0 = base[0];
        let g0 = base[1];
        let b0 = base[2];
        if (cue) {
          if (Math.abs(lz) > 0.985) {
            r0 = 205;
            g0 = 38;
            b0 = 44;
          }
        } else {
          const inBand = !stripe || Math.abs(lx) < STRIPE;
          if (!inBand) {
            r0 = 246;
            g0 = 243;
            b0 = 234;
          }
          const az = Math.abs(lz);
          if (az > COS_DECAL && tex) {
            const u = ((lz > 0 ? lx : -lx) / SIN_DECAL + 1) * 0.5;
            const w = (ly / SIN_DECAL + 1) * 0.5;
            const tu = Math.min(TEX - 1, Math.max(0, Math.floor(u * TEX)));
            const tv = Math.min(TEX - 1, Math.max(0, Math.floor((1 - w) * TEX)));
            const ink = (tex[tv * TEX + tu] as number) / 255; // 1 = white disc, 0 = digit
            // Soft edge of the disc.
            const e = Math.min(1, (az - COS_DECAL) * 60);
            const wr = 246 * ink + 22 * (1 - ink);
            const wg = 243 * ink + 20 * (1 - ink);
            const wb = 234 * ink + 24 * (1 - ink);
            r0 = r0 * (1 - e) + wr * e;
            g0 = g0 * (1 - e) + wg * e;
            b0 = b0 * (1 - e) + wb * e;
          }
        }

        const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
        const nh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
        const nh2 = Math.max(0, nx * H2[0] + ny * H2[1] + nz * H2[2]);
        const spec = Math.pow(nh, 80) * 1.15 + Math.pow(nh, 14) * 0.1 + Math.pow(nh2, 60) * 0.25;
        const light = 0.3 + 0.82 * diff;
        const rim = Math.pow(1 - nz, 3) * 0.4;
        let rr = r0 * light;
        let gg = g0 * light;
        let bb = b0 * light;
        rr = rr * (1 - rim) + 40 * rim;
        gg = gg * (1 - rim) + 120 * rim;
        bb = bb * (1 - rim) + 80 * rim;
        rr += 255 * spec;
        gg += 255 * spec;
        bb += 250 * spec;
        data[o] = rr > 255 ? 255 : rr;
        data[o + 1] = gg > 255 ? 255 : gg;
        data[o + 2] = bb > 255 ? 255 : bb;
        data[o + 3] = cover * 255;
      }
    }
    sprite.canvas.getContext("2d")?.putImageData(image, 0, 0);
  }
}

/** The white number disc for ball `id` as a luminance mask (255 disc, 0 digit or outside-irrelevant). */
function makeDigit(id: number): Uint8ClampedArray | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = TEX;
  c.height = TEX;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, TEX, TEX);
  g.fillStyle = "#000";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const text = String(id);
  g.font = `800 ${text.length > 1 ? 30 : 36}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  g.fillText(text, TEX / 2, TEX / 2 + 2);
  if (id === 6 || id === 9) {
    // Underline to tell 6 from 9 once they roll.
    g.fillRect(TEX / 2 - 7, TEX / 2 + 17, 14, 3);
  }
  const img = g.getImageData(0, 0, TEX, TEX).data;
  const out = new Uint8ClampedArray(TEX * TEX);
  for (let i = 0; i < TEX * TEX; i++) out[i] = img[i * 4] as number;
  return out;
}

/* ------------------------------------------------------------------------ */
/* Cue stick                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Draws the cue behind the ball at (bx, by) CSS px, pointing along screen
 * angle `angle` (the direction the ball will go), `gap` CSS px back from the ball.
 */
export function drawCue(ctx: CanvasRenderingContext2D, v: View, bx: number, by: number, angle: number, gap: number, alpha = 1): void {
  const s = v.s;
  const len = 1.42 * s;
  const tipW = Math.max(2.4, 0.0125 * s);
  const buttW = Math.max(5, 0.03 * s);
  const start = R * s + 2 + gap;
  const w = (t: number) => tipW + (buttW - tipW) * (t / len);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(bx, by);
  ctx.rotate(angle + Math.PI);
  ctx.translate(start, 0);

  const body = () => {
    ctx.beginPath();
    ctx.moveTo(0, -tipW / 2);
    ctx.lineTo(len, -buttW / 2);
    ctx.arc(len, 0, buttW / 2, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(0, tipW / 2);
    ctx.closePath();
  };

  // Shadow on the cloth.
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / 0.45)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 7;
  body();
  ctx.fillStyle = "#d9b77a";
  ctx.fill();
  ctx.restore();

  const band = (from: number, to: number, fill: string | CanvasGradient) => {
    const a = from * s;
    const b = Math.min(len, to * s);
    ctx.beginPath();
    ctx.moveTo(a, -w(a) / 2);
    ctx.lineTo(b, -w(b) / 2);
    ctx.lineTo(b, w(b) / 2);
    ctx.lineTo(a, w(a) / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const shaft = ctx.createLinearGradient(0, 0, 0.72 * s, 0);
  shaft.addColorStop(0, "#f6e6c2");
  shaft.addColorStop(1, "#dcb679");
  band(0, 0.011, "#3f6fd6"); // chalked tip
  band(0.011, 0.034, "#f4f0e6"); // ferrule
  band(0.034, 0.72, shaft);
  band(0.72, 0.735, "#c9ced6"); // joint
  band(0.735, 1.06, "#2a140a"); // forearm
  // Inlaid points in the forearm.
  ctx.fillStyle = "#e7c98f";
  for (const side of [-1, 1]) {
    const a = 0.74 * s;
    const b = 0.93 * s;
    ctx.beginPath();
    ctx.moveTo(a, (side * w(a)) / 2);
    ctx.lineTo(b, side * 0.6);
    ctx.lineTo(a, (side * w(a)) / 6);
    ctx.closePath();
    ctx.fill();
  }
  band(1.06, 1.08, "#c9ced6");
  band(1.08, 1.3, "#141414"); // wrap
  ctx.strokeStyle = "rgb(255 255 255 / 0.06)";
  ctx.lineWidth = 1;
  for (let k = 1.09; k < 1.3; k += 0.012) {
    ctx.beginPath();
    ctx.moveTo(k * s, -w(k * s) / 2);
    ctx.lineTo(k * s + 2, w(k * s) / 2);
    ctx.stroke();
  }
  band(1.3, 1.42, "#2a140a"); // butt sleeve
  band(1.38, 1.39, "#c9ced6");
  // Round lighting across the cue.
  const across = ctx.createLinearGradient(0, -buttW / 2, 0, buttW / 2);
  across.addColorStop(0, "rgb(255 255 255 / 0.45)");
  across.addColorStop(0.35, "rgb(255 255 255 / 0.05)");
  across.addColorStop(1, "rgb(0 0 0 / 0.35)");
  body();
  ctx.fillStyle = across;
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------------ */
/* Guides & markers                                                         */
/* ------------------------------------------------------------------------ */

export function line(ctx: CanvasRenderingContext2D, a: Vec, b: Vec, style: string, width: number, dash: number[] = []): void {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

export function arrowHead(ctx: CanvasRenderingContext2D, at: Vec, dir: Vec, size: number, style: string): void {
  const m = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / m;
  const uy = dir.y / m;
  ctx.save();
  ctx.fillStyle = style;
  ctx.beginPath();
  ctx.moveTo(at.x + ux * size, at.y + uy * size);
  ctx.lineTo(at.x - uy * size * 0.6, at.y + ux * size * 0.6);
  ctx.lineTo(at.x + uy * size * 0.6, at.y - ux * size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function ring(ctx: CanvasRenderingContext2D, c: Vec, r: number, style: string, width: number, fill?: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}
