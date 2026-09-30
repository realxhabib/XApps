"use client";

import type { StatStanding, XAppsClient } from "@xapps/sdk";
import { useXApps } from "@xapps/sdk/react";
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
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { ActionButton, AnimatedDots, Screen } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { StandingPanel, type BoardStatus } from "./board";
import { FACE, PART_LABEL, PART_ORDER } from "./face";
import { buildFaceKitWithFallback, type FaceKit } from "./kit";
import {
  PART_INTRO_MS,
  PART_MAX_MS,
  SETTLE_MS,
  buildSlides,
  dropAt,
  earnedAchievements,
  faceScore,
  formatPct,
  nextStreak,
  runStats,
  shareText,
  soloAchievements,
  verdict,
  type Drop,
} from "./logic";
import { Burst, DropPop, Feature, Ghost, PART_EMOJI, RowGuide, Stage, StepPips, toneFor, type FeatureState } from "./parts";
import { shareCardBlob } from "./share";
import { BOARD_STAT, BOARD_TOP, cleanStanding, formatCount, percentLabel, standingMoments, type Moments } from "./standing";

const TAG = "gregs-face";
const ignore = () => {};

/** A pointer/key event's time on the performance.now() clock (falls back to now). */
function eventTime(stamp: number): number {
  const now = performance.now();
  return stamp > 0 && stamp <= now && now - stamp < 1000 ? stamp : now;
}

/** Space/Enter on a focused button or link belongs to that control, not to the game. */
function onControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("button, a, input, textarea, select, [role=button]") !== null;
}

const isGo = (e: KeyboardEvent) =>
  !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && (e.code === "Space" || e.key === " " || e.key === "Enter");

/* ---------------------------------------------------------------------- */
/* The world board                                                        */
/* ---------------------------------------------------------------------- */

interface Board {
  status: BoardStatus;
  standing: StatStanding | null;
}

/** Reads the global best-face board. Never rejects: a failure comes back as status "error". */
function readBoard(xapps: XAppsClient): Promise<Board> {
  const failed = (error: unknown): Board => {
    console.warn(`[${TAG}] stats.leaderboard failed`, error);
    return { status: "error", standing: null };
  };
  try {
    return xapps.stats.leaderboard(BOARD_STAT, { limit: BOARD_TOP }).then((raw) => {
      const standing = cleanStanding(raw);
      return standing ? { status: "ready", standing } : failed(new Error("malformed standing"));
    }, failed);
  } catch (error) {
    return Promise.resolve(failed(error));
  }
}

/** What a finished face produced, for its reveal. */
interface RunResult {
  board: Board;
  moments: Moments;
  /** Your rank before this face (null: no face yet, or unknown). */
  prevRank: number | null;
  /** 90 %+ faces in a row, this one included. */
  streak: number;
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

/**
 * A solo, standalone app: open it, build Greg's face as many times as you
 * like, and see where your best face ranks worldwide. Run 0 is the title
 * screen; every "Again" mounts a fresh run with fresh slides.
 */
export function GregsFaceApp() {
  const xapps = useXApps();
  const { kit, error } = useFaceKit();
  const [run, setRun] = useState(0);
  const [board, setBoard] = useState<Board>({ status: "loading", standing: null });
  const session = useRef({ faces: 0, streak: 0 });
  const readyRef = useRef(false);

  // Optional for a standalone app (it starts nothing), but harmless and keeps a match-purpose mock happy.
  const settled = kit !== null || error !== null;
  useEffect(() => {
    if (!settled || readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((e: unknown) => console.warn(`[${TAG}] ready failed`, e));
  }, [settled, xapps]);

  // Where you stand before your first face (the title shows it; the first reveal compares against it).
  useEffect(() => {
    let alive = true;
    readBoard(xapps).then((next) => {
      if (alive) setBoard(next);
    });
    return () => {
      alive = false;
    };
  }, [xapps]);

  /** Stats → achievements → the fresh board. Never rejects. */
  const finishRun = async (drops: Drop[]): Promise<RunResult> => {
    const score = faceScore(drops);
    const before = board.status === "ready" && board.standing ? board.standing : undefined;
    const s = session.current;
    s.faces += 1;
    s.streak = nextStreak(s.streak, score);
    const streak = s.streak;
    const totals = await reportStats(xapps, runStats(drops), TAG);
    const facesBuilt = totals?.faces_built ?? s.faces;
    unlockAchievements(xapps, [...earnedAchievements(drops), ...soloAchievements({ facesBuilt, streak })], TAG);
    const after = await readBoard(xapps);
    setBoard(after);
    return {
      board: after,
      moments: standingMoments(before, after.standing, score),
      prevRank: before?.me?.rank ?? null,
      streak,
    };
  };

  const start = () => {
    if (!kit) return;
    play("go");
    setRun((n) => n + 1);
  };

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {run > 0 && kit ? (
          <motion.div
            key={`run-${run}`}
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.2 }}
          >
            <Run kit={kit} run={run} onFinish={finishRun} onAgain={start} />
          </motion.div>
        ) : (
          <motion.div
            key="title"
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0, scale: 1.06, filter: "blur(12px)" }}
            transition={{ duration: 0.3, ease: ease.inOutQuart }}
          >
            <Title kit={kit} error={error} board={board} onStart={start} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Title                                                                  */
/* ---------------------------------------------------------------------- */

function Title({
  kit,
  error,
  board,
  onStart,
}: {
  kit: FaceKit | null;
  error: string | null;
  board: Board;
  onStart: () => void;
}) {
  const xapps = useXApps();
  const reduced = useReducedMotion() ?? false;
  const face = kit?.face ?? FACE;
  const mine = board.standing?.me ?? null;

  const status = mine ? `Best ${formatPct(mine.value)} · #${formatCount(mine.rank)}` : "";
  useEffect(() => {
    xapps.ui.setStatus(status).catch(ignore);
  }, [xapps, status]);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!isGo(e) || onControl(e.target) || !kit) return;
    e.preventDefault();
    onStart();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
          <Stage face={face} src={kit?.photoUrl ?? face.src} maxVh={34} className="max-w-[300px]" />
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

      <BoardTeaser board={board} reduced={reduced} />

      {error ? (
        <p className="text-sm text-danger">Couldn&apos;t load {face.name}&apos;s face. Try reloading.</p>
      ) : (
        <motion.div
          className="flex flex-col items-center gap-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 0.3 }}
        >
          <ActionButton onClick={onStart} disabled={!kit} className="min-w-52 px-10 text-lg">
            {kit ? (
              "Build his face"
            ) : (
              <>
                Warming up
                <AnimatedDots />
              </>
            )}
          </ActionButton>
          <p className="hidden text-xs text-ink-400 sm:block">or press Space</p>
        </motion.div>
      )}
    </Screen>
  );
}

/** One line on the title: your best and rank, or how busy the board is. */
function BoardTeaser({ board, reduced }: { board: Board; reduced: boolean }) {
  const { status, standing } = board;
  let line: React.ReactNode = null;
  if (status === "loading") {
    line = (
      <span className="text-ink-300">
        Checking the world board
        <AnimatedDots />
      </span>
    );
  } else if (standing?.me) {
    const percent = percentLabel(standing.me.rank, standing.total);
    line = (
      <>
        <span className="text-ink-300">Your best</span>{" "}
        <b className="font-mono tabular" style={{ color: toneFor(standing.me.value) }}>
          {formatPct(standing.me.value)}
        </b>
        <span className="text-ink-500"> · </span>
        <b className="tabular text-ink-50">#{formatCount(standing.me.rank)}</b>
        <span className="text-ink-300"> of {formatCount(standing.total)}</span>
        {percent && <span className="ml-2 rounded-full bg-white/[0.08] px-2 py-0.5 text-xs font-bold text-ink-100">{percent}</span>}
      </>
    );
  } else if (standing && standing.total > 0 && standing.top[0]) {
    line = (
      <span className="text-ink-300">
        <b className="text-ink-50">{formatCount(standing.total)}</b> {standing.total === 1 ? "player" : "players"} on the world board · the
        best face is <b className="font-mono tabular text-ink-50">{formatPct(standing.top[0].value)}</b>
      </span>
    );
  } else if (standing) {
    line = <span className="text-ink-300">Nobody&apos;s on the world board yet. Be the first 🌍</span>;
  }
  return (
    <div className="flex min-h-9 items-center justify-center">
      <AnimatePresence mode="wait" initial={false}>
        {line && (
          <motion.p
            key={status}
            className="glass rounded-full px-4 py-2 text-sm"
            initial={reduced ? false : { opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={spring.bouncy}
          >
            {line}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* A run                                                                  */
/* ---------------------------------------------------------------------- */

type Phase = "intro" | "moving" | "dropped" | "reveal";

function Run({
  kit,
  run,
  onFinish,
  onAgain,
}: {
  kit: FaceKit;
  run: number;
  onFinish: (drops: Drop[]) => Promise<RunResult>;
  onAgain: () => void;
}) {
  const xapps = useXApps();
  const reduced = useReducedMotion() ?? false;
  const { face } = kit;
  // Fresh slides every run: the app's random is seeded per open, forked per run.
  const slides = useMemo(() => buildSlides(xapps.random.fork(`run:${run}`)), [xapps, run]);

  const [part, setPart] = useState(0);
  const [phase, setPhase] = useState<Phase>("intro");
  const [startAt, setStartAt] = useState(0);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [revealStep, setRevealStep] = useState(0);
  const [result, setResult] = useState<RunResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [sharing, setSharing] = useState<"idle" | "busy" | "done">("idle");
  const [stageScope, animateStage] = useAnimate<HTMLDivElement>();
  // What event handlers read synchronously (state lags a render behind).
  const live = useRef({ phase: "intro" as Phase, part: 0, startAt: 0, drops: [] as Drop[] });

  const partId = PART_ORDER[part]!;
  const shown = phase === "reveal" && revealStep >= 4;

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

  /* Reveal: ghosts one by one, then the score, then the world board ------ */

  const finished = useRef(false);
  const finish = useEffectEvent(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish(live.current.drops).then(setResult);
  });
  useEffect(() => {
    if (phase !== "reveal") return;
    finish();
    const gap = reduced ? 120 : 520;
    const timers = [1, 2, 3, 4].map((step) =>
      setTimeout(
        () => {
          setRevealStep(step);
          play(step < 4 ? "pop" : "slam");
          if (step === 4 && faceScore(live.current.drops) >= 90) {
            play("win");
            xapps.ui.celebrate().catch(ignore);
          }
        },
        (reduced ? 100 : 450) + step * gap,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [phase, reduced, xapps]);

  // The board's moments land once both the score and the fresh standing are in.
  const cheered = useRef(false);
  useEffect(() => {
    if (!shown || !result || cheered.current) return;
    cheered.current = true;
    const { newBest, climbed } = result.moments;
    if (!newBest && climbed === 0) return;
    const id = setTimeout(() => {
      play(newBest ? "achievement" : "notify");
      xapps.ui.haptic("success").catch(ignore);
    }, 550);
    return () => clearTimeout(id);
  }, [shown, result, xapps]);

  const retryBoard = () => {
    if (retrying) return;
    setRetrying(true);
    readBoard(xapps).then((board) => {
      setRetrying(false);
      setResult((prev) => (prev ? { ...prev, board } : prev));
    });
  };

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
    if (!isGo(e)) return;
    const s = live.current;
    if (s.phase === "moving") {
      e.preventDefault();
      dropNow(eventTime(e.timeStamp) - s.startAt, false);
    } else if (s.phase === "intro" || s.phase === "dropped") {
      e.preventDefault();
    } else if (shown && !onControl(e.target)) {
      e.preventDefault();
      onAgain();
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* Host status line ------------------------------------------------------ */

  const mine = result?.board.standing?.me ?? null;
  const statusText =
    phase !== "reveal"
      ? `${PART_EMOJI[partId]} ${PART_LABEL[partId]} · ${part + 1} of ${PART_ORDER.length}`
      : mine
        ? `Best ${formatPct(mine.value)} · #${formatCount(mine.rank)}`
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
      {/* On phones the reveal's own part chips replace the pips, to leave room for the board. */}
      <header className={cn("flex shrink-0 flex-col items-center gap-2 px-4 pt-3", shown && "max-md:hidden")}>
        <StepPips current={part} drops={drops} />
      </header>

      <motion.main
        layoutScroll
        className={cn(
          "relative flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-4 py-3",
          shown ? "[--stage-h:28dvh] md:[--stage-h:50dvh]" : "[--stage-h:48dvh]",
        )}
      >
        <div className="my-auto flex w-full max-w-4xl flex-col items-center gap-4 md:flex-row md:justify-center md:gap-10">
          <motion.div
            layout="position"
            transition={spring.soft}
            className="flex w-full min-w-0 flex-col items-center gap-3 md:max-w-[460px] md:flex-1"
          >
            <div ref={stageScope} className="relative w-full">
              <Stage
                face={face}
                src={kit.blankUrl}
                maxVh="var(--stage-h)"
                className="transition-[width] duration-500 ease-out motion-reduce:transition-none"
              >
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
                {phase === "dropped" && lastDrop?.perfect && !reduced && (
                  <Burst key={`b-${lastDrop.part}`} face={face} drop={lastDrop} />
                )}
              </Stage>
              <Announcer part={phase === "intro" ? partId : null} />
            </div>

            {phase === "reveal" ? (
              <RevealScore drops={drops} step={revealStep} streak={result?.streak ?? 0} reduced={reduced} />
            ) : (
              <Hint moving={phase === "moving"} />
            )}
          </motion.div>

          {shown && (
            <StandingPanel
              status={retrying ? "loading" : (result?.board.status ?? "loading")}
              standing={result?.board.standing ?? null}
              moments={result?.moments ?? null}
              prevRank={result?.prevRank ?? null}
              me={{ id: xapps.me.id, handle: xapps.me.handle, name: xapps.me.name, avatarUrl: xapps.me.avatarUrl }}
              onRetry={retryBoard}
              reduced={reduced}
              className="md:w-[360px] md:shrink-0"
            />
          )}
        </div>
      </motion.main>

      <footer className="flex min-h-[calc(3.5rem+0.75rem)] shrink-0 items-center justify-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <AnimatePresence>
          {shown && (
            <motion.div
              className="flex items-center gap-3"
              initial={reduced ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 0.3 }}
            >
              <ActionButton tone="ghost" onClick={share} disabled={sharing === "busy"} className="px-6">
                {sharing === "busy" ? "Sharing…" : sharing === "done" ? "Shared ✓" : "Share"}
              </ActionButton>
              <ActionButton onClick={onAgain} className="px-9">
                ↻ Again
              </ActionButton>
            </motion.div>
          )}
        </AnimatePresence>
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

function RevealScore({ drops, step, streak, reduced }: { drops: Drop[]; step: number; streak: number; reduced: boolean }) {
  const score = faceScore(drops);
  const v = verdict(score);
  const shown = step >= 4;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-2 text-center">
      <motion.p
        className="font-display text-[clamp(40px,12vw,64px)] font-extrabold leading-none tracking-tight tabular"
        style={{ color: shown ? toneFor(score) : "var(--color-ink-50)" }}
        animate={shown && !reduced ? { scale: [1, 1.18, 1] } : { scale: 1 }}
        transition={{ duration: 0.5, delay: 1 }}
      >
        <CountUp value={score} run={shown} />
      </motion.p>
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
        <AnimatePresence>
          {shown && streak >= 2 && (
            <motion.span
              key="streak"
              className="rounded-full bg-gold/15 px-3 py-1.5 text-sm font-bold text-gold ring-1 ring-gold/40"
              initial={reduced ? false : { opacity: 0, scale: 0.4, rotate: -8 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ ...spring.wobbly, delay: 0.6 }}
            >
              🔥 {streak} in a row
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
