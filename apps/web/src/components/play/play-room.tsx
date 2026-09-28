"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { HostHandlers } from "@xapps/sdk/host";
import { AnimatePresence, motion } from "motion/react";
import { Home, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { RoomPeer, RoomTransport } from "@/platform/backend";
import { BackendError } from "@/platform/backend";
import { useBackend, useViewer } from "@/platform/client";
import { buildLaunchContext, opponentOf, playerOf, toLaunchMatch, toMatchResult } from "@/platform/match-utils";
import { useApp, useMatch, useMatchAction } from "@/platform/queries";
import type { AppManifest, Match, Profile } from "@/platform/types";
import { FloatingReactions, Hud, type HudState, useFloatingReactions } from "./hud";
import { InviteCard, Lobby } from "./lobby";
import { ResultsOverlay } from "./results-overlay";
import { useAppBridge } from "./use-app-bridge";
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
  const { viewer, loading: viewerLoading } = useViewer();
  const { data: match, isPending: matchLoading, error: matchError } = useMatch(matchId);
  const { data: app } = useApp(match?.appSlug ?? "", !!match);
  const action = useMatchAction();
  const me = match ? playerOf(match, viewer?.id) : undefined;

  const canPlay =
    !!match &&
    !!me &&
    me.state === "joined" &&
    (match.status === "active" || (match.mode === "async" && (match.status === "open" || match.status === "pending")));
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

  if (matchLoading || viewerLoading || (match && !app)) return <FullscreenLoader app={app ?? undefined} />;

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
      />
    );
  } else if (!me) {
    body =
      match.isOpen && match.status === "open" ? (
        <InviteCard app={app} match={match} viewer={viewer} accepting={action.isPending} onAccept={() => run("join")} />
      ) : (
        <EmptyState emoji="🍿" title="Match in progress" className="mx-auto mt-24 max-w-md" action={<Button href={`/apps/${app.slug}`}>Play {app.name}</Button>}>
          {match.players.map((p) => `@${p.profile.handle}`).join(" vs ")} are mid-duel. Start your own!
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
  } else if (isCreator && (match.status === "open" || match.status === "pending")) {
    body = (
      <Lobby
        app={app}
        match={match}
        viewer={viewer}
        cancelling={action.isPending}
        onCancel={() => run("cancel", () => router.push(`/apps/${app.slug}`))}
        onPlayBot={
          match.settings.quick === true
            ? async () => {
                try {
                  await backend.cancelMatch(match.id).catch(() => undefined);
                  const practice = await backend.startPractice(app.slug);
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
    // Already submitted in an earlier visit and waiting on the opponent.
    const opponent = opponentOf(match, viewer.id);
    body = (
      <EmptyState emoji="⏳" title={`Waiting for @${opponent?.profile.handle ?? "your opponent"}`} className="mx-auto mt-24 max-w-md" action={<Button href="/challenges">Back to challenges</Button>}>
        Your result is locked in. We&apos;ll let you know the moment they play.
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
  const opponent = opponentOf(match, viewer.id);

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

  const appUrl = useMemo(() => {
    if (typeof window === "undefined") return null;
    try {
      const url = new URL(app.url, window.location.origin);
      return { href: url.toString(), origin: url.origin };
    } catch {
      return null;
    }
  }, [app.url]);

  /* ------------------------------------------------------------ bridge */

  const handlers: HostHandlers = {
    ready: () => {
      setAppReady(true);
      return { startedAt: startedAtRef.current };
    },
    "room.send": ({ type, payload }) => {
      roomRef.current?.send({ kind: "app", type, payload });
      return null;
    },
    "match.submit": async ({ playerId, score, data, display }) => {
      try {
        const updated = await backend.submit(match.id, { playerId, score, data, display });
        queryClient.setQueryData(["match", match.id], updated);
        const final = updated.status === "completed";
        return { state: final ? "final" : "waiting", result: final ? toMatchResult(updated) : null };
      } catch (error) {
        toast(errorMessage(error), { tone: "danger" });
        throw error;
      }
    },
    "match.forfeit": async () => {
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
      openXIntent(text, url);
      return null;
    },
    "storage.get": ({ key }) => backend.storageGet(app.slug, key),
    "storage.set": async ({ key, value }) => {
      await backend.storageSet(app.slug, key, value);
      return null;
    },
  };

  const { connected, connections, emit } = useAppBridge({
    iframeRef,
    appOrigin: appUrl?.origin ?? null,
    enabled: !!appUrl,
    context: () => buildLaunchContext(app, match, viewer, window.location.origin),
    handlers,
  });

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
      if (!match.startedAt) backend.markStarted(match.id).catch(() => undefined);
      later(() => iframeRef.current?.focus(), 50);
    },
    [backend, emit, later, match.id, match.startedAt],
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
    roomRef.current?.track({ ready: appReady });
  }, [appReady]);

  const humans = match.players.filter((p) => !p.isBot && p.state !== "declined").sort((a, b) => a.seat - b.seat);
  const refereeId = humans[0]?.userId;
  const readyIds = new Set(peers.filter((p) => p.ready).map((p) => p.userId));
  if (appReady) readyIds.add(viewer.id);
  const everyoneReady = humans.length > 0 && humans.every((h) => readyIds.has(h.userId));
  const onlineIds = useMemo(() => {
    const ids = new Set(peers.map((p) => p.userId));
    ids.add(viewer.id);
    match.players.filter((p) => p.isBot).forEach((p) => ids.add(p.userId));
    if (!live) match.players.forEach((p) => ids.add(p.userId));
    return ids;
  }, [live, match.players, peers, viewer.id]);

  useEffect(() => {
    emit("room.presence", { online: Array.from(onlineIds) });
  }, [emit, onlineIds, connections]);

  // Decide when to start.
  useEffect(() => {
    if (!appReady || startedAtRef.current !== null || introStateRef.current !== "idle") return;
    if (me?.state === "submitted") return;
    if (!live) {
      startIntro();
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
  }, [appReady, beginPlaying, everyoneReady, live, match.startedAt, me?.state, refereeId, startIntro, viewer.id]);

  // Liveness heartbeat so a vanished opponent can be claimed against.
  useEffect(() => {
    if (!live || !started) return;
    void backend.heartbeat(match.id);
    const t = setInterval(() => void backend.heartbeat(match.id), 10_000);
    return () => clearInterval(t);
  }, [backend, live, match.id, started]);

  const opponentOnline = !opponent || opponent.isBot || onlineIds.has(opponent.userId);
  const disconnected = live && started && match.status === "active" && !opponentOnline;
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
    const running = match.status === "active" && started && me?.state !== "submitted";
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
      const opp = opponentOf(match, viewer.id);
      const next =
        match.mode === "practice" || !opp || (opp.isBot && backend.kind !== "demo")
          ? await backend.startPractice(app.slug)
          : await backend.createChallenge({
              appSlug: app.slug,
              mode: match.mode === "async" ? "async" : "live",
              opponentHandle: opp.profile.handle,
            });
      router.replace(`/play/${next.id}`);
    } catch (error) {
      toast(errorMessage(error), { tone: "danger" });
      setRematching(false);
    }
  };

  const waitingForPeer = live && appReady && !started && intro === "idle" && !everyoneReady;
  const goneFor = disconnected && goneSince ? Math.floor((now - goneSince) / 1000) : 0;

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
        onBack={onBack}
        onReact={react}
        onForfeit={match.status === "active" && match.players.length > 1 ? () => setConfirmLeave(true) : undefined}
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
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              allow="autoplay; clipboard-write; fullscreen"
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
            {waitingForPeer && opponent && (
              <motion.div
                key="waiting"
                className="absolute inset-0 flex items-center justify-center bg-ink-950/70 backdrop-blur-md"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <motion.div className="flex flex-col items-center gap-4 text-center" initial={{ y: 12 }} animate={{ y: 0 }}>
                  <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 1.6, repeat: Infinity }}>
                    <Avatar person={opponent.profile} size={80} online={onlineIds.has(opponent.userId)} />
                  </motion.div>
                  <p className="font-display text-2xl font-bold">
                    {onlineIds.has(opponent.userId) ? `@${opponent.profile.handle} is loading…` : `Waiting for @${opponent.profile.handle}`}
                  </p>
                  <p className="max-w-xs text-sm text-ink-300">The match starts the moment you&apos;re both here.</p>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {disconnected && goneSince && (
              <motion.div
                className="absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit items-center gap-3 rounded-full glass-strong py-2 pl-4 pr-2 text-sm shadow-xl"
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={spring.bouncy}
              >
                <WifiOff className="size-4 text-gold" />
                <span>
                  @{opponent?.profile.handle} disconnected · <span className="font-mono tabular">{goneFor}s</span>
                </span>
                {goneFor >= 45 ? (
                  <Button size="sm" variant="volt" onClick={() => action.mutate({ action: "claim", matchId: match.id }, { onError: (e) => toast(errorMessage(e), { tone: "danger" }) })}>
                    Claim the win
                  </Button>
                ) : (
                  <span className="pr-2 text-xs text-ink-400">claim in {45 - goneFor}s</span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      <FloatingReactions items={floating} />

      {intro === "playing" && me && (
        <VersusIntro
          app={app}
          left={me}
          right={opponent}
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
            onShare={() => openXIntent(`Vote for the best entry in my ${app.name} duel on XApps ${app.icon}`, `${window.location.origin}/arena`)}
            onLeave={() => router.push("/arena")}
          />
        )}
        {overlay === "results" && match.status === "completed" && (
          <ResultsOverlay
            app={app}
            match={match}
            viewer={queryClient.getQueryData<Profile | null>(["viewer"]) ?? viewer}
            onRematch={rematch}
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
        description={`@${opponent?.profile.handle ?? "Your opponent"} takes the win if you leave now.`}
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
