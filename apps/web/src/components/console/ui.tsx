"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CircleCheck, CircleDashed, CircleX, Clock3, Minus, Plus, Rocket, Archive, PencilLine } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { spring } from "@/lib/motion";
import { cn, timeAgo } from "@/lib/utils";
import type { AppVersionStatus } from "@/platform/types";
import { diffManifests, type FieldChange, type ManifestSide } from "./manifest-diff";

/* ---------------------------------------------------------------------- */
/* Status                                                                  */
/* ---------------------------------------------------------------------- */

export const VERSION_STATUS: Record<
  AppVersionStatus,
  { label: string; tone: "neutral" | "gold" | "volt" | "danger" | "success" | "nova"; icon: typeof CircleCheck; hint: string }
> = {
  draft: { label: "Draft", tone: "neutral", icon: PencilLine, hint: "Editable. Submit it when it's ready." },
  in_review: { label: "In review", tone: "gold", icon: Clock3, hint: "Waiting for a reviewer." },
  approved: { label: "Approved", tone: "volt", icon: CircleCheck, hint: "Ready to publish whenever you are." },
  rejected: { label: "Changes requested", tone: "danger", icon: CircleX, hint: "Read the notes, edit and resubmit." },
  published: { label: "Live", tone: "success", icon: Rocket, hint: "What players get today." },
  retired: { label: "Retired", tone: "neutral", icon: Archive, hint: "Replaced by a newer version." },
};

export function VersionStatusChip({ status, className }: { status: AppVersionStatus; className?: string }) {
  const s = VERSION_STATUS[status];
  const Icon = s.icon;
  return (
    <Badge tone={s.tone} pulse={status === "in_review"} className={cn("shrink-0", className)}>
      {status !== "in_review" && <Icon className="size-3" aria-hidden />}
      {s.label}
    </Badge>
  );
}

/* ---------------------------------------------------------------------- */
/* Layout bits                                                             */
/* ---------------------------------------------------------------------- */

export function Panel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-[1.75rem] border border-white/[0.08] bg-ink-850/70 p-4 sm:p-6", className)}>
      {children}
    </section>
  );
}

export function PanelTitle({ children, sub, action, className }: { children: ReactNode; sub?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-lg font-extrabold tracking-tight">{children}</h2>
        {sub && <p className="mt-0.5 text-sm text-ink-400">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** Re-renders every `every` ms so relative times stay fresh. */
export function useNow(every = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** `timeAgo` that never says "in 1m" for something that just happened after the last tick. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  return timeAgo(iso, Math.max(now, Date.parse(iso)));
}

export const fieldClass =
  "h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm outline-none transition placeholder:text-ink-500 focus:border-nova-400/60 focus:bg-white/[0.05]";

/* ---------------------------------------------------------------------- */
/* Manifest diff                                                           */
/* ---------------------------------------------------------------------- */

const KIND = {
  added: { icon: Plus, className: "text-success", label: "Added" },
  removed: { icon: Minus, className: "text-danger", label: "Removed" },
  changed: { icon: ArrowRight, className: "text-gold", label: "Changed" },
} as const;

/** Field-level diff of a version against the published one. */
export function ManifestDiff({
  before,
  after,
  beforeLabel = "Published",
  afterLabel = "This version",
  className,
}: {
  before: ManifestSide | null;
  after: ManifestSide;
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const changes = diffManifests(before, after);
  if (changes.length === 0) {
    return (
      <p className={cn("flex items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm text-ink-300", className)}>
        <CircleDashed className="size-4 text-ink-400" aria-hidden /> No manifest changes vs {beforeLabel.toLowerCase()} — only the build behind the URL.
      </p>
    );
  }
  return (
    <div className={className}>
      <p className="mb-2 text-xs text-ink-400">
        {before ? (
          <>
            {changes.length} {changes.length === 1 ? "change" : "changes"}: <span className="text-ink-300">{beforeLabel}</span> →{" "}
            <span className="text-ink-100">{afterLabel}</span>
          </>
        ) : (
          <>Nothing published yet — everything below is new.</>
        )}
      </p>
      <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
        <AnimatePresence initial={false}>
          {changes.map((c, i) => (
            <motion.li
              key={c.key}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: reduced ? 0 : Math.min(i, 10) * 0.025 }}
              className="px-3.5 py-2.5"
            >
              <DiffRow change={c} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

function DiffRow({ change }: { change: FieldChange }) {
  const k = KIND[change.kind];
  const Icon = k.icon;
  const inline = !change.long && (change.before?.length ?? 0) + (change.after?.length ?? 0) < 70;
  return (
    <div className="text-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5 shrink-0", k.className)} aria-label={k.label} />
        <span className="font-semibold text-ink-100">{change.label}</span>
        <span className={cn("ml-auto text-[11px] font-semibold uppercase tracking-wider", k.className)}>{k.label}</span>
      </div>
      <div className={cn("mt-1 pl-5.5 text-[13px]", inline ? "flex flex-wrap items-baseline gap-x-2 gap-y-1" : "space-y-1")}>
        {change.before !== null && (
          <span className={cn("break-words text-ink-400", change.kind !== "added" && "line-through decoration-danger/60", !inline && "block")}>
            {change.before}
          </span>
        )}
        {change.before !== null && change.after !== null && inline && <ArrowRight className="size-3 shrink-0 self-center text-ink-500" aria-hidden />}
        {change.after !== null && <span className={cn("break-words text-ink-50", !inline && "block")}>{change.after}</span>}
      </div>
    </div>
  );
}
