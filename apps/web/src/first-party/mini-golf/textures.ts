/**
 * Procedural textures, painted on 2D canvases (no image assets): the turf of
 * each hole with its mowing stripes, sand, water basins, boost pads, the cup
 * and tee mat all painted in exact shapes; plus tiling rough grass, sails,
 * planks, ripples and a soft dot for shadows and particles.
 */

import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { CompiledHole } from "./compile";
import type { Shape } from "./course";
import { CUP_R } from "./physics";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

/** Small deterministic RNG (mulberry32) so textures look the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toTexture(c: HTMLCanvasElement, opts: { repeat?: boolean; srgb?: boolean; anisotropy?: number } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = opts.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = opts.anisotropy ?? 4;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* Turf                                                               */
/* ------------------------------------------------------------------ */

export const TURF = {
  light: "#58c35d",
  dark: "#47b04e",
  edge: "#3a9a42",
};

export function turfPixelsPerUnit(c: CompiledHole): number {
  return Math.max(24, Math.min(64, Math.floor(2048 / Math.max(c.maxX - c.minX, c.maxY - c.minY))));
}

/** The painted floor of a hole: UV (0,0) is (minX, minY), (1,1) is (maxX, maxY). */
export function paintTurf(c: CompiledHole, anisotropy: number): Texture {
  const ppu = turfPixelsPerUnit(c);
  const W = c.maxX - c.minX;
  const H = c.maxY - c.minY;
  const [cv, ctx] = canvas(Math.ceil(W * ppu), Math.ceil(H * ppu));
  const px = (x: number) => (x - c.minX) * ppu;
  const py = (y: number) => (c.maxY - y) * ppu;
  const rand = rng(c.hole.number * 7919);
  const hole = c.hole;

  // Mowing stripes, one unit wide, across the direction of play.
  for (let y = Math.floor(c.minY); y < c.maxY; y++) {
    ctx.fillStyle = (y & 1) === 0 ? TURF.light : TURF.dark;
    ctx.fillRect(0, py(y + 1), cv.width, ppu + 1);
  }
  // Soft diagonal cross-cut for depth.
  ctx.globalAlpha = 0.05;
  ctx.fillStyle = "#ffffff";
  for (let k = -H; k < W + H; k += 2) {
    ctx.beginPath();
    ctx.moveTo(px(c.minX + k), py(c.minY));
    ctx.lineTo(px(c.minX + k + 1), py(c.minY));
    ctx.lineTo(px(c.minX + k + 1 + H), py(c.maxY));
    ctx.lineTo(px(c.minX + k + H), py(c.maxY));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, cv.width, cv.height, rand, W * H * 90, ["#2f8f3a", "#6fd36f", "#3fa647", "#7ee07a"], 0.35, 1.4);

  // Shade along the walls (ambient occlusion).
  for (const e of c.edges) {
    const len = Math.hypot(e.bx - e.ax, e.by - e.ay);
    const depth = 0.4;
    const x0 = px(e.ax);
    const y0 = py(e.ay);
    const gx = -e.nx * depth * ppu;
    const gy = e.ny * depth * ppu;
    const grad = ctx.createLinearGradient(x0, y0, x0 + gx, y0 + gy);
    grad.addColorStop(0, "rgba(10,40,10,0.42)");
    grad.addColorStop(1, "rgba(10,40,10,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    const dx = ((e.bx - e.ax) / len) * len * ppu;
    const dy = (-(e.by - e.ay) / len) * len * ppu;
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + dx, y0 + dy);
    ctx.lineTo(x0 + dx + gx, y0 + dy + gy);
    ctx.lineTo(x0 + gx, y0 + gy);
    ctx.fill();
  }
  // Blocks cast a little contact shadow too.
  for (const b of c.blocks) {
    ctx.beginPath();
    b.points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.closePath();
    ctx.lineWidth = 0.35 * ppu;
    ctx.strokeStyle = "rgba(10,40,10,0.25)";
    ctx.stroke();
  }

  const shapePath = (s: Shape, grow = 0) => {
    ctx.beginPath();
    if (s.kind === "circle") ctx.arc(px(s.x), py(s.y), (s.r + grow) * ppu, 0, Math.PI * 2);
    else if (s.kind === "ellipse") ctx.ellipse(px(s.x), py(s.y), (s.rx + grow) * ppu, (s.ry + grow) * ppu, 0, 0, Math.PI * 2);
    else roundRect(ctx, px(s.x0 - grow), py(s.y1 + grow), (s.x1 - s.x0 + grow * 2) * ppu, (s.y1 - s.y0 + grow * 2) * ppu, 0.12 * ppu);
  };

  for (const s of hole.surfaces ?? []) {
    if (s.type === "sand") {
      // Lip of the bunker.
      shapePath(s.shape, 0.07);
      ctx.fillStyle = "#3c8f3c";
      ctx.fill();
      shapePath(s.shape);
      ctx.save();
      ctx.clip();
      const bb = shapeBounds(s.shape);
      const g = ctx.createRadialGradient(px(bb.cx), py(bb.cy), 0, px(bb.cx), py(bb.cy), bb.r * ppu);
      g.addColorStop(0, "#f5e2a8");
      g.addColorStop(0.75, "#ecd18c");
      g.addColorStop(1, "#c9a863");
      ctx.fillStyle = g;
      ctx.fillRect(px(bb.cx - bb.r), py(bb.cy + bb.r), bb.r * 2 * ppu, bb.r * 2 * ppu);
      speckle(ctx, cv.width, cv.height, rand, bb.r * bb.r * 900, ["#b8955a", "#fff4cf", "#d9bb78"], 0.6, 1.2);
      // Raked lines.
      ctx.strokeStyle = "rgba(160,120,60,0.18)";
      ctx.lineWidth = 1.2;
      for (let k = -bb.r; k < bb.r; k += 0.12) {
        ctx.beginPath();
        ctx.moveTo(px(bb.cx - bb.r), py(bb.cy + k));
        ctx.bezierCurveTo(px(bb.cx - bb.r / 3), py(bb.cy + k + 0.05), px(bb.cx + bb.r / 3), py(bb.cy + k - 0.05), px(bb.cx + bb.r), py(bb.cy + k));
        ctx.stroke();
      }
      ctx.restore();
    } else if (s.type === "water") {
      // Stone rim, then the deep basin.
      shapePath(s.shape, 0.09);
      ctx.fillStyle = "#cdd6c4";
      ctx.fill();
      shapePath(s.shape);
      ctx.save();
      ctx.clip();
      const bb = shapeBounds(s.shape);
      const g = ctx.createRadialGradient(px(bb.cx), py(bb.cy), 0, px(bb.cx), py(bb.cy), bb.r * ppu);
      g.addColorStop(0, "#0b4661");
      g.addColorStop(0.7, "#136b85");
      g.addColorStop(1, "#2a9bb3");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cv.width, cv.height);
      speckle(ctx, cv.width, cv.height, rand, bb.r * bb.r * 200, ["#0a3a52", "#1d7f99"], 0.5, 2.5);
      ctx.restore();
    } else if (s.type === "boost") {
      shapePath(s.shape, 0.06);
      ctx.fillStyle = "#1c2233";
      ctx.fill();
      shapePath(s.shape);
      ctx.fillStyle = "#2a3350";
      ctx.fill();
    }
  }

  // Tee mat.
  const tee = hole.tee;
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, px(tee.x - 0.62), py(tee.y + 0.42), 1.24 * ppu, 0.9 * ppu, 0.12 * ppu);
  ctx.fill();
  ctx.fillStyle = "#256d34";
  roundRect(ctx, px(tee.x - 0.58), py(tee.y + 0.4), 1.16 * ppu, 0.8 * ppu, 0.1 * ppu);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 0.035 * ppu;
  roundRect(ctx, px(tee.x - 0.5), py(tee.y + 0.32), 1 * ppu, 0.64 * ppu, 0.07 * ppu);
  ctx.stroke();

  // Tube mouths.
  for (const t of hole.tubes ?? []) {
    for (const [p, dark] of [
      [t.from, true],
      [t.to, false],
    ] as const) {
      const g = ctx.createRadialGradient(px(p.x), py(p.y), 0, px(p.x), py(p.y), 0.42 * ppu);
      g.addColorStop(0, dark ? "#05070c" : "rgba(0,0,0,0.25)");
      g.addColorStop(dark ? 0.7 : 0.5, dark ? "#101522" : "rgba(0,0,0,0.12)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 0.42 * ppu, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The cup: a shadowed hole with a white liner lip.
  const cup = hole.cup;
  const cx = px(cup.x);
  const cy = py(cup.y);
  const halo = ctx.createRadialGradient(cx, cy, CUP_R * ppu, cx, cy, (CUP_R + 0.2) * ppu);
  halo.addColorStop(0, "rgba(0,30,0,0.35)");
  halo.addColorStop(1, "rgba(0,30,0,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, (CUP_R + 0.2) * ppu, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f6f6f2";
  ctx.beginPath();
  ctx.arc(cx, cy, (CUP_R + 0.02) * ppu, 0, Math.PI * 2);
  ctx.fill();
  const inner = ctx.createRadialGradient(cx - 0.05 * ppu, cy - 0.07 * ppu, 0, cx, cy, CUP_R * ppu);
  inner.addColorStop(0, "#050505");
  inner.addColorStop(0.65, "#101010");
  inner.addColorStop(1, "#3a3a3a");
  ctx.fillStyle = inner;
  ctx.beginPath();
  ctx.arc(cx, cy, (CUP_R - 0.03) * ppu, 0, Math.PI * 2);
  ctx.fill();

  return toTexture(cv, { anisotropy });
}

function shapeBounds(s: Shape): { cx: number; cy: number; r: number } {
  if (s.kind === "circle") return { cx: s.x, cy: s.y, r: s.r };
  if (s.kind === "ellipse") return { cx: s.x, cy: s.y, r: Math.max(s.rx, s.ry) };
  return { cx: (s.x0 + s.x1) / 2, cy: (s.y0 + s.y1) / 2, r: Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / 2 };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Random tiny dots within the current clip. */
function speckle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rand: () => number,
  count: number,
  colors: string[],
  alpha: number,
  size: number,
): void {
  if (!colors.length) return;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)]!;
    const s = size * (0.5 + rand());
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* Tiles and props                                                    */
/* ------------------------------------------------------------------ */

/** Rough grass around the course (tiles). */
export function paintRough(anisotropy: number): Texture {
  const [cv, ctx] = canvas(256, 256);
  ctx.fillStyle = "#2f7a35";
  ctx.fillRect(0, 0, 256, 256);
  const rand = rng(42);
  for (let i = 0; i < 60; i++) {
    const g = ctx.createRadialGradient(rand() * 256, rand() * 256, 0, rand() * 256, rand() * 256, 30 + rand() * 50);
    g.addColorStop(0, rand() > 0.5 ? "rgba(70,140,60,0.25)" : "rgba(20,70,30,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < 2600; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    ctx.strokeStyle = ["#3d8f3f", "#236a2c", "#4ea24a", "#1d5c27"][Math.floor(rand() * 4)]!;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 3, y - 2 - rand() * 4);
    ctx.stroke();
  }
  return toTexture(cv, { repeat: true, anisotropy });
}

/** A windmill sail: a red frame with white lattice cloth. */
export function paintSail(): Texture {
  const [cv, ctx] = canvas(64, 256);
  ctx.fillStyle = "#fbf5ea";
  ctx.fillRect(0, 0, 64, 256);
  ctx.strokeStyle = "#c9342b";
  ctx.lineWidth = 3;
  for (let y = 16; y < 256; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(64, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(32, 0);
  ctx.lineTo(32, 256);
  ctx.stroke();
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 56, 248);
  return toTexture(cv);
}

/** Wooden planks (ramp deck). */
export function paintPlanks(): Texture {
  const [cv, ctx] = canvas(256, 256);
  const rand = rng(7);
  for (let i = 0; i < 8; i++) {
    const shade = 150 + Math.floor(rand() * 40);
    ctx.fillStyle = `rgb(${shade + 40},${shade - 20},${shade - 80})`;
    ctx.fillRect(0, i * 32, 256, 32);
    ctx.strokeStyle = "rgba(60,30,10,0.35)";
    for (let k = 0; k < 6; k++) {
      ctx.beginPath();
      const y = i * 32 + 4 + rand() * 24;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + rand() * 4 - 2, 170, y + rand() * 4 - 2, 256, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(40,20,5,0.6)";
    ctx.fillRect(0, i * 32 + 30, 256, 2);
    ctx.beginPath();
    ctx.arc(20, i * 32 + 16, 2, 0, Math.PI * 2);
    ctx.arc(236, i * 32 + 16, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(cv, { repeat: true });
}

/** Moving light lines on water (tiles, transparent). */
export function paintRipples(): Texture {
  const [cv, ctx] = canvas(256, 256);
  const rand = rng(99);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineCap = "round";
  for (let i = 0; i < 26; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const w = 14 + rand() * 30;
    ctx.lineWidth = 1 + rand() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + w / 2, y - 4, x + w, y);
    ctx.stroke();
  }
  return toTexture(cv, { repeat: true });
}

/** Glowing chevrons for boost pads (tiles along V). */
export function paintChevrons(): Texture {
  const [cv, ctx] = canvas(128, 128);
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = "#ffd23d";
  ctx.shadowColor = "#ffea8a";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(20, 96);
  ctx.lineTo(64, 40);
  ctx.lineTo(108, 96);
  ctx.lineTo(88, 96);
  ctx.lineTo(64, 66);
  ctx.lineTo(40, 96);
  ctx.closePath();
  ctx.fill();
  return toTexture(cv, { repeat: true });
}

/** Warning stripes for sliders. */
export function paintStripes(): Texture {
  const [cv, ctx] = canvas(128, 128);
  ctx.fillStyle = "#1d1f26";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = "#ffcc2e";
  for (let k = -128; k < 256; k += 40) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + 20, 0);
    ctx.lineTo(k + 20 + 128, 128);
    ctx.lineTo(k + 128, 128);
    ctx.fill();
  }
  return toTexture(cv, { repeat: true });
}

/** A ball: its color with a white band, so you can see it roll. */
export function paintBall(color: string): Texture {
  const [cv, ctx] = canvas(128, 64);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 64);
  const white = color.toLowerCase() === "#ffffff";
  ctx.fillStyle = white ? "#ff4d6d" : "#ffffff";
  ctx.fillRect(0, 28, 128, 8);
  ctx.fillStyle = white ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.15)";
  for (let i = 0; i < 90; i++) {
    ctx.beginPath();
    ctx.arc((i * 37) % 128, ((i * 53) % 60) + 2, 1.3, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(cv);
}

/** Soft round dot (shadows, dust, sparkles). Linear, not sRGB: it's an alpha mask. */
export function paintDot(): Texture {
  const [cv, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.6)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(cv, { srgb: false });
}

/** Sky: a vertical gradient for the scene background. */
export function paintSky(): Texture {
  const [cv, ctx] = canvas(4, 256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#6fb7ff");
  g.addColorStop(0.55, "#bfe3ff");
  g.addColorStop(1, "#fff1d6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  return toTexture(cv);
}

/** Flag cloth with the hole number. */
export function paintFlag(accent: string, n: number): Texture {
  const [cv, ctx] = canvas(128, 80);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 128, 80);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(0, 0, 128, 10);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 50px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(n), 64, 44);
  return toTexture(cv);
}

