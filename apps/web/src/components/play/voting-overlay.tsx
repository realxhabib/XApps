"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { EntryView } from "@/components/arena/entry-view";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { XLogo } from "@/components/ui/x-logo";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { AppManifest, Match } from "@/platform/types";
import { SEAT_COLORS, seatedPlayers } from "./match-view";

/** Live tally while the crowd judges a contest. */
export function VotingOverlay({
  app,
  match,
  viewerId,
  onShare,
  onLeave,
}: {
  app: AppManifest;
  match: Match;
  viewerId?: string;
  onShare: () => void;
  onLeave: () => void;
}) {
  const players = seatedPlayers(match).filter((p) => p.state !== "invited" && p.state !== "left");
  const target = match.votesNeeded;
  const many = players.length > 2;
  const best = Math.max(0, ...players.map((x) => match.votes[x.userId] ?? 0));
  return (
    <motion.div
      className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto px-4 pb-10 pt-24"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-ink-950/75 backdrop-blur-2xl" />
      <div className="relative w-full max-w-3xl text-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
          <Badge tone="live" pulse>
            {match.simulatedVotes ? "Simulated crowd" : "Arena is live"}
          </Badge>
          <h2 className="mt-3 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">The crowd is voting</h2>
          <p className="mt-2 text-sm text-ink-300">
            First to <b className="text-ink-50">{target} votes</b> takes the {app.name}
            {many ? <> · {players.length} entries</> : null}.
          </p>
        </motion.div>

        <div className={cn("mt-8 grid gap-4", !many ? "sm:grid-cols-2" : players.length === 4 ? "mx-auto max-w-2xl grid-cols-2 gap-3" : "grid-cols-2 gap-3 lg:grid-cols-3")}>
          {players.map((p, i) => {
            const count = match.votes[p.userId] ?? 0;
            const leading = count > 0 && count === best;
            const color = many ? (SEAT_COLORS[i % SEAT_COLORS.length] ?? app.accent[0]) : app.accent[i % 2];
            return (
              <motion.div
                layout
                key={p.userId}
                className={cn("rounded-[1.75rem] glass p-3 text-left transition-shadow", many && "rounded-3xl p-2.5", leading && "ring-1 ring-white/30")}
                initial={{ opacity: 0, y: 30, rotate: i % 2 === 0 ? -2 : 2 }}
                animate={{ opacity: 1, y: 0, rotate: 0 }}
                transition={{ delay: 0.15 + i * 0.1, ...spring.bouncy }}
              >
                <EntryView display={p.submission?.display} compact />
                <div className={cn("mt-3 flex items-center gap-2.5 px-1", many && "mt-2 gap-2")}>
                  <Avatar person={{ ...p.profile, isBot: p.isBot }} size={many ? 24 : 32} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm font-semibold", many && "text-xs")}>
                      {p.profile.name}
                      {p.userId === viewerId && <span className="ml-1 text-xs text-ink-400">(you)</span>}
                    </p>
                  </div>
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={count}
                      initial={{ y: -14, opacity: 0, scale: 0.5 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      exit={{ y: 14, opacity: 0 }}
                      transition={spring.wobbly}
                      className={cn("font-mono font-bold tabular", many ? "text-lg" : "text-2xl")}
                    >
                      {count}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="mt-2 flex gap-1 px-1">
                  {Array.from({ length: target }).map((_, n) => (
                    <motion.span
                      key={n}
                      className="h-1.5 flex-1 rounded-full"
                      animate={{
                        backgroundColor: n < count ? color : "rgb(255 255 255 / 0.1)",
                        scaleY: n === count - 1 ? [1, 2, 1] : 1,
                      }}
                      transition={{ duration: 0.4 }}
                    />
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.div
          className="mt-8 flex flex-wrap justify-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {!match.simulatedVotes && (
            <Button variant="primary" size="lg" icon={<XLogo className="size-4" />} onClick={onShare} magnetic>
              Rally votes on X
            </Button>
          )}
          <Button variant="glass" size="lg" iconRight={<ArrowRight className="size-4" />} onClick={onLeave}>
            Judge other matches
          </Button>
        </motion.div>
        <p className="mt-4 text-xs text-ink-400">We&apos;ll ping you when the verdict is in. You can leave this page.</p>
      </div>
    </motion.div>
  );
}
