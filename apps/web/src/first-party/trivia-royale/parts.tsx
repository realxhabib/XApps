"use client";

import type { PlayerInfo } from "@xapps/sdk";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
  type TargetAndTransition,
} from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { TimerRing } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn, hashString } from "@/lib/utils";
import { QUESTION_MS, ROUNDS, clockLeft, ordinal, type RoundResult, type Standing } from "./logic";

/** Deterministic pseudo-random in [0, 1): keeps renders pure and stable. */
export function noise(key: string): number {
  return (hashString(key) % 10_000) / 10_000;
}

/* ---------------------------------------------------------------------- */
/* Answer tiles                                                           */
/* ---------------------------------------------------------------------- */

/** Four game-show tiles: a color and a shape each, so they read at a glance (and without color). */
export const TILES = [
  { from: "#ff5c7a", to: "#e0284f", depth: "#8f1231", ink: "#fff", shape: "triangle", label: "Triangle" },
  { from: "#6b83ff", to: "#3d52e6", depth: "#1f2a8f", ink: "#fff", shape: "diamond", label: "Diamond" },
  { from: "#ffd84d", to: "#f5b31a", depth: "#9a6a00", ink: "#1a1300", shape: "circle", label: "Circle" },
  { from: "#b77bff", to: "#8a3dff", depth: "#4c1596", ink: "#fff", shape: "square", label: "Square" },
] as const;

export function Shape({ index, className }: { index: number; className?: string }) {
  const shape = TILES[index]?.shape ?? "circle";
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      {shape === "triangle" && <path d="M12 3.5 22 20.5H2z" />}
      {shape === "diamond" && <path d="M12 2 22 12 12 22 2 12z" />}
      {shape === "circle" && <circle cx="12" cy="12" r="9.5" />}
      {shape === "square" && <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />}
    </svg>
  );
}

export type TileStatus =
  | "idle" // pickable
  | "locked" // my pick, waiting for the reveal
  | "muted" // someone else's choice while I'm locked / out of time
  | "correct" // the right answer (reveal)
  | "wrong-pick" // my wrong pick (reveal)
  | "wrong"; // another wrong answer (reveal)

export function AnswerTile({
  index,
  text,
  status,
  interactive,
  onPick,
  count,
  share,
  pickers,
}: {
  index: number;
  text: string;
  status: TileStatus;
  interactive: boolean;
  onPick: (index: number) => void;
  /** Live pick count (spectators) or final count (reveal). Hidden when null. */
  count: number | null;
  /** 0..1 fill for the live count bar. */
  share: number;
  /** Who picked this tile (reveal). */
  pickers: PlayerInfo[];
}) {
  const reduce = useReducedMotion();
  const tile = TILES[index] ?? TILES[0];
  const revealed = status === "correct" || status === "wrong" || status === "wrong-pick";

  const target: TargetAndTransition = reduce
    ? { opacity: status === "muted" || status === "wrong" ? 0.4 : 1 }
    : status === "correct"
      ? { scale: [1, 1.07, 1.02], y: 0, opacity: 1, filter: "saturate(1.1) brightness(1.05)", transition: { duration: 0.55, ease: ease.outBack } }
      : status === "wrong-pick"
        ? { x: [0, -10, 9, -6, 4, 0], scale: 0.98, opacity: 0.9, filter: "saturate(0.55) brightness(0.9)", transition: { duration: 0.45 } }
        : status === "wrong"
          ? { scale: 0.95, opacity: 0.34, filter: "saturate(0.2) brightness(0.8)", transition: spring.soft }
          : status === "muted"
            ? { scale: 0.95, opacity: 0.38, filter: "saturate(0.35) brightness(0.85)", transition: spring.soft }
            : status === "locked"
              ? { scale: [0.94, 1.04, 1], y: 0, opacity: 1, filter: "saturate(1) brightness(1)", transition: { duration: 0.4, ease: ease.outBack } }
              : { scale: 1, x: 0, y: 0, opacity: 1, filter: "saturate(1) brightness(1)", transition: spring.snappy };

  return (
    <motion.div
      className="relative min-w-0"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 26, scale: 0.86, rotate: index % 2 ? 2 : -2 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 22, delay: 0.32 + index * 0.07 }}
    >
      <motion.button
        type="button"
        disabled={!interactive}
        onClick={() => onPick(index)}
        aria-keyshortcuts={String(index + 1)}
        aria-label={`${tile.label}: ${text}${status === "correct" ? " (correct answer)" : status === "locked" ? " (your answer)" : ""}`}
        aria-pressed={status === "locked" || status === "wrong-pick" || undefined}
        animate={target}
        whileHover={interactive && !reduce ? { y: -3 } : undefined}
        whileTap={interactive && !reduce ? { y: 4, scale: 0.96 } : undefined}
        className={cn(
          "group relative flex h-full min-h-[4.75rem] w-full items-center gap-2.5 overflow-hidden rounded-[1.25rem] px-3 py-3 text-left outline-none sm:min-h-[5.5rem] sm:px-4",
          "focus-visible:ring-4 focus-visible:ring-white/70 disabled:cursor-default",
          "[@media(max-height:640px)]:min-h-[3.75rem] [@media(max-height:640px)]:py-2",
        )}
        style={
          {
            color: tile.ink,
            background: `linear-gradient(165deg, ${tile.from}, ${tile.to})`,
            boxShadow:
              status === "correct"
                ? `0 0 0 3px #fff, 0 0 0 7px color-mix(in oklab, var(--color-success) 70%, transparent), 0 18px 50px -12px var(--color-success)`
                : status === "locked"
                  ? `0 0 0 3px #fff, 0 5px 0 ${tile.depth}, 0 18px 40px -14px ${tile.from}`
                  : `0 5px 0 ${tile.depth}, 0 14px 30px -16px ${tile.from}`,
          } as CSSProperties
        }
      >
        {/* glossy top edge */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_1px_0_rgb(255_255_255/0.45),inset_0_-10px_22px_rgb(0_0_0/0.14)]"
        />
        {/* live count fill (spectators) */}
        {count !== null && !revealed && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 bg-white/25"
            initial={false}
            animate={{ width: `${Math.round(share * 100)}%` }}
            transition={spring.soft}
          />
        )}
        {/* the "you locked this in" shimmer */}
        {status === "locked" && !reduce && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.45),transparent)]"
            animate={{ x: ["0%", "400%"] }}
            transition={{ duration: 1.3, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" }}
          />
        )}

        <span
          className="relative flex size-8 shrink-0 items-center justify-center rounded-xl bg-black/15 shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]"
          aria-hidden
        >
          {status === "correct" ? (
            <CheckIcon className="size-5" />
          ) : status === "wrong-pick" ? (
            <CrossIcon className="size-5" />
          ) : (
            <Shape index={index} className="size-4 drop-shadow-[0_1px_0_rgb(0_0_0/0.2)]" />
          )}
        </span>
        <span className="relative min-w-0 flex-1 text-[15px] font-bold leading-tight tracking-tight [text-wrap:balance] max-[370px]:text-sm sm:text-base">
          {text}
        </span>

        {/* right rail: lock badge / count / pickers */}
        <span className="relative flex shrink-0 flex-col items-end gap-1">
          <AnimatePresence>
            {status === "locked" && (
              <motion.span
                key="lock"
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={spring.wobbly}
                className="flex size-7 items-center justify-center rounded-full bg-white text-ink-950 shadow-lg"
                aria-hidden
              >
                <LockIcon className="size-3.5" />
              </motion.span>
            )}
          </AnimatePresence>
          {count !== null && (
            <motion.span
              key={count}
              initial={{ scale: 1.5, opacity: 0.4 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className="rounded-full bg-black/25 px-2 py-0.5 font-mono text-xs font-bold tabular"
              aria-label={`${count} picked this`}
            >
              {count}
            </motion.span>
          )}
        </span>

        {status === "correct" && <Burst seed={text} />}
      </motion.button>

      {/* Who picked this, popping onto the tile's corner on the reveal. */}
      {revealed && pickers.length > 0 && (
        <div className="pointer-events-none absolute -bottom-2.5 right-2.5 flex -space-x-1.5" aria-hidden>
          {pickers.slice(0, 5).map((p, i) => (
            <motion.span
              key={p.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ ...spring.bouncy, delay: 0.35 + i * 0.07 }}
              className="rounded-full ring-2 ring-ink-950"
            >
              <Avatar person={p} size={20} />
            </motion.span>
          ))}
          {pickers.length > 5 && (
            <span className="flex size-5 items-center justify-center rounded-full bg-ink-800 text-[9px] font-bold ring-2 ring-ink-950">
              +{pickers.length - 5}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Icons + burst                                                          */
/* ---------------------------------------------------------------------- */

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

export function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-4", className)} fill="currentColor" aria-hidden>
      <path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10zm2.5 0h5V7.5a2.5 2.5 0 0 0-5 0z" />
    </svg>
  );
}

/** Particle burst + shockwave ring from the centre of its (relative) parent. */
export function Burst({ seed, count = 16 }: { seed: string; count?: number }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const colors = ["#ffffff", "var(--color-success)", "var(--color-gold)", "var(--accent-from)", "var(--accent-to)"];
  return (
    <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-10">
      <motion.span
        className="absolute -left-10 -top-10 size-20 rounded-full border-2 border-white"
        initial={{ scale: 0.3, opacity: 0.9 }}
        animate={{ scale: 3.4, opacity: 0 }}
        transition={{ duration: 0.65, ease: ease.outExpo }}
      />
      {Array.from({ length: count }, (_, i) => {
        const r1 = noise(`${seed}:a${i}`);
        const r2 = noise(`${seed}:d${i}`);
        const angle = (i / count) * Math.PI * 2 + (r1 - 0.5) * 0.6;
        const dist = 60 + r2 * 90;
        const size = 4 + Math.round(r1 * 6);
        return (
          <motion.span
            key={i}
            className="absolute rounded-full"
            style={{ width: size, height: size, left: -size / 2, top: -size / 2, background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist * 0.6, scale: 0, opacity: [1, 1, 0] }}
            transition={{ duration: 0.7 + r2 * 0.25, ease: ease.outExpo }}
          />
        );
      })}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Clock                                                                  */
/* ---------------------------------------------------------------------- */

/** Ring + seconds, driven by requestAnimationFrame off the phase anchor. Ticks in the last 3 s. */
export function QuestionClock({ anchor, running, size = 52 }: { anchor: number; running: boolean; size?: number }) {
  const [left, setLeft] = useState(QUESTION_MS);
  const lastSecond = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const remaining = clockLeft(anchor, Date.now());
      setLeft(remaining);
      const second = Math.ceil(remaining / 1000);
      if (lastSecond.current !== null && second !== lastSecond.current && second > 0 && second <= 3) play("tick");
      lastSecond.current = second;
      if (remaining > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anchor, running]);
  return (
    <TimerRing fraction={left / QUESTION_MS} size={size} label={<span className="text-base">{Math.ceil(left / 1000)}</span>} />
  );
}

/** Thin draining bar along the bottom of the question card. */
export function TimeBar({ anchor, running }: { anchor: number; running: boolean }) {
  const [left, setLeft] = useState(QUESTION_MS);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const loop = () => {
      const remaining = clockLeft(anchor, Date.now());
      setLeft(remaining);
      if (remaining > 0) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anchor, running]);
  const fraction = left / QUESTION_MS;
  return (
    <div className="absolute inset-x-0 bottom-0 h-1.5 bg-white/[0.06]" aria-hidden>
      <div
        className="h-full origin-left rounded-r-full"
        style={{
          transform: `scaleX(${fraction})`,
          background:
            fraction < 0.25
              ? "var(--color-danger)"
              : "linear-gradient(90deg, var(--accent-from), var(--accent-to))",
          boxShadow: fraction < 0.25 ? "0 0 12px var(--color-danger)" : "0 0 12px var(--accent-to)",
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Who answered                                                           */
/* ---------------------------------------------------------------------- */

export type SeatMark = "waiting" | "answered" | "correct" | "wrong" | "missed";

/** A row of every seated player; each pops and gets a ring when they lock in, then ✓/✗ on the reveal. */
export function AnsweredRow({
  players,
  marks,
  meId,
  label,
}: {
  players: PlayerInfo[];
  marks: Record<string, SeatMark>;
  meId: string | null;
  label: ReactNode;
}) {
  const reduce = useReducedMotion();
  const size = players.length > 6 ? 28 : 32;
  return (
    <div className="flex items-center justify-center gap-3" aria-label="Who has answered">
      <ul className="flex items-center gap-1.5 sm:gap-2">
        {players.map((p, i) => {
          const mark = marks[p.id] ?? "waiting";
          const done = mark !== "waiting";
          return (
            <motion.li
              key={p.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ ...spring.bouncy, delay: 0.05 + i * 0.04 }}
              className="relative"
              title={p.id === meId ? "You" : `@${p.handle}`}
              aria-label={`${p.id === meId ? "You" : p.name}: ${mark}`}
            >
              <motion.div
                animate={
                  reduce
                    ? { opacity: done ? 1 : 0.45 }
                    : done
                      ? { opacity: 1, y: [0, -7, 0], scale: [1, 1.12, 1] }
                      : { opacity: [0.35, 0.6, 0.35], y: 0, scale: 1 }
                }
                transition={
                  done
                    ? { duration: 0.45, ease: ease.outBack }
                    : { duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }
                }
                className={cn(
                  "rounded-full p-[2px] transition-[background] duration-300",
                  mark === "correct"
                    ? "bg-success"
                    : mark === "wrong" || mark === "missed"
                      ? "bg-danger/80"
                      : done
                        ? "bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))]"
                        : "bg-white/10",
                )}
              >
                <Avatar person={p} size={size} className="rounded-full ring-2 ring-ink-950" />
              </motion.div>
              <AnimatePresence>
                {done && (
                  <motion.span
                    key={mark}
                    initial={{ scale: 0, rotate: -45 }}
                    animate={{ scale: 1, rotate: 0 }}
                    exit={{ scale: 0 }}
                    transition={spring.wobbly}
                    className={cn(
                      "absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full text-[9px] font-black ring-2 ring-ink-950",
                      mark === "correct" && "bg-success text-ink-950",
                      (mark === "wrong" || mark === "missed") && "bg-danger text-white",
                      mark === "answered" && "bg-white text-ink-950",
                    )}
                    aria-hidden
                  >
                    {mark === "correct" ? "✓" : mark === "wrong" ? "✗" : mark === "missed" ? "…" : "✓"}
                  </motion.span>
                )}
              </AnimatePresence>
              {p.id === meId && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-full bg-ink-50 px-1 text-[8px] font-black uppercase leading-3 tracking-wider text-ink-950">
                  you
                </span>
              )}
            </motion.li>
          );
        })}
      </ul>
      <span className="shrink-0 font-mono text-[11px] font-bold tabular text-ink-300">{label}</span>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Numbers + badges                                                       */
/* ---------------------------------------------------------------------- */

/** A number that springs (ticks) toward its value. */
export function TickingNumber({ value, from, className }: { value: number; from?: number; className?: string }) {
  const mv = useSpring(from ?? value, { stiffness: 140, damping: 26, mass: 0.8, restDelta: 0.5 });
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en"));
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

export function StreakChip({ streak, className }: { streak: number; className?: string }) {
  if (streak < 2) return null;
  return (
    <motion.span
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={spring.wobbly}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-[linear-gradient(120deg,var(--color-gold),var(--color-ember))] px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-ink-950 shadow-[0_0_14px_-2px_var(--color-ember)]",
        className,
      )}
      aria-label={`${streak} in a row`}
    >
      <span aria-hidden>🔥</span>×{streak}
    </motion.span>
  );
}

export function DoubleBadge() {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={{ scale: 0, rotate: -25 }}
      animate={reduce ? { scale: 1, rotate: 0 } : { scale: [1, 1.08, 1], rotate: [-3, 3, -3] }}
      transition={reduce ? spring.wobbly : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      className="inline-flex h-7 items-center rounded-full bg-[linear-gradient(120deg,var(--color-gold),var(--color-ember))] px-2.5 font-display text-xs font-extrabold tracking-tight text-ink-950 shadow-[0_0_24px_-4px_var(--color-ember)]"
    >
      2× POINTS
    </motion.span>
  );
}

/** Round result chip for a leaderboard row: "+850", "✗", "⏰". */
export function DeltaChip({ result }: { result: RoundResult | undefined }) {
  if (!result) return null;
  const good = result.correct;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular leading-none",
        good ? "bg-success/15 text-success" : "bg-white/[0.06] text-ink-400",
      )}
    >
      {good ? `+${result.points.toLocaleString("en")}` : result.choice === null ? "⏰ 0" : "✗ 0"}
    </span>
  );
}

const MEDALS = ["#ffc93d", "#d6dbe6", "#e39a5b"];

export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const medal = MEDALS[rank - 1];
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold tabular",
        medal ? "text-ink-950" : "bg-white/[0.06] text-ink-300",
        className,
      )}
      style={medal ? { background: `radial-gradient(circle at 35% 30%, #fff8, transparent 55%), ${medal}` } : undefined}
    >
      {rank}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Podium                                                                 */
/* ---------------------------------------------------------------------- */

export interface PodiumEntry {
  player: PlayerInfo;
  standing: Standing;
}

const PODIUM_HEIGHT = { 1: "clamp(96px, 20vh, 150px)", 2: "clamp(70px, 14vh, 110px)", 3: "clamp(48px, 9vh, 78px)" } as const;

export function Podium({ entries, meId }: { entries: PodiumEntry[]; meId: string | null }) {
  const reduce = useReducedMotion();
  // 2nd · 1st · 3rd. Ties share a rank (and a step height).
  const top = entries.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  return (
    <div className="flex w-full items-end justify-center gap-2 sm:gap-3" role="list" aria-label="Podium">
      {order.map((entry) => {
        if (!entry) return null;
        const place = Math.min(3, entry.standing.rank) as 1 | 2 | 3;
        const first = place === 1;
        const delay = first ? 0.55 : place === 2 ? 0.3 : 0.1;
        const isMe = entry.player.id === meId;
        return (
          <div key={entry.player.id} role="listitem" className="flex w-[31%] max-w-40 flex-col items-center">
            <motion.div
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: -60, scale: 0.4 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 14, delay: delay + 0.35 }}
              className="relative mb-2 flex flex-col items-center"
            >
              {first && (
                <motion.span
                  aria-hidden
                  className="absolute -top-7 text-3xl drop-shadow-[0_4px_12px_rgb(255_201_61/0.6)]"
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: -30, rotate: -40, scale: 0.4 }}
                  animate={{ opacity: 1, y: 0, rotate: -8, scale: 1 }}
                  transition={{ ...spring.wobbly, delay: delay + 0.8 }}
                >
                  👑
                </motion.span>
              )}
              <span
                className={cn(
                  "rounded-full p-[3px]",
                  first ? "bg-[linear-gradient(135deg,#ffe58a,#ffb13d)] shadow-[0_0_40px_-6px_#ffc93d]" : "bg-white/15",
                )}
              >
                <Avatar person={entry.player} size={first ? 60 : 46} className="rounded-full ring-2 ring-ink-950" />
              </span>
              <span className={cn("mt-1.5 max-w-full truncate text-xs font-bold", isMe ? "text-[var(--accent-from)]" : "text-ink-100")}>
                {isMe ? "You" : entry.player.isBot ? entry.player.name : `@${entry.player.handle}`}
              </span>
              <span className="font-mono text-[11px] font-bold tabular text-ink-300">
                <TickingNumber value={entry.standing.total} from={0} />
              </span>
            </motion.div>
            <motion.div
              initial={reduce ? { opacity: 0 } : { scaleY: 0, opacity: 0.6 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 180, damping: 20, delay }}
              className="relative w-full origin-bottom overflow-hidden rounded-t-2xl border border-b-0 border-white/10"
              style={{
                height: PODIUM_HEIGHT[place],
                background: first
                  ? "linear-gradient(180deg, color-mix(in oklab, #ffc93d 45%, var(--color-ink-800)), var(--color-ink-850))"
                  : "linear-gradient(180deg, color-mix(in oklab, var(--accent-from) 22%, var(--color-ink-800)), var(--color-ink-850))",
              }}
            >
              <span className="absolute inset-x-0 top-2 text-center font-display text-2xl font-extrabold text-white/85 sm:text-3xl">
                {ordinal(entry.standing.rank)}
              </span>
              {first && !reduce && (
                <motion.span
                  aria-hidden
                  className="absolute inset-y-0 -left-1/2 w-1/2 bg-[linear-gradient(100deg,transparent,rgb(255_255_255/0.25),transparent)]"
                  animate={{ x: ["0%", "400%"] }}
                  transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 1.2, delay: 1.4 }}
                />
              )}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

export const ROUND_LABEL = (round: number) => (round >= ROUNDS ? "Final round" : `Round ${round}`);
