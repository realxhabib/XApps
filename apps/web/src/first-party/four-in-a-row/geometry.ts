/**
 * Board geometry (SVG user units) and the drop physics shared by the board
 * renderer and the game controller (which waits for discs to land).
 */
import { COLS, ROWS, type Seat } from "./logic";

export const CELL = 100;
/** Frame around the grid. */
export const PAD = 18;
/** Space above the board where the ghost disc hovers. */
export const LANE = 116;
export const HOLE_R = 38;
/** Slightly bigger than the hole so no gap shows around a disc. */
export const DISC_R = 42;
export const BOARD_W = COLS * CELL + PAD * 2;
export const BOARD_H = ROWS * CELL + PAD * 2;
export const BOARD_RADIUS = 36;
export const VIEW_W = BOARD_W;
/** Board + lane + a little room for the ground shadow. */
export const VIEW_H = LANE + BOARD_H + 22;
export const GHOST_Y = LANE / 2 + 2;

export const colX = (col: number): number => PAD + col * CELL + CELL / 2;
export const rowY = (row: number): number => LANE + PAD + (ROWS - 1 - row) * CELL + CELL / 2;

export const SEAT_COLORS: Record<Seat, { base: string; light: string; dark: string; glow: string; name: string }> = {
  0: { base: "#ff4d5e", light: "#ffa0a8", dark: "#b8182c", glow: "#ff4d5e", name: "Red" },
  1: { base: "#ffd23d", light: "#fff3b0", dark: "#c98a00", glow: "#ffd23d", name: "Yellow" },
};

/** Gravity in SVG units/s² — a full-height drop takes ~0.43 s. */
const GRAVITY = 7600;
/** Energy kept per bounce. */
const RESTITUTION = 0.23;

const EASE_IN: [number, number, number, number] = [0.55, 0.085, 0.68, 0.53]; // quad in (falling)
const EASE_OUT: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94]; // quad out (rising)

export interface DropPlan {
  /** Distance fallen, SVG units. */
  distance: number;
  /** When the disc first hits the stack. */
  impactMs: number;
  totalMs: number;
  y: number[];
  yTimes: number[];
  yEase: [number, number, number, number][];
  scaleX: number[];
  scaleY: number[];
  scaleTimes: number[];
}

/**
 * Keyframes for a disc falling from the ghost lane into `row`: accelerating
 * fall, a small bounce and a settle, with squash & stretch on impact.
 */
export function dropPlan(row: number, reduced = false): DropPlan {
  const distance = rowY(row) - GHOST_Y;
  if (reduced) {
    return {
      distance,
      impactMs: 160,
      totalMs: 160,
      y: [-distance, 0],
      yTimes: [0, 1],
      yEase: [EASE_IN],
      scaleX: [1, 1],
      scaleY: [1, 1],
      scaleTimes: [0, 1],
    };
  }
  const fall = Math.sqrt((2 * distance) / GRAVITY);
  const h1 = distance * RESTITUTION * RESTITUTION;
  const up1 = Math.sqrt((2 * h1) / GRAVITY);
  const h2 = h1 * RESTITUTION * RESTITUTION;
  const up2 = Math.max(0.035, Math.sqrt((2 * h2) / GRAVITY));
  const total = fall + 2 * up1 + 2 * up2;
  const at = (t: number) => Math.min(1, t / total);

  const squashIn = Math.max(0, fall - 0.03);
  return {
    distance,
    impactMs: fall * 1000,
    totalMs: total * 1000,
    y: [-distance, 0, -h1, 0, -h2, 0],
    yTimes: [0, at(fall), at(fall + up1), at(fall + 2 * up1), at(fall + 2 * up1 + up2), 1],
    yEase: [EASE_IN, EASE_OUT, EASE_IN, EASE_OUT, EASE_IN],
    // Stretched while falling, squashed at impact, wobbling back to round.
    scaleX: [1, 0.95, 1.1, 0.98, 1.03, 1],
    scaleY: [1, 1.06, 0.86, 1.03, 0.97, 1],
    scaleTimes: [0, at(squashIn), at(fall), at(fall + up1), at(fall + 2 * up1), 1],
  };
}
