import { describe, expect, it } from "vitest";
import { createRandom } from "@xapps/sdk";
import {
  CELLS,
  COLS,
  ROWS,
  WIN_SCORE,
  cellAt,
  cellIndex,
  chooseBotMove,
  evaluate,
  findWinLines,
  findWinner,
  isBoardFull,
  legalColumns,
  mergeSync,
  newGame,
  parseMoves,
  playMove,
  randomLegalColumn,
  rankMoves,
  receiveMove,
  replay,
  scoreFor,
  validateMove,
  type Cell,
  type GameState,
} from "./logic";

/** Replays a sequence that must be legal. */
function game(moves: number[]): GameState {
  const state = replay(moves);
  if (!state) throw new Error(`illegal sequence ${moves.join(",")}`);
  return state;
}

/** Builds a board from a picture (top row first). R = seat 0, Y = seat 1. */
function boardFrom(rows: string[]): Cell[] {
  const board = new Array<Cell>(CELLS).fill(null);
  rows.forEach((line, i) => {
    const row = ROWS - 1 - i;
    [...line].forEach((ch, col) => {
      if (ch === "R") board[cellIndex(col, row)] = 0;
      if (ch === "Y") board[cellIndex(col, row)] = 1;
    });
  });
  return board;
}

const seeded = (label: string) => createRandom(`four-in-a-row-test:${label}`).next;

/** A full 42-move game with no four anywhere. */
const DRAW = [4, 0, 2, 6, 6, 0, 2, 6, 6, 0, 0, 2, 0, 0, 5, 1, 5, 4, 2, 4, 2, 3, 1, 5, 6, 1, 4, 2, 5, 5, 1, 1, 1, 5, 6, 3, 3, 3, 4, 3, 3, 4];

describe("board & moves", () => {
  it("starts empty with seat 0 to move", () => {
    const s = newGame();
    expect(s.moves).toEqual([]);
    expect(s.turn).toBe(0);
    expect(s.over).toBe(false);
    expect(s.board.every((c) => c === null)).toBe(true);
    expect(legalColumns(s)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("drops discs to the lowest free row and alternates turns", () => {
    const s = game([3, 3, 3, 2]);
    expect(cellAt(s.board, 3, 0)).toBe(0);
    expect(cellAt(s.board, 3, 1)).toBe(1);
    expect(cellAt(s.board, 3, 2)).toBe(0);
    expect(cellAt(s.board, 2, 0)).toBe(1);
    expect(s.heights[3]).toBe(3);
    expect(s.turn).toBe(0);
    expect(s.discs.map((d) => [d.n, d.col, d.row, d.seat])).toEqual([
      [0, 3, 0, 0],
      [1, 3, 1, 1],
      [2, 3, 2, 0],
      [3, 2, 0, 1],
    ]);
  });

  it("never mutates the previous state", () => {
    const a = game([0, 1]);
    const b = playMove(a, 2);
    expect(b).not.toBeNull();
    expect(a.moves).toEqual([0, 1]);
    expect(cellAt(a.board, 2, 0)).toBeNull();
  });

  it("validates columns, turns, full columns and finished games", () => {
    const s = newGame();
    for (const bad of [-1, 7, 1.5, Number.NaN, "3", null, undefined]) {
      expect(validateMove(s, bad)).toEqual({ ok: false, reason: "bad-column" });
      expect(playMove(s, bad)).toBeNull();
    }
    expect(validateMove(s, 0, 1)).toEqual({ ok: false, reason: "wrong-turn" });
    expect(validateMove(s, 0, 0)).toEqual({ ok: true, row: 0 });

    const full = game([0, 0, 0, 0, 0, 0]);
    expect(validateMove(full, 0)).toEqual({ ok: false, reason: "column-full" });
    expect(legalColumns(full)).toEqual([1, 2, 3, 4, 5, 6]);

    const won = game([0, 6, 1, 6, 2, 6, 3]);
    expect(validateMove(won, 4)).toEqual({ ok: false, reason: "game-over" });
    expect(legalColumns(won)).toEqual([]);
  });

  it("replays legal sequences and rejects illegal ones", () => {
    expect(replay([3, 3, 4])?.moves).toEqual([3, 3, 4]);
    expect(replay([0, 0, 0, 0, 0, 0, 0])).toBeNull(); // 7th disc in a 6-row column
    expect(replay([0, 6, 1, 6, 2, 6, 3, 5])).toBeNull(); // move after a win
    expect(replay([9])).toBeNull();
  });
});

describe("win detection", () => {
  it("finds a horizontal four and returns its cells in order", () => {
    const s = game([0, 0, 1, 1, 2, 2, 3]);
    expect(s.winner).toBe(0);
    expect(s.over).toBe(true);
    expect(s.winLines).toEqual([
      [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
        { col: 2, row: 0 },
        { col: 3, row: 0 },
      ],
    ]);
  });

  it("finds a vertical four for seat 1", () => {
    const s = game([0, 6, 1, 6, 2, 6, 4, 6]);
    expect(s.winner).toBe(1);
    expect(s.winLines[0]).toEqual([0, 1, 2, 3].map((row) => ({ col: 6, row })));
  });

  it("finds both diagonals", () => {
    const rising = boardFrom([
      ".......",
      ".......",
      "...R...",
      "..RY...",
      ".RYY...",
      "RYYR...",
    ]);
    expect(findWinLines(rising, 3, 3)).toEqual([[0, 1, 2, 3].map((i) => ({ col: i, row: i }))]);

    const falling = boardFrom([
      ".......",
      ".......",
      "...Y...",
      "...RY..",
      "...RRY.",
      "...RRRY",
    ]);
    const lines = findWinLines(falling, 5, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([
      { col: 3, row: 3 },
      { col: 4, row: 2 },
      { col: 5, row: 1 },
      { col: 6, row: 0 },
    ]);
    expect(findWinner(falling)?.seat).toBe(1);
  });

  it("returns every cell of a five-long line and every line of a double win", () => {
    // Filling the gap in R R _ R R makes five.
    const five = game([0, 0, 1, 1, 3, 3, 4, 4, 2]);
    expect(five.winner).toBe(0);
    expect(five.winLines[0]).toHaveLength(5);

    const double = boardFrom([
      ".......",
      ".......",
      "...R...",
      "...R...",
      "...R...",
      "RRRRYYY",
    ]);
    expect(findWinLines(double, 3, 0)).toHaveLength(2);
  });

  it("does not count three, or lines that wrap around the board edge", () => {
    expect(game([0, 0, 1, 1, 2]).winner).toBeNull();
    // Flat indices 5,6,7,8 are contiguous but span two rows — not a line.
    const wrap = boardFrom([
      ".......",
      ".......",
      ".......",
      ".......",
      "RR.....",
      ".....RR",
    ]);
    expect(findWinner(wrap)).toBeNull();
  });

  it("detects a draw on a full board with no four", () => {
    const s = game(DRAW);
    expect(s.moves).toHaveLength(CELLS);
    expect(s.winner).toBeNull();
    expect(s.draw).toBe(true);
    expect(s.over).toBe(true);
    expect(isBoardFull(s.board)).toBe(true);
    expect(findWinner(s.board)).toBeNull();
    expect(legalColumns(s)).toEqual([]);
  });

  it("scores 1 / 0.5 / 0", () => {
    const won = game([0, 6, 1, 6, 2, 6, 3]);
    expect(scoreFor(won, 0)).toBe(1);
    expect(scoreFor(won, 1)).toBe(0);
    const drawn = game(DRAW);
    expect(scoreFor(drawn, 0)).toBe(0.5);
    expect(scoreFor(drawn, 1)).toBe(0.5);
    expect(scoreFor(game([3]), 0)).toBeNull();
  });

  it("reports a win, not a draw, when the 42nd disc makes four", () => {
    const lastDiscWins = [3, 2, 0, 0, 6, 0, 0, 5, 5, 0, 5, 1, 1, 3, 2, 0, 5, 5, 2, 6, 5, 4, 2, 2, 6, 6, 2, 4, 6, 6, 3, 4, 4, 3, 4, 1, 1, 3, 1, 3, 4, 1];
    const s = game(lastDiscWins);
    expect(isBoardFull(s.board)).toBe(true);
    expect(s.winner).toBe(1);
    expect(s.draw).toBe(false);
    expect(s.over).toBe(true);
  });
});

describe("live sync protocol", () => {
  const base = game([3, 3]); // seat 0 to move, n = 2

  it("applies the next move from the right player", () => {
    const r = receiveMove(base, { n: 2, col: 4 }, 0);
    expect(r.kind).toBe("applied");
    if (r.kind === "applied") expect(r.state.moves).toEqual([3, 3, 4]);
  });

  it("ignores duplicates and flags conflicts", () => {
    expect(receiveMove(base, { n: 1, col: 3 }, 1)).toEqual({ kind: "duplicate" });
    expect(receiveMove(base, { n: 1, col: 5 }, 1)).toEqual({ kind: "conflict" });
  });

  it("detects gaps", () => {
    expect(receiveMove(base, { n: 3, col: 0 }, 1)).toEqual({ kind: "gap" });
  });

  it("rejects out-of-turn, full-column, post-game and malformed moves", () => {
    expect(receiveMove(base, { n: 2, col: 4 }, 1)).toEqual({ kind: "invalid", reason: "wrong-turn" });
    const full = game([0, 0, 0, 0, 0, 0]);
    expect(receiveMove(full, { n: 6, col: 0 }, 0)).toEqual({ kind: "invalid", reason: "column-full" });
    const won = game([0, 6, 1, 6, 2, 6, 3]);
    expect(receiveMove(won, { n: 7, col: 6 }, 1)).toEqual({ kind: "invalid", reason: "game-over" });
    for (const junk of [null, 3, "x", {}, { n: -1, col: 0 }, { n: 2, col: 7 }, { n: 2.5, col: 1 }, { n: "2", col: 1 }]) {
      expect(receiveMove(base, junk, 0)).toEqual({ kind: "invalid", reason: "malformed" });
    }
  });

  it("recovers from a dropped message via sync", () => {
    // Local missed move #2; the opponent's history is longer and consistent.
    const local = game([3, 3]);
    expect(receiveMove(local, { n: 3, col: 2 }, 1).kind).toBe("gap");
    const merged = mergeSync(local, [3, 3, 4, 2]);
    expect(merged?.moves).toEqual([3, 3, 4, 2]);
    expect(merged?.turn).toBe(0);
  });

  it("only adopts longer, consistent, legal histories", () => {
    const local = game([3, 3, 4]);
    expect(mergeSync(local, [3, 3])).toBeNull(); // shorter
    expect(mergeSync(local, [3, 3, 4])).toBeNull(); // same
    expect(mergeSync(local, [3, 2, 4, 4])).toBeNull(); // diverges
    expect(mergeSync(game([]), [0, 0, 0, 0, 0, 0, 0])).toBeNull(); // illegal
    expect(mergeSync(game([]), [0, 6, 1, 6, 2, 6, 3, 1])).toBeNull(); // continues after a win
    expect(mergeSync(local, "3,3,4,5")).toBeNull();
    expect(mergeSync(local, [3, 3, 4, "5"])).toBeNull();
    expect(mergeSync(game([]), [3, 3])?.moves).toEqual([3, 3]); // e.g. after a reload
  });

  it("parses move lists defensively", () => {
    expect(parseMoves([0, 6, 3])).toEqual([0, 6, 3]);
    expect(parseMoves([0, 7])).toBeNull();
    expect(parseMoves(new Array(CELLS + 1).fill(0))).toBeNull();
    expect(parseMoves({ length: 1, 0: 1 })).toBeNull();
  });

  it("two clients converge regardless of duplicate delivery", () => {
    const random = seeded("converge");
    let a = newGame();
    let b = newGame();
    while (!a.over) {
      const mover = a.turn;
      const col = randomLegalColumn(a, random) as number;
      const payload = { n: a.moves.length, col };
      const next = playMove(a, col, mover) as GameState;
      a = next;
      // Deliver twice — the second is a duplicate.
      const first = receiveMove(b, payload, mover);
      expect(first.kind).toBe("applied");
      if (first.kind === "applied") b = first.state;
      expect(receiveMove(b, payload, mover).kind).toBe("duplicate");
    }
    expect(b.moves).toEqual(a.moves);
    expect(b.winner).toBe(a.winner);
    expect(b.draw).toBe(a.draw);
  });
});

describe("timeouts", () => {
  it("auto-plays only legal columns", () => {
    const s = game([0, 0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6]);
    const random = seeded("timeout");
    for (let i = 0; i < 200; i++) {
      const col = randomLegalColumn(s, random);
      expect(col).not.toBeNull();
      expect([1, 2, 3, 4, 5]).toContain(col);
    }
    expect(randomLegalColumn(game(DRAW))).toBeNull();
    expect(randomLegalColumn(s, () => 0.999999)).toBe(5);
  });
});

describe("bot", () => {
  const strict = { blunderChance: 0, random: seeded("strict") };
  const sloppy = { blunderChance: 1, random: seeded("sloppy") };

  it("evaluates symmetrically and prefers the centre", () => {
    const s = game([3, 0, 2]);
    expect(evaluate(s.board, 0)).toBe(-evaluate(s.board, 1));
    expect(evaluate(s.board, 0)).toBeGreaterThan(0);
    expect(chooseBotMove(newGame(), strict)?.col).toBe(3);
  });

  it("takes an immediate horizontal win", () => {
    const s = game([0, 6, 1, 6, 2, 5]); // R R R _ on the bottom row
    expect(chooseBotMove(s, strict)?.col).toBe(3);
    expect(chooseBotMove(s, sloppy)?.col).toBe(3);
    expect(rankMoves(s)[0]).toEqual({ col: 3, score: WIN_SCORE - 1 });
  });

  it("takes an immediate vertical win", () => {
    const s = game([0, 1, 0, 1, 0, 2]);
    expect(chooseBotMove(s, strict)?.col).toBe(0);
    expect(chooseBotMove(s, sloppy)?.col).toBe(0);
  });

  it("takes an immediate diagonal win", () => {
    //  .......
    //  .......
    //  ....R..
    //  ..Y.R..
    //  ..RRY..
    //  YRYYR.Y   red plays col 3 → (1,0)(2,1)(3,2)(4,3)
    const s = game([4, 3, 1, 4, 4, 2, 3, 0, 2, 6, 4, 2]);
    expect(s.turn).toBe(0);
    expect(chooseBotMove(s, strict)?.col).toBe(3);
    expect(chooseBotMove(s, sloppy)?.col).toBe(3);
  });

  it("blocks an immediate horizontal loss", () => {
    const s = game([0, 6, 1, 6, 2]); // yellow to move, red threatens col 3
    expect(s.turn).toBe(1);
    expect(chooseBotMove(s, strict)?.col).toBe(3);
    expect(chooseBotMove(s, sloppy)?.col).toBe(3);
  });

  it("blocks an immediate vertical loss", () => {
    const s = game([0, 1, 0, 1, 0]);
    expect(chooseBotMove(s, strict)?.col).toBe(0);
    expect(chooseBotMove(s, sloppy)?.col).toBe(0);
  });

  it("blocks an immediate diagonal loss", () => {
    //  .......
    //  ....R..
    //  ....YY.
    //  ....YR.
    //  ....RR.
    //  ..YYRYR   yellow threatens col 3 → (2,0)(3,1)(4,2)(5,3)
    const s = game([4, 3, 4, 4, 6, 5, 5, 4, 5, 5, 4, 2]);
    expect(s.turn).toBe(0);
    expect(chooseBotMove(s, strict)?.col).toBe(3);
    expect(chooseBotMove(s, sloppy)?.col).toBe(3);
  });

  it("prefers its own win over blocking", () => {
    //  .Y.R...
    //  .Y.R.Y.
    //  RY.RYRR   yellow can win at col 1; red threatens col 3
    const s = game([3, 1, 3, 1, 0, 4, 5, 1, 3, 5, 6]);
    expect(s.turn).toBe(1);
    expect(chooseBotMove(s, strict)?.col).toBe(1);
    expect(chooseBotMove(s, sloppy)?.col).toBe(1);
  });

  it("won't play under an opponent's threat", () => {
    //  RRR...Y
    //  RRY..YY   yellow must not play col 3: red would win on top of it
    const s = game([1, 2, 0, 5, 2, 6, 0, 6, 1]);
    for (let i = 0; i < 20; i++) {
      expect(chooseBotMove(s, { blunderChance: 0.5, random: seeded(`under-${i}`) })?.col).not.toBe(3);
    }
  });

  it("only ever returns legal columns, even on a nearly full board", () => {
    const s = game(DRAW.slice(0, 40));
    const choice = chooseBotMove(s, strict);
    expect(choice && legalColumns(s)).toContain(choice?.col);
    expect(chooseBotMove(game(DRAW))).toBeNull();
  });

  it("sometimes plays the runner-up, but never when it matters", () => {
    const s = game([3, 3, 2]);
    const cols = new Set<number>();
    const random = seeded("variety");
    let blunders = 0;
    for (let i = 0; i < 200; i++) {
      const choice = chooseBotMove(s, { random });
      if (choice) cols.add(choice.col);
      if (choice?.blundered) blunders++;
    }
    expect(cols.size).toBeGreaterThan(1);
    expect(blunders / 200).toBeGreaterThan(0.07);
    expect(blunders / 200).toBeLessThan(0.25);
  });

  it("beats a random player nearly every time", () => {
    const random = seeded("vs-random");
    let botWins = 0;
    const games = 20;
    for (let g = 0; g < games; g++) {
      const botSeat = g % 2;
      let s = newGame();
      while (!s.over) {
        const col = s.turn === botSeat ? (chooseBotMove(s, { random })?.col as number) : (randomLegalColumn(s, random) as number);
        s = playMove(s, col) as GameState;
      }
      if (s.winner === botSeat) botWins++;
    }
    expect(botWins).toBeGreaterThanOrEqual(games - 1);
  });

  it("thinks fast enough to never block the main thread noticeably", () => {
    const random = seeded("perf");
    // Warm up the JIT once.
    chooseBotMove(newGame(), { random });
    let worst = 0;
    let total = 0;
    let samples = 0;
    for (let g = 0; g < 30; g++) {
      let s = newGame();
      const plies = Math.floor(random() * 24);
      for (let i = 0; i < plies && !s.over; i++) s = playMove(s, randomLegalColumn(s, random)) as GameState;
      if (s.over) continue;
      const t = performance.now();
      chooseBotMove(s, { random });
      const dt = performance.now() - t;
      worst = Math.max(worst, dt);
      total += dt;
      samples++;
    }
    // Typically ~1 ms average / <10 ms worst; generous bounds for slow CI.
    expect(total / samples).toBeLessThan(40);
    expect(worst).toBeLessThan(150);
  });

  it("covers every column exactly once in its ranking", () => {
    const ranked = rankMoves(game([3]));
    expect(ranked.map((m) => m.col).sort()).toEqual([...Array(COLS).keys()]);
  });
});
