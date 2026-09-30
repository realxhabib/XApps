"use client";

/**
 * Shown while the 3D bundle streams in. No three.js here, so it paints
 * instantly from the page chunk: a ball rolling up to a flag.
 */

import { motion, useReducedMotion } from "motion/react";

export function GolfLoading({ label = "Mowing the greens" }: { label?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="m-auto flex flex-col items-center gap-5 px-6 text-center">
      <svg viewBox="0 0 160 70" className="w-48" aria-hidden>
        <ellipse cx="80" cy="56" rx="76" ry="12" fill="#3fa647" />
        <ellipse cx="80" cy="54" rx="72" ry="9" fill="#58c35d" />
        <ellipse cx="128" cy="54" rx="7" ry="2.6" fill="#0c0c0c" />
        <line x1="130" y1="54" x2="130" y2="8" stroke="#fff" strokeWidth="2" />
        <motion.path
          d="M131 8 l20 7 l-20 7 z"
          fill="var(--accent-from)"
          animate={reduce ? undefined : { skewY: [0, -6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cy="50"
          r="5"
          fill="#fff"
          initial={{ cx: 24 }}
          animate={reduce ? { cx: 60 } : { cx: [24, 122, 24] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <p className="text-sm font-medium text-ink-300">{label}…</p>
    </div>
  );
}
