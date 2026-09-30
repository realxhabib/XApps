/**
 * Procedural textures (canvas, no assets): container corrugation,
 * weathered concrete, planks, brushed metal, the yard's ground with slab
 * seams, painted lines, baked contact shadows (and sun shadows when the
 * tier has no shadow map), plus the soft sprites for flashes, smoke, sparks
 * and bullet holes.
 */

import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { MapDef } from "./map";
import type { Box } from "./physics";

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function finish(c: HTMLCanvasElement, repeat = true, srgb = true): Texture {
  const t = new CanvasTexture(c);
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  } else {
    t.wrapS = ClampToEdgeWrapping;
    t.wrapT = ClampToEdgeWrapping;
  }
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Speckle noise over a base gray. */
function grain(ctx: CanvasRenderingContext2D, w: number, h: number, r: () => number, amount: number, count: number) {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(128 + (r() - 0.5) * 255 * amount);
    ctx.fillStyle = `rgba(${v},${v},${v},${0.08 + r() * 0.12})`;
    const s = 1 + r() * 2.5;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

/** Grayscale corrugation (tinted by vertex color): one texture repeat = 1 m. */
export function containerTexture(): Texture {
  const [c, ctx] = canvas(128);
  const r = rng(7);
  ctx.fillStyle = "#d8d8d8";
  ctx.fillRect(0, 0, 128, 128);
  // Ribs every 1/4 m: light crest, dark trough.
  for (let i = 0; i < 4; i++) {
    const x = i * 32;
    const g = ctx.createLinearGradient(x, 0, x + 32, 0);
    g.addColorStop(0, "#9a9a9a");
    g.addColorStop(0.25, "#f2f2f2");
    g.addColorStop(0.55, "#dadada");
    g.addColorStop(0.8, "#a8a8a8");
    g.addColorStop(1, "#9a9a9a");
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 32, 128);
  }
  // Rust streaks and scuffs.
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(90,50,30,${0.05 + r() * 0.1})`;
    ctx.fillRect(r() * 128, r() * 128, 1 + r() * 3, 8 + r() * 40);
  }
  grain(ctx, 128, 128, r, 0.6, 500);
  return finish(c);
}

/** Weathered concrete, 1 repeat = 2 m. */
export function concreteTexture(): Texture {
  const [c, ctx] = canvas(256);
  const r = rng(11);
  ctx.fillStyle = "#d0d0d0";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 10 + r() * 40);
    const v = r() < 0.5 ? "90,90,90" : "250,250,250";
    g.addColorStop(0, `rgba(${v},${0.06 + r() * 0.08})`);
    g.addColorStop(1, `rgba(${v},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  grain(ctx, 256, 256, r, 0.7, 2600);
  // Form-tie holes and a horizontal pour line.
  ctx.fillStyle = "rgba(60,60,60,0.35)";
  for (const [x, y] of [
    [40, 60],
    [168, 60],
    [40, 188],
    [168, 188],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(80,80,80,0.18)";
  ctx.fillRect(0, 127, 256, 2);
  return finish(c);
}

/** Planks, 1 repeat = 1 m. */
export function woodTexture(): Texture {
  const [c, ctx] = canvas(128);
  const r = rng(3);
  for (let i = 0; i < 6; i++) {
    const v = 190 + Math.floor(r() * 40);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(0, i * 21.33, 128, 21.33);
    ctx.fillStyle = "rgba(40,40,40,0.35)";
    ctx.fillRect(0, i * 21.33, 128, 1.5);
    for (let k = 0; k < 10; k++) {
      ctx.fillStyle = `rgba(80,80,80,${0.05 + r() * 0.08})`;
      ctx.fillRect(r() * 128, i * 21.33 + r() * 20, 20 + r() * 50, 1);
    }
  }
  ctx.strokeStyle = "rgba(50,50,50,0.4)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 125, 125);
  return finish(c);
}

/** Painted metal with scratches, 1 repeat = 1 m. */
export function metalTexture(): Texture {
  const [c, ctx] = canvas(128);
  const r = rng(5);
  ctx.fillStyle = "#e0e0e0";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(${r() < 0.5 ? "255,255,255" : "70,70,70"},${0.08 + r() * 0.1})`;
    ctx.beginPath();
    const x = r() * 128;
    const y = r() * 128;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 6);
    ctx.stroke();
  }
  grain(ctx, 128, 128, r, 0.4, 400);
  return finish(c);
}

/**
 * The whole yard floor as one texture: sun-bleached concrete slabs with
 * seams, oil stains, painted lane lines and bay numbers, and baked contact
 * shadows around everything standing on it (plus sun shadows when there is
 * no real shadow map).
 */
export function groundTexture(map: MapDef, pxPerM: number, sunShadows: boolean): Texture {
  const { bounds } = map;
  const W = bounds.x1 - bounds.x0;
  const H = bounds.z1 - bounds.z0;
  const [c, ctx] = canvas(Math.round(W * pxPerM), Math.round(H * pxPerM));
  const r = rng(21);
  const X = (x: number) => (x - bounds.x0) * pxPerM;
  const Z = (z: number) => (z - bounds.z0) * pxPerM;
  ctx.fillStyle = "#cbbfa8";
  ctx.fillRect(0, 0, c.width, c.height);
  // Slabs (4 m), each a slightly different shade.
  for (let x = bounds.x0; x < bounds.x1; x += 4) {
    for (let z = bounds.z0; z < bounds.z1; z += 4) {
      const v = Math.floor((r() - 0.5) * 16);
      ctx.fillStyle = `rgba(${v > 0 ? "255,250,240" : "80,70,60"},${Math.abs(v) / 90})`;
      ctx.fillRect(X(x), Z(z), 4 * pxPerM, 4 * pxPerM);
    }
  }
  // Grain.
  const specks = Math.round(W * H * 6);
  for (let i = 0; i < specks; i++) {
    const v = Math.floor(100 + r() * 120);
    ctx.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.12 + r() * 0.15})`;
    const s = Math.max(1, pxPerM * (0.03 + r() * 0.05));
    ctx.fillRect(r() * c.width, r() * c.height, s, s);
  }
  // Stains.
  for (let i = 0; i < 40; i++) {
    const x = r() * c.width;
    const y = r() * c.height;
    const rad = pxPerM * (0.6 + r() * 2.5);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(60,50,40,${0.12 + r() * 0.15})`);
    g.addColorStop(1, "rgba(60,50,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Seams.
  ctx.strokeStyle = "rgba(70,62,52,0.45)";
  ctx.lineWidth = Math.max(1, pxPerM * 0.04);
  ctx.beginPath();
  for (let x = bounds.x0; x <= bounds.x1; x += 4) {
    ctx.moveTo(X(x), 0);
    ctx.lineTo(X(x), c.height);
  }
  for (let z = bounds.z0; z <= bounds.z1; z += 4) {
    ctx.moveTo(0, Z(z));
    ctx.lineTo(c.width, Z(z));
  }
  ctx.stroke();
  // Painted lane lines (faded yellow) along the east lanes and around the yards.
  ctx.strokeStyle = "rgba(226,178,60,0.55)";
  ctx.lineWidth = pxPerM * 0.14;
  ctx.setLineDash([pxPerM * 2, pxPerM * 1.2]);
  ctx.beginPath();
  for (const x of [19.5, 26.5, 33.2]) {
    ctx.moveTo(X(x), Z(-28));
    ctx.lineTo(X(x), Z(28));
  }
  ctx.moveTo(X(-34), Z(-17));
  ctx.lineTo(X(12), Z(-17));
  ctx.moveTo(X(-16), Z(17.5));
  ctx.lineTo(X(34), Z(17.5));
  ctx.stroke();
  ctx.setLineDash([]);
  // Hatched loading zones.
  ctx.fillStyle = "rgba(226,178,60,0.35)";
  for (const [x0, z0] of [
    [-2, -3],
    [-30, -26],
    [26, 23],
  ] as const) {
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.translate(X(x0 + i * 0.8), Z(z0));
      ctx.rotate(-0.6);
      ctx.fillRect(0, 0, pxPerM * 0.25, pxPerM * 3.2);
      ctx.restore();
    }
  }
  // Bay numbers.
  ctx.fillStyle = "rgba(250,245,235,0.55)";
  ctx.font = `800 ${Math.round(pxPerM * 1.6)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  const bays: [string, number, number][] = [
    ["A1", 19.5, -24],
    ["B2", 26.5, 20],
    ["C3", 33.2, -24],
    ["07", -12, -23.5],
    ["12", 12, 23.5],
  ];
  for (const [t, x, z] of bays) ctx.fillText(t, X(x), Z(z));

  // Baked shadows: blurred contact darkening around each footprint, and the sun's cast shadow.
  const grounded = map.boxes.filter((b) => !b.ghost && b.y0 < 0.05 && b.y1 > 0.3);
  const [sx, sy, sz] = map.sun;
  const k = 1 / sy;
  const shadowLayer = (fill: (sctx: CanvasRenderingContext2D, b: Box) => void, blur: number, alpha: number) => {
    const [sc, sctx] = canvas(c.width, c.height);
    sctx.fillStyle = "#000";
    for (const b of grounded) fill(sctx, b);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.filter = `blur(${Math.max(1, blur * pxPerM)}px)`;
    ctx.drawImage(sc, 0, 0);
    ctx.restore();
  };
  // Contact (ambient occlusion): a slightly grown footprint.
  shadowLayer((sctx, b) => sctx.fillRect(X(b.x0 - 0.25), Z(b.z0 - 0.25), (b.x1 - b.x0 + 0.5) * pxPerM, (b.z1 - b.z0 + 0.5) * pxPerM), 0.45, 0.32);
  if (sunShadows) {
    // Hull of the footprint and its projection away from the sun.
    shadowLayer(
      (sctx, b) => {
        const h = Math.min(b.y1, 12);
        const ox = -sx * k * h;
        const oz = -sz * k * h;
        const pts = [
          [b.x0, b.z0],
          [b.x1, b.z0],
          [b.x1, b.z1],
          [b.x0, b.z1],
        ];
        const all = [...pts, ...pts.map(([x, z]) => [x! + ox, z! + oz])];
        const hull = convexHull(all as [number, number][]);
        sctx.beginPath();
        hull.forEach(([x, z], i) => (i ? sctx.lineTo(X(x), Z(z)) : sctx.moveTo(X(x), Z(z))));
        sctx.closePath();
        sctx.fill();
      },
      0.12,
      0.34,
    );
  }
  const t = finish(c, false);
  return t;
}

function convexHull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Soft round dot (blob shadows, sparks, smoke). */
export function softDot(inner = 0.1, color = "255,255,255"): Texture {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(inner, `rgba(${color},0.9)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c, false, false);
}

/** Four-pointed muzzle flash with a hot core. */
export function flashTexture(): Texture {
  const [c, ctx] = canvas(128);
  ctx.translate(64, 64);
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
  core.addColorStop(0, "rgba(255,255,235,1)");
  core.addColorStop(0.25, "rgba(255,214,120,0.95)");
  core.addColorStop(0.6, "rgba(255,140,40,0.4)");
  core.addColorStop(1, "rgba(255,120,20,0)");
  ctx.fillStyle = core;
  ctx.fillRect(-64, -64, 128, 128);
  for (let i = 0; i < 4; i++) {
    ctx.save();
    ctx.rotate((i * Math.PI) / 2 + 0.3);
    const g = ctx.createLinearGradient(0, 0, 60, 0);
    g.addColorStop(0, "rgba(255,240,190,0.95)");
    g.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(62, 0);
    ctx.lineTo(0, 7);
    ctx.fill();
    ctx.restore();
  }
  return finish(c, false, false);
}

/** A bullet hole: dark core, scorched ring, a few chips. */
export function holeTexture(): Texture {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, "rgba(10,8,6,1)");
  g.addColorStop(0.18, "rgba(20,16,12,0.95)");
  g.addColorStop(0.35, "rgba(60,50,40,0.55)");
  g.addColorStop(1, "rgba(60,50,40,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const r = rng(9);
  ctx.strokeStyle = "rgba(20,16,12,0.6)";
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
    ctx.lineTo(32 + Math.cos(a) * (10 + r() * 10), 32 + Math.sin(a) * (10 + r() * 10));
    ctx.stroke();
  }
  return finish(c, false, false);
}

/** Tracer streak: bright core along x, fading at both ends. */
export function streakTexture(): Texture {
  const [c, ctx] = canvas(64, 16);
  const g = ctx.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, "rgba(255,200,120,0)");
  g.addColorStop(0.7, "rgba(255,230,170,0.9)");
  g.addColorStop(1, "rgba(255,255,230,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 16);
  const v = ctx.createLinearGradient(0, 0, 0, 16);
  v.addColorStop(0, "rgba(0,0,0,1)");
  v.addColorStop(0.5, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 64, 16);
  return finish(c, false, false);
}
