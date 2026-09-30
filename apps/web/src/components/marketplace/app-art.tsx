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
    case "perfect-circle":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center py-3">
            <svg viewBox="0 0 100 100" className="h-full -rotate-90 overflow-visible">
              <defs>
                <linearGradient id="art-perfect-circle" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#ff4d5e" />
                  <stop offset="0.5" stopColor={a} />
                  <stop offset="1" stopColor={b} />
                </linearGradient>
              </defs>
              <motion.path
                d="M 90 50 C 90 73 72 90.5 50 90 C 27 89.5 10 72 9.5 50.5 C 9 28 27.5 10 50.5 9.5 C 73 9 90.2 27 90 49"
                fill="none"
                stroke="url(#art-perfect-circle)"
                strokeWidth="5"
                strokeLinecap="round"
                initial={{ pathLength: reduced ? 1 : 0 }}
                animate={reduced ? { pathLength: 1 } : { pathLength: [0, 1, 1, 0], opacity: [1, 1, 1, 0] }}
                transition={reduced ? { duration: 0 } : { duration: 3.4, times: [0, 0.45, 0.85, 1], repeat: Infinity, ease: "easeInOut" }}
              />
              <circle cx="50" cy="50" r="3.5" fill="#f6f7fb" />
            </svg>
            <motion.span
              className="absolute inset-x-0 top-[58%] text-center font-display text-xl font-extrabold tabular"
              style={{ color: b, textShadow: `0 0 18px ${b}88` }}
              animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1.1, 1, 0.9] }}
              transition={loop(3.4)}
            >
              97.3%
            </motion.span>
          </div>
        </div>
      );
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
    case "gregs-face":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center py-3">
            <svg viewBox="0 0 120 120" className="h-full overflow-visible">
              <ellipse cx="60" cy="66" rx="38" ry="44" fill="#f5d2bb" />
              <path d="M22 62 C18 30 40 14 62 14 C88 14 104 34 98 60 C94 46 84 40 70 40 C56 40 46 36 40 30 C32 40 26 50 22 62 Z" fill={a} />
              <path d="M54 76 Q60 88 66 76" stroke="#d4967c" strokeWidth="3" fill="none" strokeLinecap="round" transform="translate(9 0)" />
              <path d="M48 96 Q60 102 72 96" stroke="#c46e67" strokeWidth="4" fill="none" strokeLinecap="round" transform="translate(-6 0)" />
              <line x1="4" x2="116" y1="62" y2="62" stroke="#ffffff" strokeOpacity="0.35" strokeDasharray="4 4" />
              <motion.g
                animate={{ x: [-34, 34, -34] }}
                transition={reduced ? { duration: 0 } : { duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              >
                <g style={{ filter: "drop-shadow(0 4px 3px rgb(0 0 0 / 0.35))" }}>
                  {[46, 74].map((cx) => (
                    <g key={cx}>
                      <ellipse cx={cx} cy="56" rx="9" ry="6" fill="#fff" />
                      <circle cx={cx + 1} cy="56.5" r="4" fill={b} />
                      <circle cx={cx + 1} cy="56.5" r="1.8" fill="#1b2129" />
                    </g>
                  ))}
                </g>
              </motion.g>
            </svg>
          </div>
        </div>
      );
    case "darts": {
      const ring = (r: number, width: number, offset: number, color: string) => (
        <circle
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeDasharray={`${(Math.PI * r) / 10} ${(Math.PI * r) / 10}`}
          strokeDashoffset={offset * ((Math.PI * r) / 10) + (Math.PI * r) / 20}
          transform="rotate(-90)"
        />
      );
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center py-3">
            <svg viewBox="-60 -60 120 120" className="h-full overflow-visible">
              <circle r="57" fill="#121110" stroke="#9aa1aa" strokeWidth="1.2" />
              {Array.from({ length: 20 }, (_, i) => {
                const a0 = ((i * 18 - 99) * Math.PI) / 180;
                const a1 = a0 + (18 * Math.PI) / 180;
                return (
                  <path
                    key={i}
                    // Rounded: server and browser trig can differ in the last digit (a hydration mismatch).
                    d={`M0 0 L${(Math.cos(a0) * 44).toFixed(2)} ${(Math.sin(a0) * 44).toFixed(2)} A44 44 0 0 1 ${(Math.cos(a1) * 44).toFixed(2)} ${(Math.sin(a1) * 44).toFixed(2)} Z`}
                    fill={i % 2 ? "#e8d9b5" : "#221f1b"}
                  />
                );
              })}
              {ring(42, 4, 0, "#d0262c")}
              {ring(42, 4, 1, "#12824a")}
              {ring(26.5, 3.4, 0, "#d0262c")}
              {ring(26.5, 3.4, 1, "#12824a")}
              <circle r="5" fill="#12824a" />
              <circle r="2.3" fill="#d0262c" />
              {([[1.5, -27], [-4, -25.5], [0.5, 0.5]] as const).map(([x, y], i) => (
                <motion.g
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={
                    reduced
                      ? { opacity: 1, x, y, scale: 1 }
                      : { opacity: [0, 1, 1, 1, 0], x: [x * 0.3, x, x, x, x], y: [70, y, y, y, y], scale: [3, 1, 1, 1, 1], rotate: [0, 0, 8, 0, 0] }
                  }
                  transition={
                    reduced ? { duration: 0 } : { duration: 3.6, times: [0, 0.1, 0.15, 0.9, 1], delay: i * 0.55, repeat: Infinity, repeatDelay: 0.6 }
                  }
                >
                  <path d="M0 0 L0 -9" stroke="#d6dbe1" strokeWidth="1.8" strokeLinecap="round" />
                  <g transform="translate(0 -11) rotate(45)">
                    {[0, 90, 180, 270].map((r) => (
                      <path key={r} d="M0 0 L2.4 -1.6 L2.8 -7 L0.3 -8 Z" transform={`rotate(${r})`} fill={i === 2 ? b : a} />
                    ))}
                  </g>
                </motion.g>
              ))}
            </svg>
          </div>
        </div>
      );
    }
    case "eight-ball": {
      // A break on loop: the cue ball runs into the rack and the balls fan out.
      const rack: [string, number, number, boolean][] = [
        ["#f8c414", 0, 0, false], ["#1c4cc4", 1, -0.5, true], ["#d62822", 1, 0.5, false],
        ["#602c96", 2, -1, false], ["#141418", 2, 0, false], ["#f67818", 2, 1, true],
        ["#128448", 3, -1.5, true], ["#801e26", 3, -0.5, false], ["#f8c414", 3, 0.5, true], ["#1c4cc4", 3, 1.5, false],
      ];
      return (
        <div className={className} aria-hidden>
          <div className="flex size-full items-center justify-center py-3">
            <svg viewBox="0 0 200 110" className="size-full">
              <rect x="0" y="0" width="200" height="110" rx="12" fill="#5c2c13" />
              <rect x="9" y="9" width="182" height="92" rx="3" fill="#17744e" />
              {[[10, 10], [100, 7], [190, 10], [10, 100], [100, 103], [190, 100]].map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="6.5" fill="#050505" />
              ))}
              {rack.map(([color, col, row, stripe], i) => {
                const x = 128 + col * 8.2;
                const y = 55 + row * 9.4;
                const dx = (col + 1) * 6 + (i % 3) * 3;
                const dy = row * 12 + (i % 2 ? 5 : -5);
                return (
                  <motion.g
                    key={i}
                    animate={reduced ? { x: 0, y: 0 } : { x: [0, 0, dx, dx, 0], y: [0, 0, dy, dy, 0] }}
                    transition={reduced ? { duration: 0 } : { duration: 3.4, times: [0, 0.3, 0.45, 0.9, 1], repeat: Infinity, ease: "easeOut" }}
                  >
                    <circle cx={x} cy={y} r="4.6" fill={stripe ? "#f6f3ea" : color} />
                    {stripe && <rect x={x - 4.6} y={y - 2.2} width="9.2" height="4.4" fill={color} clipPath="circle(4.6px)" />}
                    <circle cx={x - 1.4} cy={y - 1.6} r="1.3" fill="#fff" opacity="0.55" />
                  </motion.g>
                );
              })}
              <motion.g
                animate={reduced ? { x: 0 } : { x: [0, 64, 50, 50, 0], opacity: [1, 1, 1, 1, 0] }}
                transition={reduced ? { duration: 0 } : { duration: 3.4, times: [0, 0.3, 0.45, 0.9, 1], repeat: Infinity, ease: "easeIn" }}
              >
                <circle cx="54" cy="55" r="4.6" fill="#f6f3ea" />
                <circle cx="52.6" cy="53.4" r="1.3" fill="#fff" opacity="0.7" />
              </motion.g>
              <motion.rect
                x="-60"
                y="54"
                width="104"
                height="2.4"
                rx="1.2"
                fill={b}
                animate={reduced ? { x: 0 } : { x: [-14, 4, 4, -14, -14], opacity: [1, 1, 0, 0, 1] }}
                transition={reduced ? { duration: 0 } : { duration: 3.4, times: [0, 0.28, 0.35, 0.95, 1], repeat: Infinity }}
              />
            </svg>
          </div>
        </div>
      );
    }
    case "mini-golf":
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center py-2">
            <svg viewBox="0 0 160 110" className="h-full overflow-visible">
              <defs>
                <linearGradient id="mg-art-green" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={a} />
                  <stop offset="1" stopColor="#2f9a45" />
                </linearGradient>
              </defs>
              <path d="M44 8 H116 L148 100 H12 Z" fill="rgb(0 0 0 / 0.3)" transform="translate(0 5)" />
              <path d="M44 8 H116 L148 100 H12 Z" fill="url(#mg-art-green)" stroke="#fff4e2" strokeWidth="5" strokeLinejoin="round" />
              {[0, 1, 2, 3].map((i) => (
                <path key={i} d={`M${40 - i * 8} ${20 + i * 22} H${120 + i * 8}`} stroke="rgb(255 255 255 / 0.12)" strokeWidth="10" />
              ))}
              <ellipse cx="88" cy="28" rx="7" ry="3.2" fill="#0d0d0d" stroke="#fff" strokeWidth="1.2" />
              <motion.g
                animate={{ rotate: [-5, 5, -5] }}
                transition={loop(1.8)}
                style={{ originX: "89px", originY: "28px" }}
              >
                <line x1="89" y1="28" x2="89" y2="-4" stroke="#fff" strokeWidth="2" />
                <path d="M90 -4 l18 6 l-18 6 z" fill={b} />
              </motion.g>
              <path d="M70 92 Q52 60 86 32" fill="none" stroke="#fff" strokeOpacity="0.6" strokeWidth="2.2" strokeDasharray="0.1 7" strokeLinecap="round" />
              <motion.circle
                r="5.2"
                fill="#fff"
                stroke="rgb(0 0 0 / 0.15)"
                animate={reduced ? { cx: 70, cy: 92 } : { cx: [70, 58, 70, 86, 88], cy: [92, 70, 48, 32, 29], opacity: [1, 1, 1, 1, 0] }}
                transition={reduced ? { duration: 0 } : { duration: 2.6, repeat: Infinity, repeatDelay: 0.8, ease: "easeOut" }}
              />
            </svg>
          </div>
        </div>
      );
    case "cup-pong": {
      // A triangle of red cups seen from the thrower; a ball lobs in and the front cup splashes.
      const cups = [
        [52, 40], [72, 40], [92, 40], [112, 40],
        [62, 50], [82, 50], [102, 50],
        [72, 60], [92, 60],
        [82, 70],
      ] as const;
      return (
        <div className={className} aria-hidden>
          <div className="relative flex size-full items-center justify-center py-2">
            <svg viewBox="0 0 164 110" className="h-full overflow-visible">
              <defs>
                <linearGradient id="cp-art-cup" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#a50f1f" />
                  <stop offset="0.45" stopColor={a} />
                  <stop offset="1" stopColor="#b3121f" />
                </linearGradient>
                <linearGradient id="cp-art-table" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8a5128" />
                  <stop offset="1" stopColor="#c7864b" />
                </linearGradient>
              </defs>
              <path d="M40 30 H124 L160 108 H4 Z" fill="url(#cp-art-table)" />
              <path d="M40 30 H124 L160 108 H4 Z" fill="none" stroke="#fff4e2" strokeOpacity="0.8" strokeWidth="2" />
              <path d="M82 30 V108" stroke="#fff4e2" strokeOpacity="0.6" strokeWidth="1.2" />
              {cups.map(([x, y], i) => {
                const w = 8 + (y - 40) * 0.08;
                const front = i === cups.length - 1;
                return (
                  <motion.g
                    key={i}
                    animate={front && !reduced ? { y: [0, 0, -10, 0, 0], opacity: [1, 1, 0, 0, 1], scale: [1, 1, 0.4, 0.4, 1] } : undefined}
                    transition={front ? { duration: 3.2, times: [0, 0.42, 0.55, 0.9, 1], repeat: Infinity, ease: "easeInOut" } : undefined}
                    style={{ originX: `${x}px`, originY: `${y}px` }}
                  >
                    <path d={`M${x - w} ${y - 14} L${x + w} ${y - 14} L${x + w * 0.7} ${y} L${x - w * 0.7} ${y} Z`} fill="url(#cp-art-cup)" />
                    <ellipse cx={x} cy={y - 14} rx={w + 0.6} ry={w * 0.32} fill="#f7f3ee" />
                    <ellipse cx={x} cy={y - 13.6} rx={w * 0.78} ry={w * 0.22} fill="#43b6ff" />
                  </motion.g>
                );
              })}
              <motion.circle
                r="4.2"
                fill="#fbf8f1"
                animate={reduced ? { cx: 82, cy: 52 } : { cx: [82, 82, 82], cy: [104, 10, 55], opacity: [1, 1, 0] }}
                transition={reduced ? { duration: 0 } : { duration: 1.4, times: [0, 0.55, 1], repeat: Infinity, repeatDelay: 1.8, ease: "easeInOut" }}
              />
              {!reduced &&
                [-1, 0, 1].map((d) => (
                  <motion.circle
                    key={d}
                    r="1.8"
                    fill={b}
                    animate={{ cx: [82, 82 + d * 9], cy: [56, 44 - Math.abs(d) * 2], opacity: [0, 1, 0] }}
                    transition={{ duration: 0.7, delay: 1.3, repeat: Infinity, repeatDelay: 2.5, ease: "easeOut" }}
                  />
                ))}
            </svg>
          </div>
        </div>
      );
    }
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
