/**
 * The entry picture: the final table as a small SVG (what feeds and match
 * cards show), plus its alt text. Pure.
 */

import { R, TABLE_L, TABLE_W } from "./physics";
import { BALL_COLORS, BORDER } from "./render";
import type { Game, Seat } from "./rules";

const hex = (id: number) => {
  const [r, g, b] = BALL_COLORS[id] ?? [200, 200, 200];
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

export function tableSvg(game: Game): string {
  const k = 200; // px per metre
  const w = (TABLE_L + 2 * BORDER) * k;
  const h = (TABLE_W + 2 * BORDER) * k;
  const x = (m: number) => ((m + BORDER) * k).toFixed(1);
  const y = (m: number) => ((TABLE_W - m + BORDER) * k).toFixed(1);
  const r = (R * k).toFixed(1);
  const pockets: [number, number][] = [
    [0, 0],
    [TABLE_L / 2, -0.02],
    [TABLE_L, 0],
    [TABLE_L, TABLE_W],
    [TABLE_L / 2, TABLE_W + 0.02],
    [0, TABLE_W],
  ];
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">`,
    `<rect width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="14" fill="#5c2c13"/>`,
    `<rect x="${(BORDER * k - 8).toFixed(1)}" y="${(BORDER * k - 8).toFixed(1)}" width="${(TABLE_L * k + 16).toFixed(1)}" height="${(TABLE_W * k + 16).toFixed(1)}" fill="#1b8057"/>`,
    `<rect x="${(BORDER * k).toFixed(1)}" y="${(BORDER * k).toFixed(1)}" width="${(TABLE_L * k).toFixed(1)}" height="${(TABLE_W * k).toFixed(1)}" fill="#17744e"/>`,
    ...pockets.map(([px, py]) => `<circle cx="${x(px)}" cy="${y(py)}" r="12" fill="#050505"/>`),
  ];
  game.balls.forEach((b, id) => {
    if (!b) return;
    const cx = x(b.x);
    const cy = y(b.y);
    if (id >= 9) {
      // White ball with a coloured band across the middle.
      parts.push(`<clipPath id="b${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f6f3ea"/>`);
      parts.push(
        `<rect x="${(Number(cx) - R * k).toFixed(1)}" y="${(Number(cy) - R * k * 0.55).toFixed(1)}" width="${(2 * R * k).toFixed(1)}" height="${(R * k * 1.1).toFixed(1)}" fill="${hex(id)}" clip-path="url(#b${id})"/>`,
      );
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${hex(id)}"/>`);
    }
  });
  parts.push("</svg>");
  return parts.join("");
}

export function tableAlt(game: Game, names: [string, string], outcome: { winner: Seat; reason: string }): string {
  const left = game.balls.filter((b, id) => b && id > 0).length;
  const how =
    outcome.reason === "eight"
      ? "sank the 8"
      : outcome.reason === "golden_break"
        ? "sank the 8 on the break"
        : outcome.reason === "abandon"
          ? "won when the opponent left"
          : "won on an 8-ball foul";
  return `8-Ball: ${names[outcome.winner]} ${how} after ${game.n} shots, ${left} ball${left === 1 ? "" : "s"} left on the table.`;
}
