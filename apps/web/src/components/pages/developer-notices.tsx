"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Rocket, XCircle } from "lucide-react";
import Link from "next/link";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useMarkNoticesRead, useMyNotices } from "@/platform/queries";
import type { DeveloperNotice } from "@/platform/types";

const KIND: Record<DeveloperNotice["kind"], { icon: typeof Rocket; tone: string; title: string }> = {
  version_published: { icon: Rocket, tone: "text-volt", title: "Live" },
  version_approved: { icon: CheckCircle2, tone: "text-success", title: "Approved" },
  version_rejected: { icon: XCircle, tone: "text-danger", title: "Changes needed" },
};

/** Unread review decisions for the viewer's apps, at the top of the inbox. Renders nothing when there are none. */
export function DeveloperNotices({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const { data } = useMyNotices();
  const markRead = useMarkNoticesRead();
  const unread = (data ?? []).filter((n) => !n.readAt).slice(0, 3);

  return (
    <AnimatePresence initial={false}>
      {unread.length > 0 && (
        <motion.section
          key="notices"
          aria-label="Review updates"
          className={cn("space-y-2", className)}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={spring.soft}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-ink-400">Review updates</p>
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
              onClick={() => markRead.mutate(undefined)}
            >
              Mark all read
            </button>
          </div>
          <ul className="space-y-2">
            {unread.map((notice) => {
              const kind = KIND[notice.kind];
              const Icon = kind.icon;
              return (
                <motion.li key={notice.id} layout={!reduced} exit={{ opacity: 0, scale: 0.97 }} className="flex items-start gap-3 rounded-3xl glass p-4">
                  <Icon className={cn("mt-0.5 size-5 shrink-0", kind.tone)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {kind.title}
                      {notice.version && <span className="ml-2 font-mono text-xs text-ink-400 tabular">v{notice.version}</span>}
                    </p>
                    <p className="mt-0.5 break-words text-sm text-ink-300">{notice.message}</p>
                    <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                      <Link
                        href={`/developers/apps/${notice.appSlug}?tab=versions`}
                        className="text-nova-300 hover:text-nova-200"
                        onClick={() => markRead.mutate([notice.id])}
                      >
                        Open app console
                      </Link>
                      <button type="button" className="text-ink-400 hover:text-ink-200" onClick={() => markRead.mutate([notice.id])}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </motion.li>
              );
            })}
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
