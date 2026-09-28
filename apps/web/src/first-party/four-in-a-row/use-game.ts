"use client";

import type { Json, MatchResult, PlayerInfo } from "@xapps/sdk";
import { useMatch, useMatchResult, useMatchStarted, usePresence, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { play } from "@/lib/sfx";
import { useBot } from "../shared/hooks";
import { boardAlt, boardSvg } from "./display";
import { dropPlan } from "./geometry";
import {
  ROWS,
  TURN_MS,
  chooseBotMove,
  isColumn,
  mergeSync,
  newGame,
  other,
  playMove,
  randomLegalColumn,
  receiveMove,
  validateMove,
  type GameState,
  type MoveError,
  type Seat,
} from "./logic";

export type EndReason = "four" | "draw" | "abandon";

export interface Outcome {
  winner: Seat | null;
  reason: EndReason;
}

interface Core {
  game: GameState;
  /** `Date.now()` when the current turn's clock started; null before match.start. */
  turnStartedAt: number | null;
  /** Live only: the seat that went silent far past its clock. */
  abandonedBy: Seat | null;
}

interface Aim {
  /** Move index the aim belongs to — stale aims from earlier turns are ignored. */
  n: number;
  col: number;
}

/** Re-send our latest move this often until the opponent answers (duplicates are ignored). */
const RESEND_MS = 3_000;
/** Ask for the opponent's history once their clock is this far past zero. */
const SYNC_AFTER_MS = TURN_MS + 3_000;
/** Give up on a silent live opponent. */
const ABANDON_AFTER_MS = TURN_MS + 25_000;
/** Let the winning line play before the host covers the app. */
const SUBMIT_AFTER_MS = 1_500;

const noop = () => {};

/** Reads one field of an untrusted room payload. */
function field(payload: Json, key: string): Json | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload[key] : undefined;
}

function outcomeOf(core: Core): Outcome | null {
  const { game, abandonedBy } = core;
  if (game.winner !== null) return { winner: game.winner, reason: "four" };
  if (game.draw) return { winner: null, reason: "draw" };
  if (abandonedBy !== null) return { winner: other(abandonedBy), reason: "abandon" };
  return null;
}

const scoreOf = (outcome: Outcome, seat: Seat) => (outcome.winner === null ? 0.5 : outcome.winner === seat ? 1 : 0);

/**
 * Everything about a Four in a Row match that isn't pixels: the canonical
 * move list, live sync with a human opponent, the bot, turn clocks and
 * auto-drop, result submission and the host HUD.
 */
export function useFourInARow() {
  const xapps = useXApps();
  const match = useMatch();
  const started = useMatchStarted();
  const result: MatchResult | null = useMatchResult();
  const online = usePresence();
  const bot = useBot();

  // Seat order decides colours and who moves first (seat 0).
  const players = [...match.players].sort((a, b) => a.seat - b.seat).slice(0, 2) as [PlayerInfo, PlayerInfo];
  const mySeat: Seat = players[1]?.id === xapps.me.id ? 1 : 0;
  const oppSeat = other(mySeat);
  const me = players[mySeat];
  const opponent = players[oppSeat];
  const botSeat: Seat | null = bot ? (players[1]?.id === bot.id ? 1 : 0) : null;
  // Any human opponent is played live over the room; bots are simulated here.
  const live = !bot && !!opponent;

  const [core, setCore] = useState<Core>(() => ({ game: newGame(), turnStartedAt: null, abandonedBy: null }));
  // Handlers (room events, timers) need the latest state synchronously.
  const coreRef = useRef(core);
  const commit = useCallback((next: Core) => {
    coreRef.current = next;
    setCore(next);
  }, []);

  const [liveAim, setLiveAim] = useState<Aim | null>(null);
  const [botAim, setBotAim] = useState<Aim | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [autoDropped, setAutoDropped] = useState<number | null>(null);

  const { game } = core;
  const outcome = outcomeOf(core);
  const over = outcome !== null;
  const playing = started && core.turnStartedAt !== null && !over;
  const myTurn = playing && game.turn === mySeat;

  /* ---------------------------------------------------------------- */
  /* Room plumbing                                                    */
  /* ---------------------------------------------------------------- */

  const send = useCallback(
    (type: string, payload: Json) => {
      if (!live) return;
      xapps.room.send(type, payload).catch(noop);
    },
    [live, xapps],
  );

  const lastSyncRequest = useRef(0);
  const requestSync = useCallback(() => {
    const now = Date.now();
    if (now - lastSyncRequest.current < 1_500) return;
    lastSyncRequest.current = now;
    send("sync-request", {});
  }, [send]);

  const adopt = useCallback(
    (game: GameState) => {
      setLiveAim(null);
      commit({ ...coreRef.current, game, turnStartedAt: Date.now() });
    },
    [commit],
  );

  useRoomEvent("move", (payload, from) => {
    if (!live || from !== opponent?.id) return;
    const res = receiveMove(coreRef.current.game, payload, oppSeat);
    if (res.kind === "applied") adopt(res.state);
    else if (res.kind === "gap") requestSync();
  });

  useRoomEvent("sync-request", (_payload, from) => {
    if (!live || from !== opponent?.id) return;
    send("sync", { moves: [...coreRef.current.game.moves] });
  });

  useRoomEvent("sync", (payload, from) => {
    if (!live || from !== opponent?.id) return;
    const merged = mergeSync(coreRef.current.game, field(payload, "moves"));
    if (merged) adopt(merged);
  });

  useRoomEvent("aim", (payload, from) => {
    if (!live || from !== opponent?.id) return;
    const n = field(payload, "n");
    const col = field(payload, "col");
    if (typeof n === "number" && isColumn(col)) setLiveAim({ n, col });
  });

  // Match start: start the first clock. Live: ask for any history we might
  // have lost (e.g. the iframe reloaded mid-game).
  useEffect(
    () =>
      xapps.onStart(() => {
        if (coreRef.current.turnStartedAt === null) commit({ ...coreRef.current, turnStartedAt: Date.now() });
        if (live) requestSync();
      }),
    [xapps, commit, live, requestSync],
  );

  // Opponent came back online → resync.
  // Presence is unknown (empty) until the host first reports it.
  const opponentOnline = !live || !opponent || online.length === 0 || online.includes(opponent.id);
  const wasOnline = useRef(true);
  useEffect(() => {
    if (opponentOnline && !wasOnline.current) requestSync();
    wasOnline.current = opponentOnline;
  }, [opponentOnline, requestSync]);

  // Watchdog: re-send our last move, chase a silent opponent, and never deadlock.
  useEffect(() => {
    if (!live || !started || result) return;
    let lastResend = Date.now();
    const id = setInterval(() => {
      const cur = coreRef.current;
      const g = cur.game;
      const now = Date.now();
      const last = g.discs[g.discs.length - 1];
      if (last && last.seat === mySeat && now - lastResend >= RESEND_MS) {
        lastResend = now;
        send("move", { n: last.n, col: last.col });
      }
      if (outcomeOf(cur) || cur.turnStartedAt === null || g.turn === mySeat) return;
      const waited = now - cur.turnStartedAt;
      if (waited > SYNC_AFTER_MS) requestSync();
      if (waited > ABANDON_AFTER_MS) commit({ ...cur, abandonedBy: g.turn });
    }, 1_000);
    return () => clearInterval(id);
  }, [live, started, result, mySeat, send, requestSync, commit]);

  /* ---------------------------------------------------------------- */
  /* Local moves                                                      */
  /* ---------------------------------------------------------------- */

  const drop = useCallback(
    (col: number): "ok" | MoveError | "not-ready" => {
      const cur = coreRef.current;
      if (cur.turnStartedAt === null || outcomeOf(cur)) return "not-ready";
      const check = validateMove(cur.game, col, mySeat);
      if (!check.ok) return check.reason;
      const next = playMove(cur.game, col, mySeat) as GameState;
      commit({ ...cur, game: next, turnStartedAt: Date.now() });
      send("move", { n: next.moves.length - 1, col });
      return "ok";
    },
    [commit, mySeat, send],
  );

  // Share where we're aiming so the opponent sees our ghost disc move.
  const lastAimSent = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const aim = useCallback(
    (col: number) => {
      const cur = coreRef.current;
      if (!live || cur.game.turn !== mySeat || outcomeOf(cur)) return;
      const key = `${cur.game.moves.length}:${col}`;
      const now = Date.now();
      if (key === lastAimSent.current.key || now - lastAimSent.current.at < 90) return;
      lastAimSent.current = { key, at: now };
      send("aim", { n: cur.game.moves.length, col });
    },
    [live, mySeat, send],
  );

  // Our clock: last-5-second ticks, then auto-play a random legal column.
  useEffect(() => {
    if (!myTurn || core.turnStartedAt === null) return;
    const left = TURN_MS - (Date.now() - core.turnStartedAt);
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
          const g = coreRef.current.game;
          // Seeded per move, so a replayed match auto-plays the same way.
          const col = randomLegalColumn(g, xapps.random.fork(`timeout-${g.moves.length}`).next);
          if (col !== null && drop(col) === "ok") setAutoDropped(g.moves.length);
        },
        Math.max(0, left),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [myTurn, core.turnStartedAt, drop, xapps]);

  /* ---------------------------------------------------------------- */
  /* Bot                                                              */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!started || botSeat === null || core.turnStartedAt === null || over || game.turn !== botSeat) return;
    const n = game.moves.length;
    const last = game.discs[n - 1];
    // Timeline: the previous disc lands → the bot's ghost appears → it
    // "thinks" for 450–900 ms, wandering over candidate columns → drop.
    const landed = last ? dropPlan(last.row).impactMs + 120 : 250;
    const think = 450 + Math.random() * 450;
    // The search itself (≈1–20 ms) runs once the landing jolt has settled so
    // it can never stutter a disc mid-fall.
    const searchAt = landed + 280;
    const dropAt = landed + think;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const glance = last && (game.heights[last.col] ?? 0) < ROWS ? last.col : 3;

    timers.push(setTimeout(() => setBotAim({ n, col: glance }), landed));
    timers.push(
      setTimeout(() => {
        const choice = chooseBotMove(coreRef.current.game);
        if (!choice || coreRef.current.game.moves.length !== n) return;
        // Hover over a runner-up or two, then settle on the pick.
        const others = choice.ranked
          .slice(0, 3)
          .map((m) => m.col)
          .filter((c) => c !== choice.col && c !== glance)
          .slice(0, Math.random() < 0.5 ? 1 : 2);
        const path = [...others, choice.col];
        const span = Math.max(0, dropAt - 90 - searchAt);
        path.forEach((col, i) => {
          timers.push(setTimeout(() => setBotAim({ n, col }), (span * i) / path.length));
        });
        timers.push(
          setTimeout(() => {
            const cur = coreRef.current;
            if (cur.game.moves.length !== n || outcomeOf(cur)) return;
            const next = playMove(cur.game, choice.col, botSeat);
            if (next) commit({ ...cur, game: next, turnStartedAt: Date.now() });
          }, Math.max(0, dropAt - searchAt)),
        );
      }, searchAt),
    );
    return () => timers.forEach(clearTimeout);
  }, [started, botSeat, core.turnStartedAt, over, game, commit]);

  /* ---------------------------------------------------------------- */
  /* Submission                                                       */
  /* ---------------------------------------------------------------- */

  const submittedRef = useRef(false);
  const outcomeKey = outcome ? `${outcome.reason}:${outcome.winner}` : null;
  useEffect(() => {
    if (!outcomeKey || submittedRef.current) return;
    const timer = setTimeout(() => {
      const cur = coreRef.current;
      const final = outcomeOf(cur);
      if (!final || submittedRef.current) return;
      submittedRef.current = true;
      const g = cur.game;
      const names: [string, string] = [players[0]?.name ?? "Red", players[1]?.name ?? "Yellow"];
      const display = { kind: "svg" as const, svg: boardSvg(g), alt: boardAlt(g, names) };
      const data = { moves: [...g.moves], winnerSeat: final.winner, reason: final.reason };
      xapps
        .submit({ score: scoreOf(final, mySeat), data: { ...data, seat: mySeat }, display })
        .then(() => setSubmitted(true))
        .catch(() => setSubmitted(true));
      if (bot && botSeat !== null) {
        xapps.submitFor(bot.id, { score: scoreOf(final, botSeat), data: { ...data, seat: botSeat }, display }).catch(noop);
      }
    }, SUBMIT_AFTER_MS + (game.discs.length ? dropPlan(game.discs[game.discs.length - 1]!.row).totalMs : 0));
    return () => clearTimeout(timer);
    // Keyed on the outcome only: re-renders must not restart the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  /* ---------------------------------------------------------------- */
  /* Host HUD                                                         */
  /* ---------------------------------------------------------------- */

  const turnPlayer = players[game.turn];
  let status: string;
  if (!started) status = "Get ready…";
  else if (outcome?.winner === mySeat) status = outcome.reason === "abandon" ? "Opponent left — you win!" : "You win!";
  else if (outcome && outcome.winner !== null) status = `@${players[outcome.winner]?.handle ?? "opponent"} wins`;
  else if (outcome) status = "Draw — board full";
  else if (myTurn) status = "Your move";
  else status = `@${turnPlayer?.handle ?? "opponent"} is thinking…`;

  const turnId = started && !over ? (turnPlayer?.id ?? null) : null;
  useEffect(() => {
    xapps.ui.setStatus(status).catch(noop);
  }, [xapps, status]);
  useEffect(() => {
    xapps.ui.setTurn(turnId).catch(noop);
  }, [xapps, turnId]);

  const discCount = game.moves.length;
  const p0 = players[0]?.id;
  const p1 = players[1]?.id;
  useEffect(() => {
    if (!p0 || !p1) return;
    xapps.ui.setScores({ [p0]: Math.ceil(discCount / 2), [p1]: Math.floor(discCount / 2) }).catch(noop);
  }, [xapps, p0, p1, discCount]);

  const aimSource = live ? liveAim : botAim;
  const opponentAim = aimSource && aimSource.n === game.moves.length ? aimSource.col : null;

  return {
    xapps,
    started,
    result,
    game,
    players,
    me,
    opponent,
    mySeat,
    oppSeat,
    live,
    isBotGame: botSeat !== null,
    turnStartedAt: core.turnStartedAt,
    playing,
    myTurn,
    opponentTurn: playing && game.turn === oppSeat,
    opponentAim,
    opponentOnline,
    outcome,
    submitted,
    autoDropped,
    status,
    drop,
    aim,
  };
}

export type FourInARow = ReturnType<typeof useFourInARow>;
