"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { VIEW, clampToView, type Point } from "./board";
import { BoardDartShape, DartShadow, tailFor } from "./dart";
import type { DartTone } from "./logic";
import { paintBoard } from "./render";

/** Darts are drawn larger than life so they read on a phone (the tip still marks the exact spot). */
const DART_SCALE = 1.65;

export interface StuckDart {
  key: string;
  at: Point;
  color: string;
  spin: number;
  /** Just landed: wobbles in. */
  fresh: boolean;
}

export interface Pop {
  id: number;
  at: Point;
  label: string;
  points: number;
  tone: DartTone;
}

export interface Flight {
  id: number;
  at: Point;
  /** Where it was released, px relative to the landing point. */
  from: { x: number; y: number };
  ms: number;
  color: string;
  spin: number;
}

/** Board mm → px inside a board of `size` px. */
export function toPx(p: Point, size: number): { x: number; y: number } {
  const s = size / (2 * VIEW);
  return { x: (p.x + VIEW) * s, y: (p.y + VIEW) * s };
}

const TONE_CLASS: Record<DartTone, string> = {
  bull: "text-[#ff4d5e] [text-shadow:0_0_18px_rgb(255_77_94/0.9),0_2px_0_rgb(0_0_0/0.6)]",
  treble: "text-gold [text-shadow:0_0_16px_rgb(255_201_61/0.85),0_2px_0_rgb(0_0_0/0.6)]",
  double: "text-success [text-shadow:0_0_14px_rgb(55_227_155/0.8),0_2px_0_rgb(0_0_0/0.6)]",
  single: "text-ink-50 [text-shadow:0_2px_0_rgb(0_0_0/0.7),0_0_10px_rgb(0_0_0/0.8)]",
  miss: "text-ink-300 [text-shadow:0_2px_0_rgb(0_0_0/0.7)]",
};

export function BoardView({
  size,
  darts,
  holes,
  pops,
  flight,
  reticleRef,
  aiming,
  pulling,
  reduced,
  onPopDone,
  label,
}: {
  size: number;
  darts: StuckDart[];
  holes: Point[];
  pops: Pop[];
  flight: Flight | null;
  reticleRef?: RefObject<HTMLDivElement | null>;
  aiming: boolean;
  pulling: boolean;
  reduced: boolean;
  onPopDone: (id: number) => void;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Paint the board bitmap once per size (and device pixel ratio).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size <= 0) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    const raf = requestAnimationFrame(() => {
      canvas.width = px;
      canvas.height = px;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) paintBoard(ctx, px);
    });
    return () => cancelAnimationFrame(raf);
  }, [size]);

  const scale = size / (2 * VIEW);

  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={label}>
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />

      {/* Holes left by earlier rounds. */}
      <svg viewBox={`${-VIEW} ${-VIEW} ${VIEW * 2} ${VIEW * 2}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        {holes.map((p, i) => (
          <g key={i}>
            <circle cx={p.x + 0.35} cy={p.y + 0.45} r={1.25} fill="rgba(255,255,255,0.12)" />
            <circle cx={p.x} cy={p.y} r={1.05} fill="rgba(0,0,0,0.7)" />
          </g>
        ))}
      </svg>

      {darts.map((d) => (
        <StuckDartView key={d.key} dart={d} scale={scale} size={size} reduced={reduced} pulling={pulling} />
      ))}

      {flight && <FlyingDart key={flight.id} flight={flight} size={size} scale={scale} reduced={reduced} />}

      {reticleRef && <Reticle reticleRef={reticleRef} visible={aiming} />}

      <AnimatePresence>
        {pops.map((p) => (
          <PopLabel key={p.id} pop={p} size={size} reduced={reduced} onDone={onPopDone} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function StuckDartView({
  dart,
  scale,
  size,
  reduced,
  pulling,
}: {
  dart: StuckDart;
  scale: number;
  size: number;
  reduced: boolean;
  pulling: boolean;
}) {
  const { deg } = tailFor(dart.at, dart.spin);
  const pos = toPx(clampToView(dart.at), size);
  const wobble = dart.fresh && !reduced;
  return (
    <motion.div
      className="pointer-events-none absolute size-0"
      style={{ left: pos.x, top: pos.y }}
      initial={false}
      animate={
        pulling
          ? { opacity: 0, scale: reduced ? 1 : 1.6, y: reduced ? 0 : 24 }
          : wobble
            ? { rotate: [0, 9, -6.5, 4.5, -3, 1.6, -0.8, 0], scaleY: [1, 0.9, 1.05, 0.97, 1.02, 1, 1, 1], opacity: 1 }
            : { rotate: 0, scaleY: 1, opacity: 1 }
      }
      transition={pulling ? { duration: 0.35, ease: "easeIn" } : { duration: 0.75, ease: "easeOut" }}
    >
      <svg
        viewBox="-24 -48 56 80"
        className="absolute overflow-visible"
        style={{ left: -24 * scale, top: -48 * scale, width: 56 * scale, height: 80 * scale }}
        aria-hidden
      >
        <g transform={`scale(${DART_SCALE})`}>
          <g style={{ filter: "blur(0.6px)" }}>
            <DartShadow />
          </g>
          <g transform={`rotate(${deg})`}>
            <BoardDartShape color={dart.color} flightSpin={dart.spin * 20} />
          </g>
        </g>
      </svg>
    </motion.div>
  );
}

function FlyingDart({ flight, size, scale, reduced }: { flight: Flight; size: number; scale: number; reduced: boolean }) {
  const pos = toPx(clampToView(flight.at), size);
  const { from } = flight;
  const arc = Math.min(from.y * 0.25, 0) - size * 0.1;
  const { deg } = tailFor(flight.at, flight.spin);
  return (
    <motion.div
      className="pointer-events-none absolute size-0"
      style={{ left: pos.x, top: pos.y }}
      initial={reduced ? { opacity: 0 } : { x: from.x, y: from.y, scale: 3.4, opacity: 0.3 }}
      animate={
        reduced
          ? { opacity: 1 }
          : { x: [from.x, from.x * 0.3, 0], y: [from.y, arc, 0], scale: [3.4, 1.75, 1], opacity: [0.3, 1, 1], rotate: [8, -3, 0] }
      }
      transition={
        reduced ? { duration: 0.1 } : { duration: flight.ms / 1000, times: [0, 0.6, 1], ease: ["easeOut", "easeIn"] }
      }
    >
      <svg
        viewBox="-24 -48 56 80"
        className="absolute overflow-visible"
        style={{ left: -24 * scale, top: -48 * scale, width: 56 * scale, height: 80 * scale }}
        aria-hidden
      >
        <g transform={`scale(${DART_SCALE}) rotate(${deg})`}>
          <BoardDartShape color={flight.color} flightSpin={flight.spin * 20} />
        </g>
      </svg>
    </motion.div>
  );
}

/** The aim reticle. Its position is written straight to the DOM every frame by the aiming loop. */
function Reticle({ reticleRef, visible }: { reticleRef: RefObject<HTMLDivElement | null>; visible: boolean }) {
  return (
    <div
      ref={reticleRef}
      data-calm="0"
      className={cn(
        "group pointer-events-none absolute left-0 top-0 size-0 transition-opacity duration-150",
        visible ? "opacity-100" : "opacity-0",
      )}
      style={{ willChange: "transform" }}
      aria-hidden
    >
      <div className="absolute size-[34px] -translate-x-1/2 -translate-y-1/2">
        <svg viewBox="-17 -17 34 34" className="size-full overflow-visible drop-shadow-[0_0_4px_rgb(0_0_0/0.9)]">
          <circle r="11" fill="none" stroke="rgb(0 0 0 / 0.55)" strokeWidth="3.4" />
          <circle
            r="11"
            fill="none"
            className="stroke-white transition-[stroke] duration-200 group-data-[calm=1]:stroke-[#7fe7ff]"
            strokeWidth="1.6"
          />
          {[0, 90, 180, 270].map((r) => (
            <g key={r} transform={`rotate(${r})`}>
              <path d="M0 -16 V-12.5" stroke="rgb(0 0 0 / 0.6)" strokeWidth="3" strokeLinecap="round" />
              <path
                d="M0 -16 V-12.5"
                className="stroke-white group-data-[calm=1]:stroke-[#7fe7ff]"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
          ))}
          <circle r="1.9" fill="#ff4d5e" stroke="#fff" strokeWidth="0.8" />
        </svg>
      </div>
    </div>
  );
}

function PopLabel({ pop, size, reduced, onDone }: { pop: Pop; size: number; reduced: boolean; onDone: (id: number) => void }) {
  const pos = toPx(clampToView(pop.at, 30), size);
  const big = pop.tone === "bull" || pop.tone === "treble";
  return (
    <motion.div
      className="pointer-events-none absolute size-0"
      style={{ left: pos.x, top: pos.y }}
      initial={{ opacity: 0, scale: 0.4, x: 0, y: 0 }}
      animate={{ opacity: 1, scale: big ? 1.15 : 1, x: 26, y: -40 }}
      exit={{ opacity: 0, y: -60, transition: { duration: 0.3 } }}
      transition={reduced ? { duration: 0.15 } : spring.bouncy}
      onAnimationComplete={() => {
        setTimeout(() => onDone(pop.id), 650);
      }}
    >
      <div
        className={cn(
          "absolute left-0 top-0 flex -translate-x-1/2 -translate-y-full flex-col items-center whitespace-nowrap font-display font-extrabold leading-none",
          TONE_CLASS[pop.tone],
        )}
      >
        <span className={big ? "text-[26px]" : "text-[21px]"}>{pop.label}</span>
        {pop.points > 0 && pop.label !== String(pop.points) && (
          <span className="mt-0.5 text-[13px] tabular opacity-90">+{pop.points}</span>
        )}
      </div>
    </motion.div>
  );
}
