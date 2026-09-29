"use client";

/**
 * Shown while the 3D bundle (three.js + physics) streams in. Deliberately
 * light: no three.js here, so it paints instantly from the page chunk.
 */

import { motion, useReducedMotion } from "motion/react";

export function WedgeLoading({ label = "Warming up the arena" }: { label?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="m-auto flex flex-col items-center gap-5 px-6 text-center">
      <div className="relative h-24 w-56">
        <motion.svg
          viewBox="0 0 120 56"
          className="absolute inset-x-0 bottom-3 mx-auto w-44"
          animate={reduce ? undefined : { x: [-8, 8, -8], rotate: [0, -1.5, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <defs>
            <linearGradient id="ww-load-steel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f2f5fa" />
              <stop offset="0.55" stopColor="#9aa3b3" />
              <stop offset="1" stopColor="#4a5160" />
            </linearGradient>
          </defs>
          <path d="M4 38 L6 32 L64 12 L106 24 L110 38 Z" fill="url(#ww-load-steel)" stroke="#1a1d24" strokeWidth="1" />
          <path d="M40 22 L64 14 L84 20 L46 26 Z" fill="#0d1118" />
          <path d="M6 33 L104 33" stroke="var(--accent-from)" strokeWidth="2.2" />
          <rect x="3" y="30.5" width="10" height="2.2" rx="1" fill="#fff" />
          {[26, 90].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="42" r="9" fill="#12151c" stroke="#3b4150" strokeWidth="2" />
              <motion.path
                d={`M${cx - 5} 42 L${cx + 5} 42 M${cx} 37 L${cx} 47`}
                stroke="var(--accent-from)"
                strokeWidth="2"
                style={{ originX: `${cx}px`, originY: "42px" }}
                animate={reduce ? undefined : { rotate: 360 }}
                transition={{ duration: 0.6, repeat: Infinity, ease: "linear" }}
              />
            </g>
          ))}
        </motion.svg>
        <div className="absolute inset-x-4 bottom-2 h-px bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.4),transparent)]" />
      </div>
      <div>
        <p className="font-display text-2xl font-extrabold italic tracking-tight">
          Wedge <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text pr-1 text-transparent">Wars</span>
        </p>
        <p className="mt-1 text-sm text-ink-300">{label}…</p>
      </div>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full w-1/3 rounded-full bg-[linear-gradient(90deg,var(--accent-from),var(--accent-to))]"
          animate={reduce ? { x: "100%" } : { x: ["-100%", "300%"] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
    </div>
  );
}
