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
import { isMultiplayer, ordinal, rankings, seatedPlayers, teamRankings, viewerOutcome, type Placement, type TeamRanking } from "./match-view";

type Outcome = "win" | "loss" | "draw" | "spectator";

const TITLES: Record<Outcome, string> = { win: "Victory", loss: "Defeat", draw: "Draw", spectator: "Final" };

const PODIUM = {
  1: { from: "#fff3c4", to: "#ffc93d", glow: "rgb(255 201 61 / 0.55)", height: "h-28 sm:h-36" },
  2: { from: "#f4f6fb", to: "#aeb7cc", glow: "rgb(200 208 224 / 0.35)", height: "h-20 sm:h-28" },
  3: { from: "#ffd2ad", to: "#d9824a", glow: "rgb(217 130 74 / 0.4)", height: "h-14 sm:h-20" },
} as const;

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
  const multi = isMultiplayer(match);
  const teamPlay = match.teams >= 2;
  const view = viewerOutcome(match, viewer?.id);
  const me = view.kind === "spectator" ? undefined : match.players.find((p) => p.userId === viewer?.id);
  const outcome: Outcome = view.kind;
  const players = seatedPlayers(match);
  const votes = match.scoring === "votes";
  const ranked = rankings(match);
  const podium = multi && !teamPlay && outcome !== "win" && view.rank !== null && view.rank <= 3;
  const title = multi && !teamPlay && outcome !== "spectator" && view.rank !== null
    ? view.rank === 1
      ? view.tied
        ? "Tied 1st"
        : "Victory"
      : view.tied
        ? `Tied ${ordinal(view.rank)}`
        : `${ordinal(view.rank)} place`
    : TITLES[outcome];

  useEffect(() => {
    const t = setTimeout(() => {
      if (outcome === "win" || (outcome === "draw" && view.rank === 1 && multi)) {
        play("win");
        haptic("success");
        celebrate({ pattern: "cannons", count: 160, colors: [app.accent[0], app.accent[1], "#ffc93d", "#ffffff", "#c6ff3d"] });
      } else if (podium) {
        play("notify");
        haptic("medium");
        celebrate({ count: 60, colors: ["#ffffff", view.rank === 2 ? "#aeb7cc" : "#d9824a", app.accent[0]] });
      } else if (outcome === "loss") {
        play("lose");
        haptic("error");
      } else {
        play("notify");
      }
    }, 350);
    return () => clearTimeout(t);
  }, [app.accent, multi, outcome, podium, view.rank]);

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
      aria-label={`${title} — ${app.name}`}
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
            "mt-2 px-[0.1em] py-[0.05em] font-display font-extrabold uppercase italic leading-[1.1] tracking-tighter",
            title.length > 8 ? "text-6xl sm:text-8xl" : "text-7xl sm:text-8xl",
            (outcome === "win" || (multi && view.rank === 1)) &&
              "bg-[linear-gradient(120deg,#fff3c4,#ffc93d_40%,#ff9a3d)] bg-clip-text text-transparent drop-shadow-[0_0_40px_rgb(255_201_61/0.45)]",
            podium && view.rank === 2 && "bg-[linear-gradient(120deg,#ffffff,#aeb7cc)] bg-clip-text text-transparent",
            podium && view.rank === 3 && "bg-[linear-gradient(120deg,#ffe2c9,#d9824a)] bg-clip-text text-transparent",
            outcome === "loss" && !podium && "text-ink-300",
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
          {title}
        </motion.h2>

        {/* Players */}
        {teamPlay ? (
          <TeamBanners match={match} standings={teamRankings(match)} viewerId={viewer?.id} />
        ) : multi ? (
          <>
            <Podium match={match} ranked={ranked} viewerId={viewer?.id} />
            {!votes && <RankedList match={match} ranked={ranked.slice(3)} viewerId={viewer?.id} />}
            {votes && (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ranked.map((r, i) => (
                  <ResultCard key={r.player.userId} player={r.player} match={match} winner={r.rank === 1} index={i} viewerId={viewer?.id} rank={r.rank} />
                ))}
              </div>
            )}
          </>
        ) : (
          <div className={cn("mt-8 grid gap-3", votes ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2")}>
            {players.map((p, i) => (
              <ResultCard key={p.userId} player={p} match={match} winner={match.winnerId === p.userId} index={i} viewerId={viewer?.id} />
            ))}
          </div>
        )}

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
  rank,
}: {
  player: MatchPlayer;
  match: Match;
  winner: boolean;
  index: number;
  viewerId?: string;
  /** Placement badge for N-player contests. */
  rank?: number;
}) {
  const votes = match.scoring === "votes";
  const count = match.votes[player.userId] ?? 0;
  const total = Math.max(1, ...match.players.map((p) => match.votes[p.userId] ?? 0), match.votesNeeded);
  const compact = rank !== undefined;
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
      {rank !== undefined && (
        <span
          className={cn(
            "absolute -left-2 -top-2 z-10 flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 font-mono text-xs font-bold ring-2 ring-ink-950",
            rank === 1 ? "bg-gold text-ink-950" : "bg-ink-700 text-ink-100",
          )}
        >
          {ordinal(rank)}
        </span>
      )}
      {winner && !compact && (
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
      <div className={cn("flex items-center gap-3", compact && "gap-2")}>
        <Avatar person={{ ...player.profile, isBot: player.isBot }} size={compact ? 28 : 48} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate font-semibold", compact && "text-sm")}>
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
            <EntryView display={player.submission?.display} compact className={compact ? "max-h-48" : "max-h-72"} />
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

function formatScore(value: number | null | undefined): string {
  const v = value ?? 0;
  return Number.isInteger(v) ? v.toString() : v.toFixed(1);
}

function metricOf(match: Match, p: MatchPlayer): { value: number; label: string } {
  if (match.scoring === "votes") {
    const v = match.votes[p.userId] ?? 0;
    return { value: v, label: v === 1 ? "vote" : "votes" };
  }
  return { value: p.score ?? 0, label: "pts" };
}

/** Top three on blocks that rise from the floor: 2nd · 1st · 3rd. */
function Podium({ match, ranked, viewerId }: { match: Match; ranked: Placement[]; viewerId?: string }) {
  const reduced = useReducedMotion();
  const top = ranked.slice(0, 3);
  // Visual order: 2nd, 1st, 3rd (by position in the ranking, so ties still fill three steps).
  const order = [top[1], top[0], top[2]].filter((p): p is Placement => !!p);
  // Reveal bottom-up: third, then second, then the winner.
  const revealDelay = (index: number) => 0.45 + (2 - index) * 0.22;
  return (
    <div className="mx-auto mt-10 grid max-w-lg grid-cols-3 items-end gap-2 sm:gap-3" role="list" aria-label="Podium">
      {order.map((place) => {
        const index = top.indexOf(place);
        const step = PODIUM[(Math.min(3, index + 1) as 1 | 2 | 3)];
        const delay = revealDelay(index);
        const isMe = place.player.userId === viewerId;
        const metric = metricOf(match, place.player);
        const first = index === 0;
        return (
          <div key={place.player.userId} role="listitem" className="flex min-w-0 flex-col items-center">
            <motion.div
              className="relative flex min-w-0 max-w-full flex-col items-center"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -60, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: delay + 0.2, ...spring.bouncy }}
            >
              {first && (
                <motion.span
                  className="absolute -top-7 text-3xl"
                  initial={{ y: -24, opacity: 0, rotate: -30 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ delay: delay + 0.45, ...spring.wobbly }}
                  aria-label="Winner"
                >
                  👑
                </motion.span>
              )}
              <div
                className="rounded-full p-1"
                style={{ boxShadow: `0 0 0 2px ${step.to}, 0 0 ${first ? 50 : 30}px ${step.glow}` }}
              >
                <Avatar person={{ ...place.player.profile, isBot: place.player.isBot }} size={first ? 72 : 56} />
              </div>
              <p className={cn("mt-2 max-w-full truncate text-sm font-semibold", isMe && "text-volt")}>
                {isMe ? "You" : place.player.profile.name}
              </p>
              <p className="max-w-full truncate text-[11px] text-ink-400">@{place.player.profile.handle}</p>
              <p className="mt-1 font-mono text-xl font-bold tabular sm:text-2xl">
                <AnimatedNumber value={metric.value} format={(v) => (Number.isInteger(metric.value) ? Math.round(v).toString() : v.toFixed(1))} />
                <span className="ml-1 text-[11px] font-medium text-ink-400">{metric.label}</span>
              </p>
            </motion.div>
            <motion.div
              className={cn("relative mt-2 flex w-full origin-bottom items-start justify-center overflow-hidden rounded-t-2xl pt-2", step.height)}
              style={{ background: `linear-gradient(180deg, ${step.from}, ${step.to} 60%, ${step.to}66)`, boxShadow: `0 -10px 40px -12px ${step.glow}` }}
              initial={reduced ? { opacity: 0 } : { scaleY: 0, opacity: 0.6 }}
              animate={{ scaleY: 1, opacity: 1 }}
              transition={{ delay, type: "spring", stiffness: 160, damping: 18 }}
            >
              <span className="font-display text-3xl font-extrabold italic text-ink-950/80 sm:text-4xl">
                {place.tied ? "T" : ""}
                {place.rank}
              </span>
              {!reduced && (
                <motion.span
                  aria-hidden
                  className="absolute inset-y-0 w-1/3 -skew-x-12 bg-white/40 blur-md"
                  initial={{ x: "-150%" }}
                  animate={{ x: "350%" }}
                  transition={{ delay: delay + 0.5, duration: 0.9, ease: "easeOut" }}
                />
              )}
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

/** Everyone below the podium. */
function RankedList({ match, ranked, viewerId }: { match: Match; ranked: Placement[]; viewerId?: string }) {
  if (ranked.length === 0) return null;
  return (
    <ol className="mx-auto mt-4 max-w-lg space-y-1.5 text-left">
      {ranked.map((place, i) => {
        const isMe = place.player.userId === viewerId;
        const metric = metricOf(match, place.player);
        return (
          <motion.li
            key={place.player.userId}
            className={cn("flex items-center gap-3 rounded-2xl px-3 py-2", isMe ? "glass-strong ring-1 ring-volt/40" : "glass")}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: place.player.state === "left" ? 0.55 : 1, y: 0 }}
            transition={{ delay: 1.05 + i * 0.06, ...spring.soft }}
          >
            <span className="w-8 text-center font-mono text-sm font-bold text-ink-300">
              {place.tied ? "T" : ""}
              {place.rank}
            </span>
            <Avatar person={{ ...place.player.profile, isBot: place.player.isBot }} size={32} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {place.player.profile.name}
                {isMe && <span className="ml-1.5 text-xs font-medium text-ink-400">(you)</span>}
              </span>
              <span className="block truncate text-[11px] text-ink-400">
                @{place.player.profile.handle}
                {place.player.state === "left" && " · left"}
              </span>
            </span>
            <span className="font-mono text-lg font-bold tabular">
              {formatScore(metric.value)}
              <span className="ml-1 text-[11px] font-medium text-ink-400">{metric.label}</span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}

/** One banner per team, best first; the winners glow. */
function TeamBanners({ match, standings, viewerId }: { match: Match; standings: TeamRanking[]; viewerId?: string }) {
  const votes = match.scoring === "votes";
  return (
    <div className="mx-auto mt-8 max-w-xl space-y-3 text-left">
      {standings.map((t, i) => {
        const mine = t.members.some((m) => m.userId === viewerId);
        return (
          <motion.div
            key={t.team}
            className={cn("relative overflow-hidden rounded-3xl p-[1.5px]", t.winner && "shadow-[0_0_60px_-12px_var(--team)]")}
            style={{ "--team": t.style.color, background: t.winner ? `linear-gradient(120deg, ${t.style.color}, ${t.style.glow})` : "rgb(255 255 255 / 0.08)" } as React.CSSProperties}
            initial={{ opacity: 0, x: i % 2 ? 60 : -60, rotate: i % 2 ? 2 : -2 }}
            animate={{ opacity: 1, x: 0, rotate: 0, scale: t.winner ? 1.02 : 1 }}
            transition={{ delay: 0.45 + i * 0.14, ...spring.bouncy }}
          >
            <div className="relative flex items-center gap-3 rounded-[calc(1.5rem-1.5px)] bg-ink-900/95 p-4">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 w-2/3 opacity-30"
                style={{ background: `linear-gradient(90deg, ${t.style.color}, transparent)` }}
              />
              <div className="relative flex w-12 shrink-0 flex-col items-center">
                {t.winner ? (
                  <motion.span
                    className="text-3xl"
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.9 + i * 0.14, ...spring.wobbly }}
                    aria-label="Winning team"
                  >
                    👑
                  </motion.span>
                ) : (
                  <span className="font-display text-2xl font-extrabold italic text-ink-300">{ordinal(t.rank)}</span>
                )}
              </div>
              <div className="relative min-w-0 flex-1">
                <p className="flex items-center gap-2 font-display text-lg font-extrabold">
                  <span className="size-2.5 rounded-full" style={{ background: t.style.color }} />
                  {t.style.name}
                  {mine && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-200">Your team</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5">
                  {t.members.map((m) => (
                    <span key={m.userId} className={cn("flex min-w-0 items-center gap-1.5 text-xs", m.state === "left" && "opacity-50")}>
                      <Avatar person={{ ...m.profile, isBot: m.isBot }} size={24} />
                      <span className={cn("max-w-28 truncate", m.userId === viewerId ? "font-semibold text-volt" : "text-ink-200")}>
                        {m.userId === viewerId ? "You" : `@${m.profile.handle}`}
                      </span>
                      <span className="font-mono text-ink-400 tabular">{votes ? (match.votes[m.userId] ?? 0) : formatScore(m.score)}</span>
                    </span>
                  ))}
                </div>
              </div>
              <span className="relative shrink-0 text-right font-mono text-3xl font-bold tabular">
                <AnimatedNumber value={votes ? t.votes : t.score} format={(v) => (Number.isInteger(votes ? t.votes : t.score) ? Math.round(v).toString() : v.toFixed(1))} />
                <span className="block text-[10px] font-medium uppercase tracking-wider text-ink-400">{votes ? "votes" : "total"}</span>
              </span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
