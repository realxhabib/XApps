"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { appImageSrc } from "@/lib/app-images";
import { cn } from "@/lib/utils";
import type { AppManifest } from "@/platform/types";

/**
 * Tiny animated vignette for each app — the marketplace equivalent of a
 * screenshot, drawn in code so it's crisp at any size and never stale.
 */
export function AppArt({ app, className }: { app: AppManifest; className?: string }) {
  const cover = appImageSrc(app.coverImage);
  const [failed, setFailed] = useState<string | null>(null);
  if (cover && failed !== cover) return <CoverArt src={cover} onError={() => setFailed(cover)} className={className} />;
  return <DrawnArt app={app} className={className} />;
}

/** An uploaded cover: fills the art area with a slow drift, fading out at the bottom into the card. */
function CoverArt({ src, onError, className }: { src: string; onError: () => void; className?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className={cn("relative overflow-hidden", className)} aria-hidden>
      <motion.img
        src={src}
        alt=""
        draggable={false}
        onError={onError}
        className="absolute inset-0 size-full object-cover"
        initial={{ scale: 1.04 }}
        animate={reduced ? { scale: 1 } : { scale: [1.01, 1.05, 1.01] }}
        transition={reduced ? { duration: 0 } : { duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ink-850/90" />
    </div>
  );
}

function DrawnArt({ app, className }: { app: AppManifest; className?: string }) {
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
              GO!
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
    case "trivia-royale": {
      const tiles = ["#ff4d6d", "#3d7bff", "#ffc93d", "#1fd1b2"];
      return (
        <div className={className} aria-hidden>
          <div className="flex size-full items-center justify-center gap-4 py-4">
            <div className="grid aspect-square h-full grid-cols-2 gap-[8%]">
              {tiles.map((color, i) => (
                <motion.span
                  key={color}
                  className="rounded-[22%] shadow-lg"
                  style={{ background: color, boxShadow: "inset 0 -4px 0 rgb(0 0 0 / 0.22)" }}
                  animate={i === 2 ? { scale: [1, 1.12, 1], opacity: 1 } : { scale: 1, opacity: [1, 0.45, 1] }}
                  transition={loop(2.4, 0.9)}
                />
              ))}
            </div>
            <div className="flex -space-x-2">
              {[a, b, "#c6ff3d", "#ffffff"].map((color, i) => (
                <motion.span
                  key={i}
                  className="size-6 rounded-full ring-2 ring-ink-950"
                  style={{ background: color }}
                  animate={{ y: [0, -6, 0] }}
                  transition={loop(1.8, i * 0.15)}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }
    case "wedge-wars":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-end justify-center overflow-hidden">
            <div
              className="absolute inset-x-0 bottom-0 h-[34%]"
              style={{
                background: "linear-gradient(to top, #0b0e14, #1a1f2b)",
                boxShadow: `inset 0 1px 0 ${a}55`,
              }}
            />
            {[0, 1].map((side) => (
              <motion.svg
                key={side}
                viewBox="0 0 120 56"
                className="absolute bottom-[22%] w-[46%]"
                style={side ? { right: "2%", scaleX: -1 } : { left: "2%" }}
                animate={{ x: side ? [-6, 6, -6] : [6, -6, 6] }}
                transition={loop(1.6, side * 0.2)}
              >
                <defs>
                  <linearGradient id={`ww-steel-${side}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f2f5fa" />
                    <stop offset="0.55" stopColor="#9aa3b3" />
                    <stop offset="1" stopColor="#4a5160" />
                  </linearGradient>
                </defs>
                {/* body: sharp wedge, rising to the roof apex, sloping sail */}
                <path d="M4 38 L6 32 L64 12 L106 24 L110 38 Z" fill={`url(#ww-steel-${side})`} stroke="#1a1d24" strokeWidth="1" />
                <path d="M40 22 L64 14 L84 20 L46 26 Z" fill="#0d1118" opacity="0.9" />
                <path d="M6 33 L104 33" stroke={side ? b : a} strokeWidth="2.2" />
                <rect x="3" y="30.5" width="10" height="2.2" rx="1" fill="#fff" style={{ filter: `drop-shadow(0 0 3px ${a})` }} />
                <circle cx="26" cy="42" r="9" fill="#12151c" stroke="#3b4150" strokeWidth="2" />
                <circle cx="90" cy="42" r="9" fill="#12151c" stroke="#3b4150" strokeWidth="2" />
                <circle cx="26" cy="42" r="3" fill={side ? b : a} />
                <circle cx="90" cy="42" r="3" fill={side ? b : a} />
                <motion.rect
                  x="-2"
                  y="35"
                  width="18"
                  height="2.4"
                  rx="1"
                  fill="#dfe4ec"
                  style={{ originX: "7px", originY: "36px" }}
                  animate={{ scaleX: [1, -1, 1] }}
                  transition={reduced ? { duration: 0 } : { duration: 0.18, repeat: Infinity, ease: "linear" }}
                />
              </motion.svg>
            ))}
            {Array.from({ length: 7 }).map((_, i) => (
              <motion.span
                key={i}
                className="absolute bottom-[34%] left-1/2 h-[3px] w-3 rounded-full"
                style={{ background: i % 2 ? "#fff3c4" : b, boxShadow: `0 0 8px ${b}` }}
                animate={{ x: [0, (i - 3) * 18], y: [0, -30 - (i % 3) * 14, -8], opacity: [0, 1, 0], rotate: (i - 3) * 20 }}
                transition={loop(1.6, 0.75 + i * 0.03)}
              />
            ))}
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
