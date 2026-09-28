"use client";

import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { countChars, TAKE_LIMIT } from "./logic";
import { SPICE_LEVELS, type HotTakePrompt, type Side, type Spice } from "./prompts";
import { SIDE_THEME, SPICE_HEAT } from "./theme";

export function SideChip({ side, className, size = "sm" }: { side: Side; className?: string; size?: "sm" | "md" }) {
  const theme = SIDE_THEME[side];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-display font-extrabold uppercase tracking-[0.14em]",
        size === "sm" ? "h-6 px-2.5 text-[11px]" : "h-8 px-3.5 text-sm",
        className,
      )}
      style={{ background: theme.color, color: theme.ink, boxShadow: `0 0 18px -4px ${theme.glow}` }}
    >
      {theme.label}
    </span>
  );
}

export function SpiceMeter({ spice, className }: { spice: Spice; className?: string }) {
  const meta = SPICE_LEVELS[spice - 1];
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-200", className)}>
      <span className="flex">
        {[1, 2, 3].map((n) => (
          <motion.span
            key={n}
            aria-hidden
            className="text-sm"
            animate={{ opacity: n <= spice ? 1 : 0.18, scale: n <= spice ? 1 : 0.8, filter: n <= spice ? "grayscale(0)" : "grayscale(1)" }}
            transition={spring.bouncy}
          >
            🌶️
          </motion.span>
        ))}
      </span>
      <span>{meta?.label}</span>
    </span>
  );
}

function takeSize(take: string): string {
  const n = countChars(take);
  if (n < 70) return "text-[22px] sm:text-2xl";
  if (n < 150) return "text-lg sm:text-xl";
  return "text-base sm:text-lg";
}

/**
 * How a take appears to the crowd. Used as the live preview while writing,
 * the stamped card after locking in, and the bot's card on the reveal.
 */
export function TakeCard({
  prompt,
  side,
  take,
  spice,
  placeholder,
  stamp,
  footer,
  compact,
  className,
}: {
  prompt: HotTakePrompt;
  side: Side;
  take: string;
  spice: Spice;
  placeholder?: string;
  /** Rubber stamp slapped on the card ("LOCKED IN"). */
  stamp?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const theme = SIDE_THEME[side];
  const heat = SPICE_HEAT[spice];
  const empty = take.trim().length === 0;
  const glowAlpha = Math.round(40 + heat.glow * 120)
    .toString(16)
    .padStart(2, "0");
  return (
    <div className={cn("relative", className)}>
      <article
        className={cn("relative overflow-hidden rounded-[22px] glass-strong", compact ? "p-4" : "p-5")}
        style={{
          boxShadow: `0 0 0 1px ${theme.color}22, 0 24px 60px -28px ${heat.color}${glowAlpha}, inset 0 1px 0 rgb(255 255 255 / 0.06)`,
        }}
      >
        {/* Side-colored spine */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: theme.color }} />
        {/* Ember warmth pooling at the bottom, stronger with spice */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 transition-opacity duration-700"
          style={{
            background: `radial-gradient(ellipse 80% 70% at 50% 110%, ${heat.color}55, transparent 70%)`,
            opacity: 0.25 + heat.glow * 0.6,
          }}
        />
        <header className="relative flex items-center justify-between gap-2">
          <SideChip side={side} />
          <SpiceMeter spice={spice} />
        </header>
        <p className={cn("relative mt-3 text-[13px] font-medium leading-snug text-ink-300", compact && "mt-2")}>
          <span aria-hidden className="mr-1">
            {prompt.emoji}
          </span>
          {prompt.prompt}
        </p>
        <div className="relative mt-2 min-h-[3.5rem]">
          <AnimatePresence mode="popLayout" initial={false}>
            {empty ? (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                className="font-display text-lg font-semibold italic leading-snug text-ink-400"
              >
                {placeholder ?? "Your take shows up here…"}
              </motion.p>
            ) : (
              <motion.p
                key="take"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "whitespace-pre-wrap break-words font-display font-bold leading-[1.22] tracking-tight text-ink-50 [overflow-wrap:anywhere]",
                  compact ? "text-base sm:text-lg" : takeSize(take),
                )}
              >
                {take}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
        {footer && <footer className="relative mt-4">{footer}</footer>}
      </article>
      {stamp && <Stamp side={side}>{stamp}</Stamp>}
    </div>
  );
}

/** Rubber stamp that slams onto the card with overshoot. */
function Stamp({ side, children }: { side: Side; children: ReactNode }) {
  const theme = SIDE_THEME[side];
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute -bottom-4 right-2 select-none rounded-lg border-[3px] px-2.5 py-1 font-display text-lg font-extrabold uppercase tracking-[0.12em] sm:right-4 sm:text-xl"
      style={{
        color: theme.color,
        borderColor: theme.color,
        textShadow: `0 0 18px ${theme.glow}`,
        boxShadow: `0 0 24px -6px ${theme.glow}, inset 0 0 12px -4px ${theme.glow}`,
        background: "rgb(5 6 10 / 0.82)",
        backdropFilter: "blur(6px)",
      }}
      initial={{ scale: 2.6, rotate: -22, opacity: 0 }}
      animate={{ scale: 1, rotate: -7, opacity: 1 }}
      transition={{ type: "spring", stiffness: 700, damping: 20, delay: 0.42 }}
    >
      {children}
    </motion.div>
  );
}

export function CardFooterCount({ take }: { take: string }) {
  const n = countChars(take.trim());
  return (
    <p className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
      <span>Arena preview</span>
      <span className="font-mono tabular normal-case tracking-normal">
        {n}/{TAKE_LIMIT}
      </span>
    </p>
  );
}
