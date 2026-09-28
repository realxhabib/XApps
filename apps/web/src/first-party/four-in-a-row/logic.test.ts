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
  newGame,
  playMove,
  randomLegalColumn,
  rankMoves,
  readBoardState,
  replay,
  resumeClockAt,
  scoreFor,
  applyStateMove,
  validateMove,
  type BoardState,
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

describe("shared match state", () => {
  const SEATS = ["alice", "bob"] as const;
  const T0 = 1_760_000_000_000;

  /** Plays `cols` through the reducer, alternating seats, starting from `state`. */
  function playState(cols: number[], state: unknown = null): BoardState {
    let cur = state;
    for (const col of cols) {
      const read = readBoardState(cur, SEATS);
      if (!read) throw new Error("unreadable state");
      const by = SEATS[read.game.turn];
      const res = applyStateMove(cur, { col, by, at: T0 + read.moves.length * 1000 }, SEATS, by);
      if (!res.ok) throw new Error(`move ${col} rejected: ${res.reason}`);
      cur = res.state;
    }
    return cur as BoardState;
  }

  it("treats a missing state as a fresh game", () => {
    for (const empty of [null, undefined, {}]) {
      const read = readBoardState(empty, SEATS);
      expect(read?.moves).toEqual([]);
      expect(read?.game.turn).toBe(0);
    }
  });

  it("applies moves, recording who played and when, and derives the board", () => {
    const res = applyStateMove(null, { col: 3, by: "alice", at: T0 }, SEATS, "alice");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.moves).toEqual([{ col: 3, by: "alice", at: T0 }]);
    expect(res.state.board[cellIndex(3, 0)]).toBe(0);
    expect(res.state.board.filter((c) => c !== null)).toHaveLength(1);
    expect(res.state).toMatchObject({ winner: null, draw: false, line: null });
    expect(res.game.turn).toBe(1);

    const next = applyStateMove(res.state, { col: 3, by: "bob", at: T0 + 5 }, SEATS, "bob");
    expect(next.ok && next.state.board[cellIndex(3, 1)]).toBe(1);
  });

  it("is JSON-safe and never mutates the previous state", () => {
    const before = playState([3, 4]);
    const snapshot = JSON.stringify(before);
    const res = applyStateMove(before, { col: 2, by: "alice", at: T0 }, SEATS);
    expect(res.ok).toBe(true);
    expect(JSON.stringify(before)).toBe(snapshot);
    if (res.ok) expect(JSON.parse(JSON.stringify(res.state))).toEqual(res.state);
  });

  it("rejects moves out of turn", () => {
    const s = playState([3]); // bob to move
    expect(applyStateMove(s, { col: 2, by: "alice", at: T0 }, SEATS)).toEqual({ ok: false, reason: "wrong-turn" });
    // The move list says bob, but the host still has alice holding the turn.
    expect(applyStateMove(s, { col: 2, by: "bob", at: T0 }, SEATS, "alice")).toEqual({ ok: false, reason: "not-your-turn" });
    expect(applyStateMove(s, { col: 2, by: "bob", at: T0 }, SEATS, "bob").ok).toBe(true);
    // No host turn (null) falls back to the move list.
    expect(applyStateMove(s, { col: 2, by: "bob", at: T0 }, SEATS, null).ok).toBe(true);
  });

  it("rejects illegal moves, strangers and corrupt states", () => {
    const full = playState([0, 0, 0, 0, 0, 0]);
    expect(applyStateMove(full, { col: 0, by: "alice", at: T0 }, SEATS)).toEqual({ ok: false, reason: "column-full" });
    for (const col of [-1, 7, 2.5, "3", null]) {
      expect(applyStateMove(null, { col, by: "alice", at: T0 }, SEATS)).toEqual({ ok: false, reason: "bad-column" });
    }
    expect(applyStateMove(null, { col: 3, by: "mallory", at: T0 }, SEATS)).toEqual({ ok: false, reason: "not-a-player" });
    const won = playState([0, 6, 1, 6, 2, 6, 3]);
    expect(applyStateMove(won, { col: 5, by: "bob", at: T0 }, SEATS, "bob")).toEqual({ ok: false, reason: "game-over" });
    for (const junk of ["x", 3, [], { moves: "3,3" }, { moves: [{ col: 3, by: "alice" }] }]) {
      expect(applyStateMove(junk, { col: 3, by: "alice", at: T0 }, SEATS)).toEqual({ ok: false, reason: "bad-state" });
    }
  });

  it("refuses to read a history with an illegal or misattributed move", () => {
    const ok = playState([3, 3, 4]);
    expect(readBoardState(ok, SEATS)?.game.moves).toEqual([3, 3, 4]);
    const swapped = { ...ok, moves: ok.moves.map((m, i) => (i === 1 ? { ...m, by: "alice" } : m)) };
    expect(readBoardState(swapped, SEATS)).toBeNull();
    const overfull = { moves: Array.from({ length: 7 }, (_, i) => ({ col: 0, by: SEATS[i % 2], at: T0 })) };
    expect(readBoardState(overfull, SEATS)).toBeNull();
    const pastWin = playState([0, 6, 1, 6, 2, 6, 3]);
    expect(readBoardState({ ...pastWin, moves: [...pastWin.moves, { col: 5, by: "bob", at: T0 }] }, SEATS)).toBeNull();
    expect(readBoardState({ moves: new Array(CELLS + 1).fill({ col: 0, by: "alice", at: T0 }) }, SEATS)).toBeNull();
  });

  it("detects a win from state and records the winner and line", () => {
    const s = playState([0, 6, 1, 6, 2, 6, 3]);
    expect(s.winner).toBe("alice");
    expect(s.draw).toBe(false);
    expect(s.line).toEqual([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 3, row: 0 },
    ]);
    const read = readBoardState(s, SEATS);
    expect(read?.game.over).toBe(true);
    expect(read && scoreFor(read.game, 0)).toBe(1);
    expect(read && scoreFor(read.game, 1)).toBe(0);

    const bobWins = playState([0, 6, 0, 6, 1, 6, 2, 6]);
    expect(bobWins.winner).toBe("bob");
    expect(bobWins.line?.every((c) => c.col === 6)).toBe(true);
  });

  it("detects a draw from state", () => {
    const s = playState(DRAW);
    expect(s).toMatchObject({ winner: null, draw: true, line: null });
    expect(s.board.every((c) => c !== null)).toBe(true);
    const read = readBoardState(s, SEATS);
    expect(read && scoreFor(read.game, 0)).toBe(0.5);
    expect(read && scoreFor(read.game, 1)).toBe(0.5);
  });

  it("replays exactly the same position after a reload (a JSON round trip)", () => {
    const random = seeded("reload");
    let state: unknown = null;
    let live = newGame();
    for (let i = 0; i < 17; i++) {
      const col = randomLegalColumn(live, random) as number;
      const by = SEATS[live.turn];
      const res = applyStateMove(state, { col, by, at: T0 + i }, SEATS, by);
      if (!res.ok) throw new Error(res.reason);
      state = res.state;
      live = res.game;
      if (live.over) break;
    }
    const reloaded = readBoardState(JSON.parse(JSON.stringify(state)), SEATS);
    expect(reloaded?.game).toEqual(live);
    expect(reloaded?.moves.map((m) => m.col)).toEqual([...live.moves]);
    // The last disc is the one to highlight.
    expect(reloaded?.game.discs.at(-1)?.n).toBe(live.moves.length - 1);
  });

  it("trusts the move list over a tampered board", () => {
    const s = playState([3, 3]);
    const tampered = { ...s, board: new Array(CELLS).fill(1), winner: "bob" };
    const read = readBoardState(tampered, SEATS);
    expect(read?.game.board).toEqual(s.board);
    expect(read?.game.winner).toBeNull();
  });

  it("resumes the move clock from the last move, within limits", () => {
    const now = T0 + 100_000;
    expect(resumeClockAt([], now)).toBe(now);
    expect(resumeClockAt([{ col: 0, by: "a", at: now - 10_000 }], now)).toBe(now - 10_000);
    expect(resumeClockAt([{ col: 0, by: "a", at: now - 3_600_000 }], now, 30_000, 8_000)).toBe(now - 22_000);
    expect(resumeClockAt([{ col: 0, by: "a", at: now + 5_000 }], now)).toBe(now); // skewed clock
  });

  it("two clients writing through the reducer converge; a stale write is refused", () => {
    // Both clients read version 1, alice moves; bob's client (stale) tries to move as alice again.
    const v1 = playState([3]);
    const bobMove = applyStateMove(v1, { col: 4, by: "bob", at: T0 }, SEATS, "bob");
    expect(bobMove.ok).toBe(true);
    if (!bobMove.ok) return;
    // On conflict the SDK re-runs the updater on the newer state: a repeat of bob's move is now out of turn.
    expect(applyStateMove(bobMove.state, { col: 4, by: "bob", at: T0 }, SEATS, "alice")).toEqual({
      ok: false,
      reason: "wrong-turn",
    });
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
