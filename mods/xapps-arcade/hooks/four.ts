// Copied unchanged from apps/web/src/first-party/four-in-a-row/logic.ts (the web game's rules and bot).
// Copy it again when that file changes: a mod can only import files inside its own folder.

/**
 * Four in a Row — pure game logic. No React, no SDK, no timers.
 *
 * The whole game is a list of columns (`moves`); the grid, whose turn it is
 * and the winner are all derived by replaying it. The shared match state
 * stores that list (with who played each move and when), so every client —
 * and a reload days later — agrees exactly when their move lists agree.
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
/* Shared match state                                                       */
/* ------------------------------------------------------------------------ */

/** One move as stored in the shared state. `by` is the player id, `at` epoch ms. */
export type MoveRecord = { col: number; by: string; at: number };

export type StateCoord = { col: number; row: number };

/**
 * The match's shared, persisted state (`xapps.state`). `moves` is the source
 * of truth; `board`, `winner`, `draw` and `line` are derived from it on every
 * write so hosts, feeds and future server code can read the position without
 * replaying. Always JSON (no `undefined`), ≪ 64 KB.
 */
export type BoardState = {
  /** Flat grid indexed by `row * COLS + col` (row 0 = bottom): seat 0, seat 1 or null. */
  board: Cell[];
  moves: MoveRecord[];
  /** Winner's player id. */
  winner: string | null;
  draw: boolean;
  /** The winning four (or more), end to end. */
  line: StateCoord[] | null;
};

/** Player ids by seat: `[seat 0 (moves first), seat 1]`. */
export type Seats = readonly [string, string];

export interface ReadBoard {
  game: GameState;
  moves: MoveRecord[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Rebuilds the game from an untrusted shared state by replaying its moves.
 * `null`/missing state is a fresh game. Returns `null` if the state is
 * malformed, a move is illegal, or a move was made by the wrong player — so a
 * reload days later always lands on exactly the position both players saw.
 */
export function readBoardState(value: unknown, seats: Seats): ReadBoard | null {
  if (value === null || value === undefined) return { game: newGame(), moves: [] };
  if (!isRecord(value)) return null;
  const raw = value.moves ?? [];
  if (!Array.isArray(raw) || raw.length > CELLS) return null;
  let game = newGame();
  const moves: MoveRecord[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    const { col, by, at } = entry;
    if (!isColumn(col) || typeof by !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
    if (by !== seats[game.turn]) return null;
    const next = playMove(game, col);
    if (!next) return null;
    game = next;
    moves.push({ col, by, at });
  }
  return { game, moves };
}

/** Serialises a game (plus its move records) into the shared state shape. */
export function toBoardState(game: GameState, moves: readonly MoveRecord[], seats: Seats): BoardState {
  const line = game.winLines[0];
  return {
    board: game.board.slice(),
    moves: moves.map((m) => ({ col: m.col, by: m.by, at: m.at })),
    winner: game.winner === null ? null : seats[game.winner],
    draw: game.draw,
    line: line ? line.map((c) => ({ col: c.col, row: c.row })) : null,
  };
}

export type StateMoveError = MoveError | "not-your-turn" | "not-a-player" | "bad-state";

export type StateMoveResult =
  | { ok: true; state: BoardState; game: GameState }
  | { ok: false; reason: StateMoveError };

/**
 * The state reducer: applies `move` to the (untrusted) shared state. Rejects
 * moves by non-players, out of turn (by the move list, and — when the host
 * runs turns — by `turnHolder`), into full columns, after the game ended, or
 * on a corrupt state. Never mutates `value`.
 */
export function applyStateMove(
  value: unknown,
  move: { col: unknown; by: string; at: number },
  seats: Seats,
  turnHolder: string | null = null,
): StateMoveResult {
  const read = readBoardState(value, seats);
  if (!read) return { ok: false, reason: "bad-state" };
  const seat = seats.indexOf(move.by);
  if (seat !== 0 && seat !== 1) return { ok: false, reason: "not-a-player" };
  const check = validateMove(read.game, move.col, seat);
  if (!check.ok) return check;
  if (turnHolder !== null && turnHolder !== move.by) return { ok: false, reason: "not-your-turn" };
  const game = playMove(read.game, move.col, seat) as GameState;
  const moves = [...read.moves, { col: move.col as number, by: move.by, at: move.at }];
  return { ok: true, game, state: toBoardState(game, moves, seats) };
}

/**
 * When a reopened turn's clock should be treated as having started: the last
 * move's time, but never in the future and never so long ago that the player
 * gets less than `minLeftMs` (clocks differ between devices).
 */
export function resumeClockAt(moves: readonly MoveRecord[], now: number, turnMs = TURN_MS, minLeftMs = 8_000): number {
  const last = moves[moves.length - 1];
  if (!last) return now;
  return Math.min(now, Math.max(last.at, now - turnMs + minLeftMs));
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

/* ------------------------------------------------------------------------ */
/* Progress: stats & achievements (one seat's view)                          */
/* ------------------------------------------------------------------------ */

/** Achievement ids (declared in the app's manifest). */
export type FourAchievement =
  | "first_win"
  | "diagonal"
  | "quick_four"
  | "blocker"
  | "the_wall"
  | "marathon"
  | "pen_pal"
  | "long_line"
  | "double_trouble";

/** "Four in 7 moves": win with at most this many of your own discs. */
export const QUICK_FOUR_DISCS = 7;
/** "The Wall": this many blocks in one game. */
export const WALL_BLOCKS = 3;

/** Columns where `seat` would connect four if it moved there now. */
export function winningColumns(state: GameState, seat: Seat): number[] {
  if (state.over) return [];
  const out: number[] = [];
  const board = state.board.slice();
  for (let col = 0; col < COLS; col++) {
    const row = state.heights[col] as number;
    if (row >= ROWS) continue;
    const i = cellIndex(col, row);
    board[i] = seat;
    if (findWinLines(board, col, row).length > 0) out.push(col);
    board[i] = null;
  }
  return out;
}

/**
 * How many of `seat`'s moves landed where the opponent would have connected
 * four on their next move. A move that wins the game itself isn't a block.
 */
export function countBlocks(moves: readonly number[], seat: Seat): number {
  let state = newGame();
  let blocks = 0;
  for (const col of moves) {
    const mover = state.turn;
    if (mover === seat && winningColumns(state, other(seat)).includes(col)) {
      const next = playMove(state, col);
      if (next && next.winner === null) blocks++;
    }
    const next = playMove(state, col);
    if (!next) break;
    state = next;
  }
  return blocks;
}

const isDiagonal = (line: readonly Coord[]): boolean => {
  const [a, b] = line;
  return !!a && !!b && a.col !== b.col && a.row !== b.row;
};

export interface ProgressContext {
  /** A play-anytime (async) game. */
  async: boolean;
  /** The winning seat when the game ended some other way (the opponent left); defaults to the board's winner. */
  winner?: Seat | null;
}

/**
 * Achievements `seat` has earned in `game` so far. Blocks unlock the moment
 * they happen; the rest follow from how the game ended.
 */
export function earnedAchievements(game: GameState, seat: Seat, context: ProgressContext): FourAchievement[] {
  const earned: FourAchievement[] = [];
  const blocks = countBlocks(game.moves, seat);
  if (blocks >= 1) earned.push("blocker");
  if (blocks >= WALL_BLOCKS) earned.push("the_wall");
  if (game.moves.length >= CELLS) earned.push("marathon");

  const winner = context.winner !== undefined && context.winner !== null ? context.winner : game.winner;
  if (winner !== seat) return earned;
  earned.push("first_win");
  if (context.async) earned.push("pen_pal");
  // The rest need four on the board (not a win by the opponent leaving).
  if (game.winner !== seat) return earned;
  if (game.winLines.some(isDiagonal)) earned.push("diagonal");
  if (discsOf(game, seat) <= QUICK_FOUR_DISCS) earned.push("quick_four");
  if (game.winLines.some((line) => line.length >= 5)) earned.push("long_line");
  if (game.winLines.length >= 2) earned.push("double_trouble");
  return earned;
}

const discsOf = (game: GameState, seat: Seat): number => game.discs.filter((d) => d.seat === seat).length;

/** Stats to report when `seat`'s game is over (zero counters are left out). */
export function gameStats(game: GameState, seat: Seat, winner: Seat | null = game.winner): { [key: string]: number } {
  if (winner !== seat) return {};
  const stats: { [key: string]: number } = { wins: 1 };
  if (game.winner === seat) {
    stats.fastest_win = discsOf(game, seat);
    stats.longest_line = Math.max(...game.winLines.map((line) => line.length));
  }
  return stats;
}
