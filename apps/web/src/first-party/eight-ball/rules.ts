/**
 * 8-Ball Pool — rules and the shared match state. Pure: no React, no SDK.
 *
 * Standard 8-ball (close to WPA, simplified the way pool apps play it):
 * - Seat 0 breaks from the kitchen. A legal break pockets a ball or drives
 *   four object balls to a cushion; otherwise it's a foul.
 * - The table stays open after the break. The first ball legally pocketed
 *   afterwards (first by time when several drop) decides solids / stripes.
 * - You keep shooting while you legally pocket one of your own balls.
 * - Fouls (scratch, no ball hit, wrong ball first, no cushion after contact,
 *   a weak break, running out the shot clock) give the opponent ball in hand
 *   anywhere (behind the head string after a scratch on the break).
 * - Once your group is cleared you shoot the 8 and must call its pocket.
 *   Potting the 8 early, with a foul, or in another pocket loses the game.
 *   The 8 on the break wins ("golden break"), unless you scratch: then it's
 *   re-spotted and it's a foul.
 *
 * Every shot is simulated by the shooter; the result (and a recording to
 * replay) goes into the shared state, which all clients trust and render.
 */

import {
  BALLS,
  FOOT_SPOT,
  HEAD_SPOT,
  HEAD_X,
  POCKETS,
  R,
  TABLE_L,
  TABLE_W,
  isFreeSpot,
  rackBalls,
  readRecording,
  simulate,
  spotBall,
  type Balls,
  type Recording,
  type SimResult,
  type Strike,
  type Vec,
} from "./physics";

export type Seat = 0 | 1;
export type Group = "solids" | "stripes";
export type BallInHand = "kitchen" | "anywhere";

export type Foul = "scratch" | "no_hit" | "wrong_ball" | "no_rail" | "weak_break" | "timeout";

export type EndReason =
  /** Legally potted the 8 in the called pocket. */
  | "eight"
  /** The 8 on the break. */
  | "golden_break"
  /** Potted the 8 before clearing your group. */
  | "early_eight"
  /** Potted the 8 and scratched. */
  | "scratch_eight"
  /** Potted the 8 on a foul (wrong ball first, no rail…). */
  | "foul_eight"
  /** Potted the 8 in a pocket you didn't call. */
  | "wrong_pocket";

export const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
export const isSolid = (id: number) => id >= 1 && id <= 7;
export const isStripe = (id: number) => id >= 9 && id <= 15;
export const groupBalls = (group: Group): number[] => (group === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]);
export const inGroup = (id: number, group: Group) => (group === "solids" ? isSolid(id) : isStripe(id));
/** The seat that breaks. */
export const BREAKER: Seat = 0;
/** Live shot clock. */
export const SHOT_MS = 60_000;

export interface ShotSummary {
  foul: Foul | null;
  /** Object balls that dropped, in order. */
  potted: number[];
  /** Pocket each of `potted` went into. */
  pockets: number[];
  scratch: boolean;
  /** The seat that just got solids (the table closed on this shot). */
  assigned: Seat | null;
  /** The shooter keeps the table. */
  cont: boolean;
  /** Own-group balls (and the 8) legally potted this shot. */
  own: number;
  /** Object balls that hit a cushion before dropping (and counted for the shooter). */
  banked: number[];
  win: Seat | null;
  reason: EndReason | null;
  /** The 8 was re-spotted (it dropped on a scratching break). */
  respotted: boolean;
  /** The shot was the break. */
  brk: boolean;
}

export interface LastShot {
  /** State `n` before the shot. */
  n: number;
  by: string;
  seat: Seat;
  kind: "shot" | "timeout";
  /** Epoch ms. */
  at: number;
  /** The strike as played (for spectators' curiosity and replays): angle, power, spin, called pocket. */
  strike: { a: number; p: number; sx: number; sy: number; call: number | null } | null;
  rec: Recording | null;
  out: ShotSummary;
}

export interface Game {
  /** Shots taken (and timeouts). */
  n: number;
  balls: Balls;
  turn: Seat;
  /** Who has solids; null = open table. */
  solids: Seat | null;
  bih: BallInHand | null;
  broken: boolean;
  winner: Seat | null;
  reason: EndReason | null;
  /** Legally potted own balls (plus a winning 8) per seat. */
  potted: [number, number];
  /** Balls the shooter has potted in this visit. */
  run: number;
  /** Best visit per seat. */
  best: [number, number];
  /** The breaker potted on the break and has not given up the table since. */
  clean: boolean;
  last: LastShot | null;
}

/* ------------------------------------------------------------------------ */
/* Setup & queries                                                          */
/* ------------------------------------------------------------------------ */

export function newGame(random: () => number = Math.random): Game {
  return {
    n: 0,
    balls: rackBalls(random),
    turn: BREAKER,
    solids: null,
    bih: "kitchen",
    broken: false,
    winner: null,
    reason: null,
    potted: [0, 0],
    run: 0,
    best: [0, 0],
    clean: false,
    last: null,
  };
}

export function groupOf(game: Pick<Game, "solids">, seat: Seat): Group | null {
  if (game.solids === null) return null;
  return game.solids === seat ? "solids" : "stripes";
}

export function remaining(balls: Balls, group: Group): number {
  return groupBalls(group).filter((id) => balls[id]).length;
}

/** The shooter has cleared their group and plays the 8. */
export function onEight(game: Game, seat: Seat): boolean {
  const g = groupOf(game, seat);
  return g !== null && remaining(game.balls, g) === 0;
}

/** Balls `seat` may legally hit first right now. */
export function legalTargets(game: Game, seat: Seat): number[] {
  const out: number[] = [];
  const g = groupOf(game, seat);
  const eight = onEight(game, seat);
  for (let id = 1; id < BALLS; id++) {
    if (!game.balls[id]) continue;
    if (eight ? id === 8 : g === null ? id !== 8 : inGroup(id, g)) out.push(id);
  }
  // The break can hit anything (the rack), and nothing else is left in rare re-spot cases.
  if (!game.broken) return game.balls.map((b, id) => (b && id > 0 ? id : -1)).filter((id) => id > 0);
  return out;
}

/** Must this shot call a pocket (the 8 is the target)? */
export const needsCall = (game: Game, seat: Seat): boolean => game.broken && onEight(game, seat);

export type CueCheck = "ok" | "off-table" | "overlap" | "kitchen";

/** Can the cue ball be placed at `p` with ball in hand? */
export function checkCueSpot(game: Game, p: Vec): CueCheck {
  if (p.x < R || p.x > TABLE_L - R || p.y < R || p.y > TABLE_W - R) return "off-table";
  if (game.bih === "kitchen" && p.x > HEAD_X) return "kitchen";
  return isFreeSpot(game.balls, p, 0) ? "ok" : "overlap";
}

/** Where to offer the cue ball when ball in hand starts. */
export function defaultCueSpot(game: Game): Vec {
  const want = game.balls[0] ?? { x: HEAD_X * 0.55, y: TABLE_W / 2 };
  const candidates: Vec[] = [want, { x: HEAD_X * 0.55, y: TABLE_W / 2 }, HEAD_SPOT];
  for (const c of candidates) if (checkCueSpot(game, c) === "ok") return { ...c };
  for (let k = 0; k < 200; k++) {
    const p = { x: R + ((k * 0.137) % 1) * (HEAD_X - 2 * R), y: R + ((k * 0.389) % 1) * (TABLE_W - 2 * R) };
    if (checkCueSpot(game, p) === "ok") return p;
  }
  return { x: HEAD_X * 0.5, y: TABLE_W / 2 };
}

/* ------------------------------------------------------------------------ */
/* Judging a shot                                                           */
/* ------------------------------------------------------------------------ */

export interface ShotInput {
  angle: number;
  power: number;
  spin: Vec;
  /** Cue ball position with ball in hand (ignored otherwise). */
  cue: Vec | null;
  /** Called pocket for the 8. */
  call: number | null;
}

export type ShotError = "game-over" | "wrong-turn" | "bad-cue" | "call-pocket" | "bad-input";

export type ShotResult =
  | { ok: true; game: Game; sim: SimResult; summary: ShotSummary }
  | { ok: false; reason: ShotError };

/** The table the strike starts from (with the cue ball placed for ball in hand), or an error. */
export function startTable(game: Game, seat: Seat, input: ShotInput): { balls: Balls } | { error: ShotError } {
  if (game.winner !== null) return { error: "game-over" };
  if (seat !== game.turn) return { error: "wrong-turn" };
  if (![input.angle, input.power, input.spin.x, input.spin.y].every(Number.isFinite)) return { error: "bad-input" };
  const balls = game.balls.slice();
  if (game.bih) {
    if (!input.cue || checkCueSpot(game, input.cue) !== "ok") return { error: "bad-cue" };
    balls[0] = { x: input.cue.x, y: input.cue.y };
  } else if (!balls[0]) {
    return { error: "bad-cue" };
  }
  if (needsCall(game, seat) && (input.call === null || !POCKETS.some((p) => p.id === input.call))) return { error: "call-pocket" };
  return { balls };
}

/** Plays `input` for `seat` and judges it. Never mutates `game`. */
export function playShot(game: Game, seat: Seat, input: ShotInput, meta: { by: string; at: number }): ShotResult {
  const start = startTable(game, seat, input);
  if ("error" in start) return { ok: false, reason: start.error };
  const strike: Strike = { angle: input.angle, power: input.power, spin: input.spin };
  const sim = simulate(start.balls, strike);
  const { game: next, summary } = judge({ ...game, balls: start.balls }, seat, sim, input.call);
  next.last = {
    n: game.n,
    by: meta.by,
    seat,
    kind: "shot",
    at: meta.at,
    strike: {
      a: round(input.angle, 5),
      p: round(input.power, 3),
      sx: round(input.spin.x, 3),
      sy: round(input.spin.y, 3),
      call: needsCall(game, seat) ? input.call : null,
    },
    rec: sim.rec,
    out: summary,
  };
  return { ok: true, game: next, sim, summary };
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * Applies the rules to a simulated shot. `game.balls` must be the table the
 * shot started from (cue ball placed). Returns the next game (with `last`
 * unset) and what happened.
 */
export function judge(game: Game, seat: Seat, sim: SimResult, call: number | null): { game: Game; summary: ShotSummary } {
  const opp = other(seat);
  const potted = sim.pocketed.filter((p) => p.id !== 0);
  const pottedIds = potted.map((p) => p.id);
  const scratch = sim.pocketed.some((p) => p.id === 0);
  const eightDown = pottedIds.includes(8);
  const balls = sim.final.slice();
  const brk = !game.broken;
  const wasOnEight = onEight(game, seat);
  const group = groupOf(game, seat);

  let foul: Foul | null = null;
  let win: Seat | null = null;
  let reason: EndReason | null = null;
  let respotted = false;
  let solids = game.solids;
  let assigned: Seat | null = null;
  let own = 0;

  if (brk) {
    if (sim.firstHit === null) foul = "no_hit";
    else if (scratch) foul = "scratch";
    else if (potted.length === 0 && sim.railBalls < 4) foul = "weak_break";
    if (eightDown) {
      if (scratch) {
        balls[8] = spotBall(balls, FOOT_SPOT);
        respotted = true;
      } else {
        win = seat;
        reason = "golden_break";
      }
    }
  } else {
    const first = sim.firstHit;
    let legalFirst: boolean;
    if (first === null) legalFirst = false;
    else if (wasOnEight) legalFirst = first === 8;
    else if (group === null) legalFirst = first !== 8;
    else legalFirst = inGroup(first, group);

    if (scratch) foul = "scratch";
    else if (first === null) foul = "no_hit";
    else if (!legalFirst) foul = "wrong_ball";
    else if (potted.length === 0 && !sim.railAfterContact) foul = "no_rail";

    if (eightDown) {
      const eightPocket = potted.find((p) => p.id === 8)?.pocket ?? -1;
      if (!wasOnEight) reason = "early_eight";
      else if (scratch) reason = "scratch_eight";
      else if (foul) reason = "foul_eight";
      else if (eightPocket !== call) reason = "wrong_pocket";
      else reason = "eight";
      win = reason === "eight" ? seat : opp;
    }
  }

  // Closing the table: the first legally potted ball (after the break) picks the group.
  if (!brk && solids === null && foul === null && win === null) {
    const firstPot = potted.find((p) => p.id !== 8);
    if (firstPot) {
      solids = isSolid(firstPot.id) ? seat : opp;
      assigned = solids;
    }
  }

  const myGroup: Group | null = solids === null ? null : solids === seat ? "solids" : "stripes";
  if (!foul) {
    if (brk) own = pottedIds.filter((id) => id !== 8).length;
    else if (myGroup) own = pottedIds.filter((id) => inGroup(id, myGroup)).length;
    if (win === seat && eightDown) own += 1;
  }
  const banked = foul ? [] : sim.banked.filter((id) => (myGroup ? inGroup(id, myGroup) : id !== 8) || (id === 8 && win === seat));

  const cont = win === null && foul === null && (brk ? pottedIds.some((id) => id !== 8) : own > 0);
  const nextTurn: Seat = win !== null ? game.turn : cont ? seat : opp;
  const bih: BallInHand | null = win !== null ? null : foul ? (brk ? "kitchen" : "anywhere") : null;

  // `own` is already 0 on a foul.
  const visit = game.run + own;
  const best: [number, number] = [...game.best];
  best[seat] = Math.max(best[seat], visit);
  const pottedTotals: [number, number] = [...game.potted];
  pottedTotals[seat] += own;

  let clean = game.clean;
  if (brk) clean = cont && seat === BREAKER;
  else if (!(cont || win === seat)) clean = false;

  const next: Game = {
    n: game.n + 1,
    balls,
    turn: nextTurn,
    solids,
    bih,
    broken: true,
    winner: win,
    reason,
    potted: pottedTotals,
    run: cont ? visit : 0,
    best,
    clean: win !== null && win !== seat ? false : clean,
    last: null,
  };
  const summary: ShotSummary = {
    foul,
    potted: pottedIds,
    pockets: potted.map((p) => p.pocket),
    scratch,
    assigned,
    cont,
    own,
    banked,
    win,
    reason,
    respotted,
    brk,
  };
  return { game: next, summary };
}

/** Running out the shot clock: a foul, the opponent gets ball in hand. */
export function timeoutFoul(game: Game, seat: Seat, meta: { by: string; at: number }): Game | null {
  if (game.winner !== null || game.turn !== seat) return null;
  const opp = other(seat);
  const summary: ShotSummary = {
    foul: "timeout",
    potted: [],
    pockets: [],
    scratch: false,
    assigned: null,
    cont: false,
    own: 0,
    banked: [],
    win: null,
    reason: null,
    respotted: false,
    brk: false,
  };
  return {
    ...game,
    n: game.n + 1,
    turn: opp,
    bih: game.broken ? "anywhere" : "kitchen",
    run: 0,
    clean: false,
    last: { n: game.n, by: meta.by, seat, kind: "timeout", at: meta.at, strike: null, rec: null, out: summary },
  };
}

/* ------------------------------------------------------------------------ */
/* Shared state (JSON)                                                      */
/* ------------------------------------------------------------------------ */

/** Ball positions travel as 0.1 mm integers. */
const Q = 10_000;
const q = (m: number) => Math.round(m * Q);

export type PoolStateJson = {
  v: 1;
  n: number;
  balls: ([number, number] | null)[];
  turn: Seat;
  solids: Seat | null;
  bih: BallInHand | null;
  broken: boolean;
  winner: Seat | null;
  reason: EndReason | null;
  potted: [number, number];
  run: number;
  best: [number, number];
  clean: boolean;
  last: LastShot | null;
};

/** Rounds positions the way the shared state stores them (so the writer plays on exactly what everyone reads). */
export function quantize(balls: Balls): Balls {
  return balls.map((b) => (b ? { x: q(b.x) / Q, y: q(b.y) / Q } : null));
}

export function toStateJson(game: Game): PoolStateJson {
  return {
    v: 1,
    n: game.n,
    balls: game.balls.map((b) => (b ? [q(b.x), q(b.y)] : null)),
    turn: game.turn,
    solids: game.solids,
    bih: game.bih,
    broken: game.broken,
    winner: game.winner,
    reason: game.reason,
    potted: [game.potted[0], game.potted[1]],
    run: game.run,
    best: [game.best[0], game.best[1]],
    clean: game.clean,
    last: game.last,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSeat = (value: unknown): value is Seat => value === 0 || value === 1;
const isCount = (value: unknown, max = 99): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const pairOf = (value: unknown, max: number): [number, number] | null =>
  Array.isArray(value) && value.length === 2 && isCount(value[0], max) && isCount(value[1], max) ? [value[0], value[1]] : null;
const REASONS: readonly EndReason[] = ["eight", "golden_break", "early_eight", "scratch_eight", "foul_eight", "wrong_pocket"];
const FOULS: readonly Foul[] = ["scratch", "no_hit", "wrong_ball", "no_rail", "weak_break", "timeout"];

/**
 * Reads an untrusted shared state. `null` (nothing written yet) returns null;
 * the caller racks a fresh game from the match seed. Throws never; returns
 * `"bad"` for a malformed state.
 */
export function readState(value: unknown): Game | null | "bad" {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.v !== 1) return "bad";
  const { n, turn, solids, bih, broken, winner, reason, run, clean } = value;
  if (!isCount(n, 100_000) || !isSeat(turn) || typeof broken !== "boolean" || typeof clean !== "boolean") return "bad";
  if (solids !== null && !isSeat(solids)) return "bad";
  if (winner !== null && !isSeat(winner)) return "bad";
  if (bih !== null && bih !== "kitchen" && bih !== "anywhere") return "bad";
  if (reason !== null && !REASONS.includes(reason as EndReason)) return "bad";
  if (!isCount(run, 15)) return "bad";
  const potted = pairOf(value.potted, 16);
  const best = pairOf(value.best, 15);
  if (!potted || !best) return "bad";
  if (!Array.isArray(value.balls) || value.balls.length !== BALLS) return "bad";
  const balls: Balls = [];
  for (const b of value.balls) {
    if (b === null) {
      balls.push(null);
      continue;
    }
    if (!Array.isArray(b) || b.length !== 2) return "bad";
    const [x, y] = b as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return "bad";
    const p = { x: x / Q, y: y / Q };
    if (p.x < -0.2 || p.x > TABLE_L + 0.2 || p.y < -0.2 || p.y > TABLE_W + 0.2) return "bad";
    balls.push(p);
  }
  return {
    n,
    balls,
    turn,
    solids: solids as Seat | null,
    bih: bih as BallInHand | null,
    broken,
    winner: winner as Seat | null,
    reason: reason as EndReason | null,
    potted,
    run,
    best,
    clean,
    last: readLast(value.last),
  };
}

function readLast(value: unknown): LastShot | null {
  if (!isRecord(value)) return null;
  const { n, by, seat, kind, at, out } = value;
  if (!isCount(n, 100_000) || typeof by !== "string" || !isSeat(seat) || (kind !== "shot" && kind !== "timeout")) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || !isRecord(out)) return null;
  const nums = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is number => isCount(x, 15)) : []);
  const summary: ShotSummary = {
    foul: FOULS.includes(out.foul as Foul) ? (out.foul as Foul) : null,
    potted: nums(out.potted),
    pockets: nums(out.pockets),
    scratch: out.scratch === true,
    assigned: isSeat(out.assigned) ? out.assigned : null,
    cont: out.cont === true,
    own: isCount(out.own, 16) ? out.own : 0,
    banked: nums(out.banked),
    win: isSeat(out.win) ? out.win : null,
    reason: REASONS.includes(out.reason as EndReason) ? (out.reason as EndReason) : null,
    respotted: out.respotted === true,
    brk: out.brk === true,
  };
  let strike: LastShot["strike"] = null;
  if (isRecord(value.strike)) {
    const s = value.strike;
    if ([s.a, s.p, s.sx, s.sy].every((x) => typeof x === "number" && Number.isFinite(x))) {
      strike = {
        a: s.a as number,
        p: s.p as number,
        sx: s.sx as number,
        sy: s.sy as number,
        call: isCount(s.call, 5) ? s.call : null,
      };
    }
  }
  return { n, by, seat, kind, at, strike, rec: kind === "shot" ? readRecording(value.rec) : null, out: summary };
}

/** Scores for the platform (`high` scoring): the winner 1, the loser 0. */
export const scoreFor = (game: Game, seat: Seat): number | null => (game.winner === null ? null : game.winner === seat ? 1 : 0);

/** Own-group balls potted so far by `seat` (0–7), for the HUD. */
export function groupProgress(game: Game, seat: Seat): number {
  const g = groupOf(game, seat);
  return g ? 7 - remaining(game.balls, g) : 0;
}
