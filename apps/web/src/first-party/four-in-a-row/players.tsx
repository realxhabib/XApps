"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { SEAT_COLORS } from "./geometry";
import { TURN_MS, type Seat } from "./logic";

/* ------------------------------------------------------------------------ */
/* A shared 10 fps clock so only the clocks re-render, never the board.     */
/* ------------------------------------------------------------------------ */

let nowValue = Date.now();
let ticker: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeNow(listener: () => void) {
  tickListeners.add(listener);
  if (!ticker) {
    nowValue = Date.now();
    ticker = setInterval(() => {
      nowValue = Date.now();
      tickListeners.forEach((l) => l());
    }, 100);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => 0,
  );
}

/** Milliseconds left on the running turn clock (full when not running). */
export function useTurnRemaining(turnStartedAt: number | null, running: boolean): number {
  const now = useNow();
  if (!running || turnStartedAt === null) return TURN_MS;
  return Math.max(0, Math.min(TURN_MS, TURN_MS - (now - turnStartedAt)));
}

export const formatClock = (ms: number) => `0:${String(Math.ceil(ms / 1000)).padStart(2, "0")}`;

/** "2d 4h", "5h 12m", "14m", "40s" — for play-anytime turn deadlines. */
export function formatTimeLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Milliseconds until an ISO deadline (null without one). Re-renders with the shared clock. */
export function useTimeLeft(deadline: string | null): number | null {
  const now = useNow();
  if (!deadline || now === 0) return null;
  const at = Date.parse(deadline);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/* ------------------------------------------------------------------------ */
/* Player card                                                              */
/* ------------------------------------------------------------------------ */

export type CardResult = "win" | "lose" | "draw" | null;

export function PlayerCard({
  player,
  seat,
  isMe,
  active,
  turnStartedAt,
  thinking,
  result,
  online,
  variant,
  mirror = false,
  reduced,
  timed = true,
  deadline = null,
}: {
  player: PlayerInfo | undefined;
  seat: Seat;
  isMe: boolean;
  active: boolean;
  turnStartedAt: number | null;
  /** False for play-anytime (async) games: no move clock, a deadline instead. */
  timed?: boolean;
  /** Async turn deadline (ISO), shown on the active card. */
  deadline?: string | null;
  thinking: boolean;
  result: CardResult;
  /** `undefined` hides the presence dot (bots, practice). */
  online?: boolean;
  variant: "bar" | "side";
  /** Bar variant only: avatar on the right, facing the other card. */
  mirror?: boolean;
  reduced: boolean;
}) {
  const remaining = useTurnRemaining(turnStartedAt, active && timed);
  const danger = timed && active && remaining <= 5_000;
  const color = SEAT_COLORS[seat];
  const side = variant === "side";
  const name = isMe ? "You" : (player?.name ?? "Opponent");
  const handle = player ? `@${player.handle}${player.isBot && !isMe ? " · bot" : ""}` : "waiting…";

  return (
    <motion.div
      className={cn(
        "relative isolate min-w-0 rounded-3xl border border-white/[0.07] bg-white/[0.035]",
        side
          ? "flex w-full flex-col items-center gap-2 px-4 pb-4 pt-5 text-center"
          : cn("flex flex-1 items-center gap-2.5 py-2", mirror ? "flex-row-reverse pl-3 pr-2 text-right" : "pl-2 pr-3"),
      )}
      animate={
        result === "lose" && !reduced
          ? { x: [0, -9, 8, -6, 4, -2, 0], opacity: 0.72 }
          : { x: 0, opacity: result === "lose" ? 0.72 : 1 }
      }
      transition={{ x: { duration: 0.55, ease: "easeOut" }, opacity: { duration: 0.4 } }}
    >
      {/* Turn indicator: one element that glides between the two cards */}
      {active && (
        <motion.div
          layoutId="fiar-turn"
          className="absolute inset-0 -z-10 rounded-3xl"
          style={{
            background: `linear-gradient(${mirror ? 225 : 135}deg, ${color.base}33, ${color.base}0d 65%)`,
            boxShadow: `inset 0 0 0 2px ${danger ? "var(--color-danger)" : `${color.base}cc`}, 0 12px 40px -16px ${color.base}`,
          }}
          transition={spring.layout}
        />
      )}
      {danger && !reduced && (
        <motion.div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-3xl bg-danger/20"
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      )}

      <div className="relative shrink-0">
        {player ? (
          <Avatar person={player} size={side ? 68 : 40} online={online} />
        ) : (
          <span className="block size-10 rounded-full border border-dashed border-white/25" />
        )}
        {/* Disc colour chip */}
        <span
          aria-hidden
          className={cn(
            "absolute -bottom-0.5 rounded-full ring-2 ring-ink-900",
            side ? "-right-0.5 size-6" : mirror ? "-left-0.5 size-4" : "-right-0.5 size-4",
          )}
          style={{ background: `radial-gradient(circle at 38% 32%, ${color.light}, ${color.base} 45%, ${color.dark})` }}
        />
        {/* Bar variant: a typing-style bubble on the avatar while they think */}
        <AnimatePresence>
          {thinking && !side && (
            <motion.span
              key="thinking"
              aria-label="thinking"
              className={cn(
                "absolute -top-2 flex h-4 items-center rounded-full bg-ink-800 px-1.5 shadow-[0_4px_12px_rgb(0_0_0/0.4)] ring-1 ring-white/15",
                mirror ? "-left-3" : "-right-3",
              )}
              initial={{ opacity: 0, scale: 0.3, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.3, y: 6 }}
              transition={spring.bouncy}
            >
              <ThinkingDots color={color.base} reduced={reduced} />
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {result === "win" && (
            <motion.span
              aria-hidden
              className={cn("absolute left-1/2 -translate-x-1/2", side ? "-top-6 text-2xl" : "-top-4 text-base")}
              initial={{ y: 12, scale: 0, rotate: -30 }}
              animate={{ y: 0, scale: 1, rotate: -8 }}
              transition={spring.wobbly}
            >
              👑
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {side ? (
        <>
          <div className="w-full min-w-0">
            <p className="flex items-center justify-center gap-1.5 truncate text-base font-semibold leading-tight">
              {name}
            </p>
            <div className="flex h-4 items-center justify-center text-[11px] leading-tight text-ink-300">
              <AnimatePresence mode="popLayout" initial={false}>
                {thinking ? (
                  <motion.span
                    key="thinking"
                    className="flex items-center gap-1 font-medium"
                    style={{ color: color.base }}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={spring.snappy}
                  >
                    thinking
                    <ThinkingDots color={color.base} reduced={reduced} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="handle"
                    className="truncate"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={spring.snappy}
                  >
                    {handle}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          {timed ? (
            <Clock remaining={remaining} active={active} danger={danger} large mirror={false} color={color.base} />
          ) : (
            <Deadline active={active} deadline={deadline} isMe={isMe} large mirror={false} color={color.base} />
          )}
        </>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate text-sm font-semibold leading-tight">{name}</p>
          {timed ? (
            <Clock remaining={remaining} active={active} danger={danger} large={false} mirror={mirror} color={color.base} />
          ) : (
            <Deadline active={active} deadline={deadline} isMe={isMe} large={false} mirror={mirror} color={color.base} />
          )}
        </div>
      )}
    </motion.div>
  );
}

function Clock({
  remaining,
  active,
  danger,
  large,
  mirror,
  color,
}: {
  remaining: number;
  active: boolean;
  danger: boolean;
  large: boolean;
  mirror: boolean;
  color: string;
}) {
  const fraction = remaining / TURN_MS;
  return (
    <div
      className={cn("flex items-center gap-2", large ? "w-full flex-col gap-1.5" : mirror && "flex-row-reverse")}
      aria-label={active ? `${Math.ceil(remaining / 1000)} seconds left` : undefined}
    >
      <motion.span
        className={cn(
          "font-mono font-bold leading-none tabular transition-colors",
          large ? "text-2xl" : "text-[13px]",
          danger ? "text-danger" : active ? "text-ink-50" : "text-ink-500",
        )}
        animate={danger ? { scale: [1, 1.14, 1] } : { scale: 1 }}
        transition={danger ? { duration: 0.5, repeat: Infinity } : spring.snappy}
      >
        {formatClock(remaining)}
      </motion.span>
      <span className={cn("block h-1 min-w-0 overflow-hidden rounded-full bg-white/10", large ? "w-full" : "flex-1")}>
        <span
          className={cn("block h-full rounded-full", mirror ? "origin-right" : "origin-left")}
          style={{
            transform: `scaleX(${active ? fraction : 1})`,
            transition: "transform 110ms linear, background-color 300ms",
            backgroundColor: danger ? "var(--color-danger)" : active ? color : "rgb(255 255 255 / 0.18)",
          }}
        />
      </span>
    </div>
  );
}

/** Play-anytime turns: "Your move · 2d 23h" on the active card, a quiet dash otherwise. */
function Deadline({
  active,
  deadline,
  isMe,
  large,
  mirror,
  color,
}: {
  active: boolean;
  deadline: string | null;
  isMe: boolean;
  large: boolean;
  mirror: boolean;
  color: string;
}) {
  const left = useTimeLeft(active ? deadline : null);
  const soon = left !== null && left < 6 * 3_600_000;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 leading-none",
        large ? "w-full flex-col gap-1" : mirror && "flex-row-reverse",
      )}
    >
      {/* The narrow bar card only has room for the time left. */}
      {(large || !active || left === null) && (
        <span
          className={cn("truncate font-semibold", large ? "text-sm" : "text-[12px]", active ? "text-ink-50" : "text-ink-500")}
          style={active ? { color } : undefined}
        >
          {active ? (isMe ? "Your move" : "Their move") : "Waiting"}
        </span>
      )}
      {active && left !== null && (
        <span
          className={cn(
            "shrink-0 whitespace-nowrap font-mono tabular",
            large ? "text-xs text-ink-400" : "text-[12px] font-semibold",
            soon && "text-danger",
          )}
          style={!large && !soon ? { color } : undefined}
          title={deadline ? `Turn ends ${new Date(deadline).toLocaleString()}` : undefined}
        >
          {formatTimeLeft(left)} left
        </span>
      )}
    </div>
  );
}

function ThinkingDots({ color, reduced }: { color: string; reduced: boolean }) {
  return (
    <span aria-hidden className="inline-flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="block size-1 rounded-full"
          style={{ backgroundColor: color }}
          animate={reduced ? { opacity: [0.3, 1, 0.3] } : { y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}
