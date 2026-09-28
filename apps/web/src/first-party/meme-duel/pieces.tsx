"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useCountdown } from "@/first-party/shared/hooks";
import { TimerRing } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { formatClock } from "./logic";

type HapticStyle = "light" | "medium" | "heavy" | "success" | "error";

/** Host haptics, fire-and-forget. */
export function useBuzz(): (style: HapticStyle) => void {
  const xapps = useXApps();
  return useCallback((style: HapticStyle) => void xapps.ui.haptic(style).catch(() => {}), [xapps]);
}

/* ---------------------------------------------------------------------- */
/* Card back                                                              */
/* ---------------------------------------------------------------------- */

const BACK_EMOJI = ["😂", "🔥", "💀", "🗿", "👀", "🤡", "💯", "🫠", "😭"];

/** The face-down side of the meme card: shown before the reveal and mid-flip. */
export function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "@container relative size-full overflow-hidden rounded-[var(--r,24px)] ring-1 ring-white/15",
        "bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] shadow-[0_30px_80px_-24px_var(--accent-to)]",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, rgb(255 255 255 / 0.35) 0 2px, transparent 2px 18px)",
        }}
      />
      <div aria-hidden className="absolute inset-0 grid grid-cols-3 place-items-center p-[8%] opacity-30">
        {BACK_EMOJI.map((e, i) => (
          <span key={i} className="text-[clamp(18px,7cqw,44px)] grayscale" style={{ rotate: `${(i % 2 ? 1 : -1) * (8 + i * 3)}deg` }}>
            {e}
          </span>
        ))}
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <div className="grid size-[42%] place-items-center rounded-full bg-ink-950/80 shadow-[inset_0_0_0_2px_rgb(255_255_255/0.15)] backdrop-blur-sm">
          <span className="font-display text-[clamp(40px,18cqw,120px)] leading-none font-extrabold text-white">?</span>
        </div>
      </div>
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(115deg,transparent_30%,rgb(255_255_255/0.28)_45%,transparent_60%)] bg-[length:250%_100%] animate-shimmer motion-reduce:animate-none"
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Opponent status pill                                                   */
/* ---------------------------------------------------------------------- */

export type OpponentState = "idle" | "typing" | "locked";

export function OpponentPill({ player, state }: { player?: PlayerInfo; state: OpponentState }) {
  const reduced = useReducedMotion();
  if (!player) return null;
  return (
    <motion.div
      layout
      transition={spring.layout}
      animate={state === "locked" && !reduced ? { scale: [1, 1.12, 1], transition: { duration: 0.5, ease: "easeOut" } } : { scale: 1 }}
      className={cn(
        "flex h-9 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-full py-1 pl-1 pr-3 ring-1 transition-colors duration-300",
        state === "locked" ? "bg-success/15 ring-success/40" : state === "typing" ? "bg-white/[0.09] ring-white/20" : "bg-white/[0.05] ring-white/10",
      )}
      aria-live="polite"
    >
      <span className="relative shrink-0">
        <Avatar person={player} size={28} />
        {state === "typing" && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-[var(--accent-from)]">
            <span className="absolute inset-0 animate-ping-soft rounded-full bg-[var(--accent-from)]" />
          </span>
        )}
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={state}
          initial={{ y: 14, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -14, opacity: 0 }}
          transition={spring.snappy}
          className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-semibold"
        >
          {state === "typing" ? (
            <>
              <motion.span
                aria-hidden
                animate={reduced ? undefined : { rotate: [-12, 12, -12], y: [0, -2, 0] }}
                transition={{ duration: 0.6, repeat: Infinity }}
              >
                🍳
              </motion.span>
              <span className="min-w-0 truncate text-ink-50">@{player.handle}</span>
              <span className="shrink-0 text-ink-200">is cooking</span>
              <BouncingDots />
            </>
          ) : state === "locked" ? (
            <>
              <span aria-hidden>🔒</span>
              <span className="min-w-0 truncate text-ink-50">@{player.handle}</span>
              <span className="shrink-0 text-success">locked in</span>
            </>
          ) : (
            <>
              <span className="shrink-0 text-ink-300">vs</span>
              <span className="min-w-0 truncate text-ink-50">@{player.handle}</span>
            </>
          )}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function BouncingDots() {
  return (
    <span aria-hidden className="inline-flex shrink-0 gap-0.5 pl-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-ink-100"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.14 }}
        />
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Countdown                                                              */
/* ---------------------------------------------------------------------- */

/**
 * Its own component so the 60 fps countdown only re-renders the ring, never
 * the editor. `hard` clocks tick through the last ten seconds and expire.
 */
export function Countdown({
  durationMs,
  running,
  hard,
  onExpire,
}: {
  durationMs: number;
  running: boolean;
  hard: boolean;
  onExpire: () => void;
}) {
  const remaining = useCountdown(durationMs, running, onExpire);
  const seconds = Math.ceil(remaining / 1000);
  const last = useRef(seconds);
  useEffect(() => {
    if (seconds === last.current) return;
    last.current = seconds;
    if (hard && running && seconds > 0 && seconds <= 10) play("tick");
  }, [seconds, hard, running]);
  const overtime = !hard && remaining <= 0;
  return (
    <div className="flex items-center gap-2" role="timer" aria-label={overtime ? "Overtime" : `${formatClock(remaining)} left`}>
      <TimerRing
        fraction={overtime ? 1 : remaining / durationMs}
        size={42}
        label={<span className="text-[11px]">{overtime ? "OT" : formatClock(remaining)}</span>}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Burst                                                                  */
/* ---------------------------------------------------------------------- */

/** Pseudo-random 0..1 from an index and a channel. */
function jitter(i: number, channel: number): number {
  const v = Math.sin(i * 12.9898 + channel * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** One-shot radial burst of emoji or dots. Render inside a relative box. */
export function Burst({
  items,
  count = 14,
  distance = 160,
  className,
}: {
  items: string[];
  count?: number;
  distance?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  // Scattered but deterministic (renders must stay pure): a cheap hash per particle.
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 + jitter(i, 1) * 0.5;
        const d = distance * (0.55 + jitter(i, 2) * 0.6);
        return {
          item: items[i % items.length] ?? "✨",
          x: Math.cos(angle) * d,
          y: Math.sin(angle) * d,
          rotate: (jitter(i, 3) - 0.5) * 240,
          delay: jitter(i, 4) * 0.08,
        };
      }),
    [count, distance, items],
  );
  if (reduced) return null;
  return (
    <div aria-hidden className={cn("pointer-events-none absolute left-1/2 top-1/2 z-20", className)}>
      {parts.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-2xl"
          initial={{ x: 0, y: 0, scale: 0.2, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [0, p.y, p.y + 40], scale: [0.2, 1.2, 0.9], opacity: [1, 1, 0], rotate: p.rotate }}
          transition={{ duration: 1.1, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
        >
          {p.item}
        </motion.span>
      ))}
    </div>
  );
}
