"use client";

import { animate, motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { Check, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn, timeAgo } from "@/lib/utils";
import { getOfficialApp } from "@/platform/catalog";
import { MODE_LABEL, matchHeadline, playerOf } from "@/platform/match-utils";
import type { AppManifest, Match } from "@/platform/types";
import { AppGlyph } from "./app-glyph";

function StatusBadge({ match, viewerId }: { match: Match; viewerId?: string }) {
  const me = playerOf(match, viewerId);
  // `viewerId` here is whoever's perspective the card is drawn from.
  if (match.status === "completed") {
    if (!me) return <Badge>Final</Badge>;
    if (!match.winnerId) return <Badge>Draw</Badge>;
    return match.winnerId === viewerId ? <Badge tone="gold">Won</Badge> : <Badge tone="danger">Lost</Badge>;
  }
  if (match.status === "voting") return <Badge tone="flare" pulse>Voting</Badge>;
  if (match.status === "active" && match.mode === "live") return <Badge tone="live" pulse>Live</Badge>;
  if (me?.state === "invited") return <Badge tone="volt">New</Badge>;
  if (["declined", "cancelled", "expired"].includes(match.status)) return <Badge>{match.status}</Badge>;
  return <Badge tone="nova">{MODE_LABEL[match.mode]}</Badge>;
}

/**
 * One match in a list. Invites can be swiped: right to accept, left to decline.
 */
export function MatchCard({
  match,
  viewerId,
  apps,
  onAccept,
  onDecline,
  subject,
}: {
  match: Match;
  viewerId?: string;
  apps?: AppManifest[];
  onAccept?: () => void;
  onDecline?: () => void;
  /** Describe the match from this player's side, in third person (profile pages). */
  subject?: { id: string; handle: string };
}) {
  const app = apps?.find((a) => a.slug === match.appSlug) ?? getOfficialApp(match.appSlug);
  const swipeable = !!onAccept && !!onDecline;
  const x = useMotionValue(0);
  const acceptOpacity = useTransform(x, [20, 110], [0, 1]);
  const declineOpacity = useTransform(x, [-110, -20], [1, 0]);
  const rotate = useTransform(x, [-200, 200], [-4, 4]);
  const [gone, setGone] = useState(false);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const decided = info.offset.x > 110 || info.velocity.x > 700 ? 1 : info.offset.x < -110 || info.velocity.x < -700 ? -1 : 0;
    if (decided === 0) {
      void animate(x, 0, spring.bouncy);
      return;
    }
    haptic(decided > 0 ? "success" : "medium");
    play(decided > 0 ? "vote" : "whoosh");
    setGone(true);
    void animate(x, decided * 600, { duration: 0.28 }).then(() => (decided > 0 ? onAccept?.() : onDecline?.()));
  };

  const players = match.players.filter((p) => p.state !== "declined");
  const content = (
    <div className="flex items-center gap-3.5 p-3.5 pr-4">
      {app ? <AppGlyph app={app} size={48} /> : <span className="size-12 rounded-2xl bg-white/10" />}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{matchHeadline(match, viewerId, subject)}</p>
        <p className="truncate text-xs text-ink-400">
          {app?.name ?? match.appSlug} · {MODE_LABEL[match.mode]} · {timeAgo(match.endedAt ?? match.createdAt)}
        </p>
      </div>
      <div className="hidden -space-x-2 sm:flex">
        {players.map((p) => (
          <Avatar key={p.userId} person={{ ...p.profile, isBot: p.isBot }} size={30} className="rounded-full ring-2 ring-ink-850" />
        ))}
      </div>
      <StatusBadge match={match} viewerId={subject?.id ?? viewerId} />
      {!swipeable && <ChevronRight className="size-4 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-ink-200" />}
    </div>
  );

  if (!swipeable) {
    return (
      <Link
        href={`/play/${match.id}`}
        className="group block rounded-3xl border border-white/[0.07] bg-ink-850/70 transition hover:border-white/15 hover:bg-ink-800/80"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-3xl", gone && "pointer-events-none")}>
      <motion.div style={{ opacity: acceptOpacity }} className="absolute inset-0 flex items-center rounded-3xl bg-success/20 pl-6 text-success">
        <Check className="size-6" /> <span className="ml-2 text-sm font-bold">Accept</span>
      </motion.div>
      <motion.div style={{ opacity: declineOpacity }} className="absolute inset-0 flex items-center justify-end rounded-3xl bg-danger/20 pr-6 text-danger">
        <span className="mr-2 text-sm font-bold">Decline</span> <X className="size-6" />
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={onDragEnd}
        style={{ x, rotate }}
        className="relative cursor-grab rounded-3xl border border-volt/25 bg-ink-850 active:cursor-grabbing"
      >
        <Link href={`/play/${match.id}`} draggable={false} className="block" onClick={(e) => Math.abs(x.get()) > 5 && e.preventDefault()}>
          {content}
        </Link>
        <div className="flex gap-2 px-3.5 pb-3.5">
          <button
            onClick={() => {
              play("vote");
              onAccept?.();
            }}
            className="h-9 flex-1 rounded-full bg-ink-50 text-sm font-bold text-ink-950 transition hover:bg-white"
          >
            Accept
          </button>
          <button
            onClick={() => onDecline?.()}
            className="h-9 flex-1 rounded-full border border-white/10 text-sm font-semibold text-ink-200 transition hover:bg-white/[0.06]"
          >
            Decline
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** "⚡ @maya beat @leo in Reflexes" pill for tickers. */
export function ActivityPill({ match, apps }: { match: Match; apps?: AppManifest[] }) {
  const app = apps?.find((a) => a.slug === match.appSlug) ?? getOfficialApp(match.appSlug);
  const winner = match.players.find((p) => p.userId === match.winnerId);
  const loser = match.players.find((p) => p.userId !== match.winnerId);
  const [a, b] = match.players;
  let text: React.ReactNode;
  if (match.status === "voting") {
    text = (
      <>
        <b>@{a?.profile.handle}</b> vs <b>@{b?.profile.handle}</b> — crowd is voting
      </>
    );
  } else if (match.status === "active") {
    text = (
      <>
        <b>@{a?.profile.handle}</b> vs <b>@{b?.profile.handle}</b> — live now
      </>
    );
  } else if (winner && loser) {
    text = (
      <>
        <b>@{winner.profile.handle}</b> beat <b>@{loser.profile.handle}</b>
      </>
    );
  } else {
    text = (
      <>
        <b>@{a?.profile.handle}</b> drew with <b>@{b?.profile.handle}</b>
      </>
    );
  }
  return (
    <Link
      href={match.status === "voting" ? "/arena" : `/apps/${match.appSlug}`}
      className="flex h-11 shrink-0 items-center gap-2.5 rounded-full border border-white/[0.07] bg-ink-850/80 py-1 pl-1.5 pr-4 text-sm text-ink-200 transition hover:border-white/20 hover:text-ink-50"
    >
      {app && <AppGlyph app={app} size={30} />}
      <span className="whitespace-nowrap [&_b]:font-semibold [&_b]:text-ink-50">{text}</span>
      <span className="whitespace-nowrap text-xs text-ink-500">{timeAgo(match.endedAt ?? match.createdAt)}</span>
    </Link>
  );
}
