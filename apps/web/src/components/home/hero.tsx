"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Code2, Flame, Swords, Trophy, Zap } from "lucide-react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { RotatingWord } from "@/components/motion/rotating-word";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { OFFICIAL_APPS } from "@/platform/catalog";
import { useViewer } from "@/platform/client";
import { levelInfo, levelTitle } from "@/platform/scoring";
import { useActivity } from "@/platform/queries";
import { useInbox } from "@/components/chrome/use-inbox";
import { Orbit } from "./orbit";

const WORDS = ["anyone", "your mutuals", "the reply guys", "your group chat", "that one friend"];

function RecentPlayers() {
  const { data } = useActivity();
  const people = Array.from(
    new Map((data ?? []).flatMap((m) => m.players.map((p) => [p.userId, p.profile] as const))).values(),
  ).slice(0, 5);
  if (people.length === 0) return null;
  return (
    <motion.div
      className="mt-10 flex items-center gap-3"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.9 }}
    >
      <div className="flex -space-x-2.5">
        {people.map((p, i) => (
          <motion.span
            key={p.id}
            initial={{ opacity: 0, x: -10, scale: 0.6 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ delay: 1 + i * 0.07, ...spring.bouncy }}
            className="rounded-full ring-2 ring-ink-950"
          >
            <Avatar person={p} size={34} />
          </motion.span>
        ))}
      </div>
      <p className="text-sm text-ink-300">
        <b className="text-ink-100">@{people[0]?.handle}</b>
        {people.length > 1 && <> and {people.length - 1} others</>} played recently
      </p>
    </motion.div>
  );
}

function GuestCopy() {
  return (
    <motion.div key="guest" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, filter: "blur(8px)" }}>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, ...spring.soft }}>
        <Badge tone="nova" pulse>
          Sign in with X · Beta
        </Badge>
      </motion.div>
      <h1 className="mt-6 font-display text-[clamp(2.9rem,7.5vw,5.6rem)] font-extrabold leading-[0.92] tracking-[-0.04em]">
        <motion.span className="block" initial={{ opacity: 0, y: 30, filter: "blur(12px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.1, ...spring.soft, filter: { ...BLUR_TWEEN, delay: 0.1 } }}>
          Challenge
        </motion.span>
        <motion.span
          className="block"
          initial={{ opacity: 0, y: 30, filter: "blur(12px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ delay: 0.2, ...spring.soft, filter: { ...BLUR_TWEEN, delay: 0.2 } }}
        >
          <RotatingWord words={WORDS} colors={["#a9b8ff", "#a35cff", "#ff5ca8"]} />
        </motion.span>
        <motion.span className="block" initial={{ opacity: 0, y: 30, filter: "blur(12px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ delay: 0.3, ...spring.soft, filter: { ...BLUR_TWEEN, delay: 0.3 } }}>
          on X.
        </motion.span>
      </h1>
      <motion.p
        className="mt-6 max-w-lg text-lg leading-relaxed text-ink-300"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, ...spring.soft }}
      >
        Reflex duels, meme battles and hot-take showdowns. Pick an app, send the link, settle it — the crowd keeps
        score and the winner keeps the receipts.
      </motion.p>
      <motion.div
        className="mt-8 flex flex-wrap items-center gap-3"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, ...spring.soft }}
      >
        <Button href="/apps" size="xl" variant="accent" magnetic iconRight={<ArrowRight className="size-5" />}>
          Start playing
        </Button>
        <Button href="/developers" size="xl" variant="glass" icon={<Code2 className="size-5" />}>
          Build an app
        </Button>
      </motion.div>
      <RecentPlayers />
    </motion.div>
  );
}

function ViewerCopy() {
  const { viewer } = useViewer();
  const { count } = useInbox();
  if (!viewer) return null;
  const level = levelInfo(viewer.xp);
  const stats = [
    { label: "Level", value: level.level, icon: <Zap className="size-4 text-volt" />, suffix: "" },
    { label: "XP", value: viewer.xp, icon: <Trophy className="size-4 text-gold" />, suffix: "" },
    { label: "Wins", value: viewer.wins, icon: <Swords className="size-4 text-nova-300" />, suffix: "" },
    { label: "Streak", value: viewer.streak, icon: <Flame className="size-4 text-ember" />, suffix: "" },
  ];
  return (
    <motion.div key="viewer" initial={{ opacity: 0, filter: "blur(8px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0 }}>
      <Badge tone="volt">
        Lv {level.level} · {levelTitle(level.level)}
      </Badge>
      <h1 className="mt-6 font-display text-[clamp(2.6rem,6.5vw,5rem)] font-extrabold leading-[0.95] tracking-[-0.04em]">
        Your move,
        <span className="block text-gradient animate-gradient">@{viewer.handle}.</span>
      </h1>
      <div className="mt-8 grid max-w-lg grid-cols-4 gap-2">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            className="rounded-2xl glass p-3"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06, ...spring.soft }}
          >
            {s.icon}
            <p className="mt-2 font-mono text-xl font-bold tabular">
              <AnimatedNumber value={s.value} />
            </p>
            <p className="text-[11px] uppercase tracking-wider text-ink-400">{s.label}</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button href="/apps" size="xl" variant="accent" magnetic iconRight={<ArrowRight className="size-5" />}>
          Find a match
        </Button>
        <Button href="/challenges" size="xl" variant="glass" icon={<Swords className="size-5" />}>
          Challenges{count > 0 ? ` (${count})` : ""}
        </Button>
      </div>
    </motion.div>
  );
}

export function Hero() {
  const { viewer, loading } = useViewer();
  return (
    <section className="relative grid items-center gap-8 pt-6 lg:min-h-[78vh] lg:grid-cols-[1.05fr_1fr] lg:pt-2">
      <div className="relative z-10 order-2 lg:order-1">
        <AnimatePresence mode="wait">{!loading && viewer ? <ViewerCopy /> : <GuestCopy />}</AnimatePresence>
      </div>
      <motion.div
        className="relative order-1 lg:order-2"
        initial={{ opacity: 0, scale: 0.85, rotate: -6 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ delay: 0.15, type: "spring", stiffness: 90, damping: 18 }}
      >
        <Orbit apps={OFFICIAL_APPS} />
      </motion.div>
    </section>
  );
}
