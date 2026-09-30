"use client";

import type { MatchResult } from "@xapps/sdk";
import { useMatch, useMatchResult, useMatchStarted, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useCountdown, useTimeouts } from "@/first-party/shared/hooks";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { AnimatedDots, Eyebrow, Screen, TimerRing } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { getOfficialApp } from "@/platform/catalog";
import { Board, type InkState } from "./board";
import { CARD_PATH, circleSvg, encodeCard, shareText } from "./card";
import {
  ATTEMPTS,
  ATTEMPT_EVENT,
  EMPTY_RUN,
  MATCH_MS,
  PERFECT,
  SUPERB,
  attemptsLeft,
  bestScore,
  earnedAchievements,
  formatAccuracy,
  recordStroke,
  resultProgress,
  runStats,
  toWire,
  type Analysis,
  type Rejection,
  type Run,
} from "./logic";
import { AttemptPips, RejectOverlay, ScoreOverlay, ShareSheet, Standings, TableStrip, type Standing } from "./parts";
import { useTable, type TableRow } from "./table";

const TAG = "perfect-circle";
const ignore = () => {};
const ACCENT = (getOfficialApp("perfect-circle")?.accent ?? ["#ffcf3d", "#34e89e"]) as [string, string];

/* ---------------------------------------------------------------------- */
/* Root                                                                   */
/* ---------------------------------------------------------------------- */

export function PerfectCircle() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const readyRef = useRef(false);

  useEffect(() => {
    // Exactly once, even under StrictMode's double effects.
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn(`[${TAG}] ready failed`, error));
  }, [xapps]);

  useEffect(() => {
    if (!started) xapps.ui.setStatus("Get ready").catch(ignore);
  }, [started, xapps]);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <AnimatePresence mode="wait">
        {started ? (
          <motion.div
            key="game"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Game />
          </motion.div>
        ) : (
          <motion.div
            key="lobby"
            className="flex min-h-0 flex-1 flex-col"
            exit={{ opacity: 0, scale: 1.06, filter: "blur(12px)" }}
            transition={{ duration: 0.3, ease: ease.inOutQuart }}
          >
            <PreGame />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Pre-game                                                               */
/* ---------------------------------------------------------------------- */

function HeroCircle() {
  const reduce = useReducedMotion();
  return (
    <div className="relative size-[clamp(120px,34vmin,190px)]" aria-hidden>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90 overflow-visible">
        <defs>
          <linearGradient id="pc-hero" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff4d5e" />
            <stop offset="0.5" stopColor="#ffc93d" />
            <stop offset="1" stopColor="#37e39b" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth="1" strokeDasharray="2 3" />
        <motion.path
          d="M 92 50 C 92 74 73 92.5 50 92 C 26 91.5 8.5 73 8 50.5 C 7.5 27 26.5 8.3 50.5 8 C 74 7.7 92.2 26 92 49"
          fill="none"
          stroke="url(#pc-hero)"
          strokeWidth="4.5"
          strokeLinecap="round"
          style={{ filter: "drop-shadow(0 0 6px rgb(55 227 155 / 0.5))" }}
          initial={{ pathLength: reduce ? 1 : 0 }}
          animate={reduce ? { pathLength: 1 } : { pathLength: [0, 1, 1, 0], opacity: [1, 1, 1, 0] }}
          transition={reduce ? { duration: 0 } : { duration: 3.2, times: [0, 0.45, 0.85, 1], repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
      <motion.span
        className="absolute left-1/2 top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-50 shadow-[0_0_16px_rgb(255_255_255/0.8)]"
        animate={reduce ? undefined : { scale: [1, 1.4, 1] }}
        transition={{ duration: 1.6, repeat: Infinity }}
      />
    </div>
  );
}

function PreGame() {
  const xapps = useXApps();
  const match = useMatch();
  const others = match.players.filter((p) => p.id !== xapps.me.id && p.role !== "spectator");
  const toBeat = others.reduce<number | null>(
    (best, p) => (p.submitted && typeof p.score === "number" && (best === null || p.score > best) ? p.score : best),
    null,
  );

  return (
    <Screen className="gap-6 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.6, rotate: -40 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={spring.wobbly}>
        <HeroCircle />
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.25 }}>
        <h1 className="font-display text-5xl font-extrabold tracking-tight [font-stretch:92%] sm:text-6xl">
          Perfect{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">
            Circle
          </span>
        </h1>
        <p className="mt-2 text-balance text-sm text-ink-300 sm:text-base">
          One stroke around the dot · {ATTEMPTS} tries · best circle counts
        </p>
      </motion.div>

      {others.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring.bouncy, delay: 0.45 }}
          className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm"
        >
          <span className="flex -space-x-2">
            {others.slice(0, 5).map((p) => (
              <Avatar key={p.id} person={p} size={28} className="rounded-full ring-2 ring-ink-950" />
            ))}
          </span>
          <span className="text-ink-200">
            {others.length === 1 ? (
              <>
                vs <b className="text-ink-50">{others[0]!.isBot ? others[0]!.name : `@${others[0]!.handle}`}</b>
              </>
            ) : (
              <>
                vs <b className="text-ink-50">{others.length}</b> players
              </>
            )}
          </span>
          {toBeat !== null && (
            <span className="text-ink-300">
              · To beat <b className="font-mono tabular text-[var(--accent-from)]">{formatAccuracy(toBeat)}</b>
            </span>
          )}
        </motion.div>
      )}

      <Eyebrow>
        Get ready
        <AnimatedDots />
      </Eyebrow>
    </Screen>
  );
}

/* ---------------------------------------------------------------------- */
/* Game                                                                   */
/* ---------------------------------------------------------------------- */

type Feedback =
  | { kind: "score"; id: number; accuracy: number; isBest: boolean; n: number }
  | { kind: "reject"; id: number; reason: Rejection };

function Game() {
  const xapps = useXApps();
  const result = useMatchResult();
  const rows = useTable();
  const later = useTimeouts();
  const spectator = xapps.isSpectator;

  const [run, setRun] = useState<Run>(EMPTY_RUN);
  const runRef = useRef<Run>(EMPTY_RUN);
  const [ink, setInk] = useState<InkState>({ kind: "empty" });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // Reopened after submitting: nothing left to draw.
  const [done, setDone] = useState(() => xapps.me.submitted || spectator);
  const doneRef = useRef(done);
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [shareOpen, setShareOpen] = useState(false);
  const strokeId = useRef(0);

  const best = bestScore(run);
  const live = xapps.match.mode === "live";

  const submitRun = (final: Run) => {
    setSubmitState("sending");
    const score = bestScore(final);
    const stroke = final.bestStroke;
    xapps
      .submit({
        score: score ?? 0,
        data: { scores: final.scores, misses: final.misses },
        display:
          score !== null && stroke
            ? { kind: "svg", svg: circleSvg(stroke, score), alt: `A ${formatAccuracy(score)} circle, drawn freehand` }
            : { kind: "text", title: "No circle", body: "Ran out of time before a full circle." },
      })
      .then(
        () => setSubmitState("sent"),
        (error: unknown) => {
          console.warn(`[${TAG}] submit failed`, error);
          setSubmitState("failed");
        },
      );
  };

  const finish = (final: Run) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setDone(true);
    play("whoosh");
    reportStats(xapps, runStats(final), TAG);
    const score = bestScore(final);
    if (final.bestStroke && score !== null) {
      setInk({ kind: "scored", stroke: final.bestStroke, id: ++strokeId.current });
      setFeedback({ kind: "score", id: strokeId.current, accuracy: score, isBest: false, n: 0 });
    } else {
      setInk({ kind: "empty" });
      setFeedback(null);
    }
    submitRun(final);
  };

  const remaining = useCountdown(MATCH_MS, !done, () => finish(runRef.current));

  const onStroke = (analysis: Analysis) => {
    if (doneRef.current) return;
    const id = ++strokeId.current;
    const next = recordStroke(runRef.current, analysis);
    runRef.current = next;
    setRun(next);

    if (!analysis.ok) {
      setInk({ kind: "rejected", stroke: analysis.stroke, id });
      setFeedback({ kind: "reject", id, reason: analysis.reason });
      play("error");
      xapps.ui.haptic("error").catch(ignore);
      return;
    }

    const n = next.scores.length;
    const isBest = next.bestIndex === n - 1;
    setInk({ kind: "scored", stroke: analysis.stroke, id });
    setFeedback({ kind: "score", id, accuracy: analysis.accuracy, isBest, n });

    if (analysis.accuracy >= PERFECT) {
      play("achievement");
      xapps.ui.haptic("success").catch(ignore);
      xapps.ui.celebrate("big").catch(ignore);
    } else if (analysis.accuracy >= SUPERB) {
      play("win");
      xapps.ui.haptic("success").catch(ignore);
      xapps.ui.celebrate("small").catch(ignore);
    } else {
      play(isBest ? "vote" : "pop");
      xapps.ui.haptic("medium").catch(ignore);
    }
    unlockAchievements(xapps, earnedAchievements(next), TAG);

    if (live) {
      xapps.room
        .send(ATTEMPT_EVENT, { ...toWire(n, analysis.accuracy, analysis.stroke) })
        .catch((error: unknown) => console.warn(`[${TAG}] broadcast failed`, error));
    }
    if (n >= ATTEMPTS) later(() => finish(next), 1_900);
  };

  const onStart = () => {
    setFeedback(null);
    play("tick");
  };

  // The match settled while we were here: a win (and how close) counts once.
  const [settledAtOpen] = useState(() => xapps.finalResult !== null);
  const resultCounted = useRef(false);
  useEffect(() => {
    if (!result || settledAtOpen || resultCounted.current || spectator) return;
    resultCounted.current = true;
    const progress = resultProgress(result, xapps.me.id);
    reportStats(xapps, progress.stats, TAG);
    unlockAchievements(xapps, progress.achievements, TAG);
    if (result.winnerId === xapps.me.id) play("win");
  }, [result, settledAtOpen, spectator, xapps]);

  // Host HUD: everyone's best + a status line.
  const meId = xapps.me.id;
  const scoresKey = `${best ?? 0}|${rows.map((r) => `${r.player.id}:${r.best ?? 0}`).join(",")}`;
  useEffect(() => {
    const scores: Record<string, number> = spectator ? {} : { [meId]: best ?? 0 };
    for (const r of rows) scores[r.player.id] = r.best ?? 0;
    xapps.ui.setScores(scores).catch(ignore);
    // rows is rebuilt every render; the key tracks its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoresKey, xapps]);

  const waitingFor = rows.filter((r) => !r.done).length;
  const statusText = spectator
    ? "Watching"
    : !done
      ? `Circle ${Math.min(run.scores.length + 1, ATTEMPTS)} of ${ATTEMPTS}${best !== null ? ` · best ${formatAccuracy(best)}` : ""}`
      : waitingFor > 0
        ? `Waiting for ${waitingFor} ${waitingFor === 1 ? "player" : "players"}`
        : best !== null
          ? `Final · ${formatAccuracy(best)}`
          : "Final";
  useEffect(() => {
    xapps.ui.setStatus(statusText).catch(ignore);
  }, [statusText, xapps]);

  const overlay: ReactNode =
    feedback?.kind === "score" ? (
      <ScoreOverlay key={`s${feedback.id}`} accuracy={feedback.accuracy} isBest={feedback.isBest} n={feedback.n} />
    ) : feedback?.kind === "reject" ? (
      <RejectOverlay key={`r${feedback.id}`} reason={feedback.reason} id={feedback.id} />
    ) : null;

  const standings: Standing[] = [
    ...(spectator ? [] : [{ player: xapps.me, best, stroke: run.bestStroke, done, me: true }]),
    ...rows.map((r) => ({ player: r.player, best: r.best, stroke: r.bestStroke, done: r.done, me: false })),
  ];

  const share = () => {
    if (best === null || !run.bestStroke) return;
    const url = new URL(CARD_PATH + encodeCard({ accuracy: best, stroke: run.bestStroke }), window.location.origin).toString();
    xapps.social.share(shareText(best), url).catch((error: unknown) => console.warn(`[${TAG}] share failed`, error));
    unlockAchievements(xapps, ["show_off"], TAG);
    play("whoosh");
    setShareOpen(false);
  };

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      {/* Header: you, your circles, the clock */}
      <header className="flex items-center justify-between gap-3">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={spring.soft} className="flex min-w-0 items-center gap-2.5">
          {!spectator && <Avatar person={xapps.me} size={32} />}
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">
              {spectator ? "Watching" : done ? "Your best" : `Circle ${Math.min(run.scores.length + 1, ATTEMPTS)} of ${ATTEMPTS}`}
            </p>
            {!spectator && <AttemptPips scores={run.scores} bestIndex={run.bestIndex} active={!done} />}
          </div>
        </motion.div>
        <AnimatePresence>
          {!done && (
            <motion.div
              key="clock"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={spring.bouncy}
              aria-label={`${Math.ceil(remaining / 1000)} seconds left`}
            >
              <TimerRing fraction={remaining / MATCH_MS} size={48} label={Math.ceil(remaining / 1000)} />
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <div className={cn("flex min-h-0 flex-1 gap-4 pt-3", done && "flex-col md:flex-row md:items-center")}>
        <Board
          className={cn("flex-1", done && "max-md:max-h-[46%]")}
          enabled={!done}
          ink={ink}
          overlay={overlay}
          hint={!done && run.scores.length === 0 && run.misses === 0 && feedback === null}
          onStart={onStart}
          onStroke={onStroke}
        />
        <AnimatePresence>
          {done && (
            <FinalPanel
              key="final"
              best={best}
              standings={standings}
              rows={rows}
              result={result}
              meId={meId}
              spectator={spectator}
              submitState={submitState}
              onRetry={() => submitRun(runRef.current)}
              onShare={() => setShareOpen(true)}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Footer while drawing: lock-in + the rest of the table */}
      {!done && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <div className="flex h-10 items-center justify-center gap-3">
            <AnimatePresence mode="popLayout">
              {best !== null && attemptsLeft(run) > 0 ? (
                <motion.div
                  key="actions"
                  className="flex items-center gap-2"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.bouncy}
                >
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    transition={spring.snappy}
                    onClick={() => setShareOpen(true)}
                    className="h-10 rounded-full border border-white/15 px-4 text-sm font-bold text-ink-100 hover:bg-white/[0.06]"
                  >
                    Share
                  </motion.button>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    transition={spring.snappy}
                    onClick={() => finish(runRef.current)}
                    className="h-10 rounded-full bg-ink-50 px-4 text-sm font-bold text-ink-950 hover:bg-white"
                  >
                    Lock in {formatAccuracy(best)}
                  </motion.button>
                </motion.div>
              ) : (
                <motion.p key="tip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-ink-400">
                  One stroke · all the way round · best of {ATTEMPTS}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
          <TableStrip rows={rows} />
        </div>
      )}

      {best !== null && run.bestStroke && (
        <ShareSheet
          open={shareOpen}
          accuracy={best}
          stroke={run.bestStroke}
          handle={xapps.me.isBot ? null : xapps.me.handle}
          accent={ACCENT}
          onPost={share}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Final panel                                                            */
/* ---------------------------------------------------------------------- */

function FinalPanel({
  best,
  standings,
  rows,
  result,
  meId,
  spectator,
  submitState,
  onRetry,
  onShare,
}: {
  best: number | null;
  standings: Standing[];
  rows: TableRow[];
  result: MatchResult | null;
  meId: string;
  spectator: boolean;
  submitState: "idle" | "sending" | "sent" | "failed";
  onRetry: () => void;
  onShare: () => void;
}) {
  const waiting = rows.filter((r) => !r.done);
  let banner: ReactNode;
  if (result) {
    const rank = result.ranks?.[meId];
    banner =
      result.winnerId === meId ? (
        <>🏆 Roundest at the table!</>
      ) : result.winnerId === null && rank === 1 ? (
        <>🤝 Dead heat at the top</>
      ) : rank ? (
        <>
          #{rank} of {standings.length}
        </>
      ) : (
        <>Final standings</>
      );
  } else if (spectator) {
    banner = <>Watching the table</>;
  } else if (best === null) {
    banner = <>⏰ Time&apos;s up — no full circle</>;
  } else if (waiting.length > 0) {
    banner = (
      <span className="text-base font-semibold text-ink-200">
        Waiting for {waiting.length === 1 ? (waiting[0]!.player.isBot ? waiting[0]!.player.name : `@${waiting[0]!.player.handle}`) : `${waiting.length} players`}
        <AnimatedDots />
      </span>
    );
  } else {
    banner = <>Circle locked in</>;
  }

  return (
    <motion.section
      className="flex w-full min-w-0 flex-col gap-3 md:w-80 md:shrink-0"
      initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ ...spring.soft, filter: { duration: 0.4 } }}
      aria-label="Your result"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.p
          key={result ? "result" : waiting.length > 0 ? "waiting" : "locked"}
          initial={{ opacity: 0, y: 10, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, transition: { duration: 0.14 } }}
          transition={spring.bouncy}
          className="glass-strong flex min-h-12 items-center justify-center rounded-2xl px-4 py-2 text-center font-display text-lg font-extrabold tracking-tight"
          role="status"
        >
          {banner}
        </motion.p>
      </AnimatePresence>

      <div className="no-scrollbar max-h-[34vh] overflow-y-auto md:max-h-none">
        <Standings rows={standings} />
      </div>

      {!spectator && best !== null && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring.bouncy, delay: 0.3 }}
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.02 }}
          onClick={onShare}
          className="flex h-12 items-center justify-center gap-2 rounded-full bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-sm font-bold text-ink-950 shadow-[0_12px_40px_-12px_var(--accent-to)]"
        >
          Share my {formatAccuracy(best)} circle
        </motion.button>
      )}
      {submitState === "failed" && (
        <button type="button" onClick={onRetry} className="text-xs font-semibold text-danger underline underline-offset-2">
          Couldn&apos;t send your score. Try again
        </button>
      )}
    </motion.section>
  );
}
