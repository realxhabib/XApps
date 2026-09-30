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
import { useBot } from "../shared/hooks";
import { reportStats, unlockAchievements } from "../shared/progress";
import { planBotShot, type BotLevel } from "./bot";
import { tableAlt, tableSvg } from "./display";
import { R, TABLE_L, TABLE_W, type Vec } from "./physics";
import { earnedAchievements, gameStats } from "./progress";
import {
  SHOT_MS,
  defaultCueSpot,
  groupProgress,
  legalTargets,
  needsCall,
  newGame,
  other,
  playShot,
  readState,
  startTable,
  timeoutFoul,
  toStateJson,
  type EndReason,
  type Game,
  type Seat,
  type ShotError,
  type ShotInput,
} from "./rules";
import type { OtherAim, Playback } from "./table";

export type Outcome = { winner: Seat; reason: EndReason | "abandon" };

/** Practice bots play at this level. */
export const BOT_LEVEL: BotLevel = "medium";

/** Re-read the state if a live opponent's shot hasn't landed by now. */
const REFRESH_AFTER_MS = SHOT_MS + 6_000;
/** Give up on a silent live opponent. */
const ABANDON_AFTER_MS = SHOT_MS + 40_000;
/** Let the final shot and the banner play before the host covers the app. */
const SUBMIT_AFTER_MS = 1_800;
/** Wait this long before repairing a turn the state has already passed on. */
const TURN_REPAIR_MS = 1_200;
const AIM_EVERY_MS = 80;

const noop = () => {};

function field(payload: Json, key: string): Json | undefined {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload[key] : undefined;
}

const num = (value: Json | undefined): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function outcomeOf(game: Game, abandonedBy: Seat | null): Outcome | null {
  if (game.winner !== null && game.reason) return { winner: game.winner, reason: game.reason };
  if (abandonedBy !== null) return { winner: other(abandonedBy), reason: "abandon" };
  return null;
}

/**
 * Everything about an 8-Ball match that isn't pixels.
 *
 * The table lives in the shared match state (see `rules.ts`). The shooter's
 * client simulates each shot and writes the result together with a compact
 * recording of it; every client (the shooter included) animates that
 * recording, then settles on the stored positions. So live, play-anytime and
 * practice games all work the same way: `state.update(shot)` then
 * `turn.end(next)` when the table changes hands. Live games add aim previews
 * over the room. Bots are played by this client.
 */
export function useEightBall() {
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
  const seats = useMemo<readonly [string, string]>(() => [seat0, seat1], [seat0, seat1]);
  const tableReady = !!seat0 && !!seat1;
  const players = useMemo(() => [p0, p1] as const, [p0, p1]);

  const mySeat: Seat | null = spectating ? null : seat1 === meInfo.id ? 1 : 0;
  const viewSeat: Seat = mySeat ?? 0;
  const oppSeat = other(viewSeat);
  const me = mySeat === null ? undefined : players[mySeat];
  const opponent = players[oppSeat];
  const botSeat: Seat | null = bot ? (seat1 === bot.id ? 1 : seat0 === bot.id ? 0 : null) : null;
  const live = !async && !bot && tableReady && !p0?.isBot && !p1?.isBot;
  const canSend = live && !spectating;
  /** The shot clock runs in live games between people. */
  const timed = live && !spectating;
  const myId = meInfo.id;

  /* ---------------------------------------------------------------- */
  /* The table: shared state, plus our shot until the write confirms   */
  /* ---------------------------------------------------------------- */

  const fresh = useMemo(() => newGame(xapps.random.fork("rack").next), [xapps]);
  const read = useMemo(() => readState(state), [state]);
  const unreadable = tableReady && read === "bad";
  const base: Game = read && read !== "bad" ? read : fresh;

  const [pending, setPending] = useState<Game | null>(null);
  if (pending && base.n >= pending.n) setPending(null);
  const game = pending && pending.n > base.n ? pending : base;

  /* ---------------------------------------------------------------- */
  /* Shot playback                                                    */
  /* ---------------------------------------------------------------- */

  // The last shot we've finished animating. On open, the opponent's latest shot replays.
  const [shownN, setShownN] = useState(() => {
    const l = base.last;
    return l && l.kind === "shot" && l.n === base.n - 1 && l.by !== myId ? base.n - 1 : base.n;
  });
  /** The last shot this client played (ours or our bot's): its cue was already drawn back on screen. */
  const [localN, setLocalN] = useState(-1);
  const lastShot = game.last && game.last.n === game.n - 1 ? game.last : null;
  const playable = !!lastShot && lastShot.kind === "shot" && lastShot.rec !== null;
  if (game.n - 1 > shownN) setShownN(game.n - 1);
  if (shownN === game.n - 1 && !playable) setShownN(game.n);

  const [replay, setReplay] = useState<{ key: string; n: number } | null>(null);
  if (replay && replay.n !== game.n) setReplay(null);

  const playback = useMemo<Playback | null>(() => {
    if (!started || !lastShot?.rec) return null;
    const strike = lastShot.strike ? { angle: lastShot.strike.a, power: lastShot.strike.p } : null;
    if (shownN === game.n - 1) return { key: String(game.n), rec: lastShot.rec, windup: lastShot.n + 1 !== localN, strike };
    if (replay && shownN >= game.n) return { key: replay.key, rec: lastShot.rec, windup: true, strike };
    return null;
  }, [started, lastShot, shownN, game.n, localN, replay]);
  const animating = playback !== null;

  const onPlaybackDone = useCallback((key: string) => {
    if (key.startsWith("replay")) setReplay((r) => (r?.key === key ? null : r));
    else setShownN((n) => Math.max(n, Number(key)));
  }, []);


  /* ---------------------------------------------------------------- */
  /* Turns                                                            */
  /* ---------------------------------------------------------------- */

  const [abandonedBy, setAbandonedBy] = useState<Seat | null>(null);
  const outcome = outcomeOf(base, abandonedBy);
  const over = outcome !== null;
  const awaitingOpponent = matchStatus === "open" || matchStatus === "pending";
  const playing = started && tableReady && !unreadable && !over && !awaitingOpponent;
  const idOf = (seat: Seat) => (seat === 0 ? seat0 : seat1);
  const turnOk = (seat: Seat) => turnHolder === null || turnHolder === idOf(seat);
  const [busy, setBusy] = useState(false);
  const settled = !animating && pending === null && !busy;
  const turnSeat = game.turn;
  const myTurn = playing && settled && mySeat !== null && turnSeat === mySeat && turnOk(mySeat);
  const botTurn = playing && settled && botSeat !== null && turnSeat === botSeat && turnOk(botSeat);
  const opponentTurn = playing && turnSeat === oppSeat;

  const latest = useRef({ base, game, seats });
  useEffect(() => {
    latest.current = { base, game, seats };
  });

  const replayLast = useCallback(() => {
    setReplay({ key: `replay-${Date.now()}`, n: latest.current.game.n });
  }, []);

  const inFlight = useRef(false);

  /** Writes a finished game (after a shot or a time foul) and passes the turn if it changed hands. */
  const write = useCallback(
    async (from: Game, next: Game, seat: Seat): Promise<"ok" | "failed"> => {
      const json = toStateJson(next);
      const confirmed = readState(json) as Game; // exactly what everyone will read
      inFlight.current = true;
      setBusy(true);
      setLocalN(next.n);
      setPending(confirmed);
      try {
        let written = false;
        await xapps.state.update((draft) => {
          const now = readState(draft);
          const n = now === null ? 0 : now === "bad" ? -1 : now.n;
          written = n === from.n;
          return written ? (json as unknown as Json) : undefined;
        });
        if (!written) {
          setPending(null);
          return "failed";
        }
        if (confirmed.winner === null && confirmed.turn !== seat) {
          await xapps.turn.end(latest.current.seats[confirmed.turn]).catch(noop);
        }
        return "ok";
      } catch {
        setPending(null);
        return "failed";
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [xapps],
  );

  /** Plays `input` for `seat` (us, or the bot we drive). */
  const commitShot = useCallback(
    async (input: ShotInput, seat: Seat): Promise<"ok" | ShotError | "busy" | "failed"> => {
      if (inFlight.current) return "busy";
      const cur = latest.current.base;
      const res = playShot(cur, seat, input, { by: latest.current.seats[seat], at: Date.now() });
      if (!res.ok) return res.reason;
      return write(cur, res.game, seat);
    },
    [write],
  );

  const shoot = useCallback(
    (input: ShotInput): "ok" | ShotError | "not-ready" => {
      if (!myTurn || mySeat === null) return "not-ready";
      const cur = latest.current.base;
      // Validate synchronously so the UI can explain a refusal.
      const start = startTable(cur, mySeat, input);
      if ("error" in start) return start.error;
      void commitShot(input, mySeat).then((res) => {
        if (res === "failed") xapps.ui.toast("That shot didn't go through — the table was refreshed", "danger").catch(noop);
      });
      return "ok";
    },
    [myTurn, mySeat, commitShot, xapps],
  );

  // Turn repair: the state already shows the other player to shoot but the host still has
  // the turn with us (or our bot) — e.g. we reloaded between the write and turn.end.
  const nextShooterId = tableReady && !unreadable && base.winner === null ? idOf(base.turn) : null;
  const holderIsOurs = turnHolder !== null && (turnHolder === myId || (!!bot && turnHolder === bot.id));
  const repaired = useRef("");
  useEffect(() => {
    if (spectating || !started || !nextShooterId || !holderIsOurs || turnHolder === nextShooterId) return;
    const key = `${base.n}:${turnHolder}`;
    if (repaired.current === key) return;
    const timer = setTimeout(() => {
      if (inFlight.current) return;
      repaired.current = key;
      xapps.turn.end(nextShooterId).catch(noop);
    }, TURN_REPAIR_MS);
    return () => clearTimeout(timer);
  }, [spectating, started, nextShooterId, holderIsOurs, turnHolder, base.n, xapps]);

  /* ---------------------------------------------------------------- */
  /* Start, state pushes, live watchdog                               */
  /* ---------------------------------------------------------------- */

  const [startN] = useState(() => base.n);
  const lastChange = useRef(0);
  useEffect(
    () =>
      xapps.onStart(() => {
        lastChange.current = Date.now();
        if (!xapps.isSpectator) xapps.state.get().catch(noop);
      }),
    [xapps],
  );
  useEffect(
    () =>
      xapps.state.onChange(() => {
        lastChange.current = Date.now();
      }),
    [xapps],
  );

  const opponentOnline = !live || !opponent || online.length === 0 || online.includes(opponent.id);
  const wasOnline = useRef(true);
  useEffect(() => {
    if (opponentOnline && !wasOnline.current) xapps.state.get().catch(noop);
    wasOnline.current = opponentOnline;
  }, [opponentOnline, xapps]);

  const waitingOnOpponent = live && !spectating && playing && settled && turnSeat === oppSeat;
  useEffect(() => {
    if (!waitingOnOpponent) return;
    const since = Date.now();
    lastChange.current = Math.max(lastChange.current, since);
    let refreshed = false;
    const id = setInterval(() => {
      const waited = Date.now() - lastChange.current;
      if (waited > REFRESH_AFTER_MS && !refreshed) {
        refreshed = true;
        xapps.state.get().catch(noop);
      }
      if (waited > ABANDON_AFTER_MS) setAbandonedBy(oppSeat);
    }, 1_000);
    return () => clearInterval(id);
  }, [waitingOnOpponent, oppSeat, xapps]);

  /* ---------------------------------------------------------------- */
  /* Shot clock (live)                                                */
  /* ---------------------------------------------------------------- */

  const [clock, setClock] = useState<{ n: number; at: number } | null>(null);
  const clockRunning = timed && myTurn;
  useEffect(() => {
    if (!clockRunning) return;
    const n = game.n;
    const t = setTimeout(() => setClock((c) => (c?.n === n ? c : { n, at: Date.now() })), 0);
    return () => clearTimeout(t);
  }, [clockRunning, game.n]);
  const turnStartedAt = clockRunning && clock?.n === game.n ? clock.at : null;
  useEffect(() => {
    if (turnStartedAt === null || mySeat === null) return;
    const left = SHOT_MS - (Date.now() - turnStartedAt);
    const timer = setTimeout(
      () => {
        const cur = latest.current.base;
        if (cur.turn !== mySeat || cur.winner !== null || inFlight.current) return;
        const next = timeoutFoul(cur, mySeat, { by: latest.current.seats[mySeat], at: Date.now() });
        if (next) void write(cur, next, mySeat);
      },
      Math.max(0, left),
    );
    return () => clearTimeout(timer);
  }, [turnStartedAt, mySeat, write]);

  /* ---------------------------------------------------------------- */
  /* Live room: aim previews (never the truth)                        */
  /* ---------------------------------------------------------------- */

  const [roomAim, setRoomAim] = useState<(OtherAim & { n: number; seat: Seat }) | null>(null);
  const seatOf = (id: string): Seat | null => (id === seat0 ? 0 : id === seat1 ? 1 : null);
  useRoomEvent("aim", (payload, from) => {
    const seat = seatOf(from);
    if (!live || seat === null || seat === mySeat) return;
    const n = num(field(payload, "n"));
    const a = num(field(payload, "a"));
    const p = num(field(payload, "p"));
    if (n === null || a === null || p === null) return;
    const cx = num(field(payload, "cx"));
    const cy = num(field(payload, "cy"));
    const call = num(field(payload, "call"));
    const cue =
      cx !== null && cy !== null ? { x: Math.min(TABLE_L - R, Math.max(R, cx / 1000)), y: Math.min(TABLE_W - R, Math.max(R, cy / 1000)) } : null;
    setRoomAim({ n, seat, angle: a, power: Math.min(1, Math.max(0, p)), cue, call: call !== null && call >= 0 && call <= 5 ? call : null });
  });

  const lastAimSent = useRef(0);
  const sendAim = useCallback(
    (aim: { angle: number; power: number; cue: Vec | null; call: number | null }, force = false) => {
      if (!canSend || !myTurn) return;
      const now = Date.now();
      if (!force && now - lastAimSent.current < AIM_EVERY_MS) return;
      lastAimSent.current = now;
      const payload: { [key: string]: Json } = {
        n: latest.current.base.n,
        a: Math.round(aim.angle * 10_000) / 10_000,
        p: Math.round(aim.power * 100) / 100,
      };
      if (aim.cue) {
        payload.cx = Math.round(aim.cue.x * 1000);
        payload.cy = Math.round(aim.cue.y * 1000);
      }
      if (aim.call !== null) payload.call = aim.call;
      xapps.room.send("aim", payload).catch(noop);
    },
    [canSend, myTurn, xapps],
  );

  /* ---------------------------------------------------------------- */
  /* Bot                                                              */
  /* ---------------------------------------------------------------- */

  const [botAim, setBotAim] = useState<(OtherAim & { n: number }) | null>(null);
  useEffect(() => {
    if (!botTurn || botSeat === null) return;
    const g = latest.current.base;
    const n = g.n;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) fn();
        }, ms),
      );
    };
    const it = planBotShot(g, botSeat, { level: BOT_LEVEL, random: xapps.random.fork(`bot-${n}`).next });
    const cue0 = g.bih ? defaultCueSpot(g) : (g.balls[0] as Vec);
    // Start by eyeing the nearest ball it may hit.
    const eye = nearestOf(g, botSeat, cue0);
    const glance = eye ? Math.atan2(eye.y - cue0.y, eye.x - cue0.x) : 0;
    later(() => setBotAim({ n, angle: glance, power: 0, cue: g.bih ? cue0 : null, call: null }), 450);
    const began = performance.now();
    const pump = () => {
      const slice = performance.now();
      let step = it.next();
      while (!step.done && performance.now() - slice < 10) step = it.next();
      if (!step.done) {
        later(pump, 0);
        return;
      }
      const plan = step.value;
      const wait = Math.max(0, 700 + Math.random() * 500 - (performance.now() - began));
      const { input } = plan;
      later(() => setBotAim({ n, angle: input.angle, power: 0, cue: input.cue, call: input.call }), wait);
      later(() => setBotAim((a) => (a && a.n === n ? { ...a, power: input.power * 0.4 } : a)), wait + 650);
      later(() => setBotAim((a) => (a && a.n === n ? { ...a, power: input.power } : a)), wait + 950);
      later(() => {
        if (latest.current.base.n !== n) return;
        void commitShot(input, botSeat);
      }, wait + 1_300);
    };
    later(pump, 700);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [botTurn, botSeat, base.n, commitShot, xapps]);

  const otherAim: OtherAim | null = (() => {
    if (!playing || !settled || turnSeat !== oppSeat) return null;
    if (botSeat !== null) return botAim && botAim.n === base.n ? botAim : null;
    if (live && roomAim && roomAim.n === base.n && roomAim.seat === turnSeat) return roomAim;
    return null;
  })();

  /* ---------------------------------------------------------------- */
  /* Achievements the moment a stored shot earns one                  */
  /* ---------------------------------------------------------------- */

  const baseN = base.n;
  const winnerSeat = base.winner;
  useEffect(() => {
    if (!started || spectating || mySeat === null || unreadable || baseN <= startN) return;
    unlockAchievements(xapps, earnedAchievements(latest.current.base, mySeat), "eight-ball");
  }, [started, spectating, mySeat, unreadable, baseN, startN, winnerSeat, xapps]);

  /* ---------------------------------------------------------------- */
  /* Submission: once per player when the table shows a result        */
  /* ---------------------------------------------------------------- */

  const [submitted, setSubmitted] = useState(() => !spectating && xapps.me.submitted);
  const submittedRef = useRef(submitted);
  const outcomeKey = outcome && started && !animating ? `${outcome.reason}:${outcome.winner}` : null;
  useEffect(() => {
    if (!outcomeKey || spectating || submittedRef.current) return;
    const timer = setTimeout(() => {
      const cur = latest.current.base;
      const final = outcomeOf(cur, abandonedBy);
      if (!final || submittedRef.current || mySeat === null) return;
      submittedRef.current = true;
      const names: [string, string] = [players[0]?.name ?? "Player 1", players[1]?.name ?? "Player 2"];
      const display = { kind: "svg" as const, svg: tableSvg(cur), alt: tableAlt(cur, names, final) };
      const data = { winnerSeat: final.winner, reason: final.reason, shots: cur.n, potted: [...cur.potted], best: [...cur.best] };
      if (!xapps.me.submitted) {
        reportStats(xapps, gameStats(cur, mySeat, final.winner), "eight-ball");
        unlockAchievements(xapps, earnedAchievements(cur, mySeat), "eight-ball");
        xapps
          .submit({ score: final.winner === mySeat ? 1 : 0, data: { ...data, seat: mySeat }, display })
          .then(() => setSubmitted(true))
          .catch(() => setSubmitted(true));
      } else {
        setSubmitted(true);
      }
      if (bot && botSeat !== null && !xapps.player(bot.id)?.submitted) {
        xapps.submitFor(bot.id, { score: final.winner === botSeat ? 1 : 0, data: { ...data, seat: botSeat }, display }).catch(noop);
      }
    }, SUBMIT_AFTER_MS);
    return () => clearTimeout(timer);
    // Keyed on the outcome only: re-renders must not restart the delay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  /* ---------------------------------------------------------------- */
  /* Host HUD                                                         */
  /* ---------------------------------------------------------------- */

  const name = (seat: Seat) => `@${players[seat]?.handle ?? "player"}`;
  const reveal = outcome !== null && !animating;
  let status: string;
  if (!started) status = spectating ? "Watching" : "Get ready…";
  else if (unreadable) status = "This table couldn't be loaded";
  else if (awaitingOpponent) status = `Waiting for ${name(oppSeat)} to accept`;
  else if (reveal && outcome && outcome.winner === mySeat) status = outcome.reason === "abandon" ? "Opponent left — you win!" : "You win!";
  else if (reveal && outcome) status = `${name(outcome.winner)} wins`;
  else if (animating) status = "Rolling…";
  else if (myTurn) status = game.bih ? "Ball in hand" : needsCall(game, mySeat as Seat) ? "Your shot · call the 8" : "Your shot";
  else if (spectating) status = `${name(turnSeat)} to shoot`;
  else if (async && opponentTurn) status = `Waiting for ${name(turnSeat)}'s shot`;
  else if (opponentTurn) status = `${name(turnSeat)} is lining up…`;
  else status = "…";

  const turnId = started && !over ? (players[turnSeat]?.id ?? null) : null;
  useEffect(() => {
    xapps.ui.setStatus(status).catch(noop);
  }, [xapps, status]);
  useEffect(() => {
    xapps.ui.setTurn(turnId).catch(noop);
  }, [xapps, turnId]);
  const score0 = groupProgress(game, 0);
  const score1 = groupProgress(game, 1);
  useEffect(() => {
    if (!seat0 || !seat1) return;
    xapps.ui.setScores({ [seat0]: score0, [seat1]: score1 }).catch(noop);
  }, [xapps, seat0, seat1, score0, score1]);

  const legal = useMemo(() => (mySeat === null ? [] : legalTargets(game, turnSeat)), [game, turnSeat, mySeat]);

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
    live,
    timed,
    isBotGame: botSeat !== null,
    deadline: async ? deadline : null,
    playing,
    awaitingOpponent,
    myTurn,
    turnSeat,
    opponentTurn,
    otherAim,
    opponentOnline,
    outcome,
    reveal,
    submitted,
    unreadable,
    status,
    playback,
    animating,
    settled,
    shownN,
    legal,
    turnStartedAt,
    onPlaybackDone,
    replayLast,
    shoot,
    sendAim,
  };
}

export type EightBall = ReturnType<typeof useEightBall>;

function nearestOf(game: Game, seat: Seat, from: Vec): Vec | null {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const id of legalTargets(game, seat)) {
    const b = game.balls[id];
    if (!b) continue;
    const d = Math.hypot(b.x - from.x, b.y - from.y);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}
