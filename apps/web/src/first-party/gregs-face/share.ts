/**
 * The share card: the face you built (misplaced features, ghost outlines of
 * where they belong) next to the score, drawn on a 1200×630 canvas and
 * handed to `media.upload` → `social.share` by the app.
 */
import { PART_LABEL, PART_ORDER } from "./face";
import type { FaceKit } from "./kit";
import { formatPct, trueX, verdict, type Drop } from "./logic";

export const CARD = { width: 1200, height: 630 } as const;

const ORANGE = "#ff8a3d";
const BLUE = "#6f9bd1";

function displayFont(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-bricolage").trim();
  return family ? `${family}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Sets `size`px bold text, shrunk until it fits `maxWidth`. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number, family: string, weight = 800) {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > 12 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
  return px;
}

/** Draws the built face (blank + dropped sprites + ghosts) into a box. */
export function drawBuiltFace(
  ctx: CanvasRenderingContext2D,
  kit: FaceKit,
  drops: readonly Drop[],
  box: { x: number; y: number; w: number; h: number },
  options: { ghosts?: boolean; radius?: number } = {},
): void {
  const { face } = kit;
  const s = box.w / face.width;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, options.radius ?? 32);
  ctx.clip();
  ctx.drawImage(kit.blank, box.x, box.y, box.w, box.h);
  for (const drop of drops) {
    const r = face.parts[drop.part];
    const dx = drop.x - trueX(face, drop.part);
    ctx.drawImage(kit.sprites[drop.part], box.x + (r.x + dx) * s, box.y + r.y * s, r.w * s, r.h * s);
  }
  if (options.ghosts !== false) {
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgb(255 255 255 / 0.7)";
    for (const drop of drops) {
      if (drop.perfect) continue;
      const r = face.parts[drop.part];
      ctx.beginPath();
      ctx.roundRect(box.x + r.x * s, box.y + r.y * s, r.w * s, r.h * s, Math.min(14, (r.h * s) / 3));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/** Renders the card. Browser only. */
export function renderShareCard(
  kit: FaceKit,
  drops: readonly Drop[],
  score: number,
  options: { name: string; handle?: string },
): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = CARD.width;
  c.height = CARD.height;
  const ctx = c.getContext("2d")!;
  const family = displayFont();

  // Backdrop: ink with two accent glows and a faint dot grid.
  ctx.fillStyle = "#0b0d14";
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  const glow = (x: number, y: number, r: number, color: string, alpha: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "transparent");
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD.width, CARD.height);
    ctx.globalAlpha = 1;
  };
  glow(120, 60, 620, ORANGE, 0.35);
  glow(1150, 640, 700, BLUE, 0.35);
  ctx.fillStyle = "rgb(255 255 255 / 0.05)";
  for (let y = 12; y < CARD.height; y += 26) for (let x = 12; x < CARD.width; x += 26) ctx.fillRect(x, y, 2, 2);

  // The face.
  const h = 520;
  const w = Math.min(560, Math.round((h * kit.face.width) / kit.face.height));
  const box = { x: 56, y: (CARD.height - h) / 2, w, h: Math.round((w * kit.face.height) / kit.face.width) };
  box.y = (CARD.height - box.h) / 2;
  ctx.save();
  ctx.shadowColor = "rgb(0 0 0 / 0.55)";
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 32);
  ctx.fill();
  ctx.restore();
  drawBuiltFace(ctx, kit, drops, box);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgb(255 255 255 / 0.14)";
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, 32);
  ctx.stroke();

  // The words.
  const left = box.x + box.w + 56;
  const width = CARD.width - left - 56;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = ORANGE;
  ctx.font = `800 22px ${family}`;
  ctx.letterSpacing = "4px";
  ctx.fillText(`${options.name.toUpperCase()}'S FACE`, left, 120);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#f6f7fb";
  fitFont(ctx, `I built ${options.name}'s face`, 46, width, family);
  ctx.fillText(`I built ${options.name}'s face`, left, 180);

  const big = formatPct(Math.round(score));
  const bigPx = fitFont(ctx, big, 176, width, family);
  const grad = ctx.createLinearGradient(left, 0, left + ctx.measureText(big).width, 0);
  grad.addColorStop(0, "#ffd9b8");
  grad.addColorStop(0.45, ORANGE);
  grad.addColorStop(1, BLUE);
  ctx.fillStyle = grad;
  ctx.fillText(big, left - 4, 190 + bigPx * 0.86);

  const v = verdict(score);
  ctx.fillStyle = "#f6f7fb";
  fitFont(ctx, `right. ${v.title}`, 40, width, family);
  ctx.fillText(`right. ${v.title}`, left, 425);

  // Per-part chips (wrapping onto a second row if the name is long).
  let x = left;
  let y = 462;
  ctx.font = `700 22px ${family}`;
  for (const part of PART_ORDER) {
    const drop = drops.find((d) => d.part === part);
    if (!drop) continue;
    const text = `${PART_LABEL[part]} ${formatPct(Math.round(drop.accuracy))}`;
    const cw = ctx.measureText(text).width + 32;
    if (x > left && x + cw > CARD.width - 40) {
      x = left;
      y += 54;
    }
    ctx.fillStyle = drop.perfect ? "rgb(55 227 155 / 0.2)" : "rgb(255 255 255 / 0.08)";
    ctx.beginPath();
    ctx.roundRect(x, y, cw, 44, 22);
    ctx.fill();
    ctx.fillStyle = drop.perfect ? "#37e39b" : "#e1e5ee";
    ctx.fillText(text, x + 16, y + 30);
    x += cw + 10;
  }

  ctx.fillStyle = "#8d96ad";
  ctx.font = `600 22px ${family}`;
  ctx.fillText(options.handle ? `@${options.handle} · Play it on XApps` : "Play it on XApps", left, Math.max(568, y + 90));
  return c;
}

/** The card as a PNG blob. */
export function shareCardBlob(
  kit: FaceKit,
  drops: readonly Drop[],
  score: number,
  options: { name: string; handle?: string },
): Promise<Blob> {
  const c = renderShareCard(kit, drops, score, options);
  return new Promise((resolve, reject) =>
    c.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't render the card"))), "image/png"),
  );
}
