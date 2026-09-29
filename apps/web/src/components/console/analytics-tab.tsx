"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Play, Table2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { cn, formatNumber } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import { useAppAnalytics, useAppVersions } from "@/platform/queries";
import type { AppAnalytics, AppManifest, PlayableMode } from "@/platform/types";
import { BarList, Legend, LineChart, Meter, SERIES_COLORS, StatTile, shortDate } from "./charts";
import { formatDuration, formatPercent } from "./format";
import { asRatio } from "./overview-tab";
import { usePlayTestBuild } from "./test-build";
import { Panel, PanelTitle } from "./ui";

type Range = "7" | "30" | "90";

const MATCH_SERIES = [
  { key: "matchesCreated" as const, label: "Created", color: SERIES_COLORS[0] },
  { key: "matchesCompleted" as const, label: "Completed", color: SERIES_COLORS[1] },
  { key: "matchesAbandoned" as const, label: "Abandoned", color: SERIES_COLORS[2] },
];
const PLAYER_SERIES = [
  { key: "players" as const, label: "Players", color: SERIES_COLORS[0] },
  { key: "newPlayers" as const, label: "New players", color: SERIES_COLORS[1] },
];

export function AnalyticsTab({ app }: { app: AppManifest }) {
  const [range, setRange] = useState<Range>("30");
  const [table, setTable] = useState(false);
  const { data, isPending, isError, isFetching } = useAppAnalytics(app.slug, Number(range));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          layoutId="analytics-range"
          size="sm"
          value={range}
          onChange={setRange}
          items={[
            { id: "7", label: "7 days" },
            { id: "30", label: "30 days" },
            { id: "90", label: "90 days" },
          ]}
        />
        <button
          type="button"
          onClick={() => setTable((t) => !t)}
          aria-pressed={table}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition", table ? "border-white/40 bg-white/10" : "border-white/10 text-ink-300 hover:text-ink-50")}
        >
          <Table2 className="size-3.5" /> Table view
        </button>
      </div>

      {isPending ? (
        <AnalyticsSkeleton />
      ) : isError || !data ? (
        <EmptyState emoji="📉" title="Analytics unavailable" className="mt-4">
          We couldn&apos;t load analytics for this app. Try again in a moment.
        </EmptyState>
      ) : data.totals.matches === 0 ? (
        <NoMatches app={app} days={data.days} />
      ) : (
        <motion.div className={cn("transition-opacity", isFetching && "opacity-60")}>
          <Dashboard data={data} table={table} />
        </motion.div>
      )}
    </div>
  );
}

function NoMatches({ app, days }: { app: AppManifest; days: number }) {
  const { data: versions } = useAppVersions(app.slug);
  const playBuild = usePlayTestBuild(app.slug);
  const target = versions?.find((v) => v.status === "published") ?? versions?.[0] ?? null;
  return (
    <EmptyState
      emoji="🌱"
      title={`No matches in the last ${days} days`}
      className="mt-4"
      action={
        target ? (
          <Button variant="primary" icon={<Play className="size-4" />} loading={playBuild.isPending} onClick={() => playBuild.mutate(target)}>
            Play a practice match
          </Button>
        ) : undefined
      }
    >
      Charts fill in as people play. Practice and test matches count too, so you can see them work right away.
    </EmptyState>
  );
}

function Dashboard({ data, table }: { data: AppAnalytics; table: boolean }) {
  const reduced = useReducedMotion();
  const completion = asRatio(data.completionRate);
  const d1 = asRatio(data.retention.d1);
  const d7 = asRatio(data.retention.d7);
  const sum = (key: "matchesCreated" | "matchesCompleted" | "matchesAbandoned" | "players" | "newPlayers") => data.series.reduce((n, d) => n + d[key], 0);
  const enter = (i: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { ...spring.soft, delay: reduced ? 0 : i * 0.05 },
  });

  return (
    <div className="mt-4 space-y-4">
      <motion.div {...enter(0)} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Matches" value={formatNumber(data.totals.matches)} sub={`${formatNumber(data.totals.completed)} completed`} />
        <StatTile label="Players" value={formatNumber(data.totals.players)} sub={`${formatNumber(data.totals.newPlayers)} new`} />
        <StatTile label="Completion rate" value={formatPercent(completion)} sub="completed ÷ created" />
        <StatTile label="Median duration" value={formatDuration(data.medianDurationSec)} sub="completed matches" />
      </motion.div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div {...enter(1)}>
          <Panel>
            <PanelTitle sub="Per day">Matches</PanelTitle>
            <div className="mt-3">
              <Legend items={MATCH_SERIES.map((s) => ({ label: s.label, color: s.color, value: formatNumber(sum(s.key)) }))} />
            </div>
            <div className="mt-3">
              {table ? (
                <SeriesTable data={data} series={MATCH_SERIES} />
              ) : (
                <LineChart data={data.series} series={MATCH_SERIES} label={`Matches per day, last ${data.days} days`} />
              )}
            </div>
          </Panel>
        </motion.div>
        <motion.div {...enter(2)}>
          <Panel>
            <PanelTitle sub="Unique players per day">Players</PanelTitle>
            <div className="mt-3">
              <Legend
                items={[
                  { label: "Players", color: PLAYER_SERIES[0].color, value: formatNumber(data.totals.players) },
                  { label: "New players", color: PLAYER_SERIES[1].color, value: formatNumber(data.totals.newPlayers) },
                ]}
              />
            </div>
            <div className="mt-3">
              {table ? (
                <SeriesTable data={data} series={PLAYER_SERIES} />
              ) : (
                <LineChart data={data.series} series={PLAYER_SERIES} label={`Players per day, last ${data.days} days`} />
              )}
            </div>
          </Panel>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div {...enter(3)}>
          <Panel className="h-full">
            <PanelTitle sub="How many matches reach a result, and who comes back">Health</PanelTitle>
            <div className="mt-4 space-y-4">
              <MeterRow label="Completion rate" value={completion} hint={`${formatNumber(data.totals.completed)} of ${formatNumber(data.totals.matches)} matches`} />
              <MeterRow label="Day-1 retention" value={d1} hint={d1 === null ? "Not enough new players yet" : "New players who played again the next day"} />
              <MeterRow label="Day-7 retention" value={d7} hint={d7 === null ? "Needs a week of new players" : "New players still playing a week later"} />
            </div>
          </Panel>
        </motion.div>
        <motion.div {...enter(4)}>
          <Panel className="h-full">
            <PanelTitle sub="Matches by mode">Modes</PanelTitle>
            <div className="mt-4">
              <BarList
                label="Matches by mode"
                rows={[...data.modes].sort((a, b) => b.matches - a.matches).map((m) => ({ key: m.mode, label: MODE_LABEL[m.mode as PlayableMode] ?? m.mode, value: m.matches }))}
              />
            </div>
          </Panel>
        </motion.div>
        <motion.div {...enter(5)}>
          <Panel className="h-full">
            <PanelTitle sub="Matches by seats filled">Table sizes</PanelTitle>
            <div className="mt-4">
              <BarList
                label="Matches by table size"
                rows={[...data.tableSizes].sort((a, b) => a.players - b.players).map((t) => ({ key: String(t.players), label: `${t.players} players`, value: t.matches }))}
              />
            </div>
          </Panel>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div {...enter(6)}>
          <Panel className="h-full">
            <PanelTitle sub="Matches per build">Versions</PanelTitle>
            <div className="mt-4">
              <BarList
                label="Matches by version"
                rows={[...data.versions]
                  .sort((a, b) => b.matches - a.matches)
                  .map((v) => ({ key: v.versionId ?? "none", label: v.version ? <span className="font-mono">v{v.version}</span> : "Live listing", value: v.matches }))}
              />
            </div>
          </Panel>
        </motion.div>
        <motion.div {...enter(7)}>
          <Panel className="h-full">
            <PanelTitle sub="Most matches in this range">Top players</PanelTitle>
            {data.topPlayers.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-400">No players yet</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-400">
                    <th className="pb-2 font-normal">Player</th>
                    <th className="pb-2 text-right font-normal">Matches</th>
                    <th className="pb-2 text-right font-normal">Wins</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topPlayers.slice(0, 8).map((p, i) => (
                    <tr key={p.profile.id} className="border-t border-white/[0.06]">
                      <td className="py-2">
                        <Link href={`/u/${p.profile.handle}`} className="flex min-w-0 items-center gap-2 hover:underline">
                          <span className="w-4 text-right font-mono text-xs text-ink-500 tabular">{i + 1}</span>
                          <Avatar person={p.profile} size={24} />
                          <span className="truncate">@{p.profile.handle}</span>
                        </Link>
                      </td>
                      <td className="py-2 text-right font-mono tabular">{formatNumber(p.matches)}</td>
                      <td className="py-2 text-right font-mono text-ink-300 tabular">{formatNumber(p.wins)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </motion.div>
      </div>
    </div>
  );
}

function MeterRow({ label, value, hint }: { label: string; value: number | null; hint: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-ink-200">{label}</span>
        <span className="font-semibold text-ink-50">{formatPercent(value)}</span>
      </div>
      <div className="mt-1.5">
        <Meter value={value} label={label} />
      </div>
      <p className="mt-1 text-xs text-ink-400">{hint}</p>
    </div>
  );
}

function SeriesTable<K extends keyof AppAnalytics["series"][number]>({ data, series }: { data: AppAnalytics; series: { key: K; label: string }[] }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-h-[180px] overflow-y-auto rounded-xl border border-white/[0.06]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ink-850">
            <tr className="text-left text-ink-400">
              <th className="px-3 py-2 font-normal">Day</th>
              {series.map((s) => (
                <th key={String(s.key)} className="px-3 py-2 text-right font-normal">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...data.series].reverse().map((row) => (
              <tr key={row.date} className="border-t border-white/[0.05]">
                <td className="px-3 py-1.5 text-ink-300">{shortDate(row.date)}</td>
                {series.map((s) => (
                  <td key={String(s.key)} className="px-3 py-1.5 text-right font-mono tabular">
                    {formatNumber(Number(row[s.key]))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </motion.div>
    </AnimatePresence>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-3xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-[1.75rem]" />
        <Skeleton className="h-72 rounded-[1.75rem]" />
      </div>
    </div>
  );
}
