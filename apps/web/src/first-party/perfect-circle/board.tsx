"use client";

import { AnimatePresence, motion, useAnimate, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { drawInk } from "./render";
import {
  BOARD,
  CENTER,
  MAX_DRAW_MS,
  accuracyColor,
  analyzeStroke,
  inkColor,
  liveAccuracy,
  radialStats,
  roundness,
  segmentError,
  sweepOf,
  type Analysis,
  type Point,
} from "./logic";

/** Strokes shorter than this (board units) are taps, not attempts: ignored. */
const TAP_LENGTH = 24;

/**
 * The input's own timestamp when it's sane, else "now". Coalesced and
 * synthesized events don't always share `performance.now()`'s time origin.
 */
function eventTime(stamp: number): number {
  const now = performance.now();
  return stamp > 0 && stamp <= now + 1 && now - stamp < 1000 ? stamp : now;
}

/** What the ink layer shows when nobody is drawing. */
export type InkState =
  | { kind: "empty" }
  | { kind: "scored"; stroke: Point[]; id: number }
  | { kind: "rejected"; stroke: Point[]; id: number };

interface BoardProps {
  /** Accepts new strokes. */
  enabled: boolean;
  ink: InkState;
  /** Shown over the board's center while nobody is drawing (scores, messages). */
  overlay?: ReactNode;
  /** First-ever stroke hint ("Draw a circle around the dot"). */
  hint?: boolean;
  onStart?: () => void;
  onStroke: (analysis: Analysis) => void;
  className?: string;
}

/**
 * The square drawing board: a dot in the middle, one continuous stroke with
 * pointer events (mouse, touch, pen), ink coloured by local accuracy, a live
 * % readout and a sweep ring that fills as you go round. It finishes the
 * stroke itself at a full turn, when it's too slow, or when the pointer lifts.
 */
export function Board({ enabled, ink, overlay, hint, onStart, onStroke, className }: BoardProps) {
  const reduce = useReducedMotion() ?? false;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [scope, animate] = useAnimate<HTMLDivElement>();

  const points = useRef<Point[]>([]);
  const sweep = useRef(0);
  const pointerId = useRef<number | null>(null);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef(0);
  const inkRef = useRef<InkState>(ink);

  // Live readout + sweep ring, driven outside React renders.
  const live = useMotionValue(-1);
  const liveText = useTransform(live, (v) => (v < 0 ? "" : `${v.toFixed(1)}%`));
  const liveColor = useTransform(live, (v) => (v < 0 ? "#f6f7fb" : accuracyColor(v)));
  const ring = useMotionValue(0);
  const [ringStart, setRingStart] = useState({ deg: -90, ccw: false });

  /* Painting ----------------------------------------------------------- */

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const px = canvas.width;
    ctx.clearRect(0, 0, px, canvas.height);
    const width = Math.max(3, px / 95);
    if (pointerId.current !== null) {
      // Live: every segment coloured against the radius so far, so the ink settles as you go.
      const pts = points.current;
      const { radius } = radialStats(pts);
      const scale = px / BOARD;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = width;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const color = pts.length > 6 ? inkColor(segmentError(a, b, radius)) : "#f6f7fb";
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = width * 1.2;
        ctx.beginPath();
        ctx.moveTo(a.x * scale, a.y * scale);
        ctx.lineTo(b.x * scale, b.y * scale);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      return;
    }
    const shown = inkRef.current;
    if (shown.kind === "empty") return;
    if (shown.kind === "rejected") {
      ctx.globalAlpha = 0.35;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = width;
      ctx.strokeStyle = "#ff4d5e";
      ctx.beginPath();
      shown.stroke.forEach((p, i) => {
        const x = (p.x / BOARD) * px;
        const y = (p.y / BOARD) * px;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    drawInk(ctx, shown.stroke, 0, 0, px, { width, ideal: false });
  };

  const schedule = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  };

  // Keep the canvas matched to its box (device pixels) and repaint.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const rect = box.getBoundingClientRect();
      const s = Math.floor(Math.min(rect.width, rect.height));
      setSize(s);
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(3, window.devicePixelRatio || 1);
        canvas.width = Math.round(s * dpr);
        canvas.height = Math.round(s * dpr);
        paint();
      }
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    inkRef.current = ink;
    if (pointerId.current === null) schedule();
    // schedule only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ink]);

  useEffect(
    () => () => {
      // Reset too: StrictMode remounts, and a stale id would block every later frame.
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (slowTimer.current) clearTimeout(slowTimer.current);
      slowTimer.current = null;
    },
    [],
  );

  /* Input -------------------------------------------------------------- */

  const toBoard = (clientX: number, clientY: number, stamp: number): Point | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return { x: ((clientX - rect.left) / rect.width) * BOARD, y: ((clientY - rect.top) / rect.height) * BOARD, t: eventTime(stamp) };
  };

  const finish = () => {
    if (pointerId.current === null) return;
    const id = pointerId.current;
    pointerId.current = null;
    if (slowTimer.current) clearTimeout(slowTimer.current);
    slowTimer.current = null;
    try {
      canvasRef.current?.releasePointerCapture(id);
    } catch {
      // already released
    }
    setDrawing(false);
    live.set(-1);
    ring.set(0);
    const pts = points.current;
    points.current = [];
    if (radialStats(pts).length < TAP_LENGTH) {
      schedule();
      return;
    }
    const analysis = analyzeStroke(pts);
    if (!analysis.ok && !reduce && scope.current) {
      animate(scope.current, { x: [0, -14, 12, -8, 5, -2, 0] }, { duration: 0.42, ease: "easeOut" });
    }
    onStroke(analysis);
    schedule();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!enabled || pointerId.current !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = toBoard(e.clientX, e.clientY, e.timeStamp);
    if (!p) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured; the board still works
    }
    pointerId.current = e.pointerId;
    points.current = [p];
    sweep.current = 0;
    setDrawing(true);
    setRingStart({ deg: (Math.atan2(p.y - CENTER.y, p.x - CENTER.x) * 180) / Math.PI, ccw: false });
    slowTimer.current = setTimeout(() => {
      // Held still past the limit: stamp "now" on the stroke so it reads as too slow.
      const last = points.current[points.current.length - 1];
      if (last) points.current.push({ ...last, t: performance.now() });
      finish();
    }, MAX_DRAW_MS + 60);
    onStart?.();
    schedule();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerId.current !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const batch = events.length > 0 ? events : [e.nativeEvent];
    const pts = points.current;
    for (const ev of batch) {
      const p = toBoard(ev.clientX, ev.clientY, ev.timeStamp);
      const prev = pts[pts.length - 1];
      if (!p || !prev || (p.x === prev.x && p.y === prev.y)) continue;
      pts.push(p);
      sweep.current += sweepOf([prev, p]);
      if (Math.abs(sweep.current) >= Math.PI * 2 || p.t - pts[0]!.t > MAX_DRAW_MS) break;
    }
    const turn = Math.abs(sweep.current) / (Math.PI * 2);
    ring.set(Math.min(1, turn));
    if (sweep.current < -0.2 !== ringStart.ccw && Math.abs(sweep.current) > 0.2) {
      setRingStart((r) => ({ ...r, ccw: sweep.current < 0 }));
    }
    const acc = liveAccuracy(pts);
    live.set(acc ?? -1);
    schedule();
    const last = pts[pts.length - 1]!;
    if (turn >= 1 || last.t - pts[0]!.t > MAX_DRAW_MS) finish();
  };

  return (
    <div ref={boxRef} className={cn("relative flex min-h-0 w-full items-center justify-center", className)}>
      <div ref={scope} className="relative" style={{ width: size, height: size }}>
        {/* Board surface */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-[9%] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_45%,rgb(255_255_255/0.06),rgb(255_255_255/0.015)_70%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_30px_80px_-40px_var(--accent-to)]"
        />
        {/* Sweep ring: fills as the stroke goes round, starting where it started. */}
        <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full">
          <g transform={`rotate(${ringStart.deg} 50 50)${ringStart.ccw ? " scale(1 -1) translate(0 -100)" : ""}`}>
            <circle
              cx="50"
              cy="50"
              r="48.2"
              fill="none"
              stroke="rgb(255 255 255 / 0.06)"
              strokeWidth="0.8"
              style={{ opacity: drawing ? 1 : 0, transition: "opacity 200ms" }}
            />
            <motion.circle
              cx="50"
              cy="50"
              r="48.2"
              fill="none"
              stroke="url(#pc-ring)"
              strokeWidth="0.9"
              strokeLinecap="round"
              style={{ pathLength: ring, opacity: drawing ? 1 : 0 }}
            />
          </g>
          <defs>
            <linearGradient id="pc-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--accent-from)" />
              <stop offset="1" stopColor="var(--accent-to)" />
            </linearGradient>
          </defs>
        </svg>

        <canvas
          ref={canvasRef}
          aria-label={enabled ? "Drawing board: draw one circle around the dot" : "Drawing board"}
          role="img"
          className={cn("absolute inset-0 size-full touch-none select-none", enabled ? "cursor-crosshair" : "cursor-default")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onContextMenu={(e) => e.preventDefault()}
        />

        {ink.kind === "scored" && !drawing && <IdealCircle key={ink.id} stroke={ink.stroke} reduce={reduce} />}

        {/* The dot */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.span
            className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent-from)]"
            animate={reduce || drawing ? { opacity: 0 } : { scale: [1, 2.6], opacity: [0.35, 0] }}
            transition={reduce || drawing ? { duration: 0.2 } : { duration: 1.8, repeat: Infinity, ease: "easeOut" }}
          />
          <motion.span
            className="block size-3 rounded-full bg-ink-50 shadow-[0_0_14px_rgb(255_255_255/0.7)]"
            animate={{ scale: drawing ? 0.8 : 1 }}
            transition={spring.bouncy}
          />
        </div>

        {/* Live readout */}
        <div className="pointer-events-none absolute inset-x-0 top-[58%] flex justify-center" aria-hidden>
          <motion.span
            className="font-display font-extrabold leading-none tracking-tight tabular"
            style={{ color: liveColor, fontSize: Math.max(28, size * 0.12) }}
          >
            {liveText}
          </motion.span>
        </div>

        {/* First-stroke hint */}
        <AnimatePresence>
          {hint && !drawing && (
            <motion.div
              key="hint"
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <svg aria-hidden viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
                <motion.circle
                  cx="50"
                  cy="50"
                  r="30"
                  fill="none"
                  stroke="rgb(255 255 255 / 0.22)"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                  strokeDasharray={reduce ? "1.5 2.5" : undefined}
                  initial={{ pathLength: reduce ? 1 : 0 }}
                  animate={reduce ? { pathLength: 1 } : { pathLength: [0, 1, 1], opacity: [1, 1, 0] }}
                  transition={reduce ? { duration: 0 } : { duration: 2.4, times: [0, 0.7, 1], repeat: Infinity, repeatDelay: 0.4, ease: "easeInOut" }}
                />
              </svg>
              <p className="absolute inset-x-0 top-[62%] text-center text-sm font-semibold text-ink-200">
                Draw a circle around the dot
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result / message overlay */}
        <div className="pointer-events-none absolute inset-0">
          <AnimatePresence>{!drawing && overlay}</AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/** The circle they were aiming for (mean radius), traced in after a scored stroke, plus a pulse. */
function IdealCircle({ stroke, reduce }: { stroke: Point[]; reduce: boolean }) {
  const first = stroke[0];
  const { radius, deviation } = radialStats(stroke);
  if (!first || radius <= 0) return null;
  const r = (radius / BOARD) * 100;
  const deg = (Math.atan2(first.y - CENTER.y, first.x - CENTER.x) * 180) / Math.PI;
  const ccw = sweepOf(stroke) < 0;
  const color = accuracyColor(100 * roundness(deviation));
  return (
    <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <g transform={`rotate(${deg} 50 50)${ccw ? " scale(1 -1) translate(0 -100)" : ""}`}>
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="rgb(255 255 255 / 0.3)"
          strokeWidth="0.35"
          initial={{ pathLength: reduce ? 1 : 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { duration: 0.8, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        />
      </g>
      {!reduce && (
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          style={{ transformOrigin: "50px 50px" }}
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 1.18, opacity: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />
      )}
    </svg>
  );
}
