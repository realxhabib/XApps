import type { Random } from "@xapps/sdk";

/** A cell holds the seat (0 = X, 1 = O) that marked it, or null. */
export type Cell = 0 | 1 | null;
export type Seat = 0 | 1;

/** The shared match state: one JSON document every client (and spectator) sees. */
export type Board = {
  cells: Cell[];
  /** Winning seat, "draw", or null while the game is on. */
  winner: Seat | "draw" | null;
  /** The winning line, for highlighting. */
  line: number[] | null;
};

export const MARKS = ["X", "O"] as const;

export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

export const emptyBoard = (): Board => ({ cells: Array<Cell>(9).fill(null), winner: null, line: null });

/** Reads the shared state defensively (it's JSON from the network). */
export function readBoard(state: unknown): Board {
  if (!state || typeof state !== "object") return emptyBoard();
  const raw = state as Partial<Board>;
  if (!Array.isArray(raw.cells) || raw.cells.length !== 9) return emptyBoard();
  const cells = raw.cells.map((c) => (c === 0 || c === 1 ? c : null));
  const winner = raw.winner === 0 || raw.winner === 1 || raw.winner === "draw" ? raw.winner : null;
  const line = Array.isArray(raw.line) ? raw.line.filter((n): n is number => typeof n === "number") : null;
  return { cells, winner, line };
}

/** Seat to move next: X (seat 0) moves first, then they alternate. */
export const nextSeat = (board: Board): Seat => (board.cells.filter((c) => c !== null).length % 2 === 0 ? 0 : 1);

export function outcome(cells: Cell[]): Pick<Board, "winner" | "line"> {
  for (const line of LINES) {
    const [a, b, c] = line;
    const mark = cells[a];
    if (mark !== null && mark !== undefined && mark === cells[b] && mark === cells[c]) {
      return { winner: mark, line: [...line] };
    }
  }
  return { winner: cells.every((c) => c !== null) ? "draw" : null, line: null };
}

/** `board` with `seat` marking `cell`, or null when that move isn't legal. */
export function play(board: Board, cell: number, seat: Seat): Board | null {
  if (board.winner !== null || board.cells[cell] !== null || nextSeat(board) !== seat) return null;
  const cells = board.cells.slice();
  cells[cell] = seat;
  return { cells, ...outcome(cells) };
}

/** Practice bot: win if it can, block if it must, else center, corners, anything. */
export function botMove(board: Board, seat: Seat, rng: Random): number | null {
  const free = board.cells.flatMap((c, i) => (c === null ? [i] : []));
  if (free.length === 0) return null;
  const completes = (who: Seat) =>
    free.find((i) => {
      const cells = board.cells.slice();
      cells[i] = who;
      return outcome(cells).winner === who;
    });
  const win = completes(seat);
  if (win !== undefined) return win;
  const block = completes(seat === 0 ? 1 : 0);
  if (block !== undefined) return block;
  if (free.includes(4)) return 4;
  const corners = free.filter((i) => i === 0 || i === 2 || i === 6 || i === 8);
  return rng.pick(corners.length ? corners : free);
}
