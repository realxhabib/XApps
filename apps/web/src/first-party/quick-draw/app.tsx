"use client";

import type { Json, PlayerInfo, XAppsClient } from "@xapps/sdk";
import { useMatch, useMatchResult, useMatchStarted, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useBot, useLiveOpponent } from "@/first-party/shared/hooks";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { fadeUp, spring, staggerChildren } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { DuelEngine, INITIAL_VIEW, type DuelEvent, type DuelView, type TapResult } from "./duel";
import { FinalPanel, WaitingLine } from "./final";
import { FlashLayer, Ripples, TensionLayer, type Flash, type Ripple } from "./fx";
import {
  MAX_ROUNDS,
  STEADY_MAX_MS,
  bestMs,
  classify,
  describeOutcome,
  duelStats,
  earnedAchievements,
  heartbeatIntervalMs,
  matchWinner,
  steadyDelayMs,
  submissionData,
  type RoundOutcome,
  type RoundWinner,
  type Score,
} from "./logic";
import { Scoreboard } from "./scoreboard";
import { SteadyFace, Target, type Impact } from "./target";

/** Stand-in when there's no opponent record at all (never expected for a 1v1 app). */
const GHOST: PlayerInfo = {
  id: "ghost",
  handle: "ghost",
  name: "Ghost",
  avatarUrl: null,
  seat: 1,
  isBot: true,
  submitted: false,
  team: null,
  role: "player",
  score: null,
};

type HapticStyle = Parameters<XAppsClient["ui"]["haptic"]>[0];

function displayName(player: PlayerInfo): string {
  return player.name?.trim() || `@${player.handle}`;
}

/** Prefer the input's own timestamp (captured when the finger landed) over "now". */
function eventTime(stamp: number): number {
  const now = performance.now();
  return stamp > 0 && stamp <= now && now - stamp < 1000 ? stamp : now;
}

/** Fire-and-forget host requests: a missing host feature must never break the duel. */
function quietly(promise: Promise<unknown>): void {
  promise.catch(() => {});
}

async function submitDuel(
  xapps: XAppsClient,
  botId: string | null,
  score: Score,
  outcomes: readonly RoundOutcome[],
): Promise<void> {
  const data = submissionData(outcomes);
  if (botId) {
    await xapps
      .submitFor(botId, { score: score.opp, data: { bestMs: bestMs(outcomes.map((o) => o.opp)) } })
      .catch((error: unknown) => console.warn("[quick-draw] bot submit failed", error));
  }
  await xapps.submit({
    score: score.me,
    data,
    display: {
      kind: "text",
      title: `${score.me}–${score.opp}`,
      body: data.bestMs !== null ? `Fastest reaction: ${data.bestMs} ms` : "No clean taps",
    },
  });
}

export function QuickDraw() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const result = useMatchResult();
  const match = useMatch();
  const bot = useBot();
  const liveOpp = useLiveOpponent();
  const reduced = useReducedMotion() ?? false;

  const me = xapps.me;
  const opp = xapps.opponent ?? GHOST;
  const oppName = displayName(opp);
  // Primitive ids keep the engine effect stable when `match.update` swaps player objects.
  const liveOppId = liveOpp?.id ?? null;
  const botId = bot?.id ?? null;

  const [view, setView] = useState<DuelView>(INITIAL_VIEW);
  const [beat, setBeat] = useState(0);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const engineRef = useRef<DuelEngine | null>(null);
  /** Room messages that arrive before our engine exists. */
  const inboxRef = useRef<Json[]>([]);
  const readyRef = useRef(false);
  const submittedRef = useRef(false);
  const [stage, animateStage] = useAnimate<HTMLDivElement>();

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[quick-draw] ready failed", error));
  }, [xapps]);

  useRoomEvent("result", (payload, from) => {
    if (!liveOppId || from !== liveOppId) return;
    const engine = engineRef.current;
    if (engine) engine.receive(payload);
    else inboxRef.current.push(payload);
  });

  const haptic = useCallback((style: HapticStyle) => quietly(xapps.ui.haptic(style)), [xapps]);

  const shake = useCallback(
    (strength: number) => {
      if (reduced || !stage.current) return;
      const a = 12 * strength;
      animateStage(
        stage.current,
        { x: [0, -a, a * 0.85, -a * 0.6, a * 0.35, -a * 0.15, 0], y: [0, a * 0.5, -a * 0.4, a * 0.3, -a * 0.15, 0, 0] },
        { duration: 0.45, ease: "easeOut" },
      );
    },
    [reduced, stage, animateStage],
  );

  /** Submit exactly once per success; a failed attempt can be retried from the final screen. */
  const lastFinalRef = useRef<{ score: Score; outcomes: readonly RoundOutcome[] } | null>(null);
  const submitNow = useCallback(() => {
    const final = lastFinalRef.current;
    if (!final) return;
    setSubmitError(false);
    submitDuel(xapps, botId, final.score, final.outcomes).then(
      () => setSubmitted(true),
      (error: unknown) => {
        console.error("[quick-draw] submit failed", error);
        setSubmitError(true);
      },
    );
  }, [xapps, botId]);

  const pushFlash = useCallback((kind: Flash["kind"]) => setFlash((f) => ({ id: (f?.id ?? 0) + 1, kind })), []);
  const pushImpact = useCallback((kind: Impact["kind"]) => setImpact((i) => ({ id: (i?.id ?? 0) + 1, kind })), []);

  const onDuelEvent = useEffectEvent((event: DuelEvent) => {
    const scores = (s: Score) => quietly(xapps.ui.setScores({ [me.id]: s.me, [opp.id]: s.opp }));
    switch (event.type) {
      case "round":
        quietly(xapps.ui.setStatus(`Round ${event.round} of ${MAX_ROUNDS}`));
        if (event.round === 1) {
          scores(event.score);
          quietly(xapps.ui.setTurn(null));
        }
        play("whoosh");
        break;
      case "draw":
        play("draw");
        haptic("heavy");
        pushFlash("draw");
        shake(1);
        break;
      case "shot": {
        const kind = classify(event.result);
        if (kind === "false-start") {
          play("error");
          haptic("error");
          pushFlash("foul");
          pushImpact("foul");
          shake(1.3);
        } else if (kind === "miss") {
          play("error");
          haptic("medium");
        } else {
          play("pop");
          haptic("medium");
          pushImpact("hit");
        }
        break;
      }
      case "nudge":
        play("tick");
        pushImpact("nudge");
        break;
      case "opp-fired":
        play("tick");
        haptic("light");
        break;
      case "opp-false-start":
        play("notify");
        haptic("light");
        break;
      case "reveal":
        scores(event.score);
        // Round-level badges (fast taps, photo finish…) land with the verdict.
        unlockAchievements(
          xapps,
          earnedAchievements(engineRef.current?.getSnapshot().outcomes ?? [event.outcome], false),
          "quick-draw",
        );
        if (event.outcome.winner === "me") {
          play("vote");
          haptic("success");
        } else if (event.outcome.winner === "opp") {
          play("whoosh");
          haptic("light");
        } else {
          play("pop");
        }
        break;
      case "final": {
        const winner = matchWinner(event.score);
        play(winner === "me" ? "win" : winner === "opp" ? "lose" : "notify");
        haptic(winner === "me" ? "success" : "medium");
        quietly(xapps.ui.setStatus(`Duel over · ${event.score.me}–${event.score.opp}`));
        if (!submittedRef.current) {
          submittedRef.current = true;
          reportStats(xapps, duelStats(event.outcomes), "quick-draw");
          unlockAchievements(xapps, earnedAchievements(event.outcomes, true), "quick-draw");
          lastFinalRef.current = { score: event.score, outcomes: event.outcomes };
          submitNow();
        }
        break;
      }
    }
  });

  // The duel engine lives for the match. Created in an effect (not render) so
  // StrictMode's mount → unmount → mount simply builds a fresh one.
  useEffect(() => {
    if (!started || xapps.finalResult) return;
    const engine = new DuelEngine({
      steadyDelay: (round) => steadyDelayMs(xapps.random, round),
      opponent: liveOppId
        ? {
            kind: "remote",
            send: (m) => quietly(xapps.room.send("result", { round: m.round, ms: m.ms, falseStart: m.falseStart })),
          }
        : // Bot reaction noise must NOT come from the shared seed.
          { kind: "simulated", rand: Math.random },
    });
    engineRef.current = engine;
    const offView = engine.subscribe(() => setView(engine.getSnapshot()));
    const offEvents = engine.onEvent((event) => onDuelEvent(event));
    for (const payload of inboxRef.current.splice(0)) engine.receive(payload);
    engine.start();
    return () => {
      offView();
      offEvents();
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [started, xapps, liveOppId]);

  // The platform settled the match (e.g. someone forfeited): stop the clock.
  useEffect(() => {
    if (result) engineRef.current?.halt();
  }, [result]);

  // Keep render latency out of reaction times: report when GO actually painted.
  useLayoutEffect(() => {
    if (view.phase !== "draw") return;
    const raf = requestAnimationFrame(() => engineRef.current?.markSignalPainted(performance.now()));
    return () => cancelAnimationFrame(raf);
  }, [view.phase, view.round]);

  // Heartbeat during STEADY. Its tempo follows elapsed time only, so it can't tip off GO.
  useEffect(() => {
    if (view.phase !== "steady") return;
    const startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout>;
    const thump = () => {
      setBeat((b) => b + 1);
      play("thump");
      timer = setTimeout(thump, heartbeatIntervalMs(performance.now() - startedAt));
    };
    timer = setTimeout(thump, 140);
    return () => clearTimeout(timer);
  }, [view.phase, view.round]);

  /* ---------------------------------------------------------------- */
  /* Input                                                            */
  /* ---------------------------------------------------------------- */

  const addRipple = useCallback((x: number, y: number, res: TapResult) => {
    if (res !== "shot" && res !== "false-start") return;
    setRipples((list) => [
      ...list.slice(-4),
      { id: (list[list.length - 1]?.id ?? 0) + 1, x, y, tone: res === "shot" ? "shot" : "foul" },
    ]);
  }, []);
  const removeRipple = useCallback((id: number) => setRipples((list) => list.filter((r) => r.id !== id)), []);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      const engine = engineRef.current;
      if (!engine) return;
      const res = engine.tap(eventTime(e.timeStamp));
      const rect = e.currentTarget.getBoundingClientRect();
      addRipple(e.clientX - rect.left, e.clientY - rect.top, res);
    },
    [addRipple],
  );

  // Space / Enter anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code !== "Space" && e.key !== " " && e.key !== "Enter") return;
      const engine = engineRef.current;
      if (!engine) return;
      const phase = engine.getSnapshot().phase;
      if (phase !== "intro" && phase !== "steady" && phase !== "draw") return;
      e.preventDefault();
      const res = engine.tap(eventTime(e.timeStamp));
      addRipple(window.innerWidth / 2, window.innerHeight / 2, res);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addRipple]);

  /* ---------------------------------------------------------------- */
  /* Render                                                           */
  /* ---------------------------------------------------------------- */

  if (!started) return <Pregame me={me} opp={opp} oppName={oppName} />;

  const over = view.phase === "final" || view.phase === "halted" || (!!result && view.phase === "idle");
  const winner: RoundWinner = result
    ? result.winnerId === me.id
      ? "me"
      : result.winnerId === opp.id
        ? "opp"
        : "none"
    : matchWinner(view.score);
  const oppLive = match.players.find((p) => p.id === opp.id) ?? opp;
  const finalStatus = result ? (
    <span className="font-semibold text-success">✓ Result locked in</span>
  ) : submitError ? (
    <span className="inline-flex items-center gap-2 text-danger">
      Couldn&apos;t submit your result.
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        transition={spring.snappy}
        onClick={() => {
          play("pop");
          submitNow();
        }}
        className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-ink-50 ring-1 ring-white/15 hover:bg-white/15"
      >
        Retry
      </motion.button>
    </span>
  ) : submitted && liveOppId && !oppLive.submitted ? (
    <WaitingLine name={oppName} />
  ) : (
    <span>
      Locking in the result
      <AnimatedDots />
    </span>
  );

  return (
    <div
      className="relative flex h-dvh min-h-[480px] w-full touch-manipulation select-none flex-col overflow-hidden [-webkit-touch-callout:none]"
      data-phase={view.phase}
      data-round={view.round}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <TensionLayer active={view.phase === "steady"} />
      <FlashLayer flash={flash} reduced={reduced} />
      <Ripples ripples={ripples} onDone={removeRipple} />
      <Announcer view={view} oppName={oppName} />

      <div ref={stage} className="relative z-10 flex min-h-0 flex-1 flex-col">
        <Scoreboard view={view} me={me} opp={opp} oppName={oppName} />

        {over ? (
          <FinalPanel
            outcomes={view.outcomes}
            score={view.score}
            winner={winner}
            me={me}
            opp={opp}
            oppName={oppName}
            status={finalStatus}
            reduced={reduced}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
            <button
              type="button"
              aria-label={view.phase === "draw" ? "Go! Tap now" : "Target. Tap only after GO appears"}
              // Pointer input is handled on pointerdown by the whole stage (no click delay);
              // this covers assistive tech that activates the button without a pointer.
              onClick={(e) => {
                if (e.detail === 0) engineRef.current?.tap(performance.now());
              }}
              className="relative flex cursor-crosshair items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-from)]/60 focus-visible:ring-offset-8 focus-visible:ring-offset-transparent"
            >
              <motion.div
                initial={false}
                animate={{ scale: view.phase === "steady" && !reduced ? 1.07 : 1 }}
                transition={
                  view.phase === "steady"
                    ? { duration: STEADY_MAX_MS / 1000, ease: [0.4, 0, 0.9, 0.6] }
                    : { type: "spring", stiffness: 300, damping: 26 }
                }
              >
                <Target view={view} beat={beat} impact={impact} reduced={reduced} oppPlayer={opp} oppName={oppName} />
              </motion.div>
            </button>
            <Footer view={view} oppName={oppName} live={!!liveOppId} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Footer: hints during a round, the verdict after it                 */
/* ------------------------------------------------------------------ */

interface Hint {
  key: string;
  text: string;
  /** Extra text only shown where there's a keyboard / precise pointer. */
  desktop?: string;
  tone?: "hot" | "bad";
}

function hintFor(view: DuelView, oppName: string, live: boolean): Hint | null {
  const { phase, mine, opp, oppFalseStart, round } = view;
  switch (phase) {
    case "intro":
      return { key: `intro-${round}`, text: "Wait for GO, then tap anywhere", desktop: " · or press Space" };
    case "steady":
      return oppFalseStart
        ? { key: `ofs-${round}`, text: `${oppName} jumped the gun — hold steady!`, tone: "hot" }
        : { key: `steady-${round}`, text: "Don't move a muscle…" };
    case "shot":
      if (!mine) return null;
      if (mine.falseStart) return { key: `fs-${round}`, text: "You jumped the gun", tone: "bad" };
      if (mine.ms === null) return { key: `miss-${round}`, text: "You never drew", tone: "bad" };
      if (!opp && live) return { key: `wait-${round}`, text: `Waiting for ${oppName}…` };
      return null;
    default:
      return null;
  }
}

function Footer({ view, oppName, live }: { view: DuelView; oppName: string; live: boolean }) {
  const verdict = view.phase === "reveal" && view.last ? describeOutcome(view.last, oppName) : null;
  const hint = verdict ? null : hintFor(view, oppName, live);
  return (
    <div className="relative z-10 flex h-[88px] w-full shrink-0 flex-col items-center justify-start px-4 pt-5 text-center [@media(max-height:560px)]:h-[72px] [@media(max-height:560px)]:pt-3">
      <AnimatePresence mode="wait" initial={false}>
        {verdict ? (
          <motion.div
            key={`verdict-${view.round}`}
            initial={{ opacity: 0, y: 18, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={spring.bouncy}
          >
            <p
              className={cn(
                "font-display text-[clamp(24px,6.5vw,34px)] font-extrabold leading-tight tracking-tight",
                verdict.tone === "win" &&
                  "bg-[linear-gradient(100deg,#fff8d6,var(--accent-from)_45%,var(--accent-to))] bg-clip-text text-transparent",
                verdict.tone === "lose" && "text-ink-100",
                verdict.tone === "even" && "text-ink-200",
              )}
            >
              {verdict.headline}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ink-300">{verdict.detail}</p>
          </motion.div>
        ) : hint ? (
          <motion.p
            key={hint.key}
            initial={{ opacity: 0, y: 8 }}
            animate={hint.tone === "hot" ? { opacity: 1, y: 0, scale: [1, 1.08, 1] } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
            transition={
              hint.tone === "hot"
                ? { scale: { duration: 0.5, repeat: Infinity }, default: spring.snappy }
                : spring.soft
            }
            className={cn(
              "mt-2 text-sm font-semibold",
              hint.tone === "hot" && "font-display text-lg font-extrabold uppercase tracking-[0.2em] text-[var(--accent-from)]",
              hint.tone === "bad" && "text-danger",
              !hint.tone && "text-ink-300",
            )}
          >
            {hint.text}
            {hint.desktop && <span className="hidden [@media(pointer:fine)]:inline">{hint.desktop}</span>}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** Screen-reader announcements for the moments that matter. */
function Announcer({ view, oppName }: { view: DuelView; oppName: string }) {
  let text = "";
  if (view.phase === "intro") text = `Round ${view.round}. Get ready.`;
  else if (view.phase === "steady") text = "Steady.";
  else if (view.phase === "draw") text = "Go! Tap now.";
  else if (view.phase === "shot" && view.mine) {
    const kind = classify(view.mine);
    text = kind === "tap" ? `${view.mine.ms} milliseconds.` : kind === "false-start" ? "Too early." : "Too slow.";
  } else if (view.phase === "reveal" && view.last) {
    text = `${describeOutcome(view.last, oppName).headline}. Score ${view.score.me} to ${view.score.opp}.`;
  }
  return (
    <p className="sr-only" aria-live="assertive">
      {text}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Pre-game                                                           */
/* ------------------------------------------------------------------ */

function Pregame({ me, opp, oppName }: { me: PlayerInfo; opp: PlayerInfo; oppName: string }) {
  return (
    <Screen className="py-4">
      <motion.div
        className="flex flex-col items-center gap-5 text-center [@media(max-height:600px)]:gap-3"
        variants={staggerChildren(0.05)}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeUp}>
          <Eyebrow>Reflex duel · first to 3</Eyebrow>
        </motion.div>
        <motion.h1
          variants={fadeUp}
          className="font-display text-[clamp(44px,13vw,72px)] font-extrabold leading-[0.9] tracking-tight"
        >
          <span className="bg-[linear-gradient(100deg,#fff8d6,var(--accent-from)_40%,var(--accent-to))] bg-clip-text text-transparent">
            Reflexes
          </span>
        </motion.h1>

        <motion.div variants={fadeUp} className="relative">
          <motion.div
            className="relative size-[clamp(112px,32vw,168px)] [@media(max-height:600px)]:size-[104px]"
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <div
              aria-hidden
              className="absolute -inset-[35%] rounded-full opacity-30"
              style={{ background: "radial-gradient(circle, var(--accent-from), var(--accent-to) 40%, transparent 70%)" }}
            />
            <SteadyFace sight />
          </motion.div>
        </motion.div>

        <motion.p variants={fadeUp} className="max-w-[19rem] text-sm leading-relaxed text-ink-300">
          Hold still while it says <b className="text-ink-50">STEADY</b>. The instant it flashes{" "}
          <b className="text-[var(--accent-from)]">GO</b>, tap. Jump early and you lose the round.
        </motion.p>

        <motion.div variants={fadeUp} className="flex items-center gap-4">
          <PregamePlayer player={me} name="You" />
          <span className="font-display text-sm font-extrabold tracking-[0.2em] text-ink-400">VS</span>
          <PregamePlayer player={opp} name={oppName} />
        </motion.div>

        <motion.p variants={fadeUp} className="text-sm font-semibold text-ink-100">
          Get ready
          <AnimatedDots />
        </motion.p>
      </motion.div>
    </Screen>
  );
}

function PregamePlayer({ player, name }: { player: PlayerInfo; name: string }) {
  return (
    <div className="flex w-24 flex-col items-center gap-1.5">
      <Avatar person={player} size={44} />
      <span className="w-full truncate text-xs font-semibold text-ink-200">{name}</span>
    </div>
  );
}
