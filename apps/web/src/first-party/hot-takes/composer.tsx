"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { TimerRing } from "@/first-party/shared/ui";
import { useCountdown } from "@/first-party/shared/hooks";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { EmberField } from "./embers";
import {
  TAKE_LIMIT,
  applySpark,
  countChars,
  counterState,
  formatClock,
  pickSpark,
  type CounterState,
  type TimerRule,
} from "./logic";
import { SPICE_LEVELS, type HotTakePrompt, type Side, type Spice } from "./prompts";
import { CardFooterCount, SideChip, TakeCard } from "./take-card";
import { SIDE_THEME, SPICE_HEAT } from "./theme";

export type OpponentState = "idle" | "typing" | "locked" | "earlier" | "later";

const PLACEHOLDERS = ["Make your case…", "Convince the crowd…", "Be bold. Be brief. Be right.", "Say it with your chest…"];

export function Composer({
  prompt,
  side,
  text,
  onText,
  spice,
  onSpice,
  onSubmit,
  timer,
  onExpire,
  opponent,
  opponentState,
  shakeKey,
  haptic,
}: {
  prompt: HotTakePrompt;
  side: Side;
  text: string;
  onText: (text: string) => void;
  spice: Spice;
  onSpice: (spice: Spice) => void;
  onSubmit: () => void;
  timer: TimerRule;
  onExpire: () => void;
  opponent?: PlayerInfo;
  opponentState: OpponentState;
  /** Bumped by the parent when a submit was rejected. */
  shakeKey: number;
  haptic: (style: "light" | "medium" | "heavy" | "error") => void;
}) {
  const reduce = useReducedMotion();
  const theme = SIDE_THEME[side];
  const heat = SPICE_HEAT[spice];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const counterId = useId();
  const [focused, setFocused] = useState(false);
  const [sparkCount, setSparkCount] = useState(0);
  const [cardScope, animateCard] = useAnimate<HTMLDivElement>();
  const [barScope, animateBar] = useAnimate<HTMLDivElement>();
  const count = countChars(text);
  const counter = counterState(count);
  const trimmedEmpty = text.trim().length === 0;
  const canSubmit = !trimmedEmpty && counter.remaining >= 0;

  // Rejected submit → shake the action bar.
  useEffect(() => {
    if (shakeKey === 0 || reduce || !barScope.current) return;
    void animateBar(barScope.current, { x: [0, -12, 10, -7, 4, 0] }, { duration: 0.4 });
  }, [shakeKey, reduce, animateBar, barScope]);

  const chooseSpice = (level: Spice) => {
    if (level === spice) return;
    onSpice(level);
    play(level === 3 ? "thump" : "pop");
    haptic(level === 3 ? "heavy" : "light");
    if (level === 3 && !reduce && cardScope.current) {
      // Going nuclear rattles the card.
      void animateCard(cardScope.current, { x: [0, -5, 5, -4, 3, -1, 0], rotate: [0, -0.6, 0.6, -0.3, 0] }, { duration: 0.45 });
    }
  };

  const spark = () => {
    const opener = pickSpark(text);
    const next = applySpark(text, opener);
    onText(next.text);
    setSparkCount((n) => n + 1);
    play("pop");
    haptic("light");
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  // ⌘/Ctrl+Enter locks in from anywhere in the composer (textarea, spice, spark…).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col" onKeyDown={onKeyDown}>
      {/* Prompt bar */}
      <header className="mx-auto flex w-full max-w-5xl items-start gap-3 px-4 pt-3 sm:px-6 sm:pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}>
              <SideChip side={side} />
            </motion.span>
            <span className="hidden text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300 min-[360px]:inline">Argue your side</span>
          </div>
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={spring.soft}
            className="mt-1.5 line-clamp-2 font-display text-[19px] font-extrabold leading-[1.1] tracking-tight sm:text-2xl"
          >
            <span aria-hidden className="mr-1.5">
              {prompt.emoji}
            </span>
            {prompt.prompt}
          </motion.h1>
        </div>
        <ComposeTimer rule={timer} onExpire={onExpire} />
      </header>

      <div className="mx-auto w-full max-w-5xl px-4 pt-2 sm:px-6">
        <OpponentPill opponent={opponent} state={opponentState} />
      </div>

      {/* Scrollable middle: survives short iframes and the mobile keyboard. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-4 pt-3 sm:px-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-start md:gap-6">
          <div className="flex min-w-0 flex-col gap-3">
            {/* The writing card */}
            <motion.div
              ref={cardScope}
              animate={{ y: focused ? -3 : 0, scale: focused ? 1.012 : 1 }}
              transition={spring.soft}
              className="relative rounded-[26px] p-[1.5px]"
              style={{
                boxShadow: `0 22px 70px -26px ${heat.color}${focused ? "dd" : "88"}, 0 0 ${18 + heat.glow * 36}px -12px ${heat.color}`,
                transition: "box-shadow 500ms ease",
              }}
            >
              {/* Rotating gradient border — spins faster the spicier it gets. */}
              <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[26px]">
                <div className="absolute inset-0 bg-white/10" />
                <motion.div
                  className="absolute left-1/2 top-1/2 aspect-square w-[180%] -translate-x-1/2 -translate-y-1/2"
                  style={{
                    background: `conic-gradient(from 0deg, transparent 0 40%, ${theme.color} 58%, #ff9a3d 74%, #ff3d6e 88%, transparent 100%)`,
                  }}
                  animate={{ rotate: reduce ? 0 : 360, opacity: focused ? 1 : 0.2 + heat.glow * 0.45 }}
                  transition={{
                    rotate: { duration: [7, 4, 2.2][spice - 1], repeat: Infinity, ease: "linear" },
                    opacity: { duration: 0.4 },
                  }}
                />
              </div>
              <div className="relative overflow-hidden rounded-[25px] bg-[#0b0c12]/95">
                {/* Flames licking up from the bottom of the card */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 bottom-0 h-[78%]"
                  style={{
                    maskImage: "linear-gradient(0deg, #000 30%, transparent)",
                    WebkitMaskImage: "linear-gradient(0deg, #000 30%, transparent)",
                  }}
                >
                  <div
                    className="absolute inset-0 transition-opacity duration-700"
                    style={{
                      background: `radial-gradient(ellipse 70% 60% at 50% 105%, ${heat.color}66, transparent 70%)`,
                      opacity: 0.35 + heat.glow * 0.65,
                    }}
                  />
                  <EmberField variant="flames" density={heat.flames} className="absolute inset-0 size-full" />
                </div>

                <div className="relative">
                  <AnimatePresence>
                    {text.length === 0 && <RotatingPlaceholder key="ph" side={side} />}
                  </AnimatePresence>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    onChange={(e) => onText(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    rows={5}
                    aria-label={`Your take, arguing ${theme.label}`}
                    aria-describedby={counterId}
                    aria-invalid={counter.tone === "over"}
                    spellCheck
                    autoComplete="off"
                    className="relative z-10 block min-h-[9.5rem] w-full min-w-0 resize-none bg-transparent px-5 pb-2 pt-4 font-display text-[19px] font-semibold leading-snug tracking-tight text-ink-50 outline-none [field-sizing:content] [overflow-wrap:anywhere] focus-visible:outline-none sm:min-h-[11rem] sm:text-xl"
                    style={{ caretColor: theme.color, maxHeight: "16rem" }}
                  />
                </div>

                <div className="relative z-10 flex items-center justify-between gap-2 px-3 pb-3 pt-1">
                  <SparkButton onClick={spark} burstKey={sparkCount} />
                  <div className="flex items-center gap-3">
                    <kbd className="hidden rounded-md bg-black/50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-ink-300 ring-1 ring-white/10 sm:inline">
                      ⌘/Ctrl ↵
                    </kbd>
                    <span aria-hidden className="h-6 w-px bg-white/10" />
                    <CharCounter state={counter} id={counterId} />
                  </div>
                </div>
              </div>
            </motion.div>

            <SpiceSelector spice={spice} onChange={chooseSpice} />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">
              <span className="relative flex size-2">
                <span className="absolute inset-0 animate-ping-soft rounded-full bg-[#ff9a3d]" />
                <span className="relative size-2 rounded-full bg-[#ff9a3d]" />
              </span>
              What the Arena sees
            </p>
            <TakeCard
              prompt={prompt}
              side={side}
              take={text}
              spice={spice}
              footer={<CardFooterCount take={text} />}
            />
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] px-4 pb-4 pt-2 sm:px-6 sm:pb-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:gap-6">
        <div ref={barScope} className="md:col-start-2">
          <SubmitButton ready={canSubmit} counter={counter} empty={trimmedEmpty} onSubmit={onSubmit} side={side} spice={spice} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function RotatingPlaceholder({ side }: { side: Side }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % PLACEHOLDERS.length), 2800);
    return () => clearInterval(id);
  }, []);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-x-5 top-4 z-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -6, filter: "blur(4px)", transition: { duration: 0.15 } }}
    >
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          className="font-display text-[19px] font-semibold leading-snug tracking-tight text-ink-400 sm:text-xl"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring.soft}
        >
          {PLACEHOLDERS[index]}
        </motion.p>
      </AnimatePresence>
      <p className="mt-1 text-xs font-medium text-ink-500">
        You&apos;re arguing <b style={{ color: SIDE_THEME[side].color }}>{SIDE_THEME[side].label}</b>. The crowd votes on the
        better argument, not who they agree with.
      </p>
    </motion.div>
  );
}

/** X-style circular counter: fills up, turns amber near the end, red past it. */
function CharCounter({ state, id }: { state: CounterState; id: string }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const color =
    state.tone === "over" ? "var(--color-danger)" : state.tone === "warn" ? "var(--color-gold)" : "var(--accent-from)";
  const size = state.showNumber ? 34 : 24;
  return (
    <div className="relative flex items-center justify-center" style={{ width: 34, height: 34 }}>
      <motion.div
        className="relative flex items-center justify-center rounded-full bg-black/55"
        animate={{ width: size, height: size }}
        transition={spring.bouncy}
      >
        <AnimatePresence>
          {state.showRing && (
            <motion.svg
              key="ring"
              viewBox="0 0 36 36"
              className="absolute inset-0 size-full -rotate-90"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: state.tone === "over" ? [1, 1.15, 1] : 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.3 }}
            >
              <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(255 255 255 / 0.12)" strokeWidth="3" />
              <motion.circle
                cx="18"
                cy="18"
                r={r}
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={c}
                initial={{ strokeDashoffset: c, stroke: color }}
                animate={{ strokeDashoffset: c * (1 - state.progress), stroke: color }}
                transition={spring.snappy}
              />
            </motion.svg>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {state.showNumber && (
            <motion.span
              key="n"
              className="relative font-mono text-[11px] font-bold tabular"
              style={{ color }}
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={spring.bouncy}
            >
              {state.remaining}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
      <span id={id} className="sr-only">
        {state.count} of {TAKE_LIMIT} characters
      </span>
      {/* Only speak up near or past the limit, not on every keystroke. */}
      <span className="sr-only" aria-live="polite">
        {state.tone === "over"
          ? `${-state.remaining} characters over the limit`
          : state.showNumber
            ? `${state.remaining} characters remaining`
            : ""}
      </span>
    </div>
  );
}

function SparkButton({ onClick, burstKey }: { onClick: () => void; burstKey: number }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className="relative inline-flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3 text-[13px] font-semibold text-ink-100 hover:bg-white/[0.1]"
    >
      <motion.span
        key={burstKey}
        aria-hidden
        initial={{ rotate: 0, scale: 1 }}
        animate={burstKey ? { rotate: [0, -25, 18, 0], scale: [1, 1.5, 1] } : {}}
        transition={{ duration: 0.45 }}
      >
        ✨
      </motion.span>
      Need a spark?
      {burstKey > 0 && <SparkBurst key={`b${burstKey}`} />}
    </motion.button>
  );
}

function SparkBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute left-4 top-1/2">
      {Array.from({ length: 7 }, (_, i) => {
        const angle = (i / 7) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.span
            key={i}
            className="absolute size-1.5 rounded-full"
            style={{ background: i % 2 ? "#ffd27a" : "#ff7ab8" }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * 26, y: Math.sin(angle) * 26, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </span>
  );
}

const SPICE_STYLE: Record<Spice, { bg: string; ink: string; glow: string }> = {
  1: { bg: "linear-gradient(135deg, #ffd27a, #ff9a3d)", ink: "#1a0c00", glow: "rgb(255 170 70 / 0.55)" },
  2: { bg: "linear-gradient(135deg, #ff9a3d, #ff3d6e)", ink: "#1a0008", glow: "rgb(255 100 70 / 0.6)" },
  3: { bg: "linear-gradient(135deg, #ff3d4e, #a3122d)", ink: "#fff5f5", glow: "rgb(255 50 70 / 0.75)" },
};

function SpiceSelector({ spice, onChange }: { spice: Spice; onChange: (spice: Spice) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + 3) % 3;
    onChange((next + 1) as Spice);
    refs.current[next]?.focus();
  };
  return (
    <div>
      <p id="spice-label" className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">
        Spice level
      </p>
      <div role="radiogroup" aria-labelledby="spice-label" className="glass grid grid-cols-3 gap-1 rounded-2xl p-1">
        {SPICE_LEVELS.map(({ level, label }, index) => {
          const active = level === spice;
          const style = SPICE_STYLE[level];
          return (
            <motion.button
              key={level}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(level)}
              onKeyDown={(e) => onKey(e, index)}
              whileTap={{ scale: 0.93 }}
              transition={spring.snappy}
              className={cn(
                "relative flex h-14 flex-col items-center justify-center rounded-xl text-ink-200 transition-colors",
                !active && "hover:bg-white/[0.05]",
              )}
            >
              {active && (
                <motion.span
                  layoutId="spice-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-xl"
                  style={{ background: style.bg, boxShadow: `0 8px 28px -8px ${style.glow}` }}
                  transition={spring.layout}
                />
              )}
              <motion.span
                aria-hidden
                className="relative flex text-[15px] leading-none"
                animate={active ? { scale: [1, 1.35, 1], rotate: [0, -10, 8, 0] } : { scale: 1, rotate: 0 }}
                transition={{ duration: 0.4 }}
              >
                {Array.from({ length: level }, (_, i) => (
                  <span key={i} className={cn(i > 0 && "-ml-1")}>
                    🌶️
                  </span>
                ))}
              </motion.span>
              <span
                className="relative mt-1 text-[12px] font-bold tracking-tight"
                style={{ color: active ? style.ink : undefined }}
              >
                {label}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function SubmitButton({
  ready,
  counter,
  empty,
  onSubmit,
  side,
  spice,
}: {
  ready: boolean;
  counter: CounterState;
  empty: boolean;
  onSubmit: () => void;
  side: Side;
  spice: Spice;
}) {
  const label = ready ? "Lock it in" : empty ? "Write your take to lock in" : `Cut ${-counter.remaining} to lock in`;
  return (
    <motion.button
      type="button"
      onClick={onSubmit}
      aria-disabled={!ready}
      whileHover={ready ? { scale: 1.015 } : undefined}
      whileTap={{ scale: ready ? 0.97 : 0.99 }}
      transition={spring.snappy}
      className={cn(
        "relative flex h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl font-display text-lg font-extrabold tracking-tight transition-[color,background,box-shadow] duration-300",
        ready ? "text-ink-950" : "glass text-ink-400",
      )}
      style={
        ready
          ? {
              background: "linear-gradient(110deg, var(--accent-from), var(--accent-to))",
              boxShadow: `0 16px 44px -14px var(--accent-to), 0 0 0 1px ${SIDE_THEME[side].color}33`,
            }
          : undefined
      }
    >
      {ready && (
        <motion.span
          aria-hidden
          className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/35 blur-md"
          initial={{ left: "-40%" }}
          animate={{ left: ["-40%", "140%"] }}
          transition={{ duration: spice === 3 ? 1.1 : 1.8, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" }}
        />
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={label}
          className="relative flex items-center gap-2"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -16, opacity: 0 }}
          transition={spring.snappy}
        >
          {ready && <span aria-hidden>🔒</span>}
          {label}
          {ready && spice === 3 && <span aria-hidden>🔥</span>}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}

function OpponentPill({ opponent, state }: { opponent?: PlayerInfo; state: OpponentState }) {
  if (!opponent) return null;
  const handle = `@${opponent.handle}`;
  return (
    <div className="flex h-7 items-center gap-2" aria-live="polite">
      <Avatar person={opponent} size={22} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={state}
          className="flex min-w-0 items-center gap-1.5 truncate text-[13px] text-ink-300"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={spring.snappy}
        >
          {state === "typing" && (
            <>
              <b className="truncate text-ink-100">{handle}</b> is typing <TypingDots />
            </>
          )}
          {state === "locked" && (
            <>
              <motion.span aria-hidden initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={spring.wobbly}>
                🔒
              </motion.span>
              <b className="truncate text-ink-100">{handle}</b> locked in their take
            </>
          )}
          {state === "earlier" && (
            <>
              <span aria-hidden>📨</span>
              <b className="truncate text-ink-100">{handle}</b> already made their case
            </>
          )}
          {state === "later" && (
            <>
              <b className="truncate text-ink-100">{handle}</b> will answer later
            </>
          )}
          {state === "idle" && (
            <>
              <b className="truncate text-ink-100">{handle}</b> is thinking…
            </>
          )}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export function TypingDots({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex items-center gap-[3px] rounded-full bg-white/10 px-1.5 py-1", className)}>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-[5px] rounded-full bg-ink-100"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

/** Isolated so the 60 fps countdown only re-renders the ring, not the composer. */
function ComposeTimer({ rule, onExpire }: { rule: TimerRule; onExpire: () => void }) {
  const remaining = useCountdown(rule.durationMs, true, onExpire);
  const seconds = Math.ceil(remaining / 1000);
  useEffect(() => {
    // Heartbeat for the last ten seconds of a hard clock.
    if (rule.hard && seconds > 0 && seconds <= 10) play("tick");
  }, [seconds, rule.hard]);
  const over = remaining <= 0;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <TimerRing
        fraction={remaining / rule.durationMs}
        size={52}
        label={over && !rule.hard ? "OT" : formatClock(remaining)}
        className="text-[13px]"
      />
      <span className="sr-only">{formatClock(remaining)} left</span>
    </div>
  );
}
