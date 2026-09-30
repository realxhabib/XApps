"use client";

import type { StatStanding } from "@xapps/sdk";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { Avatar, type AvatarPerson } from "@/components/ui/avatar";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn, formatNumber } from "@/lib/utils";
import { PERFECT, accuracyColor, boardRows, formatAccuracy, percentileLabel, type StandingMoment } from "./logic";

/** The worldwide board as the app knows it: the latest standing, and what just happened. */
export interface StandingState {
  status: "idle" | "loading" | "ready" | "error";
  /** The latest standing we have (kept while a newer one loads). */
  data: StatStanding | null;
  /** What the latest circle did on the board (set when it loads). */
  moment: StandingMoment | null;
}

export const IDLE_STANDING: StandingState = { status: "idle", data: null, moment: null };

/**
 * A whole number that springs to each new `value`: the panel stays up while a
 * new standing loads, so a climb counts down from the old rank to the new one.
 */
function Count({ value, format = formatNumber }: { value: number; format?: (v: number) => string }) {
  const reduce = useReducedMotion();
  const mv = useSpring(value, { stiffness: 70, damping: 18, mass: 0.9 });
  const text = useTransform(mv, (v) => format(Math.max(1, Math.round(v))));
  useEffect(() => {
    if (reduce) mv.jump(value);
    else mv.set(value);
  }, [mv, value, reduce]);
  return <motion.span>{text}</motion.span>;
}

function Pill({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.4, y: 8, rotate: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
      transition={{ ...spring.wobbly, delay }}
      className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-extrabold", className)}
    >
      {children}
    </motion.span>
  );
}

function Moments({ standing }: { standing: StandingState }) {
  const moment = standing.status === "ready" ? standing.moment : null;
  const rank = standing.data?.me?.rank;
  return (
    <div className="flex min-h-7 flex-wrap items-center gap-1.5 py-0.5" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {moment?.personalBest && (
          <Pill key="pb" className="bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-ink-950 shadow-[0_8px_30px_-10px_var(--accent-to)]">
            <span aria-hidden>🎉</span> New personal best
          </Pill>
        )}
        {moment && moment.climbed > 0 && (
          <Pill key="climb" className="bg-success/15 text-success ring-1 ring-success/30" delay={0.15}>
            <span aria-hidden>▲</span> You climbed {formatNumber(moment.climbed)} {moment.climbed === 1 ? "place" : "places"}
          </Pill>
        )}
        {moment?.debut && (
          <Pill key="debut" className="bg-white/10 text-ink-50 ring-1 ring-white/15">
            <span aria-hidden>📍</span> You&apos;re on the board
          </Pill>
        )}
        {moment && rank === 1 && (
          <Pill key="first" className="bg-[#ffcf3d]/15 text-[#ffcf3d] ring-1 ring-[#ffcf3d]/30" delay={0.25}>
            <span aria-hidden>👑</span> #1 worldwide
          </Pill>
        )}
      </AnimatePresence>
    </div>
  );
}

function RankHero({ data }: { data: StatStanding }) {
  const me = data.me;
  if (!me) {
    return (
      <div className="py-1">
        <p className="font-display text-2xl font-extrabold tracking-tight">{data.total === 0 ? "The board is empty" : "Not on the board yet"}</p>
        <p className="mt-1 text-sm text-ink-300">
          {data.total === 0 ? "Draw a circle to be the first on it." : "Your circles will show up here once they count."}
        </p>
      </div>
    );
  }
  const pct = percentileLabel(me.rank, data.total);
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <p className="flex items-baseline gap-2">
          <span className="font-display text-[clamp(38px,10vmin,60px)] font-extrabold leading-none tracking-tight tabular">
            #<Count value={me.rank} />
          </span>
          <span className="text-sm font-semibold text-ink-300">of {formatNumber(Math.max(data.total, me.rank))}</span>
        </p>
        {pct && (
          <motion.span
            key={pct}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ ...spring.bouncy, delay: 0.2 }}
            className="mb-1 shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] font-black uppercase tracking-wider text-ink-50 ring-1 ring-white/15"
          >
            {pct}
          </motion.span>
        )}
      </div>
      <p className="mt-1.5 text-sm text-ink-300">
        Your best{" "}
        <b className="font-display font-extrabold tabular" style={{ color: accuracyColor(me.value) }}>
          {formatAccuracy(me.value)}
        </b>
        {me.value >= PERFECT && <span aria-label="a perfect circle"> ⭕</span>}
      </p>
    </div>
  );
}

function TopList({ data, meId, me }: { data: StatStanding; meId: string; me: AvatarPerson }) {
  const rows = boardRows(data, meId);
  const listRef = useRef<HTMLOListElement>(null);
  const meIndex = rows.findIndex((r) => r.me);
  // On small screens the list scrolls: keep your own row in view.
  useEffect(() => {
    const list = listRef.current;
    const row = meIndex >= 0 ? (list?.children[meIndex] as HTMLElement | undefined) : undefined;
    if (!list || !row || list.scrollHeight <= list.clientHeight) return;
    const top = row.offsetTop; // the list is positioned: offsets are relative to it
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: top + row.offsetHeight - list.clientHeight, behavior: "smooth" });
    }
  }, [meIndex, data]);
  if (rows.length === 0) return null;
  return (
    <ol
      ref={listRef}
      className="no-scrollbar relative flex flex-col gap-1 max-md:max-h-[22vh] max-md:overflow-y-auto"
      aria-label="Best circles worldwide"
    >
      {rows.map((row, i) => (
        <motion.li
          key={row.me ? "me" : row.player!.id}
          layout
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ ...spring.layout, delay: 0.05 * i }}
          className="flex flex-col"
        >
          {row.gap && (
            <span className="py-0.5 text-center text-xs leading-none text-ink-400" aria-hidden>
              ⋯
            </span>
          )}
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-2 py-1 md:py-1.5",
              row.me ? "bg-white/[0.09] ring-1 ring-[color-mix(in_oklab,var(--accent-to)_45%,transparent)]" : "bg-white/[0.03]",
            )}
          >
            <span className="w-7 shrink-0 text-center font-mono text-xs font-bold text-ink-300 tabular">
              {row.rank <= 3 ? ["🥇", "🥈", "🥉"][row.rank - 1] : `#${row.rank}`}
            </span>
            <Avatar person={row.player ?? me} size={26} className="shrink-0 rounded-full" />
            <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", row.me ? "text-ink-50" : "text-ink-200")}>
              {row.me ? "You" : `@${row.player!.handle}`}
            </span>
            <span className="font-display text-sm font-extrabold tabular" style={{ color: accuracyColor(row.value) }}>
              {formatAccuracy(row.value)}
            </span>
          </div>
        </motion.li>
      ))}
    </ol>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <div className="h-12 w-40 animate-pulse rounded-xl bg-white/[0.06]" />
      <div className="flex flex-col gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-9 animate-pulse rounded-xl bg-white/[0.04]" style={{ animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    </div>
  );
}

/**
 * After a circle: where you stand worldwide on best circle (rank, percentile,
 * your best, the top five) and the moment it made. It keeps working, and the
 * game with it, when the board can't be loaded.
 */
export function StandingPanel({
  standing,
  meId,
  me,
  onRetry,
  actions,
}: {
  standing: StandingState;
  meId: string;
  me: AvatarPerson;
  onRetry: () => void;
  actions: ReactNode;
}) {
  const { data, status } = standing;
  let body: ReactNode;
  if (status === "error" && !data) {
    body = (
      <div className="py-2 text-center">
        <p className="text-2xl" aria-hidden>
          🌐
        </p>
        <p className="mt-1 font-semibold text-ink-50">Couldn&apos;t load the worldwide board</p>
        <button type="button" onClick={onRetry} className="mt-1 text-xs font-bold text-ink-300 underline underline-offset-2 hover:text-ink-50">
          Try again
        </button>
      </div>
    );
  } else if (!data) {
    body = <Skeleton />;
  } else {
    body = (
      <>
        <RankHero data={data} />
        <TopList data={data} meId={meId} me={me} />
      </>
    );
  }

  return (
    <motion.section
      className="flex w-full min-w-0 flex-col gap-3 md:w-80 md:shrink-0"
      initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: 16, filter: "blur(6px)", transition: { duration: 0.16 } }}
      transition={{ ...spring.soft, filter: BLUR_TWEEN }}
      aria-label="Your worldwide standing"
    >
      <div className="glass-strong flex flex-col gap-2.5 rounded-3xl p-3.5 md:gap-3 md:p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink-300">Worldwide · best circle</p>
          <AnimatePresence>
            {status === "loading" && data && (
              <motion.span
                key="updating"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[11px] font-semibold text-ink-400"
              >
                Updating…
              </motion.span>
            )}
            {status === "error" && data && (
              <motion.button
                key="retry"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onRetry}
                className="text-[11px] font-bold text-ink-300 underline underline-offset-2 hover:text-ink-50"
              >
                Couldn&apos;t update · retry
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        <Moments standing={standing} />
        {body}
      </div>
      {actions}
    </motion.section>
  );
}
