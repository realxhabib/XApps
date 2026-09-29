"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Gavel, LogIn, Send, Trophy } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { EntryView } from "@/components/arena/entry-view";
import { needsMyMove } from "@/components/chrome/use-inbox";
import { AppCard } from "@/components/marketplace/app-card";
import { ActivityPill, MatchCard } from "@/components/marketplace/match-card";
import { Marquee } from "@/components/motion/marquee";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { TiltCard } from "@/components/motion/tilt-card";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FEATURED_APPS, FEATURED_FALLBACK } from "@/platform/catalog";
import { seatedPlayers } from "@/platform/match-utils";
import { useViewer } from "@/platform/client";
import { useActivity, useApps, useMyMatches, useVotingMatches } from "@/platform/queries";

export function SectionHeading({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex items-end justify-between gap-4", className)}>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">{eyebrow}</p>
        <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function LiveTicker() {
  const { data: activity } = useActivity();
  const { data: apps } = useApps();
  if (!activity || activity.length === 0) return null;
  const items = activity.slice(0, 14);
  return (
    <section className="-mx-[var(--page-gutter)] mt-6" aria-label="Recent activity">
      <Marquee duration={60}>
        {items.map((m) => (
          <ActivityPill key={m.id} match={m} apps={apps} />
        ))}
      </Marquee>
    </section>
  );
}

export function YourMove() {
  const { viewer } = useViewer();
  const { data } = useMyMatches();
  if (!viewer || !data) return null;
  const mine = data.filter((m) => needsMyMove(m, viewer.id)).slice(0, 4);
  if (mine.length === 0) return null;
  return (
    <section className="mt-16">
      <SectionHeading
        eyebrow="Waiting on you"
        title="Your move"
        action={
          <Button href="/challenges" variant="ghost" size="sm" iconRight={<ArrowRight className="size-4" />}>
            All challenges
          </Button>
        }
      />
      <Reveal className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {mine.map((m) => (
          <RevealItem key={m.id}>
            <MatchCard match={m} viewerId={viewer.id} />
          </RevealItem>
        ))}
      </Reveal>
    </section>
  );
}

export function FeaturedApps() {
  const { data: apps } = useApps();
  const byslug = (slug: string) => apps?.find((a) => a.slug === slug);
  // Two big cards (skipping featured apps this deployment doesn't list yet), then a row of favorites.
  const big = apps ? [...FEATURED_APPS, ...FEATURED_FALLBACK].filter((slug) => byslug(slug)).slice(0, 2) : FEATURED_APPS;
  const rest = ["meme-duel", "quick-draw", "hot-takes", "trivia-royale", "four-in-a-row"].filter((slug) => !big.includes(slug)).slice(0, 5);
  const layout: { slug: string; className: string; size?: "lg" }[] = [
    ...big.map((slug) => ({ slug, className: "md:col-span-3", size: "lg" as const })),
    ...rest.map((slug) => ({ slug, className: "md:col-span-2" })),
  ];
  return (
    <section className="mt-20">
      <SectionHeading
        eyebrow="Featured"
        title="Pick your arena"
        action={
          <Button href="/apps" variant="ghost" size="sm" iconRight={<ArrowRight className="size-4" />}>
            Browse all
          </Button>
        }
      />
      <Reveal className="grid grid-cols-1 gap-4 md:grid-cols-6" stagger={0.07}>
        {layout.map(({ slug, className, size }) => {
          const app = byslug(slug);
          return (
            <RevealItem key={slug} className={className}>
              {app ? <AppCard app={app} size={size} /> : <Skeleton className="h-full min-h-72 rounded-[2rem]" />}
            </RevealItem>
          );
        })}
        <RevealItem className="md:col-span-2">
          <Link href="/developers" className="group block h-full">
            <TiltCard className="h-full rounded-[2rem]">
              <div className="flex h-full min-h-72 flex-col justify-between rounded-[2rem] border border-dashed border-white/15 bg-white/[0.02] p-6 transition group-hover:border-white/30">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] text-2xl">🛠️</span>
                <div>
                  <h3 className="font-display text-xl font-extrabold">Your app here</h3>
                  <p className="mt-2 text-sm text-ink-300">
                    Identity, realtime rooms, matchmaking and crowd voting — one tiny SDK. Ship a head-to-head app this
                    weekend.
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-nova-300">
                    Read the docs <ArrowRight className="size-4 transition group-hover:translate-x-1" />
                  </span>
                </div>
              </div>
            </TiltCard>
          </Link>
        </RevealItem>
      </Reveal>
    </section>
  );
}

export function ArenaTeaser() {
  const { data } = useVotingMatches();
  const match = data?.find((m) => {
    const seated = seatedPlayers(m);
    return seated.length >= 2 && seated.every((p) => p.submission?.display || p.state === "left");
  });
  if (!match) return null;
  const entries = seatedPlayers(match).filter((p) => p.submission?.display);
  const shown = entries.slice(0, 4);
  const more = entries.length - shown.length;
  return (
    <section className="mt-24">
      <div className="relative overflow-hidden rounded-[2.5rem] border border-white/[0.08] bg-ink-850/70 p-6 sm:p-10">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-flare/20 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -right-24 size-96 rounded-full bg-nova-500/20 blur-3xl" />
        <div className="relative grid grid-cols-1 items-center gap-8 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-flare">The Arena</p>
            <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Who did it better?
            </h2>
            <p className="mt-4 max-w-md text-ink-300">
              Meme duels and hot takes are judged by you. Every vote earns XP, and every verdict lands on someone&apos;s
              timeline.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button href="/arena" size="lg" variant="primary" icon={<Gavel className="size-4" />} magnetic>
                Start judging
              </Button>
              <span className="text-sm text-ink-400">{data?.length ?? 0} contests waiting</span>
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-3 sm:gap-4">
            {more > 0 && (
              <span className="absolute -right-2 -top-3 z-10 rounded-full bg-flare px-2.5 py-1 text-xs font-bold text-ink-950 shadow-lg">
                +{more} more
              </span>
            )}
            {shown.map((p, i) =>
              p ? (
                <motion.div
                  key={p.userId}
                  initial={{ opacity: 0, y: 40, rotate: i % 2 ? 4 : -4 }}
                  whileInView={{ opacity: 1, y: 0, rotate: i % 2 ? 2 : -2 }}
                  viewport={{ once: true }}
                  whileHover={{ rotate: 0, scale: 1.03, y: -6 }}
                  transition={{ type: "spring", stiffness: 180, damping: 18, delay: i * 0.08 }}
                  className="rounded-3xl glass p-2.5"
                >
                  <EntryView display={p.submission?.display} compact />
                  <div className="mt-2 flex items-center gap-2 px-1 pb-1">
                    <Avatar person={p.profile} size={24} />
                    <span className="truncate text-xs text-ink-300">@{p.profile.handle}</span>
                  </div>
                </motion.div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: LogIn, title: "Sign in with X", body: "Your handle and avatar come with you. No new account, no new password." },
  { icon: Send, title: "Challenge anyone", body: "Pick an app, tag a rival or post an open challenge link to your timeline." },
  { icon: Trophy, title: "Win, climb, flex", body: "Earn XP, climb the ranks, and share the receipts straight back to X." },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 80%", "end 60%"] });
  const line = useTransform(scrollYProgress, [0, 1], [0, 1]);
  return (
    <section className="mt-24" ref={ref}>
      <SectionHeading eyebrow="How it works" title="From timeline to showdown in seconds" />
      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="absolute left-[16%] right-[16%] top-10 hidden h-px bg-white/10 md:block">
          <motion.div
            className="h-full origin-left bg-[linear-gradient(90deg,var(--color-nova-400),var(--color-flare),var(--color-volt))]"
            style={{ scaleX: line }}
          />
        </div>
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <motion.div
              key={step.title}
              className="relative rounded-[2rem] glass p-6"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.12, type: "spring", stiffness: 160, damping: 20 }}
            >
              <div className="flex items-center gap-3">
                <span className="relative flex size-12 items-center justify-center rounded-2xl bg-ink-950 ring-1 ring-white/15">
                  <Icon className="size-5" />
                </span>
                <span className="font-mono text-sm text-ink-500">0{i + 1}</span>
              </div>
              <h3 className="mt-5 font-display text-xl font-extrabold">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-300">{step.body}</p>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

const SNIPPET = `import { connect } from "@xapps/sdk";

const xapps = await connect();          // who's playing, the shared seed…
xapps.room.on("move", (move, from) => apply(move));
xapps.onStart(() => startTheClock());   // after the host's VS intro

await xapps.ready();
// …your game…
await xapps.submit({ score: 42 });      // the platform settles & awards XP`;

export function BuildTeaser() {
  return (
    <section className="mt-24">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-nova-300">For builders</p>
          <h2 className="mt-3 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Your idea, their timeline.
          </h2>
          <p className="mt-4 max-w-md text-ink-300">
            Build a mini game, a contest or something nobody&apos;s thought of yet. XApps gives you X identity, realtime
            rooms, matchmaking, crowd judging, a VS intro and a results screen — you bring the fun.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button href="/developers" size="lg" variant="primary" iconRight={<ArrowRight className="size-4" />}>
              Read the docs
            </Button>
            <Button href="/developers/sandbox" size="lg" variant="glass">
              Open the sandbox
            </Button>
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 40, rotate: 2 }}
          whileInView={{ opacity: 1, y: 0, rotate: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ type: "spring", stiffness: 120, damping: 18 }}
        >
          <CodeBlock code={SNIPPET} filename="my-app.ts" typing />
        </motion.div>
      </div>
    </section>
  );
}
