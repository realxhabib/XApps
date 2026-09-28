"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Hourglass } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Match } from "@/platform/types";
import { formatTimeLeft, isMyTurn } from "./match-view";

/** Ticks faster as the deadline gets close. */
function useDeadline(deadline: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const target = deadline ? Date.parse(deadline) : null;
  const close = target !== null && target - now < 3_600_000;
  useEffect(() => {
    if (target === null) return;
    const t = setInterval(() => setNow(Date.now()), close ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [close, target]);
  return target === null ? null : target - now;
}

/**
 * Turn UI over the stage: a big "Your turn" moment whenever the turn lands on
 * the viewer, and (for play-anytime matches) a calm pill with the deadline.
 */
export function TurnBanner({
  match,
  viewerId,
  spectating,
  enabled,
  onLeave,
}: {
  match: Match;
  viewerId: string;
  spectating: boolean;
  /** False while the intro is playing; the moment waits for the stage. */
  enabled: boolean;
  onLeave: () => void;
}) {
  const reduced = useReducedMotion();
  const me = match.players.find((p) => p.userId === viewerId);
  // Once you've submitted (or the match is settling) turns no longer matter to you.
  const mine = !spectating && isMyTurn(match, viewerId) && me?.state === "joined";
  const holder = match.players.find((p) => p.userId === match.turnUserId);
  const active = match.status === "active" && !!match.turnUserId;
  const left = useDeadline(active ? match.turnDeadline : null);

  // A new "Your turn" moment each time the turn arrives (and once on open).
  const [seenTurn, setSeenTurn] = useState(match.turnUserId);
  const [moment, setMoment] = useState(mine ? 1 : 0);
  if (seenTurn !== match.turnUserId) {
    setSeenTurn(match.turnUserId);
    if (mine) setMoment((m) => m + 1);
  }
  const [showMoment, setShowMoment] = useState(false);
  useEffect(() => {
    if (!moment || !enabled) return;
    const show = setTimeout(() => {
      setShowMoment(true);
      play("notify");
      haptic("medium");
    }, 0);
    const hide = setTimeout(() => setShowMoment(false), 1700);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [enabled, moment]);

  const async = match.mode === "async";
  const urgent = left !== null && left < 3_600_000;

  return (
    <>
      <AnimatePresence>
        {showMoment && enabled && mine && (
          <motion.div
            key={`moment-${moment}`}
            aria-live="assertive"
            className="pointer-events-none fixed inset-0 z-[65] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.35 } }}
          >
            <motion.div
              className="absolute inset-0"
              style={{ background: "radial-gradient(circle at 50% 50%, rgb(198 255 61 / 0.22), transparent 55%)" }}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={spring.soft}
            />
            {!reduced &&
              [0, 0.14].map((delay) => (
                <motion.span
                  key={delay}
                  className="absolute size-40 rounded-full border-2 border-volt/70"
                  initial={{ scale: 0.3, opacity: 0.9 }}
                  animate={{ scale: 3.4, opacity: 0 }}
                  transition={{ delay: 0.1 + delay, duration: 0.9, ease: "easeOut" }}
                />
              ))}
            <motion.p
              className="relative px-[0.1em] py-[0.06em] font-display text-6xl font-extrabold uppercase italic leading-[1.1] tracking-tighter sm:text-8xl"
              style={{
                fontVariationSettings: "'wdth' 78",
                backgroundImage: "linear-gradient(120deg, #f4ffd6, #c6ff3d 45%, #1fd1b2)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                filter: "drop-shadow(0 0 30px rgb(198 255 61 / 0.45))",
              }}
              initial={reduced ? { opacity: 0 } : { scale: 1.8, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: -4 }}
              exit={reduced ? { opacity: 0 } : { y: -40, opacity: 0, scale: 0.9, transition: { duration: 0.3 } }}
              transition={spring.bouncy}
            >
              Your turn
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {enabled && active && async && holder && (
          <motion.div
            key="turn-pill"
            className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-3"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={spring.soft}
          >
            <motion.div
              className={cn(
                "pointer-events-auto relative flex max-w-full items-center gap-3 rounded-full py-1.5 pl-1.5 pr-2 text-sm shadow-xl transition-colors duration-300",
                mine ? "bg-volt text-ink-950 shadow-[0_12px_40px_-12px_rgb(198_255_61/0.7)]" : "glass-strong",
              )}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={mine ? "mine" : holder.userId}
                  className="flex min-w-0 items-center gap-2.5"
                  initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                  transition={{ ...spring.snappy, filter: BLUR_TWEEN }}
                >
                  {mine ? (
                    <span className="relative flex size-8 items-center justify-center rounded-full bg-ink-950/10">
                      <span className="absolute inset-1.5 animate-ping-soft rounded-full bg-ink-950/30 motion-reduce:animate-none" />
                      <span className="relative size-2.5 rounded-full bg-ink-950" />
                    </span>
                  ) : (
                    <motion.span
                      animate={reduced ? undefined : { scale: [1, 1.06, 1] }}
                      transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Avatar person={{ ...holder.profile, isBot: holder.isBot }} size={32} />
                    </motion.span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold leading-tight">
                      {mine ? "Your turn" : spectating ? `@${holder.profile.handle}'s move` : `Waiting for @${holder.profile.handle}`}
                    </span>
                    {left !== null && (
                      <span className={cn("flex items-center gap-1 text-[11px] leading-tight", mine ? "text-ink-950/70" : urgent ? "text-gold" : "text-ink-400")}>
                        <Hourglass className="size-3" />
                        <span className="font-mono tabular">{formatTimeLeft(left)}</span> {mine ? "to move" : "left to move"}
                      </span>
                    )}
                  </span>
                </motion.span>
              </AnimatePresence>
              {!mine && !spectating && (
                <Button size="sm" variant="ghost" onClick={onLeave} className="shrink-0">
                  We&apos;ll ping you
                </Button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
