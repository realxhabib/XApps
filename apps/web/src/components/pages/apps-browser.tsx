"use client";

import { AnimatePresence, motion } from "motion/react";
import { AppWindow, ArrowBigUp, Plus, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { AppCard } from "@/components/marketplace/app-card";
import { TiltCard } from "@/components/motion/tilt-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { useApps } from "@/platform/queries";
import { CATEGORIES, type AppCategory, type AppManifest } from "@/platform/types";
import { sortApps, type AppSort } from "@/platform/upvotes";

/** A category, or "apps": everything people open rather than play against each other. */
type Filter = "all" | "apps" | AppCategory;

export function AppsBrowser() {
  const { data: apps, isPending } = useApps();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<AppSort>("top");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());

  // The order is worked out when the list (or the sort) changes, not on every upvote, so a
  // card doesn't jump out from under the pointer the moment you upvote it.
  const orderKey = `${sort}|${(apps ?? []).map((a) => a.slug).join(" ")}`;
  const [order, setOrder] = useState<{ key: string; slugs: string[] } | null>(null);
  if (apps && order?.key !== orderKey) setOrder({ key: orderKey, slugs: sortApps(apps, sort).map((a) => a.slug) });
  const sorted = useMemo(() => {
    const bySlug = new Map((apps ?? []).map((a) => [a.slug, a]));
    const ranked = order?.key === orderKey ? order.slugs : sortApps(apps ?? [], sort).map((a) => a.slug);
    return ranked.map((slug) => bySlug.get(slug)).filter((a): a is AppManifest => !!a);
  }, [apps, order, orderKey, sort]);

  const categories = useMemo(() => {
    const present = new Set((apps ?? []).map((a) => a.category));
    return CATEGORIES.filter((c) => present.has(c.id));
  }, [apps]);
  const hasApps = (apps ?? []).some((a) => a.kind === "app");

  const visible = useMemo(
    () =>
      sorted.filter((app) => {
        if (filter === "apps" ? app.kind !== "app" : filter !== "all" && app.category !== filter) return false;
        if (!q) return true;
        return `${app.name} ${app.tagline} ${app.tags.join(" ")} ${app.developer.handle}`.toLowerCase().includes(q);
      }),
    [sorted, filter, q],
  );

  return (
    <div>
      <motion.header initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={spring.soft}>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Marketplace</p>
        <h1 className="mt-2 font-display text-5xl font-extrabold tracking-tight sm:text-6xl">
          Every way to <span className="text-gradient">settle it</span>.
        </h1>
        <p className="mt-3 max-w-xl text-ink-300">
          Games and contests head-to-head, plus apps you simply open. All built on the same open SDK.
        </p>
      </motion.header>

      <motion.div
        className="sticky top-20 z-20 mt-8 flex flex-col gap-3 rounded-[1.75rem] py-2 sm:flex-row sm:items-center"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, ...spring.soft }}
      >
        <label className="glass flex h-12 flex-1 items-center gap-2.5 rounded-full px-4 focus-within:border-white/25 sm:max-w-xs">
          <Search className="size-4 text-ink-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search apps"
            className="h-full w-full bg-transparent text-sm outline-none placeholder:text-ink-500"
            aria-label="Search apps"
          />
          <AnimatePresence>
            {query && (
              <motion.button
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                onClick={() => setQuery("")}
                className="flex size-6 items-center justify-center rounded-full bg-white/10"
                aria-label="Clear search"
              >
                <X className="size-3" />
              </motion.button>
            )}
          </AnimatePresence>
        </label>
        <Segmented
          layoutId="apps-filter"
          value={filter}
          onChange={setFilter}
          items={[
            { id: "all" as Filter, label: "All" },
            ...(hasApps ? [{ id: "apps" as Filter, label: "Apps", icon: <AppWindow className="size-3.5" /> }] : []),
            ...categories.map((c) => ({ id: c.id as Filter, label: c.label, icon: <span>{c.emoji}</span> })),
          ]}
        />
        <Segmented
          layoutId="apps-sort"
          value={sort}
          onChange={setSort}
          className="shrink-0 self-start sm:ml-auto sm:self-auto"
          items={[
            { id: "top" as AppSort, label: "Top", icon: <ArrowBigUp className="size-3.5" /> },
            { id: "new" as AppSort, label: "New", icon: <Sparkles className="size-3.5" /> },
          ]}
        />
      </motion.div>

      {isPending ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-[2rem]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState emoji="🔍" title="No apps match that" className="mt-8">
          Try another search — or build the app you were looking for.
        </EmptyState>
      ) : (
        <motion.div layout className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {visible.map((app, i) => (
              <motion.div
                layout
                key={app.slug}
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: { ...spring.soft, delay: i * 0.04 } }}
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
              >
                <AppCard app={app} />
              </motion.div>
            ))}
            {filter === "all" && !q && (
              <motion.div layout key="submit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Link href="/developers/new" className="group block h-full">
                  <TiltCard className="h-full rounded-[2rem]">
                    <div className="flex h-full min-h-80 flex-col items-center justify-center gap-4 rounded-[2rem] border border-dashed border-white/15 p-6 text-center transition group-hover:border-white/35 group-hover:bg-white/[0.02]">
                      <motion.span
                        className="flex size-16 items-center justify-center rounded-3xl bg-white/[0.06]"
                        whileHover={{ rotate: 90 }}
                        transition={spring.bouncy}
                      >
                        <Plus className="size-7" />
                      </motion.span>
                      <div>
                        <p className="font-display text-xl font-extrabold">Submit your app</p>
                        <p className="mt-1 text-sm text-ink-300">Ship it with @xapps/sdk and list it here.</p>
                      </div>
                    </div>
                  </TiltCard>
                </Link>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
