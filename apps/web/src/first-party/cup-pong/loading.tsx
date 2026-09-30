"use client";

/**
 * Shown while the 3D bundle (three.js) streams in. Deliberately light: no
 * three.js here, so it paints instantly from the page chunk.
 */

import { motion, useReducedMotion } from "motion/react";

export function CupPongLoading() {
  const reduce = useReducedMotion();
  return (
    <div className="m-auto flex flex-col items-center gap-5 px-6 text-center">
      <svg viewBox="0 0 120 80" className="h-20 w-auto overflow-visible" aria-hidden>
        <path d="M42 34 L78 34 L72 76 L48 76 Z" fill="#e3182c" />
        <ellipse cx="60" cy="34" rx="19" ry="5" fill="#f7f3ee" />
        <ellipse cx="60" cy="35" rx="15" ry="3.5" fill="#43b6ff" />
        <motion.circle
          r="6"
          cx="60"
          cy="14"
          fill="#fbf8f1"
          initial={{ cy: 14 }}
          animate={reduce ? { cy: 14 } : { cy: [0, 30, 8, 30, 14, 30] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <div>
        <p className="font-display text-2xl font-extrabold tracking-tight">
          Cup <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text pr-1 text-transparent">Pong</span>
        </p>
        <p className="mt-1 text-sm text-ink-300">Filling the cups…</p>
      </div>
    </div>
  );
}
