/**
 * Perfect Circle — canvas renderers (browser only): the share card image the
 * player previews and saves. The same layout is redrawn on the server for the
 * link's Open Graph image (`app/embed/perfect-circle/card/[code]`).
 */
import { circleArt } from "./card";
import { accuracyColor, formatAccuracy, verdictFor, type Point } from "./logic";

export const CARD_W = 1200;
export const CARD_H = 630;

function cssFont(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return value || fallback;
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

/** Draws the ink of a stroke into a `size` square whose top-left is (x, y). */
export function drawInk(
  ctx: CanvasRenderingContext2D,
  stroke: readonly Point[],
  x: number,
  y: number,
  size: number,
  { width = size / 70, glow = true, ideal = true }: { width?: number; glow?: boolean; ideal?: boolean } = {},
) {
  const art = circleArt(stroke, size, 240);
  ctx.save();
  ctx.translate(x, y);
  if (ideal && art.radius > 0) {
    ctx.setLineDash([width * 1.4, width * 1.6]);
    ctx.strokeStyle = "rgb(255 255 255 / 0.16)";
    ctx.lineWidth = width / 2;
    ctx.beginPath();
    ctx.arc(art.center.x, art.center.y, art.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width;
  for (const s of art.segments) {
    ctx.strokeStyle = s.color;
    if (glow) {
      ctx.shadowColor = s.color;
      ctx.shadowBlur = width * 1.6;
    }
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#f6f7fb";
  ctx.beginPath();
  ctx.arc(art.center.x, art.center.y, width * 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export interface ShareCardOptions {
  accuracy: number;
  stroke: readonly Point[];
  handle: string | null;
  accent: [string, string];
}

/** The 1200 × 630 share card. */
export function drawShareCard(canvas: HTMLCanvasElement, { accuracy, stroke, handle, accent }: ShareCardOptions) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const display = cssFont("--font-display", "ui-sans-serif, system-ui, sans-serif");
  const sans = cssFont("--font-sans", "ui-sans-serif, system-ui, sans-serif");

  // Backdrop: ink black with the app's two accent glows and a faint dot grid.
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = (x: number, y: number, r: number, color: string, alpha: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `${color}${alpha}`);
    g.addColorStop(1, `${color}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  };
  glow(1080, 40, 560, accent[0], "55");
  glow(1180, 640, 520, accent[1], "44");
  ctx.fillStyle = "rgb(255 255 255 / 0.05)";
  for (let gx = 12; gx < CARD_W; gx += 26) for (let gy = 12; gy < CARD_H; gy += 26) ctx.fillRect(gx, gy, 2, 2);

  // The drawing, on its own dark board.
  const board = 540;
  const bx = 45;
  const by = 45;
  ctx.save();
  roundRect(ctx, bx, by, board, board, 36);
  ctx.fillStyle = "#0b0d14";
  ctx.fill();
  ctx.strokeStyle = "rgb(255 255 255 / 0.10)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();
  drawInk(ctx, stroke, bx, by, board, { width: 9 });
  ctx.restore();

  // The words.
  const tx = 640;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#b8bfcf";
  ctx.font = `700 26px ${sans}`;
  ctx.letterSpacing = "6px";
  ctx.fillText("⭕ PERFECT CIRCLE", tx, 132);
  ctx.letterSpacing = "0px";

  const color = accuracyColor(accuracy);
  ctx.font = `800 150px ${display}`;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 40;
  ctx.fillText(formatAccuracy(accuracy), tx - 6, 290);
  ctx.shadowBlur = 0;

  const verdict = verdictFor(accuracy);
  ctx.font = `800 50px ${display}`;
  ctx.fillStyle = "#f6f7fb";
  ctx.fillText(`${verdict.word} ${verdict.emoji}`, tx, 366);

  ctx.font = `500 30px ${sans}`;
  ctx.fillStyle = "#dfe3ec";
  ctx.fillText(handle ? `drawn freehand by @${handle}` : "drawn freehand, one stroke", tx, 420);

  ctx.font = `700 30px ${sans}`;
  ctx.fillStyle = "#f6f7fb";
  ctx.fillText("Can you beat it?", tx, 540);
  ctx.font = `600 24px ${sans}`;
  ctx.fillStyle = "#8a93a6";
  ctx.fillText("XApps · challenge anyone on X", tx, 578);
}

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}
