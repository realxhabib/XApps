"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots, Eyebrow } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { MAX_ROUNDS, bestMs, classify, type RoundOutcome, type RoundResult, type RoundWinner, type Score } from "./logic";

function cell(result: RoundResult): string {
  const kind = classify(result);
  if (kind === "false-start") return "early";
  if (kind === "miss") return "—";
  return String(result.ms);
}

/**
 * The short "duel over" state. The host covers the app with its own results
 * screen about a second after the match settles, so this stays compact.
 */
export function FinalPanel({
  outcomes,
  score,
  winner,
  me,
  opp,
  oppName,
  status,
  reduced,
}: {
  outcomes: readonly RoundOutcome[];
  score: Score;
  winner: RoundWinner;
  me: PlayerInfo;
  opp: PlayerInfo;
  oppName: string;
  status: ReactNode;
  reduced: boolean;
}) {
  const myBest = bestMs(outcomes.map((o) => o.me));
  const oppBest = bestMs(outcomes.map((o) => o.opp));
  const bestRound = myBest === null ? null : outcomes.find((o) => !o.me.falseStart && o.me.ms === myBest)?.round ?? null;
  const title = winner === "me" ? "You win the duel" : winner === "opp" ? `${oppName} wins` : "Dead heat";

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 pb-5 pt-6 text-center [@media(max-height:560px)]:gap-2.5 [@media(max-height:560px)]:pt-4">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <Eyebrow>Duel over</Eyebrow>
      </motion.div>

      <motion.h2
        className={cn(
          "max-w-[14ch] font-display text-[clamp(34px,10vw,60px)] font-extrabold leading-[0.95] tracking-tight [@media(max-height:560px)]:text-[34px]",
          winner === "me"
            ? "bg-[linear-gradient(100deg,#fff8d6,var(--accent-from)_40%,var(--accent-to))] bg-clip-text text-transparent"
            : "text-ink-50",
        )}
        initial={{ opacity: 0, scale: reduced ? 1 : 2.2, filter: reduced ? "blur(0px)" : "blur(14px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={{ scale: { type: "spring", stiffness: 420, damping: 22 }, opacity: { duration: 0.15 }, filter: { duration: 0.3 } }}
      >
        {title}
      </motion.h2>

      <motion.div
        className="flex items-center gap-3 sm:gap-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.12 }}
      >
        <FinalAvatar player={me} crowned={winner === "me"} />
        <p className="font-mono text-[clamp(32px,9vw,48px)] font-bold leading-none tabular [@media(max-height:560px)]:text-3xl">
          <span className={winner === "me" ? "text-[var(--accent-from)]" : "text-ink-50"}>{score.me}</span>
          <span className="mx-1.5 text-ink-500">:</span>
          <span className={winner === "opp" ? "text-[var(--accent-from)]" : "text-ink-50"}>{score.opp}</span>
        </p>
        <FinalAvatar player={opp} crowned={winner === "opp"} />
      </motion.div>

      {/* Best time, in gold */}
      <motion.div
        className="relative w-full max-w-xs overflow-hidden rounded-2xl border border-[rgb(255_201_61/0.45)] bg-[linear-gradient(135deg,rgb(255_201_61/0.16),rgb(255_122_26/0.08))] px-4 py-3 shadow-[0_0_40px_-12px_rgb(255_201_61/0.7)] [@media(max-height:560px)]:py-2"
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ ...spring.bouncy, delay: 0.22 }}
      >
        {!reduced && (
          <motion.span
            aria-hidden
            className="absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-20deg] bg-white/15 blur-md"
            initial={{ x: 0 }}
            animate={{ x: "480%" }}
            transition={{ duration: 1.1, delay: 0.5, ease: "easeInOut" }}
          />
        )}
        {myBest !== null ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-left">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold">⚡ Your fastest draw</p>
              <p className="mt-0.5 text-xs font-semibold text-ink-200">Round {bestRound}</p>
              {oppBest !== null && (
                <p className="truncate text-[11px] text-ink-400">
                  {oppName}&apos;s best: {oppBest} ms
                </p>
              )}
            </div>
            <p className="font-mono text-3xl font-bold tabular text-gold">
              {myBest}
              <span className="ml-0.5 text-base">ms</span>
            </p>
          </div>
        ) : (
          <p className="text-sm font-semibold text-ink-200">No clean draws this time — patience is a weapon.</p>
        )}
      </motion.div>

      {/* Round by round */}
      <motion.div
        role="group"
        aria-label="Round by round reaction times"
        className="grid w-full max-w-sm grid-cols-[auto_repeat(5,minmax(0,1fr))] items-center gap-x-1.5 gap-y-1 [@media(max-height:560px)]:hidden"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.3 } } }}
      >
        <span />
        {Array.from({ length: MAX_ROUNDS }, (_, i) => (
          <span key={`h${i}`} className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
            R{i + 1}
          </span>
        ))}
        {(["me", "opp"] as const).map((side) => (
          <Row key={side} side={side} label={side === "me" ? "You" : oppName} outcomes={outcomes} best={side === "me" ? myBest : null} />
        ))}
      </motion.div>

      <div className="min-h-6 text-sm text-ink-300" aria-live="polite">
        {status}
      </div>
    </div>
  );
}

function Row({
  side,
  label,
  outcomes,
  best,
}: {
  side: "me" | "opp";
  label: string;
  outcomes: readonly RoundOutcome[];
  best: number | null;
}) {
  return (
    <>
      <span className="max-w-[4.5rem] truncate pr-1 text-left text-[11px] font-semibold text-ink-300">{label}</span>
      {Array.from({ length: MAX_ROUNDS }, (_, i) => {
        const o = outcomes[i];
        const result = o ? o[side] : null;
        const won = o?.winner === side;
        const isBest = best !== null && !!result && !result.falseStart && result.ms === best;
        return (
          <motion.span
            key={i}
            variants={{ hidden: { opacity: 0, y: 8, scale: 0.8 }, show: { opacity: 1, y: 0, scale: 1, transition: spring.bouncy } }}
            className={cn(
              "rounded-lg py-1 font-mono text-[12px] font-bold tabular",
              !o && "text-ink-600",
              o && !won && "bg-white/[0.04] text-ink-400",
              won && "bg-[linear-gradient(135deg,rgb(255_225_77/0.22),rgb(255_122_26/0.14))] text-[var(--accent-from)]",
              isBest && "ring-1 ring-gold shadow-[0_0_14px_-2px_rgb(255_201_61/0.8)]",
              result?.falseStart && "text-danger",
            )}
          >
            {result ? cell(result) : "·"}
          </motion.span>
        );
      })}
    </>
  );
}

function FinalAvatar({ player, crowned }: { player: PlayerInfo; crowned: boolean }) {
  return (
    <span className="relative">
      <Avatar person={player} size={44} className={cn(!crowned && "opacity-70")} />
      {crowned && (
        <motion.span
          aria-hidden
          className="absolute -top-4 left-1/2 -ml-2.5 text-xl"
          initial={{ y: -14, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: -12 }}
          transition={{ ...spring.wobbly, delay: 0.35 }}
        >
          👑
        </motion.span>
      )}
    </span>
  );
}

/** Small inline "waiting" line for the status slot. */
export function WaitingLine({ name }: { name: string }) {
  return (
    <span>
      Waiting for <b className="text-ink-50">{name}</b> to finish
      <AnimatedDots />
    </span>
  );
}
