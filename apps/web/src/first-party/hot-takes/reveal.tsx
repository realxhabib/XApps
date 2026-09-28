"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { promptWords, revealTimeline } from "./logic";
import type { HotTakePrompt, Side } from "./prompts";
import { SIDE_THEME } from "./theme";

type Step = "typing" | "card" | "flipped";

/**
 * The opening act: the prompt types in word by word in huge type, a card
 * wobbles with anticipation and flips to reveal your side, and the stage
 * splits into FOR vs AGAINST. Auto-advances; the button lets you skip ahead.
 */
export function Reveal({
  prompt,
  side,
  me,
  opponent,
  onDone,
  onFlip,
}: {
  prompt: HotTakePrompt;
  side: Side;
  me: PlayerInfo;
  opponent?: PlayerInfo;
  onDone: () => void;
  onFlip?: () => void;
}) {
  const reduce = useReducedMotion() ?? false;
  const words = useMemo(() => promptWords(prompt.prompt), [prompt]);
  const timeline = useMemo(() => revealTimeline(words.length, reduce), [words.length, reduce]);
  const [shown, setShown] = useState(0);
  const [step, setStep] = useState<Step>("typing");
  const doneRef = useRef(onDone);
  const flipRef = useRef(onFlip);
  useEffect(() => {
    doneRef.current = onDone;
    flipRef.current = onFlip;
  });

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    words.forEach((_, i) =>
      at(450 + i * timeline.perWord, () => {
        setShown(i + 1);
        play("tick");
      }),
    );
    at(timeline.card, () => {
      setStep("card");
      play("whoosh");
    });
    at(timeline.flip, () => {
      setStep("flipped");
      play("slam");
      flipRef.current?.();
    });
    at(timeline.done, () => doneRef.current());
    return () => timers.forEach(clearTimeout);
  }, [words, timeline]);

  const theme = SIDE_THEME[side];
  const other: Side = side === "for" ? "against" : "for";
  const flipped = step === "flipped";

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden px-5 py-6">
      <SplitPanels show={flipped} side={side} other={other} me={me} opponent={opponent} />

      {/* Side-colored flash the moment the card lands face up. */}
      <AnimatePresence>
        {flipped && !reduce && (
          <motion.div
            key="flash"
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ background: `radial-gradient(circle at 50% 62%, ${theme.glow}, transparent 60%)` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.9, times: [0, 0.15, 1] }}
          />
        )}
      </AnimatePresence>

      <div className="relative z-10 flex w-full max-w-3xl flex-col items-center text-center">
        <motion.div
          aria-hidden
          className="text-[clamp(2.5rem,9vh,4.5rem)] leading-none drop-shadow-[0_0_28px_rgb(255_140_60/0.6)]"
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ ...spring.wobbly, delay: 0.1 }}
        >
          {prompt.emoji}
        </motion.div>
        <motion.p
          className="mt-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#ffb37a]"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 0.2 }}
        >
          Tonight&apos;s hot take
        </motion.p>
        <h1
          aria-label={prompt.prompt}
          className="mt-3 max-w-[18ch] text-balance font-display font-extrabold leading-[0.98] tracking-tight"
          style={{ fontSize: "clamp(1.9rem, min(9.5vw, 8vh), 4.6rem)", fontVariationSettings: "'wdth' 80" }}
        >
          {words.map((word, i) => (
            <motion.span
              key={`${word}-${i}`}
              aria-hidden
              className="relative mr-[0.22em] inline-block last:mr-0"
              initial={{ opacity: 0, y: "0.45em", scale: 0.8, filter: "blur(10px)" }}
              animate={i < shown ? { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" } : undefined}
              transition={spring.bouncy}
            >
              {word}
              {i === shown - 1 && step === "typing" && <Caret />}
            </motion.span>
          ))}
        </h1>

        <div className="mt-[clamp(1rem,4vh,2.25rem)] h-[clamp(6.5rem,19vh,9rem)] w-[min(20rem,84vw)] [perspective:1100px]">
          <AnimatePresence>
            {step !== "typing" && (
              <motion.div
                key="card"
                className="size-full"
                initial={{ y: 70, opacity: 0, rotateX: 35, scale: 0.9 }}
                animate={
                  flipped || reduce
                    ? { y: 0, opacity: 1, rotateX: 0, scale: 1, rotateZ: 0 }
                    : { y: 0, opacity: 1, rotateX: 0, scale: 1, rotateZ: [0, -2.5, 2.5, -1.5, 1.5, 0] }
                }
                transition={
                  flipped
                    ? spring.soft
                    : { ...spring.soft, rotateZ: { duration: 0.6, repeat: Infinity, repeatDelay: 0.05, ease: "easeInOut" } }
                }
                style={{ transformStyle: "preserve-3d" }}
              >
                <motion.div
                  className="relative size-full"
                  style={{ transformStyle: "preserve-3d" }}
                  initial={{ rotateY: 0 }}
                  animate={{ rotateY: flipped ? 180 : 0, scale: flipped ? [1, 1.12, 1] : 1 }}
                  transition={{ rotateY: { type: "spring", stiffness: 160, damping: 14 }, scale: { duration: 0.5 } }}
                >
                  <CardBack />
                  <CardFront side={side} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-[clamp(0.75rem,3vh,1.75rem)] h-12">
          <AnimatePresence>
            {flipped && (
              <motion.button
                key="go"
                type="button"
                onClick={() => {
                  play("pop");
                  doneRef.current();
                }}
                initial={{ opacity: 0, y: 14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...spring.bouncy, delay: 0.35 }}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.94 }}
                className="relative h-12 overflow-hidden rounded-full px-7 font-display text-base font-extrabold tracking-tight"
                style={{ background: theme.color, color: theme.ink, boxShadow: `0 14px 40px -12px ${theme.glow}` }}
              >
                <span className="relative z-10">Make your case →</span>
                {/* Auto-advance progress: a thin fuse burning along the bottom. */}
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className="absolute bottom-0 left-0 h-[3px] rounded-full bg-black/35"
                    initial={{ width: "0%" }}
                    animate={{ width: "100%" }}
                    transition={{ duration: (timeline.done - timeline.flip) / 1000, ease: "linear" }}
                  />
                )}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">
        {flipped ? `You argue ${theme.label}.` : ""}
      </p>
    </div>
  );
}

function Caret() {
  return (
    <motion.span
      aria-hidden
      className="absolute -right-[0.14em] top-[0.12em] h-[0.82em] w-[0.07em] rounded-full bg-[linear-gradient(var(--accent-from),var(--accent-to))]"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 0.8, repeat: Infinity, times: [0, 0.5, 0.5, 1] }}
    />
  );
}

const faceBase =
  "absolute inset-0 flex flex-col items-center justify-center overflow-hidden rounded-3xl [backface-visibility:hidden] [-webkit-backface-visibility:hidden]";

function CardBack() {
  return (
    <div
      className={`${faceBase} border border-white/10`}
      style={{
        background:
          "repeating-linear-gradient(135deg, rgb(255 154 61 / 0.14) 0 10px, rgb(255 61 110 / 0.1) 10px 20px), linear-gradient(160deg, #1d1420, #0d0a12)",
        boxShadow: "0 20px 60px -20px rgb(255 100 60 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.08)",
      }}
    >
      <span className="shimmer-bg absolute inset-0" />
      <span className="relative font-display text-[clamp(2rem,7vh,3rem)] font-extrabold text-white/90">?</span>
      <span className="relative mt-1 text-[11px] font-bold uppercase tracking-[0.3em] text-ink-200">Your side is…</span>
    </div>
  );
}

function CardFront({ side }: { side: Side }) {
  const theme = SIDE_THEME[side];
  return (
    <div
      className={faceBase}
      style={{
        transform: "rotateY(180deg)",
        background: `radial-gradient(circle at 50% 0%, ${theme.color}40, transparent 65%), linear-gradient(160deg, #15171f, #07080c)`,
        border: `2px solid ${theme.color}`,
        boxShadow: `0 0 0 6px ${theme.color}1f, 0 24px 70px -18px ${theme.glow}`,
      }}
    >
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-ink-200">You argue</span>
      <span
        className="mt-0.5 font-display font-extrabold leading-none tracking-tight"
        style={{
          color: theme.color,
          fontSize: side === "for" ? "clamp(2.6rem, 9vh, 3.75rem)" : "clamp(2rem, 7.5vh, 3.1rem)",
          textShadow: `0 0 30px ${theme.glow}`,
          fontVariationSettings: "'wdth' 75",
        }}
      >
        {theme.label}
      </span>
    </div>
  );
}

/**
 * Split-screen: your half slides in from the left in your color, the
 * opponent's from the right in theirs, with a glowing seam and "VS".
 */
function SplitPanels({
  show,
  side,
  other,
  me,
  opponent,
}: {
  show: boolean;
  side: Side;
  other: Side;
  me: PlayerInfo;
  opponent?: PlayerInfo;
}) {
  const mine = SIDE_THEME[side];
  const theirs = SIDE_THEME[other];
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="split" aria-hidden className="pointer-events-none absolute inset-0">
          <motion.div
            className="absolute inset-y-0 left-0 w-[54%]"
            style={{
              background: `linear-gradient(90deg, ${mine.color}2e, ${mine.color}0a 70%, transparent)`,
              clipPath: "polygon(0 0, 100% 0, 88% 100%, 0 100%)",
            }}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            transition={spring.soft}
          >
            <PanelLabel player={me} label={mine.label} color={mine.color} align="left" />
          </motion.div>
          <motion.div
            className="absolute inset-y-0 right-0 w-[54%]"
            style={{
              background: `linear-gradient(270deg, ${theirs.color}24, ${theirs.color}08 70%, transparent)`,
              clipPath: "polygon(12% 0, 100% 0, 100% 100%, 0 100%)",
            }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            transition={spring.soft}
          >
            {opponent && <PanelLabel player={opponent} label={theirs.label} color={theirs.color} align="right" />}
          </motion.div>
          {/* The seam */}
          <motion.div
            className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 rotate-[6.5deg]"
            style={{
              background: "linear-gradient(180deg, transparent, #fff 20%, var(--accent-to) 50%, #fff 80%, transparent)",
              // Break the seam where the prompt and card sit so it frames them instead of striking through.
              maskImage: "linear-gradient(180deg, #000 0 22%, transparent 30% 76%, #000 84%)",
              WebkitMaskImage: "linear-gradient(180deg, #000 0 22%, transparent 30% 76%, #000 84%)",
            }}
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: 1, opacity: 0.55 }}
            transition={{ ...spring.soft, delay: 0.1 }}
          />
          <motion.div
            className="absolute left-1/2 top-[calc(100%-4.25rem)] -translate-x-1/2 font-display text-2xl font-extrabold italic tracking-tight text-white"
            style={{ textShadow: "0 0 24px var(--accent-to)" }}
            initial={{ scale: 3, opacity: 0, rotate: -20 }}
            animate={{ scale: 1, opacity: 1, rotate: -6 }}
            transition={{ ...spring.bouncy, delay: 0.25 }}
          >
            VS
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PanelLabel({
  player,
  label,
  color,
  align,
}: {
  player: PlayerInfo;
  label: string;
  color: string;
  align: "left" | "right";
}) {
  const left = align === "left";
  return (
    <div className={`absolute bottom-4 flex items-center gap-2 ${left ? "left-4 flex-row" : "right-4 flex-row-reverse"}`}>
      <Avatar person={player} size={32} />
      <div className={left ? "text-left" : "text-right"}>
        <p className="max-w-[28vw] truncate text-xs font-semibold text-ink-100">@{player.handle}</p>
        <p className="font-display text-sm font-extrabold tracking-[0.1em]" style={{ color }}>
          {label}
        </p>
      </div>
    </div>
  );
}
