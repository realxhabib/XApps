"use client";

import { useMatchResult, useMatchStarted, usePlayers, useXApps } from "@xapps/sdk/react";
import {
  AnimatePresence,
  animate,
  motion,
  useAnimate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { ActionButton, AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { FACE, PART_LABEL, PART_ORDER } from "./face";
import { buildFaceKitWithFallback, type FaceKit } from "./kit";
import {
  DROP_EVENT,
  PART_INTRO_MS,
  PART_MAX_MS,
  SETTLE_MS,
  buildSlides,
  dropAt,
  earnedAchievements,
  faceScore,
  formatPct,
  resultProgress,
  runStats,
  runningScore,
  shareText,
  submission,
  verdict,
  type Drop,
  type Slides,
} from "./logic";
import {
  Burst,
  DropPop,
  Feature,
  Ghost,
  PART_EMOJI,
  RowGuide,
  Stage,
  StepPips,
  TableStrip,
  playerName,
  toneFor,
  type FeatureState,
  type TableRow,
} from "./parts";
import { shareCardBlob } from "./share";
import { useTable } from "./table";

const TAG = "gregs-face";
const ignore = () => {};
/** The reveal waits this long for "Lock in" before submitting by itself. */
const LOCK_IN_MS = 12_000;
/** Stage height cap, in % of the viewport height. */
const STAGE_VH = 48;

/** A pointer/key event's time on the performance.now() clock (falls back to now). */
function eventTime(stamp: number): number {
  const now = performance.now();
  return stamp > 0 && stamp <= now && now - stamp < 1000 ? stamp : now;
}

/* ---------------------------------------------------------------------- */
/* Root                                                                   */
/* ---------------------------------------------------------------------- */

/** Loads the portrait and builds the blank face + sprites (falls back to the stand-in). */
function useFaceKit(): { kit: FaceKit | null; error: string | null } {
  const [state, setState] = useState<{ kit: FaceKit | null; error: string | null }>({ kit: null, error: null });
  useEffect(() => {
    let alive = true;
    let built: FaceKit | null = null;
    buildFaceKitWithFallback(FACE).then(
      (kit) => {
        built = kit;
        if (alive) setState({ kit, error: null });
        else kit.dispose();
      },
      (error: unknown) => {
        console.warn(`[${TAG}] couldn't build the face`, error);
        if (alive) setState({ kit: null, error: error instanceof Error ? error.message : "Couldn't load the face" });
      },
    );
    return () => {
      alive = false;
      built?.dispose();
    };
  }, []);
  return state;
}

export function GregsFaceApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const { kit, error } = useFaceKit();
  const readyRef = useRef(false);

  // Ready once the face is built (or failed), so the countdown never beats the assets.
  const settled = kit !== null || error !== null;
  useEffect(() => {
    if (!settled || readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((e: unknown) => console.warn(`[${TAG}] ready failed`, e));
  }, [settled, xapps]);

  useEffect(() => {
    if (!started) xapps.ui.setStatus("Get ready").catch(ignore);
  }, [started, xapps]);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {started && kit ? (
          <motion.div
            key="game"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Game kit={kit} />
          </motion.div>
        ) : (
          <motion.div
            key="lobby"
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0, scale: 1.06, filter: "blur(12px)" }}
            transition={{ duration: 0.3, ease: ease.inOutQuart }}
          >
            <PreGame kit={kit} error={error} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Pre-game                                                               */
/* ---------------------------------------------------------------------- */

function PreGame({ kit, error }: { kit: FaceKit | null; error: string | null }) {
  const { opponents } = usePlayers();
  const reduced = useReducedMotion() ?? false;
  const face = kit?.face ?? FACE;

  return (
    <Screen className="gap-5 text-center">
      <motion.div
        className="w-full"
        initial={reduced ? false : { opacity: 0, scale: 0.8, rotate: -4 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={spring.bouncy}
      >
        <motion.div
          animate={reduced ? undefined : { y: [0, -8, 0], rotate: [0, -1.5, 1.5, 0] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Stage face={face} src={kit?.photoUrl ?? face.src} maxVh={36} className="max-w-[300px]" />
        </motion.div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.2 }}>
        <h1 className="font-display text-5xl font-extrabold tracking-tight [font-stretch:92%] sm:text-6xl">
          {face.name}&apos;s{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">
            Face
          </span>
        </h1>
        <p className="mt-2 text-balance text-sm text-ink-300 sm:text-base">
          {PART_ORDER.map((p) => PART_EMOJI[p]).join(" ")} Drop his eyes, nose and mouth back where they belong
        </p>
      </motion.div>

      {opponents.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring.bouncy, delay: 0.35 }}
          className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm"
        >
          <span className="flex -space-x-2">
            {opponents.slice(0, 5).map((p) => (
              <span key={p.id} className="rounded-full ring-2 ring-ink-950">
                <Avatar person={p} size={28} />
              </span>
            ))}
          </span>
          <span className="text-ink-200">
            vs{" "}
            <b className="text-ink-50">
              {opponents.length === 1 ? playerName(opponents[0]!) : `${opponents.length} players`}
            </b>
          </span>
        </motion.div>
      )}

      {error ? (
        <p className="text-sm text-danger">Couldn&apos;t load {face.name}&apos;s face. Try reloading.</p>
      ) : (
        <Eyebrow>
          {kit ? "Get ready" : "Warming up the face"}
          <AnimatedDots />
        </Eyebrow>
      )}
    </Screen>
  );
}

/* ---------------------------------------------------------------------- */
/* Game                                                                   */
/* ---------------------------------------------------------------------- */

function Game({ kit }: { kit: FaceKit }) {
  const xapps = useXApps();
  const { isSpectator } = usePlayers();
  // Forks of the shared seed only → identical for everyone at the table.
  const slides = useMemo(() => buildSlides(xapps.random), [xapps]);
  const rows = useTable(kit.face, slides);
  if (isSpectator) return <Watch kit={kit} rows={rows} />;
  return <Play kit={kit} slides={slides} rows={rows} />;
}

type Phase = "intro" | "moving" | "dropped" | "reveal";
type Lock = "open" | "sending" | "done" | "error";

function Play({ kit, slides, rows }: { kit: FaceKit; slides: Slides; rows: TableRow[] }) {
  const xapps = useXApps();
  const reduced = useReducedMotion() ?? false;
  const result = useMatchResult();
  const { face } = kit;

  const [part, setPart] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [startAt, setStartAt] = useState(0);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [revealStep, setRevealStep] = useState(0);
  const [lock, setLock] = useState<Lock>("open");
  const [sharing, setSharing] = useState<"idle" | "busy" | "done">("idle");
  const [stageScope, animateStage] = useAnimate<HTMLDivElement>();
  // What event handlers read synchronously (state lags a render behind).
  const live = useRef({ phase: "intro" as Phase, part: 0, startAt: 0, drops: [] as Drop[], locked: false });

  const partId = PART_ORDER[part]!;
  const score = phase === "reveal" ? faceScore(drops) : runningScore(drops);

  /* Flow: intro → moving → dropped → (next part | reveal) ---------------- */

  const startMoving = useEffectEvent(() => {
    const now = performance.now();
    live.current.phase = "moving";
    live.current.startAt = now;
    setStartAt(now);
    setPhase("moving");
  });
  useEffect(() => {
    if (phase !== "intro") return;
    play("whoosh");
    const id = setTimeout(startMoving, PART_INTRO_MS);
    return () => clearTimeout(id);
  }, [phase, part]);

  const feedback = (drop: Drop, all: Drop[]) => {
    play("thump");
    if (drop.perfect) play("slam");
    if (drop.accuracy >= 85) play("vote");
    else if (drop.accuracy < 45) play("error");
    xapps.ui
      .haptic(drop.perfect ? "success" : drop.accuracy >= 85 ? "medium" : drop.accuracy < 45 ? "error" : "light")
      .catch(ignore);
    const el = stageScope.current;
    if (el && !reduced) {
      if (drop.accuracy < 45) animateStage(el, { x: [0, -10, 8, -5, 3, 0], rotate: [0, -1, 1, 0] }, { duration: 0.45 });
      else if (drop.perfect) animateStage(el, { scale: [1, 1.035, 1] }, { duration: 0.4, ease: "easeOut" });
      else animateStage(el, { y: [0, 4, 0] }, { duration: 0.22, ease: "easeOut" });
    }
    if (xapps.match.mode === "live" && xapps.opponents.some((p) => !p.isBot)) {
      xapps.room
        .send(DROP_EVENT, { part: drop.part, accuracy: drop.accuracy })
        .catch((e: unknown) => console.warn(`[${TAG}] broadcast failed`, e));
    }
    unlockAchievements(xapps, earnedAchievements(all), TAG);
  };

  const dropNow = (tMs: number, auto: boolean) => {
    const s = live.current;
    if (s.phase !== "moving") return;
    const drop = dropAt(face, slides, PART_ORDER[s.part]!, tMs, auto);
    s.phase = "dropped";
    s.drops = [...s.drops, drop];
    setDrops(s.drops);
    setPhase("dropped");
    feedback(drop, s.drops);
  };

  const autoDrop = useEffectEvent(() => dropNow(PART_MAX_MS, true));
  useEffect(() => {
    if (phase !== "moving") return;
    const id = setTimeout(autoDrop, Math.max(0, startAt + PART_MAX_MS - performance.now()));
    return () => clearTimeout(id);
  }, [phase, startAt]);

  const advance = useEffectEvent(() => {
    const s = live.current;
    if (s.drops.length < PART_ORDER.length) {
      s.part += 1;
      s.phase = "intro";
      setPart(s.part);
      setPhase("intro");
    } else {
      s.phase = "reveal";
      setPhase("reveal");
    }
  });
  useEffect(() => {
    if (phase !== "dropped") return;
    const id = setTimeout(advance, SETTLE_MS);
    return () => clearTimeout(id);
  }, [phase, part]);

  /* Reveal: ghosts one by one, then the score --------------------------- */

  const reported = useRef(false);
  const reportRun = useEffectEvent(() => {
    if (reported.current) return;
    reported.current = true;
    reportStats(xapps, runStats(live.current.drops), TAG);
    unlockAchievements(xapps, earnedAchievements(live.current.drops), TAG);
  });
  useEffect(() => {
    if (phase !== "reveal") return;
    reportRun();
    const gap = reduced ? 120 : 520;
    const timers = [1, 2, 3, 4].map((step) =>
      setTimeout(
        () => {
          setRevealStep(step);
          play(step < 4 ? "pop" : "slam");
          if (step === 4) {
            const final = faceScore(live.current.drops);
            if (final >= 90) {
              play("win");
              xapps.ui.celebrate().catch(ignore);
            }
          }
        },
        (reduced ? 100 : 450) + step * gap,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, reduced, xapps]);

  const lockIn = () => {
    const s = live.current;
    if (s.locked || s.drops.length < PART_ORDER.length) return;
    s.locked = true;
    setLock("sending");
    play("pop");
    xapps.submit(submission(s.drops)).then(
      () => setLock("done"),
      (e: unknown) => {
        console.warn(`[${TAG}] submit failed`, e);
        s.locked = false;
        setLock("error");
      },
    );
  };
  const autoLock = useEffectEvent(() => lockIn());
  useEffect(() => {
    if (revealStep < 4 || lock !== "open") return;
    const id = setTimeout(autoLock, LOCK_IN_MS);
    return () => clearTimeout(id);
  }, [revealStep, lock]);

  const share = async () => {
    if (sharing === "busy") return;
    setSharing("busy");
    play("pop");
    const all = live.current.drops;
    const final = faceScore(all);
    let url: string | undefined;
    try {
      const blob = await shareCardBlob(kit, all, final, { name: face.name, handle: xapps.me.handle });
      const media = await xapps.media.upload(blob, { alt: `${face.name}'s face, rebuilt ${formatPct(final)} right` });
      if (/^https?:\/\//i.test(media.url)) url = media.url;
    } catch (e) {
      console.warn(`[${TAG}] share card upload failed`, e);
    }
    try {
      await xapps.social.share(shareText(final, face.name), url);
      unlockAchievements(xapps, ["show_and_tell"], TAG);
      setSharing("done");
    } catch (e) {
      console.warn(`[${TAG}] share failed`, e);
      setSharing("idle");
    }
  };

  /* Input ----------------------------------------------------------------- */

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (live.current.phase !== "moving") return;
    dropNow(eventTime(e.timeStamp) - live.current.startAt, false);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code !== "Space" && e.key !== " " && e.key !== "Enter") return;
    const s = live.current;
    if (s.phase === "moving") {
      e.preventDefault();
      dropNow(eventTime(e.timeStamp) - s.startAt, false);
    } else if (s.phase === "intro" || s.phase === "dropped") {
      e.preventDefault();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* Progress from the settled match; host HUD ----------------------------- */

  const [settledAtOpen] = useState(() => xapps.finalResult !== null);
  const resultCounted = useRef(false);
  useEffect(() => {
    if (!result || settledAtOpen || resultCounted.current) return;
    resultCounted.current = true;
    const progress = resultProgress(result, xapps.me.id);
    reportStats(xapps, progress.stats, TAG);
    unlockAchievements(xapps, progress.achievements, TAG);
  }, [result, settledAtOpen, xapps]);

  const meId = xapps.me.id;
  const scoresKey = rows.map((r) => `${r.player.id}:${r.score ?? ""}`).join("|");
  useEffect(() => {
    // Whole percents in the HUD while playing (the settled results keep the decimal).
    const scores: Record<string, number> = { [meId]: Math.round(score) };
    for (const entry of scoresKey.split("|")) {
      const [id, value] = entry.split(":");
      if (id && value) scores[id] = Math.round(Number(value));
    }
    xapps.ui.setScores(scores).catch(ignore);
  }, [xapps, meId, score, scoresKey]);

  const waitingOn = rows.filter((r) => !r.done);
  const statusText =
    phase !== "reveal"
      ? `${PART_EMOJI[partId]} ${PART_LABEL[partId]} · ${part + 1} of ${PART_ORDER.length}`
      : lock === "done" && waitingOn.length > 0
        ? waitingOn.length === 1
          ? `Waiting for ${playerName(waitingOn[0]!.player)}`
          : `Waiting for ${waitingOn.length} players`
        : `Your face · ${formatPct(faceScore(drops))}`;
  useEffect(() => {
    xapps.ui.setStatus(statusText).catch(ignore);
  }, [xapps, statusText]);

  /* Render ---------------------------------------------------------------- */

  const lastDrop = drops[drops.length - 1];
  const featureState = (i: number): FeatureState => {
    if (phase === "reveal") return "reveal";
    if (i < part) return "placed";
    return phase;
  };

  return (
    <div
      className="relative flex h-dvh w-full touch-manipulation select-none flex-col overflow-hidden [-webkit-touch-callout:none]"
      data-phase={phase}
      data-part={partId}
      onPointerDown={onPointerDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <header className="flex shrink-0 flex-col items-center gap-2 px-4 pt-3">
        <StepPips current={part} drops={drops} />
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-4 py-3">
        <div ref={stageScope} className="relative w-full">
          <Stage face={face} src={kit.blankUrl} maxVh={STAGE_VH}>
            <AnimatePresence>
              {(phase === "intro" || phase === "moving") && <RowGuide key={partId} face={face} part={partId} />}
            </AnimatePresence>
            {PART_ORDER.map((id, i) =>
              i > part ? null : (
                <Feature
                  key={id}
                  kit={kit}
                  part={id}
                  slide={slides[id]}
                  state={featureState(i)}
                  startAt={startAt}
                  drop={drops.find((d) => d.part === id) ?? null}
                  reduced={reduced}
                  order={i}
                  onBounce={() => play("tick")}
                />
              ),
            )}
            {phase === "reveal" &&
              drops.map((d, i) => (revealStep > i ? <Ghost key={d.part} kit={kit} drop={d} reduced={reduced} /> : null))}
            <AnimatePresence>
              {phase === "dropped" && lastDrop && <DropPop key={lastDrop.part} face={face} drop={lastDrop} />}
            </AnimatePresence>
            {phase === "dropped" && lastDrop?.perfect && !reduced && <Burst key={`b-${lastDrop.part}`} face={face} drop={lastDrop} />}
          </Stage>
          <Announcer part={phase === "intro" ? partId : null} />
        </div>

        {phase === "reveal" ? (
          <RevealPanel
            drops={drops}
            step={revealStep}
            lock={lock}
            sharing={sharing}
            result={result}
            meId={meId}
            waiting={waitingOn.length}
            onLock={lockIn}
            onShare={share}
            reduced={reduced}
          />
        ) : (
          <Hint moving={phase === "moving"} />
        )}
      </main>

      <footer className="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <TableStrip rows={rows} />
      </footer>
    </div>
  );
}

/** "EYES!" slamming in over the face when a new feature comes up. */
function Announcer({ part }: { part: (typeof PART_ORDER)[number] | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
      <AnimatePresence>
        {part && (
          <motion.p
            key={part}
            className="font-display text-[clamp(44px,14vw,84px)] font-extrabold uppercase italic tracking-tight text-ink-50 [text-shadow:0_6px_30px_rgb(0_0_0/0.6)]"
            initial={{ opacity: 0, scale: 2.2, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: -4 }}
            exit={{ opacity: 0, scale: 0.7, y: -30 }}
            transition={spring.bouncy}
          >
            {PART_LABEL[part]}!
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

function Hint({ moving }: { moving: boolean }) {
  return (
    <motion.div
      className="flex items-center gap-2 text-sm text-ink-300"
      animate={{ opacity: moving ? 1 : 0.5 }}
      transition={{ duration: 0.2 }}
    >
      <motion.span
        className="rounded-md border border-white/20 bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] font-bold text-ink-100"
        animate={moving ? { y: [0, 2, 0] } : { y: 0 }}
        transition={moving ? { duration: 0.8, repeat: Infinity } : { duration: 0.2 }}
      >
        SPACE
      </motion.span>
      <span>or tap anywhere to drop</span>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Reveal                                                                 */
/* ---------------------------------------------------------------------- */

function CountUp({ value, run }: { value: number; run: boolean }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => `${v.toFixed(1)}%`);
  useEffect(() => {
    if (!run) return;
    const controls = animate(mv, value, { duration: 1.1, ease: ease.outExpo });
    return () => controls.stop();
  }, [run, value, mv]);
  return <motion.span>{text}</motion.span>;
}

function RevealPanel({
  drops,
  step,
  lock,
  sharing,
  result,
  meId,
  waiting,
  onLock,
  onShare,
  reduced,
}: {
  drops: Drop[];
  step: number;
  lock: Lock;
  sharing: "idle" | "busy" | "done";
  result: ReturnType<typeof useMatchResult>;
  meId: string;
  waiting: number;
  onLock: () => void;
  onShare: () => void;
  reduced: boolean;
}) {
  const score = faceScore(drops);
  const v = verdict(score);
  const shown = step >= 4;
  const rank = result?.ranks?.[meId];

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
      <div className="flex items-end justify-center gap-3">
        <motion.p
          className="font-display text-[clamp(44px,13vw,64px)] font-extrabold leading-none tracking-tight tabular"
          style={{ color: shown ? toneFor(score) : "var(--color-ink-50)" }}
          animate={shown && !reduced ? { scale: [1, 1.18, 1] } : { scale: 1 }}
          transition={{ duration: 0.5, delay: 1 }}
        >
          <CountUp value={score} run={shown} />
        </motion.p>
      </div>
      <div className="h-7">
        <AnimatePresence>
          {shown && (
            <motion.p
              className="font-display text-xl font-extrabold tracking-tight text-ink-50"
              initial={reduced ? false : { opacity: 0, scale: 1.8, rotate: -6, filter: "blur(10px)" }}
              animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
              transition={{ ...spring.wobbly, filter: { duration: 0.3 } }}
            >
              {v.title} <span className="font-normal">{v.emoji}</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {drops.map((d, i) => (
          <motion.span
            key={d.part}
            className="flex items-center gap-1.5 rounded-full bg-white/[0.07] px-3 py-1.5 text-sm font-bold ring-1 ring-white/10"
            initial={false}
            animate={step > i ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.5, y: 8 }}
            transition={spring.bouncy}
          >
            <span>{PART_EMOJI[d.part]}</span>
            <span className="font-mono tabular" style={{ color: toneFor(d.accuracy) }}>
              {d.perfect ? "100% 🎯" : formatPct(d.accuracy)}
            </span>
          </motion.span>
        ))}
      </div>

      <motion.div
        className="flex min-h-14 w-full items-center justify-center gap-3"
        initial={false}
        animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
        transition={{ ...spring.soft, delay: shown ? 0.5 : 0 }}
        style={{ pointerEvents: shown ? "auto" : "none" }}
      >
        <ActionButton tone="ghost" onClick={onShare} disabled={sharing === "busy"} className="px-6">
          {sharing === "busy" ? "Sharing…" : sharing === "done" ? "Shared ✓" : "Share"}
        </ActionButton>
        {lock === "done" ? (
          <p className="text-sm text-ink-300">
            {result ? (
              <span className="font-semibold text-success">
                {rank === 1 ? "You win! 🏆" : rank ? `You placed #${rank}` : "✓ Result locked in"}
              </span>
            ) : waiting > 0 ? (
              <>
                Locked in · waiting
                <AnimatedDots />
              </>
            ) : (
              <>
                Locked in
                <AnimatedDots />
              </>
            )}
          </p>
        ) : (
          <ActionButton onClick={onLock} disabled={lock === "sending"} className="relative overflow-hidden px-7">
            {shown && lock === "open" && !reduced && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-white/30"
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: LOCK_IN_MS / 1000, ease: "linear", delay: 0.5 }}
              />
            )}
            <span className="relative">{lock === "error" ? "Retry lock in" : lock === "sending" ? "Locking…" : "Lock it in"}</span>
          </ActionButton>
        )}
      </motion.div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Spectators                                                             */
/* ---------------------------------------------------------------------- */

function Watch({ kit, rows }: { kit: FaceKit; rows: TableRow[] }) {
  const xapps = useXApps();
  useEffect(() => {
    xapps.ui.setStatus("Watching").catch(ignore);
  }, [xapps]);
  const leader = rows.filter((r) => r.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  return (
    <Screen className="gap-5 text-center">
      <Stage face={kit.face} src={kit.photoUrl} maxVh={40} />
      <div>
        <Eyebrow>Watching</Eyebrow>
        <p className="mt-1 text-sm text-ink-300">
          {leader ? (
            <>
              {playerName(leader.player)} leads with{" "}
              <b className={cn("font-mono tabular text-ink-50")}>{formatPct(Math.round(leader.score ?? 0))}</b>
            </>
          ) : (
            <>
              Everyone is rebuilding {kit.face.name}
              <AnimatedDots />
            </>
          )}
        </p>
      </div>
      <TableStrip rows={rows} />
    </Screen>
  );
}
