"use client";

import { AnimatePresence, motion } from "motion/react";
import { Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { spring } from "@/lib/motion";
import { BackendError } from "@/platform/backend";
import { setDemoForced, useBackend } from "@/platform/client";
import { useApps } from "@/platform/queries";

/**
 * Supabase keys are set but the database schema isn't installed yet: explain
 * what's missing instead of showing an empty marketplace.
 */
export function SetupNotice() {
  const backend = useBackend();
  const { error } = useApps();
  const needsSetup = backend.kind === "supabase" && error instanceof BackendError && error.code === "setup_required";
  return (
    <AnimatePresence>
      {needsSetup && (
        <motion.div
          className="relative z-10 mx-auto mb-8 max-w-6xl"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={spring.soft}
        >
          <div className="flex flex-col gap-4 rounded-3xl border border-gold/30 bg-gold/[0.07] p-5 sm:flex-row sm:items-center">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <Database className="size-5" />
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-ink-50">Supabase is connected, but the XApps schema isn&apos;t installed.</p>
              <p className="mt-1 text-ink-300">
                Run <code className="font-mono text-ink-100">supabase/migrations/*.sql</code> in your project (SQL editor or{" "}
                <code className="font-mono text-ink-100">supabase db push</code>), then reload. See the README for the X sign-in setup.
              </p>
            </div>
            <Button variant="glass" size="md" onClick={() => setDemoForced(true)}>
              Explore in demo mode
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
