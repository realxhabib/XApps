/**
 * Procedural canvas textures for the road and pickups (no image assets).
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { ThemeId } from "./types";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  if (srgb) t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

interface RoadLook {
  base: string;
  panel: string;
  seam: string;
  line: string;
  glow: string;
  grit: number;
}

const LOOKS: Record<ThemeId, RoadLook> = {
  mars: { base: "#3a2d2a", panel: "#46362f", seam: "#231a17", line: "#ffe2c4", glow: "#ff8a4c", grit: 0.22 },
  belt: { base: "#1d2030", panel: "#262a3e", seam: "#12141f", line: "#d9e2ff", glow: "#8f7bff", grit: 0.12 },
  saturn: { base: "#2a2b36", panel: "#343644", seam: "#191a22", line: "#fff4da", glow: "#ffd98a", grit: 0.1 },
  nebula: { base: "#1a1328", panel: "#231a36", seam: "#0e0a17", line: "#ffe9ff", glow: "#ff4fd8", grit: 0.1 },
  luna: { base: "#34373f", panel: "#3f434c", seam: "#22242a", line: "#f4f7ff", glow: "#5ab0ff", grit: 0.2 },
};

/**
 * Road surface: tiled panels with seams, grit, dashed lane lines and glowing
 * edge bands. u runs across the road (0..1), v along it (one tile ≈ 16 units).
 * Returns the colour map and an emissive map (lines + edge glow).
 */
export function paintRoad(theme: ThemeId): { map: Texture; emissive: Texture; rough: Texture } {
  const look = LOOKS[theme];
  const W = 512;
  const H = 512;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const [r, gr] = canvas(W, H);
  const rand = rng(theme.length * 97 + 11);
  g.fillStyle = look.base;
  g.fillRect(0, 0, W, H);
  gr.fillStyle = "#a0a0a0";
  gr.fillRect(0, 0, W, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);
  // Panels: 4 lanes across, 2 along.
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const x = 24 + i * 116;
      const y = j * 256;
      const shade = 0.9 + rand() * 0.2;
      g.fillStyle = look.panel;
      g.globalAlpha = shade * 0.9;
      g.fillRect(x + 3, y + 3, 110, 250);
      g.globalAlpha = 1;
      g.strokeStyle = look.seam;
      g.lineWidth = 3;
      g.strokeRect(x + 2, y + 2, 112, 252);
      gr.fillStyle = `rgb(${120 + rand() * 50},${120 + rand() * 50},${120 + rand() * 50})`;
      gr.fillRect(x + 3, y + 3, 110, 250);
      // Rivets.
      g.fillStyle = "rgba(255,255,255,0.12)";
      for (const [px, py] of [
        [x + 10, y + 10],
        [x + 104, y + 10],
        [x + 10, y + 244],
        [x + 104, y + 244],
      ] as const) {
        g.beginPath();
        g.arc(px, py, 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Grit and tyre... er, thruster scorch marks.
  for (let k = 0; k < 9000; k++) {
    const a = rand() * look.grit;
    g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a * 0.5})` : `rgba(0,0,0,${a})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let k = 0; k < 7; k++) {
    const x = 60 + rand() * (W - 120);
    const grad = g.createLinearGradient(x, 0, x + 18, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x, 0, 18, H);
  }
  // Dashed lane lines (colour + emissive).
  for (const lx of [W * 0.33, W * 0.67]) {
    for (let y = 0; y < H; y += 128) {
      g.fillStyle = look.line;
      g.globalAlpha = 0.55;
      g.fillRect(lx - 3, y + 20, 6, 70);
      g.globalAlpha = 1;
      ge.fillStyle = look.line;
      ge.globalAlpha = 0.25;
      ge.fillRect(lx - 3, y + 20, 6, 70);
      ge.globalAlpha = 1;
    }
  }
  // Edge bands: solid line + glow strip.
  for (const [x0, dir] of [
    [0, 1],
    [W, -1],
  ] as const) {
    g.fillStyle = look.line;
    g.fillRect(dir > 0 ? x0 + 8 : x0 - 16, 0, 8, H);
    const grad = ge.createLinearGradient(x0, 0, x0 + dir * 30, 0);
    grad.addColorStop(0, look.glow);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ge.fillStyle = grad;
    ge.fillRect(dir > 0 ? x0 : x0 - 30, 0, 30, H);
    ge.fillStyle = look.line;
    ge.fillRect(dir > 0 ? x0 + 8 : x0 - 16, 0, 8, H);
  }
  return { map: tex(c), emissive: tex(e), rough: tex(r, false) };
}

/** Shoulder/offroad strip: regolith for planets, grated metal in space. */
export function paintShoulder(theme: ThemeId): Texture {
  const [c, g] = canvas(256, 256);
  const rand = rng(theme.length * 31 + 5);
  if (theme === "mars" || theme === "luna") {
    const base = theme === "mars" ? [150, 72, 40] : [120, 122, 128];
    g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
    g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 5000; k++) {
      const v = (rand() - 0.5) * 60;
      g.fillStyle = `rgba(${base[0]! + v},${base[1]! + v},${base[2]! + v},0.7)`;
      const s = 1 + rand() * 4;
      g.fillRect(rand() * 256, rand() * 256, s, s);
    }
    for (let k = 0; k < 40; k++) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.beginPath();
      g.arc(rand() * 256, rand() * 256, 2 + rand() * 6, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    g.fillStyle = "#1a1c26";
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = "#2c3040";
    g.lineWidth = 6;
    for (let y = 0; y < 256; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y + 32);
      g.stroke();
    }
    g.strokeStyle = "#0c0d13";
    g.lineWidth = 2;
    for (let x = 0; x < 256; x += 64) g.strokeRect(x, 0, 64, 256);
  }
  return tex(c);
}

/** Red/white (theme-coloured) rumble curb stripes. */
export function paintCurb(a: string, b: string): Texture {
  const [c, g] = canvas(64, 128);
  g.fillStyle = a;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = b;
  g.fillRect(0, 64, 64, 64);
  g.fillStyle = "rgba(0,0,0,0.25)";
  g.fillRect(0, 0, 6, 128);
  return tex(c);
}

/** Checkered start/finish band. */
export function paintChecker(): Texture {
  const [c, g] = canvas(256, 64);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#f4f4f4";
      g.fillRect(x * 16, y * 16, 16, 16);
    }
  }
  return tex(c, true, false);
}

/** Boost pad chevrons (alpha from luminance, drawn additive). */
export function paintChevrons(color: string): Texture {
  const [c, g] = canvas(128, 256);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 128, 256);
  for (let k = 0; k < 4; k++) {
    const y = k * 64 + 8;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(10, y + 48);
    g.lineTo(64, y);
    g.lineTo(118, y + 48);
    g.lineTo(118, y + 62);
    g.lineTo(64, y + 16);
    g.lineTo(10, y + 62);
    g.closePath();
    g.fill();
  }
  const t = tex(c);
  return t;
}

/** Item capsule face: a glowing "?" on a translucent iridescent panel. */
export function paintItemFace(): Texture {
  const [c, g] = canvas(128, 128);
  const grad = g.createLinearGradient(0, 0, 128, 128);
  grad.addColorStop(0, "#ff7ad9");
  grad.addColorStop(0.33, "#ffe07a");
  grad.addColorStop(0.66, "#7affc4");
  grad.addColorStop(1, "#7ab8ff");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "rgba(255,255,255,0.25)";
  g.fillRect(6, 6, 116, 116);
  g.fillStyle = "#fff";
  g.font = "bold 92px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.5)";
  g.shadowBlur = 6;
  g.fillText("?", 64, 70);
  return tex(c, true, false);
}

/** Soft round particle sprite. */
export function paintDot(): Texture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return tex(c, false, false);
}

/** Panel for billboards/gantry: big text on a dark glowing panel. */
export function paintSign(text: string, color: string, w = 512, h = 128): Texture {
  const [c, g] = canvas(w, h);
  g.fillStyle = "#07060d";
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = color;
  g.font = `900 ${Math.round(h * 0.52)}px system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = color;
  g.shadowBlur = 18;
  g.fillText(text, w / 2, h / 2 + 4);
  return tex(c, true, false);
}
