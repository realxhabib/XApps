"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CloudOff, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { spring } from "@/lib/motion";
import { useHealth } from "@/platform/health";

/** How often to look again while the database is unreachable. */
const RETRY_MS = 30_000;

/**
 * Shown while the backend can't reach its database (see `platform/health`):
 * browsing keeps working from the built-in catalog, so say what's paused,
 * retry quietly, and refresh everything once it's back.
 */
export function OutageBanner() {
  const down = useHealth((s) => s.downSince !== null);
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const [checking, setChecking] = useState(false);
  const wasDown = useRef(false);

  const check = () => {
    setChecking(true);
    void Promise.allSettled([
      queryClient.refetchQueries({ queryKey: ["apps"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["viewer"], type: "active" }),
    ]).finally(() => setChecking(false));
  };

  useEffect(() => {
    if (down) {
      wasDown.current = true;
      const t = setInterval(() => {
        void queryClient.refetchQueries({ queryKey: ["apps"], type: "active" });
        void queryClient.refetchQueries({ queryKey: ["viewer"], type: "active" });
      }, RETRY_MS);
      return () => clearInterval(t);
    }
    if (wasDown.current) {
      // Back: reload what was served from the fallback (counts, upvotes, the real profile).
      wasDown.current = false;
      void queryClient.invalidateQueries();
    }
  }, [down, queryClient]);

  return (
    <AnimatePresence>
      {down && (
        <motion.div
          role="status"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
          transition={spring.soft}
          className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 lg:bottom-6"
        >
          <div className="glass-strong flex max-w-md items-center gap-3 rounded-2xl py-2.5 pl-3 pr-2 text-xs text-ink-200 shadow-xl">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
              <CloudOff className="size-4" />
            </span>
            <span className="min-w-0 leading-snug">
              <b className="text-ink-50">Can&apos;t reach the XApps database.</b> Browsing works; matches, scores and upvotes are paused until it&apos;s back.
            </span>
            <button
              type="button"
              onClick={check}
              disabled={checking}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
              aria-label="Try again"
              title="Try again"
            >
              <RotateCw className={checking ? "size-4 animate-spin" : "size-4"} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
