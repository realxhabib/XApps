"use client";

/**
 * Mini Golf HUD: the top bar (hole, par, strokes, score to par), the player
 * strip, the hole intro card, the big callouts ("Birdie!"), the between-holes
 * scorecard and the final card. Pure presentation over the runtime snapshot.
 */

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { AnimatedDots } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { HOLES, TOTAL_PAR } from "./course";
import { HOLE_COUNT, cardTotal, formatToPar, rankTotals, scoreMark, toPar, type Tone } from "./logic";
import type { HudSnapshot, Seat } from "./runtime";

/* ------------------------------------------------------------------ */
/* Top bar                                                            */
/* ------------------------------------------------------------------ */

export function TopBar({ hud, onOverview }: { hud: HudSnapshot; onOverview: () => void }) {
  const hole = HOLES[hud.hole]!;
  const me = hud.seats.find((s) => s.isMe);
  const total = me ? toPar(me.card) : 0;
  const playing = hud.phase === "aim" || hud.phase === "roll" || hud.phase === "reset" || hud.phase === "sunk";
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 px-3 pt-[max(10px,env(safe-area-inset-top))]">
      <div className="pointer-events-auto flex items-center gap-2.5 rounded-2xl bg-ink-950/55 py-1.5 pl-1.5 pr-3.5 shadow-lg ring-1 ring-white/10 backdrop-blur-md">
        <div
          className="flex size-10 flex-col items-center justify-center rounded-xl text-ink-950 shadow-inner"
          style={{ background: `linear-gradient(150deg, #fff, ${hole.accent})` }}
        >
          <span className="text-[8px] font-extrabold uppercase leading-none tracking-[0.12em] opacity-70">Hole</span>
          <span className="font-display text-lg font-extrabold leading-none">{hole.number}</span>
        </div>
        <div className="min-w-0 leading-tight">
          <p className="max-w-[9.5rem] truncate text-[13px] font-bold text-ink-50">{hole.name}</p>
          <p className="text-[11px] font-semibold text-ink-300">
            Par {hole.par}
            {playing && !hud.spectator && (
              <>
                {" · "}
                <span className="text-ink-100">
                  {hud.strokes} stroke{hud.strokes === 1 ? "" : "s"}
                </span>
              </>
            )}
          </p>
        </div>
      </div>
      <div className="pointer-events-auto flex items-center gap-2">
        {!hud.spectator && (
          <motion.div
            key={total}
            initial={{ scale: 0.8, opacity: 0.4 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.bouncy}
            className={cn(
              "flex h-10 min-w-12 flex-col items-center justify-center rounded-2xl px-2.5 shadow-lg ring-1 ring-white/10 backdrop-blur-md",
              total < 0 ? "bg-rose-500/85 text-white" : total === 0 ? "bg-ink-950/55 text-ink-50" : "bg-ink-950/55 text-sky-200",
            )}
            aria-label={`Score ${formatToPar(total)} to par`}
          >
            <span className="text-[8px] font-bold uppercase tracking-[0.12em] opacity-70">To par</span>
            <span className="font-display text-base font-extrabold leading-none tabular-nums">{formatToPar(total)}</span>
          </motion.div>
        )}
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          transition={spring.snappy}
          onClick={onOverview}
          aria-pressed={hud.overview}
          aria-label={hud.overview ? "Back to your ball" : "See the whole hole"}
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl shadow-lg ring-1 ring-white/10 backdrop-blur-md transition-colors",
            hud.overview ? "bg-white text-ink-950" : "bg-ink-950/55 text-ink-50",
          )}
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {hud.overview ? (
              <>
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
              </>
            ) : (
              <>
                <path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" />
                <path d="M8 15l3-4 2 2.5L16 9" />
              </>
            )}
          </svg>
        </motion.button>
      </div>
    </div>
  );
}

/** Everyone's progress under the top bar (2+ players). */
export function PlayerStrip({ hud }: { hud: HudSnapshot }) {
  if (hud.seats.length < 2) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(max(10px,env(safe-area-inset-top))+52px)] z-20 flex justify-center gap-1.5 px-3">
      {hud.seats.map((s) => {
        const done = s.card.length >= HOLE_COUNT;
        return (
          <div
            key={s.id}
            className={cn(
              "flex min-w-0 max-w-[9rem] items-center gap-1.5 rounded-full bg-ink-950/50 py-1 pl-1 pr-2.5 text-[11px] font-semibold ring-1 backdrop-blur-md",
              s.isMe ? "ring-white/30" : "ring-white/10",
            )}
          >
            <span className="size-3.5 shrink-0 rounded-full ring-2 ring-black/20" style={{ background: s.color }} />
            <span className="truncate text-ink-100">{s.name}</span>
            <span className="shrink-0 tabular-nums text-ink-50">{s.card.length ? formatToPar(toPar(s.card)) : "E"}</span>
            <span className="shrink-0 text-[10px] text-ink-400">{done ? "✓" : `H${Math.min(s.hole, HOLE_COUNT - 1) + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hole intro                                                         */
/* ------------------------------------------------------------------ */

export function HoleIntro({ hud, reduced }: { hud: HudSnapshot; reduced: boolean }) {
  const hole = HOLES[hud.hole]!;
  return (
    <AnimatePresence>
      {hud.intro && (
        <motion.div
          key={`intro-${hud.hole}`}
          className="pointer-events-none absolute inset-x-0 top-[22%] z-30 flex justify-center px-6"
          initial={{ opacity: 0, y: reduced ? 0 : -24, scale: reduced ? 1 : 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: reduced ? 0 : -16, scale: reduced ? 1 : 1.05, transition: { duration: 0.25 } }}
          transition={spring.bouncy}
        >
          <div className="flex flex-col items-center text-center drop-shadow-[0_6px_20px_rgb(0_0_0/0.5)]">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.32em] text-white/85">
              Hole {hole.number} of {HOLE_COUNT}
            </p>
            <h2 className="mt-1 font-display text-[clamp(36px,11vw,60px)] font-extrabold leading-[0.95] tracking-tight text-white">{hole.name}</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className="rounded-full px-3 py-1 text-sm font-extrabold text-ink-950" style={{ background: hole.accent }}>
                Par {hole.par}
              </span>
            </div>
            <p className="mt-2 max-w-[18rem] text-sm font-semibold text-white/90">{hole.blurb}</p>
            <p className="mt-3 text-[11px] font-semibold text-white/60">Tap to skip</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Callouts                                                           */
/* ------------------------------------------------------------------ */

const TONE_CLASS: Record<Tone, string> = {
  ace: "bg-[linear-gradient(100deg,#fff6c2,#ffd23d_40%,#ff8a3d)] bg-clip-text text-transparent",
  great: "bg-[linear-gradient(100deg,#fff,#7cf2c8_45%,#3fa9ff)] bg-clip-text text-transparent",
  good: "bg-[linear-gradient(100deg,#fff,#b2f2a5_50%,#5fd35f)] bg-clip-text text-transparent",
  par: "text-white",
  meh: "text-white/90",
  bad: "text-white/80",
};

export function CalloutLayer({ hud, reduced }: { hud: HudSnapshot; reduced: boolean }) {
  const c = hud.callout;
  return (
    <>
      <AnimatePresence>
        {c && (
          <motion.div
            key={c.id}
            className="pointer-events-none absolute inset-x-0 top-[30%] z-30 flex flex-col items-center px-6 text-center"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.4, y: reduced ? 0 : 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 1.15, transition: { duration: 0.25 } }}
            transition={c.tone === "ace" ? spring.wobbly : spring.bouncy}
          >
            <p
              className={cn(
                "font-display font-extrabold italic leading-none tracking-tight drop-shadow-[0_6px_18px_rgb(0_0_0/0.55)]",
                c.tone === "ace" ? "text-[clamp(46px,15vw,84px)]" : "text-[clamp(40px,12vw,68px)]",
                TONE_CLASS[c.tone],
              )}
            >
              {c.label}
            </p>
            <p className="mt-2 rounded-full bg-ink-950/50 px-3 py-1 text-sm font-bold text-white backdrop-blur">
              {c.label === "Picked up" ? `Counts ${c.strokes}` : `${c.strokes} stroke${c.strokes === 1 ? "" : "s"}`}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {hud.splashId > 0 && hud.phase === "reset" && (
          <motion.div
            key={`splash-${hud.splashId}`}
            className="pointer-events-none absolute inset-x-0 top-[34%] z-30 flex flex-col items-center"
            initial={{ opacity: 0, y: 16, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10 }}
            transition={spring.bouncy}
          >
            <p className="font-display text-5xl font-extrabold italic text-sky-100 drop-shadow-[0_4px_14px_rgb(0_40_80/0.6)]">Splash!</p>
            <p className="mt-1 rounded-full bg-ink-950/55 px-3 py-1 text-sm font-bold text-white">+1 stroke penalty</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Hints                                                              */
/* ------------------------------------------------------------------ */

export function Hint({ hud, aiming, power, firstShot }: { hud: HudSnapshot; aiming: boolean; power: number; firstShot: boolean }) {
  let text: string | null = null;
  if (hud.phase === "aim" && !aiming && !hud.overview) text = firstShot ? "Drag back from the ball, let go to putt" : "Your shot";
  if (hud.phase === "aim" && aiming) text = power < 0.03 ? "Pull further to putt · drag back to the ball to cancel" : `${Math.round(power * 100)}% power`;
  if (hud.overview) text = "Overview · tap the button to go back";
  if (hud.spectator) text = "Watching";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[max(18px,env(safe-area-inset-bottom))] z-20 flex justify-center px-4">
      <AnimatePresence mode="wait">
        {text && (
          <motion.p
            key={aiming ? "aiming" : text}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={spring.snappy}
            className="rounded-full bg-ink-950/55 px-4 py-2 text-[13px] font-semibold text-ink-50 shadow-lg ring-1 ring-white/10 backdrop-blur-md"
          >
            {text}
            {!aiming && hud.phase === "aim" && firstShot && (
              <span className="hidden text-ink-300 [@media(pointer:fine)]:inline"> · or ←/→ ↑/↓ and Space</span>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scorecard                                                          */
/* ------------------------------------------------------------------ */

function Mark({ strokes, par }: { strokes: number; par: number }) {
  const m = scoreMark(strokes, par);
  return (
    <span
      className={cn(
        "inline-flex size-[22px] items-center justify-center text-[12px] font-extrabold tabular-nums",
        m === "ace" && "rounded-full bg-[linear-gradient(135deg,#fff3b0,#ffb020)] text-ink-950 shadow-[0_0_10px_#ffd23d]",
        m === "eagle" && "rounded-full text-rose-200 ring-2 ring-rose-300 ring-offset-1 ring-offset-transparent outline outline-1 outline-offset-2 outline-rose-300/70",
        m === "birdie" && "rounded-full text-rose-100 ring-2 ring-rose-400",
        m === "par" && "text-ink-50",
        m === "bogey" && "rounded-[4px] text-sky-100 ring-2 ring-sky-400/80",
        m === "double" && "rounded-[4px] bg-sky-500/25 text-sky-100 ring-2 ring-sky-400/80",
      )}
    >
      {strokes}
    </span>
  );
}

export function Scorecard({ seats, highlight, compact = false }: { seats: readonly Seat[]; highlight: number; compact?: boolean }) {
  const ranks = rankTotals(seats.filter((s) => s.card.length > 0).map((s) => ({ id: s.id, total: toPar(s.card) })));
  const ordered = [...seats].sort((a, b) => (ranks.get(a.id) ?? 99) - (ranks.get(b.id) ?? 99) || a.seat - b.seat);
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/10">
      <table className="w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className={compact ? "w-[64px] sm:w-[112px]" : "w-[84px] sm:w-[120px]"} />
          {HOLES.map((h) => (
            <col key={h.number} />
          ))}
          <col className="w-[40px]" />
        </colgroup>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
            <th className="py-1.5 pl-2.5 text-left">Hole</th>
            {HOLES.map((h, i) => (
              <th key={h.number} className={cn("py-1.5", i === highlight && "text-ink-50")}>
                {h.number}
              </th>
            ))}
            <th className="py-1.5 pr-1">Tot</th>
          </tr>
          <tr className="border-b border-white/10 text-[11px] font-semibold text-ink-400">
            <td className="pb-1.5 pl-2.5 text-left">Par</td>
            {HOLES.map((h) => (
              <td key={h.number} className="pb-1.5">
                {h.par}
              </td>
            ))}
            <td className="pb-1.5 pr-1">{TOTAL_PAR}</td>
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.id} className={cn("border-b border-white/5 last:border-0", s.isMe && "bg-white/[0.06]")}>
              <td className="py-1.5 pl-2.5 text-left">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                  <span className="truncate text-[12px] font-bold text-ink-100">{s.name}</span>
                </span>
              </td>
              {HOLES.map((h, i) => (
                <td key={h.number} className="py-1">
                  {s.card[i] !== undefined ? (
                    <motion.span
                      initial={i === highlight ? { scale: 0.3, opacity: 0 } : false}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ ...spring.bouncy, delay: 0.15 }}
                      className="inline-block"
                    >
                      <Mark strokes={s.card[i]!} par={h.par} />
                    </motion.span>
                  ) : (
                    <span className="text-[11px] text-ink-500">{i === Math.min(s.hole, HOLE_COUNT - 1) && s.card.length < HOLE_COUNT ? "•" : "·"}</span>
                  )}
                </td>
              ))}
              <td className="py-1.5 pr-1">
                <span className="block text-[12px] font-extrabold tabular-nums text-ink-50">{s.card.length ? cardTotal(s.card) : "–"}</span>
                <span className="block text-[9px] font-bold tabular-nums text-ink-400">{s.card.length ? formatToPar(toPar(s.card)) : ""}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Between holes: the card, and the next hole with an auto-advance ring. */
export function ScorecardSheet({ hud, onNext, reduced }: { hud: HudSnapshot; onNext: () => void; reduced: boolean }) {
  const open = hud.phase === "card";
  const next = HOLES[hud.hole + 1];
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [open]);
  const left = hud.cardDeadline ? Math.max(0, hud.cardDeadline - now) : 0;
  const frac = hud.cardDeadline ? left / 7000 : 0;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="sheet"
          className="absolute inset-0 z-40 flex flex-col justify-end bg-ink-950/35"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="mx-auto w-full max-w-xl rounded-t-[28px] bg-ink-900/95 px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_-10px_rgb(0_0_0/0.6)] ring-1 ring-white/10 backdrop-blur-xl sm:px-5"
            initial={{ y: reduced ? 0 : "100%" }}
            animate={{ y: 0 }}
            exit={{ y: reduced ? 0 : "100%" }}
            transition={spring.soft}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" />
            <div className="mb-3 flex items-baseline justify-between px-1">
              <h3 className="font-display text-xl font-extrabold tracking-tight">Scorecard</h3>
              <p className="text-xs font-semibold text-ink-300">
                After {hud.hole + 1} of {HOLE_COUNT}
              </p>
            </div>
            <Scorecard seats={hud.seats} highlight={hud.hole} compact />
            {next && (
              <div className="mt-4 flex items-center gap-3 px-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-400">Up next</p>
                  <p className="truncate text-sm font-bold text-ink-50">
                    Hole {next.number} · {next.name} · Par {next.par}
                  </p>
                </div>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={spring.snappy}
                  onClick={onNext}
                  autoFocus
                  className="relative flex h-12 shrink-0 items-center gap-2 rounded-full bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] pl-5 pr-2 text-sm font-extrabold text-ink-950 shadow-[0_10px_30px_-10px_var(--accent-to)]"
                >
                  Next hole
                  <svg viewBox="0 0 36 36" className="size-8 -rotate-90">
                    <circle cx="18" cy="18" r="14" fill="rgb(0 0 0 / 0.12)" />
                    <circle
                      cx="18"
                      cy="18"
                      r="14"
                      fill="none"
                      stroke="rgb(0 0 0 / 0.55)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={88}
                      strokeDashoffset={88 * (1 - frac)}
                    />
                  </svg>
                </motion.button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Final                                                              */
/* ------------------------------------------------------------------ */

export function FinalCard({ hud, onRetry }: { hud: HudSnapshot; onRetry: () => void }) {
  if (hud.phase !== "done") return null;
  const me = hud.seats.find((s) => s.isMe);
  const waiting = hud.seats.filter((s) => !s.isMe && s.card.length < HOLE_COUNT);
  const total = me ? cardTotal(me.card) : 0;
  const tp = me ? toPar(me.card) : 0;
  let rankLine: string | null = null;
  if (hud.result && me) {
    const rank = hud.result.ranks?.[me.id];
    if (hud.result.winnerId === me.id) rankLine = "You win the round!";
    else if (rank === 1) rankLine = "Tied for first";
    else if (rank) rankLine = `Finished ${ordinal(rank)}`;
  }
  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-center justify-center bg-ink-950/60 px-3 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <motion.div
        className="w-full max-w-xl rounded-[28px] bg-ink-900/95 p-4 text-center shadow-2xl ring-1 ring-white/10 sm:p-6"
        initial={{ y: 30, scale: 0.94 }}
        animate={{ y: 0, scale: 1 }}
        transition={spring.soft}
      >
        <p className="text-[11px] font-extrabold uppercase tracking-[0.28em] text-ink-400">Round complete</p>
        <div className="mt-1 flex items-end justify-center gap-3">
          <p className="font-display text-6xl font-extrabold leading-none tracking-tight tabular-nums">{total}</p>
          <p
            className={cn(
              "mb-1 rounded-full px-2.5 py-0.5 font-display text-lg font-extrabold tabular-nums",
              tp < 0 ? "bg-rose-500 text-white" : tp === 0 ? "bg-white/10 text-ink-50" : "bg-sky-500/20 text-sky-100",
            )}
          >
            {formatToPar(tp)}
          </p>
        </div>
        <p className="mt-1 text-sm font-semibold text-ink-300">
          {rankLine ?? (
            <>
              {total} strokes on a par {TOTAL_PAR}
            </>
          )}
        </p>
        <div className="mt-4">
          <Scorecard seats={hud.seats} highlight={-1} compact />
        </div>
        <div className="mt-4 text-sm font-semibold text-ink-300">
          {hud.submitError ? (
            <span className="inline-flex items-center gap-2 text-danger">
              Couldn&apos;t send your card.
              <button type="button" onClick={onRetry} className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-ink-50 ring-1 ring-white/15">
                Retry
              </button>
            </span>
          ) : hud.result ? (
            <span className="text-success">✓ Card signed</span>
          ) : waiting.length > 0 ? (
            <span>
              Waiting for {waiting.map((s) => s.name).join(", ")} to finish
              <AnimatedDots />
            </span>
          ) : (
            <span>
              Signing the card
              <AnimatedDots />
            </span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}
