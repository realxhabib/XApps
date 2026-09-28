"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { DuelView } from "./duel";
import { MAX_ROUNDS, classify, resultLabel, type RoundOutcome, type RoundResult, type Side } from "./logic";

type TagTone = "light" | "danger" | "muted" | "ember";

interface Tag {
  text: string;
  tone: TagTone;
}

function resultTag(result: RoundResult): Tag {
  const kind = classify(result);
  return { text: resultLabel(result), tone: kind === "tap" ? "light" : kind === "false-start" ? "danger" : "muted" };
}

/** The little pill hanging under each player card: their result / live cue this round. */
function tagFor(side: Side, view: DuelView): Tag | null {
  const { phase, mine, opp, oppFired, oppFalseStart } = view;
  if (side === "me") {
    if ((phase === "shot" || phase === "reveal") && mine) return resultTag(mine);
    return null;
  }
  if (phase === "reveal" && opp) return resultTag(opp);
  if (phase === "steady" || phase === "draw" || phase === "shot") {
    if (oppFalseStart) return { text: "Too early", tone: "danger" };
    if (phase === "shot" && opp) return resultTag(opp);
    if (oppFired) return { text: "Fired!", tone: "ember" };
    if (phase === "shot") return { text: "Aiming…", tone: "muted" };
  }
  return null;
}

export function Scoreboard({
  view,
  me,
  opp,
  oppName,
}: {
  view: DuelView;
  me: PlayerInfo;
  opp: PlayerInfo;
  oppName: string;
}) {
  const over = view.phase === "final" || view.phase === "halted";
  const revealing = view.phase === "reveal" || view.phase === "final";
  const winner = revealing ? view.last?.winner ?? null : null;
  return (
    <header className="relative z-20 mx-auto flex w-full max-w-2xl items-stretch gap-2 px-3 pt-3 sm:gap-3 sm:px-5 sm:pt-4">
      <PlayerCard
        player={me}
        name="You"
        side="me"
        view={view}
        tag={tagFor("me", view)}
        glow={winner === "me"}
        dim={winner === "opp"}
      />
      <ScoreCenter me={view.score.me} opp={view.score.opp} round={view.round} over={over} oppName={oppName} />
      <PlayerCard
        player={opp}
        name={oppName}
        side="opp"
        align="right"
        view={view}
        tag={tagFor("opp", view)}
        glow={winner === "opp"}
        dim={winner === "me"}
      />
    </header>
  );
}

function PlayerCard({
  player,
  name,
  side,
  align = "left",
  view,
  tag,
  glow,
  dim,
}: {
  player: PlayerInfo;
  name: string;
  side: Side;
  align?: "left" | "right";
  view: DuelView;
  tag: Tag | null;
  glow: boolean;
  dim: boolean;
}) {
  const shaken = side === "opp" && view.oppFalseStart;
  return (
    <motion.div
      className={cn(
        "glass relative flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-2 py-2 sm:gap-3 sm:px-3 sm:py-2.5",
        align === "right" && "flex-row-reverse text-right",
      )}
      initial={false}
      animate={{
        boxShadow: glow
          ? "0 0 0 1.5px rgb(255 225 77 / 0.95), 0 14px 44px -12px rgb(255 122 26 / 0.95)"
          : "0 0 0 1.5px rgb(255 225 77 / 0), 0 14px 44px -12px rgb(255 122 26 / 0)",
        opacity: dim ? 0.55 : 1,
        scale: glow ? 1.035 : 1,
        x: shaken ? [0, -5, 5, -3, 2, 0] : 0,
      }}
      transition={{ ...spring.soft, x: { duration: 0.4 } }}
    >
      <Avatar person={player} size={38} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-tight text-ink-50 sm:text-sm">{name}</p>
        <RoundPips
          outcomes={view.outcomes}
          side={side}
          round={view.round}
          align={align}
          over={view.phase === "final" || view.phase === "halted"}
        />
      </div>

      <div className={cn("pointer-events-none absolute -bottom-3 flex", align === "right" ? "right-3" : "left-3")}>
        <AnimatePresence mode="popLayout">
          {tag && (
            <motion.span
              key={tag.text}
              initial={{ opacity: 0, y: -6, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.8 }}
              transition={spring.bouncy}
              className={cn(
                "whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[11px] font-bold tabular shadow-lg",
                tag.tone === "light" && "bg-ink-50 text-ink-950",
                tag.tone === "danger" && "bg-danger text-white",
                tag.tone === "muted" && "bg-ink-700 text-ink-200",
                tag.tone === "ember" && "bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-ink-950",
              )}
            >
              {tag.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

    </motion.div>
  );
}

/** Five pips per player — one per round: won, lost, void, live, or still to come. */
function RoundPips({
  outcomes,
  side,
  round,
  align,
  over,
}: {
  outcomes: readonly RoundOutcome[];
  side: Side;
  round: number;
  align: "left" | "right";
  over: boolean;
}) {
  const wins = outcomes.filter((o) => o.winner === side).length;
  return (
    <div
      role="img"
      aria-label={`${wins} of 3 round wins`}
      className={cn("mt-1.5 flex gap-[3px] min-[380px]:gap-1.5", align === "right" && "justify-end")}
    >
      {Array.from({ length: MAX_ROUNDS }, (_, i) => {
        const o = outcomes[i];
        const state: PipState = o
          ? o.winner === side
            ? "won"
            : o.winner === "none"
              ? "void"
              : "lost"
          : i + 1 === round && !over
            ? "live"
            : "pending";
        return <Pip key={i} state={state} />;
      })}
    </div>
  );
}

type PipState = "won" | "lost" | "void" | "live" | "pending";

function Pip({ state }: { state: PipState }) {
  return (
    <span className="relative inline-block size-[7px] shrink-0 rounded-full border border-white/15 min-[380px]:size-2.5 sm:size-3">
      <AnimatePresence>
        {state === "won" && (
          <motion.span
            key="won"
            className="absolute -inset-px rounded-full bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] shadow-[0_0_10px_var(--accent-from)]"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={spring.wobbly}
          />
        )}
        {state === "lost" && (
          <motion.span
            key="lost"
            className="absolute inset-[2px] rounded-full bg-white/30"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={spring.snappy}
          />
        )}
        {state === "void" && (
          <motion.span
            key="void"
            className="absolute inset-x-[1px] top-1/2 h-[1.5px] -translate-y-1/2 rounded bg-white/45"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={spring.snappy}
          />
        )}
        {state === "live" && (
          <motion.span
            key="live"
            className="absolute -inset-[3px] rounded-full border-[1.5px] border-[var(--accent-from)]"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: [0.35, 1, 0.35], scale: 1 }}
            // Explicit exit timing: the infinite opacity loop would otherwise never let it leave.
            exit={{ opacity: 0, scale: 1.8, transition: { duration: 0.35, ease: "easeOut" } }}
            transition={{ opacity: { duration: 1.1, repeat: Infinity }, scale: spring.bouncy }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}

function ScoreCenter({
  me,
  opp,
  round,
  over,
  oppName,
}: {
  me: number;
  opp: number;
  round: number;
  over: boolean;
  oppName: string;
}) {
  return (
    <div
      className="flex shrink-0 flex-col items-center justify-center px-0.5"
      role="status"
      aria-label={`Score: you ${me}, ${oppName} ${opp}`}
    >
      <div className="flex items-center gap-1 font-mono text-2xl font-bold leading-none tabular sm:text-3xl">
        <Digit value={me} />
        <span className="text-ink-500">:</span>
        <Digit value={opp} />
      </div>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-400">
        {over ? "Final" : round > 0 ? `R${round}/${MAX_ROUNDS}` : "Bo5"}
      </p>
    </div>
  );
}

function Digit({ value }: { value: number }) {
  return (
    <span className="relative inline-flex">
      <span className="relative inline-flex h-[1em] w-[0.62em] justify-center overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: "-100%", opacity: 0, scale: 1.5 }}
            animate={{ y: "0%", opacity: 1, scale: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={spring.bouncy}
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      {/* "+1" bursts out below the digit that just went up. */}
      <span className="pointer-events-none absolute left-1/2 top-full -translate-x-1/2">
        <AnimatePresence>
          {value > 0 && (
            <motion.span
              key={value}
              aria-hidden
              className="block font-display text-base font-extrabold text-[var(--accent-from)] [text-shadow:0_0_12px_rgb(255_122_26/0.9)]"
              initial={{ opacity: 0, y: -10, scale: 0.4 }}
              animate={{ opacity: [0, 1, 1, 0], y: [-10, 4, 8, 18], scale: [0.4, 1.3, 1, 0.9] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.3, times: [0, 0.2, 0.7, 1], ease: "easeOut" }}
            >
              +1
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </span>
  );
}
