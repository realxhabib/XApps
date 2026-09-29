"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, RefreshCw, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EntryView } from "@/components/arena/entry-view";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { celebrate } from "@/components/motion/confetti";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { getOfficialApp } from "@/platform/catalog";
import { useViewer } from "@/platform/client";
import { XP } from "@/platform/scoring";
import { useApps, useVote, useVotingMatches } from "@/platform/queries";
import type { Match } from "@/platform/types";
import { seatedPlayers } from "@/components/play/match-view";

const entryLabel = (seat: number) => String.fromCharCode(65 + seat);

export function Arena() {
  const router = useRouter();
  const { viewer } = useViewer();
  const { data, isPending, refetch, isFetching } = useVotingMatches();
  const { data: apps } = useApps();
  const vote = useVote();
  const [filter, setFilter] = useState("all");
  const [queue, setQueue] = useState<Match[] | null>(null);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<{ matchId: string; userId: string; result: Match } | null>(null);
  const [judged, setJudged] = useState(0);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Freeze the queue for the session so contests don't reshuffle mid-vote.
  if (data && queue === null) setQueue(data.filter((m) => m.players.length >= 2));

  const votable = useMemo(() => {
    const slugs = new Set((queue ?? []).map((m) => m.appSlug));
    return Array.from(slugs);
  }, [queue]);
  const filtered = useMemo(() => (queue ?? []).filter((m) => filter === "all" || m.appSlug === filter), [filter, queue]);
  const current = filtered[index];
  const app = current ? (apps?.find((a) => a.slug === current.appSlug) ?? getOfficialApp(current.appSlug)) : undefined;

  const next = useCallback(() => {
    setPicked(null);
    setIndex((i) => i + 1);
  }, []);

  const cast = useCallback(
    async (seat: number) => {
      if (!current || picked) return;
      if (!viewer) {
        router.push(`/login?next=${encodeURIComponent("/arena")}`);
        return;
      }
      const choice = seatedPlayers(current).filter((p) => p.state !== "invited" && p.state !== "left")[seat];
      if (!choice) return;
      play("vote");
      haptic("success");
      const rect = optionRefs.current[seat]?.getBoundingClientRect();
      if (rect) {
        celebrate({
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: (rect.top + rect.height / 3) / window.innerHeight,
          count: 60,
          colors: app ? [app.accent[0], app.accent[1], "#ffffff"] : undefined,
        });
      }
      try {
        const result = await vote.mutateAsync({ matchId: current.id, choiceUserId: choice.userId });
        setPicked({ matchId: current.id, userId: choice.userId, result });
        setJudged((n) => n + 1);
        setTimeout(next, 1700);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Vote failed", { tone: "danger" });
        next();
      }
    },
    [app, current, next, picked, router, viewer, vote],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const n = Number(event.key);
      if (Number.isInteger(n) && n >= 1 && n <= 8) void cast(n - 1);
      else if (event.key === "ArrowLeft") void cast(0);
      else if (event.key === "ArrowRight") void cast(1);
      if (event.key.toLowerCase() === "s" && !picked) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cast, next, picked]);

  const players = current ? seatedPlayers(current).filter((p) => p.state !== "invited" && p.state !== "left") : [];
  const many = players.length > 2;
  const shown = picked?.result ?? current;
  const title = players.map((p) => p.submission?.display).find((d) => d?.kind === "text" && d.title);

  return (
    <div>
      <motion.header className="text-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-flare">The Arena</p>
        <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">Who did it better?</h1>
        <p className="mx-auto mt-3 max-w-md text-ink-300">
          Entries are anonymous until you vote. Every verdict earns you +{XP.vote} XP.
        </p>
      </motion.header>

      {votable.length > 1 && (
        <div className="mt-6 flex justify-center">
          <Segmented
            layoutId="arena-filter"
            size="sm"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setIndex(0);
              setPicked(null);
            }}
            items={[
              { id: "all", label: "All" },
              ...votable.map((slug) => {
                const a = apps?.find((x) => x.slug === slug) ?? getOfficialApp(slug);
                return { id: slug, label: a?.name ?? slug, icon: <span>{a?.icon}</span> };
              }),
            ]}
          />
        </div>
      )}

      <div className="mx-auto mt-8 max-w-4xl">
        {isPending || queue === null ? (
          <Skeleton className="h-[28rem] rounded-[2.5rem]" />
        ) : !current ? (
          <EmptyState
            emoji="🏛️"
            title={judged > 0 ? `You judged ${judged} contest${judged === 1 ? "" : "s"}!` : "No contests to judge right now"}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  variant="glass"
                  icon={<RefreshCw className={cn("size-4", isFetching && "animate-spin")} />}
                  onClick={async () => {
                    const fresh = await refetch();
                    setQueue((fresh.data ?? []).filter((m) => m.players.length >= 2));
                    setIndex(0);
                  }}
                >
                  Check again
                </Button>
                <Button href="/apps/meme-duel" variant="accent">
                  Start a meme duel
                </Button>
              </div>
            }
          >
            New entries land all the time — or start a contest and let the crowd judge you.
          </EmptyState>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between text-xs text-ink-400">
              <span className="tabular">
                Contest {index + 1} of {filtered.length}
              </span>
              <span className="hidden items-center gap-1.5 sm:flex">
                {many ? (
                  <>
                    <Kbd>1</Kbd>–<Kbd>{String(players.length)}</Kbd> vote
                  </>
                ) : (
                  <>
                    <Kbd>←</Kbd>
                    <Kbd>→</Kbd> vote
                  </>
                )}{" "}
                · <Kbd>S</Kbd> skip
              </span>
            </div>
            <div className="mb-5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-flare),var(--color-nova-400))]"
                animate={{ width: `${((index + (picked ? 1 : 0)) / filtered.length) * 100}%` }}
                transition={spring.soft}
              />
            </div>
            <AnimatePresence mode="wait">
              <motion.section
                key={current.id}
                className="rounded-[2.5rem] glass p-4 sm:p-6"
                initial={{ opacity: 0, y: 60, scale: 0.94, rotateX: 18 }}
                animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                exit={{ opacity: 0, y: -80, scale: 0.9, rotate: -3, transition: { duration: 0.3 } }}
                transition={spring.soft}
                style={{ transformPerspective: 1200 }}
              >
                <div className="flex items-center justify-center gap-2 text-sm">
                  {app && <AppGlyph app={app} size={26} />}
                  <span className="font-semibold">{app?.name}</span>
                  <span className="text-ink-500">·</span>
                  <span className="text-ink-300">first to {current.votesNeeded}</span>
                  {many && (
                    <>
                      <span className="text-ink-500">·</span>
                      <span className="text-ink-300">{players.length} entries</span>
                    </>
                  )}
                </div>
                {title?.kind === "text" && title.title && (
                  <p className="mt-3 text-center font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{title.title}</p>
                )}
                <div
                  className={cn(
                    "mt-5 grid",
                    !many ? "grid-cols-1 gap-4 sm:grid-cols-2" : players.length === 3 ? "grid-cols-2 gap-3 sm:grid-cols-3" : players.length === 4 ? "grid-cols-2 gap-3" : "grid-cols-2 gap-3 sm:grid-cols-3",
                  )}
                >
                  {players.map((p, seat) => {
                    const isPick = picked?.userId === p.userId;
                    const count = shown?.votes[p.userId] ?? 0;
                    const total = Math.max(1, players.reduce((s, x) => s + (shown?.votes[x.userId] ?? 0), 0));
                    return (
                      // A div with button semantics: entries may hold their own controls (video, audio, gallery).
                      <motion.div
                        key={p.userId}
                        ref={(node) => {
                          optionRefs.current[seat] = node;
                        }}
                        role="button"
                        tabIndex={picked ? -1 : 0}
                        aria-disabled={!!picked}
                        onClick={() => {
                          if (!picked) void cast(seat);
                        }}
                        onKeyDown={(event) => {
                          if (picked || event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void cast(seat);
                          }
                        }}
                        className={cn(
                          "group relative cursor-pointer rounded-[2rem] p-2 text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-white/70",
                          picked && "cursor-default",
                          many && "rounded-3xl p-1.5",
                          isPick ? "ring-2 ring-volt shadow-[0_0_60px_-10px_rgb(198_255_61/0.6)]" : "ring-1 ring-white/10",
                        )}
                        whileHover={picked ? undefined : { y: -8, rotate: seat % 2 === 0 ? -1.2 : 1.2 }}
                        whileTap={picked ? undefined : { scale: 0.97 }}
                        animate={picked ? (isPick ? { scale: 1.03, opacity: 1 } : { scale: 0.95, opacity: 0.55 }) : { scale: 1, opacity: 1 }}
                        transition={spring.bouncy}
                        aria-label={`Vote for entry ${entryLabel(seat)}`}
                      >
                        <EntryView display={p.submission?.display} compact={many} />
                        <div className="flex items-center gap-2 px-2 pb-1 pt-3">
                          <AnimatePresence mode="wait" initial={false}>
                            {picked ? (
                              <motion.span
                                key="who"
                                className="flex min-w-0 items-center gap-2"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                              >
                                <Avatar person={p.profile} size={26} />
                                <span className="truncate text-sm font-semibold">@{p.profile.handle}</span>
                              </motion.span>
                            ) : (
                              <motion.span key="anon" className="flex items-center gap-2 text-sm font-semibold text-ink-300" exit={{ opacity: 0, y: -8 }}>
                                <span className="flex size-7 items-center justify-center rounded-full bg-white/10 font-mono text-xs">
                                  {entryLabel(seat)}
                                </span>
                                <span className={cn(many && "hidden sm:inline")}>Entry {entryLabel(seat)}</span>
                                {!many && (seat === 0 ? <ArrowLeft className="size-3.5 opacity-50" /> : <ArrowRight className="size-3.5 opacity-50" />)}
                              </motion.span>
                            )}
                          </AnimatePresence>
                          <AnimatePresence>
                            {picked && (
                              <motion.span
                                className="ml-auto font-mono text-sm font-bold tabular"
                                initial={{ opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={spring.wobbly}
                              >
                                {Math.round((count / total) * 100)}%
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </div>
                        <AnimatePresence>
                          {isPick && (
                            <motion.span
                              className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-volt px-3 py-1 font-display text-sm font-extrabold text-ink-950 shadow-lg"
                              initial={{ opacity: 0, y: 10, scale: 0.6 }}
                              animate={{ opacity: [0, 1, 1, 0], y: -30, scale: 1.1 }}
                              transition={{ duration: 1.5 }}
                            >
                              +{XP.vote} XP
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </div>
                <div className="mt-5 flex justify-center">
                  <Button variant="ghost" size="sm" icon={<SkipForward className="size-4" />} onClick={next} disabled={!!picked}>
                    Skip
                  </Button>
                </div>
              </motion.section>
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
