/**
 * Cup Pong — pure rules. No React, no SDK, no timers.
 *
 * A game is a list of actions (throws, bonus-cup picks, re-racks); the racks,
 * whose throw it is, streaks and the winner are all derived by replaying it.
 * The shared match state stores that list, so every client — and a reload
 * days later — lands on exactly the same table.
 *
 * Turn rules
 * - Two balls per turn. Sink both and you get "balls back": another turn.
 * - A bounce shot (off the table, then in) sinks its cup *and* the thrower
 *   removes a second cup of their choice (a "pick" action).
 * - Three makes in a row sets you on fire: a hot ball that finds cups more
 *   easily, until you miss.
 * - Once per game, at the start of a turn, you may re-rack the cups you're
 *   shooting at when 6, 4, 3 or 2 are left.
 * - First to clear the other rack wins.
 */

import {
  frontCup,
  openingRack,
  other,
  rerack,
  rerackOptions,
  type Cup,
  type Formation,
  type Seat,
} from "./geometry";
import { idealThrow, normalizeThrow, type ThrowInput } from "./physics";

export { other, type Seat } from "./geometry";

export const CUPS = 10;
export const BALLS_PER_TURN = 2;
/** Makes in a row that set you on fire. */
export const FIRE_STREAK = 3;
/** Live matches: seconds per ball before it's thrown away as a miss. */
export const THROW_MS = 25_000;
/** The first N throws of each player show the arc preview. */
export const PREVIEW_THROWS = 4;

/* ---------------------------------------------------------------------- */
/* Actions (stored in the shared state)                                   */
/* ---------------------------------------------------------------------- */

/** Throw flags. */
export const F_BOUNCE = 1;
export const F_RIM = 2;
/** The clock ran out: a dropped ball. */
export const F_TIMEOUT = 4;

/** A throw: `a`/`p` the input, `c` the cup it sank (−1 for a miss), `f` flags. */
export type ThrowAction = { k: "t"; by: string; a: number; p: number; c: number; f: number; at: number };
/** The extra cup a bounce shot removes. */
export type PickAction = { k: "x"; by: string; c: number; at: number };
/** A re-rack of the rack being shot at. */
export type RerackAction = { k: "r"; by: string; f: Formation; at: number };
export type Action = ThrowAction | PickAction | RerackAction;

/** A throw's replayable trajectory (see physics `encodePath` / `encodeEvents`). */
export type Traj = { n: number; path: number[]; ev: number[] };

/**
 * The match's shared, persisted state. `log` is the source of truth; `cups`
 * and `winner` are derived on every write so feeds can read the score
 * without replaying. `recent` keeps the trajectories of the latest run of
 * throws by one player, so the other player (live, or days later) can
 * replay exactly what happened.
 */
export type PongState = {
  v: 1;
  log: Action[];
  recent: Traj[];
  /** Cups left per seat's rack. */
  cups: [number, number];
  winner: string | null;
};

/** Player ids by seat: `[seat 0 (throws first), seat 1]`. */
export type Seats = readonly [string, string];

/* ---------------------------------------------------------------------- */
/* Game state                                                             */
/* ---------------------------------------------------------------------- */

export interface SeatStats {
  throws: number;
  /** Balls that went in. */
  made: number;
  /** Cups removed (makes + bounce bonus picks). */
  cups: number;
  bounces: number;
  /** Makes that touched a rim first. */
  rattlers: number;
  ballsBack: number;
  /** Times this seat caught fire. */
  fires: number;
  streak: number;
  bestStreak: number;
  /** Largest cup deficit this seat faced (their cups left − ours). */
  maxDeficit: number;
  rerackUsed: boolean;
  /** Sank a cup with the first throw after calling a re-rack. */
  rerackMake: boolean;
}

export interface GameState {
  /** `racks[s]`: the cups seat `s` defends (at seat s's end). */
  racks: [Cup[], Cup[]];
  /** Who throws next (meaningless once over). */
  turn: Seat;
  /** Ball of the turn about to be thrown: 0 or 1. */
  ball: number;
  /** Makes so far this turn. */
  madeThisTurn: number;
  /** A bounce shot landed: this seat must pick a bonus cup before anything else. */
  pendingPick: Seat | null;
  fire: [boolean, boolean];
  stats: [SeatStats, SeatStats];
  /** A re-rack was just called; its first throw is still to come. */
  rerackArmed: [boolean, boolean];
  /** Turns passed so far (balls back doesn't pass the turn). */
  turns: number;
  winner: Seat | null;
  over: boolean;
  /** Actions applied. */
  n: number;
}

function newStats(): SeatStats {
  return {
    throws: 0,
    made: 0,
    cups: 0,
    bounces: 0,
    rattlers: 0,
    ballsBack: 0,
    fires: 0,
    streak: 0,
    bestStreak: 0,
    maxDeficit: 0,
    rerackUsed: false,
    rerackMake: false,
  };
}

export function newGame(): GameState {
  return {
    racks: [openingRack(), openingRack()],
    turn: 0,
    ball: 0,
    madeThisTurn: 0,
    pendingPick: null,
    fire: [false, false],
    stats: [newStats(), newStats()],
    rerackArmed: [false, false],
    turns: 0,
    winner: null,
    over: false,
    n: 0,
  };
}

function clone(g: GameState): GameState {
  return {
    ...g,
    racks: [g.racks[0].slice(), g.racks[1].slice()],
    fire: [g.fire[0], g.fire[1]],
    stats: [{ ...g.stats[0] }, { ...g.stats[1] }],
    rerackArmed: [g.rerackArmed[0], g.rerackArmed[1]],
  };
}

export type ActionError =
  | "game-over"
  | "wrong-turn"
  | "pick-pending"
  | "no-pick"
  | "bad-cup"
  | "bad-throw"
  | "rerack-used"
  | "rerack-now"
  | "bad-formation"
  | "bad-action";

export type ActionCheck = { ok: true } | { ok: false; reason: ActionError };

const hasCup = (cups: readonly Cup[], id: unknown) => typeof id === "number" && cups.some((c) => c.id === id);

/** Can `seat` re-rack the cups it's shooting at right now, and into what? */
export function rerackChoices(game: GameState, seat: Seat): readonly Formation[] {
  if (game.over || game.turn !== seat || game.ball !== 0 || game.pendingPick !== null) return [];
  if (game.stats[seat].rerackUsed) return [];
  return rerackOptions(game.racks[other(seat)].length);
}

/** Validates `action` by `seat` against the game. */
export function validateAction(game: GameState, action: Action, seat: Seat): ActionCheck {
  if (game.over) return { ok: false, reason: "game-over" };
  const target = game.racks[other(seat)];
  switch (action.k) {
    case "t": {
      if (game.pendingPick !== null) return { ok: false, reason: "pick-pending" };
      if (game.turn !== seat) return { ok: false, reason: "wrong-turn" };
      const { a, p, c, f } = action;
      if (![a, p].every((n) => typeof n === "number" && Number.isFinite(n))) return { ok: false, reason: "bad-throw" };
      if (!Number.isInteger(f) || f < 0 || f > 7) return { ok: false, reason: "bad-throw" };
      if (c !== -1 && !hasCup(target, c)) return { ok: false, reason: "bad-cup" };
      if (c === -1 && (f & (F_BOUNCE | F_RIM)) !== 0) return { ok: false, reason: "bad-throw" };
      return { ok: true };
    }
    case "x":
      if (game.pendingPick !== seat) return { ok: false, reason: "no-pick" };
      if (!hasCup(target, action.c)) return { ok: false, reason: "bad-cup" };
      return { ok: true };
    case "r": {
      if (game.pendingPick !== null) return { ok: false, reason: "pick-pending" };
      if (game.turn !== seat) return { ok: false, reason: "wrong-turn" };
      if (game.stats[seat].rerackUsed) return { ok: false, reason: "rerack-used" };
      if (game.ball !== 0) return { ok: false, reason: "rerack-now" };
      if (!rerackOptions(target.length).includes(action.f)) return { ok: false, reason: "bad-formation" };
      return { ok: true };
    }
    default:
      return { ok: false, reason: "bad-action" };
  }
}

/** Updates both seats' worst deficit after cups changed. */
function trackDeficits(g: GameState): void {
  for (const s of [0, 1] as const) {
    const mine = g.racks[s].length;
    const theirs = g.racks[other(s)].length;
    g.stats[s].maxDeficit = Math.max(g.stats[s].maxDeficit, theirs - mine);
  }
}

/** After a ball is fully resolved: win, next ball, balls back or pass the turn. */
function settleBall(g: GameState, seat: Seat): void {
  if (g.racks[other(seat)].length === 0) {
    g.winner = seat;
    g.over = true;
    return;
  }
  g.ball += 1;
  if (g.ball < BALLS_PER_TURN) return;
  if (g.madeThisTurn >= BALLS_PER_TURN) g.stats[seat].ballsBack += 1;
  else {
    g.turn = other(seat);
    g.turns += 1;
  }
  g.ball = 0;
  g.madeThisTurn = 0;
}

/** Returns the next state, or null if the action is illegal. Never mutates. */
export function applyAction(game: GameState, action: Action, seat: Seat): GameState | null {
  if (!validateAction(game, action, seat).ok) return null;
  const g = clone(game);
  g.n += 1;
  const o = other(seat);
  const st = g.stats[seat];
  switch (action.k) {
    case "t": {
      st.throws += 1;
      const armed = g.rerackArmed[seat];
      g.rerackArmed[seat] = false;
      if (action.c >= 0) {
        g.racks[o] = g.racks[o].filter((c) => c.id !== action.c);
        st.made += 1;
        st.cups += 1;
        st.streak += 1;
        st.bestStreak = Math.max(st.bestStreak, st.streak);
        g.madeThisTurn += 1;
        if (armed) st.rerackMake = true;
        if (action.f & F_RIM) st.rattlers += 1;
        if (st.streak >= FIRE_STREAK && !g.fire[seat]) {
          g.fire[seat] = true;
          st.fires += 1;
        }
        trackDeficits(g);
        if (action.f & F_BOUNCE) {
          st.bounces += 1;
          if (g.racks[o].length > 0) {
            g.pendingPick = seat;
            return g;
          }
        }
      } else {
        st.streak = 0;
        g.fire[seat] = false;
      }
      settleBall(g, seat);
      return g;
    }
    case "x":
      g.racks[o] = g.racks[o].filter((c) => c.id !== action.c);
      st.cups += 1;
      g.pendingPick = null;
      trackDeficits(g);
      settleBall(g, seat);
      return g;
    case "r":
      g.racks[o] = rerack(g.racks[o], action.f) as Cup[];
      st.rerackUsed = true;
      g.rerackArmed[seat] = true;
      return g;
  }
}

/** Who acts next: the seat that owes a bonus pick, else the thrower. */
export const actorOf = (game: GameState): Seat => game.pendingPick ?? game.turn;

/* ---------------------------------------------------------------------- */
/* Shared state                                                           */
/* ---------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_LOG = 900;
const MAX_RECENT = 8;
const FORMATIONS: readonly Formation[] = ["full", "triangle", "zipper", "diamond", "square", "line", "pair"];

/** Parses one untrusted action (shape only). */
export function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  const { k, by, at } = raw;
  if (typeof by !== "string" || typeof at !== "number" || !Number.isFinite(at)) return null;
  if (k === "t") {
    const { a, p, c, f } = raw;
    if (typeof a !== "number" || typeof p !== "number" || typeof c !== "number" || typeof f !== "number") return null;
    if (!Number.isInteger(c) || !Number.isInteger(f)) return null;
    return { k, by, a, p, c, f, at };
  }
  if (k === "x") {
    const { c } = raw;
    if (typeof c !== "number" || !Number.isInteger(c)) return null;
    return { k, by, c, at };
  }
  if (k === "r") {
    const { f } = raw;
    if (typeof f !== "string" || !FORMATIONS.includes(f as Formation)) return null;
    return { k, by, f: f as Formation, at };
  }
  return null;
}

function parseTraj(raw: unknown, logLength: number): Traj | null {
  if (!isRecord(raw)) return null;
  const { n, path, ev } = raw;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= logLength) return null;
  if (!Array.isArray(path) || !path.every((x) => typeof x === "number")) return null;
  if (!Array.isArray(ev) || !ev.every((x) => typeof x === "number")) return null;
  return { n, path: path as number[], ev: ev as number[] };
}

export interface ReadPong {
  game: GameState;
  log: Action[];
  recent: Traj[];
}

/**
 * Rebuilds the game from an untrusted shared state by replaying its log.
 * `null`/missing state is a fresh game. Returns `null` if the state is
 * malformed or any action is illegal or made by the wrong player.
 */
export function readPongState(value: unknown, seats: Seats): ReadPong | null {
  if (value === null || value === undefined) return { game: newGame(), log: [], recent: [] };
  if (!isRecord(value)) return null;
  const raw = value.log ?? [];
  if (!Array.isArray(raw) || raw.length > MAX_LOG) return null;
  let game = newGame();
  const log: Action[] = [];
  for (const entry of raw) {
    const action = parseAction(entry);
    if (!action) return null;
    const seat = seats.indexOf(action.by);
    if (seat !== 0 && seat !== 1) return null;
    const next = applyAction(game, action, seat);
    if (!next) return null;
    game = next;
    log.push(action);
  }
  const recentRaw = Array.isArray(value.recent) ? value.recent : [];
  const recent: Traj[] = [];
  for (const r of recentRaw) {
    const t = parseTraj(r, log.length);
    if (t && log[t.n]?.k === "t") recent.push(t);
  }
  return { game, log, recent };
}

/** Serialises a game into the shared state shape. */
export function toPongState(game: GameState, log: readonly Action[], recent: readonly Traj[], seats: Seats): PongState {
  return {
    v: 1,
    log: log.map((a) => ({ ...a })),
    recent: recent.map((r) => ({ n: r.n, path: r.path.slice(), ev: r.ev.slice() })),
    cups: [game.racks[0].length, game.racks[1].length],
    winner: game.winner === null ? null : seats[game.winner],
  };
}

export type StateActionError = ActionError | "not-a-player" | "bad-state" | "not-your-turn";

export type StateActionResult =
  | { ok: true; state: PongState; game: GameState; n: number }
  | { ok: false; reason: StateActionError };

/**
 * The state reducer: appends `action` (with its trajectory, for throws) to the
 * untrusted shared state. When the host runs turns, only the turn holder may
 * act (the bonus pick belongs to the thrower, who still holds the turn).
 * Never mutates `value`.
 */
export function applyStateAction(
  value: unknown,
  action: Action,
  seats: Seats,
  traj: { path: number[]; ev: number[] } | null = null,
  turnHolder: string | null = null,
): StateActionResult {
  const read = readPongState(value, seats);
  if (!read) return { ok: false, reason: "bad-state" };
  const seat = seats.indexOf(action.by);
  if (seat !== 0 && seat !== 1) return { ok: false, reason: "not-a-player" };
  const check = validateAction(read.game, action, seat);
  if (!check.ok) return check;
  if (turnHolder !== null && turnHolder !== action.by) return { ok: false, reason: "not-your-turn" };
  const game = applyAction(read.game, action, seat) as GameState;
  const n = read.log.length;
  const log = [...read.log, action];
  let recent = read.recent;
  if (action.k === "t" && traj) {
    // A new run starts whenever the thrower changes.
    const runBy = recent.length > 0 ? log[recent[0]!.n]?.by : undefined;
    recent = runBy === action.by ? [...recent, { n, ...traj }] : [{ n, ...traj }];
    if (recent.length > MAX_RECENT) recent = recent.slice(recent.length - MAX_RECENT);
  }
  return { ok: true, state: toPongState(game, log, recent, seats), game, n };
}

/**
 * Where to start replaying when a player opens the table: the first action of
 * the opponent's latest run that has trajectories (so async players watch
 * what happened since their last turn). Returns `log.length` when there's
 * nothing to replay.
 */
export function replayFrom(log: readonly Action[], recent: readonly Traj[], me: string): number {
  const first = recent[0];
  if (!first) return log.length;
  const by = log[first.n]?.by;
  if (!by || by === me) return log.length;
  // Anything the same player did right before their first recorded throw (a re-rack) belongs to the run too.
  let start = first.n;
  while (start > 0 && log[start - 1]?.by === by && log[start - 1]?.k !== "t") start--;
  return start;
}

/** Game after the first `count` actions (for replays). */
export function gameAt(log: readonly Action[], seats: Seats, count: number): GameState {
  let game = newGame();
  for (const action of log.slice(0, count)) {
    const seat = seats.indexOf(action.by);
    if (seat !== 0 && seat !== 1) break;
    game = applyAction(game, action, seat) ?? game;
  }
  return game;
}

/* ---------------------------------------------------------------------- */
/* Bot                                                                    */
/* ---------------------------------------------------------------------- */

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard"];

export interface BotSkill {
  /** Standard deviation of the aim error (aim units: ±1 = full width). */
  aimSd: number;
  /** Standard deviation of the power error. */
  powerSd: number;
  /** Chance to re-rack as soon as it's allowed. */
  rerack: number;
}

export const BOT_SKILL: Record<Difficulty, BotSkill> = {
  easy: { aimSd: 0.13, powerSd: 0.05, rerack: 0.3 },
  medium: { aimSd: 0.075, powerSd: 0.028, rerack: 0.6 },
  hard: { aimSd: 0.058, powerSd: 0.021, rerack: 0.9 },
};

export function isDifficulty(value: unknown): value is Difficulty {
  return value === "easy" || value === "medium" || value === "hard";
}

/** Standard normal from a [0, 1) source (Box–Muller). */
export function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * The cup the bot goes for: front and central cups are the natural targets
 * (they're backed up by the rest of the rack), with some variety.
 */
export function botTarget(cups: readonly Cup[], random: () => number): Cup | null {
  if (cups.length === 0) return null;
  const weights = cups.map((c) => {
    // Cups with neighbours behind them catch near-misses.
    const backers = cups.filter((d) => d !== c && Math.hypot(d.u - c.u, d.v - c.v) < 0.11).length;
    return 1 + backers + c.v * 4 - Math.abs(c.u) * 3;
  });
  const total = weights.reduce((s, w) => s + Math.max(0.2, w), 0);
  let r = random() * total;
  for (let i = 0; i < cups.length; i++) {
    r -= Math.max(0.2, weights[i]!);
    if (r <= 0) return cups[i]!;
  }
  return cups[cups.length - 1]!;
}

/** The bot's throw at `cups`: the ideal throw at its target plus its difficulty's error. */
export function botThrow(cups: readonly Cup[], difficulty: Difficulty, random: () => number, fire = false): ThrowInput {
  const target = botTarget(cups, random) ?? { u: 0, v: 0.2, id: -1 };
  const ideal = idealThrow(target);
  const skill = BOT_SKILL[difficulty];
  // On fire the bot gets a little steadier, like anyone would.
  const k = fire ? 0.85 : 1;
  return normalizeThrow({
    aim: ideal.aim + gaussian(random) * skill.aimSd * k,
    power: ideal.power + gaussian(random) * skill.powerSd * k,
  });
}

/** Re-rack decision for the bot, or null to keep the cups as they are. */
export function botRerack(game: GameState, seat: Seat, difficulty: Difficulty, random: () => number): Formation | null {
  const options = rerackChoices(game, seat);
  if (options.length === 0) return null;
  const count = game.racks[other(seat)].length;
  // Spread-out cups are worth tidying; a still-tight rack isn't.
  if (count >= 6 && random() > 0.35) return null;
  if (random() > BOT_SKILL[difficulty].rerack) return null;
  // Compact shapes that back each other up: triangle, diamond, pair.
  const preferred = options.find((f) => f === "triangle" || f === "diamond" || f === "pair");
  return preferred ?? options[0]!;
}

/** The bonus cup the bot removes after a bounce shot: the front one. */
export function botPick(game: GameState, seat: Seat): number | null {
  return frontCup(game.racks[other(seat)])?.id ?? null;
}

/** Deterministic [0, 1) source for tests and replays (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/* ---------------------------------------------------------------------- */
/* Progress: stats & achievements (one seat's view)                       */
/* ---------------------------------------------------------------------- */

export type PongAchievement =
  | "first_win"
  | "bounce_shot"
  | "on_fire"
  | "balls_back"
  | "rerack_make"
  | "clutch"
  | "clean_sweep"
  | "comeback"
  | "rim_rattler"
  | "heat_check";

export const ALL_ACHIEVEMENTS: readonly PongAchievement[] = [
  "first_win",
  "bounce_shot",
  "on_fire",
  "balls_back",
  "rerack_make",
  "clutch",
  "clean_sweep",
  "comeback",
  "rim_rattler",
  "heat_check",
];

/** "Comeback": win after trailing by this many cups. */
export const COMEBACK_DEFICIT = 5;
/** "Heat check": this many makes in a row. */
export const HEAT_CHECK_STREAK = 6;

/**
 * Achievements `seat` has earned in `game` so far. Shot-making ones unlock the
 * moment they happen; the rest need a win. `winner` overrides the board's
 * winner (the opponent left) — then only the plain win counts.
 */
export function earnedAchievements(game: GameState, seat: Seat, winner: Seat | null = game.winner): PongAchievement[] {
  const st = game.stats[seat];
  const out: PongAchievement[] = [];
  if (st.bounces >= 1) out.push("bounce_shot");
  if (st.fires >= 1) out.push("on_fire");
  if (st.ballsBack >= 1) out.push("balls_back");
  if (st.rerackMake) out.push("rerack_make");
  if (st.rattlers >= 1) out.push("rim_rattler");
  if (st.bestStreak >= HEAT_CHECK_STREAK) out.push("heat_check");
  if (winner !== seat) return out;
  out.push("first_win");
  if (game.winner !== seat) return out;
  const left = game.racks[seat].length;
  if (left === 1) out.push("clutch");
  if (left === CUPS) out.push("clean_sweep");
  if (st.maxDeficit >= COMEBACK_DEFICIT) out.push("comeback");
  return out;
}

/** Stats to report when `seat`'s game is over (zero counters left out). */
export function gameStats(game: GameState, seat: Seat, winner: Seat | null = game.winner): { [key: string]: number } {
  const st = game.stats[seat];
  const out: { [key: string]: number } = {};
  if (st.cups > 0) out.cups_sunk = st.cups;
  if (winner === seat) out.wins = 1;
  if (st.bounces > 0) out.bounce_shots = st.bounces;
  if (st.fires > 0) out.fire_streaks = st.fires;
  return out;
}

/** `high` scoring: 1 for the winner, 0 for the loser. */
export const scoreFor = (winner: Seat | null, seat: Seat): number => (winner === null ? 0.5 : winner === seat ? 1 : 0);

/* ---------------------------------------------------------------------- */
/* Turn clock                                                             */
/* ---------------------------------------------------------------------- */

/** When a reopened turn's clock started: the last action's time, clamped so the player gets a fair few seconds. */
export function resumeClockAt(log: readonly Action[], now: number, turnMs = THROW_MS, minLeftMs = 8_000): number {
  const last = log[log.length - 1];
  if (!last) return now;
  return Math.min(now, Math.max(last.at, now - turnMs + minLeftMs));
}
