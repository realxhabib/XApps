"use client";

import { motion, useReducedMotion } from "motion/react";
import { Home, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { EntryView } from "@/components/arena/entry-view";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { celebrate } from "@/components/motion/confetti";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { levelInfo } from "@/platform/scoring";
import type { AppManifest, Match, MatchPlayer, Profile } from "@/platform/types";

type Outcome = "win" | "loss" | "draw" | "spectator";

const TITLES: Record<Outcome, string> = { win: "Victory", loss: "Defeat", draw: "Draw", spectator: "Final" };

export function ResultsOverlay({
  app,
  match,
  viewer,
  onRematch,
  onShare,
  onHome,
  rematching,
}: {
  app: AppManifest;
  match: Match;
  viewer: Profile | null;
  onRematch?: () => void;
  onShare: () => void;
  onHome: () => void;
  rematching?: boolean;
}) {
  const reduced = useReducedMotion();
  const me = match.players.find((p) => p.userId === viewer?.id);
  const outcome: Outcome = !me ? "spectator" : !match.winnerId ? "draw" : match.winnerId === me.userId ? "win" : "loss";
  const players = [...match.players].sort((a, b) => a.seat - b.seat);
  const votes = match.scoring === "votes";

  useEffect(() => {
    const t = setTimeout(() => {
      if (outcome === "win") {
        play("win");
        haptic("success");
        celebrate({ pattern: "cannons", count: 160, colors: [app.accent[0], app.accent[1], "#ffc93d", "#ffffff", "#c6ff3d"] });
      } else if (outcome === "loss") {
        play("lose");
        haptic("error");
      } else {
        play("notify");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [app.accent, outcome]);

  const xpAfter = viewer?.xp ?? 0;
  const xpDelta = me?.xpDelta ?? 0;
  const before = levelInfo(Math.max(0, xpAfter - xpDelta));
  const after = levelInfo(xpAfter);
  const leveledUp = after.level > before.level;

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex overflow-y-auto px-4 py-10"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label={`${TITLES[outcome]} — ${app.name}`}
    >
      <motion.div
        className="fixed inset-0 bg-ink-950/80 backdrop-blur-2xl"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      {outcome === "win" && !reduced && (
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[18%] size-[140vmax] -translate-x-1/2 -translate-y-1/2">
          <div
            className="size-full animate-spin-slow opacity-40"
            style={{
              background:
                "repeating-conic-gradient(from 0deg, rgb(255 201 61 / 0.35) 0deg 8deg, transparent 8deg 22deg)",
              maskImage: "radial-gradient(circle, #000 0%, transparent 45%)",
            }}
          />
        </div>
      )}

      {/* m-auto centers when it fits and scrolls from the top when it doesn't */}
      <div className="relative m-auto w-full max-w-2xl text-center">
        <motion.p
          className="text-xs font-bold uppercase tracking-[0.3em] text-ink-300"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {app.name} · {match.mode === "practice" ? "Practice" : votes ? "Crowd verdict" : "Final"}
        </motion.p>
        <motion.h2
          className={cn(
            "mt-2 font-display text-7xl font-extrabold uppercase italic tracking-tighter sm:text-8xl",
            outcome === "win" && "bg-[linear-gradient(120deg,#fff3c4,#ffc93d_40%,#ff9a3d)] bg-clip-text text-transparent drop-shadow-[0_0_40px_rgb(255_201_61/0.45)]",
            outcome === "loss" && "text-ink-300",
            outcome === "draw" && "text-ink-50",
            outcome === "spectator" && "text-ink-50",
          )}
          style={{ fontVariationSettings: "'wdth' 78" }}
          initial={{ scale: reduced ? 1 : 1.9, opacity: 0, filter: "blur(16px)" }}
          animate={
            outcome === "loss" && !reduced
              ? { scale: 1, opacity: 1, filter: "blur(0px)", x: [0, -10, 8, -5, 0] }
              : { scale: 1, opacity: 1, filter: "blur(0px)" }
          }
          transition={{ type: "spring", stiffness: 300, damping: 18, delay: 0.2, x: { duration: 0.5, delay: 0.45, ease: "easeOut" }, filter: { duration: 0.35, delay: 0.2, ease: "easeOut" } }}
        >
          {TITLES[outcome]}
        </motion.h2>

        {/* Players */}
        <div className={cn("mt-8 grid gap-3", votes ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2")}>
          {players.map((p, i) => (
            <ResultCard key={p.userId} player={p} match={match} winner={match.winnerId === p.userId} index={i} viewerId={viewer?.id} />
          ))}
        </div>

        {/* XP */}
        {me && !me.isBot && (
          <motion.div
            className="mx-auto mt-6 max-w-sm rounded-3xl glass p-4 text-left"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.9, ...spring.soft }}
          >
            <div className="flex items-baseline justify-between">
              <span className="font-display text-2xl font-extrabold text-volt">
                +<AnimatedNumber value={xpDelta} /> XP
              </span>
              <span className="text-xs text-ink-300">
                Level {after.level}
                {leveledUp && (
                  <motion.span
                    className="ml-2 inline-block rounded-full bg-volt px-2 py-0.5 text-[10px] font-extrabold uppercase text-ink-950"
                    initial={{ scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 1.8, ...spring.wobbly }}
                  >
                    Level up!
                  </motion.span>
                )}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-volt),#1fd1b2)]"
                initial={{ width: `${(leveledUp ? 0 : before.progress) * 100}%` }}
                animate={{ width: `${after.progress * 100}%` }}
                transition={{ delay: 1.2, type: "spring", stiffness: 50, damping: 14 }}
              />
            </div>
            {match.mode === "practice" && (
              <p className="mt-2 text-xs text-ink-400">
                Practice match — no rank change{match.simulatedVotes ? " · judged by a simulated crowd" : ""}.
              </p>
            )}
          </motion.div>
        )}

        <motion.div
          className="mt-8 flex flex-wrap items-center justify-center gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, ...spring.soft }}
        >
          {onRematch && (
            <Button size="lg" variant="accent" icon={<RotateCcw className="size-4" />} onClick={onRematch} loading={rematching} magnetic>
              Rematch
            </Button>
          )}
          <Button size="lg" variant="glass" icon={<XLogo className="size-4" />} onClick={onShare}>
            Share
          </Button>
          <Button size="lg" variant="ghost" icon={<Home className="size-4" />} onClick={onHome}>
            Done
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}

function ResultCard({
  player,
  match,
  winner,
  index,
  viewerId,
}: {
  player: MatchPlayer;
  match: Match;
  winner: boolean;
  index: number;
  viewerId?: string;
}) {
  const votes = match.scoring === "votes";
  const count = match.votes[player.userId] ?? 0;
  const total = Math.max(1, ...match.players.map((p) => match.votes[p.userId] ?? 0), match.votesNeeded);
  return (
    <motion.div
      className={cn(
        "relative rounded-3xl p-4 text-left transition-shadow",
        winner ? "glass-strong ring-2 ring-gold/70 shadow-[0_0_60px_-10px_rgb(255_201_61/0.5)]" : "glass opacity-90",
      )}
      initial={{ opacity: 0, y: 30, rotate: index === 0 ? -3 : 3 }}
      animate={{ opacity: 1, y: 0, rotate: 0, scale: winner ? 1.02 : 1 }}
      transition={{ delay: 0.45 + index * 0.12, ...spring.bouncy }}
    >
      {winner && (
        <motion.span
          className="absolute -top-5 left-1/2 -translate-x-1/2 text-3xl"
          initial={{ y: -30, opacity: 0, rotate: -30 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          transition={{ delay: 0.9, ...spring.wobbly }}
          aria-label="Winner"
        >
          👑
        </motion.span>
      )}
      <div className="flex items-center gap-3">
        <Avatar person={{ ...player.profile, isBot: player.isBot }} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {player.profile.name}
            {player.userId === viewerId && <span className="ml-1.5 text-xs font-medium text-ink-400">(you)</span>}
          </p>
          <p className="truncate text-xs text-ink-400">@{player.profile.handle}</p>
        </div>
        {!votes && (
          <span className="font-mono text-3xl font-bold tabular">
            <AnimatedNumber value={player.score ?? 0} format={(v) => (Number.isInteger(player.score ?? 0) ? Math.round(v).toString() : v.toFixed(1))} />
          </span>
        )}
      </div>
      {votes && (
        <>
          <div className="mt-3">
            <EntryView display={player.submission?.display} compact className="max-h-72" />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className={cn("h-full rounded-full", winner ? "bg-gold" : "bg-ink-300")}
                initial={{ width: 0 }}
                animate={{ width: `${(count / total) * 100}%` }}
                transition={{ delay: 0.8 + index * 0.1, type: "spring", stiffness: 60, damping: 14 }}
              />
            </div>
            <span className="font-mono text-sm font-bold tabular">
              <AnimatedNumber value={count} /> votes
            </span>
          </div>
        </>
      )}
    </motion.div>
  );
}
