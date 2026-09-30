/**
 * Procedural canvas textures (no downloads): the wooden table top with its
 * painted lines, a soft blob for contact shadows, and a glow for sparks,
 * fire and background bokeh. Seeded, so every device paints the same table.
 */

import { CanvasTexture, ClampToEdgeWrapping, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { seededRandom } from "./logic";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

/**
 * Table top: warm lacquered planks running the length of the table, fine
 * grain, a painted border and centre line. `u` spans the width, `v` the length.
 */
export function tableTexture(anisotropy = 4): CanvasTexture {
  const W = 512;
  const H = 2048;
  const [c, g] = canvas(W, H);
  const rnd = seededRandom(20261007);

  // Planks.
  const planks = 5;
  const pw = W / planks;
  const tones = ["#b8753f", "#c27f45", "#ad6b37", "#c9884d", "#b3713c"];
  for (let i = 0; i < planks; i++) {
    const grad = g.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
    const base = tones[i % tones.length]!;
    grad.addColorStop(0, shade(base, -0.06));
    grad.addColorStop(0.5, base);
    grad.addColorStop(1, shade(base, -0.08));
    g.fillStyle = grad;
    g.fillRect(i * pw, 0, pw, H);
  }

  // Grain: long wavy strokes along the plank.
  g.globalAlpha = 0.16;
  for (let i = 0; i < 260; i++) {
    const plank = Math.floor(rnd() * planks);
    let x = plank * pw + 4 + rnd() * (pw - 8);
    g.strokeStyle = rnd() < 0.5 ? "#5a2f14" : "#e3a86a";
    g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    let y = rnd() * H * 0.2 - 100;
    g.moveTo(x, y);
    const len = 400 + rnd() * 1600;
    const wobble = 1 + rnd() * 3;
    const freq = 0.004 + rnd() * 0.01;
    for (let s = 0; s < len; s += 24) {
      y += 24;
      x += Math.sin(y * freq) * wobble * 0.3;
      g.lineTo(Math.max(plank * pw + 2, Math.min((plank + 1) * pw - 2, x)), y);
    }
    g.stroke();
  }
  // A few knots.
  g.globalAlpha = 0.22;
  for (let i = 0; i < 7; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 6 + rnd() * 10;
    const kg = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
    kg.addColorStop(0, "#4a230d");
    kg.addColorStop(0.45, "#7b4520");
    kg.addColorStop(1, "rgba(123,69,32,0)");
    g.fillStyle = kg;
    g.beginPath();
    g.ellipse(x, y, r, r * 2.2, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // Plank seams.
  g.fillStyle = "rgba(40, 18, 6, 0.55)";
  for (let i = 1; i < planks; i++) g.fillRect(i * pw - 1, 0, 2, H);

  // Painted lines: border and centre line.
  g.fillStyle = "rgba(255, 250, 240, 0.92)";
  const edge = 10;
  g.fillRect(0, 0, edge, H);
  g.fillRect(W - edge, 0, edge, H);
  g.fillRect(0, 0, W, edge);
  g.fillRect(0, H - edge, W, edge);
  g.fillRect(W / 2 - 3, 0, 6, H);

  // Lacquer sheen variation.
  const sheen = g.createLinearGradient(0, 0, 0, H);
  sheen.addColorStop(0, "rgba(255,255,255,0.05)");
  sheen.addColorStop(0.5, "rgba(0,0,0,0.04)");
  sheen.addColorStop(1, "rgba(255,255,255,0.05)");
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.minFilter = LinearMipmapLinearFilter;
  return tex;
}

/** Soft round shadow: opaque centre fading to nothing. */
export function blobTexture(): CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.85)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  return tex;
}

/** White glow for additive sprites and particles. */
export function glowTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.75)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** Dark floor with a warm pool of light under the table. */
export function floorTexture(): CanvasTexture {
  const [c, g] = canvas(512, 512);
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, "#3a2a22");
  grad.addColorStop(0.35, "#1d1715");
  grad.addColorStop(1, "#0b0c11");
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + 255 * amount)));
  const r = f((n >> 16) & 255);
  const gr = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r}, ${gr}, ${b})`;
}
