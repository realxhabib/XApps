"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { play } from "@/lib/sfx";
import { getOfficialApp } from "@/platform/catalog";
import { useViewer } from "@/platform/client";
import { useApps, useMyMatches } from "@/platform/queries";
import type { Match } from "@/platform/types";
import { toast } from "./toasts";

const signature = (m: Match) => `${m.status}|${m.players.map((p) => `${p.userId}:${p.state}`).join(",")}`;

/** Pops a toast when someone challenges you, accepts, or a match you're in finishes. */
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
      const app = apps?.find((a) => a.slug === match.appSlug) ?? getOfficialApp(match.appSlug);
      const me = match.players.find((p) => p.userId === viewerId);
      const opponent = match.players.find((p) => p.userId !== viewerId);
      const icon = app ? <AppGlyph app={app} size={28} /> : undefined;
      const open = { label: "Open", onClick: () => router.push(`/play/${match.id}`) };

      if (!before && me?.state === "invited" && match.status === "pending") {
        play("notify");
        toast(`@${opponent?.profile.handle ?? "someone"} challenged you`, {
          description: `${app?.name ?? "A match"} · ${match.mode === "live" ? "live" : "play anytime"}`,
          icon,
          action: { label: "View", onClick: () => router.push(`/play/${match.id}`) },
          duration: 9000,
        });
      } else if (before?.startsWith("pending") && match.status === "active" && match.createdBy === viewerId) {
        toast(`@${opponent?.profile.handle ?? "Your opponent"} accepted`, { description: app?.name, icon, action: open, tone: "success", duration: 8000 });
      } else if (before?.startsWith("open") && match.status === "active" && match.createdBy === viewerId) {
        toast(`@${opponent?.profile.handle ?? "Someone"} took your challenge`, { description: app?.name, icon, action: open, tone: "success", duration: 8000 });
      } else if (!before?.startsWith("completed") && match.status === "completed" && match.mode !== "practice") {
        const won = match.winnerId === viewerId;
        toast(won ? "You won! 🏆" : match.winnerId ? "Match lost" : "It's a draw", {
          description: `${app?.name ?? "Match"} vs @${opponent?.profile.handle ?? "?"}`,
          icon,
          tone: won ? "success" : "info",
          action: { label: "See", onClick: () => router.push(`/play/${match.id}`) },
        });
      } else if (!before?.startsWith("voting") && match.status === "voting") {
        toast("Entries are in — the crowd is voting", { description: app?.name, icon });
      }
    }
  }, [apps, data, pathname, router, viewerId]);

  return null;
}
