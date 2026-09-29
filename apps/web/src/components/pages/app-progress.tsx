"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Lock, Medal, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Reveal, RevealItem } from "@/components/motion/reveal";
import { Avatar } from "@/components/ui/avatar";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { formatStat } from "@/lib/media";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { useStatLeaderboard, useUserAchievements, useUserStats } from "@/platform/queries";
import type { AchievementDef, AppManifest, StatDef, UserAchievement } from "@/platform/types";

const AGGREGATE_HINT: Record<StatDef["aggregate"], string> = {
  max: "Personal bests · highest first",
  min: "Personal bests · lowest first",
  sum: "Running totals",
  last: "Latest values",
};

function unlockedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" });
}

/* ---------------------------------------------------------------------- */
/* App page: leaderboards + achievements                                  */
/* ---------------------------------------------------------------------- */

/** The app page's Stage 3 sections; renders nothing for apps without stats or achievements. */
export function AppProgress({ app, className }: { app: AppManifest; className?: string }) {
  const stats = app.stats ?? [];
  const achievements = app.achievements ?? [];
  if (!stats.length && !achievements.length) return null;
  return (
    <div className={cn("grid grid-cols-1 gap-6", stats.length && achievements.length && "lg:grid-cols-[1fr_1.3fr]", className)}>
      {stats.length > 0 && <StatLeaderboards app={app} stats={stats} />}
      {achievements.length > 0 && <AchievementsGrid app={app} achievements={achievements} />}
    </div>
  );
}

function StatLeaderboards({ app, stats }: { app: AppManifest; stats: StatDef[] }) {
  const { viewer } = useViewer();
  const [picked, setPicked] = useState(stats[0]!.key);
  const stat = stats.find((s) => s.key === picked) ?? stats[0]!;
  const { data: rows, isPending, error } = useStatLeaderboard(app.slug, stat.key);

  return (
    <section className="min-w-0 rounded-[2rem] glass p-6 sm:p-8" id="leaderboards">
      <div className="flex items-center gap-2">
        <Medal className="size-5 text-gold" />
        <h2 className="font-display text-2xl font-extrabold">Leaderboards</h2>
      </div>
      {stats.length > 1 && (
        <Segmented
          className="mt-4"
          size="sm"
          layoutId={`stat-tab-${app.slug}`}
          value={stat.key}
          onChange={setPicked}
          items={stats.map((s) => ({ id: s.key, label: s.label }))}
        />
      )}
      <p className="mt-3 text-xs text-ink-400">
        {stats.length === 1 && <b className="mr-1 font-semibold text-ink-200">{stat.label} ·</b>}
        {AGGREGATE_HINT[stat.aggregate]}
      </p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={stat.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={spring.snappy}
          className="mt-4"
        >
          {isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-ink-400">Couldn&apos;t load this board.</p>
          ) : !rows?.length ? (
            <p className="rounded-2xl border border-dashed border-white/10 p-5 text-center text-sm text-ink-400">
              No {stat.label.toLowerCase()} yet. Play a match to set the first one.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {rows.slice(0, 10).map((row, i) => (
                <motion.li
                  key={row.profile.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring.soft, delay: i * 0.03 }}
                >
                  <Link
                    href={`/u/${row.profile.handle}`}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-2 py-2 transition hover:bg-white/[0.05]",
                      row.profile.id === viewer?.id && "bg-white/[0.06] ring-1 ring-white/10",
                    )}
                  >
                    <span
                      className={cn(
                        "w-6 shrink-0 text-center font-mono text-sm font-bold",
                        row.rank === 1 ? "text-gold" : row.rank === 2 ? "text-ink-100" : row.rank === 3 ? "text-flare" : "text-ink-400",
                      )}
                    >
                      {row.rank}
                    </span>
                    <Avatar person={row.profile} size={34} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      @{row.profile.handle}
                      {row.profile.id === viewer?.id && <span className="ml-1 text-xs font-normal text-ink-400">(you)</span>}
                    </span>
                    <span className="shrink-0 font-mono text-sm font-bold tabular text-ink-50">{formatStat(row.value, stat.format)}</span>
                  </Link>
                </motion.li>
              ))}
            </ol>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function AchievementsGrid({ app, achievements }: { app: AppManifest; achievements: AchievementDef[] }) {
  const { viewer } = useViewer();
  const { data: mine } = useUserAchievements(viewer?.id);
  const unlocked = new Map((mine ?? []).filter((a) => a.appSlug === app.slug).map((a) => [a.achievementId, a.unlockedAt]));
  const totalXp = achievements.reduce((sum, a) => sum + a.xp, 0);
  const earnedXp = achievements.reduce((sum, a) => sum + (unlocked.has(a.id) ? a.xp : 0), 0);
  const count = achievements.filter((a) => unlocked.has(a.id)).length;

  return (
    <section className="min-w-0 rounded-[2rem] glass p-6 sm:p-8" id="achievements">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-volt" />
          <h2 className="font-display text-2xl font-extrabold">Achievements</h2>
        </div>
        <p className="text-xs text-ink-400">
          {viewer ? (
            <>
              <b className="font-mono text-ink-100">{count}</b>/{achievements.length} unlocked ·{" "}
              <b className="font-mono text-ink-100">{earnedXp}</b>/{totalXp} XP
            </>
          ) : (
            `${achievements.length} to unlock · ${totalXp} XP`
          )}
        </p>
      </div>
      {viewer && achievements.length > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${app.accent[0]}, ${app.accent[1]})` }}
            initial={{ width: 0 }}
            animate={{ width: `${(count / achievements.length) * 100}%` }}
            transition={spring.soft}
          />
        </div>
      )}
      <Reveal className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2" stagger={0.03}>
        {achievements.map((a) => (
          <RevealItem key={a.id}>
            <AchievementCard achievement={a} app={app} unlockedAt={unlocked.get(a.id) ?? null} />
          </RevealItem>
        ))}
      </Reveal>
    </section>
  );
}

function AchievementCard({ achievement: a, app, unlockedAt }: { achievement: AchievementDef; app: AppManifest; unlockedAt: string | null }) {
  const hidden = !!a.secret && !unlockedAt;
  return (
    <div
      className={cn(
        "flex h-full items-start gap-3 rounded-2xl border p-3 transition",
        unlockedAt ? "border-white/15 bg-white/[0.06]" : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      <span
        className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl text-xl", !unlockedAt && "grayscale")}
        style={
          unlockedAt
            ? { background: `linear-gradient(135deg, ${app.accent[0]}, ${app.accent[1]})` }
            : { background: "rgb(255 255 255 / 0.06)", opacity: hidden ? 1 : 0.55 }
        }
        aria-hidden
      >
        {hidden ? <Lock className="size-4 text-ink-400" /> : a.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn("flex items-center gap-1.5 text-sm font-semibold", !unlockedAt && "text-ink-200")}>
          <span className="truncate">{hidden ? "???" : a.name}</span>
          {unlockedAt && <CheckCircle2 className="size-3.5 shrink-0 text-volt" aria-label="Unlocked" />}
        </p>
        <p className="mt-0.5 line-clamp-2 text-xs text-ink-400">{hidden ? "Secret achievement. Keep playing to find it." : a.description || " "}</p>
        {unlockedAt && <p className="mt-1 text-[11px] text-ink-500">Unlocked {unlockedDate(unlockedAt)}</p>}
      </div>
      {a.xp > 0 && (
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-bold", unlockedAt ? "bg-volt/15 text-volt" : "bg-white/[0.06] text-ink-400")}>
          +{a.xp}
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Profile: badges + stats per app                                        */
/* ---------------------------------------------------------------------- */

/** Badges (unlocked achievements, grouped by app) and stats per app on a profile. */
export function ProfileProgress({ userId, apps, isMe }: { userId: string; apps: AppManifest[] | undefined; isMe: boolean }) {
  const { data: achievements } = useUserAchievements(userId);
  const { data: stats } = useUserStats(userId);
  const reduced = useReducedMotion();
  const bySlug = new Map((apps ?? []).map((a) => [a.slug, a]));

  const badgeGroups: { app: AppManifest; items: { def: AchievementDef; row: UserAchievement }[] }[] = [];
  for (const row of achievements ?? []) {
    const app = bySlug.get(row.appSlug);
    const def = app?.achievements?.find((d) => d.id === row.achievementId);
    if (!app || !def) continue;
    let group = badgeGroups.find((g) => g.app.slug === app.slug);
    if (!group) badgeGroups.push((group = { app, items: [] }));
    group.items.push({ def, row });
  }

  const statGroups: { app: AppManifest; rows: { def: StatDef; value: number }[] }[] = [];
  for (const row of stats ?? []) {
    const app = bySlug.get(row.appSlug);
    const def = app?.stats?.find((d) => d.key === row.key);
    if (!app || !def) continue;
    let group = statGroups.find((g) => g.app.slug === app.slug);
    if (!group) statGroups.push((group = { app, rows: [] }));
    group.rows.push({ def, value: row.value });
  }

  if (!achievements || !stats || !apps) {
    return <Skeleton className="mt-10 h-40 rounded-[2rem]" />;
  }
  if (!badgeGroups.length && !statGroups.length) return null;
  const badgeCount = badgeGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="mt-10 space-y-10">
      {badgeGroups.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-baseline gap-2 font-display text-2xl font-extrabold">
            Badges <span className="font-mono text-sm font-bold text-ink-400">{badgeCount}</span>
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {badgeGroups.map((group) => (
              <div key={group.app.slug} className="min-w-0 rounded-3xl glass p-4">
                <Link href={`/apps/${group.app.slug}#achievements`} className="flex items-center gap-2.5">
                  <AppGlyph app={group.app} size={32} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{group.app.name}</span>
                  <span className="shrink-0 text-xs text-ink-400">
                    {group.items.length}/{group.app.achievements?.length ?? group.items.length}
                  </span>
                </Link>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {group.items.map(({ def, row }, i) => (
                    <motion.li
                      key={def.id}
                      title={`${def.name}${def.description ? ` — ${def.description}` : ""} · ${unlockedDate(row.unlockedAt)}`}
                      className="flex max-w-full items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-3"
                      initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                      whileInView={{ opacity: 1, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ ...spring.bouncy, delay: reduced ? 0 : i * 0.04 }}
                    >
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-sm"
                        style={{ background: `linear-gradient(135deg, ${group.app.accent[0]}, ${group.app.accent[1]})` }}
                        aria-hidden
                      >
                        {def.icon}
                      </span>
                      <span className="truncate text-xs font-semibold">{def.name}</span>
                    </motion.li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
      {statGroups.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-2xl font-extrabold">{isMe ? "Your stats" : "Stats"}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {statGroups.map((group) => (
              <div key={group.app.slug} className="min-w-0 rounded-3xl glass p-4">
                <Link href={`/apps/${group.app.slug}#leaderboards`} className="flex items-center gap-2.5">
                  <AppGlyph app={group.app} size={32} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{group.app.name}</span>
                </Link>
                <dl className="mt-3 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
                  {group.rows.map(({ def, value }) => (
                    <div key={def.key} className="min-w-0 rounded-2xl bg-white/[0.04] px-3 py-2.5">
                      <dt className="truncate text-[11px] uppercase tracking-wider text-ink-400">{def.label}</dt>
                      <dd className="mt-0.5 truncate font-mono text-lg font-bold tabular">{formatStat(value, def.format)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
