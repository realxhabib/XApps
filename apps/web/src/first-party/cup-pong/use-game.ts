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
import { reportStats, unlockAchievements } from "../shared/progress";
import { cupsAlt, cupsSvg } from "./display";
import { frontCup, other, type Formation, type Seat } from "./geometry";
import {
  F_BOUNCE,
  F_RIM,
  F_TIMEOUT,
  PREVIEW_THROWS,
  THROW_MS,
  actorOf,
  applyAction,
  applyStateAction,
  botPick,
  botRerack,
  botThrow,
  earnedAchievements,
  gameAt,
  gameStats,
  newGame,
  parseAction,
  readPongState,
  replayFrom,
  rerackChoices,
  scoreFor,
  validateAction,
  type Action,
  type Difficulty,
  type GameState,
  type Seats,
  type Traj,
} from "./logic";
import { encodeEvents, encodePath, simulateThrow, type ThrowInput } from "./physics";

const TAG = "cup-pong";
const noop = () => {};

/** Give up on a silent live opponent this long after their ball was due. */
const ABANDON_AFTER_MS = THROW_MS + 30_000;
const REFRESH_AFTER_MS = THROW_MS + 4_000;
/** Let the last cup's celebration play before the host covers the app. */
const SUBMIT_AFTER_MS = 1_700;
/** A room echo the state never confirms is dropped after this. */
const ECHO_TTL_MS = 5_000;
const TURN_REPAIR_MS = 1_200;

export type EndReason = "cleared" | "abandon";
export interface Outcome {
  winner: Seat;
  reason: EndReason;
}

/** An action shown before the shared state confirms it (ours, or a live opponent's room echo). */
interface Optimistic {
  n: number;
  action: Action;
}

/** Where the other player's ball is in their hand (live room, or the bot winding up). */
export interface HandAim {
  n: number;
  seat: Seat;
  aim: number;
  lift: number;
}

type TrajData = { path: number[]; ev: number[] };

const actionKey = (n: number, a: Action) =>
  a.k === "t" ? `${n}:${a.by}:${a.a}:${a.p}:${a.c}:${a.f}` : `${n}:${a.by}:${a.k}`;

function field(payload: Json, key: string): Json | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload[key] : undefined;
}

const isNums = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 2_000 && v.every((x) => typeof x === "number");

/**
 * Everything about a Cup Pong match that isn't pixels.
 *
 * The game lives in the shared match state as an action log (see logic.ts),
 * so live, async and practice games all work the same way: an action is
 * `state.update(append)` and, when the turn passes, `turn.end()`. The
 * *thrower* simulates each throw and stores its outcome plus a compact
 * trajectory; everyone else replays that trajectory. Live games add room
 * messages on top (the ball in the thrower's hand, and an instant echo of
 * each action), never as the source of truth. Bots are played by this client.
 *
 * `shown` is how many actions the table has finished animating: the view
 * advances it, and nothing new (bot, clock, submission) happens until the
 * table has caught up.
 */
export function useCupPong(difficulty: Difficulty) {
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

  const p0: PlayerInfo | undefined = seated[0];
  const p1: PlayerInfo | undefined = seated[1];
  const seat0 = p0?.id ?? "";
  const seat1 = p1?.id ?? "";
  const seats = useMemo<Seats>(() => [seat0, seat1], [seat0, seat1]);
  const tableReady = !!seat0 && !!seat1;
  const mySeat: Seat | null = spectating ? null : seat1 === meInfo.id ? 1 : 0;
  const players = useMemo(() => [p0, p1] as const, [p0, p1]);
  const botSeat: Seat | null = bot ? (seat1 === bot.id ? 1 : seat0 === bot.id ? 0 : null) : null;
  const live = !async && !bot && tableReady && !p0?.isBot && !p1?.isBot;
  const canSend = live && !spectating;
  /** The ball clock only runs against a human in a live game. */
  const timed = live && mode === "live";

  const seatOf = useCallback((id: string): Seat | null => (id === seat0 ? 0 : id === seat1 ? 1 : null), [seat0, seat1]);

  /* ---------------------------------------------------------------- */
  /* The log: shared state + one optimistic action                    */
  /* ---------------------------------------------------------------- */

  const read = useMemo(() => (tableReady ? readPongState(state, seats) : null), [state, seats, tableReady]);
  const unreadable = tableReady && read === null;
  const base = read?.game ?? EMPTY;
  const baseLog: readonly Action[] = read?.log ?? NO_LOG;
  const recent: readonly Traj[] = read?.recent ?? NO_TRAJ;

  const [pending, setPending] = useState<Optimistic | null>(null);
  const [echo, setEcho] = useState<Optimistic | null>(null);
  const layer = pending ?? echo;
  const layered = useMemo(() => {
    if (!layer || layer.n !== baseLog.length) return null;
    const seat = seatOf(layer.action.by);
    if (seat === null) return null;
    const next = applyAction(base, layer.action, seat);
    return next ? { game: next, log: [...baseLog, layer.action] } : null;
  }, [base, baseLog, layer, seatOf]);
  const game = layered?.game ?? base;
  const log: readonly Action[] = layered?.log ?? baseLog;
  const confirmed = layered === null;

  // Trajectories we know locally (our throws, the bot's, live echoes), keyed by action.
  const [localTrajs, setLocalTrajs] = useState<Record<string, TrajData>>({});
  const trajFor = useCallback(
    (n: number): TrajData | null => {
      const action = log[n];
      if (!action || action.k !== "t") return null;
      const local = localTrajs[actionKey(n, action)];
      if (local) return local;
      const stored = recent.find((r) => r.n === n);
      return stored ? { path: stored.path, ev: stored.ev } : null;
    },
    [log, localTrajs, recent],
  );

  /* ---------------------------------------------------------------- */
  /* Playback position                                                */
  /* ---------------------------------------------------------------- */

  // Async players watch the opponent's latest run of throws when they open the game.
  const [startShown] = useState(() => {
    if (!read) return 0;
    if (async && !spectating) return replayFrom(read.log, read.recent, meInfo.id);
    return read.log.length;
  });
  const [shownRaw, setShown] = useState(startShown);
  const shown = Math.min(shownRaw, log.length);
  const [idleSince, setIdleSince] = useState(() => Date.now());
  const advance = useCallback((to: number) => {
    setShown((s) => Math.max(s, to));
    setIdleSince(Date.now());
  }, []);
  const shownGame = useMemo(() => (shown === log.length ? game : gameAt(log, seats, shown)), [shown, log, game, seats]);
  const caughtUp = shown === log.length;

  const [abandonedBy, setAbandonedBy] = useState<Seat | null>(null);
  const outcome: Outcome | null =
    base.winner !== null ? { winner: base.winner, reason: "cleared" } : abandonedBy !== null ? { winner: other(abandonedBy), reason: "abandon" } : null;
  const over = outcome !== null;

  const latest = useRef({ base, baseLog, game, log, seats, shownGame, turnHolder });
  useEffect(() => {
    latest.current = { base, baseLog, game, log, seats, shownGame, turnHolder };
  });

  /* ---------------------------------------------------------------- */
  /* Turns                                                            */
  /* ---------------------------------------------------------------- */

  const idOf = (seat: Seat) => (seat === 0 ? seat0 : seat1);
  const turnOk = (seat: Seat) => turnHolder === null || turnHolder === idOf(seat);

  const awaitingOpponent = matchStatus === "open" || matchStatus === "pending";
  const playing = started && tableReady && !unreadable && !over && !awaitingOpponent;
  const actor = actorOf(game);
  const idle = playing && confirmed && caughtUp && !game.over;
  const myAction = idle && mySeat !== null && actor === mySeat && turnOk(mySeat);
  const myThrow = myAction && game.pendingPick === null;
  const myPick = myAction && game.pendingPick === mySeat;
  const rerackNow = myThrow ? rerackChoices(game, mySeat as Seat) : NO_FORMATIONS;
  const throwsByMe = mySeat === null ? 0 : shownGame.stats[mySeat].throws;
  const showPreview = mySeat !== null && (throwsByMe < PREVIEW_THROWS || (!!bot && difficulty === "easy"));

  const inFlight = useRef(false);

  /**
   * Appends `action` (with its trajectory) to the shared state, showing it at
   * once; passes the turn when it moved. Rejected actions roll back.
   */
  const commit = useCallback(
    async (action: Action, traj: TrajData | null): Promise<"ok" | "busy" | "invalid" | "failed"> => {
      const cur = latest.current;
      if (inFlight.current) return "busy";
      const seat = cur.seats[0] === action.by ? 0 : cur.seats[1] === action.by ? 1 : null;
      if (seat === null || !validateAction(cur.base, action, seat).ok) return "invalid";
      const n = cur.baseLog.length;
      inFlight.current = true;
      if (traj) setLocalTrajs((m) => ({ ...m, [actionKey(n, action)]: traj }));
      setPending({ n, action });
      setEcho(null);
      if (canSend) xapps.room.send("act", { n, act: action, ...(traj ?? {}) }).catch(noop);
      try {
        let after: GameState | null = null;
        await xapps.state.update((draft) => {
          const res = applyStateAction(draft, action, latest.current.seats, traj, xapps.turn.current);
          after = res.ok ? res.game : null;
          return res.ok ? res.state : undefined;
        });
        const next = after as GameState | null;
        if (!next) return "failed";
        if (!next.over && actorOf(next) !== seat) await xapps.turn.end(cur.seats[actorOf(next)]).catch(noop);
        return "ok";
      } catch {
        return "failed";
      } finally {
        inFlight.current = false;
        setPending(null);
      }
    },
    [xapps, canSend],
  );

  const reportFailure = useCallback(
    (res: string) => {
      if (res !== "failed") return;
      play("error");
      xapps.ui.toast("That throw didn't go through — the table was refreshed", "danger").catch(noop);
    },
    [xapps],
  );

  /** Simulates and throws for `seat` (us or our bot). */
  const throwFor = useCallback(
    (seat: Seat, input: ThrowInput) => {
      const g = latest.current.base;
      const sim = simulateThrow(input, g.racks[other(seat)], { fire: g.fire[seat] });
      const f = (sim.bounce ? F_BOUNCE : 0) | (sim.rim ? F_RIM : 0);
      const action: Action = { k: "t", by: latest.current.seats[seat], a: sim.input.aim, p: sim.input.power, c: sim.cup ?? -1, f, at: Date.now() };
      return commit(action, { path: encodePath(sim.path), ev: encodeEvents(sim.events) });
    },
    [commit],
  );

  const throwBall = useCallback(
    (input: ThrowInput) => {
      if (!myThrow || mySeat === null) return false;
      void throwFor(mySeat, input).then(reportFailure);
      return true;
    },
    [myThrow, mySeat, throwFor, reportFailure],
  );

  const pickCup = useCallback(
    (id: number) => {
      if (!myPick || mySeat === null) return false;
      const action: Action = { k: "x", by: latest.current.seats[mySeat], c: id, at: Date.now() };
      if (!validateAction(latest.current.base, action, mySeat).ok) return false;
      void commit(action, null).then(reportFailure);
      return true;
    },
    [myPick, mySeat, commit, reportFailure],
  );

  const callRerack = useCallback(
    (formation: Formation) => {
      if (!myThrow || mySeat === null) return false;
      const action: Action = { k: "r", by: latest.current.seats[mySeat], f: formation, at: Date.now() };
      if (!validateAction(latest.current.base, action, mySeat).ok) return false;
      void commit(action, null).then(reportFailure);
      return true;
    },
    [myThrow, mySeat, commit, reportFailure],
  );

  // Turn repair: the state says someone else acts next but the host still has
  // the turn with us (or our bot) — e.g. a reload between the write and turn.end.
  const nextActorId = tableReady && !unreadable && !base.over ? idOf(actorOf(base)) : null;
  const holderIsOurs = turnHolder !== null && (turnHolder === meInfo.id || (!!bot && turnHolder === bot.id));
  const repaired = useRef("");
  useEffect(() => {
    if (spectating || !started || !nextActorId || !holderIsOurs || turnHolder === nextActorId) return;
    const key = `${base.n}:${turnHolder}`;
    if (repaired.current === key) return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      repaired.current = key;
      xapps.turn.end(nextActorId).catch(noop);
    }, TURN_REPAIR_MS);
    return () => clearTimeout(timer);
  }, [spectating, started, nextActorId, holderIsOurs, turnHolder, base.n, xapps]);

  // Resume from the freshest state when the match (re)starts.
  useEffect(
    () =>
      xapps.onStart(() => {
        if (!xapps.isSpectator) xapps.state.get().catch(noop);
      }),
    [xapps],
  );

  /* ---------------------------------------------------------------- */
  /* Live room: the ball in their hand, and instant action echoes     */
  /* ---------------------------------------------------------------- */

  const [roomAim, setRoomAim] = useState<HandAim | null>(null);
  const [botAim, setBotAim] = useState<HandAim | null>(null);

  useRoomEvent("aim", (payload, from) => {
    const seat = seatOf(from);
    if (!live || seat === null || seat === mySeat) return;
    const n = field(payload, "n");
    const aim = field(payload, "aim");
    const lift = field(payload, "lift");
    if (typeof n !== "number" || typeof aim !== "number" || typeof lift !== "number") return;
    setRoomAim({ n, seat, aim: Math.max(-1, Math.min(1, aim)), lift: Math.max(0, Math.min(1, lift)) });
  });

  useRoomEvent("act", (payload, from) => {
    const seat = seatOf(from);
    if (!live || seat === null || seat === mySeat) return;
    const n = field(payload, "n");
    const action = parseAction(field(payload, "act"));
    const cur = latest.current.base;
    if (typeof n !== "number" || !action || action.by !== from || n !== latest.current.baseLog.length) return;
    if (!validateAction(cur, action, seat).ok) return;
    const path = field(payload, "path");
    const ev = field(payload, "ev");
    if (action.k === "t" && isNums(path) && isNums(ev)) {
      setLocalTrajs((m) => ({ ...m, [actionKey(n, action)]: { path, ev } }));
    }
    setEcho({ n, action });
  });

  useEffect(() => {
    if (!echo) return;
    const timer = setTimeout(() => setEcho((e) => (e === echo ? null : e)), ECHO_TTL_MS);
    return () => clearTimeout(timer);
  }, [echo]);

  const lastAimSent = useRef(0);
  const shareAim = useCallback(
    (aim: number, lift: number) => {
      if (!canSend || !myThrow) return;
      const now = Date.now();
      if (now - lastAimSent.current < 80) return;
      lastAimSent.current = now;
      xapps.room.send("aim", { n: latest.current.log.length, aim: Math.round(aim * 100) / 100, lift: Math.round(lift * 100) / 100 }).catch(noop);
    },
    [canSend, myThrow, xapps],
  );

  // Opponent came back online → re-read the state in case we missed a push.
  const opponentSeat: Seat = mySeat === null ? 1 : other(mySeat);
  const opponent = players[opponentSeat];
  const opponentOnline = !live || !opponent || online.length === 0 || online.includes(opponent.id);
  const wasOnline = useRef(true);
  useEffect(() => {
    if (opponentOnline && !wasOnline.current) xapps.state.get().catch(noop);
    wasOnline.current = opponentOnline;
  }, [opponentOnline, xapps]);

  /* ---------------------------------------------------------------- */
  /* Ball clock (live vs a human)                                     */
  /* ---------------------------------------------------------------- */

  const clockRunning = timed && idle;
  const [autoPlayed, setAutoPlayed] = useState<number | null>(null);
  useEffect(() => {
    if (!clockRunning || !myAction || mySeat === null) return;
    const left = THROW_MS - (Date.now() - idleSince);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 5; s >= 1; s--) {
      const at = left - s * 1000;
      if (at > 0) timers.push(setTimeout(() => play("tick"), at));
    }
    timers.push(
      setTimeout(
        () => {
          const g = latest.current.base;
          const by = latest.current.seats[mySeat];
          setAutoPlayed(g.n);
          if (g.pendingPick === mySeat) {
            const id = frontCup(g.racks[other(mySeat)])?.id;
            if (id !== undefined) void commit({ k: "x", by, c: id, at: Date.now() }, null);
          } else {
            void commit({ k: "t", by, a: 0, p: 0, c: -1, f: F_TIMEOUT, at: Date.now() }, null);
          }
        },
        Math.max(0, left),
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [clockRunning, myAction, mySeat, idleSince, commit]);

  // Watchdog: refresh when the opponent's ball runs over; give up on a silent one.
  useEffect(() => {
    if (!timed || spectating || !started || result || over || !idle || actor === mySeat) return;
    let refreshed = false;
    const id = setInterval(() => {
      const waited = Date.now() - idleSince;
      if (waited > REFRESH_AFTER_MS && !refreshed) {
        refreshed = true;
        xapps.state.get().catch(noop);
      }
      if (waited > ABANDON_AFTER_MS) setAbandonedBy(actor);
    }, 1_000);
    return () => clearInterval(id);
  }, [timed, spectating, started, result, over, idle, actor, mySeat, idleSince, xapps]);

  /* ---------------------------------------------------------------- */
  /* Bot                                                              */
  /* ---------------------------------------------------------------- */

  const botToAct = botSeat !== null && idle && actor === botSeat && turnOk(botSeat);
  useEffect(() => {
    if (!botToAct || botSeat === null) return;
    const g = latest.current.base;
    const n = g.n;
    const rnd = xapps.random.fork(`bot:${n}`);
    const random = () => rnd.next();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const stillMine = () => latest.current.base.n === n;

    if (g.pendingPick === botSeat) {
      later(900, () => {
        const id = botPick(latest.current.base, botSeat);
        if (id !== null && stillMine()) void commit({ k: "x", by: latest.current.seats[botSeat], c: id, at: Date.now() }, null);
      });
      return () => timers.forEach(clearTimeout);
    }

    const formation = botRerack(g, botSeat, difficulty, random);
    if (formation) {
      later(1_000, () => {
        if (stillMine()) void commit({ k: "r", by: latest.current.seats[botSeat], f: formation, at: Date.now() }, null);
      });
      return () => timers.forEach(clearTimeout);
    }

    const input = botThrow(g.racks[other(botSeat)], difficulty, random, g.fire[botSeat]);
    // Wind-up: the ball wanders in its hand, settles on the aim, a little lift… release.
    const think = 650 + random() * 650;
    later(200, () => setBotAim({ n, seat: botSeat, aim: input.aim * 0.4 + (random() - 0.5) * 0.6, lift: 0 }));
    later(200 + think * 0.5, () => setBotAim({ n, seat: botSeat, aim: input.aim, lift: 0.25 }));
    later(200 + think * 0.85, () => setBotAim({ n, seat: botSeat, aim: input.aim, lift: 0.9 }));
    later(200 + think, () => {
      if (!stillMine()) return;
      setBotAim(null);
      void throwFor(botSeat, input);
    });
    return () => timers.forEach(clearTimeout);
  }, [botToAct, botSeat, difficulty, commit, throwFor, xapps]);

  /* ---------------------------------------------------------------- */
  /* Achievements: as the table shows each moment                      */
  /* ---------------------------------------------------------------- */

  const shownOver = shownGame.over;
  useEffect(() => {
    if (!started || spectating || mySeat === null || unreadable || shown <= startShown) return;
    unlockAchievements(xapps, earnedAchievements(latest.current.shownGame, mySeat), TAG);
  }, [started, spectating, mySeat, unreadable, shown, startShown, shownOver, xapps]);

  /* ---------------------------------------------------------------- */
  /* Submission: once per player when the result is on the table      */
  /* ---------------------------------------------------------------- */

  const [submitted, setSubmitted] = useState(() => !spectating && xapps.me.submitted);
  const submittedRef = useRef(submitted);
  const outcomeKey = outcome && started && (caughtUp || outcome.reason === "abandon") ? `${outcome.reason}:${outcome.winner}` : null;
  useEffect(() => {
    if (!outcomeKey || spectating || submittedRef.current || mySeat === null || !outcome) return;
    const fresh = shown > startShown;
    const timer = setTimeout(() => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      const g = latest.current.base;
      const winner = outcome.winner;
      const names: [string, string] = [players[0]?.name ?? "Player 1", players[1]?.name ?? "Player 2"];
      const display = { kind: "svg" as const, svg: cupsSvg(g), alt: cupsAlt(g, names, winner) };
      const data = { cups: [g.racks[0].length, g.racks[1].length], winnerSeat: winner, reason: outcome.reason, actions: g.n };
      if (!xapps.me.submitted) {
        reportStats(xapps, gameStats(g, mySeat, winner), TAG);
        unlockAchievements(xapps, earnedAchievements(g, mySeat, winner), TAG);
        xapps
          .submit({ score: scoreFor(winner, mySeat), data: { ...data, seat: mySeat }, display })
          .then(() => setSubmitted(true))
          .catch(() => setSubmitted(true));
      } else {
        setSubmitted(true);
      }
      if (bot && botSeat !== null && !xapps.player(bot.id)?.submitted) {
        xapps.submitFor(bot.id, { score: scoreFor(winner, botSeat), data: { ...data, seat: botSeat }, display }).catch(noop);
      }
    }, fresh ? SUBMIT_AFTER_MS : 900);
    return () => clearTimeout(timer);
    // Keyed on the outcome only: re-renders must not restart the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  /* ---------------------------------------------------------------- */
  /* Host HUD                                                         */
  /* ---------------------------------------------------------------- */

  const name = (seat: Seat) => `@${players[seat]?.handle ?? "player"}`;
  const shownActor = actorOf(shownGame);
  let status: string;
  if (!started) status = spectating ? "Watching" : "Get ready…";
  else if (unreadable) status = "This table couldn't be loaded";
  else if (awaitingOpponent) status = `Waiting for ${name(opponentSeat)} to accept`;
  else if (outcome && outcome.winner === mySeat) status = outcome.reason === "abandon" ? "Opponent left — you win!" : "You win!";
  else if (outcome) status = `${name(outcome.winner)} wins`;
  else if (myPick) status = "Bounce shot! Pick a bonus cup";
  else if (myThrow) status = shownGame.ball === 0 ? "Your throw — ball 1 of 2" : "Your throw — ball 2 of 2";
  else if (spectating) status = `${name(shownActor)} is throwing`;
  else if (async && actor !== mySeat) status = `Waiting for ${name(actor)}`;
  else status = `${name(shownActor)} is throwing…`;

  const turnId = started && !over ? (players[shownActor]?.id ?? null) : null;
  useEffect(() => {
    xapps.ui.setStatus(status).catch(noop);
  }, [xapps, status]);
  useEffect(() => {
    xapps.ui.setTurn(turnId).catch(noop);
  }, [xapps, turnId]);
  const sunk0 = 10 - shownGame.racks[1].length;
  const sunk1 = 10 - shownGame.racks[0].length;
  useEffect(() => {
    if (!seat0 || !seat1) return;
    xapps.ui.setScores({ [seat0]: sunk0, [seat1]: sunk1 }).catch(noop);
  }, [xapps, seat0, seat1, sunk0, sunk1]);

  const aimSource = botSeat !== null ? botAim : live ? roomAim : null;
  const opponentAim = aimSource && aimSource.n === log.length && aimSource.seat === actor && idle && actor !== mySeat ? aimSource : null;

  return {
    xapps,
    started,
    result,
    players,
    seats,
    mySeat,
    opponentSeat,
    spectating,
    mode,
    async,
    live,
    timed,
    isBotGame: botSeat !== null,
    botSeat,
    deadline: async ? deadline : null,
    playing,
    awaitingOpponent,
    unreadable,
    game,
    log,
    shown,
    shownGame,
    caughtUp,
    advance,
    trajFor,
    idle,
    idleSince,
    actor,
    myThrow,
    myPick,
    rerackNow,
    showPreview,
    opponentAim,
    opponentOnline,
    outcome,
    submitted,
    autoPlayed,
    status,
    throwBall,
    pickCup,
    callRerack,
    shareAim,
  };
}

const EMPTY = newGame();
const NO_LOG: readonly Action[] = [];
const NO_TRAJ: readonly Traj[] = [];
const NO_FORMATIONS: readonly Formation[] = [];

export type CupPong = ReturnType<typeof useCupPong>;
