"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BarChart3, ExternalLink, GitBranch, LayoutDashboard, ScrollText, ServerCog } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { ServerPanel, useIsAppOwner } from "@/components/developers/server-panel";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { SignInPrompt } from "@/components/pages/sign-in-prompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { BLUR_TWEEN, spring } from "@/lib/motion";
import { useMounted } from "@/lib/use-mounted";
import { accentVars } from "@/lib/utils";
import { useViewer } from "@/platform/client";
import { useApp, useAppVersions } from "@/platform/queries";
import type { AppManifest } from "@/platform/types";
import { AnalyticsTab } from "./analytics-tab";
import { LogsTab } from "./logs-tab";
import { OverviewTab } from "./overview-tab";
import { VersionsTab } from "./versions-tab";

export const CONSOLE_TABS = ["overview", "versions", "analytics", "logs", "server"] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];

const TAB_ITEMS = [
  { id: "overview" as const, label: "Overview", icon: <LayoutDashboard className="hidden size-3.5 sm:block" aria-hidden /> },
  { id: "versions" as const, label: "Versions", icon: <GitBranch className="hidden size-3.5 sm:block" aria-hidden /> },
  { id: "analytics" as const, label: "Analytics", icon: <BarChart3 className="hidden size-3.5 sm:block" aria-hidden /> },
  { id: "logs" as const, label: "Logs", icon: <ScrollText className="hidden size-3.5 sm:block" aria-hidden /> },
  { id: "server" as const, label: "Server", icon: <ServerCog className="hidden size-3.5 sm:block" aria-hidden /> },
];

function isTab(value: string | null): value is ConsoleTab {
  return !!value && (CONSOLE_TABS as readonly string[]).includes(value);
}

/** `/developers/apps/[slug]`: the owner's console for one app. */
export function AppConsole({ slug }: { slug: string }) {
  const { viewer, loading } = useViewer();
  const { data: app, isPending } = useApp(slug);
  const isOwner = useIsAppOwner(app);
  // The viewer lives in the browser (demo) or a cookie session: render the shell after mount.
  const mounted = useMounted();

  if (!mounted || loading || (isPending && !app)) return <ConsoleSkeleton />;
  if (!viewer) {
    return <SignInPrompt title="Sign in to open the console">The developer console is only for the app&apos;s owner.</SignInPrompt>;
  }
  if (!app || !isOwner) {
    return (
      <EmptyState
        emoji="🧭"
        title="Nothing to manage here"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button href="/developers" variant="primary">
              Your apps
            </Button>
            {app && (
              <Button href={`/apps/${app.slug}`} variant="glass">
                Public page
              </Button>
            )}
          </div>
        }
      >
        {app ? "Only the developer who registered this app can open its console." : "This app doesn't exist, or it isn't yours."}
      </EmptyState>
    );
  }
  return <ConsoleBody app={app} />;
}

function ConsoleBody({ app }: { app: AppManifest }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const reduced = useReducedMotion();
  const raw = params.get("tab");
  const tab: ConsoleTab = isTab(raw) ? raw : "overview";
  const { data: versions } = useAppVersions(app.slug);
  const live = versions?.find((v) => v.status === "published") ?? null;
  const pending = versions?.filter((v) => v.status === "in_review").length ?? 0;

  // On phones the tab strip scrolls: keep the active tab in view (e.g. after ?tab=server).
  useEffect(() => {
    document.querySelector<HTMLElement>(`[data-console-tabs] [aria-selected="true"]`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [tab, reduced]);

  const setTab = (next: ConsoleTab) => {
    const query = new URLSearchParams(params.toString());
    if (next === "overview") query.delete("tab");
    else query.set("tab", next);
    // Filters of other tabs don't carry over.
    if (next !== "logs") {
      query.delete("level");
      query.delete("match");
    }
    const qs = query.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div style={accentVars(app.accent)}>
      <Link href="/developers" transitionTypes={["nav-back"]} className="mb-4 inline-flex items-center gap-1 text-sm text-ink-400 transition hover:text-ink-100">
        ← Developers
      </Link>

      <motion.header
        className="relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-ink-850/80 p-4 sm:p-6"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.soft}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-40"
          style={{ background: `radial-gradient(ellipse at 90% 0%, ${app.accent[0]}55, transparent 60%), radial-gradient(ellipse at 100% 100%, ${app.accent[1]}33, transparent 55%)` }}
        />
        <div className="relative flex items-center gap-3 sm:gap-4">
          <AppGlyph app={app} size={56} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-ink-400">Console</p>
            <h1 className="truncate font-display text-2xl font-extrabold tracking-tight sm:text-3xl">{app.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={app.status === "published" ? "success" : app.status === "pending" ? "gold" : "danger"}>
                {app.status === "published" ? "Listed" : app.status === "pending" ? "Not listed yet" : "Rejected"}
              </Badge>
              {live && <Badge tone="neutral" className="font-mono normal-case tracking-normal">v{live.version} live</Badge>}
              {pending > 0 && (
                <Badge tone="gold" pulse>
                  {pending} in review
                </Badge>
              )}
            </div>
          </div>
          <Button href={`/apps/${app.slug}`} variant="glass" size="sm" className="hidden sm:inline-flex" iconRight={<ExternalLink className="size-3.5" />}>
            Public page
          </Button>
        </div>
      </motion.header>

      <div data-console-tabs className="mt-4">
        <Segmented layoutId="console-tab" size="sm" value={tab} onChange={setTab} items={TAB_ITEMS.map((t) => ({ ...t, count: t.id === "versions" ? pending : undefined }))} className="w-full sm:w-auto" />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="mt-4"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, transition: { duration: 0.12 } }}
          transition={{ ...spring.soft, filter: BLUR_TWEEN }}
          role="tabpanel"
        >
          {tab === "overview" && <OverviewTab app={app} onTab={setTab} />}
          {tab === "versions" && <VersionsTab app={app} />}
          {tab === "analytics" && <AnalyticsTab app={app} />}
          {tab === "logs" && <LogsTab app={app} />}
          {tab === "server" && <ServerPanel app={app} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function ConsoleSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-5 w-28" />
      <Skeleton className="h-32 rounded-[2rem]" />
      <Skeleton className="mt-4 h-11 w-full max-w-md rounded-full" />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-64 rounded-[1.75rem]" />
    </div>
  );
}
