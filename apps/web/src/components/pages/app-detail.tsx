"use client";

import { AnimatePresence, motion } from "motion/react";
import { Bot, Clock3, Eye, Gavel, LayoutDashboard, Repeat, Share2, Swords, Target, Users, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppArt } from "@/components/marketplace/app-art";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { useIsAppOwner } from "@/components/developers/server-panel";
import { AppProgress } from "./app-progress";
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
import { useResolveViewer, useViewer } from "@/platform/client";
import { isMultiplayer, seatedPlayers, tableSizeLabel, tableSizeLabelForMatch } from "@/components/play/match-view";
import { play } from "@/lib/sfx";
import { MODE_LABEL } from "@/platform/match-utils";
import { useActivity, useApp, useLeaderboard, usePractice, useQuickMatch } from "@/platform/queries";
import { CATEGORIES } from "@/platform/types";

export function AppDetail({ slug }: { slug: string }) {
  const router = useRouter();
  const { viewer } = useViewer();
  const resolveViewer = useResolveViewer();
  const { data: app, isPending } = useApp(slug);
  const quick = useQuickMatch();
  const practice = usePractice();
  const [sheet, setSheet] = useState(false);
  const [practiceSeats, setPracticeSeats] = useState<number | null>(null);
  const { data: leaders } = useLeaderboard(slug);
  const { data: activity } = useActivity();
  const isOwner = useIsAppOwner(app);

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
  const step = (app.teams ?? 0) >= 2 ? app.teams! : 1;
  const seatChoices: number[] = [];
  for (let n = Math.ceil(app.players.min / step) * step; n <= app.players.max; n += step) seatChoices.push(n);
  const seats = practiceSeats ?? seatChoices[0] ?? app.players.min;
  const needSignIn = () => router.push(`/login?next=${encodeURIComponent(`/apps/${slug}`)}`);
  const go = async (kind: "quick" | "practice") => {
    if (!(viewer ?? (await resolveViewer()))) return needSignIn();
    try {
      const match =
        kind === "quick"
          ? await quick.mutateAsync(app.slug)
          : await practice.mutateAsync(seatChoices.length > 1 ? { appSlug: app.slug, players: seats } : app.slug);
      router.push(`/play/${match.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Couldn't start a match", { tone: "danger" });
    }
  };
  const recent = (activity ?? []).filter((m) => m.appSlug === app.slug).slice(0, 6);
  const watchable =
    app.spectators !== false
      ? (activity ?? []).filter((m) => m.appSlug === app.slug && m.status === "active" && m.mode !== "practice" && !m.players.some((p) => p.userId === viewer?.id)).slice(0, 3)
      : [];
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
        <div className="relative grid grid-cols-1 gap-6 p-6 sm:p-10 lg:grid-cols-[1.2fr_1fr]">
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
                <Users className="size-4" /> {tableSizeLabel(app)}
              </span>
              {app.turnBased && (
                <span className="flex items-center gap-1.5">
                  <Repeat className="size-4" /> Turn-based
                </span>
              )}
              {app.spectators !== false && (
                <span className="flex items-center gap-1.5">
                  <Eye className="size-4" /> Spectators welcome
                </span>
              )}
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
                  onClick={async () => ((viewer ?? (await resolveViewer())) ? setSheet(true) : needSignIn())}
                >
                  Challenge someone
                </Button>
              )}
              <Button size="xl" variant="ghost" icon={<Bot className="size-5" />} loading={practice.isPending} onClick={() => go("practice")}>
                {seatChoices.length > 1 ? `Practice · ${seats}` : "Practice"}
              </Button>
            </motion.div>
            {seatChoices.length > 1 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <span>Practice table</span>
                <div className="flex items-center gap-1 rounded-full glass p-1" role="radiogroup" aria-label="Practice table size">
                  {seatChoices.map((n) => {
                    const active = n === seats;
                    return (
                      <button
                        key={n}
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          if (!active) play("tick");
                          setPracticeSeats(n);
                        }}
                        className={cn(
                          "relative flex h-7 min-w-9 items-center justify-center rounded-full px-2 font-semibold tabular transition-colors",
                          active ? "text-ink-950" : "text-ink-300 hover:text-ink-50",
                        )}
                      >
                        {active && <motion.span layoutId="practice-seats" className="absolute inset-0 rounded-full bg-ink-50" transition={spring.layout} />}
                        <span className="relative">{(app.teams ?? 0) >= 2 ? tableSizeLabel({ players: { min: n, max: n }, teams: app.teams }) : n}</span>
                      </button>
                    );
                  })}
                </div>
                <span>{(app.teams ?? 0) >= 2 ? "" : "seats · bots fill the rest"}</span>
              </div>
            )}
            <p className="mt-3 text-xs text-ink-400">
              Modes: {app.modes.map((m) => MODE_LABEL[m]).join(" · ")}
            </p>
          </div>
          <motion.div
            className={cn("relative", app.coverImage ? "aspect-video self-center overflow-hidden rounded-[1.75rem] border border-white/10 shadow-2xl" : "hidden min-h-72 lg:block")}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, ...spring.soft }}
          >
            <AppArt app={app} className={cn("absolute inset-0", !app.coverImage && "scale-125")} />
          </motion.div>
        </div>
      </section>

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
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
          <AnimatePresence initial={false}>
            {watchable.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={spring.soft}
              >
                <h2 className="mb-3 flex items-center gap-2 font-display text-2xl font-extrabold">
                  <span className="relative flex size-2.5">
                    <span className="absolute inset-0 animate-ping-soft rounded-full bg-danger" />
                    <span className="relative size-2.5 rounded-full bg-danger" />
                  </span>
                  Live now
                </h2>
                <div className="space-y-2">
                  {watchable.map((m) => {
                    const seated = seatedPlayers(m);
                    return (
                      <Link
                        key={m.id}
                        href={`/play/${m.id}`}
                        className="group flex items-center gap-3 rounded-3xl border border-white/[0.07] bg-ink-850/70 p-2.5 pr-3 transition hover:border-white/15 hover:bg-ink-800/80"
                      >
                        <div className="flex -space-x-2">
                          {seated.slice(0, 4).map((p) => (
                            <Avatar key={p.userId} person={{ ...p.profile, isBot: p.isBot }} size={32} className="rounded-full ring-2 ring-ink-850" />
                          ))}
                        </div>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {seated
                            .slice(0, 3)
                            .map((p) => `@${p.profile.handle}`)
                            .join(isMultiplayer(m) ? ", " : " vs ")}
                          {seated.length > 3 && ` +${seated.length - 3}`}
                          <span className="ml-1.5 text-xs text-ink-400">{isMultiplayer(m) ? tableSizeLabelForMatch(m) : MODE_LABEL[m.mode]}</span>
                        </span>
                        <span className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3 text-xs font-semibold transition group-hover:bg-white/15">
                          <Eye className="size-3.5" /> Watch
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </motion.section>
            )}
          </AnimatePresence>
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

      <AppProgress app={app} className="mt-6" />

      {isOwner && (
        <Link
          href={`/developers/apps/${app.slug}`}
          className="mt-10 flex items-center gap-3 rounded-3xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm transition hover:border-white/20 hover:bg-white/[0.05]"
        >
          <LayoutDashboard className="size-4 text-ink-300" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">You own this app.</span> <span className="text-ink-400">Versions, analytics, logs and server settings live in the console.</span>
          </span>
          <span className="shrink-0 font-semibold text-nova-300">Manage in console →</span>
        </Link>
      )}

      <ChallengeSheet app={app} open={sheet} onClose={() => setSheet(false)} />
    </div>
  );
}
