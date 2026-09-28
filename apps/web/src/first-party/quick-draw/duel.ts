/**
 * Reflexes — the duel engine.
 *
 * A small, framework-free state machine that owns the round clock
 * (intro → STEADY → DRAW → shot → reveal → … → final), talks to the opponent
 * (a remote human through room messages, or a locally simulated bot) and
 * publishes an immutable view for React to render.
 *
 * Live sync: each client runs its own clock. When a player finishes a round
 * (tap, false start or no draw) their client broadcasts
 * `{ round, ms, falseStart }`. A round resolves once both results are known,
 * using the pure, symmetric `resolveRound`, so both screens agree. Results are
 * stored per round with first-write-wins semantics: duplicates are dropped,
 * results for a round we haven't reached yet are buffered, and a result that
 * shows up after we gave up on it (OPP_TIMEOUT_MS) is ignored.
 *
 * Time and timers are injected so the engine runs under a fake clock in tests.
 */
import {
  FALSE_START,
  INTRO_MS,
  MISS_AFTER_MS,
  NO_DRAW,
  OPP_TIMEOUT_MS,
  RESEND_AFTER_MS,
  REVEAL_MS,
  SETTLE_MS,
  classify,
  isMatchOver,
  normalizeResult,
  parseResultMessage,
  reactionMs,
  resolveRound,
  sampleBotReaction,
  tally,
  toMessage,
  type ResultMessage,
  type RoundOutcome,
  type RoundResult,
  type Score,
} from "./logic";

export type Phase =
  /** Waiting for `start()`. */
  | "idle"
  /** "Round n" banner. Taps are ignored. */
  | "intro"
  /** Hold still. A tap now is a false start. */
  | "steady"
  /** The signal is up. Tap! */
  | "draw"
  /** We have our result; waiting for the opponent's (and a short beat). */
  | "shot"
  /** Round outcome on screen. */
  | "reveal"
  /** Duel over. */
  | "final"
  /** Stopped from outside (e.g. the match ended early). */
  | "halted";

export interface DuelView {
  phase: Phase;
  /** Current round, 1-based (0 before the first round). */
  round: number;
  /** Our result for the current round, once we have one. */
  mine: RoundResult | null;
  /** Opponent's result for the current round — only exposed once `mine` is known, so it never spoils the draw. */
  opp: RoundResult | null;
  /** The opponent has drawn this round (a valid tap), shown from our DRAW on. */
  oppFired: boolean;
  /** The opponent jumped the gun this round. */
  oppFalseStart: boolean;
  outcomes: readonly RoundOutcome[];
  score: Score;
  /** The outcome on screen during `reveal` / `final`. */
  last: RoundOutcome | null;
}

export type DuelEvent =
  | { type: "round"; round: number; score: Score }
  | { type: "steady"; round: number }
  | { type: "draw"; round: number }
  | { type: "shot"; round: number; result: RoundResult }
  /** Tap during the round banner — ignored, but worth a wobble. */
  | { type: "nudge" }
  | { type: "opp-fired"; round: number }
  | { type: "opp-false-start"; round: number }
  | { type: "opp-timeout"; round: number }
  | { type: "reveal"; outcome: RoundOutcome; score: Score }
  | { type: "final"; score: Score; outcomes: readonly RoundOutcome[] };

export type TapResult = "ignored" | "early" | "false-start" | "shot";

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type OpponentDriver =
  /** A human on the other end of the room. `send` broadcasts our result. */
  | { kind: "remote"; send(message: ResultMessage): void }
  /** A bot (or ghost) this client simulates with its own RNG. */
  | { kind: "simulated"; rand: () => number };

export interface DuelOptions {
  /** STEADY delay for a round — must be identical on both clients (seeded). */
  steadyDelay(round: number): number;
  opponent: OpponentDriver;
  clock?: Clock;
}

export const INITIAL_VIEW: DuelView = Object.freeze({
  phase: "idle",
  round: 0,
  mine: null,
  opp: null,
  oppFired: false,
  oppFalseStart: false,
  outcomes: [],
  score: { me: 0, opp: 0 },
  last: null,
});

/** Beat after a result before the verdict (count-up, TOO EARLY…). */
function settleMs(result: RoundResult): number {
  const kind = classify(result);
  return kind === "tap" ? SETTLE_MS.tap : kind === "false-start" ? SETTLE_MS.falseStart : SETTLE_MS.miss;
}

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class DuelEngine {
  private readonly options: DuelOptions;
  private readonly clock: Clock;
  private view: DuelView = INITIAL_VIEW;
  private readonly viewListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: DuelEvent) => void>();
  private readonly timers = new Set<unknown>();
  /** Results by round. First write wins (dedupe + timeouts are final). */
  private readonly mine = new Map<number, RoundResult>();
  private readonly theirs = new Map<number, RoundResult>();
  /** When each remote result arrived (our clock), to mirror the opponent's settle beat. */
  private readonly theirsAt = new Map<number, number>();
  private outcomes: RoundOutcome[] = [];
  /** `performance.now()` when DRAW went up this round. */
  private signalAt: number | null = null;
  /** The short beat after our own result has elapsed. */
  private settled = false;
  /** Simulated opponent's reaction this round, for the "they fired" cue. */
  private botTapMs: number | null = null;
  private started = false;
  private stopped = false;

  constructor(options: DuelOptions) {
    this.options = options;
    this.clock = options.clock ?? browserClock;
  }

  /* -------------------------------------------------------------- */
  /* Public API                                                     */
  /* -------------------------------------------------------------- */

  getSnapshot = (): DuelView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  onEvent(listener: (event: DuelEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Begin round one. Idempotent. */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.startRound(1);
  }

  /** The local player tapped. `at` is a `performance.now()`-style timestamp. */
  tap(at: number = this.clock.now()): TapResult {
    if (!this.started || this.stopped) return "ignored";
    const { phase, round } = this.view;
    if (phase === "intro") {
      this.emit({ type: "nudge" });
      return "early";
    }
    if (phase === "steady") {
      this.recordMine(round, FALSE_START);
      return "false-start";
    }
    if (phase === "draw" && this.signalAt !== null) {
      // An input stamped before the signal (queued behind the DRAW timer) was a false start.
      if (at < this.signalAt) {
        this.recordMine(round, FALSE_START);
        return "false-start";
      }
      this.recordMine(round, { ms: reactionMs(this.signalAt, at), falseStart: false });
      return "shot";
    }
    return "ignored";
  }

  /**
   * The UI reports when DRAW actually reached the screen (next animation
   * frame). Moving the signal time to the paint keeps render latency out of
   * the reaction time. Only small, forward corrections are accepted.
   */
  markSignalPainted(at: number): void {
    if (this.view.phase !== "draw" || this.signalAt === null) return;
    const delta = at - this.signalAt;
    if (delta > 0 && delta < 100) this.signalAt = at;
  }

  /** A room message from the opponent. Returns whether it was new. */
  receive(payload: unknown): boolean {
    if (this.stopped || this.options.opponent.kind !== "remote") return false;
    const message = parseResultMessage(payload);
    if (!message || this.theirs.has(message.round)) return false;
    const result = normalizeResult(message);
    this.theirs.set(message.round, result);
    this.theirsAt.set(message.round, this.clock.now());
    // Resolution needs both results, so any unseen round is the current one or
    // a later one (the opponent is ahead) — later ones wait in `theirs`.
    if (message.round === this.view.round) this.applyTheirs(message.round, result);
    return true;
  }

  /** Stop the clock but keep the current view (the match ended from outside). */
  halt(): void {
    if (this.stopped) return;
    this.clearTimers();
    this.stopped = true;
    this.set({ phase: "halted" });
  }

  destroy(): void {
    this.clearTimers();
    this.stopped = true;
    this.viewListeners.clear();
    this.eventListeners.clear();
  }

  /* -------------------------------------------------------------- */
  /* Round flow                                                     */
  /* -------------------------------------------------------------- */

  private startRound(round: number): void {
    this.signalAt = null;
    this.settled = false;
    this.botTapMs = null;
    this.set({ phase: "intro", round, mine: null, opp: null, oppFired: false, oppFalseStart: false, last: null });
    this.emit({ type: "round", round, score: this.view.score });
    this.after(INTRO_MS, () => this.beginSteady(round));
  }

  private beginSteady(round: number): void {
    if (!this.isCurrent(round, "intro")) return;
    const steadyMs = this.options.steadyDelay(round);
    this.set({ phase: "steady" });
    this.emit({ type: "steady", round });

    const opponent = this.options.opponent;
    if (opponent.kind === "simulated") {
      const bot = sampleBotReaction(opponent.rand, steadyMs);
      this.theirs.set(round, normalizeResult(bot));
      if (bot.falseStart) this.after(bot.falseStartAt ?? 0, () => this.showOppFalseStart(round));
      else this.botTapMs = bot.ms;
    } else {
      // The opponent may be a hair ahead of us and already have jumped the gun.
      if (this.theirs.get(round)?.falseStart) this.showOppFalseStart(round);
      // Never wait forever: no result by DRAW + OPP_TIMEOUT_MS means they never drew.
      this.after(steadyMs + OPP_TIMEOUT_MS, () => this.opponentTimedOut(round));
    }
    this.after(steadyMs, () => this.fireSignal(round));
  }

  private fireSignal(round: number): void {
    if (!this.isCurrent(round, "steady")) return; // we false-started
    this.signalAt = this.clock.now();
    this.set({ phase: "draw" });
    this.emit({ type: "draw", round });

    const known = this.theirs.get(round);
    if (this.options.opponent.kind === "remote") {
      if (known && classify(known) === "tap") this.showOppFired(round);
    } else if (this.botTapMs !== null) {
      this.after(this.botTapMs, () => this.showOppFired(round));
    }
    this.after(MISS_AFTER_MS, () => {
      if (this.isCurrent(round, "draw")) this.recordMine(round, NO_DRAW);
    });
  }

  private recordMine(round: number, result: RoundResult): void {
    if (this.mine.has(round)) return;
    const mine = normalizeResult(result);
    this.mine.set(round, mine);
    this.set({ phase: "shot", mine, opp: this.theirs.get(round) ?? null });
    this.emit({ type: "shot", round, result: mine });

    const opponent = this.options.opponent;
    if (opponent.kind === "remote") {
      const message = toMessage(round, mine);
      opponent.send(message);
      for (const delay of RESEND_AFTER_MS) this.after(delay, () => opponent.send(message));
    }

    this.after(settleMs(mine), () => {
      if (this.view.round !== round) return;
      this.settled = true;
      this.maybeResolve();
    });
  }

  private applyTheirs(round: number, result: RoundResult): void {
    const { phase } = this.view;
    if (result.falseStart) this.showOppFalseStart(round);
    else if (classify(result) === "tap" && phase === "draw") this.showOppFired(round);
    if (phase === "shot") this.set({ opp: result });
    this.maybeResolve();
  }

  private opponentTimedOut(round: number): void {
    if (this.theirs.has(round)) return;
    this.theirs.set(round, NO_DRAW);
    this.theirsAt.set(round, this.clock.now());
    this.emit({ type: "opp-timeout", round });
    if (this.view.round === round) this.applyTheirs(round, NO_DRAW);
  }

  private maybeResolve(): void {
    const round = this.view.round;
    if (this.view.phase !== "shot" || !this.settled) return;
    const mine = this.mine.get(round);
    const theirs = this.theirs.get(round);
    if (!mine || !theirs) return;

    // Mirror the opponent's own settle beat from when their result reached us.
    // Each client then reveals at max(my finish + beat, their finish + beat), so
    // the two screens stay within one network latency of each other instead of
    // drifting apart by a whole beat when one player finishes much earlier.
    const arrived = this.theirsAt.get(round);
    if (arrived !== undefined) {
      const wait = arrived + settleMs(theirs) - this.clock.now();
      if (wait > 0) {
        this.after(wait, () => this.maybeResolve());
        return;
      }
    }

    const outcome = resolveRound(round, mine, theirs);
    this.outcomes = [...this.outcomes, outcome];
    const score = tally(this.outcomes);
    this.set({ phase: "reveal", opp: theirs, last: outcome, outcomes: this.outcomes, score });
    this.emit({ type: "reveal", outcome, score });

    this.after(REVEAL_MS, () => {
      if (!this.isCurrent(round, "reveal")) return;
      if (isMatchOver(this.outcomes)) this.finish();
      else this.startRound(round + 1);
    });
  }

  private finish(): void {
    this.set({ phase: "final" });
    this.emit({ type: "final", score: this.view.score, outcomes: this.outcomes });
  }

  /* -------------------------------------------------------------- */
  /* Opponent cues                                                  */
  /* -------------------------------------------------------------- */

  private showOppFalseStart(round: number): void {
    const { phase, oppFalseStart } = this.view;
    if (this.view.round !== round || oppFalseStart) return;
    if (phase !== "steady" && phase !== "draw" && phase !== "shot") return;
    this.set({ oppFalseStart: true });
    this.emit({ type: "opp-false-start", round });
  }

  private showOppFired(round: number): void {
    if (!this.isCurrent(round, "draw") || this.view.oppFired) return;
    this.set({ oppFired: true });
    this.emit({ type: "opp-fired", round });
  }

  /* -------------------------------------------------------------- */
  /* Plumbing                                                       */
  /* -------------------------------------------------------------- */

  private isCurrent(round: number, phase: Phase): boolean {
    return !this.stopped && this.view.round === round && this.view.phase === phase;
  }

  private after(ms: number, fn: () => void): void {
    if (this.stopped) return;
    const handle = this.clock.setTimeout(() => {
      this.timers.delete(handle);
      if (!this.stopped) fn();
    }, Math.max(0, ms));
    this.timers.add(handle);
  }

  private clearTimers(): void {
    for (const handle of this.timers) this.clock.clearTimeout(handle);
    this.timers.clear();
  }

  private set(patch: Partial<DuelView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of Array.from(this.viewListeners)) listener();
  }

  private emit(event: DuelEvent): void {
    for (const listener of Array.from(this.eventListeners)) {
      try {
        listener(event);
      } catch (error) {
        console.error("[quick-draw] event listener threw", error);
      }
    }
  }
}
