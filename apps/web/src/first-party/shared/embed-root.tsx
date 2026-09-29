"use client";

import { XAppsProvider } from "@xapps/sdk/react";
import { motion } from "motion/react";
import { useMemo, type ReactNode } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { getOfficialApp } from "@/platform/catalog";
import type { AppManifest } from "@/platform/types";

/**
 * Wraps a first-party app: connects to the host through the public SDK
 * (exactly like a community app would), paints the app's backdrop, and
 * shows a branded loader while the handshake completes.
 *
 * Opened directly (not inside XApps) the SDK falls back to its mock host, so
 * `/embed/<slug>` is also a standalone dev harness with a bot opponent.
 */
export function EmbedRoot({ slug, children }: { slug: string; children: ReactNode }) {
  const app = getOfficialApp(slug) as AppManifest;
  const options = useMemo(
    () => ({
      hostOrigins: typeof window !== "undefined" ? [window.location.origin] : undefined,
      mock: { scoring: app.scoring, startDelayMs: 600, stats: app.stats, achievements: app.achievements },
    }),
    [app.scoring, app.stats, app.achievements],
  );

  return (
    <div
      className="relative isolate flex min-h-dvh w-full flex-col overflow-hidden text-ink-50"
      style={{ "--accent-from": app.accent[0], "--accent-to": app.accent[1] } as React.CSSProperties}
    >
      <EmbedBackdrop accent={app.accent} />
      <XAppsProvider
        options={options}
        fallback={<EmbedLoading app={app} />}
        errorFallback={(error) => (
          <div className="m-auto max-w-xs p-6 text-center text-sm text-ink-300">
            <p className="text-3xl">🔌</p>
            <p className="mt-3 font-semibold text-ink-50">Couldn&apos;t reach XApps</p>
            <p className="mt-1">{error.message}</p>
          </div>
        )}
      >
        {children}
      </XAppsProvider>
    </div>
  );
}

export function EmbedBackdrop({ accent }: { accent: [string, string] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-ink-950">
      <div
        className="absolute -left-1/4 -top-1/3 size-[80vmax] rounded-full opacity-25"
        style={{ background: `radial-gradient(circle, ${accent[0]}, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 size-[70vmax] rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, ${accent[1]}, transparent 70%)` }}
      />
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse at center, #000 20%, transparent 75%)",
        }}
      />
    </div>
  );
}

export function EmbedLoading({ app }: { app: AppManifest }) {
  return (
    <div className="m-auto flex flex-col items-center gap-4">
      <motion.div
        animate={{ scale: [1, 1.08, 1], rotate: [0, -4, 4, 0] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <AppGlyph app={app} size={72} />
      </motion.div>
      <p className="text-sm font-medium text-ink-300">Loading {app.name}…</p>
    </div>
  );
}
