"use client";

import { motion, useReducedMotion } from "motion/react";
import type { AppManifest } from "@/platform/types";

/**
 * Tiny animated vignette for each app — the marketplace equivalent of a
 * screenshot, drawn in code so it's crisp at any size and never stale.
 */
export function AppArt({ app, className }: { app: AppManifest; className?: string }) {
  const reduced = useReducedMotion();
  const [a, b] = app.accent;
  const loop = (duration: number, delay = 0) =>
    reduced ? { duration: 0 } : { duration, delay, repeat: Infinity, ease: "easeInOut" as const };

  switch (app.slug) {
    case "quick-draw":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center">
            {[0, 1, 2, 3].map((i) => (
              <motion.span
                key={i}
                className="absolute rounded-full border-2"
                style={{ height: `${34 + i * 20}%`, aspectRatio: "1", borderColor: i % 2 ? `${b}88` : `${a}aa` }}
                animate={{ scale: [1, 1.06, 1], opacity: [0.9, 0.5, 0.9] }}
                transition={loop(1.2, i * 0.12)}
              />
            ))}
            <motion.span
              className="relative font-display text-3xl font-extrabold italic tracking-tighter"
              style={{ color: a, textShadow: `0 0 24px ${b}` }}
              animate={{ scale: [0.9, 1.15, 0.9], rotate: [-4, 2, -4] }}
              transition={loop(2.4)}
            >
              DRAW!
            </motion.span>
          </div>
        </div>
      );
    case "four-in-a-row": {
      const discs = [
        [0, 5, "#ff4d5e"], [1, 5, "#ffd23d"], [1, 4, "#ff4d5e"], [2, 5, "#ffd23d"], [2, 4, "#ff4d5e"],
        [3, 5, "#ffd23d"], [2, 3, "#ffd23d"], [3, 4, "#ff4d5e"], [3, 3, "#ffd23d"],
      ] as const;
      return (
        <div className={className} aria-hidden>
          <div className="flex size-full items-center justify-center py-4">
            <div
              className="grid aspect-[5/6] h-full grid-cols-5 grid-rows-6 gap-[5%] rounded-[14%] p-[5%]"
              style={{ background: `linear-gradient(160deg, ${a}, #1d3fb8)` }}
            >
              {Array.from({ length: 5 * 6 }).map((_, idx) => {
                const col = idx % 5;
                const row = Math.floor(idx / 5);
                const disc = discs.findIndex(([c, r]) => c === col && r === row);
                const color = disc >= 0 ? discs[disc]![2] : null;
                return (
                  <span key={idx} className="relative overflow-hidden rounded-full bg-ink-950/70">
                    {color && (
                      <motion.span
                        className="absolute inset-0 rounded-full"
                        style={{ background: color, boxShadow: "inset 0 -3px 0 rgb(0 0 0 / 0.25)" }}
                        initial={{ y: -80 }}
                        animate={{ y: 0 }}
                        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 14, delay: 0.3 + disc * 0.18, repeat: Infinity, repeatDelay: 3.5 }}
                      />
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      );
    }
    case "emoji-decode":
      return (
        <div className={className} aria-hidden>
          <div className="flex size-full items-center justify-center gap-2">
            {["🌧️", "🐱", "🐶"].map((e, i) => (
              <motion.span
                key={e}
                className="flex size-14 items-center justify-center rounded-2xl bg-white/10 text-3xl shadow-lg backdrop-blur"
                animate={{ y: [0, -10, 0], rotate: [i * 4 - 4, i * -4 + 4, i * 4 - 4] }}
                transition={loop(2.2, i * 0.25)}
              >
                {e}
              </motion.span>
            ))}
            <motion.span className="ml-1 font-mono text-2xl font-bold" style={{ color: a }} animate={{ opacity: [0.3, 1, 0.3] }} transition={loop(1.6)}>
              ?
            </motion.span>
          </div>
        </div>
      );
    case "meme-duel":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center">
            {[-1, 1].map((side) => (
              <motion.div
                key={side}
                className="absolute flex h-[70%] w-[38%] flex-col items-center justify-between rounded-2xl p-2 shadow-2xl ring-1 ring-white/20"
                style={{ background: side < 0 ? `linear-gradient(160deg, ${a}, #2a1030)` : `linear-gradient(160deg, ${b}, #150f30)` }}
                animate={{ x: side * 42, rotate: side * 8, y: [0, -6, 0] }}
                transition={{ x: { duration: 0 }, rotate: { duration: 0 }, y: loop(2.6, side > 0 ? 0.4 : 0) }}
              >
                <span className="h-1.5 w-3/4 rounded-full bg-white/80" />
                <span className="text-3xl">{side < 0 ? "🗿" : "😰"}</span>
                <span className="h-1.5 w-2/3 rounded-full bg-white/80" />
              </motion.div>
            ))}
            <motion.span
              className="relative rounded-full bg-ink-950 px-2.5 py-1 font-display text-sm font-extrabold italic"
              animate={{ scale: [1, 1.15, 1] }}
              transition={loop(1.4)}
            >
              VS
            </motion.span>
          </div>
        </div>
      );
    case "hot-takes":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-end justify-center overflow-hidden">
            {Array.from({ length: 7 }).map((_, i) => (
              <motion.span
                key={i}
                className="absolute bottom-0 rounded-full blur-md"
                style={{
                  left: `${10 + i * 12}%`,
                  width: `${14 + (i % 3) * 6}%`,
                  height: "60%",
                  background: `linear-gradient(to top, ${b}, ${a}, transparent)`,
                  transformOrigin: "bottom",
                }}
                animate={{ scaleY: [0.6, 1.1, 0.7], opacity: [0.6, 1, 0.6] }}
                transition={loop(1 + (i % 3) * 0.3, i * 0.1)}
              />
            ))}
            <span className="relative mb-[22%] rounded-2xl bg-ink-950/80 px-3 py-2 text-center font-display text-sm font-bold leading-tight backdrop-blur">
              “Cereal is a soup.”
            </span>
          </div>
        </div>
      );
    default:
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center">
            <motion.span
              className="absolute size-24 rounded-full opacity-60 blur-2xl"
              style={{ background: `radial-gradient(circle, ${a}, ${b})` }}
              animate={{ scale: [1, 1.3, 1] }}
              transition={loop(3)}
            />
            <motion.span className="relative text-5xl" animate={{ rotate: [-8, 8, -8], y: [0, -6, 0] }} transition={loop(2.4)}>
              {app.icon}
            </motion.span>
          </div>
        </div>
      );
  }
}
