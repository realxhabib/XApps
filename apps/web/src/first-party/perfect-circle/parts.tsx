"use client";

import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { REJECTION_TEXT, accuracyColor, formatAccuracy, verdictFor, type Point, type Rejection } from "./logic";
import { CARD_H, CARD_W, canvasBlob, drawShareCard } from "./render";

/* ---------------------------------------------------------------------- */
/* Numbers                                                                */
/* ---------------------------------------------------------------------- */

/** A percentage that counts up (springs) to `value`. */
export function CountUp({ value, from = 0, className }: { value: number; from?: number; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useSpring(reduce ? value : from, { stiffness: 90, damping: 20, mass: 0.8 });
  const text = useTransform(mv, (v) => `${(Math.floor(v * 10 + 1e-6) / 10).toFixed(1)}%`);
  useEffect(() => {
    mv.set(value);
  }, [mv, value]);
  return <motion.span className={className}>{text}</motion.span>;
}

/* ---------------------------------------------------------------------- */
/* Board overlays                                                         */
/* ---------------------------------------------------------------------- */

/** The big score in the middle of the board after a scored circle. */
export function ScoreOverlay({ accuracy, isBest, n }: { accuracy: number; isBest: boolean; n: number }) {
  const verdict = verdictFor(accuracy);
  const color = accuracyColor(accuracy);
  return (
    <motion.div
      key={`score-${n}`}
      className="absolute inset-x-0 top-[57%] flex flex-col items-center"
      initial={{ opacity: 0, scale: 0.5, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      transition={spring.wobbly}
    >
      <span
        className="font-display text-[clamp(40px,13vmin,84px)] font-extrabold leading-none tracking-tight tabular"
        style={{ color, textShadow: `0 0 36px ${color}66` }}
      >
        <CountUp value={accuracy} from={Math.max(0, accuracy - 18)} />
      </span>
      <motion.span
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.bouncy, delay: 0.35 }}
        className="mt-1.5 flex items-center gap-2 text-sm font-bold text-ink-100 sm:text-base"
      >
        <span>
          {verdict.word} <span aria-hidden>{verdict.emoji}</span>
        </span>
        {isBest && n > 1 && (
          <motion.span
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...spring.wobbly, delay: 0.55 }}
            className="rounded-full bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] px-2 py-0.5 font-mono text-[10px] font-black uppercase tracking-wider text-ink-950"
          >
            Best yet
          </motion.span>
        )}
      </motion.span>
    </motion.div>
  );
}

export function RejectOverlay({ reason, id }: { reason: Rejection; id: number }) {
  const text = REJECTION_TEXT[reason];
  return (
    <motion.div
      key={`reject-${id}`}
      className="absolute inset-x-6 top-[57%] flex flex-col items-center text-center"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={spring.bouncy}
      role="status"
    >
      <span className="font-display text-[clamp(26px,7vmin,40px)] font-extrabold leading-none tracking-tight text-danger">
        {text.title}
      </span>
      <span className="mt-2 max-w-[18rem] text-balance text-xs font-medium text-ink-300 sm:text-sm">
        {text.hint} This one doesn&apos;t count.
      </span>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Recent circles                                                         */
/* ---------------------------------------------------------------------- */

/** This sitting's latest circles as score pips (oldest left); the best one glows. */
export function RecentPips({ scores, bestIndex, max = 5 }: { scores: number[]; bestIndex: number; max?: number }) {
  const from = Math.max(0, scores.length - max);
  const shown = scores.slice(from);
  if (shown.length === 0) return null;
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Your last ${shown.length === 1 ? "circle" : `${shown.length} circles`}`}>
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((score, i) => {
          const index = from + i;
          const best = index === bestIndex;
          const color = accuracyColor(score);
          return (
            <motion.li
              key={index}
              layout
              initial={{ scale: 0, rotate: -30, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
              transition={spring.wobbly}
              className={cn(
                "flex h-7 min-w-7 items-center justify-center rounded-full px-2 font-mono text-[11px] font-bold tabular ring-1",
                best ? "ring-2" : "ring-white/15",
              )}
              style={{
                color,
                background: `color-mix(in oklab, ${color} ${best ? 22 : 10}%, transparent)`,
                ["--tw-ring-color" as string]: best ? color : undefined,
              }}
            >
              {score.toFixed(1)}
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

/* ---------------------------------------------------------------------- */
/* Share sheet                                                            */
/* ---------------------------------------------------------------------- */

export function ShareSheet({
  open,
  accuracy,
  stroke,
  handle,
  accent,
  onPost,
  onClose,
}: {
  open: boolean;
  accuracy: number;
  stroke: Point[];
  handle: string | null;
  accent: [string, string];
  onPost: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="share"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/70 p-3 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Share your circle"
            className="glass-strong w-full max-w-lg rounded-3xl p-3 sm:p-4"
            initial={{ y: 60, scale: 0.94, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 40, scale: 0.96, opacity: 0, transition: { duration: 0.15 } }}
            transition={spring.soft}
            onClick={(e) => e.stopPropagation()}
          >
            <SharePreview accuracy={accuracy} stroke={stroke} handle={handle} accent={accent} />
            <div className="mt-3 flex gap-2">
              <motion.button
                type="button"
                whileTap={{ scale: 0.95 }}
                transition={spring.snappy}
                onClick={onPost}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink-50 text-sm font-bold text-ink-950 hover:bg-white"
              >
                <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                  <path
                    fill="currentColor"
                    d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"
                  />
                </svg>
                Post on X
              </motion.button>
              <SaveButton accuracy={accuracy} stroke={stroke} handle={handle} accent={accent} />
            </div>
            <button type="button" onClick={onClose} className="mt-2 h-9 w-full text-xs font-semibold text-ink-300 hover:text-ink-50">
              Close
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SharePreview({ accuracy, stroke, handle, accent }: { accuracy: number; stroke: Point[]; handle: string | null; accent: [string, string] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawShareCard(canvas, { accuracy, stroke, handle, accent });
    // Redraw once web fonts are in (the first paint may use fallbacks).
    let live = true;
    document.fonts?.ready.then(() => {
      if (live) drawShareCard(canvas, { accuracy, stroke, handle, accent });
    });
    return () => {
      live = false;
    };
  }, [accuracy, stroke, handle, accent]);
  return (
    <motion.div
      initial={reduce ? false : { rotate: -2, scale: 0.96 }}
      animate={{ rotate: 0, scale: 1 }}
      transition={spring.wobbly}
      className="overflow-hidden rounded-2xl ring-1 ring-white/10"
    >
      <canvas
        ref={canvasRef}
        width={CARD_W}
        height={CARD_H}
        className="block h-auto w-full"
        role="img"
        aria-label={`Share card: a ${formatAccuracy(accuracy)} perfect circle`}
      />
    </motion.div>
  );
}

function SaveButton({ accuracy, stroke, handle, accent }: { accuracy: number; stroke: Point[]; handle: string | null; accent: [string, string] }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const canvas = document.createElement("canvas");
    drawShareCard(canvas, { accuracy, stroke, handle, accent });
    const blob = await canvasBlob(canvas);
    setBusy(false);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `perfect-circle-${accuracy.toFixed(1)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      transition={spring.snappy}
      disabled={busy}
      onClick={save}
      className="h-12 rounded-full border border-white/15 px-5 text-sm font-bold text-ink-50 hover:bg-white/[0.06] disabled:opacity-50"
    >
      Save image
    </motion.button>
  );
}
