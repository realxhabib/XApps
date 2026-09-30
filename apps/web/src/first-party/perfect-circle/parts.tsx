"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { circleArt } from "./card";
import { ATTEMPTS, PERFECT, REJECTION_TEXT, accuracyColor, formatAccuracy, resample, verdictFor, type Point, type Rejection } from "./logic";
import { CARD_H, CARD_W, canvasBlob, drawShareCard } from "./render";
import type { TableRow } from "./table";

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
            New best
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
/* Attempt pips                                                           */
/* ---------------------------------------------------------------------- */

/** One pip per attempt: empty, current (breathing) or its score; the best one glows. */
export function AttemptPips({ scores, bestIndex, active }: { scores: number[]; bestIndex: number; active: boolean }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Circles: ${scores.length} of ${ATTEMPTS} drawn`}>
      {Array.from({ length: ATTEMPTS }, (_, i) => {
        const score = scores[i];
        const current = active && i === scores.length;
        const best = i === bestIndex;
        return (
          <li key={i} className="relative">
            <motion.div
              layout
              className={cn(
                "flex h-7 min-w-7 items-center justify-center rounded-full px-2 font-mono text-[11px] font-bold tabular ring-1",
                score === undefined ? "ring-white/10" : best ? "ring-2" : "ring-white/15",
              )}
              style={
                score === undefined
                  ? undefined
                  : {
                      color: accuracyColor(score),
                      background: `color-mix(in oklab, ${accuracyColor(score)} ${best ? 22 : 10}%, transparent)`,
                      ["--tw-ring-color" as string]: best ? accuracyColor(score) : undefined,
                    }
              }
              animate={current ? { scale: [1, 1.12, 1] } : { scale: 1 }}
              transition={current ? { duration: 1.4, repeat: Infinity } : spring.bouncy}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {score === undefined ? (
                  <motion.span key="empty" className={cn("size-1.5 rounded-full", current ? "bg-ink-100" : "bg-white/20")} />
                ) : (
                  <motion.span
                    key="score"
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={spring.wobbly}
                  >
                    {score.toFixed(1)}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------------- */
/* Mini circles (the rest of the table)                                   */
/* ---------------------------------------------------------------------- */

/** A small rendition of someone's circle; it traces itself in when it arrives. */
export function MiniCircle({ stroke, size = 40, className }: { stroke: Point[] | null; size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const art = useMemo(() => (stroke ? circleArt(resample(stroke, 49), 100, 48) : null), [stroke]);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden>
      <rect width="100" height="100" rx="22" fill="rgb(255 255 255 / 0.05)" />
      {art && (
        <motion.g
          key={art.segments.length ? `${art.segments[0]!.x1}:${art.segments[0]!.y1}` : "none"}
          initial={reduce ? false : { opacity: 0, scale: 0.6, rotate: -60 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          style={{ transformOrigin: "50px 50px" }}
          transition={spring.bouncy}
        >
          {art.segments.map((s, i) => (
            <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth="6" strokeLinecap="round" />
          ))}
        </motion.g>
      )}
      <circle cx="50" cy="50" r="4" fill="#f6f7fb" opacity={art ? 0.9 : 0.4} />
    </svg>
  );
}

function PencilDots() {
  return (
    <span className="inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1 rounded-full bg-ink-200"
          animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.12 }}
        />
      ))}
    </span>
  );
}

function rowStatus(row: TableRow): string {
  if (row.done && row.best !== null) return "done";
  if (row.kind === "async" && !row.done) return "plays later";
  if (row.drawing) return "drawing";
  if (row.kind === "live" && !row.online) return "away";
  return `${row.scores.length}/${ATTEMPTS}`;
}

/** Everyone else at the table: their best circle and score, live. */
export function TableStrip({ rows, className }: { rows: TableRow[]; className?: string }) {
  if (rows.length === 0) return null;
  return (
    <ul
      className={cn("no-scrollbar mx-auto flex w-fit max-w-full gap-2 overflow-x-auto px-0.5 py-1 [scroll-snap-type:x_proximity]", className)}
      aria-label="The rest of the table"
    >
      {rows.map((row, i) => (
        <motion.li
          key={row.player.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.bouncy, delay: 0.1 + i * 0.05 }}
          className="glass flex shrink-0 items-center gap-2 rounded-2xl py-1.5 pl-1.5 pr-3 [scroll-snap-align:start]"
        >
          <div className="relative">
            <MiniCircle stroke={row.bestStroke} size={38} />
            <Avatar person={row.player} size={18} className="absolute -bottom-1 -right-1 ring-2 ring-ink-950 rounded-full" />
          </div>
          <div className="min-w-0">
            <p className="max-w-[7.5rem] truncate text-[11px] font-bold text-ink-200">
              {row.player.isBot ? row.player.name : `@${row.player.handle}`}
            </p>
            <div className="flex h-5 items-center gap-1.5">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={row.best ?? "none"}
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={spring.wobbly}
                  className="font-display text-base font-extrabold leading-none tabular"
                  style={{ color: row.best === null ? "var(--color-ink-400)" : accuracyColor(row.best) }}
                >
                  {row.best === null ? "—" : formatAccuracy(row.best)}
                </motion.span>
              </AnimatePresence>
              <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-ink-400">
                {row.drawing ? <PencilDots /> : rowStatus(row)}
              </span>
            </div>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------------- */
/* Final standings                                                        */
/* ---------------------------------------------------------------------- */

export interface Standing {
  player: PlayerInfo;
  best: number | null;
  stroke: Point[] | null;
  done: boolean;
  me: boolean;
}

export function Standings({ rows }: { rows: Standing[] }) {
  const sorted = [...rows].sort((a, b) => (b.best ?? -1) - (a.best ?? -1));
  return (
    <ol className="flex w-full flex-col gap-1.5" aria-label="Standings">
      <AnimatePresence initial={false}>
        {sorted.map((row, i) => (
          <motion.li
            layout
            key={row.player.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={spring.layout}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ring-1",
              row.me ? "bg-white/[0.08] ring-white/15" : "bg-white/[0.03] ring-white/[0.06]",
            )}
          >
            <span className="w-4 text-center font-mono text-xs font-bold text-ink-400 tabular">{row.best === null ? "·" : i + 1}</span>
            <MiniCircle stroke={row.stroke} size={30} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
              {row.me ? "You" : row.player.isBot ? row.player.name : `@${row.player.handle}`}
            </span>
            <span
              className="font-display text-base font-extrabold tabular"
              style={{ color: row.best === null ? "var(--color-ink-400)" : accuracyColor(row.best) }}
            >
              {row.best === null ? (row.done ? "—" : <PencilDots />) : formatAccuracy(row.best)}
            </span>
            {row.best !== null && row.best >= PERFECT && <span aria-label="perfect">⭕</span>}
          </motion.li>
        ))}
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
