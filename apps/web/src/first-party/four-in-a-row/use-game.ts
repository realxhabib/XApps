"use client";

import type { Json, MatchResult, PlayerInfo } from "@xapps/sdk";
import {
  useMatch,
  useMatchResult,
  useMatchStarted,
  useMatchState,
  usePlayers,
  usePresence,
  useRoomEvent,
  useTurn,
  useXApps,
} from "@xapps/sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { play } from "@/lib/sfx";
import { useBot } from "../shared/hooks";
import { boardAlt, boardSvg } from "./display";
import { dropPlan } from "./geometry";
import {
  ROWS,
  TURN_MS,
  applyStateMove,
  chooseBotMove,
  isColumn,
  newGame,
  other,
  playMove,
  randomLegalColumn,
  readBoardState,
  resumeClockAt,
  validateMove,
  type GameState,
  type MoveError,
  type MoveRecord,
  type Seat,
  type Seats,
} from "./logic";

export type EndReason = "four" | "draw" | "abandon";

export interface Outcome {
  winner: Seat | null;
  reason: EndReason;
}

/** A disc we show before the shared state confirms it (our own drop, or a live opponent's room echo). */
interface Optimistic {
  /** Move index it fills — ignored as soon as the state has moved past it. */
  n: number;
  col: number;
  seat: Seat;
}

interface Aim {
  /** Move index the aim belongs to — stale aims from earlier turns are ignored. */
  n: number;
  col: number;
  seat: Seat;
}

/** Re-read the shared state if the opponent's timed turn runs this far over (a missed push). */
const REFRESH_AFTER_MS = TURN_MS + 3_000;
/** Give up on a silent live opponent. */
const ABANDON_AFTER_MS = TURN_MS + 25_000;
/** Let the winning line play before the host covers the app. */
const SUBMIT_AFTER_MS = 1_500;
/** A room echo of the opponent's drop that the state never confirms is dropped after this. */
const ECHO_TTL_MS = 4_000;
/** Wait this long before repairing a turn the state has already passed on. */
const TURN_REPAIR_MS = 1_200;

const noop = () => {};

/** Reads one field of an untrusted room payload. */
function field(payload: Json, key: string): Json | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload[key] : undefined;
}

const scoreOf = (outcome: Outcome, seat: Seat) => (outcome.winner === null ? 0.5 : outcome.winner === seat ? 1 : 0);

function outcomeOf(game: GameState, abandonedBy: Seat | null): Outcome | null {
  if (game.winner !== null) return { winner: game.winner, reason: "four" };
  if (game.draw) return { winner: null, reason: "draw" };
  if (abandonedBy !== null) return { winner: other(abandonedBy), reason: "abandon" };
  return null;
}

/**
 * Everything about a Four in a Row match that isn't pixels.
 *
 * The board lives in the shared match state (`{ board, moves, winner, line }`,
 * see `logic.ts`), so live, async ("play anytime") and practice games all
 * work the same way: a move is `state.update(add disc)` then `turn.end()`.
 * Reloading — or reopening days later — replays the stored moves. Live games
 * add room messages on top for instant feedback (aim previews and a drop
 * echo), never as the source of truth. Bots are played by this client.
 */
export function useFourInARow() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const matchStatus = useMatch().status;
  const result: MatchResult | null = useMatchResult();
  const online = usePresence();
  const { state } = useMatchState();
  const { turn: turnHolder, deadline } = useTurn();
  const { players: seated, me: meInfo, isSpectator: spectating } = usePlayers();
  const anyBot = useBot();
  const bot = spectating ? undefined : anyBot;

  const mode = xapps.match.mode;
  const async = mode === "async";
  /** Live, practice and sandbox games keep the 30 s move clock; async turns last days. */
  const timed = !async;

  // Seat order decides colours and who moves first (seat 0).
  const p0: PlayerInfo | undefined = seated[0];
  const p1: PlayerInfo | undefined = seated[1];
  const seat0 = p0?.id ?? "";
  const seat1 = p1?.id ?? "";
  const seats = useMemo<Seats>(() => [seat0, seat1], [seat0, seat1]);
  const tableReady = !!seat0 && !!seat1;

  const mySeat: Seat | null = spectating ? null : seat1 === meInfo.id ? 1 : 0;
  /** Spectators see the table from seat 0's side. */
  const viewSeat: Seat = mySeat ?? 0;
  const oppSeat = other(viewSeat);
  const players = useMemo(() => [p0, p1] as const, [p0, p1]);
  const me = mySeat === null ? undefined : players[mySeat];
  const opponent = players[oppSeat];
  const botSeat: Seat | null = bot ? (seat1 === bot.id ? 1 : seat0 === bot.id ? 0 : null) : null;
  // A human opponent in a live (or sandbox) game shares a room with us.
  const live = !async && !bot && tableReady && !p0?.isBot && !p1?.isBot;
  const canSend = live && !spectating;

  /* ---------------------------------------------------------------- */
  /* The board: shared state + optimistic layers                      */
  /* ---------------------------------------------------------------- */

  const read = useMemo(() => (tableReady ? readBoardState(state, seats) : null), [state, seats, tableReady]);
  const unreadable = tableReady && read === null;
  const base = read?.game ?? EMPTY;
  const records: readonly MoveRecord[] = read?.moves ?? NO_MOVES;

  const [pending, setPending] = useState<Optimistic | null>(null);
  const [echo, setEcho] = useState<Optimistic | null>(null);
  const layer = pending ?? echo;
  const game = useMemo(() => {
    if (!layer || layer.n !== base.moves.length) return base;
    return playMove(base, layer.col, layer.seat) ?? base;
  }, [base, layer]);
  const confirmed = game === base;

  const [abandonedBy, setAbandonedBy] = useState<Seat | null>(null);
  // Only a confirmed (stored) result counts — an optimistic disc can still bounce.
  const outcome = outcomeOf(base, abandonedBy);
  const over = outcome !== null;

  // Handlers (room events, timers, async callbacks) need the latest values synchronously.
  const latest = useRef({ base, game, seats, records, turnHolder });
  useEffect(() => {
    latest.current = { base, game, seats, records, turnHolder };
  });

  /* ---------------------------------------------------------------- */
  /* Turns                                                            */
  /* ---------------------------------------------------------------- */

  const idOf = (seat: Seat) => (seat === 0 ? seat0 : seat1);
  /** The host runs turns (turn-based match); otherwise the move list alone decides. */
  const turnOk = (seat: Seat) => turnHolder === null || turnHolder === idOf(seat);

  // Move clock (timed modes): when the current turn started, by our clock.
  const [clock, setClock] = useState<{ n: number; at: number } | null>(() =>
    xapps.hasStarted ? { n: base.moves.length, at: resumeClockAt(records, Date.now()) } : null,
  );
  const startCount = useRef<number | null>(xapps.hasStarted ? base.moves.length : null);

  // A play-anytime challenge opens before the opponent accepts; the state can
  // only be written once the match is active, so the first move waits.
  const awaitingOpponent = matchStatus === "open" || matchStatus === "pending";
  const playing = started && tableReady && !unreadable && !over && !awaitingOpponent;
  const myTurn =
    playing && confirmed && mySeat !== null && base.turn === mySeat && turnOk(mySeat) && (!timed || clock !== null);
  const turnSeat: Seat = game.turn;
  const opponentTurn = playing && turnSeat === oppSeat;
  const turnStartedAt = timed ? (clock?.at ?? null) : null;

  const inFlight = useRef(false);

  /**
   * Plays `col` for `seat` (us, or the bot we drive): shows the disc at once,
   * writes it into the shared state, then passes the turn. Rejected moves
   * (someone else wrote first and it's no longer our turn) roll back.
   */
  const commitMove = useCallback(
    async (col: number, seat: Seat): Promise<"ok" | MoveError | "busy" | "failed"> => {
      const cur = latest.current;
      if (inFlight.current) return "busy";
      const check = validateMove(cur.base, col, seat);
      if (!check.ok) return check.reason;
      const by = cur.seats[seat];
      const next = cur.seats[other(seat)];
      const n = cur.base.moves.length;
      const at = Date.now();
      inFlight.current = true;
      setPending({ n, col, seat });
      setEcho(null);
      if (timed) setClock({ n: n + 1, at });
      if (canSend && seat === mySeat) xapps.room.send("drop", { n, col }).catch(noop);
      try {
        let written = false;
        await xapps.state.update((draft) => {
          const res = applyStateMove(draft, { col, by, at }, latest.current.seats, xapps.turn.current);
          written = res.ok;
          return res.ok ? res.state : undefined;
        });
        if (!written) return "failed";
        // Pass the turn explicitly (idempotent if a repair beat us to it).
        await xapps.turn.end(next).catch(noop);
        return "ok";
      } catch {
        return "failed";
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    },
    [xapps, timed, canSend, mySeat],
  );

  const drop = useCallback(
    (col: number): "ok" | MoveError | "not-ready" => {
      if (!myTurn || mySeat === null) return "not-ready";
      const check = validateMove(latest.current.base, col, mySeat);
      if (!check.ok) return check.reason;
      void commitMove(col, mySeat).then((res) => {
        if (res === "failed") {
          play("error");
          xapps.ui.toast("That move didn't go through — the board was refreshed", "danger").catch(noop);
        }
      });
      return "ok";
    },
    [myTurn, mySeat, commitMove, xapps],
  );

  // Turn repair: if the state already shows the other player to move but the
  // host still has the turn with us (or our bot) — e.g. we reloaded between
  // the write and turn.end — pass it on. Runs at most once per position.
  const nextMoverId = tableReady && !unreadable ? idOf(base.turn) : null;
  const holderIsOurs = turnHolder !== null && (turnHolder === meInfo.id || (!!bot && turnHolder === bot.id));
  const repaired = useRef("");
  useEffect(() => {
    if (spectating || !started || !nextMoverId || !holderIsOurs || turnHolder === nextMoverId) return;
    const key = `${base.moves.length}:${turnHolder}`;
    if (repaired.current === key) return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      repaired.current = key;
      xapps.turn.end(nextMoverId).catch(noop);
    }, TURN_REPAIR_MS);
    return () => clearTimeout(timer);
  }, [spectating, started, nextMoverId, holderIsOurs, turnHolder, base.moves.length, xapps]);

  /* ---------------------------------------------------------------- */
  /* Start, clocks and state pushes                                   */
  /* ---------------------------------------------------------------- */

  useEffect(
    () =>
      xapps.onStart(() => {
        const cur = latest.current;
        startCount.current ??= cur.base.moves.length;
        setClock((c) => c ?? { n: cur.base.moves.length, at: resumeClockAt(cur.records, Date.now()) });
        // Make sure we resume from the freshest state (e.g. the iframe reloaded).
        if (!xapps.isSpectator) xapps.state.get().catch(noop);
      }),
    [xapps],
  );

  // A new move landed in the state: the next turn's clock starts now.
  useEffect(
    () =>
      xapps.state.onChange((next) => {
        const r = readBoardState(next, latest.current.seats);
        if (!r) return;
        const n = r.game.moves.length;
        setClock((c) => (c === null || c.n >= n ? c : { n, at: Date.now() }));
      }),
    [xapps],
  );

  /* ---------------------------------------------------------------- */
  /* Live room: aim previews and drop echoes (never the truth)        */
  /* ---------------------------------------------------------------- */

  const [roomAim, setRoomAim] = useState<Aim | null>(null);
  const [botAim, setBotAim] = useState<Aim | null>(null);

  const seatOf = (id: string): Seat | null => (id === seat0 ? 0 : id === seat1 ? 1 : null);

  useRoomEvent("aim", (payload, from) => {
    const seat = seatOf(from);
    if (!live || seat === null || seat === mySeat) return;
    const n = field(payload, "n");
    const col = field(payload, "col");
    if (typeof n === "number" && isColumn(col)) setRoomAim({ n, col, seat });
  });

  useRoomEvent("drop", (payload, from) => {
    const seat = seatOf(from);
    if (!live || seat === null || seat === mySeat) return;
    const n = field(payload, "n");
    const col = field(payload, "col");
    const cur = latest.current.base;
    if (n !== cur.moves.length || cur.turn !== seat || !validateMove(cur, col, seat).ok) return;
    setEcho({ n, col: col as number, seat });
  });

  // An echo the state never confirms (their write failed) fades away.
  useEffect(() => {
    if (!echo) return;
    const timer = setTimeout(() => setEcho((e) => (e === echo ? null : e)), ECHO_TTL_MS);
    return () => clearTimeout(timer);
  }, [echo]);

  // Share where we're aiming so the opponent (and spectators) see our ghost move.
  const lastAimSent = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const aim = useCallback(
    (col: number) => {
      if (!canSend || !myTurn) return;
      const n = latest.current.base.moves.length;
      const key = `${n}:${col}`;
      const now = Date.now();
      if (key === lastAimSent.current.key || now - lastAimSent.current.at < 90) return;
      lastAimSent.current = { key, at: now };
      xapps.room.send("aim", { n, col }).catch(noop);
    },
    [canSend, myTurn, xapps],
  );

  // Opponent came back online → re-read the state in case we missed a push.
  // Presence is unknown (empty) until the host first reports it.
  const opponentOnline = !live || !opponent || online.length === 0 || online.includes(opponent.id);
  const wasOnline = useRef(true);
  useEffect(() => {
    if (opponentOnline && !wasOnline.current) xapps.state.get().catch(noop);
    wasOnline.current = opponentOnline;
  }, [opponentOnline, xapps]);

  // Live watchdog: refresh when the opponent's clock runs over; give up on a silent one.
  useEffect(() => {
    if (!live || spectating || !started || result || over || turnSeat === mySeat || turnStartedAt === null) return;
    let refreshed = false;
    const id = setInterval(() => {
      const waited = Date.now() - turnStartedAt;
      if (waited > REFRESH_AFTER_MS && !refreshed) {
        refreshed = true;
        xapps.state.get().catch(noop);
      }
      if (waited > ABANDON_AFTER_MS) setAbandonedBy(turnSeat);
    }, 1_000);
    return () => clearInterval(id);
  }, [live, spectating, started, result, over, turnSeat, mySeat, turnStartedAt, xapps]);

  /* ---------------------------------------------------------------- */
  /* Our move clock (timed modes)                                     */
  /* ---------------------------------------------------------------- */

  const [autoDropped, setAutoDropped] = useState<number | null>(null);
  useEffect(() => {
    if (!timed || !myTurn || turnStartedAt === null || mySeat === null) return;
    const left = TURN_MS - (Date.now() - turnStartedAt);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 5; s >= 1; s--) {
      const at = left - s * 1000;
      if (at > 0) {
        timers.push(
          setTimeout(() => {
            play("tick");
            xapps.ui.haptic(s <= 2 ? "medium" : "light").catch(noop);
          }, at),
        );
      }
    }
    timers.push(
      setTimeout(
        () => {
          const g = latest.current.base;
          // Seeded per move, so a replayed match auto-plays the same way.
          const col = randomLegalColumn(g, xapps.random.fork(`timeout-${g.moves.length}`).next);
          if (col === null) return;
          setAutoDropped(g.moves.length);
          void commitMove(col, mySeat);
        },
        Math.max(0, left),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [timed, myTurn, turnStartedAt, mySeat, commitMove, xapps]);

  /* ---------------------------------------------------------------- */
  /* Bot                                                              */
  /* ---------------------------------------------------------------- */

  const botToMove =
    started && botSeat !== null && playing && confirmed && base.turn === botSeat && turnOk(botSeat) && (!timed || clock !== null);
  useEffect(() => {
    if (!botToMove || botSeat === null) return;
    const g = latest.current.base;
    const n = g.moves.length;
    const last = g.discs[n - 1];
    // Timeline: the previous disc lands → the bot's ghost appears → it
    // "thinks" for 450–900 ms, wandering over candidate columns → drop.
    const landed = last ? dropPlan(last.row).impactMs + 120 : 250;
    const think = 450 + Math.random() * 450;
    // The search itself (≈1–20 ms) runs once the landing jolt has settled so
    // it can never stutter a disc mid-fall.
    const searchAt = landed + 280;
    const dropAt = landed + think;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const glance = last && (g.heights[last.col] ?? 0) < ROWS ? last.col : 3;

    timers.push(setTimeout(() => setBotAim({ n, col: glance, seat: botSeat }), landed));
    timers.push(
      setTimeout(() => {
        const choice = chooseBotMove(latest.current.base);
        if (!choice || latest.current.base.moves.length !== n) return;
        // Hover over a runner-up or two, then settle on the pick.
        const others = choice.ranked
          .slice(0, 3)
          .map((m) => m.col)
          .filter((c) => c !== choice.col && c !== glance)
          .slice(0, Math.random() < 0.5 ? 1 : 2);
        const path = [...others, choice.col];
        const span = Math.max(0, dropAt - 90 - searchAt);
        path.forEach((col, i) => {
          timers.push(setTimeout(() => setBotAim({ n, col, seat: botSeat }), (span * i) / path.length));
        });
        timers.push(
          setTimeout(
            () => {
              if (latest.current.base.moves.length !== n) return;
              void commitMove(choice.col, botSeat);
            },
            Math.max(0, dropAt - searchAt),
          ),
        );
      }, searchAt),
    );
    return () => timers.forEach(clearTimeout);
  }, [botToMove, botSeat, base.moves.length, commitMove]);

  /* ---------------------------------------------------------------- */
  /* Submission: once per player when the state shows a result        */
  /* ---------------------------------------------------------------- */

  const [submitted, setSubmitted] = useState(() => !spectating && xapps.me.submitted);
  const submittedRef = useRef(submitted);
  const outcomeKey = outcome && started ? `${outcome.reason}:${outcome.winner}` : null;
  useEffect(() => {
    if (!outcomeKey || spectating || submittedRef.current) return;
    const g = latest.current.base;
    const last = g.discs[g.discs.length - 1];
    // A game that was already over when we opened it only needs a short beat.
    const fresh = last !== undefined && startCount.current !== null && last.n >= startCount.current;
    const delay = fresh ? SUBMIT_AFTER_MS + dropPlan(last.row).totalMs : 900;
    const timer = setTimeout(() => {
      const cur = latest.current.base;
      const final = outcomeOf(cur, abandonedBy);
      if (!final || submittedRef.current || mySeat === null) return;
      submittedRef.current = true;
      const names: [string, string] = [players[0]?.name ?? "Red", players[1]?.name ?? "Yellow"];
      const display = { kind: "svg" as const, svg: boardSvg(cur), alt: boardAlt(cur, names) };
      const data = { moves: [...cur.moves], winnerSeat: final.winner, reason: final.reason };
      if (!xapps.me.submitted) {
        xapps
          .submit({ score: scoreOf(final, mySeat), data: { ...data, seat: mySeat }, display })
          .then(() => setSubmitted(true))
          .catch(() => setSubmitted(true));
      } else {
        setSubmitted(true);
      }
      if (bot && botSeat !== null && !xapps.player(bot.id)?.submitted) {
        xapps.submitFor(bot.id, { score: scoreOf(final, botSeat), data: { ...data, seat: botSeat }, display }).catch(noop);
      }
    }, delay);
    return () => clearTimeout(timer);
    // Keyed on the outcome only: re-renders must not restart the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  /* ---------------------------------------------------------------- */
  /* Host HUD                                                         */
  /* ---------------------------------------------------------------- */

  const turnPlayer = players[turnSeat];
  const name = (seat: Seat | null) => (seat === null ? "" : `@${players[seat]?.handle ?? "player"}`);
  let status: string;
  if (!started) status = spectating ? "Watching" : "Get ready…";
  else if (unreadable) status = "This board couldn't be loaded";
  else if (awaitingOpponent) status = `Waiting for ${name(oppSeat)} to accept`;
  else if (outcome && outcome.winner !== null && outcome.winner === mySeat)
    status = outcome.reason === "abandon" ? "Opponent left — you win!" : "You win!";
  else if (outcome && outcome.winner !== null) status = `${name(outcome.winner)} wins`;
  else if (outcome) status = "Draw — board full";
  else if (myTurn) status = "Your move";
  else if (spectating) status = `${name(turnSeat)} to move`;
  else if (async) status = `Waiting for ${name(turnSeat)}'s move`;
  else status = `${name(turnSeat)} is thinking…`;

  const turnId = started && !over ? (turnPlayer?.id ?? null) : null;
  useEffect(() => {
    xapps.ui.setStatus(status).catch(noop);
  }, [xapps, status]);
  useEffect(() => {
    xapps.ui.setTurn(turnId).catch(noop);
  }, [xapps, turnId]);

  const discCount = game.moves.length;
  useEffect(() => {
    if (!seat0 || !seat1) return;
    xapps.ui.setScores({ [seat0]: Math.ceil(discCount / 2), [seat1]: Math.floor(discCount / 2) }).catch(noop);
  }, [xapps, seat0, seat1, discCount]);

  const aimSource = botSeat !== null ? botAim : live ? roomAim : null;
  const opponentAim =
    aimSource && aimSource.n === game.moves.length && aimSource.seat === turnSeat && playing && !myTurn
      ? { seat: aimSource.seat, col: aimSource.col }
      : null;

  const lastMove = records[records.length - 1] ?? null;

  return {
    xapps,
    started,
    result,
    game,
    players,
    me,
    opponent,
    mySeat,
    viewSeat,
    oppSeat,
    spectating,
    mode,
    async,
    timed,
    live,
    isBotGame: botSeat !== null,
    turnStartedAt,
    /** Async turn deadline (ISO) from the host. */
    deadline: async ? deadline : null,
    playing,
    awaitingOpponent,
    myTurn,
    turnSeat,
    opponentTurn,
    opponentAim,
    opponentOnline,
    outcome,
    submitted,
    autoDropped,
    unreadable,
    lastMove,
    status,
    drop,
    aim,
  };
}

const EMPTY = newGame();
const NO_MOVES: readonly MoveRecord[] = [];

export type FourInARow = ReturnType<typeof useFourInARow>;
