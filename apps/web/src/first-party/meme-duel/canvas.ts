/**
 * Canvas geometry shared by photo templates, drops and the renderer. Kept
 * dependency-free so template modules can use it at load time.
 *
 * Every canvas is 600 units wide. Photos keep their aspect ratio within
 * sensible limits; anything more extreme is letterboxed.
 */

export const CANVAS_WIDTH = 600;
/** Wider than 2.2:1 gets letterboxed top/bottom. */
export const MIN_CANVAS_HEIGHT = 270;
/** Taller than 1:1.6 gets letterboxed left/right (phone screenshots…). */
export const MAX_CANVAS_HEIGHT = 960;

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The canvas for an image of `width`×`height`: 600 wide, height follows the aspect ratio (clamped). */
export function fitCanvas(width: number, height: number): CanvasSize {
  const ratio = width > 0 && height > 0 && Number.isFinite(width / height) ? height / width : 1;
  const h = Math.round(CANVAS_WIDTH * ratio);
  return { width: CANVAS_WIDTH, height: Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, h)) };
}

/**
 * Where an image of `width`×`height` sits inside `canvas` ("contain"). When the
 * canvas already follows the aspect ratio this is the whole canvas.
 */
export function containRect(canvas: CanvasSize, width: number, height: number): Rect {
  if (!(width > 0 && height > 0)) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const scale = Math.min(canvas.width / width, canvas.height / height);
  const w = width * scale;
  const h = height * scale;
  // Sub-unit gaps come from rounding the canvas height: just fill the canvas.
  if (canvas.width - w < 1.5 && canvas.height - h < 1.5) return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r((canvas.width - w) / 2), y: r((canvas.height - h) / 2), width: r(w), height: r(h) };
}
