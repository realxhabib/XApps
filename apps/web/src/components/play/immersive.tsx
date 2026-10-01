"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/chrome/toasts";
import { haptic } from "@/lib/haptics";
import {
  enterImmersive,
  exitImmersive,
  getFullscreen,
  getImmersive,
  isIPhone,
  isStandaloneDisplay,
  leaveFullscreen,
  subscribeImmersive,
} from "@/lib/immersive";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const HINT_KEY = "xapps:immersive-hint";
/** How long the peeked controls stay before tucking away again. */
const PEEK_MS = 5000;

/** iPhone can't fullscreen a page: once, point at Add to Home Screen. */
function hintHomeScreen(): void {
  if (!isIPhone() || isStandaloneDisplay()) return;
  try {
    if (window.localStorage.getItem(HINT_KEY)) return;
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    return;
  }
  toast("Full screen is on", {
    description: "To hide Safari's bars too, tap Share, then Add to Home Screen, and play from there.",
    tone: "info",
    duration: 9000,
  });
}

/**
 * Full-screen mode for an app host: whether the host chrome is hidden, whether
 * the browser is fullscreen too, and a toggle to call from a tap.
 */
export function useImmersive() {
  const immersive = useSyncExternalStore(subscribeImmersive, getImmersive, () => false);
  const fullscreen = useSyncExternalStore(subscribeImmersive, getFullscreen, () => false);

  // Leaving the host (back to the marketplace) leaves browser fullscreen; the preference stays.
  useEffect(() => () => leaveFullscreen(), []);

  const toggle = () => {
    haptic("light");
    if (immersive) {
      exitImmersive();
      return;
    }
    void enterImmersive().then((full) => {
      if (!full) hintHomeScreen();
    });
  };

  return { immersive, fullscreen, toggle };
}

/** The top-bar button that switches full-screen mode. */
export function ImmersiveButton({ immersive, onToggle, className }: { immersive: boolean; onToggle: () => void; className?: string }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onClick={onToggle}
      className={cn("flex size-11 shrink-0 items-center justify-center rounded-full text-ink-200 transition hover:bg-white/10 hover:text-white", className)}
      aria-label={immersive ? "Exit full screen" : "Full screen"}
      aria-pressed={immersive}
      title={immersive ? "Exit full screen" : "Full screen"}
    >
      {immersive ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
    </motion.button>
  );
}

/**
 * Wraps a host's top bar. Normally renders it as is. In full-screen mode the
 * bar tucks away and a small handle at the top edge brings it back over the
 * app for a few seconds (to leave, react, or exit full screen).
 */
export function ImmersiveChrome({ immersive, children }: { immersive: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [peek, setPeek] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!immersive) return <>{children}</>;

  const hideLater = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPeek(false), PEEK_MS);
  };
  const togglePeek = () => {
    haptic("light");
    setPeek((open) => !open);
    hideLater();
  };

  return (
    <>
      <AnimatePresence>
        {peek && (
          <motion.div
            key="peek"
            className="fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)]"
            initial={reduced ? { opacity: 0 } : { y: "-110%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: "-110%", opacity: 0 }}
            transition={spring.snappy}
            onPointerDown={hideLater}
            onFocusCapture={hideLater}
          >
            {children}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={togglePeek}
                className="flex h-7 w-16 items-center justify-center"
                aria-label="Hide controls"
              >
                <span className="h-1.5 w-10 rounded-full bg-white/60 shadow-[0_1px_6px_rgb(0_0_0/0.6)]" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {!peek && (
        <button
          type="button"
          onClick={togglePeek}
          className="group fixed left-1/2 top-[env(safe-area-inset-top)] z-40 flex h-6 w-16 -translate-x-1/2 items-start justify-center pt-1.5"
          aria-label="Show controls"
          title="Show controls"
        >
          <span className="h-1.5 w-10 rounded-full bg-white/35 shadow-[0_1px_6px_rgb(0_0_0/0.6)] transition group-hover:bg-white/70" />
        </button>
      )}
    </>
  );
}
