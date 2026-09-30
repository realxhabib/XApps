/**
 * 8-Ball Pool — stats and achievements, from one seat's point of view. Pure.
 * Declared in the app's manifest (`src/platform/catalog.ts`).
 */

import { BREAKER, groupOf, other, remaining, type Game, type Seat } from "./rules";

export type PoolAchievement =
  | "first_win"
  | "hat_trick"
  | "double_down"
  | "bank_shot"
  | "break_and_run"
  | "whitewash"
  | "comeback"
  | "golden_break"
  | "self_destruct";

/** A run of this many balls in one visit is a hat trick. */
export const HAT_TRICK_RUN = 3;

const LOSSES_BY_EIGHT = new Set(["early_eight", "scratch_eight", "foul_eight", "wrong_pocket"]);

/**
 * Achievements `seat` has earned so far. Shot moments (runs, doubles, banks)
 * come from the latest shot; the rest from how the game ended.
 */
export function earnedAchievements(game: Game, seat: Seat): PoolAchievement[] {
  const earned: PoolAchievement[] = [];
  const last = game.last;
  if (game.best[seat] >= HAT_TRICK_RUN) earned.push("hat_trick");
  if (last && last.seat === seat && last.kind === "shot" && !last.out.foul && !last.out.brk) {
    // Legal pots of your own this shot (the break scatters balls by luck, so it doesn't count).
    if (last.out.own >= 2) earned.push("double_down");
    if (last.out.banked.length > 0 && last.out.own > 0) earned.push("bank_shot");
  }
  if (game.winner === null) return earned;

  if (game.winner === seat) {
    earned.push("first_win");
    if (game.reason === "golden_break") earned.push("golden_break");
    if (game.reason === "eight") {
      if (seat === BREAKER && game.clean) earned.push("break_and_run");
      const theirs = groupOf(game, other(seat));
      if (theirs && remaining(game.balls, theirs) === 7) earned.push("whitewash");
      if (theirs && remaining(game.balls, theirs) === 0) earned.push("comeback");
    }
  } else if (game.reason && LOSSES_BY_EIGHT.has(game.reason) && last?.seat === seat) {
    earned.push("self_destruct");
  }
  return earned;
}

/** Stats to report once `seat`'s game is over (zero counters left out). */
export function gameStats(game: Game, seat: Seat, winner: Seat | null = game.winner): { [key: string]: number } {
  const stats: { [key: string]: number } = {};
  if (winner === seat) stats.wins = 1;
  if (game.potted[seat] > 0) stats.balls_potted = game.potted[seat];
  if (game.best[seat] > 0) stats.best_run = game.best[seat];
  if (winner === seat && game.winner === seat && game.reason === "eight" && seat === BREAKER && game.clean) stats.break_and_runs = 1;
  return stats;
}
