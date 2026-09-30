/**
 * Greg's Face — where your best face ranks worldwide. Pure helpers around
 * `xapps.stats.leaderboard("best_face")`: formatting, and the moments worth
 * celebrating between two standings (a new personal best, places climbed).
 */
import type { StatStanding } from "@xapps/sdk";

/** The stat the global board ranks (aggregate `max`). */
export const BOARD_STAT = "best_face";
/** Rows shown on the reveal's board. */
export const BOARD_TOP = 5;

/** "2,380" */
export function formatCount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

/**
 * Your percentile as "top N %": rank 14 of 2,380 is the top 1 %. Null when
 * it says nothing (you're alone on the board, or the numbers don't add up).
 */
export function topPercent(rank: number, total: number): number | null {
  if (!Number.isFinite(rank) || !Number.isFinite(total) || rank < 1 || total < 2 || rank > total) return null;
  return Math.min(100, Math.max(1, Math.ceil((rank / total) * 100)));
}

/** A short line for the percentile: "Best in the world", "Top 1%", "Better than 40% of players"… */
export function percentLabel(rank: number, total: number): string | null {
  if (rank === 1 && total >= 2) return "Best in the world";
  const top = topPercent(rank, total);
  if (top === null) return null;
  if (top <= 50) return `Top ${top}%`;
  const beat = Math.floor(((total - rank) / total) * 100);
  return beat > 0 ? `Better than ${beat}% of players` : null;
}

/** What changed between the standing before this face and after it. */
export interface Moments {
  /** This face beat your previous best (or is your first face on the board). */
  newBest: boolean;
  /** Your first face on the board. */
  first: boolean;
  /** Places climbed (0 when you didn't move up or it's unknown). */
  climbed: number;
}

/**
 * `before` is your standing before this face (undefined when it couldn't be
 * read, null `me` when you had no face yet); `after` the fresh one.
 */
export function standingMoments(
  before: Pick<StatStanding, "me"> | undefined,
  after: Pick<StatStanding, "me"> | null,
  score: number,
): Moments {
  if (before === undefined) return { newBest: false, first: false, climbed: 0 };
  const prev = before.me;
  const next = after?.me ?? null;
  if (!prev) return { newBest: next !== null, first: next !== null, climbed: 0 };
  const newBest = score > prev.value;
  const climbed = next && next.rank < prev.rank ? prev.rank - next.rank : 0;
  return { newBest, first: false, climbed };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isValue = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Keeps the well-formed parts of a standing (malformed rows are dropped, a
 * malformed `me` reads as null), so a surprising host answer can't break the
 * reveal. Null when it isn't a standing at all.
 */
export function cleanStanding(raw: unknown): StatStanding | null {
  if (!isRecord(raw) || !Array.isArray(raw.top)) return null;
  const top: StatStanding["top"] = [];
  for (const row of raw.top) {
    if (!isRecord(row) || !isCount(row.rank) || row.rank < 1 || !isValue(row.value) || !isRecord(row.player)) continue;
    const { id, handle, name, avatarUrl } = row.player;
    if (typeof id !== "string" || typeof handle !== "string") continue;
    top.push({
      rank: row.rank,
      value: row.value,
      player: {
        id,
        handle,
        name: typeof name === "string" && name ? name : handle,
        avatarUrl: typeof avatarUrl === "string" && avatarUrl ? avatarUrl : null,
      },
    });
  }
  const me =
    isRecord(raw.me) && isCount(raw.me.rank) && raw.me.rank >= 1 && isValue(raw.me.value)
      ? { rank: raw.me.rank, value: raw.me.value }
      : null;
  const total = Math.max(isCount(raw.total) ? raw.total : 0, top.length, me?.rank ?? 0);
  return { key: typeof raw.key === "string" ? raw.key : BOARD_STAT, top, me, total };
}
