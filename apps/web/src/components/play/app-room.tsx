"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SDK_VERSION, XAppsError, type LaunchContext } from "@xapps/sdk";
import { standaloneMatch, type HostHandlers } from "@xapps/sdk/host";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, FlaskConical, Maximize2, Minimize2, Share } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { celebrate } from "@/components/motion/confetti";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { XLogo } from "@/components/ui/x-logo";
import { haptic } from "@/lib/haptics";
import { spring } from "@/lib/motion";
import { openXIntent } from "@/lib/share";
import { BackendError } from "@/platform/backend";
import { useBackend, useViewer } from "@/platform/client";
import { launchApp } from "@/platform/match-utils";
import { invalidateProgress, useApp } from "@/platform/queries";
import type { AppManifest, Json, LogLevel, Profile } from "@/platform/types";
import { showAchievement } from "./achievement-moment";
import {
  APP_ALLOW,
  APP_SANDBOX,
  LOGGED_REFUSALS,
  createLogThrottle,
  readStatStanding,
  resolveAppUrl,
  toSdkError,
  useAppBridge,
  type Emit,
} from "./use-app-bridge";

type Accent = AppManifest["accent"];

function Backdrop({ accent }: { accent?: Accent }) {
  const [a, b] = accent ?? ["#5b74ff", "#ff5ca8"];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div
        className="absolute -left-1/4 -top-1/3 size-[80vmax] rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, ${a}, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 size-[70vmax] rounded-full opacity-15"
        style={{ background: `radial-gradient(circle, ${b}, transparent 70%)` }}
      />
    </div>
  );
}

/** Centered host screen (loading, sign-in, errors) with a way back. */
function HostScreen({ slug, accent, children }: { slug: string; accent?: Accent; children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <Backdrop accent={accent} />
      <div className="px-3 pt-3">
        <Button variant="ghost" size="sm" href={`/apps/${slug}`} icon={<ArrowLeft className="size-4" />}>
          Back
        </Button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">{children}</div>
    </div>
  );
}

function PulsingGlyph({ app }: { app: AppManifest }) {
  const reduced = useReducedMotion();
  return (
    <motion.div animate={reduced ? undefined : { scale: [1, 1.08, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
      <AppGlyph app={app} size={72} />
    </motion.div>
  );
}

function openPath(slug: string, versionId: string | null): string {
  return `/apps/${slug}/open${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`;
}

/**
 * /apps/[slug]/open: runs a standalone (`kind: "app"`) app full screen with
 * `purpose: "app"`. The viewer must be signed in: apps are promised a real X
 * identity (`xapps.user`), and every open is recorded against it.
 */
export function AppRoom({ slug, versionId }: { slug: string; versionId: string | null }) {
  const backend = useBackend();
  const { viewer, loading: viewerLoading } = useViewer();
  // The listing (public) paints the loader and the sign-in card; openApp decides what actually runs.
  const { data: listed } = useApp(slug);
  const launch = useQuery({
    queryKey: ["open-app", slug, versionId, viewer?.id ?? null],
    queryFn: () => backend.openApp(slug, versionId),
    enabled: !!viewer,
    // One recorded open per visit: never refetch in the background.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (viewerLoading || (viewer && launch.isPending)) {
    return (
      <HostScreen slug={slug} accent={listed?.accent}>
        {listed ? <PulsingGlyph app={listed} /> : <Spinner className="size-8 text-ink-300" />}
      </HostScreen>
    );
  }

  if (!viewer) {
    return (
      <HostScreen slug={slug} accent={listed?.accent}>
        <SignInCard app={listed ?? null} next={openPath(slug, versionId)} />
      </HostScreen>
    );
  }

  if (launch.error || !launch.data) {
    return (
      <HostScreen slug={slug} accent={listed?.accent}>
        <LaunchError error={launch.error} slug={slug} app={listed ?? null} />
      </HostScreen>
    );
  }

  const { app, versionId: openedVersion } = launch.data;
  return <AppStage key={`${app.slug}:${openedVersion ?? "live"}`} app={app} versionId={openedVersion} viewer={viewer} />;
}

function SignInCard({ app, next }: { app: AppManifest | null; next: string }) {
  return (
    <motion.div
      className="flex w-full max-w-sm flex-col items-center rounded-[2rem] px-6 py-10 text-center glass-strong"
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      {app ? <AppGlyph app={app} size={72} /> : <div className="text-5xl">🔐</div>}
      <h1 className="mt-5 font-display text-2xl font-bold">{app ? `Open ${app.name}` : "Sign in to open this app"}</h1>
      {app && <p className="mt-1 text-sm text-ink-300">by @{app.developer.handle}</p>}
      <p className="mt-4 text-sm text-ink-300">
        Apps on XApps know who you are: sign in with X and {app?.name ?? "the app"} can greet you, save your stuff and track
        your achievements.
      </p>
      <Button
        href={`/login?next=${encodeURIComponent(next)}`}
        variant="primary"
        size="lg"
        className="mt-6"
        icon={<XLogo className="size-4" />}
      >
        Sign in with X
      </Button>
    </motion.div>
  );
}

function LaunchError({ error, slug, app }: { error: unknown; slug: string; app: AppManifest | null }) {
  const code = error instanceof BackendError ? error.code : null;
  const message = error instanceof Error ? error.message : null;
  // openApp refuses games (they're played through matches) with `invalid`.
  const isGame = code === "invalid" && !!app && app.kind !== "app";
  const [emoji, title, body] =
    code === "not_found"
      ? ["🕳️", "App not found", "This app doesn't exist, or it isn't published yet."]
      : code === "forbidden"
        ? ["🔒", "This build is private", "Only the developer and their testers can open this test build."]
        : isGame
          ? ["🎮", `${app.name} is a game`, "Games are played in matches. Challenge someone from its page."]
          : code === "setup_required"
            ? ["🛠️", "Finish setting up Supabase", message]
            : ["⚠️", "Couldn't open this app", message ?? "Something went wrong. Please try again."];
  return (
    <EmptyState
      emoji={emoji}
      title={title}
      className="w-full max-w-md"
      action={
        <Button href={`/apps/${slug}`} variant={isGame ? "accent" : "primary"}>
          {isGame ? `Play ${app.name}` : "Back to the app"}
        </Button>
      }
    >
      {body}
    </EmptyState>
  );
}

/* ---------------------------------------------------------------------- */
/* Fullscreen                                                             */
/* ---------------------------------------------------------------------- */

const onFullscreenChange = (notify: () => void) => {
  document.addEventListener("fullscreenchange", notify);
  return () => document.removeEventListener("fullscreenchange", notify);
};
const noop = () => () => {};

function useFullscreen() {
  const active = useSyncExternalStore(onFullscreenChange, () => !!document.fullscreenElement, () => false);
  const supported = useSyncExternalStore(noop, () => document.fullscreenEnabled === true, () => false);
  return { active, supported };
}

/* ---------------------------------------------------------------------- */
/* The running app                                                        */
/* ---------------------------------------------------------------------- */

/** The top bar plus the app's sandboxed iframe, bridged with a purpose-app LaunchContext. */
function AppStage({ app, versionId, viewer }: { app: AppManifest; versionId: string | null; viewer: Profile }) {
  const backend = useBackend();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roomRef = useRef<HTMLDivElement>(null);
  /** The bridge's emit, for handlers (which are built before the bridge exists). */
  const emitRef = useRef<Emit | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [seed] = useState(() => Math.random().toString(36).slice(2, 14));
  const [origin] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const fullscreen = useFullscreen();

  const testBuild = !!versionId;
  const appUrl = origin ? resolveAppUrl(app.url, origin) : null;

  /** Fire-and-forget developer logs (the backend drops them past its rate limit). */
  const [hostLogBudget] = useState(() => createLogThrottle(30));
  const logEvent = (level: LogLevel, message: string, data: Json | undefined, source: "app" | "host") => {
    if (source === "host" && !hostLogBudget()) return;
    backend.logAppEvent({ appSlug: app.slug, matchId: null, level, message, data, source }).catch(() => undefined);
  };

  const context = (): LaunchContext => {
    const user = { id: viewer.id, handle: viewer.handle, name: viewer.name, avatarUrl: viewer.avatarUrl };
    return {
      purpose: "app",
      app: launchApp(app),
      user,
      match: standaloneMatch(user, { id: `app:${app.slug}`, seed }),
      host: { name: "XApps", version: SDK_VERSION, origin: window.location.origin },
      locale: navigator.language,
    };
  };

  // Match-only methods (room, submit, state, turns, rounds, match HUD, setup) never reach these:
  // the host core refuses them for purpose "app" before any handler runs.
  const handlers: HostHandlers = {
    ready: () => ({ startedAt: null }),
    "ui.toast": ({ message, tone }) => {
      toast(message, { tone: tone ?? "info" });
      return null;
    },
    "ui.celebrate": ({ intensity }) => {
      celebrate(intensity === "small" ? { count: 70 } : { pattern: "cannons", colors: [app.accent[0], app.accent[1], "#ffffff", "#ffc93d"] });
      return null;
    },
    "ui.haptic": ({ style }) => {
      haptic(style ?? "light");
      return null;
    },
    // One line under the app's name in the top bar.
    "ui.status": ({ text }) => {
      setStatus(text?.trim() ? text : null);
      return null;
    },
    // The frame always fills the screen below the top bar.
    "ui.resize": () => null,
    "social.share": ({ text, url }) => {
      openXIntent(text, url);
      return null;
    },
    "storage.get": async ({ key, scope }) => {
      try {
        return await backend.storageGet(app.slug, key, scope ?? "user");
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "storage.set": async ({ key, value }) => {
      try {
        await backend.storageSet(app.slug, key, value);
        return null;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "storage.delete": async ({ key }) => {
      try {
        await backend.storageDelete(app.slug, key);
        return null;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "storage.list": async ({ prefix, scope }) => {
      try {
        return await backend.storageList(app.slug, prefix, scope ?? "user");
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "media.upload": async ({ file }) => {
      try {
        return await backend.uploadMedia(app.slug, file);
      } catch (error) {
        const sdkError = toSdkError(error);
        toast(sdkError.message, { tone: "danger" });
        throw sdkError;
      }
    },
    "stats.report": async ({ values }) => {
      if (testBuild) {
        // Test builds never touch stats: echo the values back without saving them.
        logEvent("info", "stats.report not saved (test build)", { values }, "host");
        return values;
      }
      try {
        const result = await backend.reportStats(app.slug, values);
        invalidateProgress(queryClient, app.slug);
        return result;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    // The live board (test builds included: they read it but never write to it).
    "stats.leaderboard": (params) => readStatStanding(backend, app.slug, params, testBuild),
    "achievements.unlock": async ({ id }) => {
      let result: { unlocked: boolean };
      if (testBuild) {
        // Shown (so the flow can be tried) but never saved, and worth no XP.
        logEvent("info", `achievements.unlock ${id} not saved (test build)`, { id }, "host");
        result = { unlocked: true };
      } else {
        try {
          result = await backend.unlockAchievement(app.slug, id);
        } catch (error) {
          throw toSdkError(error);
        }
      }
      if (result.unlocked) {
        const def = app.achievements?.find((a) => a.id === id);
        if (def) {
          showAchievement({
            icon: def.icon,
            name: def.name,
            description: def.description,
            xp: testBuild ? 0 : def.xp,
            appName: app.name,
            accent: app.accent,
          });
        }
        emitRef.current?.("achievement.unlock", { id, userId: viewer.id });
        if (!testBuild) invalidateProgress(queryClient, app.slug);
      }
      return result;
    },
    log: ({ level, message, data }) => {
      logEvent(level, message, data, "app");
      return null;
    },
    "setup.submit": () => {
      throw new XAppsError("forbidden", "setup.submit only works in setup purpose");
    },
    "setup.cancel": () => {
      throw new XAppsError("forbidden", "setup.cancel only works in setup purpose");
    },
  };

  const { connected, emit } = useAppBridge({
    iframeRef,
    appOrigin: appUrl?.origin ?? null,
    enabled: !!appUrl,
    context,
    handlers,
    // Protocol problems the host refused go to the developer's logs (never about `log` itself).
    onRequestError: (method, error) => {
      if (method === "log" || !LOGGED_REFUSALS.has(String(error.code))) return;
      logEvent("warn", `${method} refused (${String(error.code)}): ${error.message}`.slice(0, 500), { method, code: String(error.code) }, "host");
    },
  });

  useLayoutEffect(() => {
    emitRef.current = emit;
  }, [emit]);

  const share = () => openXIntent(`Check out ${app.name} on XApps ${app.icon}`, `${window.location.origin}/apps/${app.slug}`);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void roomRef.current?.requestFullscreen().catch(() => toast("Fullscreen isn't available here", { tone: "warning" }));
  };

  return (
    <div ref={roomRef} className="relative flex h-dvh flex-col overflow-hidden bg-ink-950">
      <Backdrop accent={app.accent} />
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-ink-950/70 px-2 backdrop-blur-xl sm:gap-3 sm:px-3">
        <Button variant="ghost" size="icon-sm" href={`/apps/${app.slug}`} aria-label={`Back to ${app.name}`} icon={<ArrowLeft className="size-4" />} />
        <Link href={`/apps/${app.slug}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl" aria-label={`${app.name} details`}>
          <AppGlyph app={app} size={32} />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="truncate font-display text-[15px] font-bold leading-tight text-ink-50">{app.name}</span>
              {testBuild && (
                <Badge tone="gold" className="shrink-0">
                  <span className="inline-flex items-center gap-1" title="Test build: stats and achievements aren't saved">
                    <FlaskConical className="size-3" aria-hidden />
                    Test build
                  </span>
                </Badge>
              )}
            </span>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={status ?? "by"}
                className="block truncate text-xs leading-tight text-ink-300"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={spring.snappy}
                aria-live="polite"
              >
                {status ?? `by @${app.developer.handle}`}
              </motion.span>
            </AnimatePresence>
          </span>
        </Link>
        <Button variant="glass" size="sm" onClick={share} icon={<Share className="size-3.5" />} aria-label={`Share ${app.name} on X`}>
          <span className="hidden sm:inline">Share</span>
        </Button>
        {fullscreen.supported && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleFullscreen}
            aria-label={fullscreen.active ? "Exit fullscreen" : "Fullscreen"}
            aria-pressed={fullscreen.active}
            icon={fullscreen.active ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          />
        )}
      </header>

      <div className="relative min-h-0 flex-1">
        {appUrl ? (
          <iframe
            ref={iframeRef}
            src={appUrl.href}
            title={app.name}
            className="absolute inset-0 size-full border-0 bg-ink-950"
            sandbox={APP_SANDBOX}
            allow={APP_ALLOW}
          />
        ) : (
          origin && (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <EmptyState emoji="🔗" title="This app has no valid address" className="max-w-md">
                The developer needs to fix the app&apos;s URL.
              </EmptyState>
            </div>
          )
        )}
        <AnimatePresence>
          {appUrl && !connected && (
            <motion.div
              key="loading"
              className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink-950"
              exit={{ opacity: 0, transition: { duration: 0.3 } }}
            >
              <PulsingGlyph app={app} />
              <p className="text-sm text-ink-300">Opening {app.name}…</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
