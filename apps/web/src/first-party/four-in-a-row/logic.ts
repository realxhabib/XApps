/**
 * Four in a Row — pure game logic. No React, no SDK, no timers.
 *
 * The whole game is a list of columns (`moves`); the grid, whose turn it is
 * and the winner are all derived by replaying it. That keeps the live sync
 * protocol trivial: two clients agree exactly when their move lists agree.
 *
 * Coordinates: `col` 0..6 left→right, `row` 0..5 bottom→top. Seat 0 always
 * moves first.
 */

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;
/** Per-move clock. */
export const TURN_MS = 30_000;

export type Seat = 0 | 1;
export type Cell = Seat | null;

export interface Coord {
  col: number;
  row: number;
}

/** A placed disc. `n` is the 0-based move index that dropped it. */
export interface Disc extends Coord {
  n: number;
  seat: Seat;
}

export interface GameState {
  moves: readonly number[];
  /** Flat grid indexed by `row * COLS + col`; row 0 is the bottom. */
  board: readonly Cell[];
  /** Discs stacked in each column. */
  heights: readonly number[];
  /** Every disc in move order (handy for rendering). */
  discs: readonly Disc[];
  /** Whose move it is next (meaningless once `over`). */
  turn: Seat;
  winner: Seat | null;
  /** Every line of ≥ 4 through the winning disc, each ordered end to end. */
  winLines: readonly (readonly Coord[])[];
  draw: boolean;
  over: boolean;
}

export type MoveError = "bad-column" | "game-over" | "wrong-turn" | "column-full";

export type MoveCheck = { ok: true; row: number } | { ok: false; reason: MoveError };

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const cellIndex = (col: number, row: number): number => row * COLS + col;

/* ------------------------------------------------------------------------ */
/* Board & moves                                                            */
/* ------------------------------------------------------------------------ */

export function newGame(): GameState {
  return {
    moves: [],
    board: new Array<Cell>(CELLS).fill(null),
    heights: new Array<number>(COLS).fill(0),
    discs: [],
    turn: 0,
    winner: null,
    winLines: [],
    draw: false,
    over: false,
  };
}

export function isColumn(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < COLS;
}

/**
 * Can `col` be played now? Pass `by` to also require that it is that seat's
 * turn (used to validate messages from the network).
 */
export function validateMove(state: GameState, col: unknown, by?: Seat): MoveCheck {
  if (!isColumn(col)) return { ok: false, reason: "bad-column" };
  if (state.over) return { ok: false, reason: "game-over" };
  if (by !== undefined && by !== state.turn) return { ok: false, reason: "wrong-turn" };
  const row = state.heights[col] as number;
  if (row >= ROWS) return { ok: false, reason: "column-full" };
  return { ok: true, row };
}

/** Returns the next state, or `null` if the move is illegal. Never mutates. */
export function playMove(state: GameState, col: unknown, by?: Seat): GameState | null {
  const check = validateMove(state, col, by);
  if (!check.ok) return null;
  const c = col as number;
  const { row } = check;
  const seat = state.turn;

  const board = state.board.slice();
  board[cellIndex(c, row)] = seat;
  const heights = state.heights.slice();
  heights[c] = row + 1;
  const moves = [...state.moves, c];
  const discs = [...state.discs, { n: state.moves.length, col: c, row, seat }];

  const winLines = findWinLines(board, c, row);
  const winner = winLines.length > 0 ? seat : null;
  const draw = winner === null && moves.length === CELLS;

  return {
    moves,
    board,
    heights,
    discs,
    turn: other(seat),
    winner,
    winLines,
    draw,
    over: winner !== null || draw,
  };
}

/** Rebuilds a game from its move list; `null` if any move is illegal. */
export function replay(moves: readonly unknown[]): GameState | null {
  let state: GameState | null = newGame();
  for (const col of moves) {
    state = playMove(state, col);
    if (!state) return null;
  }
  return state;
}

export function legalColumns(state: GameState): number[] {
  if (state.over) return [];
  const out: number[] = [];
  for (let c = 0; c < COLS; c++) if ((state.heights[c] as number) < ROWS) out.push(c);
  return out;
}

export function cellAt(board: readonly Cell[], col: number, row: number): Cell {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return null;
  return board[cellIndex(col, row)] ?? null;
}

/* ------------------------------------------------------------------------ */
/* Win / draw detection                                                     */
/* ------------------------------------------------------------------------ */

/** Right, up, up-right, down-right. Their negatives cover the other half. */
const DIRECTIONS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/**
 * Every line of four or more same-colour discs passing through (col, row),
 * each ordered from one end to the other. Empty if that cell doesn't win.
 */
export function findWinLines(board: readonly Cell[], col: number, row: number): Coord[][] {
  const seat = cellAt(board, col, row);
  if (seat === null) return [];
  const lines: Coord[][] = [];
  for (const [dc, dr] of DIRECTIONS) {
    let c = col;
    let r = row;
    // Walk back to the start of the run…
    while (cellAt(board, c - dc, r - dr) === seat) {
      c -= dc;
      r -= dr;
    }
    // …then collect it forwards.
    const line: Coord[] = [];
    while (cellAt(board, c, r) === seat) {
      line.push({ col: c, row: r });
      c += dc;
      r += dr;
    }
    if (line.length >= 4) lines.push(line);
  }
  return lines;
}

/** Scans the whole board. Useful for boards that weren't built move by move. */
export function findWinner(board: readonly Cell[]): { seat: Seat; lines: Coord[][] } | null {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const lines = findWinLines(board, col, row);
      if (lines.length > 0) return { seat: cellAt(board, col, row) as Seat, lines };
    }
  }
  return null;
}

export function isBoardFull(board: readonly Cell[]): boolean {
  return board.every((cell) => cell !== null);
}

/** `high`-scoring result for `seat`: 1 win, 0.5 draw, 0 loss; `null` while playing. */
export function scoreFor(state: GameState, seat: Seat): number | null {
  if (state.winner !== null) return state.winner === seat ? 1 : 0;
  if (state.draw) return 0.5;
  return null;
}

/* ------------------------------------------------------------------------ */
/* Live sync protocol                                                       */
/* ------------------------------------------------------------------------ */

export type RemoteMoveResult =
  | { kind: "applied"; state: GameState }
  /** Already have it — messages are re-sent, so this is normal. */
  | { kind: "duplicate" }
  /** Same index, different column: histories diverged. Ignore it. */
  | { kind: "conflict" }
  /** Its index is ahead of us — we missed a message. Ask for a sync. */
  | { kind: "gap" }
  | { kind: "invalid"; reason: MoveError | "malformed" };

/**
 * Handles `{ type: "move", payload: { n, col } }` from `from`. Moves apply
 * strictly in order and are validated (right player's turn, column not full)
 * so a bad message can never corrupt the game.
 */
export function receiveMove(state: GameState, payload: unknown, from: Seat): RemoteMoveResult {
  if (typeof payload !== "object" || payload === null) return { kind: "invalid", reason: "malformed" };
  const { n, col } = payload as { n?: unknown; col?: unknown };
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || !isColumn(col)) {
    return { kind: "invalid", reason: "malformed" };
  }
  if (n < state.moves.length) return state.moves[n] === col ? { kind: "duplicate" } : { kind: "conflict" };
  if (n > state.moves.length) return { kind: "gap" };
  const check = validateMove(state, col, from);
  if (!check.ok) return { kind: "invalid", reason: check.reason };
  return { kind: "applied", state: playMove(state, col) as GameState };
}

/** Validates an untrusted move list. */
export function parseMoves(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > CELLS) return null;
  return value.every(isColumn) ? (value.slice() as number[]) : null;
}

/**
 * Handles `{ type: "sync", payload: { moves } }`: adopt the remote history
 * only if it is longer than ours, extends ours, and is a legal game.
 */
export function mergeSync(local: GameState, remoteMoves: unknown): GameState | null {
  const moves = parseMoves(remoteMoves);
  if (!moves || moves.length <= local.moves.length) return null;
  for (let i = 0; i < local.moves.length; i++) if (moves[i] !== local.moves[i]) return null;
  return replay(moves);
}

/** Used when the clock runs out: any legal column. `random` returns [0, 1). */
export function randomLegalColumn(state: GameState, random: () => number = Math.random): number | null {
  const legal = legalColumns(state);
  if (legal.length === 0) return null;
  return legal[Math.min(legal.length - 1, Math.floor(random() * legal.length))] as number;
}

/* ------------------------------------------------------------------------ */
/* Bot: negamax + alpha-beta over a mutable Int8Array                        */
/* ------------------------------------------------------------------------ */

/** Centre-first move ordering makes alpha-beta prune far more. */
const ORDER = [3, 2, 4, 1, 5, 0, 6] as const;
export const WIN_SCORE = 1_000_000;
/** Scores beyond this are forced wins/losses found by the search. */
const DECISIVE = WIN_SCORE / 2;

/** All 69 four-cell windows as flat indices. */
const WINDOWS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      for (const [dc, dr] of DIRECTIONS) {
        const endC = col + dc * 3;
        const endR = row + dr * 3;
        if (endC < 0 || endC >= COLS || endR < 0 || endR >= ROWS) continue;
        out.push([0, 1, 2, 3].map((i) => cellIndex(col + dc * i, row + dr * i)));
      }
    }
  }
  return out;
})();

/** Search board: 0 empty, 1 seat 0, 2 seat 1. */
type Pieces = Int8Array;
const pieceOf = (seat: Seat) => seat + 1;

function toPieces(board: readonly Cell[]): Pieces {
  const b = new Int8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const cell = board[i];
    b[i] = cell === null || cell === undefined ? 0 : cell + 1;
  }
  return b;
}

function runLength(b: Pieces, col: number, row: number, dc: number, dr: number, piece: number): number {
  let n = 0;
  let c = col + dc;
  let r = row + dr;
  while (c >= 0 && c < COLS && r >= 0 && r < ROWS && b[r * COLS + c] === piece) {
    n++;
    c += dc;
    r += dr;
  }
  return n;
}

/** Would `piece` at (col, row) — already placed — make four? */
function winsAt(b: Pieces, col: number, row: number, piece: number): boolean {
  for (const [dc, dr] of DIRECTIONS) {
    if (1 + runLength(b, col, row, dc, dr, piece) + runLength(b, col, row, -dc, -dr, piece) >= 4) return true;
  }
  return false;
}

/**
 * Static evaluation from `piece`'s point of view: centre-column preference
 * plus the classic window scoring (open threes and twos), mirrored for the
 * opponent so their threats count against us (i.e. get blocked).
 */
function evaluatePieces(b: Pieces, piece: number): number {
  const opp = 3 - piece;
  let score = 0;
  for (let row = 0; row < ROWS; row++) {
    const cell = b[row * COLS + 3];
    if (cell === piece) score += 3;
    else if (cell === opp) score -= 3;
  }
  for (const w of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (let i = 0; i < 4; i++) {
      const cell = b[w[i] as number];
      if (cell === piece) mine++;
      else if (cell === opp) theirs++;
    }
    if (mine > 0 && theirs > 0) continue; // dead window
    if (mine === 3) score += 5;
    else if (mine === 2) score += 2;
    else if (theirs === 3) score -= 5;
    else if (theirs === 2) score -= 2;
  }
  return score;
}

/** Heuristic score of a position for `seat` (positive = good for `seat`). */
export function evaluate(board: readonly Cell[], seat: Seat): number {
  return evaluatePieces(toPieces(board), pieceOf(seat));
}

interface SearchStats {
  nodes: number;
}

/**
 * Negamax with alpha-beta. Returns the score for `piece` (to move). Wins are
 * `WIN_SCORE - ply`, so faster wins and slower losses are preferred.
 */
function negamax(
  b: Pieces,
  h: Int8Array,
  depth: number,
  alpha: number,
  beta: number,
  piece: number,
  ply: number,
  filled: number,
  stats: SearchStats,
): number {
  stats.nodes++;
  if (filled >= CELLS) return 0;

  // An immediate win is always the best reply — no need to search further.
  for (const c of ORDER) {
    const r = h[c] as number;
    if (r >= ROWS) continue;
    const i = r * COLS + c;
    b[i] = piece;
    const win = winsAt(b, c, r, piece);
    b[i] = 0;
    if (win) return WIN_SCORE - (ply + 1);
  }
  if (depth <= 0) return evaluatePieces(b, piece);

  let best = -Infinity;
  for (const c of ORDER) {
    const r = h[c] as number;
    if (r >= ROWS) continue;
    const i = r * COLS + c;
    b[i] = piece;
    h[c] = r + 1;
    const score = -negamax(b, h, depth - 1, -beta, -alpha, 3 - piece, ply + 1, filled + 1, stats);
    b[i] = 0;
    h[c] = r;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface RankedMove {
  col: number;
  /** From the mover's point of view. ±(WIN_SCORE - ply) for forced results. */
  score: number;
}

/**
 * Exact score of every legal move for the player to move, best first (ties
 * keep centre-first order). `depth` counts plies including the move itself.
 */
export function rankMoves(state: GameState, depth = 5, stats: SearchStats = { nodes: 0 }): RankedMove[] {
  if (state.over) return [];
  const b = toPieces(state.board);
  const h = Int8Array.from(state.heights);
  const piece = pieceOf(state.turn);
  const filled = state.moves.length;
  const ranked: RankedMove[] = [];

  for (const c of ORDER) {
    const r = h[c] as number;
    if (r >= ROWS) continue;
    const i = r * COLS + c;
    b[i] = piece;
    h[c] = r + 1;
    let score: number;
    if (winsAt(b, c, r, piece)) score = WIN_SCORE - 1;
    else if (filled + 1 >= CELLS) score = 0;
    // Full window per root move: we need exact scores to pick a runner-up.
    else score = -negamax(b, h, depth - 1, -Infinity, Infinity, 3 - piece, 1, filled + 1, stats);
    b[i] = 0;
    h[c] = r;
    ranked.push({ col: c, score });
  }
  // Array.prototype.sort is stable, so equal scores keep centre-first order.
  return ranked.sort((a, z) => z.score - a.score);
}

export interface BotOptions {
  /** Plies searched (including the move itself). Default 5. */
  depth?: number;
  /** Chance of deliberately playing the runner-up move. Default 0.15. */
  blunderChance?: number;
  /** [0, 1) source — inject a seeded one for tests. */
  random?: () => number;
}

export interface BotChoice {
  col: number;
  ranked: RankedMove[];
  /** True if the bot chose the runner-up on purpose. */
  blundered: boolean;
  nodes: number;
}

/**
 * Picks the bot's column. It always takes a win and always blocks a loss;
 * otherwise it plays the best move (random among equals), except that with
 * `blunderChance` it picks the runner-up — but only when neither choice is
 * decisive, so it stays beatable without ever throwing a game outright.
 */
export function chooseBotMove(state: GameState, options: BotOptions = {}): BotChoice | null {
  const { depth = 5, blunderChance = 0.15, random = Math.random } = options;
  const stats: SearchStats = { nodes: 0 };
  const ranked = rankMoves(state, depth, stats);
  const best = ranked[0];
  if (!best) return null;

  const ties = ranked.filter((m) => m.score === best.score);
  const pick = ties[Math.min(ties.length - 1, Math.floor(random() * ties.length))] as RankedMove;
  const runnerUp = ranked.find((m) => m.score < best.score);

  if (runnerUp && Math.abs(best.score) < DECISIVE && runnerUp.score > -DECISIVE && random() < blunderChance) {
    return { col: runnerUp.col, ranked, blundered: true, nodes: stats.nodes };
  }
  return { col: pick.col, ranked, blundered: false, nodes: stats.nodes };
}
