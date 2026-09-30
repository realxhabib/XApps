"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ORDER, RADIUS, SEGMENT_DEG, clampToView, type Point } from "./board";
import { DARTS_PER_ROUND, TOTAL_DARTS } from "./logic";

export interface Contender {
  player: PlayerInfo;
  name: string;
  color: string;
  isMe: boolean;
  /** Darts known so far (live or simulated). */
  darts: Point[];
  total: number;
  /** A final score we only know from the platform (async opponents who already played). */
  settled: number | null;
  /** "live" players stream their darts; "later" ones play in their own time. */
  presence: "live" | "later" | "done";
}

/** Tiny board with the current round's darts of one player. */
export function MiniBoard({ darts, color, size = 34 }: { darts: Point[]; color: string; size?: number }) {
  const current = darts.slice(Math.floor(Math.max(0, darts.length - 1) / DARTS_PER_ROUND) * DARTS_PER_ROUND);
  const reduced = useReducedMotion();
  return (
    <svg viewBox="-230 -230 460 460" width={size} height={size} className="shrink-0" aria-hidden>
      <circle r="226" fill="#121110" />
      {ORDER.map((_, i) => {
        const a0 = ((i * SEGMENT_DEG - SEGMENT_DEG / 2 - 90) * Math.PI) / 180;
        const a1 = a0 + (SEGMENT_DEG * Math.PI) / 180;
        const r = RADIUS.doubleOuter;
        return (
          <path
            key={i}
            d={`M0 0 L${Math.cos(a0) * r} ${Math.sin(a0) * r} A${r} ${r} 0 0 1 ${Math.cos(a1) * r} ${Math.sin(a1) * r} Z`}
            fill={i % 2 ? "#dccfae" : "#26231f"}
          />
        );
      })}
      <circle r={(RADIUS.trebleInner + RADIUS.trebleOuter) / 2} fill="none" stroke="#b8323a" strokeWidth="9" opacity="0.8" />
      <circle r={(RADIUS.doubleInner + RADIUS.doubleOuter) / 2} fill="none" stroke="#b8323a" strokeWidth="9" opacity="0.8" />
      <circle r={RADIUS.outerBull} fill="#12824a" />
      <circle r={RADIUS.bull + 2} fill="#ce242a" />
      <AnimatePresence>
        {current.map((p, i) => {
          const c = clampToView(p, 14);
          return (
            <motion.circle
              key={`${darts.length - current.length + i}`}
              cx={c.x}
              cy={c.y}
              r={20}
              fill={color}
              stroke="#000"
              strokeWidth="7"
              initial={reduced ? false : { r: 60, opacity: 0 }}
              animate={{ r: 20, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring.bouncy}
            />
          );
        })}
      </AnimatePresence>
    </svg>
  );
}

function Pips({ thrown, color }: { thrown: number; color: string }) {
  return (
    <div className="flex items-center gap-[3px]" aria-hidden>
      {Array.from({ length: TOTAL_DARTS }, (_, i) => (
        <span
          key={i}
          className={cn("h-1 w-1 rounded-full", i % DARTS_PER_ROUND === 0 && i > 0 && "ml-[3px]")}
          style={{ background: i < thrown ? color : "rgb(255 255 255 / 0.14)" }}
        />
      ))}
    </div>
  );
}

export function Scoreboard({
  contenders,
  leaderId,
  onSelect,
  focusId,
}: {
  contenders: Contender[];
  leaderId: string | null;
  /** Spectators pick whose board they follow. */
  onSelect?: (id: string) => void;
  focusId?: string | null;
}) {
  const many = contenders.length > 2;
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-2xl items-stretch gap-1.5 px-2 pt-2 sm:gap-2.5 sm:px-4 sm:pt-3">
      {contenders.map((c) => {
        const shown = c.settled ?? c.total;
        const lead = leaderId === c.player.id;
        return (
          <motion.div
            key={c.player.id}
            layout
            transition={spring.layout}
            className={cn(
              "glass relative flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-1.5",
              c.isMe && "ring-1 ring-[var(--accent-from)]/60",
              many && "flex-col items-stretch gap-1 px-1.5",
              onSelect && "cursor-pointer",
              onSelect && focusId === c.player.id && "ring-1 ring-white/40",
            )}
            data-testid={`contender-${c.isMe ? "me" : c.player.seat}`}
            data-no-aim={onSelect ? true : undefined}
            onPointerDown={onSelect ? () => onSelect(c.player.id) : undefined}
          >
            <div className={cn("flex min-w-0 items-center gap-2", many && "gap-1.5")}>
              <MiniBoard darts={c.darts} color={c.color} size={many ? 30 : 36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight text-ink-200 sm:text-xs">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className="truncate">{c.name}</span>
                </p>
                <div className="flex items-baseline gap-1">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={shown}
                      initial={{ y: 10, opacity: 0, scale: 0.8 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      exit={{ y: -10, opacity: 0 }}
                      transition={spring.bouncy}
                      className={cn(
                        "font-display text-[22px] font-extrabold leading-none tabular text-ink-50",
                        many && "text-[19px]",
                      )}
                    >
                      {shown}
                    </motion.span>
                  </AnimatePresence>
                  {lead && shown > 0 && (
                    <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={spring.bouncy} className="text-xs" aria-label="leading">
                      👑
                    </motion.span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between gap-1">
              <Pips thrown={c.settled !== null ? TOTAL_DARTS : c.darts.length} color={c.color} />
              {!c.isMe && c.presence === "later" && c.settled === null && (
                <span className="truncate text-[9px] font-semibold uppercase tracking-wider text-ink-400">later</span>
              )}
            </div>
          </motion.div>
        );
      })}
    </header>
  );
}
