"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode, RefObject } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { fadeUp, spring, staggerChildren } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { POWER, powerGauge, type PowerVerdict } from "./aim";
import { hitTest, type Point } from "./board";
import { BoardView } from "./board-view";
import { HandDart, flightColor } from "./dart";
import { DARTS_PER_ROUND, ROUNDS, dartTone, ordinal, type Callout } from "./logic";

/* ---------------------------------------------------------------------- */
/* Pre-game                                                                */
/* ---------------------------------------------------------------------- */

const PREVIEW_DARTS = [
  { key: "a", at: { x: 1.5, y: -102.5 }, color: flightColor(0), spin: 0.2, fresh: false },
  { key: "b", at: { x: -4.2, y: -104 }, color: flightColor(0), spin: 1.1, fresh: false },
  { key: "c", at: { x: 2.4, y: 1.4 }, color: flightColor(1), spin: 2.3, fresh: false },
];

export function Pregame({ players, meId, names }: { players: PlayerInfo[]; meId: string; names: (p: PlayerInfo) => string }) {
  return (
    <Screen className="py-4">
      <motion.div
        className="flex flex-col items-center gap-4 text-center [@media(max-height:640px)]:gap-2.5"
        variants={staggerChildren(0.05)}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeUp}>
          <Eyebrow>Score attack · 9 darts each</Eyebrow>
        </motion.div>
        <motion.h1
          variants={fadeUp}
          className="font-display text-[clamp(44px,13vw,72px)] font-extrabold leading-[0.9] tracking-tight"
        >
          <span className="bg-[linear-gradient(100deg,#fff5dc,var(--accent-from)_45%,var(--accent-to))] bg-clip-text text-transparent">
            Darts
          </span>
        </motion.h1>
        <motion.div variants={fadeUp} className="relative [@media(max-height:640px)]:hidden">
          <div
            aria-hidden
            className="absolute -inset-[18%] rounded-full opacity-40 blur-2xl"
            style={{ background: "radial-gradient(circle, var(--accent-from), transparent 65%)" }}
          />
          <motion.div animate={{ rotate: [-2, 2, -2] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}>
            <BoardView
              size={176}
              darts={PREVIEW_DARTS}
              holes={[]}
              pops={[]}
              flight={null}
              aiming={false}
              pulling={false}
              reduced
              onPopDone={() => {}}
              label="A dartboard"
            />
          </motion.div>
        </motion.div>
        <motion.ol variants={fadeUp} className="grid max-w-[21rem] gap-1.5 text-left text-sm leading-snug text-ink-300">
          <li>
            <b className="text-ink-50">Hold</b> to raise a dart. Your hand sways: steer against it.
          </li>
          <li>
            <b className="text-ink-50">Flick up</b> to throw. Too soft drops low, too hard sails high.
          </li>
          <li>
            Tap <b className="text-[#7fe7ff]">Breathe</b> to steady your aim for a moment.
          </li>
        </motion.ol>
        <motion.div variants={fadeUp} className="flex flex-wrap items-start justify-center gap-3">
          {players.map((p) => (
            <div key={p.id} className="flex w-[4.5rem] flex-col items-center gap-1.5">
              <div className="relative">
                <Avatar person={p} size={40} />
                <span
                  className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-ink-950"
                  style={{ background: flightColor(p.seat) }}
                />
              </div>
              <span className="w-full truncate text-xs font-semibold text-ink-200">{p.id === meId ? "You" : names(p)}</span>
            </div>
          ))}
        </motion.div>
        <motion.p variants={fadeUp} className="text-sm font-semibold text-ink-100">
          Get ready
          <AnimatedDots />
        </motion.p>
      </motion.div>
    </Screen>
  );
}

/* ---------------------------------------------------------------------- */
/* Tray: this round's three darts, the round and the total                 */
/* ---------------------------------------------------------------------- */

export function Tray({
  darts,
  roundStart,
  round,
  total,
  power,
}: {
  darts: Point[];
  roundStart: number;
  round: number;
  total: number;
  power: { id: number; verdict: PowerVerdict; speed: number } | null;
}) {
  const current = darts.slice(roundStart, roundStart + DARTS_PER_ROUND);
  const roundSum = current.reduce((s, p) => s + hitTest(p).score, 0);
  return (
    <div className="mx-auto flex w-full max-w-md items-center gap-2 px-3 py-1.5" data-testid="tray">
      <div className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: DARTS_PER_ROUND }, (_, i) => {
          const p = current[i];
          const hit = p ? hitTest(p) : null;
          const tone = hit ? dartTone(hit) : null;
          return (
            <motion.div
              key={`${roundStart}-${i}`}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.bouncy}
              className={cn(
                "flex h-10 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border text-center leading-none",
                hit ? "border-white/15 bg-white/[0.07]" : "border-dashed border-white/10 bg-transparent",
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                {hit ? (
                  <motion.span
                    key="hit"
                    initial={{ scale: 1.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={spring.bouncy}
                    className={cn(
                      "font-display text-[15px] font-extrabold",
                      tone === "treble" && "text-gold",
                      tone === "double" && "text-success",
                      tone === "bull" && "text-[#ff5a68]",
                      tone === "single" && "text-ink-50",
                      tone === "miss" && "text-ink-400",
                    )}
                  >
                    {hit.label}
                  </motion.span>
                ) : (
                  <motion.span key="empty" className="text-[11px] font-semibold text-ink-500">
                    {i + 1}
                  </motion.span>
                )}
              </AnimatePresence>
              {hit && hit.score > 0 && hit.label !== String(hit.score) && (
                <span className="mt-0.5 text-[10px] font-semibold tabular text-ink-300">{hit.score}</span>
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="flex w-[5.5rem] shrink-0 flex-col items-end leading-tight">
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-400">
          Round {Math.min(ROUNDS, round + 1)}/{ROUNDS}
        </span>
        <span className="font-display text-[15px] font-extrabold tabular text-ink-100">
          {roundSum} <span className="text-[11px] font-semibold text-ink-400">· {total}</span>
        </span>
        <PowerChip power={power} />
      </div>
    </div>
  );
}

function PowerChip({ power }: { power: { id: number; verdict: PowerVerdict; speed: number } | null }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {power && (
        <motion.span
          key={power.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={spring.snappy}
          className={cn(
            "text-[10px] font-bold",
            power.verdict === "good" ? "text-success" : power.verdict === "soft" ? "text-[#7fb4ff]" : "text-ember",
          )}
          data-testid="power"
        >
          {power.verdict === "good" ? "Clean flick" : power.verdict === "soft" ? "Soft · dropped" : "Hard · sailed"}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------- */
/* Throwing zone                                                           */
/* ---------------------------------------------------------------------- */

export function ThrowZone({
  color,
  held,
  visible,
  handRef,
  hint,
  breath,
  onBreath,
  charge,
  chargeRef,
  showGuide,
  reduced,
}: {
  color: string;
  held: boolean;
  visible: boolean;
  handRef: RefObject<HTMLDivElement | null>;
  hint: ReactNode;
  breath: "ready" | "held" | "spent";
  onBreath: () => void;
  charge: boolean;
  chargeRef: RefObject<HTMLDivElement | null>;
  showGuide: boolean;
  reduced: boolean;
}) {
  return (
    <div className="relative z-10 min-h-[150px] w-full flex-1 overflow-hidden" data-testid="throw-zone">
      {/* The oche: floorboards running away from you, a brass throw line, lamp light spilling down. */}
      <div aria-hidden className="absolute inset-0 overflow-hidden [perspective:420px]">
        <div
          className="absolute -inset-x-1/2 -bottom-[300%] top-0 origin-top [transform:rotateX(58deg)]"
          style={{
            background:
              "repeating-linear-gradient(90deg, #2b1d13 0 46px, #21160e 46px 48px, #332318 48px 94px, #1d130c 94px 96px)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 55% at 50% 0%, rgb(255 206 140 / 0.16), transparent 70%), linear-gradient(to bottom, rgb(5 6 10 / 0.55), rgb(5 6 10 / 0.15) 35%, rgb(5 6 10 / 0.65))",
          }}
        />
      </div>
      <div
        aria-hidden
        className="absolute inset-x-[10%] top-2 h-[5px] rounded-full bg-[linear-gradient(to_bottom,#ffe6a3,#b8862e_55%,#6d4b17)] shadow-[0_2px_10px_rgb(255_190_90/0.35)]"
      />

      {/* The hand dart: raised while held. Its transform is written by the aiming loop. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[26%]">
        <div ref={handRef} className="absolute bottom-0 left-1/2 h-full w-0" style={{ willChange: "transform" }}>
          <motion.div
            className="absolute bottom-[-12px] left-0 aspect-[44/176] h-full max-h-[220px] origin-bottom"
            style={{ x: "-50%" }}
            initial={false}
            animate={
              !visible
                ? { y: 120, opacity: 0, scale: 0.9, rotate: 0 }
                : held
                  ? { y: -26, opacity: 1, scale: 1.08, rotate: 0 }
                  : { y: -4, opacity: 1, scale: 1, rotate: -7 }
            }
            transition={reduced ? { duration: 0.1 } : spring.soft}
          >
            <HandDart color={color} className="size-full drop-shadow-[0_14px_20px_rgb(0_0_0/0.7)]" />
          </motion.div>
        </div>
      </div>

      {showGuide && !held && visible && <FlickGuide reduced={reduced} />}

      <div className="absolute inset-x-0 top-5 flex justify-center px-6 text-center">
        <AnimatePresence mode="wait" initial={false}>
          {hint && (
            <motion.p
              key={typeof hint === "string" ? hint : "hint"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
              transition={spring.soft}
              className="text-[13px] font-semibold text-ink-200 [text-shadow:0_1px_6px_rgb(0_0_0/0.8)]"
            >
              {hint}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {visible && <BreathButton state={breath} enabled={held} onBreath={onBreath} />}
      {charge && <ChargeMeter chargeRef={chargeRef} />}
    </div>
  );
}

/** "Hold, then flick up" demo for the very first dart. */
function FlickGuide({ reduced }: { reduced: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute bottom-[18%] left-[calc(50%+46px)] text-3xl"
      initial={{ opacity: 0 }}
      animate={
        reduced
          ? { opacity: 0.9 }
          : { opacity: [0, 1, 1, 1, 0], y: [10, 10, 10, -46, -60], scale: [1, 0.9, 0.9, 1, 1] }
      }
      transition={reduced ? { duration: 0.3 } : { duration: 2.2, times: [0, 0.15, 0.55, 0.72, 1], repeat: Infinity, repeatDelay: 0.4 }}
    >
      👆
    </motion.div>
  );
}

function BreathButton({ state, enabled, onBreath }: { state: "ready" | "held" | "spent"; enabled: boolean; onBreath: () => void }) {
  const usable = enabled && state === "ready";
  return (
    <button
      type="button"
      data-no-aim
      aria-label="Hold your breath to steady your aim"
      aria-disabled={!usable}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (usable) onBreath();
      }}
      onClick={(e) => {
        // Keyboard / assistive activation only; pointers act on pointerdown.
        if (e.detail === 0 && usable) onBreath();
      }}
      className={cn(
        "absolute bottom-7 right-3 flex size-[62px] flex-col items-center justify-center gap-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-[opacity,background-color,border-color] duration-200 sm:right-6",
        state === "held"
          ? "border-[#7fe7ff]/70 bg-[#7fe7ff]/20 text-[#bff4ff] shadow-[0_0_24px_rgb(127_231_255/0.45)]"
          : usable
            ? "border-white/20 bg-white/[0.08] text-ink-100"
            : "border-white/10 bg-white/[0.03] text-ink-500",
        !enabled && state !== "held" && "opacity-60",
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M3 8h10a3 3 0 1 0-3-3" />
        <path d="M3 12h15a3 3 0 1 1-3 3" />
        <path d="M3 16h6" />
      </svg>
      {state === "spent" ? "Used" : "Breathe"}
      {state === "held" && (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full border-2 border-[#7fe7ff]"
          initial={{ opacity: 1, scale: 1 }}
          animate={{ opacity: 0, scale: 1.5 }}
          transition={{ duration: 1.1, repeat: Infinity }}
        />
      )}
    </button>
  );
}

/** Keyboard throws: the power bar swings while Space is held. */
function ChargeMeter({ chargeRef }: { chargeRef: RefObject<HTMLDivElement | null> }) {
  const low = powerGauge(POWER.low);
  const high = powerGauge(POWER.high);
  return (
    <div className="absolute bottom-6 left-4 flex h-[100px] w-4 flex-col-reverse overflow-hidden rounded-full border border-white/20 bg-black/40 sm:left-8" aria-hidden>
      {/* chargeToSpeed spends 80% of the gauge over the bar, so the sweet spot sits at gauge / 0.8. */}
      <div className="absolute inset-x-0 bg-success/35" style={{ bottom: `${(low / 0.8) * 100}%`, height: `${((high - low) / 0.8) * 100}%` }} />
      <div ref={chargeRef} className="relative w-full rounded-full bg-[linear-gradient(to_top,var(--accent-to),var(--accent-from))]" style={{ height: "0%" }} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Round callout and the final panel                                       */
/* ---------------------------------------------------------------------- */

export function CalloutBanner({ callout, reduced }: { callout: (Callout & { id: number }) | null; reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-live="polite">
      <AnimatePresence>
        {callout && (
          <motion.div
            key={callout.id}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.5, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 1.15, transition: { duration: 0.2 } }}
            transition={callout.tone === "legend" ? spring.wobbly : spring.bouncy}
            className="flex max-w-[90%] flex-col items-center rounded-3xl bg-ink-950/75 px-6 py-3 text-center shadow-[0_20px_60px_-10px_rgb(0_0_0/0.8)] ring-1 ring-white/10 backdrop-blur-md"
            data-testid="callout"
          >
            <span
              className={cn(
                "font-display font-extrabold leading-[0.95] tracking-tight",
                callout.tone === "legend"
                  ? "bg-[linear-gradient(100deg,#fff6d0,#ffc93d_40%,#ff7a1a)] bg-clip-text text-[clamp(28px,8.5vw,44px)] text-transparent"
                  : callout.tone === "hot"
                    ? "text-[clamp(30px,9vw,44px)] text-[var(--accent-from)]"
                    : callout.tone === "good"
                      ? "text-[clamp(30px,9vw,42px)] text-ink-50"
                      : callout.tone === "cold"
                        ? "text-[clamp(24px,7vw,34px)] text-ink-300"
                        : "text-[clamp(28px,8vw,38px)] text-ink-100",
              )}
            >
              {callout.text}
            </span>
            {callout.sub && <span className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-ink-300">{callout.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface Standing {
  id: string;
  name: string;
  color: string;
  score: number;
  rank: number;
  isMe: boolean;
}

export function FinalPanel({
  total,
  roundScores,
  standings,
  status,
  headline,
}: {
  total: number;
  roundScores: number[];
  standings: Standing[] | null;
  status: ReactNode;
  headline: string | null;
}) {
  return (
    // Phones: over the throwing zone. Wide screens: beside the board, so the darts stay in view.
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center lg:inset-x-auto lg:bottom-auto lg:right-8 lg:top-1/2 lg:-translate-y-1/2">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.soft}
        className="glass pointer-events-auto w-full max-w-sm rounded-3xl px-4 py-3 text-center shadow-[0_24px_80px_-20px_rgb(0_0_0/0.9)] lg:w-[21rem]"
        data-testid="final-panel"
      >
        {headline && (
          <motion.p
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring.wobbly}
            className="font-display text-[26px] font-extrabold leading-tight text-[var(--accent-from)]"
          >
            {headline}
          </motion.p>
        )}
        <div className="flex items-end justify-center gap-3">
          <div>
            <Eyebrow>Your 9 darts</Eyebrow>
            <p className="font-display text-[40px] font-extrabold leading-none tabular text-ink-50">{total}</p>
          </div>
          <div className="mb-1 flex gap-1">
            {roundScores.map((s, i) => (
              <span key={i} className="rounded-lg bg-white/[0.07] px-2 py-1 text-xs font-bold tabular text-ink-200">
                {s}
              </span>
            ))}
          </div>
        </div>
        {standings && standings.length > 0 && (
          <ol className="mt-2 grid gap-1 text-left">
            {standings.map((s) => (
              <li
                key={s.id}
                className={cn("flex items-center gap-2 rounded-xl px-2 py-1 text-sm", s.isMe ? "bg-white/[0.09] font-bold" : "text-ink-200")}
              >
                <span className="w-8 text-xs font-bold text-ink-400">{ordinal(s.rank)}</span>
                <span className="size-2 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="font-display font-extrabold tabular">{s.score}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-2 text-xs text-ink-300">{status}</div>
      </motion.div>
    </div>
  );
}
