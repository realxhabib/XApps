"use client";

import { LIMITS, SDK_VERSION, XAppsError, type Json, type LaunchContext, type PlayerInfo } from "@xapps/sdk";
import type { HostHandlers } from "@xapps/sdk/host";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { APP_ALLOW, APP_SANDBOX, jsonBytes, readStatStanding, useAppBridge } from "@/components/play/use-app-bridge";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { BackendError } from "@/platform/backend";
import { useBackend } from "@/platform/client";
import { launchApp } from "@/platform/match-utils";
import type { AppManifest, PlayableMode, Profile } from "@/platform/types";
import { AppGlyph } from "./app-glyph";

export interface AppSetupResult {
  settings: { [key: string]: Json };
  summary: string | null;
}

function toPlayerInfo(p: Profile, seat: number, teams: number): PlayerInfo {
  return {
    id: p.id,
    handle: p.handle,
    name: p.name,
    avatarUrl: p.avatarUrl,
    seat,
    isBot: !!p.isBot,
    submitted: false,
    score: null,
    team: teams >= 2 ? seat % teams : null,
    role: "player",
  };
}

/**
 * The app's own challenge setup screen (`setup: true` apps), embedded in the
 * challenge sheet. The app is launched with `purpose: "setup"` and a stub
 * match, and answers with `setup.submit(settings, summary)` or `setup.cancel()`.
 */
export function AppSetupFrame({
  app,
  viewer,
  mode,
  rivals,
  tableSize,
  initial,
  onSubmit,
  onCancel,
  className,
}: {
  app: AppManifest;
  viewer: Profile;
  mode: Exclude<PlayableMode, "practice">;
  rivals: Profile[];
  tableSize: number;
  /** Settings from an earlier submit, so the app can prefill its form. */
  initial?: { [key: string]: Json };
  onSubmit: (result: AppSetupResult) => void;
  onCancel: () => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const backend = useBackend();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [seed] = useState(() => Math.random().toString(36).slice(2, 14));

  const appUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const url = new URL(app.url, window.location.origin);
      return { href: url.toString(), origin: url.origin };
    } catch {
      return null;
    }
  }, [app.url]);

  const context = (): LaunchContext => {
    const teams = app.teams ?? 0;
    const people = [viewer, ...rivals];
    return {
      purpose: "setup",
      app: launchApp(app),
      user: { id: viewer.id, handle: viewer.handle, name: viewer.name, avatarUrl: viewer.avatarUrl },
      match: {
        id: "setup",
        mode,
        status: "open",
        scoring: app.scoring,
        seed,
        players: people.map((p, seat) => toPlayerInfo(p, seat, teams)),
        seat: 0,
        settings: initial ?? {},
        minPlayers: app.players.min,
        maxPlayers: tableSize,
        teams,
        role: "player",
        state: null,
        stateVersion: 0,
        turn: null,
        turnDeadline: null,
        round: 0,
      },
      host: { name: "XApps", version: SDK_VERSION, origin: window.location.origin },
      locale: navigator.language,
    };
  };

  const rethrow = (error: unknown): never => {
    if (error instanceof BackendError) {
      const code = error.code === "rate_limited" ? "rate_limited" : error.code === "invalid" ? "invalid_params" : error.code === "forbidden" || error.code === "unauthenticated" ? "forbidden" : "internal";
      throw new XAppsError(code, error.message);
    }
    throw error;
  };

  const notHere = (method: string) => () => {
    throw new XAppsError("forbidden", `${method} isn't available while setting up a challenge`);
  };

  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const handlers: HostHandlers = {
    // Setup never starts a match: ready() only reveals the frame.
    ready: () => {
      setReady(true);
      return { startedAt: null };
    },
    "setup.submit": ({ settings, summary }) => {
      if (jsonBytes(settings) > LIMITS.setupSettingsBytes) {
        throw new XAppsError("invalid_params", `setup.submit: settings must be ≤ ${LIMITS.setupSettingsBytes / 1024} KB`);
      }
      const text = typeof summary === "string" ? summary.trim().slice(0, LIMITS.setupSummaryLength) : "";
      play("pop");
      haptic("success");
      onSubmit({ settings, summary: text || null });
      return null;
    },
    "setup.cancel": () => {
      onCancel();
      return null;
    },
    "ui.toast": ({ message, tone }) => {
      toast(message, { tone: tone ?? "info" });
      return null;
    },
    "ui.haptic": ({ style }) => {
      haptic(style ?? "light");
      return null;
    },
    "ui.status": () => null,
    "ui.scores": () => null,
    "ui.turn": () => null,
    "ui.celebrate": () => null,
    "storage.get": ({ key, scope }) => backend.storageGet(app.slug, key, scope ?? "user").catch(rethrow),
    "storage.set": async ({ key, value }) => {
      await backend.storageSet(app.slug, key, value).catch(rethrow);
      return null;
    },
    "storage.delete": async ({ key }) => {
      await backend.storageDelete(app.slug, key).catch(rethrow);
      return null;
    },
    "storage.list": ({ prefix, scope }) => backend.storageList(app.slug, prefix, scope ?? "user").catch(rethrow),
    // Setup screens upload drops (e.g. Meme Duel's image) before the match exists.
    "media.upload": async ({ file }) => {
      try {
        return await backend.uploadMedia(app.slug, file);
      } catch (error) {
        toast(error instanceof Error ? error.message : "Upload failed", { tone: "danger" });
        return rethrow(error);
      }
    },
    "stats.report": notHere("stats.report"),
    // Read-only, so a setup screen may show where the challenger stands.
    "stats.leaderboard": (params) => readStatStanding(backend, app.slug, params),
    "achievements.unlock": notHere("achievements.unlock"),
    "room.send": notHere("room.send"),
    "match.submit": notHere("match.submit"),
    "match.forfeit": notHere("match.forfeit"),
    "social.share": notHere("social.share"),
    // Apps that report their content height (xapps.ui.autoResize) get a frame that fits it.
    "ui.resize": ({ height }) => {
      setContentHeight(height);
      return null;
    },
    log: ({ level, message, data }) => {
      void backend.logAppEvent({ appSlug: app.slug, matchId: null, level, message, data, source: "app" }).catch(() => undefined);
      return null;
    },
    "state.get": () => ({ state: null, version: 0 }),
    "state.set": notHere("state.set"),
    "turn.end": notHere("turn.end"),
    "round.set": notHere("round.set"),
  };

  const { connected } = useAppBridge({
    iframeRef,
    appOrigin: appUrl?.origin ?? null,
    enabled: !!appUrl,
    context,
    handlers,
  });

  return (
    <motion.div
      className={cn(
        // Tall enough for a real setup screen, short enough that the sheet around it
        // still has room to scroll on phones (touches on the frame scroll the app).
        "relative overflow-hidden rounded-3xl bg-ink-900 ring-1 ring-white/10",
        contentHeight === null && "h-[clamp(22rem,calc(100dvh-19rem),32rem)]",
        className,
      )}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
      animate={
        contentHeight === null
          ? { opacity: 1, scale: 1, y: 0 }
          : { opacity: 1, scale: 1, y: 0, height: Math.min(contentHeight, Math.max(320, window.innerHeight - 192)) }
      }
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
      transition={spring.soft}
      style={{ "--accent-from": app.accent[0], "--accent-to": app.accent[1] } as React.CSSProperties}
    >
      {appUrl && (
        <iframe
          ref={iframeRef}
          src={appUrl.href}
          title={`${app.name} setup`}
          className="absolute inset-0 size-full border-0"
          sandbox={APP_SANDBOX}
          allow={APP_ALLOW}
        />
      )}
      <AnimatePresence>
        {!(connected && ready) && (
          <motion.div
            key="loading"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink-900"
            exit={{ opacity: 0, transition: { duration: 0.25 } }}
          >
            <motion.div
              animate={reduced ? undefined : { scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <AppGlyph app={app} size={56} />
            </motion.div>
            <p className="text-xs text-ink-300">Opening {app.name} setup…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
