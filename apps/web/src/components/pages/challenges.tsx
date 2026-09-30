"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { needsMyMove } from "@/components/chrome/use-inbox";
import { MatchCard } from "@/components/marketplace/match-card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { useViewer } from "@/platform/client";
import { useApps, useMatchAction, useMyMatches } from "@/platform/queries";
import type { Match } from "@/platform/types";
import { DeveloperNotices } from "./developer-notices";
import { SignInPrompt } from "./sign-in-prompt";

type Tab = "move" | "waiting" | "history";

/** A lobby that expired or was cancelled before anyone else sat down: not history worth keeping. */
function isDeadLobby(m: Match): boolean {
  return (m.status === "expired" || m.status === "cancelled") && m.players.filter((p) => p.role === "player" && p.state !== "declined").length < 2;
}

export function Challenges() {
  const router = useRouter();
  const { viewer, loading } = useViewer();
  const { data, isPending } = useMyMatches();
  const { data: apps } = useApps();
  const action = useMatchAction();
  const [tab, setTab] = useState<Tab>("move");

  const groups = useMemo(() => {
    const move: typeof data = [];
    const waiting: typeof data = [];
    const history: typeof data = [];
    for (const m of data ?? []) {
      if (viewer && needsMyMove(m, viewer.id)) move.push(m);
      else if (["open", "pending", "active", "voting"].includes(m.status) && m.mode !== "practice") waiting.push(m);
      else if (isDeadLobby(m)) continue;
      else if (m.status !== "active") history.push(m);
    }
    return { move, waiting, history };
  }, [data, viewer]);

  if (loading) return <Skeleton className="h-64 rounded-[2rem]" />;
  if (!viewer) {
    return (
      <SignInPrompt title="Your challenges live here">Sign in to send challenges, accept invites and track every rivalry.</SignInPrompt>
    );
  }

  const list = groups[tab] ?? [];
  const respond = async (matchId: string, kind: "join" | "decline") => {
    try {
      await action.mutateAsync({ action: kind, matchId });
      if (kind === "join") router.push(`/play/${matchId}`);
      else toast("Challenge declined");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Something went wrong", { tone: "danger" });
    }
  };

  return (
    <div>
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Inbox</p>
        <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight">Challenges</h1>
        <p className="mt-3 text-ink-300">Swipe right to accept an invite, left to pass.</p>
      </motion.header>
      <DeveloperNotices className="mt-8" />
      <Segmented
        className="mt-8"
        layoutId="challenges-tab"
        value={tab}
        onChange={setTab}
        items={[
          { id: "move", label: "Your move", count: groups.move?.length },
          { id: "waiting", label: "Waiting", count: groups.waiting?.length },
          { id: "history", label: "History" },
        ]}
      />
      <div className="mt-6">
        {isPending ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-3xl" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            emoji={tab === "move" ? "🧘" : tab === "waiting" ? "📭" : "📜"}
            title={tab === "move" ? "Nothing waiting on you" : tab === "waiting" ? "No open challenges" : "No history yet"}
            action={
              <Button href="/apps" variant="accent">
                Start a challenge
              </Button>
            }
          >
            {tab === "history" ? "Finished matches will show up here." : "Challenge someone and the ball's in their court."}
          </EmptyState>
        ) : (
          <motion.ul layout className="space-y-3">
            <AnimatePresence mode="popLayout" initial={false}>
              {list.map((m, i) => {
                const invited = m.players.find((p) => p.userId === viewer.id)?.state === "invited";
                return (
                  <motion.li
                    layout
                    key={m.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0, transition: { ...spring.soft, delay: Math.min(i, 8) * 0.04 } }}
                    exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                  >
                    <MatchCard
                      match={m}
                      viewerId={viewer.id}
                      apps={apps}
                      onAccept={invited ? () => respond(m.id, "join") : undefined}
                      onDecline={invited ? () => respond(m.id, "decline") : undefined}
                    />
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </div>
  );
}
