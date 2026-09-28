"use client";

import { motion, useReducedMotion } from "motion/react";
import { EmberField } from "./embers";

/**
 * The debate stage behind everything: two swaying warm spotlights, a glowing
 * floor and drifting embers. `heat` (0..1) drives ember density and floor glow;
 * `tint` washes the spotlights toward the player's side color.
 */
export function Stage({ heat, tint, burst = 0 }: { heat: number; tint?: string; burst?: number }) {
  const reduce = useReducedMotion();
  const warm = "rgb(255 200 140 / 0.27)";
  const edge = tint ?? "rgb(255 170 100 / 0.16)";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Spotlights: conic wedges hung from the top corners. */}
      {[
        { left: "18%", from: -18, to: -8, delay: 0 },
        { left: "82%", from: 18, to: 8, delay: 1.3 },
      ].map((spot, i) => (
        <motion.div
          key={i}
          className="absolute top-[-12%] h-[135%] w-[120vmax] origin-top -translate-x-1/2 mix-blend-screen"
          style={{
            left: spot.left,
            background: `conic-gradient(at 50% 0%, transparent 167deg, ${edge} 173deg, ${warm} 178.5deg, rgb(255 236 200 / 0.34) 180deg, ${warm} 181.5deg, ${edge} 187deg, transparent 193deg)`,
            maskImage: "linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.8) 40%, transparent 88%)",
            WebkitMaskImage: "linear-gradient(180deg, #000 0%, rgb(0 0 0 / 0.8) 40%, transparent 88%)",
            opacity: 0.6 + heat * 0.4,
            filter: "blur(6px)",
            transition: "opacity 800ms ease",
          }}
          initial={{ rotate: spot.from }}
          animate={reduce ? { rotate: (spot.from + spot.to) / 2 } : { rotate: [spot.from, spot.to, spot.from] }}
          transition={reduce ? { duration: 0 } : { duration: 9, repeat: Infinity, ease: "easeInOut", delay: spot.delay }}
        />
      ))}
      {/* The lamps themselves */}
      {["18%", "82%"].map((left) => (
        <div
          key={left}
          className="absolute -top-8 size-16 -translate-x-1/2 rounded-full"
          style={{ left, background: "radial-gradient(circle, rgb(255 225 180 / 0.55), transparent 65%)" }}
        />
      ))}
      {/* Floor glow: the stage is literally heating up. */}
      <div
        className="absolute inset-x-[-20%] bottom-[-18%] h-[55%]"
        style={{
          background:
            "radial-gradient(ellipse 50% 60% at 50% 100%, rgb(255 110 50 / 0.55), rgb(255 61 110 / 0.18) 45%, transparent 75%)",
          opacity: 0.3 + heat * 0.7,
          transition: "opacity 900ms ease",
        }}
      />
      <EmberField density={0.15 + heat * 0.85} burst={burst} className="absolute inset-0 size-full" />
      {/* Vignette keeps the edges theatrical and the center readable. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 85% 75% at 50% 45%, transparent 55%, rgb(0 0 0 / 0.55) 100%)" }}
      />
    </div>
  );
}
