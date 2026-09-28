"use client";

import { AnimatePresence, motion } from "motion/react";
import { STEADY_MAX_MS } from "./logic";

export interface Flash {
  id: number;
  kind: "draw" | "foul";
}

export interface Ripple {
  id: number;
  x: number;
  y: number;
  tone: "shot" | "foul";
}

/**
 * High-noon tension: a vignette that slowly darkens and reddens while STEADY
 * lasts. Its ramp is tied to the longest possible STEADY, never to this
 * round's delay, so it can't be read to predict DRAW.
 */
export function TensionLayer({ active }: { active: boolean }) {
  const ramp = active
    ? { duration: STEADY_MAX_MS / 1000, ease: [0.45, 0, 0.85, 0.5] as const }
    : { duration: 0.45, ease: "easeOut" as const };
  return (
    <>
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-ink-950"
        initial={false}
        animate={{ opacity: active ? 0.35 : 0 }}
        transition={ramp}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={ramp}
        style={{
          background:
            "radial-gradient(ellipse 72% 62% at 50% 50%, transparent 30%, rgb(150 12 24 / 0.38) 66%, rgb(52 0 8 / 0.9) 100%)",
        }}
      />
    </>
  );
}

/** Full-screen flash: white for DRAW, red for a false start. */
export function FlashLayer({ flash, reduced }: { flash: Flash | null; reduced: boolean }) {
  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          key={flash.id}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40"
          style={{
            background:
              flash.kind === "draw"
                ? "radial-gradient(circle at 50% 50%, #fff 0%, #fff8d6 45%, rgb(255 225 77 / 0.85) 100%)"
                : "radial-gradient(circle at 50% 50%, rgb(255 77 94 / 0.35), rgb(255 30 50 / 0.85))",
          }}
          initial={{ opacity: reduced ? 0.35 : flash.kind === "draw" ? 0.95 : 0.7 }}
          animate={{ opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: flash.kind === "draw" ? 0.5 : 0.65, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
    </AnimatePresence>
  );
}

/** Shockwave rings where the player tapped. */
export function Ripples({ ripples, onDone }: { ripples: Ripple[]; onDone: (id: number) => void }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {ripples.map((r) => (
        <motion.span
          key={r.id}
          className="absolute size-24 rounded-full border-2"
          style={{
            left: r.x - 48,
            top: r.y - 48,
            borderColor: r.tone === "shot" ? "var(--accent-from)" : "var(--color-danger)",
            boxShadow: r.tone === "shot" ? "0 0 24px var(--accent-to)" : "0 0 24px var(--color-danger)",
          }}
          initial={{ scale: 0.2, opacity: 1 }}
          animate={{ scale: 2.6, opacity: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          onAnimationComplete={() => onDone(r.id)}
        />
      ))}
    </div>
  );
}
