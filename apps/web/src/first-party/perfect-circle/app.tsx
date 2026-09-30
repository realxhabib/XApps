"use client";

import type { StatStanding, XAppsClient } from "@xapps/sdk";
import { useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn, formatNumber } from "@/lib/utils";
import { getOfficialApp } from "@/platform/catalog";
import { Board, type InkState } from "./board";
import { CARD_PATH, encodeCard, shareText } from "./card";
import { IDLE_STANDING, StandingPanel, type StandingState } from "./leaderboard";
import {
  BOARD_STAT,
  EMPTY_SESSION,
  PERFECT,
  SUPERB,
  TOP_N,
  accuracyColor,
  bestScore,
  circleStats,
  earnedAchievements,
  formatAccuracy,
  recordStroke,
  standingMoment,
  totalAchievements,
  type Analysis,
  type Rejection,
  type Session,
} from "./logic";
import { RecentPips, RejectOverlay, ScoreOverlay, ShareSheet } from "./parts";

const TAG = "perfect-circle";
const ignore = () => {};
const ACCENT = (getOfficialApp("perfect-circle")?.accent ?? ["#ffcf3d", "#34e89e"]) as [string, string];

type Feedback =
  | { kind: "score"; id: number; accuracy: number; isBest: boolean; n: number }
  | { kind: "reject"; id: number; reason: Rejection };

/** A scored circle whose standing we're fetching (kept so a retry can still tell its moment). */
interface PendingCircle {
  accuracy: number;
  /** The standing before this circle, if we had one. */
  prev: StatStanding | null;
  /** Your best before this circle (null: none, or unknown). */
  previousBest: number | null;
}

/** The worldwide best-circle board. Never throws: a host that can't answer rejects. */
function loadStanding(xapps: XAppsClient): Promise<StatStanding> {
  try {
    return xapps.stats.leaderboard(BOARD_STAT, { limit: TOP_N });
  } catch (error) {
    return Promise.reject(error);
  }
}

const maxOf = (...values: (number | null | undefined)[]): number | null =>
  values.reduce<number | null>((best, v) => (typeof v === "number" && (best === null || v > best) ? v : best), null);

/**
 * Perfect Circle, a standalone app (purpose `app`): draw a circle around the
 * dot, see its score and where your best stands worldwide, go again. No
 * matches, no clock, no limit. Every scored circle reports its stats; the
 * worldwide board is `stats.leaderboard("best_circle")`.
 */
export function PerfectCircle() {
  const xapps = useXApps();

  const [session, setSession] = useState<Session>(EMPTY_SESSION);
  const sessionRef = useRef<Session>(EMPTY_SESSION);
  const [ink, setInk] = useState<InkState>({ kind: "empty" });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [phase, setPhase] = useState<"draw" | "result">("draw");
  const [standing, setStanding] = useState<StandingState>(IDLE_STANDING);
  const [shareOpen, setShareOpen] = useState(false);
  const strokeId = useRef(0);

  // Read by handlers: the latest standing, the best the platform reported back, the circle in flight.
  const standingRef = useRef<StatStanding | null>(null);
  const reportedBest = useRef<number | null>(null);
  const pending = useRef<PendingCircle | null>(null);
  const request = useRef(0);

  const best = bestScore(session);
  const count = session.scores.length;
  const mine = standing.data?.me ?? null;

  /** Fetches the board; a newer request (another circle, a retry) wins over an older one. */
  const fetchStanding = (circle: PendingCircle | null, after: Promise<unknown> = Promise.resolve()) => {
    const req = ++request.current;
    pending.current = circle;
    setStanding((s) => ({ status: "loading", data: s.data, moment: null }));
    after
      .then(() => loadStanding(xapps))
      .then(
        (next) => {
          if (req !== request.current) return;
          standingRef.current = next;
          pending.current = null;
          setStanding({
            status: "ready",
            data: next,
            moment: circle ? standingMoment(circle.prev, next, circle.accuracy, circle.previousBest) : null,
          });
        },
        (error: unknown) => {
          if (req !== request.current) return;
          console.warn(`[${TAG}] stats.leaderboard failed`, error);
          setStanding((s) => ({ ...s, status: "error", moment: null }));
        },
      );
  };

  // Where you stand before your first circle (the header chip, and the baseline for "you climbed").
  useEffect(() => {
    let live = true;
    loadStanding(xapps).then(
      (data) => {
        if (!live || request.current !== 0) return;
        standingRef.current = data;
        setStanding({ status: "ready", data, moment: null });
      },
      (error: unknown) => console.warn(`[${TAG}] stats.leaderboard failed`, error),
    );
    return () => {
      live = false;
    };
  }, [xapps]);

  const statusText = mine
    ? `Best ${formatAccuracy(mine.value)} · #${formatNumber(mine.rank)} worldwide`
    : best !== null
      ? `Best so far ${formatAccuracy(best)}`
      : "Draw a circle around the dot";
  useEffect(() => {
    xapps.ui.setStatus(statusText).catch(ignore);
  }, [statusText, xapps]);

  /** Reports a scored circle, then fetches where it puts you (even when the report failed). */
  const settle = (accuracy: number, previousBest: number | null) => {
    const circle: PendingCircle = { accuracy, prev: standingRef.current, previousBest };
    const reported = reportStats(xapps, circleStats(accuracy), TAG).then((totals) => {
      if (!totals) return;
      reportedBest.current = maxOf(reportedBest.current, totals[BOARD_STAT]);
      unlockAchievements(xapps, totalAchievements(totals), TAG);
    });
    fetchStanding(circle, reported);
  };

  const onStroke = (analysis: Analysis) => {
    if (phase !== "draw") return;
    const id = ++strokeId.current;
    const before = sessionRef.current;
    const next = recordStroke(before, analysis);
    sessionRef.current = next;
    setSession(next);

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
    setPhase("result");

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
    settle(analysis.accuracy, maxOf(standingRef.current?.me?.value, reportedBest.current, bestScore(before)));
  };

  const onStart = () => {
    setFeedback(null);
    play("tick");
  };

  const again = () => {
    setPhase("draw");
    setInk({ kind: "empty" });
    setFeedback(null);
    play("pop");
  };

  // Your rank goes on the post when the circle you share is the one the board ranks.
  const shareRank = mine && best !== null && mine.value === best ? { rank: mine.rank, total: standing.data?.total ?? 0 } : null;
  const share = () => {
    if (best === null || !session.bestStroke) return;
    const url = new URL(CARD_PATH + encodeCard({ accuracy: best, stroke: session.bestStroke }), window.location.origin).toString();
    xapps.social.share(shareText(best, shareRank), url).catch((error: unknown) => console.warn(`[${TAG}] share failed`, error));
    unlockAchievements(xapps, ["show_off"], TAG);
    play("whoosh");
    setShareOpen(false);
  };

  const overlay: ReactNode =
    feedback?.kind === "score" ? (
      <ScoreOverlay key={`s${feedback.id}`} accuracy={feedback.accuracy} isBest={feedback.isBest} n={feedback.n} />
    ) : feedback?.kind === "reject" ? (
      <RejectOverlay key={`r${feedback.id}`} reason={feedback.reason} id={feedback.id} />
    ) : null;

  const result = phase === "result";

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <div className="relative mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {/* Header: you, this sitting's circles, your worldwide best */}
        <header className="flex min-h-11 items-center justify-between gap-3">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={spring.soft}
            className="flex min-w-0 items-center gap-2.5"
          >
            <Avatar person={xapps.me} size={32} />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">
                {count === 0 ? "Perfect Circle" : `${formatNumber(count)} ${count === 1 ? "circle" : "circles"}`}
              </p>
              {count === 0 ? (
                <p className="truncate text-sm font-semibold text-ink-100">One stroke around the dot</p>
              ) : (
                <RecentPips scores={session.scores} bestIndex={session.bestIndex} />
              )}
            </div>
          </motion.div>
          <AnimatePresence>
            {mine && (
              <motion.div
                key="best"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={spring.bouncy}
                className="glass flex shrink-0 items-center gap-2 rounded-full py-1 pl-2.5 pr-3 text-sm"
                aria-label={`Your best ${formatAccuracy(mine.value)}, number ${mine.rank} worldwide`}
              >
                <span aria-hidden>🌍</span>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.b
                    key={mine.rank}
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -12, opacity: 0 }}
                    transition={spring.bouncy}
                    className="font-display font-extrabold tabular text-ink-50"
                  >
                    #{formatNumber(mine.rank)}
                  </motion.b>
                </AnimatePresence>
                <span className="font-display font-extrabold tabular" style={{ color: accuracyColor(mine.value) }}>
                  {formatAccuracy(mine.value)}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <div className={cn("flex min-h-0 flex-1 gap-4 pt-3", result && "flex-col md:flex-row md:items-center")}>
          <Board
            className={cn("flex-1", result && "max-md:max-h-[40%]")}
            enabled={!result}
            ink={ink}
            overlay={overlay}
            hint={count === 0 && session.misses === 0 && feedback === null}
            onStart={onStart}
            onStroke={onStroke}
          />
          <AnimatePresence>
            {result && (
              <StandingPanel
                key="standing"
                standing={standing}
                meId={xapps.me.id}
                me={xapps.me}
                onRetry={() => fetchStanding(pending.current)}
                actions={
                  <div className="flex gap-2">
                    <AgainButton onClick={again} />
                    {best !== null && (
                      <motion.button
                        type="button"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ ...spring.bouncy, delay: 0.25 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => setShareOpen(true)}
                        className="h-12 shrink-0 rounded-full border border-white/15 px-4 text-sm font-bold text-ink-50 hover:bg-white/[0.06]"
                      >
                        Share {formatAccuracy(best)}
                      </motion.button>
                    )}
                  </div>
                }
              />
            )}
          </AnimatePresence>
        </div>

        {!result && (
          <div className="flex h-12 items-center justify-center gap-3 pt-2">
            <AnimatePresence mode="popLayout" initial={false}>
              {best !== null ? (
                <motion.button
                  key="share"
                  type="button"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={spring.bouncy}
                  whileTap={{ scale: 0.94 }}
                  onClick={() => setShareOpen(true)}
                  className="h-10 rounded-full border border-white/15 px-4 text-sm font-bold text-ink-100 hover:bg-white/[0.06]"
                >
                  Share my {formatAccuracy(best)} circle
                </motion.button>
              ) : (
                <motion.p key="tip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-xs text-ink-400">
                  One stroke · all the way round · as many tries as you like
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {best !== null && session.bestStroke && (
        <ShareSheet
          open={shareOpen}
          accuracy={best}
          stroke={session.bestStroke}
          handle={xapps.me.isBot ? null : xapps.me.handle}
          accent={ACCENT}
          onPost={share}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

/** "Again": focused when it appears, so Enter or Space goes straight into the next circle. */
function AgainButton({ onClick }: { onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <motion.button
      ref={ref}
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ...spring.bouncy, delay: 0.15 }}
      whileTap={{ scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-sm font-bold text-ink-950 shadow-[0_12px_40px_-12px_var(--accent-to)] outline-none focus-visible:ring-2 focus-visible:ring-ink-50"
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5"
        />
      </svg>
      Again
    </motion.button>
  );
}
