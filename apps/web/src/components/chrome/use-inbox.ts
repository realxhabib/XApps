"use client";

import { useMemo } from "react";
import { useViewer } from "@/platform/client";
import { useMyMatches } from "@/platform/queries";
import type { Match } from "@/platform/types";

/** Matches that need something from the viewer right now. */
export function needsMyMove(match: Match, viewerId: string): boolean {
  const me = match.players.find((p) => p.userId === viewerId);
  if (!me) return false;
  if (me.state === "invited" && match.status === "pending") return true;
  if (match.mode === "async" && ["active", "pending"].includes(match.status) && me.state === "joined") return true;
  if (match.mode === "live" && match.status === "active" && me.state === "joined") return true;
  return false;
}

export function useInbox() {
  const { viewer } = useViewer();
  const { data } = useMyMatches();
  return useMemo(() => {
    if (!viewer || !data) return { count: 0, matches: [] as Match[] };
    const matches = data.filter((m) => needsMyMove(m, viewer.id));
    return { count: matches.length, matches };
  }, [data, viewer]);
}
