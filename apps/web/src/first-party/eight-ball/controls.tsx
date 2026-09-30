"use client";

import { lockGestures } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Vec } from "./physics";

/* ------------------------------------------------------------------------ */
/* Power: pull the cue back, let go to shoot                                */
/* ------------------------------------------------------------------------ */

/**
 * A vertical cue you drag down to draw back (the table's cue follows) and
 * release to strike. Letting go near the top cancels.
 */
export function PowerBar({
  length,
  enabled,
  onPull,
  onRelease,
  reduced,
  keyboardPull,
}: {
  length: number;
  enabled: boolean;
  onPull: (pull: number) => void;
  onRelease: (pull: number) => void;
  reduced: boolean;
  /** Pull set from the keyboard (↑/↓), shown when not dragging. */
  keyboardPull: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; y: number } | null>(null);
  const [pull, setPull] = useState(0);
  const [active, setActive] = useState(false);
  useEffect(() => lockGestures(ref.current), []);
  const shown = active || pull > 0 ? pull : keyboardPull;
  const travel = Math.max(40, length - 70);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || drag.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events
    }
    drag.current = { id: e.pointerId, y: e.clientY };
    setActive(true);
    setPull(0);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const next = Math.min(1, Math.max(0, (e.clientY - d.y) / travel));
    setPull(next);
    onPull(next);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const final = e.type === "pointercancel" ? 0 : pull;
    setActive(false);
    setPull(0);
    onRelease(final);
  };

  const pct = Math.round(shown * 100);
  const hot = shown > 0.8;
  return (
    <div
      ref={ref}
      className={cn(
        "relative flex w-12 shrink-0 touch-none select-none flex-col items-center overflow-hidden rounded-full border border-white/10 bg-ink-950/70 shadow-[inset_0_2px_12px_rgb(0_0_0/0.6)]",
        enabled ? "cursor-grab active:cursor-grabbing" : "opacity-45",
      )}
      style={{ height: length }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="slider"
      aria-label="Shot power: drag down, release to shoot"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
    >
      {/* Power fill */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 rounded-t-full"
        style={{
          height: `${shown * 100}%`,
          background: "linear-gradient(to bottom, rgb(52 232 158 / 0.5), rgb(255 207 61 / 0.55) 55%, rgb(255 77 94 / 0.7))",
          transition: active ? undefined : "height 180ms ease-out",
        }}
      />
      {/* Ticks */}
      {[0.25, 0.5, 0.75].map((t) => (
        <span key={t} aria-hidden className="absolute left-2 right-2 h-px bg-white/10" style={{ top: 30 + t * travel }} />
      ))}
      {/* The cue itself slides down as you pull */}
      <motion.div
        aria-hidden
        className="absolute left-1/2 top-3 w-2.5 -translate-x-1/2 rounded-full"
        style={{
          height: length * 1.4,
          background: "linear-gradient(to bottom, #3f6fd6 0 7px, #f4f0e6 7px 16px, #f1dcae 16px 46%, #c9ced6 46% 47%, #2a140a 47% 70%, #141414 70%)",
          boxShadow: "inset -2px 0 3px rgb(0 0 0 / 0.35), inset 2px 0 2px rgb(255 255 255 / 0.3)",
        }}
        animate={{ y: shown * travel }}
        transition={active || reduced ? { duration: 0 } : spring.snappy}
      />
      <span
        className={cn(
          "pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-ink-950/80 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular",
          hot ? "text-danger" : "text-ink-100",
        )}
      >
        {pct}%
      </span>
      <AnimatePresence>
        {enabled && shown === 0 && !reduced && (
          <motion.span
            key="hint"
            aria-hidden
            className="pointer-events-none absolute top-[38%] left-1/2 -translate-x-1/2 text-lg text-white/70"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0], y: [0, 16, 24] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          >
            ↓
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Spin (english): where the tip hits the cue ball                          */
/* ------------------------------------------------------------------------ */

export function SpinControl({
  spin,
  onChange,
  enabled,
  size = 44,
}: {
  spin: Vec;
  onChange: (spin: Vec) => void;
  enabled: boolean;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const off = spin.x !== 0 || spin.y !== 0;
  return (
    <div className="relative">
      <motion.button
        type="button"
        whileTap={{ scale: 0.9 }}
        transition={spring.snappy}
        disabled={!enabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex items-center justify-center rounded-full ring-1 ring-white/15 transition-opacity disabled:opacity-40",
          off && "ring-2 ring-[var(--accent-to)]",
        )}
        style={{ width: size, height: size }}
        aria-label="Set spin"
        aria-expanded={open}
      >
        <CueBallFace spin={spin} size={size - 6} />
      </motion.button>
      <AnimatePresence>
        {open && enabled && <SpinPad spin={spin} onChange={onChange} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}

function CueBallFace({ spin, size }: { spin: Vec; size: number }) {
  return (
    <span
      className="relative block rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 36% 30%, #ffffff, #efeadd 45%, #b8b2a2 100%)",
        boxShadow: "0 4px 12px rgb(0 0 0 / 0.45)",
      }}
    >
      <span
        className="absolute rounded-full bg-[#d7263d] shadow-[0_0_0_2px_rgb(255_255_255/0.6)]"
        style={{
          width: size * 0.2,
          height: size * 0.2,
          left: `${50 + spin.x * 38}%`,
          top: `${50 - spin.y * 38}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
    </span>
  );
}

function SpinPad({ spin, onChange, onClose }: { spin: Vec; onChange: (spin: Vec) => void; onClose: () => void }) {
  const pad = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);
  useEffect(() => lockGestures(pad.current), []);
  const SIZE = 150;

  const set = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    let y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    const m = Math.hypot(x, y);
    if (m > 0.92) {
      x = (x / m) * 0.92;
      y = (y / m) * 0.92;
    }
    // Snap near the middle so "no spin" is easy to hit.
    if (Math.hypot(x, y) < 0.08) {
      x = 0;
      y = 0;
    }
    onChange({ x: x / 0.92, y: y / 0.92 });
  };

  return (
    <>
      <motion.div
        className="fixed inset-0 z-40"
        onPointerDown={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ background: "rgb(0 0 0 / 0.35)" }}
      />
      <motion.div
        className="absolute bottom-full right-0 z-50 mb-3 flex w-[190px] flex-col items-center gap-3 rounded-3xl border border-white/10 bg-ink-900/95 p-4 shadow-2xl backdrop-blur"
        initial={{ opacity: 0, scale: 0.8, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 8 }}
        transition={spring.bouncy}
        style={{ transformOrigin: "bottom right" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-300">Spin</p>
        <div
          ref={pad}
          className="relative cursor-crosshair touch-none rounded-full"
          style={{ width: SIZE, height: SIZE }}
          onPointerDown={(e) => {
            dragging.current = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // synthetic events
            }
            set(e);
          }}
          onPointerMove={(e) => dragging.current && set(e)}
          onPointerUp={() => (dragging.current = false)}
          onPointerCancel={() => (dragging.current = false)}
          role="slider"
          aria-label="Spin: drag the red dot. Up for follow, down for draw, left or right for side spin."
          aria-valuenow={Math.round(spin.y * 100)}
          aria-valuetext={`${spin.y > 0.1 ? "follow" : spin.y < -0.1 ? "draw" : "centre"}${spin.x > 0.1 ? ", right" : spin.x < -0.1 ? ", left" : ""}`}
        >
          <CueBallFace spin={spin} size={SIZE} />
          <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 h-[calc(100%-16px)] w-px -translate-x-1/2 bg-black/10" />
          <span aria-hidden className="pointer-events-none absolute left-2 top-1/2 h-px w-[calc(100%-16px)] -translate-y-1/2 bg-black/10" />
        </div>
        <div className="flex w-full items-center justify-between text-[10px] text-ink-300">
          <span>{spin.y > 0.1 ? "Follow" : spin.y < -0.1 ? "Draw" : "Stun"}</span>
          <button type="button" className="rounded-full bg-white/10 px-2.5 py-1 font-semibold text-ink-50 hover:bg-white/15" onClick={() => onChange({ x: 0, y: 0 })}>
            Centre
          </button>
          <span>{spin.x > 0.1 ? "Right" : spin.x < -0.1 ? "Left" : "No side"}</span>
        </div>
      </motion.div>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Fine aim: a ruler you slide for tiny adjustments                         */
/* ------------------------------------------------------------------------ */

/** Radians per pixel of slide. */
const FINE = 0.0009;

export function FineAim({ enabled, onNudge, className }: { enabled: boolean; onNudge: (delta: number) => void; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; x: number } | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => lockGestures(ref.current), []);
  return (
    <div
      ref={ref}
      className={cn(
        "relative h-9 min-w-0 flex-1 touch-none select-none overflow-hidden rounded-full border border-white/10 bg-ink-950/60",
        enabled ? "cursor-ew-resize" : "opacity-40",
        className,
      )}
      onPointerDown={(e) => {
        if (!enabled) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // synthetic events
        }
        drag.current = { id: e.pointerId, x: e.clientX };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.id !== e.pointerId) return;
        const dx = e.clientX - d.x;
        d.x = e.clientX;
        setOffset((o) => o + dx);
        onNudge(dx * FINE);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      role="slider"
      aria-label="Fine aim: slide left or right"
      aria-valuenow={0}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgb(255 255 255 / 0.28) 0 1px, transparent 1px 8px), repeating-linear-gradient(90deg, rgb(255 255 255 / 0.5) 0 1px, transparent 1px 40px)",
          backgroundSize: "8px 40%, 40px 70%",
          backgroundRepeat: "repeat-x",
          backgroundPosition: `${offset}px center, ${offset}px center`,
          maskImage: "linear-gradient(90deg, transparent, #000 25%, #000 75%, transparent)",
        }}
      />
      <span aria-hidden className="absolute left-1/2 top-1 bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-[var(--accent-to)]" />
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400">
        fine
      </span>
    </div>
  );
}
