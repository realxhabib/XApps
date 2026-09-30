"use client";

/**
 * Mini Golf root: a pre-game card (course preview, the table, how to putt)
 * that calls `ready()`, then the round once the host fires `match.start`.
 * Loaded with next/dynamic from the embed page only, so three.js stays out of
 * the marketplace bundles.
 */

import { useMatchStarted, usePlayers, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { ease, fadeUp, staggerChildren } from "@/lib/motion";
import { HOLES, TOTAL_PAR } from "./course";
import { BALL_COLORS, STROKE_CAP } from "./logic";
import { MatchView } from "./match";

export function MiniGolfApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const readyRef = useRef(false);

  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[mini-golf] ready failed", error));
    xapps.ui.setStatus("On the first tee").catch(() => {});
  }, [xapps]);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <AnimatePresence mode="wait">
        {started ? (
          <motion.div key="match" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
            <MatchView />
          </motion.div>
        ) : (
          <motion.div
            key="pregame"
            className="absolute inset-0 flex overflow-y-auto"
            exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
            transition={{ duration: 0.35, ease: ease.inOutQuart }}
          >
            <Pregame />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Pregame() {
  const { players, me } = usePlayers();
  const reduced = useReducedMotion();
  const seated = [...players].sort((a, b) => a.seat - b.seat);
  return (
    <Screen className="gap-0 py-5">
      <motion.div className="flex w-full flex-col items-center gap-4 text-center" variants={staggerChildren(0.05)} initial="hidden" animate="show">
        <motion.div variants={fadeUp}>
          <Eyebrow>9 holes · par {TOTAL_PAR} · fewest strokes wins</Eyebrow>
        </motion.div>
        <motion.h1 variants={fadeUp} className="font-display text-[clamp(44px,13vw,72px)] font-extrabold leading-[0.9] tracking-tight">
          <span className="bg-[linear-gradient(100deg,#f4fff0,var(--accent-from)_45%,var(--accent-to))] bg-clip-text pr-1 text-transparent">Mini Golf</span>
        </motion.h1>

        <motion.div variants={fadeUp} className="relative h-[clamp(120px,30vw,170px)] w-full max-w-sm">
          <CoursePreview reduced={!!reduced} />
        </motion.div>

        <motion.ul variants={fadeUp} className="flex flex-wrap justify-center gap-2">
          {seated.map((p, i) => (
            <li key={p.id} className="glass flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs">
              <span className="relative">
                <Avatar person={p} size={26} />
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-ink-900"
                  style={{ background: BALL_COLORS[i % BALL_COLORS.length] }}
                />
              </span>
              <span className="max-w-24 truncate font-semibold">{p.id === me.id ? "You" : p.isBot ? p.name : `@${p.handle}`}</span>
            </li>
          ))}
        </motion.ul>

        <motion.ol variants={fadeUp} className="grid w-full max-w-sm gap-2 text-left text-[13px] leading-snug text-ink-300">
          <li className="glass flex gap-3 rounded-2xl px-3.5 py-2.5">
            <span className="text-lg">🏌️</span>
            <span>
              <b className="text-ink-50">Drag back from your ball</b> and let go. The further you pull, the harder the putt.
            </span>
          </li>
          <li className="glass flex gap-3 rounded-2xl px-3.5 py-2.5">
            <span className="text-lg">👀</span>
            <span>
              Drag anywhere else to look around, or <b className="text-ink-50">press and hold</b> to see the whole hole.
            </span>
          </li>
          <li className="glass flex gap-3 rounded-2xl px-3.5 py-2.5">
            <span className="text-lg">⛳</span>
            <span>
              Everyone plays the same 9 holes. Water costs a stroke; after {STROKE_CAP} strokes you pick up and score {STROKE_CAP + 1}.
            </span>
          </li>
        </motion.ol>

        <motion.p variants={fadeUp} className="text-sm font-semibold text-ink-100">
          Heading to the first tee
          <AnimatedDots />
        </motion.p>
      </motion.div>
    </Screen>
  );
}

/** A little top-down card of the course: nine greens with flags popping up. */
function CoursePreview({ reduced }: { reduced: boolean }) {
  return (
    <svg viewBox="0 0 360 160" className="absolute inset-0 size-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="mg-green" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6fd36f" />
          <stop offset="1" stopColor="#3fa647" />
        </linearGradient>
      </defs>
      {HOLES.map((h, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const x = 18 + col * 68 + row * 34;
        const y = 12 + row * 78;
        return (
          <motion.g
            key={h.number}
            initial={{ opacity: 0, y: reduced ? 0 : 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.06, type: "spring", stiffness: 300, damping: 20 }}
          >
            <rect x={x} y={y} width="56" height="66" rx="12" fill="rgb(0 0 0 / 0.25)" transform="translate(0 4)" />
            <rect x={x} y={y} width="56" height="66" rx="12" fill="url(#mg-green)" stroke="#fff4e2" strokeWidth="3" />
            <circle cx={x + 28} cy={y + 50} r="3.5" fill="#fff" />
            <circle cx={x + 30 + ((i * 7) % 11) - 5} cy={y + 18} r="4.5" fill="#101010" stroke="#fff" strokeWidth="1.5" />
            <motion.g
              animate={reduced ? undefined : { rotate: [-6, 6, -6] }}
              transition={{ duration: 1.6 + (i % 3) * 0.3, repeat: Infinity, ease: "easeInOut" }}
              style={{ originX: `${x + 31}px`, originY: `${y + 18}px` }}
            >
              <line x1={x + 31 + ((i * 7) % 11) - 5} y1={y + 18} x2={x + 31 + ((i * 7) % 11) - 5} y2={y - 6} stroke="#fff" strokeWidth="2" />
              <path d={`M${x + 32 + ((i * 7) % 11) - 5} ${y - 6} l14 5 l-14 5 z`} fill={h.accent} />
            </motion.g>
            <text x={x + 10} y={y + 60} fontSize="11" fontWeight="800" fill="rgb(0 0 0 / 0.45)">
              {h.number}
            </text>
          </motion.g>
        );
      })}
    </svg>
  );
}
