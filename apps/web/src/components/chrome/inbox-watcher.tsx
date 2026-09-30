"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { play } from "@/lib/sfx";
import { formatTimeLeft, ordinal, seatedPlayers, viewerOutcome } from "@/components/play/match-view";
import { appForSlug } from "@/platform/retired-apps";
import { isYourTurn } from "@/platform/match-utils";
import { useViewer } from "@/platform/client";
import { useApps, useMyMatches } from "@/platform/queries";
import type { Match } from "@/platform/types";
import { toast } from "./toasts";
import { goToHost } from "@/lib/host-nav";

const signature = (m: Match) => `${m.status}|${m.turnUserId ?? ""}|${m.players.map((p) => `${p.userId}:${p.state}`).join(",")}`;
const statusOf = (sig: string | undefined) => sig?.split("|")[0];
const turnOf = (sig: string | undefined) => sig?.split("|")[1] ?? "";

/** Pops a toast when someone challenges you, accepts, it's your turn, or a match you're in finishes. */
export function InboxWatcher() {
  const { viewer } = useViewer();
  const { data } = useMyMatches();
  const { data: apps } = useApps();
  const router = useRouter();
  const pathname = usePathname();
  const seen = useRef<Map<string, string> | null>(null);
  const viewerId = viewer?.id;

  useEffect(() => {
    seen.current = null;
  }, [viewerId]);

  useEffect(() => {
    if (!viewerId || !data) return;
    const next = new Map(data.map((m) => [m.id, signature(m)]));
    const previous = seen.current;
    seen.current = next;
    if (!previous) return;

    for (const match of data) {
      const before = previous.get(match.id);
      if (before === signature(match)) continue;
      if (pathname === `/play/${match.id}`) continue;
      const app = appForSlug(match.appSlug, apps);
      const me = match.players.find((p) => p.userId === viewerId);
      const opponent = seatedPlayers(match).find((p) => p.userId !== viewerId);
      const icon = app ? <AppGlyph app={app} size={28} /> : undefined;
      const open = { label: "Open", onClick: () => goToHost(router, `/play/${match.id}`) };

      const group = match.maxPlayers > 2 || match.teams >= 2 || seatedPlayers(match).length > 2;
      const creator = match.players.find((p) => p.userId === match.createdBy);
      const was = statusOf(before);

      if (!before && me?.state === "invited" && (match.status === "pending" || match.status === "open")) {
        play("notify");
        const host = group ? creator : opponent;
        toast(group ? `@${host?.profile.handle ?? "someone"} saved you a seat` : `@${host?.profile.handle ?? "someone"} challenged you`, {
          description: `${app?.name ?? "A match"} · ${group ? `${match.maxPlayers} players · ` : ""}${match.mode === "live" ? "live" : "play anytime"}`,
          icon,
          action: { label: "View", onClick: () => goToHost(router, `/play/${match.id}`) },
          duration: 9000,
        });
      } else if (before && turnOf(before) !== viewerId && isYourTurn(match, viewerId)) {
        play("notify");
        toast(`Your turn in ${app?.name ?? "your match"}`, {
          description: match.turnDeadline ? `You have ${formatTimeLeft(Date.parse(match.turnDeadline) - Date.now())} to move.` : undefined,
          icon,
          action: { label: "Play", onClick: () => goToHost(router, `/play/${match.id}`) },
          tone: "success",
          duration: 9000,
        });
      } else if (was === "pending" && match.status === "active" && match.createdBy === viewerId) {
        toast(group ? "Your table is full — game on" : `@${opponent?.profile.handle ?? "Your opponent"} accepted`, { description: app?.name, icon, action: open, tone: "success", duration: 8000 });
      } else if (was === "open" && match.status === "active" && match.createdBy === viewerId) {
        toast(group ? "Your table is full — game on" : `@${opponent?.profile.handle ?? "Someone"} took your challenge`, { description: app?.name, icon, action: open, tone: "success", duration: 8000 });
      } else if (was !== "completed" && match.status === "completed" && match.mode !== "practice") {
        const outcome = viewerOutcome(match, viewerId);
        const won = outcome.kind === "win";
        const title = group
          ? match.teams >= 2
            ? won
              ? "Your team won! 🏆"
              : outcome.kind === "draw"
                ? "Teams tied"
                : "Your team lost"
            : outcome.rank === 1
              ? outcome.tied
                ? "Tied for 1st! 🏆"
                : "You won! 🏆"
              : `You placed ${ordinal(outcome.rank ?? seatedPlayers(match).length)}`
          : won
            ? "You won! 🏆"
            : match.winnerId
              ? "Match lost"
              : "It's a draw";
        toast(title, {
          description: group ? `${app?.name ?? "Match"} · ${seatedPlayers(match).length} players` : `${app?.name ?? "Match"} vs @${opponent?.profile.handle ?? "?"}`,
          icon,
          tone: won || outcome.rank === 1 ? "success" : "info",
          action: { label: "See", onClick: () => goToHost(router, `/play/${match.id}`) },
        });
      } else if (was !== "voting" && match.status === "voting") {
        toast("Entries are in — the crowd is voting", { description: app?.name, icon });
      }
    }
  }, [apps, data, pathname, router, viewerId]);

  return null;
}
