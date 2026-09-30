/**
 * Paints the dartboard into a canvas once per size: sisal fibre texture,
 * regulation colours, a raised wire spider with a metallic sheen, the numbers
 * ring and a warm key light from the top left. The result is a static bitmap
 * the stage can scale and move with GPU transforms (no per-frame filters).
 */

import { ORDER, RADIUS, SEGMENT_DEG, VIEW, wireAngle } from "./board";

const COLORS = {
  dark: [30, 27, 24],
  cream: [236, 222, 186],
  red: [206, 36, 42],
  green: [14, 128, 72],
  ring: [18, 17, 16],
} as const;

type Rgb = readonly [number, number, number];

const RINGS: { inner: number; outer: number; kind: "single" | "bed" }[] = [
  { inner: RADIUS.outerBull, outer: RADIUS.trebleInner, kind: "single" },
  { inner: RADIUS.trebleInner, outer: RADIUS.trebleOuter, kind: "bed" },
  { inner: RADIUS.trebleOuter, outer: RADIUS.doubleInner, kind: "single" },
  { inner: RADIUS.doubleInner, outer: RADIUS.doubleOuter, kind: "bed" },
];

const rgb = (c: Rgb, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Integer hash → [0, 1). */
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise. */
function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function wedge(ctx: CanvasRenderingContext2D, inner: number, outer: number, fromDeg: number, toDeg: number) {
  // Board angles are clockwise from up; canvas angles are clockwise from +x.
  const a0 = ((fromDeg - 90) * Math.PI) / 180;
  const a1 = ((toDeg - 90) * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(0, 0, outer, a0, a1);
  ctx.arc(0, 0, inner, a1, a0, true);
  ctx.closePath();
}

/**
 * Paints the board filling a `px`×`px` canvas (device pixels), which shows
 * the square from -VIEW to +VIEW mm.
 */
export function paintBoard(ctx: CanvasRenderingContext2D, px: number): void {
  const s = px / (2 * VIEW);
  ctx.save();
  ctx.clearRect(0, 0, px, px);
  ctx.translate(px / 2, px / 2);
  ctx.scale(s, s);

  // Drop shadow on the wall behind the board.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.65)";
  ctx.shadowBlur = 26 * s;
  ctx.shadowOffsetX = 6 * s;
  ctx.shadowOffsetY = 12 * s;
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.edge, 0, Math.PI * 2);
  ctx.fillStyle = rgb(COLORS.ring);
  ctx.fill();
  ctx.restore();

  // Numbers ring: black with a faint radial sheen.
  const ringGrad = ctx.createRadialGradient(0, 0, RADIUS.doubleOuter, 0, 0, RADIUS.edge);
  ringGrad.addColorStop(0, "#161514");
  ringGrad.addColorStop(0.7, "#1d1c1a");
  ringGrad.addColorStop(1, "#0d0c0b");
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.edge, 0, Math.PI * 2);
  ctx.fillStyle = ringGrad;
  ctx.fill();

  // Segments.
  ORDER.forEach((_, i) => {
    const from = wireAngle(i);
    const to = from + SEGMENT_DEG;
    const even = i % 2 === 0;
    for (const ring of RINGS) {
      wedge(ctx, ring.inner, ring.outer, from, to);
      const color = ring.kind === "single" ? (even ? COLORS.dark : COLORS.cream) : even ? COLORS.red : COLORS.green;
      ctx.fillStyle = rgb(color);
      ctx.fill();
    }
  });
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.outerBull, 0, Math.PI * 2);
  ctx.fillStyle = rgb(COLORS.green);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.bull, 0, Math.PI * 2);
  ctx.fillStyle = rgb(COLORS.red);
  ctx.fill();
  ctx.restore();

  sisal(ctx, px);

  ctx.save();
  ctx.translate(px / 2, px / 2);
  ctx.scale(s, s);
  lighting(ctx);
  wires(ctx, s);
  numbers(ctx);
  rim(ctx);
  ctx.restore();
}

/** Compressed sisal fibres: a fine speckle, a radial grain and soft mottling. */
function sisal(ctx: CanvasRenderingContext2D, px: number) {
  const s = px / (2 * VIEW);
  const half = px / 2;
  const reach = Math.ceil(RADIUS.edge * s);
  const x0 = Math.max(0, Math.floor(half - reach));
  const size = Math.min(px - x0, reach * 2);
  if (size <= 0) return;
  let image: ImageData;
  try {
    image = ctx.getImageData(x0, x0, size, size);
  } catch {
    return;
  }
  const data = image.data;
  const scoring = RADIUS.doubleOuter * s;
  const edge = RADIUS.edge * s;
  const mm = 1 / s;
  for (let y = 0; y < size; y++) {
    const dy = y + x0 - half + 0.5;
    for (let x = 0; x < size; x++) {
      const dx = x + x0 - half + 0.5;
      const r = Math.hypot(dx, dy);
      if (r > edge) continue;
      const i = (y * size + x) * 4;
      if (data[i + 3]! === 0) continue;
      const rm = r * mm;
      let k: number;
      if (r <= scoring) {
        const theta = Math.atan2(dy, dx);
        // Fibres are end-on: tight speckle, streaked slightly along the radius.
        const speckle = hash(x + x0, y + x0) - 0.5;
        const grain = noise(rm * 1.1, theta * rm * 3.2) - 0.5;
        const mottle = noise((dx * mm) / 14 + 40, (dy * mm) / 14 + 40) - 0.5;
        k = 1 + speckle * 0.2 + grain * 0.2 + mottle * 0.1;
      } else {
        // The numbers ring is smoother rubber.
        k = 1 + (hash(x + x0, y + x0) - 0.5) * 0.08;
      }
      data[i] = Math.max(0, Math.min(255, data[i]! * k));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! * k));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! * k));
    }
  }
  ctx.putImageData(image, x0, x0);
}

/** A warm key light from the top left and a soft falloff to the bottom right. */
function lighting(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.edge, 0, Math.PI * 2);
  ctx.clip();
  const key = ctx.createRadialGradient(-70, -95, 10, -40, -60, RADIUS.edge * 1.35);
  key.addColorStop(0, "rgba(255,244,222,0.2)");
  key.addColorStop(0.45, "rgba(255,240,215,0.06)");
  key.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = key;
  ctx.fillRect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);
  const fall = ctx.createLinearGradient(-RADIUS.edge, -RADIUS.edge, RADIUS.edge, RADIUS.edge);
  fall.addColorStop(0, "rgba(0,0,0,0)");
  fall.addColorStop(0.55, "rgba(0,0,0,0.05)");
  fall.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = fall;
  ctx.fillRect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);
  // Vignette at the very edge of the sisal (the board is slightly domed).
  const dome = ctx.createRadialGradient(0, 0, RADIUS.doubleInner, 0, 0, RADIUS.edge);
  dome.addColorStop(0, "rgba(0,0,0,0)");
  dome.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = dome;
  ctx.fillRect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);
  ctx.restore();
}

/** Raised round wire: a cast shadow, the wire, and a specular line on its lit side. */
function wires(ctx: CanvasRenderingContext2D, s: number) {
  const width = Math.max(0.8, 1.3 / s);
  const passes: { dx: number; dy: number; color: string; w: number }[] = [
    { dx: 0.55, dy: 0.8, color: "rgba(0,0,0,0.55)", w: width * 1.25 },
    { dx: 0, dy: 0, color: "#9aa1aa", w: width },
    { dx: -0.18, dy: -0.26, color: "rgba(255,255,255,0.85)", w: width * 0.38 },
  ];
  const circles = [RADIUS.bull, RADIUS.outerBull, RADIUS.trebleInner, RADIUS.trebleOuter, RADIUS.doubleInner, RADIUS.doubleOuter];
  for (const pass of passes) {
    ctx.save();
    ctx.translate(pass.dx, pass.dy);
    ctx.strokeStyle = pass.color;
    ctx.lineWidth = pass.w;
    ctx.lineCap = "round";
    for (const r of circles) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < ORDER.length; i++) {
      const a = ((wireAngle(i) - 90) * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * RADIUS.outerBull, Math.sin(a) * RADIUS.outerBull);
      ctx.lineTo(Math.cos(a) * (RADIUS.doubleOuter + 6), Math.sin(a) * (RADIUS.doubleOuter + 6));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** Upright chrome numbers around the ring. */
function numbers(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `800 ${24}px ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif`;
  ORDER.forEach((n, i) => {
    const a = ((i * SEGMENT_DEG - 90) * Math.PI) / 180;
    const x = Math.cos(a) * RADIUS.numbers;
    const y = Math.sin(a) * RADIUS.numbers;
    const label = String(n);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillText(label, x + 1.2, y + 1.8);
    const g = ctx.createLinearGradient(x, y - 12, x, y + 12);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, "#d9dde3");
    g.addColorStop(0.55, "#aeb4bd");
    g.addColorStop(1, "#eef0f3");
    ctx.fillStyle = g;
    ctx.fillText(label, x, y);
  });
  ctx.restore();
}

/** Chrome band around the edge of the board. */
function rim(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(-RADIUS.edge, -RADIUS.edge, RADIUS.edge, RADIUS.edge);
  g.addColorStop(0, "#f4f6f8");
  g.addColorStop(0.35, "#8c939c");
  g.addColorStop(0.6, "#dde1e6");
  g.addColorStop(1, "#4a4f57");
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.edge - 1.6, 0, Math.PI * 2);
  ctx.strokeStyle = g;
  ctx.lineWidth = 3.2;
  ctx.stroke();
  // A thin number-ring wire just outside the doubles.
  ctx.beginPath();
  ctx.arc(0, 0, RADIUS.doubleOuter + 6, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(170,176,186,0.55)";
  ctx.lineWidth = 0.9;
  ctx.stroke();
}
