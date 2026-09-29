"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { create } from "zustand";
import { celebrate } from "@/components/motion/confetti";
import { haptic } from "@/lib/haptics";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";

export interface AchievementMoment {
  icon: string;
  name: string;
  description?: string;
  xp: number;
  appName: string;
  accent: [string, string];
  /** Someone else in the match unlocked it (their handle); null for the viewer. */
  by?: string | null;
}

interface MomentState {
  queue: (AchievementMoment & { id: number })[];
  push: (moment: AchievementMoment) => void;
  shift: () => void;
}

let nextId = 1;

const useMoments = create<MomentState>((set) => ({
  queue: [],
  // Keep it short: a flurry of unlocks shouldn't hold the screen for long.
  push: (moment) => set((s) => ({ queue: [...s.queue.slice(-4), { ...moment, id: nextId++ }] })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * The host's unlock moment: a banner with the icon, name and XP, a chime and
 * a small confetti burst (skipped with reduced motion). Others' unlocks get a
 * quieter banner without confetti.
 */
export function showAchievement(moment: AchievementMoment): void {
  useMoments.getState().push(moment);
  if (moment.by) {
    play("pop");
    return;
  }
  play("achievement");
  haptic("success");
  if (!prefersReducedMotion()) {
    celebrate({ pattern: "burst", x: 0.5, y: 0.1, count: 46, colors: [moment.accent[0], moment.accent[1], "#ffc93d", "#ffffff"] });
  }
}

const VISIBLE_MS = 3_600;

export function AchievementLayer() {
  const current = useMoments((s) => s.queue[0]);
  const shift = useMoments((s) => s.shift);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(shift, current.by ? 2_600 : VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, shift]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[96] flex justify-center px-4 sm:top-5" aria-live="polite">
      <AnimatePresence mode="wait">
        {current && (
          <motion.button
            key={current.id}
            type="button"
            onClick={shift}
            className="pointer-events-auto relative flex w-full max-w-sm items-center gap-3 overflow-hidden rounded-3xl p-2.5 pr-4 text-left shadow-2xl glass-strong"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.9, filter: "blur(6px)" }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96, transition: { duration: 0.2 } }}
            transition={{ ...spring.bouncy, filter: BLUR_TWEEN }}
            aria-label={`${current.by ? `@${current.by} unlocked` : "Achievement unlocked"}: ${current.name}`}
          >
            {!current.by && (
              <motion.span
                aria-hidden
                className="absolute inset-0 opacity-30"
                style={{ background: `linear-gradient(110deg, transparent 30%, ${current.accent[0]}66 50%, transparent 70%)` }}
                initial={{ x: "-100%" }}
                animate={reduced ? { x: "-100%" } : { x: "100%" }}
                transition={{ duration: 1.1, delay: 0.25, ease: "easeOut" }}
              />
            )}
            <motion.span
              className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-lg"
              style={{ background: `linear-gradient(135deg, ${current.accent[0]}, ${current.accent[1]})` }}
              initial={reduced ? false : { rotate: -25, scale: 0.4 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ ...spring.wobbly, delay: reduced ? 0 : 0.08 }}
              aria-hidden
            >
              {current.icon}
            </motion.span>
            <span className="relative min-w-0 flex-1">
              <span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-gold">
                {current.by ? `@${current.by} unlocked` : "Achievement unlocked"}
              </span>
              <span className="block truncate font-display text-base font-extrabold leading-tight text-ink-50">{current.name}</span>
              <span className="block truncate text-xs text-ink-300">{current.description || current.appName}</span>
            </span>
            {current.xp > 0 && !current.by && (
              <motion.span
                className="relative shrink-0 rounded-full bg-volt/15 px-2.5 py-1 font-mono text-xs font-bold text-volt"
                initial={reduced ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring.bouncy, delay: reduced ? 0 : 0.3 }}
              >
                +{current.xp} XP
              </motion.span>
            )}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
