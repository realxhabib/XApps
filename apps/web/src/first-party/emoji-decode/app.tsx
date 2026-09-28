"use client";

import type { MatchResult, PlayerInfo } from "@xapps/sdk";
import { useMatchResult, useMatchStarted, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useBot, useLiveOpponent, useTimeouts } from "@/first-party/shared/hooks";
import { AnimatedDots, Eyebrow, Screen, WaitingFor } from "@/first-party/shared/ui";
import { ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import {
  ANSWERED_EVENT,
  EMPTY_RUN,
  QUESTION_COUNT,
  REVEAL_MS,
  STREAK_BONUS,
  STREAK_BONUS_FROM,
  buildMatch,
  paceScore,
  recordAnswer,
  remainingAt,
  splitEmoji,
  submissionData,
  summarize,
  trackFromRun,
  type AnswerRecord,
  type Question,
  type RunState,
  type Track,
} from "./logic";
import { useOpponent, type OpponentView } from "./opponent";
import {
  EMOJI_FONT,
  EmojiTiles,
  OptionCard,
  Pips,
  QuestionClock,
  StreakChip,
  TickingNumber,
  VerdictBadge,
  noise,
  type OptionStatus,
} from "./parts";
import { CATEGORY_META, type PuzzleCategory } from "./puzzles";

/** How long the "+145" takes to fly into the score. */
const FLY_MS = 640;
const CLOCK_SIZE = 54;

const ignore = () => {};

/* ---------------------------------------------------------------------- */
/* Root                                                                   */
/* ---------------------------------------------------------------------- */

export function EmojiDecodeApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const readyRef = useRef(false);

  useEffect(() => {
    // Exactly once, even under StrictMode's double effects.
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[emoji-decode] ready failed", error));
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

function PreGame() {
  const xapps = useXApps();
  const bot = useBot();
  const live = useLiveOpponent();
  const opponent = xapps.opponent;
  const toBeat = !bot && !live && opponent?.submitted && typeof opponent.score === "number" ? opponent.score : null;

  return (
    <Screen className="gap-6 text-center">
      <div className="flex items-end gap-3" aria-hidden>
        {["🧠", "⚡", "🧩"].map((glyph, i) => (
          <motion.div
            key={glyph}
            initial={{ opacity: 0, scale: 0.2, y: 40, rotate: -30 + i * 20 }}
            animate={{ opacity: 1, scale: 1, y: 0, rotate: (i - 1) * 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 13, delay: 0.1 + i * 0.12 }}
          >
            <motion.div
              animate={{ y: [0, -16, 0], rotate: [0, (i - 1) * -6, 0] }}
              transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 1.3, delay: 0.9 + i * 0.16, ease: "easeInOut" }}
              className="flex size-[clamp(64px,18vw,92px)] items-center justify-center rounded-[28%] border border-white/[0.12] shadow-[0_20px_50px_-20px_var(--accent-to)]"
              style={{ background: "linear-gradient(160deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.03))" }}
            >
              <span className="text-[clamp(38px,11vw,56px)] leading-none" style={{ fontFamily: EMOJI_FONT }}>
                {glyph}
              </span>
            </motion.div>
          </motion.div>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.35 }}>
        <h1 className="font-display text-5xl font-extrabold tracking-tight [font-stretch:92%] sm:text-6xl">
          Emoji{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">
            Decode
          </span>
        </h1>
        <p className="mt-2 text-balance text-sm text-ink-300 sm:text-base">
          8 emoji puzzles · 12 seconds each · faster answers score more
        </p>
      </motion.div>

      {opponent && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ ...spring.bouncy, delay: 0.5 }}
          className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-sm"
        >
          <Avatar person={opponent} size={28} />
          <span className="text-ink-200">
            vs <b className="text-ink-50">@{opponent.handle}</b>
          </span>
          {toBeat !== null && (
            <span className="text-ink-300">
              · Score to beat <b className="font-mono tabular text-[var(--accent-from)]">{toBeat.toLocaleString("en")}</b>
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

interface Fly {
  id: number;
  text: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

function Game() {
  const xapps = useXApps();
  const reduce = useReducedMotion();
  const result = useMatchResult();
  // Forks of the shared seed only → identical on both clients, stable across renders.
  const questions = useMemo(() => buildMatch(xapps.random), [xapps]);
  const opp = useOpponent(questions);
  const later = useTimeouts();

  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const runRef = useRef<RunState>(EMPTY_RUN);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [shownTotal, setShownTotal] = useState(0);
  const [fly, setFly] = useState<Fly | null>(null);
  const [flash, setFlash] = useState<{ id: number; good: boolean } | null>(null);
  const [scoreScope, animateScore] = useAnimate<HTMLDivElement>();
  const submittedRef = useRef(false);

  const myTrack = useMemo(() => trackFromRun(run), [run]);
  const liveId = opp.kind === "live" ? opp.player?.id : undefined;

  const land = (total: number) => {
    setShownTotal(total);
    const el = scoreScope.current;
    if (el && !reduce) {
      animateScore(el, { scale: [1, 1.32, 1], color: ["#37e39b", "#37e39b", "#f6f7fb"] }, { duration: 0.55, ease: "easeOut" });
    }
  };

  const finish = (final: RunState) => {
    setDone(true);
    play("whoosh");
    if (submittedRef.current) return;
    submittedRef.current = true;
    const s = summarize(final);
    xapps
      .submit({
        score: final.total,
        data: submissionData(questions, final),
        display: {
          kind: "text",
          title: `${s.correct}/${QUESTION_COUNT} decoded · ${final.total.toLocaleString("en")} pts`,
          body: questions
            .map((q) => `${q.puzzle.emoji} ${final.answers[q.index]?.correct ? "✅" : "❌"}`)
            .join("  "),
        },
      })
      .catch((error: unknown) => console.warn("[emoji-decode] submit failed", error));
  };

  const handleAnswer = (
    q: number,
    choice: number | null,
    remainingMs: number,
    elapsedMs: number,
    from: DOMRect | null,
  ) => {
    const question = questions[q];
    if (!question || runRef.current.answers.some((a) => a.q === q)) return;
    const { run: next, answer } = recordAnswer(runRef.current, question, choice, remainingMs, elapsedMs);
    runRef.current = next;
    setRun(next);

    // Feedback: sound, haptic, screen flash.
    if (answer.correct) play("vote");
    else play(choice === null ? "thump" : "error");
    xapps.ui.haptic(answer.correct ? "success" : "error").catch(ignore);
    setFlash({ id: q, good: answer.correct });

    // Live: tell the opponent (they render our pips + score).
    if (liveId) {
      xapps.room
        .send(ANSWERED_EVENT, { q, correct: answer.correct, points: answer.points, total: answer.total })
        .catch((error: unknown) => console.warn("[emoji-decode] broadcast failed", error));
    }

    // "+145" flies from the picked card into the score, which then ticks up.
    const target = scoreScope.current?.getBoundingClientRect();
    if (answer.correct && from && target && !reduce) {
      setFly({
        id: q,
        text: `+${answer.points}`,
        from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
        to: { x: target.left + target.width / 2, y: target.top + target.height / 2 },
      });
      later(() => land(next.total), FLY_MS);
      later(() => setFly(null), FLY_MS + 120);
    } else if (answer.correct) {
      land(next.total);
    }

    later(() => {
      if (q + 1 < questions.length) {
        play("whoosh");
        setIndex(q + 1);
      } else {
        finish(next);
      }
    }, REVEAL_MS);
  };

  // Host HUD: scores + status line.
  const meId = xapps.me.id;
  const oppId = opp.player?.id;
  const oppTotal = opp.total;
  useEffect(() => {
    const scores: Record<string, number> = { [meId]: shownTotal };
    if (oppId && oppTotal !== null) scores[oppId] = oppTotal;
    xapps.ui.setScores(scores).catch(ignore);
  }, [xapps, meId, shownTotal, oppId, oppTotal]);

  const waitingOn = done && (opp.kind === "bot" || opp.kind === "live") && !opp.done ? opp.player?.handle : undefined;
  useEffect(() => {
    const text = !done
      ? `Q ${index + 1} of ${QUESTION_COUNT}`
      : waitingOn
        ? `Waiting for @${waitingOn}`
        : `Final · ${runRef.current.total.toLocaleString("en")} pts`;
    xapps.ui.setStatus(text).catch(ignore);
  }, [xapps, index, done, waitingOn]);

  const question = questions[index];

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <Scoreboard
        me={xapps.me}
        myTotal={shownTotal}
        myTrack={myTrack}
        streak={done ? 0 : run.streak}
        opp={opp}
        answered={run.answers.length}
        index={index}
        done={done}
        scoreRef={scoreScope}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          {!done && question ? (
            <QuestionView
              key={index}
              question={question}
              answer={run.answers[index] ?? null}
              onAnswer={handleAnswer}
            />
          ) : (
            <Summary key="summary" questions={questions} run={run} opp={opp} meId={meId} result={result} />
          )}
        </AnimatePresence>
      </div>

      <FlyingPoints fly={fly} />
      <AnimatePresence>
        {flash && !reduce && (
          <motion.div
            key={flash.id}
            aria-hidden
            className="pointer-events-none fixed inset-0 z-40"
            style={{
              background: flash.good
                ? "radial-gradient(ellipse at 50% 70%, color-mix(in oklab, var(--color-success) 26%, transparent), transparent 70%)"
                : "radial-gradient(ellipse at 50% 50%, transparent 35%, color-mix(in oklab, var(--color-danger) 34%, transparent))",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.65, times: [0, 0.18, 1] }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Scoreboard                                                             */
/* ---------------------------------------------------------------------- */

function Scoreboard({
  me,
  myTotal,
  myTrack,
  streak,
  opp,
  answered,
  index,
  done,
  scoreRef,
}: {
  me: PlayerInfo;
  myTotal: number;
  myTrack: Track;
  streak: number;
  opp: OpponentView;
  answered: number;
  index: number;
  done: boolean;
  scoreRef: RefObject<HTMLDivElement | null>;
}) {
  const shownIndex = Math.min(index + 1, QUESTION_COUNT);
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3">
      {/* Me */}
      <motion.div
        initial={{ opacity: 0, x: -24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={spring.soft}
        className="flex min-w-0 flex-col items-start gap-1.5"
      >
        <div className="flex min-w-0 items-center gap-2">
          <Avatar person={me} size={32} />
          <div className="min-w-0">
            <div className="flex h-5 items-center gap-1.5">
              <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">You</span>
              <StreakChip streak={streak} />
            </div>
            <div
              ref={scoreRef}
              className="origin-left font-display text-2xl font-extrabold leading-none tracking-tight tabular text-ink-50"
              aria-label={`Your score ${myTotal}`}
            >
              <TickingNumber value={myTotal} />
            </div>
          </div>
        </div>
        <Pips results={myTrack.results} label="Your progress" />
      </motion.div>

      {/* Puzzle counter */}
      <div className="flex min-w-14 flex-col items-center pt-0.5" aria-live="polite">
        <Eyebrow className="text-[10px] tracking-[0.18em]">{done ? "Final" : "Puzzle"}</Eyebrow>
        <p className="mt-0.5 font-display text-2xl font-extrabold leading-none tabular">
          <span className="relative inline-block overflow-hidden align-bottom">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={shownIndex}
                className="inline-block"
                initial={{ y: 22, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -22, opacity: 0 }}
                transition={spring.snappy}
              >
                {shownIndex}
              </motion.span>
            </AnimatePresence>
          </span>
          <span className="text-ink-500">/{QUESTION_COUNT}</span>
        </p>
      </div>

      {/* Opponent */}
      <motion.div
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={spring.soft}
        className="flex min-w-0 flex-col items-end gap-1.5"
      >
        <OpponentSide opp={opp} myTotal={myTotal} answered={answered} />
      </motion.div>
    </header>
  );
}

function OpponentSide({ opp, myTotal, answered }: { opp: OpponentView; myTotal: number; answered: number }) {
  const player = opp.player;
  if (!player || opp.kind === "solo") return null;

  if (opp.kind === "async") {
    const target = opp.finalScore;
    if (target === null) {
      return (
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 text-right">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">@{player.handle}</p>
            <p className="text-xs text-ink-400">plays later</p>
          </div>
          <Avatar person={player} size={32} />
        </div>
      );
    }
    // Ghost pace: where their final score would be at this point at an even pace.
    const delta = myTotal - paceScore(target, answered);
    const progress = target > 0 ? Math.min(1, myTotal / target) : 1;
    return (
      <>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 text-right">
            <p className="truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">To beat</p>
            <p className="font-display text-2xl font-extrabold leading-none tracking-tight tabular text-[var(--accent-from)]">
              {target.toLocaleString("en")}
            </p>
          </div>
          <Avatar person={player} size={32} />
        </div>
        <div className="flex items-center gap-2">
          {answered > 0 && (
            <motion.span
              key={answered}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn("font-mono text-[10px] font-bold tabular", delta >= 0 ? "text-success" : "text-danger")}
            >
              {delta >= 0 ? "+" : "−"}
              {Math.abs(delta)} {delta >= 0 ? "ahead" : "behind"}
            </motion.span>
          )}
          <div className="relative h-2 w-16 overflow-hidden rounded-full bg-white/10 sm:w-24" aria-hidden>
            <motion.div
              className="absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,var(--accent-to),var(--accent-from))]"
              animate={{ width: `${progress * 100}%` }}
              transition={spring.soft}
            />
            <motion.div
              className="absolute inset-y-0 w-0.5 bg-white/70"
              animate={{ left: `${(paceScore(target, answered) / Math.max(1, target)) * 100}%` }}
              transition={spring.soft}
            />
          </div>
        </div>
      </>
    );
  }

  // Bot or live human: running score + live pips.
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 text-right">
          <div className="flex h-5 items-center justify-end gap-1.5">
            {opp.done && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={spring.bouncy}
                className="shrink-0 rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-ink-200"
              >
                done
              </motion.span>
            )}
            <span className="min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.14em] text-ink-300">
              {player.isBot ? "Bot" : `@${player.handle}`}
            </span>
          </div>
          <div className="font-display text-2xl font-extrabold leading-none tracking-tight tabular text-ink-50">
            <TickingNumber value={opp.total ?? 0} />
          </div>
        </div>
        <Avatar person={player} size={32} online={opp.kind === "live" ? opp.online : undefined} />
      </div>
      <Pips results={opp.track.results} label={`${player.name}'s progress`} className="flex-row-reverse" />
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* One puzzle                                                             */
/* ---------------------------------------------------------------------- */

const PROMPTS: Record<PuzzleCategory, string> = {
  Movie: "Name the movie",
  Idiom: "Decode the idiom",
  Phrase: "Crack the phrase",
  Song: "Name that tune",
};
const CHEERS = ["Decoded!", "Nailed it!", "Big brain!", "Sharp!", "Too easy!"];
const JEERS = ["Not quite", "So close!", "Nope!"];

function QuestionView({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer: AnswerRecord | null;
  onAnswer: (q: number, choice: number | null, remainingMs: number, elapsedMs: number, from: DOMRect | null) => void;
}) {
  const reduce = useReducedMotion();
  const startRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const { puzzle } = question;
  const meta = CATEGORY_META[puzzle.category];

  const pick = (choice: number | null) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    const now = performance.now();
    if (startRef.current === null) startRef.current = now;
    const remaining = remainingAt(startRef.current, now);
    const rect = choice === null ? null : (buttonsRef.current[choice]?.getBoundingClientRect() ?? null);
    onAnswer(question.index, choice, remaining, now - startRef.current, rect);
  };

  // 1–4 keyboard shortcuts.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= question.options.length) {
      event.preventDefault();
      pick(n - 1);
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // A little pop per tile as they land.
  useEffect(() => {
    const count = splitEmoji(question.puzzle.emoji).length;
    const timers = Array.from({ length: count }, (_, i) => setTimeout(() => play("pop"), 110 + i * 90));
    return () => timers.forEach(clearTimeout);
  }, [question]);

  const outcome = answer ? (answer.correct ? "correct" : "wrong") : "pending";
  const statusOf = (i: number): OptionStatus => {
    if (!answer) return "idle";
    if (i === answer.choice) return answer.correct ? "picked-correct" : "picked-wrong";
    if (i === question.correctIndex) return "reveal";
    return "dim";
  };
  const pickFrom = (list: string[]) => list[Math.floor(noise(`${puzzle.id}:cheer`) * list.length)] ?? list[0];

  return (
    <motion.section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={`Puzzle ${question.index + 1} of ${QUESTION_COUNT}: ${PROMPTS[puzzle.category]}`}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { opacity: 0, x: -80, scale: 0.94, filter: "blur(14px)", transition: { duration: 0.28, ease: ease.inOutQuart } }
      }
    >
      {/* Category + clock */}
      <div className="flex items-center justify-between gap-3 pt-3">
        <motion.div
          initial={{ opacity: 0, x: -18, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          transition={spring.bouncy}
          className="flex min-w-0 items-center gap-2"
        >
          <span className="glass inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.16em] text-ink-100">
            <span aria-hidden className="text-sm">
              {meta.icon}
            </span>
            {meta.label}
          </span>
          <span className="truncate text-sm font-medium text-ink-300">{PROMPTS[puzzle.category]}</span>
        </motion.div>
        <div className="relative shrink-0" style={{ width: CLOCK_SIZE, height: CLOCK_SIZE }}>
          <AnimatePresence initial={false}>
            {answer ? (
              <motion.div key="verdict" className="absolute inset-0">
                <VerdictBadge outcome={answer.correct ? "correct" : "wrong"} timeout={answer.choice === null} size={CLOCK_SIZE} />
              </motion.div>
            ) : (
              <motion.div
                key="clock"
                className="absolute inset-0"
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.15 } }}
                transition={spring.bouncy}
              >
                <QuestionClock startRef={startRef} frozenMs={null} onExpire={() => pick(null)} size={CLOCK_SIZE} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* The rebus */}
      <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-3">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[min(80vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent-from), transparent 65%)" }}
        />
        <EmojiTiles emoji={puzzle.emoji} seed={puzzle.id} outcome={outcome} />
        <div className="flex h-6 items-center justify-center" aria-live="polite">
          <AnimatePresence>
            {answer && (
              <motion.p
                key="caption"
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring.bouncy}
                className="flex items-center gap-2 text-sm font-semibold"
              >
                {answer.correct ? (
                  <>
                    <span className="text-success">{pickFrom(CHEERS)}</span>
                    <span className="font-mono text-xs tabular text-ink-300">
                      {(answer.elapsedMs / 1000).toFixed(1)}s
                    </span>
                    {answer.streak >= STREAK_BONUS_FROM && (
                      <motion.span
                        initial={{ scale: 0, rotate: -20 }}
                        animate={{ scale: 1, rotate: 0 }}
                        transition={{ ...spring.wobbly, delay: 0.15 }}
                        className="rounded-full bg-[linear-gradient(120deg,var(--color-gold),var(--color-ember))] px-2 py-0.5 font-mono text-[11px] font-bold text-ink-950"
                      >
                        🔥 +{STREAK_BONUS} streak
                      </motion.span>
                    )}
                  </>
                ) : answer.choice === null ? (
                  <span className="text-danger">Time&apos;s up!</span>
                ) : (
                  <span className="text-danger">{pickFrom(JEERS)}</span>
                )}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Options: 1×4 on narrow phones, 2×2 when wide or short */}
      <div className="grid grid-cols-1 gap-2.5 min-[440px]:grid-cols-2 [@media(max-height:620px)]:grid-cols-2">
        {question.options.map((option, i) => (
          <OptionCard
            key={option}
            index={i}
            text={option}
            status={statusOf(i)}
            locked={answer !== null}
            onPick={pick}
            buttonRef={(el) => {
              buttonsRef.current[i] = el;
            }}
          />
        ))}
      </div>
      <p className="mt-2 hidden text-center text-[11px] text-ink-400 [@media(pointer:fine)_and_(min-height:560px)]:block">
        Press <kbd className="rounded bg-white/10 px-1 font-mono">1</kbd>–<kbd className="rounded bg-white/10 px-1 font-mono">4</kbd> to answer
      </p>
    </motion.section>
  );
}

/* ---------------------------------------------------------------------- */
/* Flying points                                                          */
/* ---------------------------------------------------------------------- */

function FlyingPoints({ fly }: { fly: Fly | null }) {
  return (
    <AnimatePresence>
      {fly && (
        <motion.div
          key={fly.id}
          aria-hidden
          className="pointer-events-none fixed left-0 top-0 z-50"
          initial={{ x: fly.from.x, y: fly.from.y, scale: 0.4, opacity: 0 }}
          animate={{
            x: [fly.from.x, fly.from.x, fly.to.x],
            y: [fly.from.y, fly.from.y - 48, fly.to.y],
            scale: [0.4, 1.35, 0.5],
            opacity: [0, 1, 0.85],
          }}
          exit={{ opacity: 0, scale: 0.2, transition: { duration: 0.12 } }}
          transition={{ duration: FLY_MS / 1000, times: [0, 0.4, 1], ease: ["easeOut", "easeIn"] }}
        >
          <span className="block -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-display text-3xl font-extrabold tabular text-success [text-shadow:0_0_22px_var(--color-success),0_2px_0_rgb(0_0_0/0.45)]">
            {fly.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------------------------------------------------------------------- */
/* Summary                                                                */
/* ---------------------------------------------------------------------- */

function Summary({
  questions,
  run,
  opp,
  meId,
  result,
}: {
  questions: Question[];
  run: RunState;
  opp: OpponentView;
  meId: string;
  result: MatchResult | null;
}) {
  const s = summarize(run);
  return (
    <motion.section
      className="flex min-h-0 flex-1 flex-col gap-3 pt-3"
      initial={{ opacity: 0, y: 24, filter: "blur(10px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={spring.soft}
      aria-label="Match summary"
    >
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col justify-center-safe gap-4 overflow-y-auto [@media(max-height:560px)]:gap-2">
        <div className="flex flex-col items-center text-center">
          <Eyebrow className="[@media(max-height:560px)]:hidden">Final score</Eyebrow>
          <motion.div
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={spring.wobbly}
            className="font-display text-5xl font-extrabold leading-tight tracking-tight tabular [@media(max-height:560px)]:text-4xl"
          >
            <TickingNumber
              value={run.total}
              from={0}
              className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent"
            />
          </motion.div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5 text-xs">
            <StatChip delay={0.2}>
              <b className="text-ink-50">
                {s.correct}/{QUESTION_COUNT}
              </b>{" "}
              decoded
            </StatChip>
            {s.bestStreak >= 2 && (
              <StatChip delay={0.28}>
                <span style={{ fontFamily: EMOJI_FONT }}>🔥</span> best <b className="text-ink-50">{s.bestStreak}</b>
              </StatChip>
            )}
            {s.avgCorrectMs !== null && (
              <StatChip delay={0.36}>
                <span style={{ fontFamily: EMOJI_FONT }}>⚡️</span>{" "}
                <b className="text-ink-50">{(s.avgCorrectMs / 1000).toFixed(1)}s</b> avg
              </StatChip>
            )}
          </div>
        </div>

        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 [@media(max-height:600px)]:gap-1.5">
          {questions.map((q, i) => {
            const a = run.answers[i];
            const correct = a?.correct ?? false;
            return (
              <motion.li
                key={q.puzzle.id}
                initial={{ opacity: 0, y: 18, scale: 0.88 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ ...spring.bouncy, delay: 0.25 + i * 0.055 }}
                className={cn(
                  "glass relative flex min-w-0 flex-col gap-1 rounded-xl px-2.5 py-2 [@media(max-height:600px)]:gap-0.5 [@media(max-height:600px)]:py-1.5",
                  correct ? "border-success/30" : "border-danger/25",
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className="truncate text-lg leading-none [@media(max-height:600px)]:text-base"
                    style={{ fontFamily: EMOJI_FONT }}
                    aria-hidden
                  >
                    {q.puzzle.emoji}
                  </span>
                  <motion.span
                    initial={{ scale: 0, rotate: -90 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ ...spring.wobbly, delay: 0.45 + i * 0.055 }}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                      correct ? "bg-success text-ink-950" : "bg-danger text-white",
                    )}
                    aria-label={correct ? "correct" : "missed"}
                  >
                    {correct ? "✓" : "✗"}
                  </motion.span>
                </div>
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <p className="truncate text-xs font-semibold text-ink-100" title={q.puzzle.answer}>
                    {q.puzzle.answer}
                  </p>
                  <span className={cn("shrink-0 font-mono text-[11px] font-bold tabular", correct ? "text-success" : "text-ink-400")}>
                    {correct ? `+${a?.points ?? 0}` : a?.choice === null ? "⏰ 0" : "0"}
                  </span>
                </div>
              </motion.li>
            );
          })}
        </ol>
      </div>

      <OpponentStatus opp={opp} myTotal={run.total} meId={meId} result={result} />
    </motion.section>
  );
}

function StatChip({ children, delay }: { children: ReactNode; delay: number }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.bouncy, delay }}
      className="whitespace-nowrap rounded-full bg-white/[0.06] px-2.5 py-1 text-ink-300 ring-1 ring-white/[0.08] max-[380px]:px-2"
    >
      {children}
    </motion.span>
  );
}

function OpponentStatus({
  opp,
  myTotal,
  meId,
  result,
}: {
  opp: OpponentView;
  myTotal: number;
  meId: string;
  result: MatchResult | null;
}) {
  const player = opp.player;
  const name = player ? (player.isBot ? player.name : `@${player.handle}`) : "";

  let content: ReactNode;
  let key: string;
  if (result) {
    key = "result";
    const won = result.winnerId === meId;
    const draw = result.winnerId === null;
    content = (
      <p className="font-display text-xl font-extrabold tracking-tight">
        {draw ? "🤝 It's a draw" : won ? "🏆 You win!" : `${player?.isBot ? "🤖" : "😤"} ${name || "They"} takes it`}
      </p>
    );
  } else if ((opp.kind === "bot" || opp.kind === "live") && player && !opp.done) {
    key = "waiting";
    content = (
      <div className="flex w-full items-center gap-3">
        <Avatar person={player} size={36} className="max-[380px]:hidden [@media(max-height:560px)]:hidden" />
        <div className="min-w-0 flex-1 text-left">
          <WaitingFor text={<>Waiting for <b className="text-ink-50">{name}</b></>} />
          <Pips results={opp.track.results} label={`${name}'s progress`} className="mt-1.5" />
        </div>
        <span className="font-display text-xl font-extrabold tabular">
          <TickingNumber value={opp.total ?? 0} />
        </span>
      </div>
    );
  } else if ((opp.kind === "bot" || opp.kind === "live") && player) {
    key = "opp-done";
    const theirs = opp.total ?? 0;
    content = (
      <p className="text-sm text-ink-200">
        {name} finished with <b className="font-mono tabular text-ink-50">{theirs.toLocaleString("en")}</b>
        {" — "}
        {myTotal === theirs ? "dead even!" : myTotal > theirs ? "you're ahead 🎉" : "they edged it"}
      </p>
    );
  } else if (opp.kind === "async" && player) {
    key = "async";
    const target = opp.finalScore;
    content =
      target === null ? (
        <p className="text-sm text-ink-200">
          Score locked in! <b className="text-ink-50">@{player.handle}</b> plays next — they need{" "}
          <b className="font-mono tabular text-[var(--accent-from)]">{(myTotal + 1).toLocaleString("en")}</b> to win.
        </p>
      ) : (
        <p className="text-sm text-ink-200">
          Score to beat was <b className="font-mono tabular text-ink-50">{target.toLocaleString("en")}</b> —{" "}
          {myTotal > target ? (
            <b className="text-success">you beat it by {(myTotal - target).toLocaleString("en")}!</b>
          ) : myTotal === target ? (
            <b className="text-ink-50">a perfect tie.</b>
          ) : (
            <b className="text-danger">short by {(target - myTotal).toLocaleString("en")}.</b>
          )}
        </p>
      );
  } else {
    key = "solo";
    content = <p className="text-sm text-ink-200">Nice run — share it and challenge a friend.</p>;
  }

  return (
    <div className="relative">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 14, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.14 } }}
          transition={{ ...spring.bouncy, delay: key === "result" ? 0.1 : 0.5 }}
          className="glass-strong flex min-h-14 items-center justify-center rounded-2xl px-4 py-2.5 text-center"
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
