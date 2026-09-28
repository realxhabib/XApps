/**
 * Tiny self-contained SVG of the final board, sent as the submission's
 * `display` so feeds and results can show how the game ended.
 */
import { COLS, ROWS, cellAt, type GameState } from "./logic";
import { SEAT_COLORS } from "./geometry";

export function boardSvg(game: GameState): string {
  const cell = 22;
  const pad = 8;
  const w = COLS * cell + pad * 2;
  const h = ROWS * cell + pad * 2;
  const winning = new Set(game.winLines.flat().map((c) => `${c.col}:${c.row}`));
  const holes: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const seat = cellAt(game.board, col, row);
      const cx = pad + col * cell + cell / 2;
      const cy = pad + (ROWS - 1 - row) * cell + cell / 2;
      const fill = seat === null ? "#0b1230" : SEAT_COLORS[seat].base;
      const dim = winning.size > 0 && seat !== null && !winning.has(`${col}:${row}`) ? ' opacity="0.45"' : "";
      const ring = winning.has(`${col}:${row}`) ? ' stroke="#fff" stroke-width="2"' : "";
      holes.push(`<circle cx="${cx}" cy="${cy}" r="8.5" fill="${fill}"${dim}${ring}/>`);
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * 2}" height="${h * 2}">` +
    `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a8bff"/><stop offset="1" stop-color="#2356d8"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" rx="10" fill="url(#b)"/>` +
    holes.join("") +
    `</svg>`
  );
}

export function boardAlt(game: GameState, names: [string, string]): string {
  if (game.winner !== null) return `Final board: ${names[game.winner]} connected four in ${game.moves.length} moves.`;
  if (game.draw) return "Final board: a full-board draw.";
  return `Board after ${game.moves.length} moves.`;
}
