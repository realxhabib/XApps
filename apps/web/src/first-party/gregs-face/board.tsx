"use client";

import type { StatStanding } from "@xapps/sdk";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatPct } from "./logic";
import { toneFor } from "./parts";
import { BOARD_TOP, formatCount, percentLabel, type Moments } from "./standing";

export type BoardStatus = "loading" | "ready" | "error";

/** A rank that springs from where you were to where you are now. */
function RankTicker({ from, to, reduced }: { from: number; to: number; reduced: boolean }) {
  const mv = useMotionValue(reduced ? to : from);
  const text = useTransform(mv, (v) => `#${formatCount(v)}`);
  useEffect(() => {
    if (reduced) {
      mv.set(to);
      return;
    }
    const controls = animate(mv, to, { type: "spring", stiffness: 60, damping: 18, delay: 0.35 });
    return () => controls.stop();
  }, [mv, to, reduced]);
  return <motion.span>{text}</motion.span>;
}

/** "NEW PERSONAL BEST", "▲ 3 places"… slapped onto the panel. */
function Moment({ children, tone, delay }: { children: string; tone: "gold" | "success"; delay: number }) {
  return (
    <motion.span
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-ink-950 shadow-lg",
        tone === "gold" ? "bg-gold" : "bg-success",
      )}
      initial={{ opacity: 0, scale: 2, rotate: -12 }}
      animate={{ opacity: 1, scale: 1, rotate: tone === "gold" ? -3 : 2 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={{ ...spring.wobbly, delay }}
    >
      {children}
    </motion.span>
  );
}

function Row({
  rank,
  person,
  label,
  value,
  mine,
  index,
  reduced,
}: {
  rank: number;
  person: AvatarPerson;
  label: string;
  value: number;
  mine: boolean;
  index: number;
  reduced: boolean;
}) {
  return (
    <motion.li
      layout
      className={cn(
        "flex h-10 items-center gap-2.5 rounded-xl px-2.5",
        mine ? "bg-[var(--accent-from)]/15 ring-1 ring-[var(--accent-from)]/60" : "odd:bg-white/[0.03]",
      )}
      initial={reduced ? false : { opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...spring.soft, delay: reduced ? 0 : 0.15 + index * 0.06 }}
    >
      <span
        className={cn(
          "w-8 shrink-0 text-right font-mono text-xs font-bold tabular",
          rank === 1 ? "text-gold" : rank <= 3 ? "text-ink-100" : "text-ink-400",
        )}
      >
        {rank === 1 ? "👑" : `#${rank}`}
      </span>
      <Avatar person={person} size={26} />
      <span className={cn("min-w-0 flex-1 truncate text-sm", mine ? "font-bold text-ink-50" : "text-ink-200")}>{label}</span>
      <span className="font-mono text-sm font-bold tabular" style={{ color: toneFor(value) }}>
        {formatPct(value)}
      </span>
    </motion.li>
  );
}

/**
 * Your global standing after a face: rank, percentile, your best, the top
 * five, and the moments (new personal best, places climbed). Degrades to a
 * friendly line when the board is empty or can't be read.
 */
export function StandingPanel({
  status,
  standing,
  moments,
  prevRank,
  me,
  onRetry,
  reduced,
  className,
}: {
  status: BoardStatus;
  standing: StatStanding | null;
  moments: Moments | null;
  /** Your rank before this face, for the ticker (null: none / unknown). */
  prevRank: number | null;
  me: AvatarPerson & { id: string };
  onRetry: () => void;
  reduced: boolean;
  className?: string;
}) {
  const mine = standing?.me ?? null;
  const top = standing?.top.slice(0, BOARD_TOP) ?? [];
  const meInTop = top.some((row) => row.player.id === me.id);
  const percent = mine && standing ? percentLabel(mine.rank, standing.total) : null;

  return (
    <motion.section
      aria-label="Global leaderboard"
      className={cn("glass relative w-full max-w-sm rounded-3xl p-4 text-left", className)}
      initial={reduced ? false : { opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">🌍 Global · best face</p>
        <div className="flex items-center gap-1.5">
          <AnimatePresence>
            {status === "ready" && moments?.newBest && (
              <Moment key="best" tone="gold" delay={0.5}>
                {moments.first ? "On the board!" : "New best!"}
              </Moment>
            )}
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {status === "loading" ? (
          <motion.div key="loading" exit={{ opacity: 0 }} className="mt-3 space-y-2" aria-busy>
            <div className="shimmer-bg h-10 w-40 rounded-xl" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="shimmer-bg h-9 rounded-xl opacity-60" />
            ))}
          </motion.div>
        ) : status === "error" || !standing ? (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 text-sm text-ink-300">
            <p>Couldn&apos;t reach the world board. Your face still counts.</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-full border border-white/15 px-3 py-1 text-xs font-bold text-ink-100 hover:bg-white/[0.06]"
            >
              Try again
            </button>
          </motion.div>
        ) : (
          <motion.div key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            {mine ? (
              <div className="mt-2 flex items-end justify-between gap-3">
                <div>
                  <p className="font-display text-4xl font-extrabold leading-none tracking-tight tabular">
                    <RankTicker from={prevRank ?? mine.rank} to={mine.rank} reduced={reduced} />
                    <span className="ml-1.5 text-base font-semibold text-ink-300">of {formatCount(standing.total)}</span>
                  </p>
                  <p className="mt-1.5 text-xs text-ink-300">
                    Your best <b className="font-mono tabular text-ink-50">{formatPct(mine.value)}</b>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {percent && (
                    <motion.span
                      className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-ink-50 ring-1 ring-white/10"
                      initial={reduced ? false : { opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ ...spring.bouncy, delay: 0.3 }}
                    >
                      {percent}
                    </motion.span>
                  )}
                  <AnimatePresence>
                    {moments && moments.climbed > 0 && (
                      <Moment key="climb" tone="success" delay={0.9}>
                        {`▲ ${formatCount(moments.climbed)} ${moments.climbed === 1 ? "place" : "places"}`}
                      </Moment>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-300">
                {standing.total > 0 ? "Your face isn't on the board yet." : "No faces on the board yet. Yours could be first."}
              </p>
            )}

            {top.length > 0 && (
              <ol className="mt-3 space-y-1">
                {top.map((row, i) => (
                  <Row
                    key={row.player.id}
                    rank={row.rank}
                    person={row.player}
                    label={row.player.id === me.id ? "You" : `@${row.player.handle}`}
                    value={row.value}
                    mine={row.player.id === me.id}
                    index={i}
                    reduced={reduced}
                  />
                ))}
                {mine && !meInTop && (
                  <>
                    <li aria-hidden className="text-center text-xs leading-3 text-ink-400">
                      ⋯
                    </li>
                    <Row
                      rank={mine.rank}
                      person={me}
                      label="You"
                      value={mine.value}
                      mine
                      index={top.length}
                      reduced={reduced}
                    />
                  </>
                )}
              </ol>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
