"use client";

import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, ExternalLink, FlaskConical, MessageSquareQuote } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { cn, formatNumber } from "@/lib/utils";
import { useAppAnalytics, useAppVersions } from "@/platform/queries";
import type { AppManifest, AppVersion } from "@/platform/types";
import type { ConsoleTab } from "./app-console";
import { StatTile } from "./charts";
import { formatDuration, formatPercent } from "./format";
import { latestSemver } from "./semver";
import { Panel, PanelTitle, VERSION_STATUS, VersionStatusChip, useNow, ago } from "./ui";

export function sandboxHref(url: string, scoring: string): string {
  return `/developers/sandbox?url=${encodeURIComponent(url)}&scoring=${scoring}`;
}

/** Ratios may arrive as 0–1 or 0–100; the UI wants 0–1. */
export function asRatio(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value > 1 ? value / 100 : value;
}

export function OverviewTab({ app, onTab }: { app: AppManifest; onTab: (tab: ConsoleTab) => void }) {
  const reduced = useReducedMotion();
  const now = useNow(60_000);
  const { data: versions, isPending: versionsPending } = useAppVersions(app.slug);
  const { data: stats, isPending: statsPending, isError: statsError } = useAppAnalytics(app.slug, 7);

  const list = versions ?? [];
  const live = list.find((v) => v.status === "published") ?? null;
  const latestV = latestSemver(list.map((v) => v.version));
  const latest = list.find((v) => v.version === latestV) ?? null;
  const reviewed = [...list].filter((v) => v.reviewNotes && v.reviewedAt).sort((a, b) => Date.parse(b.reviewedAt!) - Date.parse(a.reviewedAt!))[0] ?? null;

  const steps = nextSteps(app, list, (stats?.totals.matches ?? 0) > 0);
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
      <div className="space-y-4">
        <Panel>
          <PanelTitle sub="Last 7 days, all versions" action={<TabLink onClick={() => onTab("analytics")}>Analytics</TabLink>}>
            At a glance
          </PanelTitle>
          {statsPending ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 rounded-3xl" />
              ))}
            </div>
          ) : statsError || !stats ? (
            <p className="mt-4 text-sm text-ink-400">Analytics aren&apos;t available right now.</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Matches" value={formatNumber(stats.totals.matches)} trend={stats.series.map((d) => d.matchesCreated)} />
              <StatTile label="Players" value={formatNumber(stats.totals.players)} sub={`${formatNumber(stats.totals.newPlayers)} new`} trend={stats.series.map((d) => d.players)} />
              <StatTile label="Completion" value={formatPercent(asRatio(stats.completionRate))} sub={`${formatNumber(stats.totals.completed)} finished`} />
              <StatTile label="Median match" value={formatDuration(stats.medianDurationSec)} sub="start → result" />
            </div>
          )}
        </Panel>

        <Panel>
          <PanelTitle sub="What players get, and what's next" action={<TabLink onClick={() => onTab("versions")}>Versions</TabLink>}>
            Status
          </PanelTitle>
          {versionsPending ? (
            <Skeleton className="mt-4 h-20 rounded-2xl" />
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <VersionSummary title="Live" version={live} empty="Nothing published yet" now={now} />
              <VersionSummary title="Latest" version={latest && latest.id !== live?.id ? latest : null} empty="Same as live" now={now} />
            </div>
          )}
          {reviewed && (
            <motion.figure
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring.soft}
              className={cn(
                "mt-4 rounded-2xl border p-4",
                reviewed.status === "rejected" ? "border-danger/30 bg-danger/[0.06]" : "border-white/[0.08] bg-white/[0.03]",
              )}
            >
              <figcaption className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
                <MessageSquareQuote className="size-3.5" aria-hidden /> Reviewer notes on <b className="font-mono text-ink-200">v{reviewed.version}</b>
                <VersionStatusChip status={reviewed.status} />
                <span className="ml-auto">{ago(reviewed.reviewedAt, now)}</span>
              </figcaption>
              <blockquote className="mt-2 whitespace-pre-wrap text-sm text-ink-100">{reviewed.reviewNotes}</blockquote>
            </motion.figure>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel>
          <PanelTitle sub="register → sandbox → submit → review → publish">Next steps</PanelTitle>
          <ol className="relative mt-4 space-y-1">
            {steps.map((step, i) => {
              const isCurrent = i === current;
              return (
                <motion.li
                  key={step.id}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...spring.soft, delay: reduced ? 0 : i * 0.05 }}
                  className={cn("relative flex gap-3 rounded-2xl p-2.5", isCurrent && "bg-white/[0.05]")}
                >
                  {i < steps.length - 1 && <span aria-hidden className={cn("absolute left-[1.3rem] top-10 h-[calc(100%-1.75rem)] w-px", step.done ? "bg-volt/40" : "bg-white/10")} />}
                  <span
                    className={cn(
                      "relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold",
                      step.done ? "border-volt bg-volt text-ink-950" : isCurrent ? "border-white/50 text-ink-50" : "border-white/15 text-ink-400",
                    )}
                  >
                    {step.done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm font-semibold", step.done ? "text-ink-300" : "text-ink-50")}>{step.title}</p>
                    <p className="text-xs text-ink-400">{step.body}</p>
                    {isCurrent && step.action && (
                      <div className="mt-2">
                        {step.action.tab ? (
                          <Button size="sm" variant="primary" iconRight={<ArrowRight className="size-3.5" />} onClick={() => onTab(step.action!.tab!)}>
                            {step.action.label}
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" href={step.action.href!} iconRight={<ArrowRight className="size-3.5" />}>
                            {step.action.label}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ol>
        </Panel>

        <Panel>
          <PanelTitle>Links</PanelTitle>
          <div className="mt-3 grid grid-cols-1 gap-2">
            <LinkRow href={`/apps/${app.slug}`} icon={<ExternalLink className="size-4" />} title="Public page" sub={`/apps/${app.slug}`} />
            <LinkRow
              href={sandboxHref((latest ?? live)?.url ?? app.url, (latest ?? live)?.manifest.scoring ?? app.scoring)}
              icon={<FlaskConical className="size-4" />}
              title="Sandbox"
              sub={(latest ?? live)?.url ?? app.url}
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function TabLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-nova-300 hover:underline">
      {children} <ArrowRight className="size-3" />
    </button>
  );
}

function LinkRow({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <Link href={href} className="group flex items-center gap-3 rounded-2xl border border-white/[0.08] px-3 py-2.5 transition hover:border-white/20 hover:bg-white/[0.03]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-ink-200">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block truncate font-mono text-xs text-ink-400">{sub}</span>
      </span>
      <ArrowRight className="size-4 text-ink-500 transition group-hover:translate-x-0.5 group-hover:text-ink-200" />
    </Link>
  );
}

function VersionSummary({ title, version, empty, now }: { title: string; version: AppVersion | null; empty: string; now: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-3.5">
      <p className="text-xs text-ink-400">{title}</p>
      {version ? (
        <>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-lg font-bold">v{version.version}</span>
            <VersionStatusChip status={version.status} />
          </div>
          <p className="mt-1 text-xs text-ink-400">
            {VERSION_STATUS[version.status].hint} · {ago(version.publishedAt ?? version.reviewedAt ?? version.submittedAt ?? version.createdAt, now)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-300">{empty}</p>
      )}
    </div>
  );
}

interface Step {
  id: string;
  title: string;
  body: string;
  done: boolean;
  action?: { label: string; tab?: ConsoleTab; href?: string };
}

function nextSteps(app: AppManifest, versions: AppVersion[], played: boolean): Step[] {
  const submitted = versions.some((v) => v.submittedAt || v.status !== "draft");
  const reviewed = versions.some((v) => v.status === "approved" || v.status === "published" || v.status === "retired");
  const published = versions.some((v) => v.status === "published");
  const latest = versions[0];
  return [
    { id: "register", title: "Register", body: "Your app has a slug, a listing and version 1.0.0.", done: true },
    {
      id: "sandbox",
      title: "Test in the Sandbox",
      body: "Play both seats side by side and watch the protocol log.",
      done: played || submitted,
      action: { label: "Open Sandbox", href: sandboxHref(latest?.url ?? app.url, app.scoring) },
    },
    {
      id: "submit",
      title: "Submit a version",
      body: "Send a build for review. Testers can play it meanwhile.",
      done: submitted,
      action: { label: "Go to versions", tab: "versions" },
    },
    {
      id: "review",
      title: "Pass review",
      body: "A reviewer checks the build and the listing, usually within a day.",
      done: reviewed,
      action: { label: "See status", tab: "versions" },
    },
    {
      id: "publish",
      title: "Publish",
      body: "Approved builds go live when you say so.",
      done: published,
      action: { label: "Publish", tab: "versions" },
    },
  ];
}
