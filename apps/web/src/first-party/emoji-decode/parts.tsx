"use client";

import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type TargetAndTransition,
} from "motion/react";
import { useEffect, useEffectEvent, useState, type CSSProperties, type RefObject } from "react";
import { TimerRing } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn, hashString } from "@/lib/utils";
import { QUESTION_COUNT, QUESTION_MS, remainingAt, splitEmoji, type PipResult } from "./logic";

/**
 * Color emoji fonts first: some systems ship a monochrome font that also has
 * emoji glyphs (e.g. 🐱) and would otherwise win the fallback race.
 */
export const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", "Android Emoji", sans-serif';

/** Deterministic pseudo-random in [0, 1) — keeps renders pure and stable. */
export function noise(key: string): number {
  return (hashString(key) % 10_000) / 10_000;
}

/* ---------------------------------------------------------------------- */
/* Emoji tiles                                                            */
/* ---------------------------------------------------------------------- */

export type Outcome = "pending" | "correct" | "wrong";

/**
 * The rebus: one glass tile per emoji. Tiles pop in one by one on bouncy
 * springs with a slight tilt, idle-float, then hop for joy (correct) or
 * wobble (wrong) on the verdict.
 */
export function EmojiTiles({ emoji, seed, outcome }: { emoji: string; seed: string; outcome: Outcome }) {
  const reduce = useReducedMotion();
  const glyphs = splitEmoji(emoji);
  const n = glyphs.length;
  const cap = n >= 5 ? 88 : n === 4 ? 104 : n === 3 ? 124 : 140;
  // Big, but always fits: width share, a height share (short iframes) and a hard cap.
  const tile = `min(${cap}px, calc((min(100vw, 42rem) - 2.5rem - ${(n - 1) * 12}px) / ${n}), 20vh)`;

  return (
    <div
      className="flex items-center justify-center gap-3"
      style={{ "--tile": tile } as CSSProperties}
      role="img"
      aria-label={`Emoji puzzle: ${glyphs.join(" ")}`}
    >
      {glyphs.map((glyph, i) => {
        const tilt = reduce ? 0 : (noise(`${seed}:${i}`) - 0.5) * 14;
        const reaction: TargetAndTransition =
          reduce || outcome === "pending"
            ? { y: 0, rotate: 0, scale: 1 }
            : outcome === "correct"
              ? {
                  y: [0, -22, 0, -6, 0],
                  scale: [1, 1.14, 0.96, 1.03, 1],
                  transition: { duration: 0.7, delay: i * 0.06, ease: "easeOut" },
                }
              : {
                  rotate: [0, -12, 10, -6, 3, 0],
                  y: [0, 4, 6, 6, 6, 6],
                  transition: { duration: 0.55, delay: i * 0.04 },
                };
        return (
          <motion.div
            key={`${glyph}-${i}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.2, y: 36, rotate: tilt * 4 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: tilt }}
            transition={{ type: "spring", stiffness: 430, damping: 13, mass: 0.9, delay: 0.06 + i * 0.09 }}
          >
            <motion.div animate={reaction}>
              <div
                className={cn(
                  "relative flex items-center justify-center rounded-[28%] border transition-[border-color,box-shadow,filter] duration-300",
                  outcome === "correct"
                    ? "border-success/60 shadow-[0_18px_44px_-16px_var(--color-success)]"
                    : outcome === "wrong"
                      ? "border-danger/40 shadow-[0_18px_40px_-18px_var(--color-danger)] saturate-[0.6]"
                      : "border-white/[0.12] shadow-[0_18px_44px_-18px_var(--accent-to)]",
                )}
                style={{
                  width: "var(--tile)",
                  height: "var(--tile)",
                  background:
                    "linear-gradient(160deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.035) 55%, rgb(255 255 255 / 0.07)), rgb(13 16 24 / 0.55)",
                }}
              >
                {/* glassy bevel: bright top edge, soft inner shade at the bottom */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),inset_0_-14px_26px_rgb(0_0_0/0.22)]"
                />
                <span
                  className="relative select-none leading-none motion-safe:animate-float"
                  style={{
                    fontFamily: EMOJI_FONT,
                    fontSize: "calc(var(--tile) * 0.6)",
                    animationDuration: `${3 + noise(`${seed}:f${i}`) * 1.4}s`,
                    animationDelay: `${-i * 0.8}s`,
                    filter: "drop-shadow(0 6px 10px rgb(0 0 0 / 0.35))",
                  }}
                >
                  {glyph}
                </span>
              </div>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Options                                                                */
/* ---------------------------------------------------------------------- */

export type OptionStatus = "idle" | "picked-correct" | "picked-wrong" | "reveal" | "dim";

export function OptionCard({
  index,
  text,
  status,
  locked,
  onPick,
  buttonRef,
}: {
  index: number;
  text: string;
  status: OptionStatus;
  locked: boolean;
  onPick: (index: number) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const reduce = useReducedMotion();
  const target: TargetAndTransition =
    status === "picked-wrong" && !reduce
      ? { x: [0, -12, 11, -8, 6, -3, 0], scale: 1, opacity: 1, transition: { duration: 0.46, ease: "easeOut" } }
      : status === "picked-correct"
        ? { x: 0, scale: [1, 1.05, 1], opacity: 1, transition: { duration: 0.42, ease: ease.outBack } }
        : status === "reveal"
          ? { x: 0, scale: [1, 1.03, 1, 1.03, 1], opacity: 1, transition: { duration: 0.9, delay: 0.12 } }
          : status === "dim"
            ? { x: 0, scale: 0.97, opacity: 0.38, transition: spring.soft }
            : { x: 0, scale: 1, opacity: 1, transition: spring.snappy };

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 34, scale: 0.9, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      transition={{ type: "spring", stiffness: 340, damping: 22, delay: 0.24 + index * 0.065 }}
      className="relative"
    >
      <motion.button
        ref={buttonRef}
        type="button"
        onClick={() => onPick(index)}
        disabled={locked}
        aria-keyshortcuts={String(index + 1)}
        aria-label={`Option ${index + 1}: ${text}`}
        animate={target}
        whileHover={locked ? undefined : { y: -3, scale: 1.015 }}
        whileTap={locked ? undefined : { scale: 0.95 }}
        className={cn(
          "group relative flex min-h-[3.25rem] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow,color] duration-200",
          "focus-visible:ring-2 focus-visible:ring-[var(--accent-from)] focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950",
          "disabled:cursor-default",
          status === "idle" &&
            "glass border-white/10 text-ink-50 shadow-[0_10px_30px_-18px_rgb(0_0_0/0.8)] hover:border-[color-mix(in_oklab,var(--accent-from)_55%,transparent)] hover:bg-white/[0.07] hover:shadow-[0_16px_40px_-18px_var(--accent-to)]",
          status === "dim" && "glass border-white/[0.06] text-ink-300",
          status === "picked-correct" &&
            "border-success bg-[color-mix(in_oklab,var(--color-success)_20%,var(--color-ink-900))] text-white shadow-[0_0_0_1px_var(--color-success),0_16px_50px_-12px_var(--color-success)]",
          status === "picked-wrong" &&
            "border-danger bg-[color-mix(in_oklab,var(--color-danger)_18%,var(--color-ink-900))] text-white shadow-[0_0_0_1px_var(--color-danger),0_14px_40px_-14px_var(--color-danger)]",
          status === "reveal" &&
            "border-success/80 bg-[color-mix(in_oklab,var(--color-success)_12%,var(--color-ink-900))] text-white shadow-[0_0_0_1px_color-mix(in_oklab,var(--color-success)_70%,transparent),0_0_36px_-6px_color-mix(in_oklab,var(--color-success)_60%,transparent)]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold ring-1 transition-colors duration-200",
            status === "picked-correct" || status === "reveal"
              ? "bg-success text-ink-950 ring-success"
              : status === "picked-wrong"
                ? "bg-danger text-white ring-danger"
                : "bg-white/[0.06] text-ink-300 ring-white/10 group-hover:text-ink-50",
          )}
        >
          {status === "picked-correct" || status === "reveal" ? <CheckIcon /> : status === "picked-wrong" ? <CrossIcon /> : index + 1}
        </span>
        <span className="min-w-0 text-[15px] font-semibold leading-snug tracking-tight [text-wrap:balance] max-[360px]:text-sm">
          {text}
        </span>
        {status === "picked-correct" && <Burst seed={text} />}
      </motion.button>
    </motion.div>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3, ease: "easeOut" }} />
    </svg>
  );
}

export function CrossIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" aria-hidden>
      <motion.path d="M7 7l10 10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18 }} />
      <motion.path d="M17 7L7 17" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, delay: 0.1 }} />
    </svg>
  );
}

/** Particle burst + shockwave ring, emitted from the centre of its parent. */
export function Burst({ seed, count = 18 }: { seed: string; count?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const colors = ["var(--color-success)", "var(--accent-from)", "var(--accent-to)", "#ffffff", "var(--color-gold)"];
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10">
      <motion.span
        className="absolute -left-10 -top-10 size-20 rounded-full border-2 border-success"
        initial={{ scale: 0.3, opacity: 0.9 }}
        animate={{ scale: 3.2, opacity: 0 }}
        transition={{ duration: 0.6, ease: ease.outExpo }}
      />
      {Array.from({ length: count }, (_, i) => {
        const r1 = noise(`${seed}:a${i}`);
        const r2 = noise(`${seed}:d${i}`);
        const angle = (i / count) * Math.PI * 2 + (r1 - 0.5) * 0.6;
        const dist = 70 + r2 * 90;
        const size = 4 + Math.round(r1 * 6);
        const sparkle = i % 6 === 0;
        return sparkle ? (
          <motion.span
            key={i}
            className="absolute -left-2 -top-2 text-base leading-none"
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * dist * 0.8, y: Math.sin(angle) * dist * 0.6 - 10, scale: [0.4, 1.2, 0], opacity: [1, 1, 0], rotate: 120 }}
            transition={{ duration: 0.85, ease: ease.outExpo }}
          >
            ✨
          </motion.span>
        ) : (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{ width: size, height: size, left: -size / 2, top: -size / 2, background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.7, scale: 0, opacity: [1, 1, 0] }}
            transition={{ duration: 0.65 + r2 * 0.25, ease: ease.outExpo }}
          />
        );
      })}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Clock + verdict                                                        */
/* ---------------------------------------------------------------------- */

/**
 * The per-puzzle clock. The start time lives in `startRef` (shared with the
 * parent, which reads it when an answer lands) and is set lazily on first
 * frame, so StrictMode's double effects don't reset it.
 */
export function QuestionClock({
  startRef,
  frozenMs,
  onExpire,
  size,
}: {
  startRef: RefObject<number | null>;
  frozenMs: number | null;
  onExpire: () => void;
  size: number;
}) {
  const [left, setLeft] = useState(QUESTION_MS);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (frozenMs !== null) return;
    if (startRef.current === null) startRef.current = performance.now();
    const start = startRef.current;
    let raf = 0;
    let lastSecond = Math.ceil(remainingAt(start, performance.now()) / 1000);
    const loop = () => {
      const remaining = remainingAt(start, performance.now());
      setLeft(remaining);
      const second = Math.ceil(remaining / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        if (second > 0 && second <= 3) play("tick");
      }
      if (remaining <= 0) {
        expire();
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frozenMs, startRef]);

  const shown = frozenMs ?? left;
  return (
    <TimerRing
      fraction={shown / QUESTION_MS}
      size={size}
      label={<span className="text-base">{Math.ceil(shown / 1000)}</span>}
    />
  );
}

export function VerdictBadge({ outcome, timeout, size }: { outcome: "correct" | "wrong"; timeout: boolean; size: number }) {
  return (
    <motion.div
      initial={{ scale: 0, rotate: -120 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={spring.wobbly}
      className={cn(
        "flex items-center justify-center rounded-full text-ink-950",
        outcome === "correct"
          ? "bg-success shadow-[0_0_30px_-4px_var(--color-success)]"
          : "bg-danger text-white shadow-[0_0_30px_-6px_var(--color-danger)]",
      )}
      style={{ width: size, height: size }}
      role="status"
      aria-label={outcome === "correct" ? "Correct" : timeout ? "Time's up" : "Wrong"}
    >
      {outcome === "correct" ? (
        <CheckIcon className="size-7" />
      ) : timeout ? (
        <span className="text-2xl leading-none">⏰</span>
      ) : (
        <CrossIcon className="size-7" />
      )}
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Scoreboard bits                                                        */
/* ---------------------------------------------------------------------- */

/** A number that springs (ticks) toward its value. */
export function TickingNumber({ value, from, className }: { value: number; from?: number; className?: string }) {
  const mv = useSpring(from ?? value, { stiffness: 110, damping: 22, mass: 0.9 });
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en"));
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** 8 progress pips: grey → green/red as answers land; the current one breathes. */
export function Pips({
  results,
  className,
  label,
}: {
  results: (PipResult | null)[];
  className?: string;
  label: string;
}) {
  const current = results.findIndex((r) => r === null);
  const right = results.filter((r) => r?.correct).length;
  const wrong = results.filter((r) => r && !r.correct).length;
  return (
    <div
      className={cn("flex items-center gap-[3px]", className)}
      role="img"
      aria-label={`${label}: ${right} right, ${wrong} wrong, ${QUESTION_COUNT - right - wrong} to go`}
    >
      {results.map((r, i) => (
        <span key={i} className="relative h-2 w-2.5 overflow-hidden rounded-full bg-white/10 min-[380px]:w-3.5 sm:w-5">
          <AnimatePresence>
            {r && (
              <motion.span
                initial={{ scaleX: 0, opacity: 0.4 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={spring.bouncy}
                className={cn(
                  "absolute inset-0 origin-left rounded-full",
                  r.correct ? "bg-success shadow-[0_0_8px_var(--color-success)]" : "bg-danger",
                )}
              />
            )}
          </AnimatePresence>
          {i === current && (
            <motion.span
              className="absolute inset-0 rounded-full bg-[var(--accent-from)]"
              animate={{ opacity: [0.15, 0.6, 0.15] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/** "×2" → "🔥×3" streak chip with a flickering flame. */
export function StreakChip({ streak }: { streak: number }) {
  const hot = streak >= 3;
  return (
    <AnimatePresence>
      {streak >= 2 && (
        <motion.span
          key="streak"
          layout
          initial={{ scale: 0, rotate: -25, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0, filter: "blur(6px)", y: 6, transition: { duration: 0.25 } }}
          transition={spring.wobbly}
          className={cn(
            "inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 font-mono text-[11px] font-bold tabular leading-none",
            hot
              ? "bg-[linear-gradient(120deg,var(--color-gold),var(--color-ember))] text-ink-950 shadow-[0_0_18px_-2px_var(--color-ember)]"
              : "bg-white/10 text-ink-100",
          )}
          aria-label={`${streak} in a row`}
        >
          {hot && (
            <motion.span
              aria-hidden
              className="inline-block"
              animate={{ scale: [1, 1.22, 0.94, 1.12, 1], rotate: [-6, 6, -4, 5, -6], y: [0, -1, 0, -1, 0] }}
              transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
              style={{ filter: "drop-shadow(0 0 4px #ff8a3d)" }}
            >
              🔥
            </motion.span>
          )}
          <motion.span key={streak} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring.bouncy}>
            ×{streak}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
