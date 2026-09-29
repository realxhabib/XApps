/**
 * Every texture in the game is drawn here, on canvases, at startup — no
 * image downloads. Albedo maps are sRGB; normal/roughness maps are linear.
 * Each generator is memoized (one GPU texture shared by every mesh).
 */

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "three";
import { ARENA } from "./logic";

type Ctx = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h = w): { c: HTMLCanvasElement; ctx: Ctx } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D canvas unavailable");
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement, opts: { srgb?: boolean; repeat?: boolean; aniso?: number } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = opts.srgb ? SRGBColorSpace : NoColorSpace;
  t.wrapS = t.wrapT = opts.repeat ? RepeatWrapping : ClampToEdgeWrapping;
  t.anisotropy = opts.aniso ?? 8;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Height field (0..1 per pixel) → tangent-space normal map canvas. */
function heightToNormal(height: Float32Array, w: number, h: number, strength: number, wrap = true): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
    }
    return height[y * w + x]!;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Reads a canvas' red channel as a 0..1 height field. */
function readHeight(ctx: Ctx, w: number, h: number): Float32Array {
  const data = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = data[i * 4]! / 255;
  return out;
}

const memo = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}

/* ---------------------------------------------------------------------- */
/* Brushed stainless (trucks)                                             */
/* ---------------------------------------------------------------------- */

/** Brushed-steel normal + roughness: long horizontal grain with a few scuffs. */
export function brushedSteel(): { normal: Texture; roughness: Texture } {
  return once("brushed", () => {
    const S = 512;
    const r = rng(7);
    // Height: per-row grain, smeared along x.
    const { ctx: hctx } = canvas(S);
    const img = hctx.createImageData(S, S);
    const rows = new Float32Array(S);
    for (let y = 0; y < S; y++) rows[y] = r();
    for (let y = 0; y < S; y++) {
      let v = rows[y]!;
      for (let x = 0; x < S; x++) {
        v += (r() - 0.5) * 0.08;
        v = v * 0.97 + rows[y]! * 0.03;
        const g = Math.max(0, Math.min(255, v * 255));
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
        img.data[i + 3] = 255;
      }
    }
    hctx.putImageData(img, 0, 0);
    const normal = toTexture(heightToNormal(readHeight(hctx, S, S), S, S, 1.2), { repeat: true });

    const { c: rc, ctx: rctx } = canvas(S);
    // Roughness: base 0.34 with grain variation and a few polished/scuffed patches.
    const rimg = rctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const g = 0.4 + rows[y]! * 0.12 + (r() - 0.5) * 0.04;
        const i = (y * S + x) * 4;
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = g * 255;
        rimg.data[i + 3] = 255;
      }
    }
    rctx.putImageData(rimg, 0, 0);
    rctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < 40; i++) {
      rctx.strokeStyle = `rgba(${r() < 0.5 ? 40 : 200},${r() < 0.5 ? 40 : 200},${r() < 0.5 ? 40 : 200},${0.15 + r() * 0.2})`;
      rctx.lineWidth = 0.5 + r() * 1.5;
      rctx.beginPath();
      const x = r() * S;
      const y = r() * S;
      rctx.moveTo(x, y);
      rctx.lineTo(x + (r() - 0.5) * 120, y + (r() - 0.5) * 30);
      rctx.stroke();
    }
    return { normal, roughness: toTexture(rc, { repeat: true }) };
  });
}

/* ---------------------------------------------------------------------- */
/* Arena floor                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Floor detail (repeats every 4 m): 2 m steel plates with beveled seams,
 * corner bolts, diamond tread on alternating plates and scratches.
 */
export function floorDetail(): { normal: Texture; roughness: Texture } {
  return once("floorDetail", () => {
    const S = 1024;
    const r = rng(11);
    const { ctx: h } = canvas(S);
    h.fillStyle = "rgb(128,128,128)";
    h.fillRect(0, 0, S, S);
    const plate = S / 2;
    for (let py = 0; py < 2; py++) {
      for (let px = 0; px < 2; px++) {
        const x0 = px * plate;
        const y0 = py * plate;
        // Diamond tread on the checkerboard plates.
        if ((px + py) % 2 === 0) {
          h.save();
          h.beginPath();
          h.rect(x0 + 10, y0 + 10, plate - 20, plate - 20);
          h.clip();
          h.fillStyle = "rgb(170,170,170)";
          const step = 26;
          for (let y = y0; y < y0 + plate + step; y += step) {
            for (let x = x0; x < x0 + plate + step; x += step) {
              const odd = Math.round((y - y0) / step) % 2;
              h.save();
              h.translate(x + (odd ? step / 2 : 0), y);
              h.rotate(odd ? 0.8 : -0.8);
              h.beginPath();
              h.ellipse(0, 0, 10, 2.6, 0, 0, Math.PI * 2);
              h.fill();
              h.restore();
            }
          }
          h.restore();
        }
        // Beveled seam: dark groove with a lighter lip.
        h.strokeStyle = "rgb(20,20,20)";
        h.lineWidth = 8;
        h.strokeRect(x0 + 2, y0 + 2, plate - 4, plate - 4);
        h.strokeStyle = "rgb(95,95,95)";
        h.lineWidth = 4;
        h.strokeRect(x0 + 8, y0 + 8, plate - 16, plate - 16);
        // Bolts.
        for (const [bx, by] of [
          [x0 + 26, y0 + 26],
          [x0 + plate - 26, y0 + 26],
          [x0 + 26, y0 + plate - 26],
          [x0 + plate - 26, y0 + plate - 26],
          [x0 + plate / 2, y0 + 26],
          [x0 + plate / 2, y0 + plate - 26],
        ] as const) {
          const g = h.createRadialGradient(bx - 2, by - 2, 1, bx, by, 9);
          g.addColorStop(0, "rgb(230,230,230)");
          g.addColorStop(1, "rgb(110,110,110)");
          h.fillStyle = g;
          h.beginPath();
          h.arc(bx, by, 9, 0, Math.PI * 2);
          h.fill();
        }
      }
    }
    // Gouges.
    for (let i = 0; i < 90; i++) {
      h.strokeStyle = `rgba(40,40,40,${0.25 + r() * 0.4})`;
      h.lineWidth = 1 + r() * 2;
      h.beginPath();
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      const l = 20 + r() * 140;
      h.moveTo(x, y);
      h.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      h.stroke();
    }
    const normal = toTexture(heightToNormal(readHeight(h, S, S), S, S, 2.2), { repeat: true, aniso: 16 });

    // Roughness: worn plates (smoother where tires polish them), rougher seams, scratches bright.
    const { c: rc, ctx: rr } = canvas(S);
    rr.fillStyle = "rgb(150,150,150)";
    rr.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 20 + r() * 120;
      const g = rr.createRadialGradient(x, y, 0, x, y, rad);
      const v = r() < 0.5 ? 90 : 205;
      g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
      g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      rr.fillStyle = g;
      rr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 400; i++) {
      rr.strokeStyle = `rgba(70,70,70,${0.3 + r() * 0.4})`;
      rr.lineWidth = 0.6 + r();
      rr.beginPath();
      const x = r() * S;
      const y = r() * S;
      const a = r() * Math.PI;
      const l = 10 + r() * 80;
      rr.moveTo(x, y);
      rr.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      rr.stroke();
    }
    rr.strokeStyle = "rgb(235,235,235)";
    rr.lineWidth = 10;
    for (let py = 0; py < 2; py++) for (let px = 0; px < 2; px++) rr.strokeRect(px * plate + 2, py * plate + 2, plate - 4, plate - 4);
    return { normal, roughness: toTexture(rc, { repeat: true, aniso: 16 }) };
  });
}

/**
 * The whole arena floor's paint and grime (one texture over 40 × 40 m):
 * hazard stripes along the walls, the pit's warning border, hazard pads,
 * center markings, spawn boxes, tire rubber and oil.
 */
export function floorAlbedo(hazards: { saws: { x: number; z: number }[]; vents: { x: number; z: number }[]; pulverizer: { x: number; z: number } }): Texture {
  return once("floorAlbedo", () => {
    const S = 2048;
    const W = ARENA.half * 2;
    const px = S / W; // pixels per meter
    const r = rng(23);
    const { c, ctx } = canvas(S);
    // x → u, z → v (v flipped so +z is up in the canvas? keep +z down: canvas y = (z + half) * px)
    const X = (x: number) => (x + ARENA.half) * px;
    const Z = (z: number) => (z + ARENA.half) * px;

    // Base steel: dark cool grey with large tonal variation.
    ctx.fillStyle = "#4a505b";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 180; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 60 + r() * 260;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      const dark = r() < 0.6;
      g.addColorStop(0, dark ? "rgba(30,32,38,0.22)" : "rgba(170,176,188,0.14)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Per-plate tint (2 m plates) so the tiling never reads as one texture.
    for (let gx = 0; gx < W / 2; gx++) {
      for (let gz = 0; gz < W / 2; gz++) {
        const v = (r() - 0.5) * 26;
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
        ctx.fillRect(gx * 2 * px, gz * 2 * px, 2 * px, 2 * px);
      }
    }

    const stripes = (x0: number, y0: number, w: number, h: number, angle = 0.785, band = 22, alpha = 0.95) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, w, h);
      ctx.clip();
      ctx.fillStyle = `rgba(245,190,20,${alpha})`;
      ctx.fillRect(x0, y0, w, h);
      ctx.fillStyle = `rgba(18,18,20,${alpha})`;
      ctx.translate(x0 + w / 2, y0 + h / 2);
      ctx.rotate(angle);
      const span = Math.hypot(w, h);
      for (let s = -span; s < span; s += band * 2) ctx.fillRect(s, -span, band, span * 2);
      ctx.restore();
    };

    // Wall border: 1.2 m of hazard stripes.
    const b = 1.2 * px;
    stripes(0, 0, S, b);
    stripes(0, S - b, S, b);
    stripes(0, 0, b, S);
    stripes(S - b, 0, b, S);
    ctx.fillStyle = "rgba(10,10,12,0.9)";
    ctx.fillRect(b, b, S - 2 * b, 6);
    ctx.fillRect(b, S - b - 6, S - 2 * b, 6);
    ctx.fillRect(b, b, 6, S - 2 * b);
    ctx.fillRect(S - b - 6, b, 6, S - 2 * b);

    // Pit warning border (1 m) + red keep-out ring.
    const p = ARENA.pit;
    const pb = 1.1 * px;
    stripes(X(p.x - p.half) - pb, Z(p.z - p.half) - pb, (p.half * 2) * px + pb * 2, (p.half * 2) * px + pb * 2, -0.785, 18);
    ctx.strokeStyle = "rgba(255,60,40,0.85)";
    ctx.lineWidth = 10;
    ctx.strokeRect(X(p.x - p.half) - pb - 16, Z(p.z - p.half) - pb - 16, p.half * 2 * px + pb * 2 + 32, p.half * 2 * px + pb * 2 + 32);

    // Center circle + quadrant lines, painted white and worn.
    ctx.strokeStyle = "rgba(235,240,248,0.55)";
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(X(0), Z(0), 8.5 * px, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 8;
    for (const [x0, z0, x1, z1] of [
      [0, -ARENA.half + 1.4, 0, -8.5],
      [0, 8.5, 0, ARENA.half - 1.4],
      [-ARENA.half + 1.4, 0, -8.5, 0],
      [8.5, 0, ARENA.half - 1.4, 0],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(X(x0), Z(z0));
      ctx.lineTo(X(x1), Z(z1));
      ctx.stroke();
    }
    // Spawn boxes in the corners.
    ctx.lineWidth = 7;
    for (const [sx, sz] of [
      [-12, -12],
      [12, 12],
      [12, -12],
      [-12, 12],
    ] as const) {
      ctx.strokeStyle = "rgba(198,255,61,0.6)";
      ctx.strokeRect(X(sx - 2), Z(sz - 2), 4 * px, 4 * px);
      ctx.strokeStyle = "rgba(198,255,61,0.35)";
      ctx.strokeRect(X(sx - 2.4), Z(sz - 2.4), 4.8 * px, 4.8 * px);
    }

    // Hazard pads.
    for (const s of hazards.saws) {
      stripes(X(s.x - 1.6), Z(s.z - 1.6), 3.2 * px, 3.2 * px, 0.785, 14, 0.8);
    }
    for (const v of hazards.vents) {
      ctx.fillStyle = "rgba(255,90,20,0.5)";
      ctx.fillRect(X(v.x - 1.5), Z(v.z - 1.5), 3 * px, 3 * px);
      stripes(X(v.x - 1.3), Z(v.z - 1.3), 2.6 * px, 2.6 * px, -0.785, 12, 0.7);
    }
    const pv = hazards.pulverizer;
    ctx.fillStyle = "rgba(255,40,40,0.35)";
    ctx.fillRect(X(pv.x - 2.2), Z(pv.z - 2.2), 4.4 * px, 4.4 * px);
    stripes(X(pv.x - 2), Z(pv.z - 2), 4 * px, 4 * px, 0.785, 20, 0.85);

    // Big stenciled logo text on two sides of the pit.
    ctx.save();
    ctx.fillStyle = "rgba(235,240,248,0.16)";
    ctx.font = `900 ${2.2 * px}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(X(0), Z(-15));
    ctx.fillText("WEDGE WARS", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(235,240,248,0.16)";
    ctx.font = `900 ${2.2 * px}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(X(0), Z(15));
    ctx.rotate(Math.PI);
    ctx.fillText("WEDGE WARS", 0, 0);
    ctx.restore();

    // Rubber: long dark arcs of old tire marks.
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(12,12,14,${0.06 + r() * 0.12})`;
      ctx.lineWidth = 0.22 * px;
      const cx = (r() - 0.5) * 30;
      const cz = (r() - 0.5) * 30;
      const rad = 3 + r() * 8;
      const a0 = r() * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(X(cx), Z(cz), rad * px, a0, a0 + 0.6 + r() * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(cx), Z(cz), (rad + 1.4) * px, a0, a0 + 0.6 + r() * 1.6);
      ctx.stroke();
    }
    // Oil + scorch blotches.
    for (let i = 0; i < 40; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 20 + r() * 90;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(8,8,10,${0.25 + r() * 0.35})`);
      g.addColorStop(1, "rgba(8,8,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rad, rad * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Paint chipping: speckle the painted areas with base steel.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(95,100,110,${0.25 + r() * 0.5})`;
      const s = 1 + r() * 3;
      ctx.fillRect(r() * S, r() * S, s, s);
    }
    return toTexture(c, { srgb: true, aniso: 16 });
  });
}

/* ---------------------------------------------------------------------- */
/* Trucks                                                                 */
/* ---------------------------------------------------------------------- */

/** Hood decal: race number, chevrons and a pinstripe in the paint color (transparent background). */
export function hoodDecal(color: string, number: number): Texture {
  return once(`hood:${color}:${number}`, () => {
    const W = 512;
    const H = 512;
    const { c, ctx } = canvas(W, H);
    ctx.clearRect(0, 0, W, H);
    // Twin racing stripes.
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.95;
    ctx.fillRect(W * 0.3, 0, W * 0.1, H);
    ctx.fillRect(W * 0.6, 0, W * 0.1, H);
    ctx.globalAlpha = 1;
    // Chevrons.
    ctx.fillStyle = "#101216";
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const y = H * 0.08 + i * 46;
      ctx.moveTo(W * 0.5 - 70, y + 40);
      ctx.lineTo(W * 0.5, y);
      ctx.lineTo(W * 0.5 + 70, y + 40);
      ctx.lineTo(W * 0.5 + 70, y + 64);
      ctx.lineTo(W * 0.5, y + 24);
      ctx.lineTo(W * 0.5 - 70, y + 64);
      ctx.closePath();
      ctx.fill();
    }
    // Number roundel.
    ctx.fillStyle = "#0b0d11";
    ctx.beginPath();
    ctx.arc(W / 2, H * 0.66, 96, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 12;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = "#f4f6fa";
    ctx.font = "900 128px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), W / 2, H * 0.67);
    // Wear: knock bits out.
    const r = rng(number * 31 + color.length);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 500; i++) {
      ctx.globalAlpha = 0.3 + r() * 0.7;
      const s = 1 + r() * 4;
      ctx.fillRect(r() * W, r() * H, s, s);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    return toTexture(c, { srgb: true });
  });
}

/** Door decal: big number + slashes in the paint color. */
export function doorDecal(color: string, number: number): Texture {
  return once(`door:${color}:${number}`, () => {
    const W = 512;
    const H = 256;
    const { c, ctx } = canvas(W, H);
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      const x = 30 + i * 34;
      ctx.moveTo(x, H * 0.8);
      ctx.lineTo(x + 18, H * 0.8);
      ctx.lineTo(x + 58, H * 0.2);
      ctx.lineTo(x + 40, H * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.font = "italic 900 170px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.lineWidth = 14;
    ctx.strokeStyle = "#0b0d11";
    ctx.strokeText(String(number), W * 0.62, H * 0.54);
    ctx.fillStyle = color;
    ctx.fillText(String(number), W * 0.62, H * 0.54);
    ctx.fillStyle = "rgba(11,13,17,0.9)";
    ctx.font = "800 26px system-ui, sans-serif";
    ctx.fillText("WEDGE WARS", W * 0.62, H * 0.9);
    const r = rng(number * 7 + 3);
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 400; i++) {
      ctx.globalAlpha = 0.3 + r() * 0.7;
      const s = 1 + r() * 3;
      ctx.fillRect(r() * W, r() * H, s, s);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    return toTexture(c, { srgb: true });
  });
}

/** Tire tread (normal map) around the circumference. */
export function tireTread(): { normal: Texture; roughness: Texture } {
  return once("tread", () => {
    const W = 256;
    const H = 64;
    const { ctx } = canvas(W, H);
    ctx.fillStyle = "rgb(40,40,40)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgb(40,40,40)";
    ctx.fillRect(0, H * 0.3, W, H * 0.4);
    ctx.fillStyle = "rgb(225,225,225)";
    const blocks = 18;
    for (let i = 0; i < blocks; i++) {
      const x = (i / blocks) * W;
      const bw = W / blocks - 3;
      const off = i % 2 ? 3 : -3;
      ctx.fillRect(x + 1.5, H * 0.31, bw, H * 0.18 + off);
      ctx.fillRect(x + 1.5 + bw * 0.25, H * 0.51 + off, bw * 0.9, H * 0.18 - off);
    }
    const normal = toTexture(heightToNormal(readHeight(ctx, W, H), W, H, 3), { repeat: true });
    return { normal, roughness: normal };
  });
}

/* ---------------------------------------------------------------------- */
/* Particles, decals, beams                                               */
/* ---------------------------------------------------------------------- */

/** Soft round sprite (white, alpha falloff). */
export function softDot(): Texture {
  return once("dot", () => {
    const S = 128;
    const { c, ctx } = canvas(S);
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    return toTexture(c, { srgb: false });
  });
}

/** Puffy smoke sprite (lumpy alpha). */
export function smokePuff(): Texture {
  return once("puff", () => {
    const S = 128;
    const r = rng(5);
    const { c, ctx } = canvas(S);
    for (let i = 0; i < 14; i++) {
      const x = S / 2 + (r() - 0.5) * S * 0.4;
      const y = S / 2 + (r() - 0.5) * S * 0.4;
      const rad = S * (0.18 + r() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    return toTexture(c);
  });
}

/** Scorch mark (dark, ragged edge). */
export function scorch(): Texture {
  return once("scorch", () => {
    const S = 128;
    const r = rng(9);
    const { c, ctx } = canvas(S);
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = r() * S * 0.2;
      const x = S / 2 + Math.cos(a) * d;
      const y = S / 2 + Math.sin(a) * d;
      const rad = S * (0.12 + r() * 0.22);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    return toTexture(c);
  });
}

/** Vertical beam falloff for light cones: bright at the lamp, fading down. */
export function beamGradient(): Texture {
  return once("beam", () => {
    const { c, ctx } = canvas(8, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
    return toTexture(c);
  });
}

/** Glowing LED ticker text for the wall tops. */
export function ledBanner(text: string, color: string): Texture {
  return once(`led:${text}:${color}`, () => {
    const W = 1024;
    const H = 64;
    const { c, ctx } = canvas(W, H);
    ctx.fillStyle = "#050608";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = color;
    ctx.font = "900 46px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const unit = `${text}   ◆   `;
    // Stretch the text so a whole number of repeats spans the texture: no seam where it wraps.
    const measured = ctx.measureText(unit).width;
    const repeats = Math.max(1, Math.round(W / measured));
    const w = W / repeats;
    ctx.save();
    ctx.scale(w / measured, 1);
    for (let i = 0; i < repeats; i++) ctx.fillText(unit, i * measured, H / 2 + 2);
    ctx.restore();
    // LED dot grid.
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
    const t = toTexture(c, { srgb: true, repeat: true });
    return t;
  });
}

/** Hazard stripes (for the pulverizer head and saw housings). */
export function hazardStripes(): Texture {
  return once("stripes", () => {
    const S = 256;
    const { c, ctx } = canvas(S);
    ctx.fillStyle = "#f2b90f";
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = "#141416";
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(Math.PI / 4);
    for (let s = -S; s < S; s += 64) ctx.fillRect(s, -S, 32, S * 2);
    ctx.restore();
    const r = rng(2);
    for (let i = 0; i < 800; i++) {
      ctx.fillStyle = `rgba(60,60,64,${r() * 0.6})`;
      const s = 1 + r() * 3;
      ctx.fillRect(r() * S, r() * S, s, s);
    }
    return toTexture(c, { srgb: true, repeat: true });
  });
}

/** Glass smudges (alpha + roughness variety) for the arena walls. */
export function glassSmudge(): Texture {
  return once("glass", () => {
    const S = 256;
    const r = rng(17);
    const { c, ctx } = canvas(S);
    ctx.fillStyle = "rgb(40,40,40)";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 60; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 10 + r() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, `rgba(200,200,200,${0.2 + r() * 0.3})`);
      g.addColorStop(1, "rgba(200,200,200,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (let i = 0; i < 30; i++) {
      ctx.strokeStyle = `rgba(230,230,230,${0.2 + r() * 0.4})`;
      ctx.lineWidth = 0.5 + r();
      ctx.beginPath();
      const x = r() * S;
      const y = r() * S;
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60);
      ctx.stroke();
    }
    return toTexture(c, { repeat: true });
  });
}

/** Studio floor for the garage: dark concrete with a soft grid. */
export function studioFloor(): Texture {
  return once("studio", () => {
    const S = 1024;
    const r = rng(41);
    const { c, ctx } = canvas(S);
    ctx.fillStyle = "#16181d";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},${r() < 0.5 ? 0 : 255},0.03)`;
      const s = 1 + r() * 6;
      ctx.fillRect(r() * S, r() * S, s, s);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 16; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 16, 0);
      ctx.lineTo((i * S) / 16, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i * S) / 16);
      ctx.lineTo(S, (i * S) / 16);
      ctx.stroke();
    }
    return toTexture(c, { srgb: true, repeat: true });
  });
}

/** Soft blotchy noise as a normal map (heat shimmer). */
export function heatNoise(): Texture {
  return once("heat", () => {
    const S = 128;
    const r = rng(77);
    const { ctx } = canvas(S);
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const x = r() * S;
      const y = r() * S;
      const rad = 6 + r() * 18;
      const v = r() < 0.5 ? 0 : 255;
      for (const [ox, oy] of [
        [0, 0],
        [S, 0],
        [-S, 0],
        [0, S],
        [0, -S],
      ] as const) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    return toTexture(heightToNormal(readHeight(ctx, S, S), S, S, 3), { repeat: true });
  });
}
