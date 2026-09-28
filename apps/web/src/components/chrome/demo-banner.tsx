"use client";

import { AnimatePresence, motion } from "motion/react";
import { FlaskConical, X } from "lucide-react";
import { useState } from "react";
import { useMounted } from "@/lib/use-mounted";
import { useBackend } from "@/platform/client";

function hiddenThisSession(): boolean {
  try {
    return sessionStorage.getItem("xapps:demo-banner") === "hidden";
  } catch {
    return false;
  }
}

export function DemoBanner() {
  const backend = useBackend();
  const mounted = useMounted();
  const [dismissed, setDismissed] = useState(false);
  const visible = mounted && backend.kind === "demo" && !dismissed && !hiddenThisSession();

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0, transition: { delay: 1.2, type: "spring", stiffness: 200, damping: 22 } }}
          exit={{ opacity: 0, y: 20 }}
          className="fixed bottom-24 left-4 z-40 max-w-[calc(100vw-2rem)] lg:bottom-6"
        >
          <div className="glass-strong flex items-center gap-3 rounded-2xl py-2.5 pl-3 pr-2 text-xs text-ink-200 shadow-xl">
            <span className="flex size-7 items-center justify-center rounded-full bg-gold/15 text-gold">
              <FlaskConical className="size-3.5" />
            </span>
            <span className="leading-snug">
              <b className="text-ink-50">Demo mode</b>
              <span className="hidden sm:inline"> — data lives in this browser. Add Supabase keys to go live.</span>
              <span className="sm:hidden"> · local data</span>
            </span>
            <button
              onClick={() => {
                setDismissed(true);
                try {
                  sessionStorage.setItem("xapps:demo-banner", "hidden");
                } catch {
                  // ignore
                }
              }}
              className="flex size-7 items-center justify-center rounded-full text-ink-300 transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
