"use client";

import { useQueryClient } from "@tanstack/react-query";
import { XAppsError } from "@xapps/sdk";
import type { HostHandlers } from "@xapps/sdk/host";
import { AnimatePresence, motion } from "motion/react";
import { Eye, Home, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/chrome/toasts";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { celebrate } from "@/components/motion/confetti";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { copyText, openXIntent } from "@/lib/share";
import { shareLinkFor } from "@/lib/media";
import type { RoomPeer, RoomTransport } from "@/platform/backend";
import { BackendError } from "@/platform/backend";
import { useBackend, useViewer } from "@/platform/client";
import { buildLaunchContext, opponentOf, playerOf, toLaunchMatch, toMatchResult } from "@/platform/match-utils";
import { invalidateProgress, useApp, useAppVersions, useMatch, useMatchAction } from "@/platform/queries";
import { applyVersionToApp, isTestBuild } from "@/platform/shipping";
import type { AppManifest, Json, LogLevel, Match, Profile } from "@/platform/types";
import { showAchievement } from "./achievement-moment";
import { FloatingReactions, Hud, type HudState, useFloatingReactions } from "./hud";
import { InviteCard, Lobby } from "./lobby";
import { isMultiplayer, ordinal, seatedPlayers, viewerIsSpectator, viewerOutcome } from "./match-view";
import { ResultsOverlay } from "./results-overlay";
import { TurnBanner } from "./turn-banner";
import {
  APP_ALLOW,
  APP_SANDBOX,
  LOGGED_REFUSALS,
  createLogThrottle,
  emitMatchChanges,
  readStatStanding,
  toSdkError,
  useAppBridge,
  type Emit,
} from "./use-app-bridge";
import { VersusIntro } from "./versus-intro";
import { VotingOverlay } from "./voting-overlay";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

function Backdrop({ app }: { app?: AppManifest }) {
  const [a, b] = app?.accent ?? ["#5b74ff", "#ff5ca8"];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-ink-950">
      <div
        className="absolute -left-1/4 -top-1/3 size-[80vmax] rounded-full opacity-25"
        style={{ background: `radial-gradient(circle, ${a}, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-1/3 -right-1/4 size-[70vmax] rounded-full opacity-20"
        style={{ background: `radial-gradient(circle, ${b}, transparent 70%)` }}
      />
    </div>
  );
}

function FullscreenLoader({ app }: { app?: AppManifest }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Backdrop app={app} />
      {app ? (
        <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
          <AppGlyph app={app} size={72} />
        </motion.div>
      ) : (
        <Spinner className="size-8 text-ink-300" />
      )}
    </div>
  );
}

function shareText(app: AppManifest, match: Match, viewerId: string | undefined): string {
  if (isMultiplayer(match)) {
    const outcome = viewerOutcome(match, viewerId);
    const table = seatedPlayers(match).length;
    if (outcome.kind === "spectator") return `Just watched a ${table}-player ${app.name} match on XApps ${app.icon}`;
    if (match.teams >= 2) {
      return outcome.kind === "win"
        ? `Team win in ${app.name} on XApps ${app.icon} 🏆 Who wants the rematch?`
        : `Tough team loss in ${app.name} on XApps ${app.icon} Rematch incoming.`;
    }
    if (outcome.rank === 1) return `Took 1st of ${table} in ${app.name} on XApps ${app.icon} 🏆 Who's next?`;
    return `Placed ${ordinal(outcome.rank ?? table)} of ${table} in ${app.name} on XApps ${app.icon} Next time it's mine.`;
  }
  const opponent = opponentOf(match, viewerId);
  const them = opponent && !opponent.isBot ? `@${opponent.profile.handle}` : "the bot";
  if (!match.winnerId) return `Dead even with ${them} in ${app.name} on XApps ${app.icon} Who breaks the tie?`;
  if (match.winnerId === viewerId) {
    return match.scoring === "votes"
      ? `The crowd picked my entry over ${them} in ${app.name} on XApps ${app.icon} 🏆`
      : `Just beat ${them} in ${app.name} on XApps ${app.icon} Who's next?`;
  }
  return `${them} got me in ${app.name} on XApps ${app.icon} Rematch incoming.`;
}

/**
 * /play/[matchId]: decides what the viewer should see for this match —
 * invite, lobby, the live stage, the crowd tally or the final results.
 */
export function PlayRoom({ matchId }: { matchId: string }) {
  const router = useRouter();
  const backend = useBackend();
  const queryClient = useQueryClient();
  const { viewer, loading: viewerLoading } = useViewer();
  const { data: match, isPending: matchLoading, error: matchError } = useMatch(matchId);
  const { data: listedApp } = useApp(match?.appSlug ?? "", !!match);
  // A test build plays by its version's manifest. The developer can read it; testers get the listing's.
  const testBuild = isTestBuild(match);
  const ownsApp = !!listedApp && !!viewer && !listedApp.official && listedApp.developer.id === viewer.id;
  const { data: versions, isPending: versionsLoading } = useAppVersions(listedApp?.slug ?? "", testBuild && ownsApp);
  const testVersion = testBuild ? versions?.find((v) => v.id === match?.versionId) : undefined;
  const app = useMemo(
    () => (listedApp && testVersion ? applyVersionToApp(listedApp, testVersion) : listedApp),
    [listedApp, testVersion],
  );
  const action = useMatchAction();
  const me = match ? playerOf(match, viewer?.id) : undefined;
  const spectating = !!match && viewerIsSpectator(match, viewer?.id);
  const [busy, setBusy] = useState<"start" | "watch" | null>(null);

  const canPlay =
    !!match &&
    !!me &&
    (spectating
      ? match.status === "active"
      : me.state === "joined" &&
        (match.status === "active" || (match.mode === "async" && (match.status === "open" || match.status === "pending"))));
  // Once the stage is shown it stays mounted through voting/results.
  const [stickyStage, setStickyStage] = useState(false);
  if (canPlay && !stickyStage) setStickyStage(true);

  const run = useCallback(
    async (kind: "join" | "decline" | "cancel", then?: (m: Match) => void) => {
      if (!match) return;
      try {
        const updated = await action.mutateAsync({ action: kind, matchId: match.id });
        then?.(updated);
      } catch (error) {
        toast(errorMessage(error), { tone: "danger" });
      }
    },
    [action, match],
  );

  const lobbyCall = async (kind: "start" | "watch") => {
    if (!match) return;
    setBusy(kind);
    try {
      const updated = kind === "start" ? await backend.startMatch(match.id) : await backend.spectate(match.id);
      queryClient.setQueryData(["match", match.id], updated);
      if (kind === "start") play("go");
    } catch (error) {
      toast(errorMessage(error), { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  if (matchLoading || viewerLoading || (match && !app) || (testBuild && ownsApp && versionsLoading)) {
    return <FullscreenLoader app={app ?? undefined} />;
  }

  if (!match || !app) {
    const setup = matchError instanceof BackendError && matchError.code === "setup_required";
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Backdrop />
        <EmptyState
          emoji={setup ? "🛠️" : "🕳️"}
          title={setup ? "Finish setting up Supabase" : "Match not found"}
          action={
            <Button href="/" icon={<Home className="size-4" />}>
              Back home
            </Button>
          }
        >
          {setup ? errorMessage(matchError) : "This challenge link is invalid, or the match is private."}
        </EmptyState>
      </div>
    );
  }

  const showStage = !!viewer && !!me && (canPlay || stickyStage);
  if (showStage) {
    return <MatchStage key={match.id} app={app} match={match} viewer={viewer} />;
  }

  // --- Everything below is a host-rendered screen (no iframe) ----------------
  const isCreator = viewer?.id === match.createdBy;
  const canWatch = app.spectators !== false && match.mode !== "practice";
  const onWatch = canWatch
    ? () => (viewer ? void lobbyCall("watch") : router.push(`/login?next=${encodeURIComponent(`/play/${match.id}`)}`))
    : undefined;
  const lobbyOpen = match.status === "open" || match.status === "pending";
  let body: React.ReactNode;

  if (match.status === "completed") {
    body = (
      <ResultsOverlay
        app={app}
        match={match}
        viewer={viewer}
        onShare={() => openXIntent(shareText(app, match, viewer?.id), `${window.location.origin}/apps/${app.slug}`)}
        onHome={() => router.push(`/apps/${app.slug}`)}
      />
    );
  } else if (["declined", "cancelled", "expired"].includes(match.status)) {
    body = (
      <EmptyState
        emoji={match.status === "declined" ? "🙅" : match.status === "cancelled" ? "🚫" : "⌛"}
        title={match.status === "declined" ? "Challenge declined" : match.status === "cancelled" ? "Challenge cancelled" : "Challenge expired"}
        action={
          <Button href={`/apps/${app.slug}`} variant="accent">
            Find another match
          </Button>
        }
        className="mx-auto mt-24 max-w-md"
      >
        No hard feelings. There&apos;s always another round.
      </EmptyState>
    );
  } else if (match.status === "voting") {
    body = (
      <VotingOverlay
        app={app}
        match={match}
        viewerId={viewer?.id}
        onShare={() => openXIntent(`Help me win ${app.name} on XApps — vote for the best entry ${app.icon}`, `${window.location.origin}/arena`)}
        onLeave={() => router.push("/arena")}
      />
    );
  } else if (!viewer) {
    body = (
      <InviteCard
        app={app}
        match={match}
        viewer={null}
        onAccept={() => router.push(`/login?next=${encodeURIComponent(`/play/${match.id}`)}`)}
        onWatch={match.status === "active" ? onWatch : undefined}
      />
    );
  } else if (spectating && lobbyOpen) {
    body = <Lobby app={app} match={match} viewer={viewer} watching />;
  } else if (!me) {
    const seats = seatedPlayers(match);
    const hasSeat = match.isOpen && lobbyOpen && seats.length < Math.max(2, match.maxPlayers);
    body = hasSeat ? (
      <InviteCard
        app={app}
        match={match}
        viewer={viewer}
        accepting={action.isPending}
        onAccept={() => run("join")}
        onWatch={onWatch}
        watching={busy === "watch"}
      />
    ) : (
      <EmptyState
        emoji="🍿"
        title="Match in progress"
        className="mx-auto mt-24 max-w-md"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            {onWatch && (
              <Button variant="accent" icon={<Eye className="size-4" />} loading={busy === "watch"} onClick={onWatch} magnetic>
                Watch live
              </Button>
            )}
            <Button href={`/apps/${app.slug}`} variant={onWatch ? "glass" : "primary"}>
              Play {app.name}
            </Button>
          </div>
        }
      >
        {seats.map((p) => `@${p.profile.handle}`).join(seats.length > 2 ? ", " : " vs ")} {seats.length > 2 ? "are mid-match" : "are mid-duel"}.{" "}
        {onWatch ? "Pull up a seat in the stands, or start your own." : "Start your own!"}
      </EmptyState>
    );
  } else if (me.state === "invited") {
    body = (
      <InviteCard
        app={app}
        match={match}
        viewer={viewer}
        accepting={action.isPending}
        onAccept={() => run("join")}
        onDecline={() => run("decline", () => router.push("/challenges"))}
      />
    );
  } else if (lobbyOpen && me.state === "joined") {
    body = (
      <Lobby
        app={app}
        match={match}
        viewer={viewer}
        cancelling={action.isPending}
        onCancel={isCreator ? () => run("cancel", () => router.push(`/apps/${app.slug}`)) : undefined}
        onStart={isCreator ? () => void lobbyCall("start") : undefined}
        starting={busy === "start"}
        onPlayBot={
          isCreator && match.settings.quick === true
            ? async () => {
                try {
                  await backend.cancelMatch(match.id).catch(() => undefined);
                  const practice = await backend.startPractice(app.slug, match.maxPlayers > 2 ? match.maxPlayers : undefined, match.versionId);
                  router.replace(`/play/${practice.id}`);
                } catch (error) {
                  toast(errorMessage(error), { tone: "danger" });
                }
              }
            : undefined
        }
      />
    );
  } else {
    // Already submitted in an earlier visit and waiting on the others.
    const pending = seatedPlayers(match).filter((p) => p.userId !== viewer.id && (p.state === "joined" || p.state === "invited"));
    const first = pending[0] ?? opponentOf(match, viewer.id);
    body = (
      <EmptyState
        emoji="⏳"
        title={pending.length > 1 ? `Waiting for ${pending.length} players` : `Waiting for @${first?.profile.handle ?? "your opponent"}`}
        className="mx-auto mt-24 max-w-md"
        action={<Button href="/challenges">Back to challenges</Button>}
      >
        Your result is locked in. We&apos;ll let you know the moment {pending.length > 1 ? "everyone has played" : "they play"}.
      </EmptyState>
    );
  }

  return (
    <div className="relative min-h-dvh pb-16">
      <Backdrop app={app} />
      <div className="px-3 pt-3">
        <div className="mx-auto flex h-14 max-w-5xl items-center">
          <Button variant="ghost" size="sm" href={viewer ? "/challenges" : "/"}>
            ← {viewer ? "Challenges" : "XApps"}
          </Button>
        </div>
      </div>
      {body}
    </div>
  );
}

type Overlay = "none" | "voting" | "results";

function introSeenKey(matchId: string) {
  return `xapps:intro-seen:${matchId}`;
}

function readIntroSeen(matchId: string): boolean {
  try {
    return window.localStorage.getItem(introSeenKey(matchId)) === "1";
  } catch {
    return false;
  }
}

/** The live stage: HUD + sandboxed app iframe + intro/voting/results overlays. */
function MatchStage({ app, match, viewer }: { app: AppManifest; match: Match; viewer: Profile }) {
  const router = useRouter();
  const backend = useBackend();
  const queryClient = useQueryClient();
  const action = useMatchAction();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const roomRef = useRef<RoomTransport | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const introStateRef = useRef<"idle" | "playing" | "done">("idle");
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** State versions this client wrote, so `state.change` can say `by: me`. */
  const ownWrites = useRef(new Set<number>());
  /** Last match snapshot the app was told about (for state/turn/round diffs). */
  const lastMatch = useRef<Match | null>(null);
  /** The bridge's emit, for handlers (which are built before the bridge exists). */
  const emitRef = useRef<Emit | null>(null);

  const [hud, setHud] = useState<HudState>({ status: null, scores: {}, turn: null });
  const [appReady, setAppReady] = useState(false);
  const [intro, setIntro] = useState<"idle" | "playing" | "done">("idle");
  const [started, setStarted] = useState(false);
  const [peers, setPeers] = useState<RoomPeer[]>([]);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [goneSince, setGoneSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const { items: floating, push: pushFloating } = useFloatingReactions();

  const live = match.mode === "live";
  const me = playerOf(match, viewer.id);
  const spectating = viewerIsSpectator(match, viewer.id);
  const seated = seatedPlayers(match);
  const others = seated.filter((p) => p.userId !== viewer.id);
  const opponent = others[0] ?? opponentOf(match, viewer.id);
  const multiplayer = isMultiplayer(match);
  const turnBased = !!app.turnBased || match.turnUserId !== null;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const set = timers.current;
    return () => set.forEach(clearTimeout);
  }, []);

  const testBuild = isTestBuild(match);
  /** Test builds load their version's url (and the bridge pins that url's origin). */
  const sourceUrl = match.versionUrl || app.url;
  const appUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const url = new URL(sourceUrl, window.location.origin);
      return { href: url.toString(), origin: url.origin };
    } catch {
      return null;
    }
  }, [sourceUrl]);

  /** Fire-and-forget developer logs (the backend drops them past its rate limit). */
  const [hostLogBudget] = useState(() => createLogThrottle(30));
  const logEvent = (level: LogLevel, message: string, data: Json | undefined, source: "app" | "host") => {
    if (source === "host" && !hostLogBudget()) return;
    backend.logAppEvent({ appSlug: app.slug, matchId: match.id, level, message, data, source }).catch(() => undefined);
  };

  /* ------------------------------------------------------------ bridge */

  /** Freshest copy of the match (our own writes land in the cache before the next render). */
  const latest = () => queryClient.getQueryData<Match>(["match", match.id]) ?? match;
  const store = (updated: Match) => queryClient.setQueryData(["match", match.id], updated);
  /** Our own state/turn/round writes: tell the app right away, then update the cache (the diff below then sees nothing new). */
  const announce = (updated: Match) => {
    const by = ownWrites.current.has(updated.stateVersion) ? viewer.id : null;
    if (emitRef.current) emitMatchChanges(emitRef.current, lastMatch.current, updated, by);
    lastMatch.current = updated;
    store(updated);
  };
  const seatedOnly = (method: string) => {
    if (spectating) throw new XAppsError("forbidden", `${method}: spectators can't do that`);
  };

  const handlers: HostHandlers = {
    ready: () => {
      setAppReady(true);
      return { startedAt: startedAtRef.current };
    },
    "room.send": ({ type, payload }) => {
      seatedOnly("room.send");
      roomRef.current?.send({ kind: "app", type, payload });
      return null;
    },
    "match.submit": async ({ playerId, score, data, display }) => {
      seatedOnly("match.submit");
      try {
        const updated = await backend.submit(match.id, { playerId, score, data, display });
        store(updated);
        const final = updated.status === "completed";
        return { state: final ? "final" : "waiting", result: final ? toMatchResult(updated) : null };
      } catch (error) {
        toast(errorMessage(error), { tone: "danger" });
        throw error;
      }
    },
    "match.forfeit": async () => {
      seatedOnly("match.forfeit");
      await forfeit();
      return null;
    },
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
    "ui.status": ({ text }) => {
      setHud((h) => ({ ...h, status: text }));
      return null;
    },
    "ui.scores": ({ scores }) => {
      setHud((h) => ({ ...h, scores }));
      return null;
    },
    "ui.turn": ({ playerId }) => {
      setHud((h) => ({ ...h, turn: playerId }));
      return null;
    },
    "social.share": ({ text, url }) => {
      openXIntent(text, shareLinkFor(url, window.location.origin));
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
      seatedOnly("storage.set");
      try {
        await backend.storageSet(app.slug, key, value);
        return null;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "storage.delete": async ({ key }) => {
      seatedOnly("storage.delete");
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
      seatedOnly("media.upload");
      try {
        return await backend.uploadMedia(app.slug, file);
      } catch (error) {
        const sdkError = toSdkError(error);
        toast(errorMessage(error), { tone: "danger" });
        throw sdkError;
      }
    },
    "stats.report": async ({ values }) => {
      seatedOnly("stats.report");
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
    // Read-only: spectators may read boards too. Test builds read the live board.
    "stats.leaderboard": (params) => readStatStanding(backend, app.slug, params, testBuild),
    "achievements.unlock": async ({ id }) => {
      seatedOnly("achievements.unlock");
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
        // Our app hears it first, then everyone else in a live room.
        emitRef.current?.("achievement.unlock", { id, userId: viewer.id });
        roomRef.current?.send({ kind: "achievement", id });
        invalidateProgress(queryClient, app.slug);
      }
      return result;
    },
    "state.get": () => {
      const current = latest();
      return { state: current.state, version: current.stateVersion };
    },
    "state.set": async ({ state, expectedVersion }) => {
      seatedOnly("state.set");
      try {
        const { version, match: updated } = await backend.updateState(match.id, state, expectedVersion);
        ownWrites.current.add(version);
        announce(updated);
        return { version };
      } catch (error) {
        const sdkError = toSdkError(error);
        // A conflict is routine (the SDK re-reads and retries), so no toast for it.
        if (sdkError.code !== "conflict") toast(errorMessage(error), { tone: "danger" });
        throw sdkError;
      }
    },
    "turn.end": async ({ next }) => {
      seatedOnly("turn.end");
      try {
        // turn.change goes out before the reply.
        announce(await backend.endTurn(match.id, next ?? null));
        return null;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    "round.set": async ({ round }) => {
      seatedOnly("round.set");
      try {
        announce(await backend.setRound(match.id, round));
        return null;
      } catch (error) {
        throw toSdkError(error);
      }
    },
    log: ({ level, message, data }) => {
      logEvent(level, message, data, "app");
      return null;
    },
    // The stage fills the screen: size hints only matter for the challenge sheet's setup frame.
    "ui.resize": () => null,
    "setup.submit": () => {
      throw new XAppsError("forbidden", "setup.submit only works in setup purpose");
    },
    "setup.cancel": () => {
      throw new XAppsError("forbidden", "setup.cancel only works in setup purpose");
    },
  };

  const { connected, connections, emit } = useAppBridge({
    iframeRef,
    appOrigin: appUrl?.origin ?? null,
    enabled: !!appUrl,
    context: () => buildLaunchContext(app, latest(), viewer, window.location.origin),
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

  // A reloaded iframe must say ready() again.
  const [seenConnections, setSeenConnections] = useState(connections);
  if (connections !== seenConnections) {
    setSeenConnections(connections);
    if (connections > 1) setAppReady(false);
  }

  /* ------------------------------------------------------------ room */

  const beginPlaying = useCallback(
    (at: number) => {
      if (startedAtRef.current !== null) return;
      startedAtRef.current = at;
      introStateRef.current = "done";
      setIntro("done");
      setStarted(true);
      emit("match.start", { at });
      try {
        window.localStorage.setItem(introSeenKey(match.id), "1");
      } catch {
        // ignore
      }
      if (!match.startedAt && !spectating) backend.markStarted(match.id).catch(() => undefined);
      later(() => iframeRef.current?.focus(), 50);
    },
    [backend, emit, later, match.id, match.startedAt, spectating],
  );

  const startIntro = useCallback(() => {
    if (startedAtRef.current !== null || introStateRef.current !== "idle") return;
    introStateRef.current = "playing";
    setIntro("playing");
  }, []);
  const startIntroRef = useRef(startIntro);
  useEffect(() => {
    startIntroRef.current = startIntro;
  }, [startIntro]);

  /** Another player's host says they unlocked an achievement: a quiet banner, and tell our app. */
  const onPeerAchievement = (id: string, from: string) => {
    const def = app.achievements?.find((a) => a.id === id);
    const player = match.players.find((p) => p.userId === from);
    if (!def || !player || from === viewer.id) return;
    emit("achievement.unlock", { id, userId: from });
    if (!def.secret) {
      showAchievement({ icon: def.icon, name: def.name, xp: def.xp, appName: app.name, accent: app.accent, by: player.profile.handle });
    }
  };
  const onPeerAchievementRef = useRef(onPeerAchievement);
  useLayoutEffect(() => {
    onPeerAchievementRef.current = onPeerAchievement;
  });

  useEffect(() => {
    if (!live) return;
    const room = backend.openRoom(match.id, viewer.id);
    roomRef.current = room;
    room.track({ ready: false });
    const offPresence = room.onPresence(setPeers);
    const offEvent = room.onEvent((event, from, at) => {
      if (event.kind === "app") {
        emit("room.message", { type: event.type, payload: event.payload, from, at });
      } else if (event.kind === "reaction") {
        pushFloating(event.emoji, "right");
        emit("reaction", { from, emoji: event.emoji });
        play("pop");
      } else if (event.kind === "start") {
        startIntroRef.current();
      } else if (event.kind === "achievement") {
        onPeerAchievementRef.current(event.id, from);
      }
    });
    return () => {
      offPresence();
      offEvent();
      room.close();
      roomRef.current = null;
    };
    // pushFloating is recreated each render but only appends state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, emit, live, match.id, viewer.id]);

  useEffect(() => {
    roomRef.current?.track({ ready: appReady && !spectating });
  }, [appReady, spectating]);

  const humans = seated.filter((p) => !p.isBot && p.state !== "invited" && p.state !== "left");
  const refereeId = humans[0]?.userId;
  const readyIds = new Set(peers.filter((p) => p.ready).map((p) => p.userId));
  if (appReady && !spectating) readyIds.add(viewer.id);
  const everyoneReady = humans.length > 0 && humans.every((h) => readyIds.has(h.userId));
  const onlineIds = useMemo(() => {
    const ids = new Set(peers.map((p) => p.userId));
    ids.add(viewer.id);
    match.players.filter((p) => p.isBot).forEach((p) => ids.add(p.userId));
    if (!live) match.players.forEach((p) => ids.add(p.userId));
    return ids;
  }, [live, match.players, peers, viewer.id]);
  const seatedIds = new Set(seated.map((p) => p.userId));
  const liveWatchers = new Set(peers.map((p) => p.userId).filter((id) => !seatedIds.has(id)));
  if (spectating) liveWatchers.add(viewer.id);
  const spectatorCount = Math.max(match.spectatorCount ?? 0, liveWatchers.size);

  useEffect(() => {
    emit("room.presence", { online: Array.from(onlineIds) });
  }, [emit, onlineIds, connections]);

  // Decide when to start.
  useEffect(() => {
    if (!appReady || startedAtRef.current !== null || introStateRef.current !== "idle") return;
    if (me?.state === "submitted") return;
    if (spectating) {
      // Spectators never hold the match up: join mid-match, or ride along with the start signal.
      if (match.startedAt) beginPlaying(Date.parse(match.startedAt));
      return;
    }
    if (!live) {
      // Picking a turn-based game back up days later shouldn't replay the intro.
      if (turnBased && match.startedAt && readIntroSeen(match.id)) beginPlaying(Date.parse(match.startedAt));
      else startIntro();
      return;
    }
    if (match.startedAt) {
      // Reloaded mid-match: skip the intro and resume.
      beginPlaying(Date.parse(match.startedAt));
      return;
    }
    if (!everyoneReady) return;
    if (refereeId === viewer.id) {
      roomRef.current?.send({ kind: "start", at: Date.now() });
      startIntro();
      return;
    }
    // Safety net in case the referee's start signal got lost.
    const fallback = setTimeout(startIntro, 2500);
    return () => clearTimeout(fallback);
  }, [appReady, beginPlaying, everyoneReady, live, match.id, match.startedAt, me?.state, refereeId, spectating, startIntro, turnBased, viewer.id]);

  // Liveness heartbeat so a vanished opponent can be claimed against.
  useEffect(() => {
    if (!live || !started || spectating) return;
    void backend.heartbeat(match.id);
    const t = setInterval(() => void backend.heartbeat(match.id), 10_000);
    return () => clearInterval(t);
  }, [backend, live, match.id, started, spectating]);

  const missing = others.find((p) => !p.isBot && (p.state === "joined") && !onlineIds.has(p.userId));
  const disconnected = live && started && match.status === "active" && !spectating && !!missing;
  useEffect(() => {
    if (!disconnected) return;
    const since = Date.now();
    const tick = () => {
      setGoneSince(since);
      setNow(Date.now());
    };
    const first = setTimeout(tick, 0);
    const interval = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
      setGoneSince(null);
    };
  }, [disconnected]);

  /* ------------------------------------------------------------ match updates */

  const lastStatus = useRef(match.status);
  useEffect(() => {
    emit("match.update", { match: toLaunchMatch(match, viewer.id) });
    const previousMatch = lastMatch.current;
    // A stale snapshot (an older echo after our own write) never moves the app backwards.
    if (!previousMatch || previousMatch.id !== match.id || match.stateVersion >= previousMatch.stateVersion) {
      lastMatch.current = match;
      emitMatchChanges(emit, previousMatch, match, ownWrites.current.has(match.stateVersion) ? viewer.id : null);
    }
    const previous = lastStatus.current;
    lastStatus.current = match.status;
    if (match.status === "completed" && previous !== "completed") {
      emit("match.end", { result: toMatchResult(match) });
      void queryClient.invalidateQueries({ queryKey: ["viewer"] });
      void queryClient.invalidateQueries({ queryKey: ["my-matches"] });
      later(() => setOverlay("results"), 1400);
    } else if (match.status === "voting" && previous !== "voting") {
      later(() => setOverlay((o) => (o === "results" ? o : "voting")), 1500);
    }
  }, [emit, later, match, queryClient, viewer.id]);

  /* ------------------------------------------------------------ actions */

  async function forfeit() {
    try {
      await action.mutateAsync({ action: "forfeit", matchId: match.id });
    } catch (error) {
      toast(errorMessage(error), { tone: "danger" });
    }
  }

  const onBack = () => {
    const running = match.status === "active" && started && me?.state !== "submitted" && !spectating;
    if (running && live) {
      setConfirmLeave(true);
      return;
    }
    router.push(`/apps/${app.slug}`);
  };

  const react = (emoji: string) => {
    pushFloating(emoji, "left");
    roomRef.current?.send({ kind: "reaction", emoji });
    emit("reaction", { from: viewer.id, emoji });
  };

  const rematch = async () => {
    setRematching(true);
    try {
      const rivals = others.filter((p) => !p.isBot);
      const next =
        match.mode === "practice" || rivals.length === 0 || (others.some((p) => p.isBot) && backend.kind !== "demo")
          ? await backend.startPractice(app.slug, seated.length > 2 ? seated.length : undefined, match.versionId)
          : await backend.createChallenge({
              appSlug: app.slug,
              versionId: match.versionId ?? null,
              mode: match.mode === "async" ? "async" : "live",
              opponentHandle: rivals.length === 1 ? rivals[0]!.profile.handle : null,
              opponentHandles: rivals.length > 1 ? rivals.map((p) => p.profile.handle) : undefined,
              maxPlayers: match.maxPlayers > 2 ? match.maxPlayers : undefined,
              // Same setup (template, dropped image, topic) for the rematch.
              settings: rematchSettings(match.settings),
            });
      router.replace(`/play/${next.id}`);
    } catch (error) {
      toast(errorMessage(error), { tone: "danger" });
      setRematching(false);
    }
  };

  const waitingForPeer = live && appReady && !started && intro === "idle" && (spectating ? !match.startedAt : !everyoneReady);
  const notReady = humans.filter((h) => h.userId !== viewer.id && !readyIds.has(h.userId));
  const goneFor = disconnected && goneSince ? Math.floor((now - goneSince) / 1000) : 0;
  const introPlayers = seated.filter((p) => p.state !== "invited");

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ "--accent-from": app.accent[0], "--accent-to": app.accent[1] } as React.CSSProperties}
    >
      <Backdrop app={app} />
      <Hud
        app={app}
        match={match}
        viewerId={viewer.id}
        online={onlineIds}
        hud={hud}
        spectating={spectating}
        spectatorCount={spectatorCount}
        onBack={onBack}
        onReact={react}
        onForfeit={!spectating && match.status === "active" && seated.length > 1 && me?.state === "joined" ? () => setConfirmLeave(true) : undefined}
        onCopyLink={async () => {
          const ok = await copyText(`${window.location.origin}/play/${match.id}`);
          toast(ok ? "Match link copied" : "Couldn't copy the link", { tone: ok ? "success" : "danger" });
        }}
      />

      <div className="relative min-h-0 flex-1 p-3 pt-3">
        <motion.div
          className="relative mx-auto h-full max-w-5xl overflow-hidden rounded-[2rem] bg-ink-900 shadow-[0_40px_120px_-40px_rgb(0_0_0/0.9)] ring-1 ring-white/10"
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={spring.soft}
        >
          {appUrl && (
            <iframe
              ref={iframeRef}
              src={appUrl.href}
              title={app.name}
              className="absolute inset-0 size-full border-0"
              sandbox={APP_SANDBOX}
              allow={APP_ALLOW}
            />
          )}

          <AnimatePresence>
            {!connected && (
              <motion.div
                key="loading"
                className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ink-900"
                exit={{ opacity: 0, transition: { duration: 0.3 } }}
              >
                <motion.div animate={{ scale: [1, 1.08, 1], rotate: [0, -3, 3, 0] }} transition={{ duration: 1.5, repeat: Infinity }}>
                  <AppGlyph app={app} size={76} />
                </motion.div>
                <p className="text-sm text-ink-300">Loading {app.name}…</p>
              </motion.div>
            )}
            {waitingForPeer && (notReady.length > 0 || spectating) && (
              <motion.div
                key="waiting"
                className="absolute inset-0 flex items-center justify-center bg-ink-950/70 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div className="flex flex-col items-center gap-4 px-6 text-center" initial={{ y: 12 }} animate={{ y: 0 }}>
                  <div className="flex -space-x-3">
                    {(spectating ? humans : notReady).slice(0, 5).map((p, i) => (
                      <motion.div
                        key={p.userId}
                        className="rounded-full ring-4 ring-ink-950/80"
                        animate={{ scale: [1, 1.06, 1] }}
                        transition={{ duration: 1.6, repeat: Infinity, delay: i * 0.2 }}
                      >
                        <Avatar person={p.profile} size={notReady.length > 1 || spectating ? 64 : 80} online={onlineIds.has(p.userId)} />
                      </motion.div>
                    ))}
                  </div>
                  <p className="font-display text-2xl font-bold">
                    {spectating
                      ? "The players are warming up"
                      : notReady.length > 1
                        ? `Waiting for ${notReady.length} players`
                        : onlineIds.has(notReady[0]!.userId)
                          ? `@${notReady[0]!.profile.handle} is loading…`
                          : `Waiting for @${notReady[0]!.profile.handle}`}
                  </p>
                  <p className="max-w-xs text-sm text-ink-300">
                    {spectating ? "You're in the stands. The match starts the moment everyone's here." : notReady.length > 1 || multiplayer ? "The match starts the moment everyone's here." : "The match starts the moment you're both here."}
                  </p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {disconnected && goneSince && missing && (
              <motion.div
                className="absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-3 rounded-full glass-strong py-2 pl-4 pr-2 text-sm shadow-xl"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={spring.bouncy}
              >
                <WifiOff className="size-4 shrink-0 text-gold" />
                <span className="min-w-0 truncate">
                  @{missing.profile.handle} disconnected · <span className="font-mono tabular">{goneFor}s</span>
                </span>
                {goneFor >= 45 ? (
                  <Button size="sm" variant="volt" onClick={() => action.mutate({ action: "claim", matchId: match.id }, { onError: (e) => toast(errorMessage(e), { tone: "danger" }) })}>
                    {seated.length > 2 ? "Mark as left" : "Claim the win"}
                  </Button>
                ) : (
                  <span className="shrink-0 pr-2 text-xs text-ink-400">claim in {45 - goneFor}s</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <TurnBanner
            match={match}
            viewerId={viewer.id}
            spectating={spectating}
            enabled={started && overlay === "none" && match.status === "active"}
            onLeave={() => router.push("/challenges")}
          />
        </motion.div>
      </div>

      <FloatingReactions items={floating} />

      {intro === "playing" && (me || spectating) && (
        <VersusIntro
          app={app}
          players={introPlayers}
          teams={match.teams}
          viewerId={viewer.id}
          mode={match.mode}
          onDone={() => beginPlaying(Date.now())}
        />
      )}

      <AnimatePresence>
        {overlay === "voting" && match.status === "voting" && (
          <VotingOverlay
            app={app}
            match={match}
            viewerId={viewer.id}
            onShare={() => openXIntent(`Vote for the best entry in my ${app.name} ${multiplayer ? "match" : "duel"} on XApps ${app.icon}`, `${window.location.origin}/arena`)}
            onLeave={() => router.push("/arena")}
          />
        )}
        {overlay === "results" && match.status === "completed" && (
          <ResultsOverlay
            app={app}
            match={match}
            viewer={queryClient.getQueryData<Profile | null>(["viewer"]) ?? viewer}
            onRematch={spectating ? undefined : rematch}
            rematching={rematching}
            onShare={() => openXIntent(shareText(app, match, viewer.id), `${window.location.origin}/apps/${app.slug}`)}
            onHome={() => router.push(`/apps/${app.slug}`)}
          />
        )}
      </AnimatePresence>

      <Dialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Forfeit this match?"
        description={
          seated.length > 2
            ? "You'll be marked as left and place last. The others play on."
            : `@${opponent?.profile.handle ?? "Your opponent"} takes the win if you leave now.`
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button
            variant="danger"
            size="lg"
            loading={action.isPending}
            onClick={async () => {
              await forfeit();
              setConfirmLeave(false);
            }}
          >
            Forfeit
          </Button>
          <Button variant="glass" size="lg" onClick={() => setConfirmLeave(false)} data-autofocus>
            Keep playing
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function rematchSettings(settings: Match["settings"]): Match["settings"] {
  const rest = { ...settings };
  delete rest.quick;
  return rest;
}
