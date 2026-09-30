/**
 * Tiny self-contained SVG of both racks at the end, sent as the submission's
 * `display` so feeds and results can show how the game finished.
 */

import { CUP_GAP, TABLE_L, TABLE_W, cupWorld, type Seat } from "./geometry";
import type { GameState } from "./logic";

export function cupsSvg(game: GameState): string {
  // Top-down: seat 0's end at the bottom, seat 1's at the top.
  const scale = 150; // px per metre
  const w = TABLE_W * scale + 20;
  const h = TABLE_L * scale * 0.62 + 20;
  const r = (CUP_GAP / 2) * scale * 0.92;
  const y = (z: number) => {
    // Squash the empty middle of the table: map each rack's third linearly.
    const t = z / TABLE_L;
    const squashed = t < 0.5 ? t * 0.62 : 1 - (1 - t) * 0.62;
    return 10 + (1 - squashed) * (h - 20) * 1;
  };
  const cups: string[] = [];
  for (const seat of [0, 1] as Seat[]) {
    for (const cup of game.racks[seat]) {
      const p = cupWorld(seat, cup);
      const cx = (w / 2 + p.x * scale).toFixed(1);
      const cy = y(p.z).toFixed(1);
      cups.push(
        `<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="#e3182c" stroke="#fff" stroke-width="2"/>` +
          `<circle cx="${cx}" cy="${cy}" r="${(r * 0.62).toFixed(1)}" fill="#43b6ff" opacity="0.85"/>`,
      );
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" width="${(w * 2).toFixed(0)}" height="${(h * 2).toFixed(0)}">` +
    `<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a8652f"/><stop offset="0.5" stop-color="#c7864b"/><stop offset="1" stop-color="#a8652f"/></linearGradient></defs>` +
    `<rect width="${w.toFixed(0)}" height="${h.toFixed(0)}" rx="10" fill="url(#t)"/>` +
    `<rect x="3" y="3" width="${(w - 6).toFixed(0)}" height="${(h - 6).toFixed(0)}" rx="8" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="2"/>` +
    `<line x1="${(w / 2).toFixed(0)}" y1="3" x2="${(w / 2).toFixed(0)}" y2="${(h - 3).toFixed(0)}" stroke="#fff" stroke-opacity="0.85" stroke-width="1.5"/>` +
    cups.join("") +
    `</svg>`
  );
}

export function cupsAlt(game: GameState, names: [string, string], winner: Seat | null): string {
  const left = (s: Seat) => game.racks[s].length;
  if (winner === null) return `Cup Pong: ${names[0]} ${left(0)} cups left, ${names[1]} ${left(1)} cups left.`;
  const loser: Seat = winner === 0 ? 1 : 0;
  return `Cup Pong: ${names[winner]} cleared the table with ${left(winner)} of their own cups left; ${names[loser]} had ${left(loser)}.`;
}
