"use client";

import type { MatchMode, MatchResult, PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { WaitingFor } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { TypingDots } from "./composer";
import { outcomeFor, reactionFor, voteTally } from "./logic";
import type { HotTakeEntry, HotTakePrompt, Side } from "./prompts";
import { TakeCard } from "./take-card";
import { SIDE_THEME } from "./theme";

export type LockedPhase = "waiting" | "voting" | "result";
export type OpponentProgress = "writing" | "typing" | "locked";

/**
 * After locking in: the take card drops and slams onto the stage (stamp,
 * dust, screen shake), then we wait for the opponent, watch the crowd judge,
 * and finally react to the verdict before the host's results screen.
 */
export function LockedView({
  prompt,
  entry,
  me,
  opponent,
  opponentSide,
  opponentProgress,
  mode,
  phase,
  result,
  opponentEntry,
  onSlam,
  haptic,
}: {
  prompt: HotTakePrompt;
  entry: HotTakeEntry | null;
  me: PlayerInfo;
  opponent?: PlayerInfo;
  opponentSide: Side;
  opponentProgress: OpponentProgress;
  mode: MatchMode;
  phase: LockedPhase;
  result: MatchResult | null;
  /** Known only for bots we drove ourselves. */
  opponentEntry: HotTakeEntry | null;
  onSlam: () => void;
  haptic: (style: "light" | "medium" | "heavy" | "success" | "error") => void;
}) {
  const reduce = useReducedMotion();
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [landed, setLanded] = useState(!entry);
  const landedRef = useRef(!entry);
  // Let the slam land before the verdict takes the stage.
  const outcome = result && landed ? outcomeFor(result, me.id) : null;

  const onLand = () => {
    if (landedRef.current) return;
    landedRef.current = true;
    setLanded(true);
    play("slam");
    haptic("heavy");
    onSlam();
    if (!reduce && scope.current) {
      void animate(scope.current, { x: [0, -9, 8, -5, 3, 0], y: [0, 7, -4, 2, 0] }, { duration: 0.42, ease: "easeOut" });
    }
  };

  return (
    <div ref={scope} className="flex h-full min-h-0 w-full flex-col overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-6 md:max-w-3xl md:flex-row md:items-center md:gap-10">
        <motion.div layout="position" transition={spring.layout} className="relative w-full md:flex-1">
          {entry ? (
            <motion.div
              initial={reduce ? { opacity: 0 } : { y: -170, scale: 1.45, rotate: -12, opacity: 0 }}
              animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
              transition={reduce ? { duration: 0.2 } : { duration: 0.34, ease: [0.55, 0, 0.95, 0.4] }}
              onAnimationComplete={onLand}
            >
              <motion.div
                animate={{
                  rotate: outcome === "lost" ? 3 : outcome === "won" ? -3 : -1.5,
                  y: outcome === "lost" ? 6 : 0,
                  scale: outcome === "won" ? 1.03 : 1,
                  filter: outcome === "lost" ? "saturate(0.55) brightness(0.85)" : "saturate(1) brightness(1)",
                }}
                transition={spring.wobbly}
              >
                <TakeCard prompt={prompt} side={entry.side} take={entry.take} spice={entry.spice} stamp="Locked in" />
              </motion.div>
            </motion.div>
          ) : (
            <SealedCard side={opponentSide === "for" ? "against" : "for"} />
          )}
          {landed && entry && !reduce && <DustPuff />}
        </motion.div>

        <motion.div layout="position" transition={spring.layout} className="flex w-full flex-col items-center gap-5 md:flex-1">
          <AnimatePresence mode="wait">
            {landed && phase === "waiting" && (
              <motion.div
                key="waiting"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
                transition={{ ...spring.soft, delay: entry ? 0.35 : 0 }}
                className="flex flex-col items-center gap-3"
              >
                <WaitingFor player={opponent} />
                <OpponentLine opponent={opponent} progress={opponentProgress} mode={mode} side={opponentSide} />
              </motion.div>
            )}
            {landed && phase === "voting" && <Judging key="voting" />}
            {phase === "result" && result && outcome && (
              <Reaction key="result" result={result} outcome={outcome} me={me} opponent={opponent} haptic={haptic} />
            )}
          </AnimatePresence>

          {outcome && opponentEntry && opponent && (
            <motion.div
              className="w-full [perspective:900px]"
              initial={{ opacity: 0, rotateX: 70, y: 20 }}
              animate={{ opacity: 1, rotateX: 0, y: 0 }}
              transition={{ ...spring.soft, delay: 0.9 }}
            >
              <p className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">
                <Avatar person={opponent} size={18} />
                @{opponent.handle} argued
              </p>
              <TakeCard compact prompt={prompt} side={opponentEntry.side} take={opponentEntry.take} spice={opponentEntry.spice} />
            </motion.div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function OpponentLine({
  opponent,
  progress,
  mode,
  side,
}: {
  opponent?: PlayerInfo;
  progress: OpponentProgress;
  mode: MatchMode;
  side: Side;
}) {
  if (!opponent) return null;
  const theme = SIDE_THEME[side];
  return (
    <div className="h-8" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={progress}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={spring.snappy}
          className="flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-xs text-ink-300 ring-1 ring-white/10"
        >
          {progress === "typing" && (
            <>
              <b className="text-ink-100">@{opponent.handle}</b> is typing <TypingDots />
            </>
          )}
          {progress === "locked" && (
            <>
              <span aria-hidden>🔒</span> <b className="text-ink-100">@{opponent.handle}</b> locked in their take
            </>
          )}
          {progress === "writing" &&
            (mode === "async" ? (
              <>
                Arguing{" "}
                <b className="font-display tracking-wide" style={{ color: theme.color }}>
                  {theme.label}
                </b>{" "}
                whenever they play — your take is sealed
              </>
            ) : (
              <>
                Still crafting the{" "}
                <b className="font-display tracking-wide" style={{ color: theme.color }}>
                  {theme.label}
                </b>{" "}
                case
              </>
            ))}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

function Judging() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
      transition={spring.soft}
      className="flex flex-col items-center gap-3 text-center"
    >
      <motion.div
        aria-hidden
        className="text-5xl drop-shadow-[0_0_24px_rgb(255_170_80/0.5)]"
        animate={{ rotate: [-14, 14, -14] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        ⚖️
      </motion.div>
      <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
        The Arena is judging
        <span className="block text-lg font-bold text-ink-300 sm:text-xl">— may the best argument win</span>
      </h2>
      <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-ink-200 ring-1 ring-white/10">
        <span className="relative flex size-2">
          <span className="absolute inset-0 animate-ping-soft rounded-full bg-[#ff9a3d]" />
          <span className="relative size-2 rounded-full bg-[#ff9a3d]" />
        </span>
        Crowd is voting
      </span>
    </motion.div>
  );
}

function Reaction({
  result,
  outcome,
  me,
  opponent,
  haptic,
}: {
  result: MatchResult;
  outcome: "won" | "lost" | "draw";
  me: PlayerInfo;
  opponent?: PlayerInfo;
  haptic: (style: "success" | "error" | "medium") => void;
}) {
  const reaction = reactionFor(outcome, result.matchId);
  const tally = voteTally(result, me.id, opponent?.id);

  useEffect(() => {
    // A beat after the slam so the two sounds don't collide.
    const id = setTimeout(() => {
      play(outcome === "won" ? "win" : outcome === "lost" ? "lose" : "draw");
      haptic(outcome === "won" ? "success" : outcome === "lost" ? "error" : "medium");
    }, 320);
    return () => clearTimeout(id);
    // Fire once per verdict.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: 0.3 }}
      className="flex flex-col items-center text-center"
      role="status"
    >
      <motion.div
        aria-hidden
        className="text-6xl"
        initial={{ scale: 0, rotate: -50 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ ...spring.wobbly, delay: 0.38 }}
      >
        {reaction.emoji}
      </motion.div>
      <h2
        className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl"
        style={
          outcome === "won"
            ? {
                backgroundImage: "linear-gradient(100deg, #ffd27a, var(--accent-from), var(--accent-to))",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }
            : undefined
        }
      >
        {reaction.title}
      </h2>
      <p className="mt-1 text-sm text-ink-300">{reaction.line}</p>
      {tally && (
        <p className="mt-3 rounded-full bg-white/[0.06] px-3 py-1 font-mono text-sm font-bold tabular text-ink-100 ring-1 ring-white/10">
          {tally.mine} – {tally.theirs} <span className="font-sans text-xs font-medium text-ink-300">votes</span>
        </p>
      )}
    </motion.div>
  );
}

function SealedCard({ side }: { side: Side }) {
  const theme = SIDE_THEME[side];
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.soft}
      className="glass-strong flex flex-col items-center gap-2 rounded-[22px] p-6 text-center"
      style={{ boxShadow: `0 0 0 1px ${theme.color}33` }}
    >
      <span aria-hidden className="text-4xl">
        📨
      </span>
      <p className="font-display text-xl font-extrabold tracking-tight">Your take is sealed</p>
      <p className="text-sm text-ink-300">
        You argued <b style={{ color: theme.color }}>{theme.label}</b>. The crowd sees it when voting opens.
      </p>
    </motion.div>
  );
}

/** Dust kicked up where the card hit the table. */
function DustPuff() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0">
      {Array.from({ length: 12 }, (_, i) => {
        const dir = i % 2 === 0 ? -1 : 1;
        const spread = 30 + ((i * 37) % 110);
        return (
          <motion.span
            key={i}
            className="absolute bottom-0 rounded-full"
            style={{
              left: `${50 + dir * (10 + ((i * 13) % 30))}%`,
              width: 10 + (i % 4) * 5,
              height: 10 + (i % 4) * 5,
              background: i % 3 === 0 ? "rgb(255 170 90 / 0.5)" : "rgb(200 190 210 / 0.35)",
              filter: "blur(3px)",
            }}
            initial={{ x: 0, y: 0, scale: 0.4, opacity: 0.9 }}
            animate={{ x: dir * spread, y: -8 - (i % 5) * 7, scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </div>
  );
}
