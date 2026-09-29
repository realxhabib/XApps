import {
  useLogger,
  useMatchResult,
  useMatchStarted,
  useMatchState,
  usePlayers,
  useTurn,
  useXApps,
} from "@xapps/sdk/react";
import { useEffect, useMemo, useRef } from "react";
import { MARKS, botMove, nextSeat, play, readBoard, type Board, type Seat } from "./game";

/** How long the practice bot "thinks". */
const BOT_DELAY_MS = 700;

/**
 * {{name}}: tic-tac-toe on the XApps shared match state.
 *
 * - The board is the match state (`useMatchState`). A move is
 *   `state.update(add mark)` then `turn.end()`, so live games, games played
 *   over days, reloads and spectators all work the same way.
 * - Seat 0 plays X and moves first. The host tracks whose turn it is
 *   (`useTurn`) and shows it in its HUD and inbox.
 * - Spectators get every change but can't write: the board is read-only.
 * - Practice: the opponent is a bot, played by this client.
 * - Game over: every player submits 1 for a win, 0.5 for a draw, 0 for a loss.
 */
export function App() {
  const xapps = useXApps();
  const log = useLogger();
  const started = useMatchStarted();
  const result = useMatchResult();
  const { state, update } = useMatchState<Board>();
  const turn = useTurn();
  const { players, me, isSpectator } = usePlayers();

  const board = useMemo(() => readBoard(state), [state]);
  const seatOf = (id: string): Seat | null => {
    const index = players.findIndex((p) => p.id === id);
    return index === 0 || index === 1 ? index : null;
  };
  const mySeat = isSpectator ? null : seatOf(me.id);
  const toMove = nextSeat(board);
  const mover = players[toMove];
  const bot = mover && mover.isBot && !isSpectator ? mover : undefined;
  // The host's turn (when it runs turns) must agree with the board.
  const turnAgrees = (id: string | undefined) => turn.turn === null || turn.turn === id;
  const over = board.winner !== null;
  const myMove = started && !over && mySeat === toMove && turnAgrees(me.id);

  const busy = useRef(false);
  const submitted = useRef(false);

  useEffect(() => {
    xapps.ready().catch((error: unknown) => log.error("ready failed", { error: String(error) }));
  }, [xapps, log]);

  /** Writes a move for `seat` (us, or the bot we drive), then passes the turn. */
  const move = async (cell: number, seat: Seat) => {
    if (busy.current) return;
    busy.current = true;
    try {
      let wrote = false;
      const snapshot = await update((draft) => {
        // May run again if someone else wrote first: re-check against the latest board.
        const next = play(readBoard(draft), cell, seat);
        wrote = next !== null;
        return next ?? undefined;
      });
      if (!wrote) return;
      const after = readBoard(snapshot.state);
      log.debug("move", { cell, mark: MARKS[seat], version: snapshot.version });
      if (after.winner === null) await turn.end();
    } catch (error) {
      log.warn("move failed", { cell, error: String(error) });
    } finally {
      busy.current = false;
    }
  };

  // Practice: the bot moves when it's its turn.
  useEffect(() => {
    if (!started || over || !bot || !turnAgrees(bot.id)) return;
    const seat = seatOf(bot.id);
    if (seat === null) return;
    const timer = setTimeout(() => {
      const cell = botMove(board, seat, xapps.random.fork(`bot:${board.cells.join(",")}`));
      if (cell !== null) void move(cell, seat);
    }, BOT_DELAY_MS);
    return () => clearTimeout(timer);
    // `move`, `seatOf` and `turnAgrees` only read values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, over, bot, board, turn.turn, xapps]);

  // Host HUD status line.
  useEffect(() => {
    if (!started || isSpectator) return;
    const text = over ? "Game over" : myMove ? "Your turn" : `Waiting for @${mover?.handle ?? "…"}`;
    xapps.ui.setStatus(text).catch(() => {});
  }, [started, isSpectator, over, myMove, mover, xapps]);

  // Game over: submit once (and for the bot in practice).
  useEffect(() => {
    if (!over || isSpectator || submitted.current) return;
    submitted.current = true;
    const scoreFor = (seat: Seat) => (board.winner === "draw" ? 0.5 : board.winner === seat ? 1 : 0);
    const display = (seat: Seat) => ({
      kind: "text" as const,
      title: "Tic-tac-toe",
      body: board.winner === "draw" ? "Draw" : board.winner === seat ? `Won as ${MARKS[seat]}` : `Lost as ${MARKS[seat]}`,
    });
    if (mySeat !== null) {
      log.info("game over", { winner: board.winner });
      xapps.submit({ score: scoreFor(mySeat), data: board, display: display(mySeat) }).catch((error: unknown) =>
        log.error("submit failed", { error: String(error) }),
      );
    }
    for (const [seat, p] of players.slice(0, 2).entries()) {
      if (p.isBot) xapps.submitFor(p.id, { score: scoreFor(seat as Seat) }).catch(() => {});
    }
  }, [over, isSpectator, board, mySeat, players, xapps, log]);

  const status = result
    ? result.winnerId === null
      ? "Draw!"
      : result.winnerId === me.id
        ? "You win! 🎉"
        : `@${players.find((p) => p.id === result.winnerId)?.handle ?? "?"} wins`
    : over
      ? board.winner === "draw"
        ? "Draw! Waiting for the result…"
        : `${MARKS[board.winner as Seat]} wins! Waiting for the result…`
      : !started
        ? "Get ready…"
        : isSpectator
          ? `${MARKS[toMove]} to move (@${mover?.handle ?? "…"})`
          : myMove
            ? `Your move (${MARKS[toMove]})`
            : `Waiting for @${mover?.handle ?? "…"}…`;

  return (
    <main className="app">
      <header>
        <h1>{xapps.context.app.name}</h1>
        <p className="players">
          {players.slice(0, 2).map((p, seat) => (
            <span key={p.id} className={toMove === seat && !over ? "active" : undefined}>
              {MARKS[seat]} {p.id === me.id ? "You" : `@${p.handle}`}
              {p.isBot ? " 🤖" : ""}
            </span>
          ))}
        </p>
      </header>

      <div className="board" role="grid" aria-label="Board">
        {board.cells.map((cell, i) => {
          const win = board.line?.includes(i) ?? false;
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className={`cell${win ? " win" : ""}${cell === null ? "" : ` mark-${cell}`}`}
              aria-label={cell === null ? `Empty cell ${i + 1}` : `${MARKS[cell]} at ${i + 1}`}
              disabled={!myMove || cell !== null || mySeat === null}
              onClick={() => mySeat !== null && void move(i, mySeat)}
            >
              {cell === null ? "" : MARKS[cell]}
            </button>
          );
        })}
      </div>

      <p className="status" role="status">
        {status}
      </p>
      {isSpectator ? <p className="muted">You’re watching. Moves appear as they happen.</p> : null}
    </main>
  );
}
