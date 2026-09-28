"use client";

import { motion } from "motion/react";
import { Bot, Clock3, Gavel, Share2, Swords, Target, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppArt } from "@/components/marketplace/app-art";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { ChallengeSheet } from "@/components/marketplace/challenge-sheet";
import { ActivityPill } from "@/components/marketplace/match-card";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { openXIntent } from "@/lib/share";
import { cn, formatCompact, formatNumber } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { MODE_LABEL } from "@/platform/match-utils";
import { useActivity, useApp, useLeaderboard, usePractice, useQuickMatch } from "@/platform/queries";
import { CATEGORIES } from "@/platform/types";

export function AppDetail({ slug }: { slug: string }) {
  const router = useRouter();
  const { viewer } = useViewer();
  const { data: app, isPending } = useApp(slug);
  const quick = useQuickMatch();
  const practice = usePractice();
  const [sheet, setSheet] = useState(false);
  const { data: leaders } = useLeaderboard(slug);
  const { data: activity } = useActivity();

  if (!app) {
    return isPending ? (
      <Skeleton className="h-96 rounded-[2.5rem]" />
    ) : (
      <EmptyState emoji="🧭" title="App not found" action={<Button href="/apps">Browse apps</Button>}>
        It may have been removed, or it&apos;s still waiting for review.
      </EmptyState>
    );
  }

  const category = CATEGORIES.find((c) => c.id === app.category);
  const needSignIn = () => router.push(`/login?next=${encodeURIComponent(`/apps/${slug}`)}`);
  const go = async (kind: "quick" | "practice") => {
    if (!viewer) return needSignIn();
    try {
      const match = kind === "quick" ? await quick.mutateAsync(app.slug) : await practice.mutateAsync(app.slug);
      router.push(`/play/${match.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't start a match", { tone: "danger" });
    }
  };
  const recent = (activity ?? []).filter((m) => m.appSlug === app.slug).slice(0, 6);
  const canChallenge = app.modes.some((m) => m !== "practice");

  return (
    <div style={{ "--accent-from": app.accent[0], "--accent-to": app.accent[1] } as React.CSSProperties}>
      <Link href="/apps" transitionTypes={["nav-back"]} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 transition hover:text-ink-100">
        ← Marketplace
      </Link>

      {/* Hero */}
      <section className="relative overflow-hidden rounded-[2.5rem] border border-white/[0.08] bg-ink-850/80">
        <div
          aria-hidden
          className="absolute inset-0 opacity-50"
          style={{ background: `radial-gradient(ellipse at 85% 0%, ${app.accent[0]}55, transparent 55%), radial-gradient(ellipse at 100% 100%, ${app.accent[1]}44, transparent 55%)` }}
        />
        <div className="relative grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex items-center gap-4">
              <AppGlyph app={app} size={96} morph />
              <div className="flex flex-wrap gap-2">
                {category && (
                  <Badge>
                    {category.emoji} {category.label}
                  </Badge>
                )}
                {app.official ? <Badge tone="nova">Official</Badge> : <Badge tone="volt">Community</Badge>}
                {app.status !== "published" && <Badge tone="gold">In review</Badge>}
              </div>
            </div>
            <motion.h1
              className="mt-6 font-display text-5xl font-extrabold tracking-tight sm:text-6xl"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12, ...spring.soft }}
            >
              {app.name}
            </motion.h1>
            <motion.p
              className="mt-3 max-w-xl text-lg text-ink-200"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18, ...spring.soft }}
            >
              {app.tagline}
            </motion.p>
            <motion.div
              className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-300"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              <span className="flex items-center gap-1.5">
                <Users className="size-4" /> 1v1
              </span>
              <span className="flex items-center gap-1.5">
                <Clock3 className="size-4" /> {app.durationLabel}
              </span>
              <span className="flex items-center gap-1.5">
                {app.scoring === "votes" ? <Gavel className="size-4" /> : <Target className="size-4" />}
                {app.scoring === "votes" ? `Crowd judged · first to ${app.votesToWin ?? 5}` : "Score decides"}
              </span>
              {app.playCount > 0 && (
                <span className="flex items-center gap-1.5">
                  <Zap className="size-4" /> {formatCompact(app.playCount)} matches
                </span>
              )}
            </motion.div>

            <motion.div
              className="mt-8 flex flex-wrap gap-3"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, ...spring.soft }}
            >
              {app.modes.includes("live") && (
                <Button size="xl" variant="accent" magnetic icon={<Zap className="size-5" />} loading={quick.isPending} onClick={() => go("quick")}>
                  Quick match
                </Button>
              )}
              {canChallenge && (
                <Button
                  size="xl"
                  variant={app.modes.includes("live") ? "glass" : "accent"}
                  icon={<Swords className="size-5" />}
                  onClick={() => (viewer ? setSheet(true) : needSignIn())}
                >
                  Challenge someone
                </Button>
              )}
              <Button size="xl" variant="ghost" icon={<Bot className="size-5" />} loading={practice.isPending} onClick={() => go("practice")}>
                Practice
              </Button>
            </motion.div>
            <p className="mt-3 text-xs text-ink-400">
              Modes: {app.modes.map((m) => MODE_LABEL[m]).join(" · ")}
            </p>
          </div>
          <motion.div
            className="relative hidden min-h-72 lg:block"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, ...spring.soft }}
          >
            <AppArt app={app} className="absolute inset-0 scale-125" />
          </motion.div>
        </div>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-[2rem] glass p-6 sm:p-8">
            <h2 className="font-display text-2xl font-extrabold">How to play</h2>
            <Reveal className="mt-5 space-y-4" as="div">
              {app.howTo.map((step, i) => (
                <RevealItem key={step} className="flex gap-4">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-2xl font-mono text-sm font-bold text-ink-950"
                    style={{ background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})` }}
                  >
                    {i + 1}
                  </span>
                  <p className="pt-1.5 text-ink-200">{step}</p>
                </RevealItem>
              ))}
            </Reveal>
          </section>
          <section className="rounded-[2rem] glass p-6 sm:p-8">
            <h2 className="font-display text-2xl font-extrabold">About</h2>
            <p className="mt-3 leading-relaxed text-ink-300">{app.description}</p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-ink-400">
              <span>
                Built by <b className="text-ink-100">{app.official ? "XApps Studio" : `@${app.developer.handle}`}</b> with @xapps/sdk
              </span>
              <button
                onClick={() => openXIntent(`${app.icon} ${app.name} on XApps — ${app.tagline}`, `${window.location.origin}/apps/${app.slug}`)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition hover:bg-white/[0.06] hover:text-ink-100"
              >
                <Share2 className="size-4" /> Share
              </button>
            </div>
          </section>
          {recent.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-2xl font-extrabold">Recent matches</h2>
              <div className="flex flex-wrap gap-2">
                {recent.map((m) => (
                  <ActivityPill key={m.id} match={m} />
                ))}
              </div>
            </section>
          )}
        </div>

        <section className="h-fit rounded-[2rem] glass p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-extrabold">Top players</h2>
            <Link href={`/leaderboard?app=${app.slug}`} className="text-sm text-ink-400 transition hover:text-ink-100">
              See all
            </Link>
          </div>
          {!leaders ? (
            <div className="mt-5 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : leaders.length === 0 ? (
            <p className="mt-5 text-sm text-ink-400">Nobody has won yet. Be the first name on this board.</p>
          ) : (
            <Reveal className="mt-5 space-y-2" as="div">
              {leaders.slice(0, 6).map((row) => (
                <RevealItem key={row.profile.id}>
                  <Link
                    href={`/u/${row.profile.handle}`}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-white/[0.05]",
                      row.profile.id === viewer?.id && "bg-white/[0.06]",
                    )}
                  >
                    <span className={cn("w-6 text-center font-mono text-sm font-bold", row.rank === 1 ? "text-gold" : "text-ink-400")}>
                      {row.rank}
                    </span>
                    <Avatar person={row.profile} size={36} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">@{row.profile.handle}</span>
                    <span className="text-right text-xs text-ink-400">
                      <b className="font-mono text-sm text-ink-100">{formatNumber(row.wins)}</b> wins
                    </span>
                  </Link>
                </RevealItem>
              ))}
            </Reveal>
          )}
        </section>
      </div>

      <ChallengeSheet app={app} open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}
