"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Avatar } from "@/components/ui/avatar";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN } from "@/lib/motion";
import { cn, sleep } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import type { AppManifest, MatchPlayer, PlayableMode } from "@/platform/types";
import { teamStyle, type TeamStyle } from "./match-view";

type Stage = "clash" | "count" | "done";
type Variant = "duel" | "teams" | "ring";

/** Seat s plays for team s % teams (the server's `team` wins when present). */
function teamIndex(p: MatchPlayer, teams: number): number | null {
  if (p.team !== null && p.team !== undefined) return p.team;
  if (teams > 0 && p.seat !== null) return p.seat % teams;
  return null;
}

/**
 * The pre-match sequence. 1v1: split panels slam together, the players fly in,
 * VS lands with a shockwave. Free-for-all: everyone flies onto a ring around a
 * burst. Teams: the screen splits in team colors. Then 3-2-1-GO. ~4.5s total.
 */
export function VersusIntro({
  app,
  players,
  teams = 0,
  viewerId,
  mode,
  onDone,
}: {
  app: AppManifest;
  /** Seated players, by seat. */
  players: MatchPlayer[];
  teams?: number;
  viewerId: string;
  mode: PlayableMode;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate();
  const [stage, setStage] = useState<Stage>("clash");
  const [count, setCount] = useState(3);
  const variant: Variant = teams === 2 ? "teams" : players.length <= 2 && teams < 2 ? "duel" : "ring";

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      play("whoosh");
      await sleep(reduced ? 300 : variant === "ring" ? 800 : 650);
      if (cancelled) return;
      play("slam");
      haptic("heavy");
      if (!reduced && scope.current) {
        void animate(
          scope.current,
          { x: [0, -14, 12, -8, 6, -3, 0], y: [0, 8, -6, 4, -2, 0] },
          { duration: 0.45, ease: "easeOut" },
        );
      }
      await sleep(reduced ? 700 : 1650);
      if (cancelled) return;
      setStage("count");
      for (const n of [3, 2, 1]) {
        if (cancelled) return;
        setCount(n);
        play("tick");
        haptic("light");
        await sleep(650);
      }
      if (cancelled) return;
      setCount(0);
      play("go");
      haptic("medium");
      await sleep(520);
      if (cancelled) return;
      setStage("done");
      onDone();
    };
    void run();
    return () => {
      cancelled = true;
    };
    // Runs once per intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [from, to] = app.accent;
  const me = players.find((p) => p.userId === viewerId);

  // Panel colors: app accent for a duel, team colors for team play.
  let panels: [string, string] = [from, to];
  let sides: [MatchPlayer[], MatchPlayer[]] = [[], []];
  let sideTeams: [TeamStyle | null, TeamStyle | null] = [null, null];
  if (variant === "duel") {
    const left = me ?? players[0];
    const right = players.find((p) => p !== left);
    sides = [left ? [left] : [], right ? [right] : []];
  } else if (variant === "teams") {
    // Your team on the left.
    const mine = me ? (teamIndex(me, teams) ?? 0) : 0;
    const theirs = mine === 0 ? 1 : 0;
    sides = [players.filter((p) => teamIndex(p, teams) === mine), players.filter((p) => teamIndex(p, teams) === theirs)];
    sideTeams = [teamStyle(mine), teamStyle(theirs)];
    panels = [sideTeams[0]?.color ?? from, sideTeams[1]?.color ?? to];
  }

  return (
    <AnimatePresence>
      {stage !== "done" && (
        <motion.div
          ref={scope}
          className="fixed inset-0 z-[70] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.08, filter: "blur(10px)", transition: { duration: 0.35 } }}
          aria-live="assertive"
        >
          {/* Backdrop */}
          <motion.div className="absolute inset-0 bg-ink-950/85 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />

          {variant === "ring" ? (
            <RingBackdrop from={from} to={to} stage={stage} reduced={!!reduced} />
          ) : (
            <>
              {/* Split panels */}
              <motion.div
                className="absolute inset-y-0 -left-[10%] w-[62%] -skew-x-12"
                style={{ background: `linear-gradient(120deg, ${panels[0]}, ${panels[0]}55 70%, transparent)` }}
                initial={{ x: "-110%" }}
                animate={{ x: stage === "count" ? "-120%" : "0%" }}
                transition={{ type: "spring", stiffness: 170, damping: 22 }}
              />
              <motion.div
                className="absolute inset-y-0 -right-[10%] w-[62%] -skew-x-12"
                style={{ background: `linear-gradient(300deg, ${panels[1]}, ${panels[1]}55 70%, transparent)` }}
                initial={{ x: "110%" }}
                animate={{ x: stage === "count" ? "120%" : "0%" }}
                transition={{ type: "spring", stiffness: 170, damping: 22 }}
              />
            </>
          )}

          <AnimatePresence>
            {stage === "clash" && (
              <motion.div
                key="clash"
                className="absolute inset-0 flex flex-col items-center justify-center px-6"
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
              >
                {variant === "ring" ? (
                  <Ring players={players} teams={teams} viewerId={viewerId} reduced={!!reduced} />
                ) : (
                  <div className="flex w-full max-w-3xl items-center justify-between gap-4">
                    <Side players={sides[0]} team={sideTeams[0]} side="left" viewerId={viewerId} />
                    <div className="relative flex size-24 shrink-0 items-center justify-center sm:size-36">
                      {/* Shockwave rings */}
                      {!reduced &&
                        [0, 0.12].map((delay) => (
                          <motion.span
                            key={delay}
                            className="absolute inset-0 rounded-full border-2 border-white/70"
                            initial={{ scale: 0.2, opacity: 0 }}
                            animate={{ scale: [0.2, 3.2], opacity: [0.9, 0] }}
                            transition={{ delay: 0.65 + delay, duration: 0.8, ease: "easeOut" }}
                          />
                        ))}
                      <motion.span
                        className="font-display text-7xl font-extrabold italic tracking-tighter text-white drop-shadow-[0_0_30px_rgb(255_255_255/0.6)] sm:text-8xl"
                        style={{ fontVariationSettings: "'wdth' 75" }}
                        initial={{ scale: 4, opacity: 0, filter: "blur(18px)", rotate: -12 }}
                        animate={{ scale: 1, opacity: 1, filter: "blur(0px)", rotate: -6 }}
                        transition={{ delay: 0.6, type: "spring", stiffness: 420, damping: 16, filter: { delay: 0.6, ...BLUR_TWEEN } }}
                      >
                        VS
                      </motion.span>
                    </div>
                    <Side players={sides[1]} team={sideTeams[1]} side="right" viewerId={viewerId} />
                  </div>
                )}
                <motion.div
                  className="mt-10 flex items-center gap-3 rounded-full glass px-4 py-2"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2, type: "spring", stiffness: 200, damping: 20 }}
                >
                  <AppGlyph app={app} size={28} />
                  <span className="font-display font-bold">{app.name}</span>
                  <span className="text-sm text-ink-300">· {MODE_LABEL[mode]}</span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Full-width digits: the condensed cut gives 2 and 3 flat, notched tops that read as clipped. */}
          <AnimatePresence mode="popLayout">
            {stage === "count" && (
              <motion.div
                key={count}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ scale: reduced ? 1 : 2.2, opacity: 0, filter: "blur(16px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                exit={{ scale: reduced ? 1 : 0.6, opacity: 0, filter: "blur(8px)", transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 380, damping: 20, filter: { duration: 0.25, ease: "easeOut" } }}
              >
                <span
                  className="px-[0.08em] py-[0.1em] font-display text-[34vmin] font-extrabold leading-[1.1] tracking-tighter"
                  style={{
                    backgroundImage: count === 0 ? "linear-gradient(120deg, #c6ff3d, #1fd1b2)" : `linear-gradient(120deg, #fff, ${to})`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                >
                  {count === 0 ? "GO!" : count}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One side of a duel or team split: a single fighter, or a team stacked together. */
function Side({ players, team, side, viewerId }: { players: MatchPlayer[]; team: TeamStyle | null; side: "left" | "right"; viewerId: string }) {
  const dir = side === "left" ? -1 : 1;
  if (!team) return <Fighter player={players[0]} side={side} />;
  const size = players.length <= 1 ? 112 : players.length === 2 ? 76 : 60;
  return (
    <motion.div
      className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center"
      initial={{ x: dir * 260, opacity: 0, rotate: dir * 14, scale: 0.6 }}
      animate={{ x: 0, opacity: 1, rotate: 0, scale: 1 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 240, damping: 18 }}
    >
      <motion.span
        className="whitespace-nowrap rounded-full px-3 py-1 font-display text-xs font-extrabold uppercase tracking-[0.12em] text-ink-950 sm:text-sm sm:tracking-[0.2em]"
        style={{ background: `linear-gradient(120deg, ${team.color}, ${team.glow})` }}
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.9, type: "spring", stiffness: 300, damping: 18 }}
      >
        {team.name}
      </motion.span>
      <div className="flex flex-col items-center -space-y-3 sm:flex-row sm:-space-x-4 sm:space-y-0">
        {players.map((p, i) => (
          <motion.div
            key={p.userId}
            className="rounded-full p-1"
            style={{ boxShadow: `0 0 0 3px ${team.color}, 0 0 40px ${team.color}88`, background: "rgb(5 6 10 / 0.6)" }}
            initial={{ y: 30, opacity: 0, scale: 0.5 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 + i * 0.08, type: "spring", stiffness: 300, damping: 17 }}
          >
            <Avatar person={{ ...p.profile, isBot: p.isBot }} size={size} />
          </motion.div>
        ))}
      </div>
      <p className="max-w-full truncate text-sm font-semibold text-white/85">
        {players.map((p) => (p.userId === viewerId ? "You" : `@${p.profile.handle}`)).join(" · ")}
      </p>
    </motion.div>
  );
}

function Fighter({ player, side }: { player?: MatchPlayer; side: "left" | "right" }) {
  const dir = side === "left" ? -1 : 1;
  return (
    <motion.div
      className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center"
      initial={{ x: dir * 240, opacity: 0, rotate: dir * 18, scale: 0.6 }}
      animate={{ x: 0, opacity: 1, rotate: 0, scale: 1 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 240, damping: 18 }}
    >
      <div className="rounded-full p-1.5 shadow-[0_0_60px_rgb(255_255_255/0.25)] ring-2 ring-white/80">
        {player ? (
          <Avatar person={{ ...player.profile, isBot: player.isBot }} size={112} />
        ) : (
          <div className="flex size-28 items-center justify-center rounded-full bg-white/10 font-display text-4xl font-bold">?</div>
        )}
      </div>
      <div className="min-w-0 max-w-full">
        <p className="truncate font-display text-xl font-extrabold sm:text-2xl">{player?.profile.name ?? "Anyone"}</p>
        <p className="truncate text-sm text-white/70">{player ? `@${player.profile.handle}` : "open seat"}</p>
      </div>
    </motion.div>
  );
}

/** Radial burst behind the free-for-all ring. */
function RingBackdrop({ from, to, stage, reduced }: { from: string; to: string; stage: Stage; reduced: boolean }) {
  return (
    <motion.div
      aria-hidden
      className="absolute inset-0"
      animate={{ opacity: stage === "count" ? 0.35 : 1, scale: stage === "count" ? 1.3 : 1 }}
      transition={{ type: "spring", stiffness: 120, damping: 20 }}
    >
      <motion.div
        className="absolute left-1/2 top-1/2 size-[150vmax] -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.55, type: "spring", stiffness: 90, damping: 16 }}
      >
        <div
          className={cn("size-full opacity-60", !reduced && "animate-spin-slow")}
          style={{
            background: `repeating-conic-gradient(from 0deg, ${from}55 0deg 7deg, transparent 7deg 18deg, ${to}44 18deg 25deg, transparent 25deg 36deg)`,
            maskImage: "radial-gradient(circle, #000 0%, transparent 42%)",
          }}
        />
      </motion.div>
      <motion.div
        className="absolute left-1/2 top-1/2 size-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: `radial-gradient(circle, ${from}88, ${to}44 50%, transparent 70%)` }}
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.5, type: "spring", stiffness: 120, damping: 14 }}
      />
    </motion.div>
  );
}

/** Free-for-all: everyone lands on a ring, you at the bottom, the burst in the middle. */
function Ring({ players, teams, viewerId, reduced }: { players: MatchPlayer[]; teams: number; viewerId: string; reduced: boolean }) {
  const n = players.length;
  // Rotate so the viewer sits at the bottom of the ring.
  const start = Math.max(0, players.findIndex((p) => p.userId === viewerId));
  const ordered = players.map((_, i) => players[(start + i) % n]!);
  const size = n <= 4 ? 80 : n <= 6 ? 66 : 54;
  const label = teams >= 2 ? `${teams} teams` : `${n} players`;
  return (
    <div className="relative aspect-square w-[min(88vmin,34rem)]">
      {/* Center slam */}
      <div className="absolute inset-0 flex items-center justify-center">
        {!reduced &&
          [0, 0.12].map((delay) => (
            <motion.span
              key={delay}
              className="absolute size-32 rounded-full border-2 border-white/70"
              initial={{ scale: 0.2, opacity: 0 }}
              animate={{ scale: [0.2, 3], opacity: [0.9, 0] }}
              transition={{ delay: 0.8 + delay, duration: 0.8, ease: "easeOut" }}
            />
          ))}
        <motion.div
          className="text-center"
          initial={{ scale: 3.4, opacity: 0, filter: "blur(18px)", rotate: -12 }}
          animate={{ scale: 1, opacity: 1, filter: "blur(0px)", rotate: -6 }}
          transition={{ delay: 0.75, type: "spring", stiffness: 420, damping: 16, filter: { delay: 0.75, ...BLUR_TWEEN } }}
        >
          <p
            className="font-display text-[clamp(2.2rem,9vmin,4.5rem)] font-extrabold uppercase italic leading-[0.9] tracking-tighter text-white drop-shadow-[0_0_30px_rgb(255_255_255/0.55)]"
            style={{ fontVariationSettings: "'wdth' 75" }}
          >
            {teams >= 2 ? (
              "Teams"
            ) : (
              <>
                Free
                <br />
                for all
              </>
            )}
          </p>
          <motion.p
            className="mt-2 text-xs font-bold uppercase tracking-[0.3em] text-white/70"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.1 }}
          >
            {label}
          </motion.p>
        </motion.div>
      </div>

      {ordered.map((p, i) => {
        const angle = Math.PI / 2 + (i / n) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const team = teams >= 2 ? teamStyle(teamIndex(p, teams)) : null;
        const isMe = p.userId === viewerId;
        const color = team?.color ?? (isMe ? "#c6ff3d" : "rgb(255 255 255 / 0.8)");
        return (
          <div
            key={p.userId}
            className="absolute"
            // 38% of the box from the center keeps avatars inside the ring on every screen.
            style={{ left: `${50 + cos * 38}%`, top: `${50 + sin * 38}%`, transform: "translate(-50%, -50%)" }}
          >
            <motion.div
              className="flex flex-col items-center gap-1.5"
              initial={reduced ? { opacity: 0 } : { x: cos * 520, y: sin * 520, opacity: 0, rotate: cos * 40, scale: 0.4 }}
              animate={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
              transition={{ delay: 0.12 + i * 0.07, type: "spring", stiffness: 230, damping: 17 }}
            >
              <div
                className="rounded-full p-1"
                style={{ boxShadow: `0 0 0 ${isMe ? 3 : 2}px ${color}, 0 0 44px ${team ? `${team.color}88` : isMe ? "rgb(198 255 61 / 0.45)" : "rgb(255 255 255 / 0.2)"}`, background: "rgb(5 6 10 / 0.6)" }}
              >
                <Avatar person={{ ...p.profile, isBot: p.isBot }} size={size} />
              </div>
              <span
                className={cn(
                  "max-w-24 truncate rounded-full px-2 py-0.5 text-[11px] font-bold sm:text-xs",
                  isMe ? "bg-volt text-ink-950" : "bg-ink-950/60 text-white/85",
                  n > 6 && !isMe && "hidden sm:block",
                )}
              >
                {isMe ? "You" : `@${p.profile.handle}`}
              </span>
            </motion.div>
          </div>
        );
      })}
    </div>
  );
}

