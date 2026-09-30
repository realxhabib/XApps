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

export type RoadStyle = "plates" | "grating" | "glass" | "ice" | "ceramic" | "slabs";

export interface RoadLook {
  style: RoadStyle;
  base: string;
  panel: string;
  seam: string;
  line: string;
  glow: string;
  grit: number;
  /** Material hints for the road mesh. */
  roughness: number;
  metalness: number;
  emissive: number;
  curb: readonly [string, string];
}

export const ROAD_LOOKS: Record<ThemeId, RoadLook> = {
  mars: { style: "plates", base: "#5a3226", panel: "#6e3c2b", seam: "#2c1712", line: "#ffd166", glow: "#ff8a4c", grit: 0.3, roughness: 0.7, metalness: 0.45, emissive: 0.9, curb: ["#e8363f", "#f4efe6"] },
  belt: { style: "grating", base: "#3a4260", panel: "#4a5476", seam: "#161a28", line: "#9fe8ff", glow: "#46e6ff", grit: 0.1, roughness: 0.45, metalness: 0.8, emissive: 1.2, curb: ["#8f7bff", "#e6e2ff"] },
  saturn: { style: "ice", base: "#b9cde0", panel: "#d6e4f2", seam: "#7f97b0", line: "#ffcf6a", glow: "#ffd98a", grit: 0.06, roughness: 0.2, metalness: 0.1, emissive: 0.7, curb: ["#ffd98a", "#ffffff"] },
  nebula: { style: "glass", base: "#150d26", panel: "#1e1236", seam: "#090512", line: "#ffe9ff", glow: "#ff4fd8", grit: 0.04, roughness: 0.12, metalness: 0.6, emissive: 1.4, curb: ["#ff4fd8", "#36f3ff"] },
  luna: { style: "slabs", base: "#4a4e57", panel: "#585d67", seam: "#2a2d33", line: "#9fd0ff", glow: "#5ab0ff", grit: 0.28, roughness: 0.85, metalness: 0.15, emissive: 0.8, curb: ["#3f86ff", "#f4f7ff"] },
  sun: { style: "ceramic", base: "#241a18", panel: "#2e211d", seam: "#ff7a1a", line: "#ffe0a0", glow: "#ff9a2e", grit: 0.12, roughness: 0.5, metalness: 0.3, emissive: 1.3, curb: ["#ff5a1f", "#ffe7b0"] },
  europa: { style: "ice", base: "#a9c6de", panel: "#c8dcee", seam: "#6f8fae", line: "#5ab0ff", glow: "#7fd6ff", grit: 0.05, roughness: 0.18, metalness: 0.05, emissive: 0.7, curb: ["#2f7dd6", "#ffffff"] },
};

/**
 * Road surface themed per world (rusty Martian plates, space grating, ice
 * glass, neon glass, lunar slabs, heat tiles), with dashed lane lines and
 * glowing edge bands. u runs across the road (0..1), v along it (one tile ≈
 * 16 units). Returns colour, emissive and roughness maps.
 */
export function paintRoad(theme: ThemeId): { map: Texture; emissive: Texture; rough: Texture } {
  const look = ROAD_LOOKS[theme];
  const W = 1024;
  const H = 1024;
  const [c, g] = canvas(W, H);
  const [e, ge] = canvas(W, H);
  const [r, gr] = canvas(W, H);
  const rand = rng(theme.length * 97 + 11);
  g.fillStyle = look.base;
  g.fillRect(0, 0, W, H);
  gr.fillStyle = `rgb(${look.roughness * 255},${look.roughness * 255},${look.roughness * 255})`;
  gr.fillRect(0, 0, W, H);
  ge.fillStyle = "#000";
  ge.fillRect(0, 0, W, H);
  const cols = look.style === "slabs" ? 3 : look.style === "grating" ? 6 : 4;
  const rows = look.style === "ceramic" ? 6 : look.style === "slabs" ? 3 : 2;
  const pw = (W - 48) / cols;
  const ph = H / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = 24 + i * pw + ((look.style === "ceramic" || look.style === "slabs") && j % 2 ? pw / 2 : 0);
      const y = j * ph;
      const shade = 0.85 + rand() * 0.3;
      g.globalAlpha = shade;
      const grad = g.createLinearGradient(x, y, x + pw, y + ph);
      grad.addColorStop(0, look.panel);
      grad.addColorStop(1, look.base);
      g.fillStyle = grad;
      g.fillRect(x + 4, y + 4, pw - 8, ph - 8);
      g.globalAlpha = 1;
      g.strokeStyle = look.seam;
      g.lineWidth = look.style === "glass" ? 2 : 6;
      g.strokeRect(x + 3, y + 3, pw - 6, ph - 6);
      const rv = look.roughness + (rand() - 0.5) * 0.25;
      gr.fillStyle = `rgb(${rv * 255},${rv * 255},${rv * 255})`;
      gr.fillRect(x + 4, y + 4, pw - 8, ph - 8);
      // Seams glow on heat tiles, grating and glass.
      if (look.style === "ceramic" || look.style === "grating" || look.style === "glass") {
        ge.strokeStyle = look.style === "ceramic" ? look.seam : look.glow;
        ge.globalAlpha = look.style === "glass" ? 0.35 : 0.5;
        ge.lineWidth = look.style === "ceramic" ? 4 : 2;
        ge.strokeRect(x + 3, y + 3, pw - 6, ph - 6);
        ge.globalAlpha = 1;
      }
      if (look.style === "plates" || look.style === "grating") {
        g.fillStyle = "rgba(255,255,255,0.16)";
        for (const [px, py] of [
          [x + 16, y + 16],
          [x + pw - 16, y + 16],
          [x + 16, y + ph - 16],
          [x + pw - 16, y + ph - 16],
        ] as const) {
          g.beginPath();
          g.arc(px, py, 5, 0, Math.PI * 2);
          g.fill();
        }
      }
      if (look.style === "grating") {
        g.strokeStyle = "rgba(0,0,0,0.45)";
        g.lineWidth = 3;
        for (let k = 12; k < ph - 8; k += 18) {
          g.beginPath();
          g.moveTo(x + 10, y + k);
          g.lineTo(x + pw - 10, y + k);
          g.stroke();
        }
      }
    }
  }
  // Surface character.
  if (look.style === "plates") {
    // Rust streaks and blown sand drifts.
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(${150 + rand() * 60},${60 + rand() * 30},${30},${0.1 + rand() * 0.15})`;
      g.beginPath();
      g.ellipse(rand() * W, rand() * H, 20 + rand() * 80, 6 + rand() * 20, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  } else if (look.style === "ice") {
    // Cracks and frost.
    g.strokeStyle = "rgba(255,255,255,0.55)";
    for (let k = 0; k < 26; k++) {
      let x = rand() * W;
      let y = rand() * H;
      g.lineWidth = 1 + rand() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      for (let n = 0; n < 6; n++) {
        x += (rand() - 0.5) * 80;
        y += (rand() - 0.5) * 80;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let k = 0; k < 3000; k++) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.25})`;
      g.fillRect(rand() * W, rand() * H, 2, 2);
    }
  } else if (look.style === "glass") {
    // Neon sub-grid under the glass.
    ge.strokeStyle = look.glow;
    ge.globalAlpha = 0.18;
    ge.lineWidth = 1.5;
    for (let x = 24; x < W - 24; x += 32) {
      ge.beginPath();
      ge.moveTo(x, 0);
      ge.lineTo(x, H);
      ge.stroke();
    }
    for (let y = 0; y < H; y += 32) {
      ge.beginPath();
      ge.moveTo(24, y);
      ge.lineTo(W - 24, y);
      ge.stroke();
    }
    ge.globalAlpha = 1;
  } else if (look.style === "slabs") {
    for (let k = 0; k < 60; k++) {
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.beginPath();
      g.arc(rand() * W, rand() * H, 2 + rand() * 9, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (let k = 0; k < 16000; k++) {
    const a = rand() * look.grit;
    g.fillStyle = rand() < 0.5 ? `rgba(255,255,255,${a * 0.5})` : `rgba(0,0,0,${a})`;
    g.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1 + rand() * 2);
  }
  // Thruster scorch lanes.
  for (let k = 0; k < 6; k++) {
    const x = 120 + rand() * (W - 240);
    const grad = g.createLinearGradient(x, 0, x + 36, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, `rgba(0,0,0,${look.style === "ice" ? 0.12 : 0.22})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x, 0, 36, H);
  }
  // Lane markings suit the surface: dashes on plates and slabs, chevron dots on glass and ice, none on grating.
  if (look.style === "glass" || look.style === "ice" || look.style === "ceramic") {
    for (const lx of [W * 0.34, W * 0.66]) {
      for (let y = 0; y < H; y += 128) {
        for (const gc of [g, ge]) {
          gc.fillStyle = look.line;
          gc.globalAlpha = gc === g ? 0.75 : 0.5;
          gc.beginPath();
          gc.moveTo(lx - 16, y + 70);
          gc.lineTo(lx, y + 40);
          gc.lineTo(lx + 16, y + 70);
          gc.lineTo(lx + 16, y + 84);
          gc.lineTo(lx, y + 54);
          gc.lineTo(lx - 16, y + 84);
          gc.closePath();
          gc.fill();
          gc.globalAlpha = 1;
        }
      }
    }
  }
  for (const lx of look.style === "plates" || look.style === "slabs" ? [W * 0.34, W * 0.66] : []) {
    for (let y = 0; y < H; y += 256) {
      g.fillStyle = look.line;
      g.globalAlpha = 0.7;
      g.fillRect(lx - 5, y + 40, 10, 140);
      g.globalAlpha = 1;
      ge.fillStyle = look.line;
      ge.globalAlpha = 0.35;
      ge.fillRect(lx - 5, y + 40, 10, 140);
      ge.globalAlpha = 1;
    }
  }
  // Edge bands: solid line + glow strip.
  for (const [x0, dir] of [
    [0, 1],
    [W, -1],
  ] as const) {
    g.fillStyle = look.line;
    g.fillRect(dir > 0 ? x0 + 14 : x0 - 28, 0, 14, H);
    const grad = ge.createLinearGradient(x0, 0, x0 + dir * 56, 0);
    grad.addColorStop(0, look.glow);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ge.fillStyle = grad;
    ge.fillRect(dir > 0 ? x0 : x0 - 56, 0, 56, H);
    ge.fillStyle = look.line;
    ge.fillRect(dir > 0 ? x0 + 14 : x0 - 28, 0, 14, H);
  }
  const map = tex(c);
  const emissive = tex(e);
  const rough = tex(r, false);
  return { map, emissive, rough };
}

/** Shoulder/offroad strip: regolith for planets, grated metal in space. */
export function paintShoulder(theme: ThemeId): Texture {
  const [c, g] = canvas(256, 256);
  const rand = rng(theme.length * 31 + 5);
  if (theme === "mars" || theme === "luna" || theme === "europa") {
    const base = theme === "mars" ? [150, 72, 40] : theme === "europa" ? [170, 196, 218] : [120, 122, 128];
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
