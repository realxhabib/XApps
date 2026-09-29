"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertOctagon, AlertTriangle, Bug, Check, ChevronRight, Copy, Info, Pause, Play, Server, Smartphone, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useAppLogs } from "@/platform/queries";
import { isLogLevel } from "@/platform/shipping";
import type { AppLogEntry, AppManifest, LogLevel } from "@/platform/types";
import { Panel, fieldClass, useNow, ago } from "./ui";

const LEVELS: { id: LogLevel; label: string; filter: string; icon: typeof Info; tone: "neutral" | "nova" | "gold" | "danger" }[] = [
  { id: "debug", label: "Debug", filter: "All", icon: Bug, tone: "neutral" },
  { id: "info", label: "Info", filter: "Info+", icon: Info, tone: "nova" },
  { id: "warn", label: "Warn", filter: "Warn+", icon: AlertTriangle, tone: "gold" },
  { id: "error", label: "Error", filter: "Errors", icon: AlertOctagon, tone: "danger" },
];
const LEVEL = Object.fromEntries(LEVELS.map((l) => [l.id, l])) as Record<LogLevel, (typeof LEVELS)[number]>;

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    play("pop");
    toast(`${what} copied`, { tone: "success" });
  } catch {
    toast("Couldn't copy", { tone: "danger" });
  }
}

const asLine = (l: AppLogEntry) => JSON.stringify(l);

export function LogsTab({ app }: { app: AppManifest }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rawLevel = params.get("level");
  const level = isLogLevel(rawLevel) && rawLevel !== "debug" ? rawLevel : undefined;
  const matchId = params.get("match") ?? undefined;
  const [matchDraft, setMatchDraft] = useState(matchId ?? "");
  const [frozen, setFrozen] = useState<AppLogEntry[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(10_000);
  const { data, isPending, isError } = useAppLogs(app.slug, { level, matchId });
  const paused = frozen !== null;
  const logs = frozen ?? data ?? [];

  const setFilter = (next: { level?: LogLevel | null; match?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    if (next.level !== undefined) {
      if (next.level) q.set("level", next.level);
      else q.delete("level");
    }
    if (next.match !== undefined) {
      if (next.match) q.set("match", next.match);
      else q.delete("match");
    }
    setFrozen(null);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  };

  return (
    <div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Minimum level">
          <Chip on={!level} onClick={() => setFilter({ level: null })}>
            All
          </Chip>
          {LEVELS.slice(1).map((l) => {
            const Icon = l.icon;
            return (
              <Chip key={l.id} on={level === l.id} onClick={() => setFilter({ level: level === l.id ? null : l.id })}>
                <Icon className="size-3.5" aria-hidden /> {l.filter}
              </Chip>
            );
          })}
        </div>
        <form
          className="relative flex-1 lg:max-w-xs"
          onSubmit={(e) => {
            e.preventDefault();
            setFilter({ match: matchDraft.trim() || null });
          }}
        >
          <input
            className={cn(fieldClass, "h-10 pr-10 font-mono text-xs")}
            placeholder="Filter by match id"
            aria-label="Filter by match id"
            value={matchDraft}
            onChange={(e) => setMatchDraft(e.target.value)}
            onBlur={() => {
              if ((matchDraft.trim() || undefined) !== matchId) setFilter({ match: matchDraft.trim() || null });
            }}
          />
          {matchId && (
            <button
              type="button"
              aria-label="Clear match filter"
              className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-ink-400 hover:bg-white/10 hover:text-ink-50"
              onClick={() => {
                setMatchDraft("");
                setFilter({ match: null });
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>
        <div className="flex items-center gap-2 lg:ml-auto">
          <Badge tone={paused ? "neutral" : "live"} pulse={!paused}>
            {paused ? "Paused" : "Live"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            icon={paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            onClick={() => setFrozen(paused ? null : [...(data ?? [])])}
          >
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="sm" variant="ghost" icon={<Copy className="size-3.5" />} disabled={logs.length === 0} onClick={() => copyText(logs.map(asLine).join("\n"), `${logs.length} log lines`)}>
            Copy
          </Button>
        </div>
      </div>

      <Panel className="mt-4 p-0 sm:p-0">
        {isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-10 rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <p className="p-6 text-sm text-danger">Couldn&apos;t load logs.</p>
        ) : logs.length === 0 ? (
          <EmptyState emoji="📭" title={level || matchId ? "Nothing matches these filters" : "No logs yet"} className="border-0 bg-transparent">
            {level || matchId ? (
              "Try another level or clear the match filter."
            ) : (
              <>
                Call <code className="font-mono text-ink-100">xapps.log.info(&quot;…&quot;, data)</code> from your app. Uncaught errors and refused host requests show up here automatically. Kept 7 days.
              </>
            )}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-white/[0.05]" aria-live={paused ? "off" : "polite"} aria-label="Log entries">
            <AnimatePresence initial={false}>
              {logs.map((l) => (
                <LogRow
                  key={l.id}
                  log={l}
                  now={now}
                  open={open === l.id}
                  onToggle={() => setOpen((o) => (o === l.id ? null : l.id))}
                  onMatch={(id) => {
                    setMatchDraft(id);
                    setFilter({ match: id });
                  }}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
      <p className="mt-2 text-xs text-ink-500">Newest first · refreshes every few seconds while live · kept 7 days.</p>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      aria-pressed={on}
      onClick={() => {
        play("tick");
        onClick();
      }}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold transition",
        on ? "border-ink-50 bg-ink-50 text-ink-950" : "border-white/10 text-ink-300 hover:border-white/25 hover:text-ink-50",
      )}
    >
      {children}
    </motion.button>
  );
}

function LogRow({ log, now, open, onToggle, onMatch }: { log: AppLogEntry; now: number; open: boolean; onToggle: () => void; onMatch: (id: string) => void }) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const lvl = LEVEL[log.level];
  const Icon = lvl.icon;
  const json = log.data === null || log.data === undefined ? null : JSON.stringify(log.data, null, 2);
  return (
    <motion.li
      layout={!reduced ? "position" : false}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -8, backgroundColor: "rgb(255 255 255 / 0.06)" }}
      animate={{ opacity: 1, y: 0, backgroundColor: "rgb(255 255 255 / 0)" }}
      exit={{ opacity: 0 }}
      transition={{ ...spring.soft, backgroundColor: { duration: 1.2 } }}
    >
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition hover:bg-white/[0.03] sm:px-4">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={spring.snappy} className="mt-1 shrink-0 text-ink-500">
          <ChevronRight className="size-3.5" />
        </motion.span>
        <Badge tone={lvl.tone} className="mt-px h-5 shrink-0 px-2 text-[10px]">
          <Icon className="size-3" aria-hidden />
          <span className="hidden sm:inline">{lvl.label}</span>
          <span className="sr-only sm:hidden">{lvl.label}</span>
        </Badge>
        <span className="min-w-0 flex-1">
          <span className={cn("block break-words font-mono text-[13px] leading-5", log.level === "error" ? "text-[#ff8a95]" : "text-ink-100", !open && "line-clamp-2")}>{log.message}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-ink-500">
            <time dateTime={log.createdAt} title={new Date(log.createdAt).toLocaleString()}>
              {ago(log.createdAt, now)}
            </time>
            <span className="inline-flex items-center gap-1">
              {log.source === "host" ? <Server className="size-3" aria-hidden /> : <Smartphone className="size-3" aria-hidden />}
              {log.source}
            </span>
            {log.matchId && <span className="font-mono">match {log.matchId.slice(0, 8)}</span>}
            {json && <span>data</span>}
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reduced ? { duration: 0 } : spring.soft}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3 pl-9 sm:px-4 sm:pl-10">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-ink-500">Time</dt>
                <dd className="font-mono text-ink-300">{new Date(log.createdAt).toLocaleString()}</dd>
                {log.matchId && (
                  <>
                    <dt className="text-ink-500">Match</dt>
                    <dd className="flex flex-wrap items-center gap-2 font-mono text-ink-300">
                      <span className="break-all">{log.matchId}</span>
                      <button type="button" className="font-sans font-semibold text-nova-300 hover:underline" onClick={() => onMatch(log.matchId!)}>
                        Filter
                      </button>
                      <Link href={`/play/${log.matchId}`} className="font-sans font-semibold text-nova-300 hover:underline">
                        Open
                      </Link>
                    </dd>
                  </>
                )}
                {log.versionId && (
                  <>
                    <dt className="text-ink-500">Version</dt>
                    <dd className="break-all font-mono text-ink-300">{log.versionId}</dd>
                  </>
                )}
                {log.userId && (
                  <>
                    <dt className="text-ink-500">User</dt>
                    <dd className="break-all font-mono text-ink-300">{log.userId}</dd>
                  </>
                )}
              </dl>
              {json && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl [overflow-wrap:anywhere] border border-white/[0.06] bg-[#0a0c13] p-3 font-mono text-[12px] leading-relaxed text-ink-100">{json}</pre>
              )}
              <button
                type="button"
                onClick={async () => {
                  await copyText(asLine(log), "Log line");
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-300 hover:text-ink-50"
              >
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} Copy JSON
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}
