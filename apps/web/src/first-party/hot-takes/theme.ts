import type { Side, Spice } from "./prompts";

/** FOR is volt (green-ish), AGAINST is flare (pink-ish) — everywhere. */
export const SIDE_THEME: Record<Side, { label: string; color: string; ink: string; tint: string; glow: string }> = {
  for: {
    label: "FOR",
    color: "#c6ff3d",
    ink: "#0b1400",
    tint: "rgb(198 255 61 / 0.12)",
    glow: "rgb(198 255 61 / 0.45)",
  },
  against: {
    label: "AGAINST",
    color: "#ff5ca8",
    ink: "#1a0010",
    tint: "rgb(255 92 168 / 0.12)",
    glow: "rgb(255 92 168 / 0.45)",
  },
};

/** How much fire each spice level brings (0..1 scales for particles & glow). */
export const SPICE_HEAT: Record<Spice, { embers: number; flames: number; glow: number; color: string }> = {
  1: { embers: 0.35, flames: 0.28, glow: 0.35, color: "#ffb347" },
  2: { embers: 0.65, flames: 0.62, glow: 0.62, color: "#ff7a1a" },
  3: { embers: 1, flames: 1, glow: 1, color: "#ff3d4e" },
};

/** Warm stage palette used by the particle systems. */
export const FIRE_COLORS = ["#ffd27a", "#ffb347", "#ff8a3d", "#ff5c3d", "#ff3d6e"] as const;
