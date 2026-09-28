"use client";

import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, ExternalLink, Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { ChallengeSheet } from "@/components/marketplace/challenge-sheet";
import { MatchCard } from "@/components/marketplace/match-card";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useBackend, useViewer } from "@/platform/client";
import { levelInfo, levelTitle } from "@/platform/scoring";
import { useApps, useProfile, useUserMatches } from "@/platform/queries";
import type { AppManifest } from "@/platform/types";

export function ProfileView({ handle }: { handle: string }) {
  const router = useRouter();
  const backend = useBackend();
  const { viewer } = useViewer();
  const { data: profile, isPending } = useProfile(handle);
  const { data: matches } = useUserMatches(profile?.id);
  const { data: apps } = useApps();
  const [picker, setPicker] = useState(false);
  const [challengeApp, setChallengeApp] = useState<AppManifest | null>(null);

  if (isPending) return <Skeleton className="h-80 rounded-[2.5rem]" />;
  if (!profile) {
    return (
      <EmptyState emoji="👻" title={`@${handle} isn't on XApps yet`} action={<Button href="/apps">Browse apps</Button>}>
        Send them an open challenge link — that usually does it.
      </EmptyState>
    );
  }

  const level = levelInfo(profile.xp);
  const played = profile.wins + profile.losses + profile.draws;
  const winRate = played ? Math.round((profile.wins / played) * 100) : 0;
  const isMe = viewer?.id === profile.id;
  const stats = [
    { label: "XP", value: profile.xp },
    { label: "Wins", value: profile.wins },
    { label: "Losses", value: profile.losses },
    { label: "Win rate", value: winRate, suffix: "%" },
    { label: "Best streak", value: profile.bestStreak },
  ];
  const challengeable = (apps ?? []).filter((a) => a.modes.some((m) => m !== "practice"));

  return (
    <div>
      <section className="relative overflow-hidden rounded-[2.5rem] border border-white/[0.08] bg-ink-850/80 p-6 sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 size-96 rounded-full bg-nova-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <motion.div initial={{ scale: 0.6, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={spring.bouncy}>
            <Avatar person={profile} size={128} ring={level.progress} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <Badge tone="volt">
              Lv {level.level} · {levelTitle(level.level)}
            </Badge>
            <h1 className="mt-3 truncate font-display text-4xl font-extrabold tracking-tight sm:text-5xl">{profile.name}</h1>
            <p className="mt-1 text-ink-300">@{profile.handle}</p>
            {profile.bio && <p className="mt-3 max-w-xl text-ink-200">{profile.bio}</p>}
            <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-400">
              <CalendarDays className="size-3.5" /> Joined {new Date(profile.createdAt).toLocaleDateString("en", { month: "long", year: "numeric" })}
            </p>
          </div>
          <div className="flex gap-2 sm:flex-col">
            {!isMe && (
              <Button
                variant="accent"
                size="lg"
                icon={<Swords className="size-4" />}
                magnetic
                onClick={() => (viewer ? setPicker((p) => !p) : router.push(`/login?next=/u/${profile.handle}`))}
              >
                Challenge
              </Button>
            )}
            {backend.kind === "supabase" && (
              <Button variant="glass" size="lg" href={`https://x.com/${profile.handle}`} target="_blank" rel="noreferrer" iconRight={<ExternalLink className="size-4" />}>
                View on X
              </Button>
            )}
          </div>
        </div>
        <AnimatePresence>
          {picker && (
            <motion.div
              className="relative mt-6 flex flex-wrap gap-2"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <p className="w-full text-sm text-ink-300">Challenge @{profile.handle} to…</p>
              {challengeable.map((a, i) => (
                <motion.button
                  key={a.slug}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setChallengeApp(a)}
                  className="flex items-center gap-2 rounded-full bg-white/[0.06] py-1.5 pl-1.5 pr-4 text-sm font-semibold transition hover:bg-white/10"
                >
                  <AppGlyph app={a} size={28} /> {a.name}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <Reveal className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <RevealItem key={s.label} className="rounded-3xl glass p-5">
            <p className="font-mono text-3xl font-bold tabular">
              <AnimatedNumber value={s.value} />
              {s.suffix}
            </p>
            <p className="mt-1 text-xs uppercase tracking-wider text-ink-400">{s.label}</p>
          </RevealItem>
        ))}
      </Reveal>

      <section className="mt-10">
        <h2 className="mb-4 font-display text-2xl font-extrabold">Recent matches</h2>
        {!matches ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-3xl" />
            ))}
          </div>
        ) : matches.length === 0 ? (
          <p className="text-sm text-ink-400">No public matches yet.</p>
        ) : (
          <Reveal className={cn("grid gap-3 md:grid-cols-2")}>
            {matches.map((m) => (
              <RevealItem key={m.id}>
                <MatchCard match={m} viewerId={viewer?.id} subject={{ id: profile.id, handle: profile.handle }} apps={apps} />
              </RevealItem>
            ))}
          </Reveal>
        )}
      </section>

      {challengeApp && (
        <ChallengeSheet
          app={challengeApp}
          open={!!challengeApp}
          onClose={() => setChallengeApp(null)}
          initialOpponent={profile}
        />
      )}
    </div>
  );
}
