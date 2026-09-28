"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { useMatchStarted, usePlayers, usePresence, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { BLUR_TWEEN, ease, spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { useDeadline, useTriviaEngine } from "./engine";
import {
  INTRO_MS,
  QUESTION_MS,
  REVEAL_MS,
  ROUNDS,
  buildQuestions,
  choiceCounts,
  ordinal,
  tables,
  type Question,
  type Seat,
  type Standing,
  type TriviaState,
} from "./logic";
import {
  AnswerTile,
  AnsweredRow,
  DeltaChip,
  DoubleBadge,
  Podium,
  QuestionClock,
  RankBadge,
  StreakChip,
  TickingNumber,
  TimeBar,
  type SeatMark,
  type TileStatus,
} from "./parts";
import { CATEGORY_META } from "./questions";
import { useTriviaStore } from "./store";

const ignore = () => {};
const CLOCK_SIZE = 50;

/* ---------------------------------------------------------------------- */
/* Root                                                                   */
/* ---------------------------------------------------------------------- */

export function TriviaRoyaleApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const readyRef = useRef(false);

  useEffect(() => {
    // Exactly once, even under StrictMode's double effects.
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[trivia-royale] ready failed", error));
  }, [xapps]);

  useEffect(() => {
    if (!started) xapps.ui.setStatus(xapps.isSpectator ? "Watching" : "Get ready").catch(ignore);
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
  const { players, isSpectator, me } = usePlayers();
  const reduce = useReducedMotion();
  return (
    <Screen className="gap-6 text-center">
      <div className="relative" aria-hidden>
        <motion.div
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.3, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 13, delay: 0.1 }}
          className="flex size-[clamp(84px,24vw,112px)] items-center justify-center rounded-[30%] border border-white/15 shadow-[0_24px_60px_-20px_var(--accent-to)]"
          style={{ background: "linear-gradient(160deg, var(--accent-from), var(--accent-to))" }}
        >
          <motion.span
            className="text-[clamp(44px,13vw,60px)] leading-none drop-shadow-[0_6px_10px_rgb(0_0_0/0.3)]"
            animate={reduce ? undefined : { rotate: [-6, 6, -6], y: [0, -4, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          >
            👑
          </motion.span>
        </motion.div>
        {["🧪", "🌍", "🎨", "🚀"].map((glyph, i) => (
          <motion.span
            key={glyph}
            className="absolute text-2xl"
            style={{ left: `${[-38, 108, -30, 100][i]}%`, top: `${[-6, -2, 70, 74][i]}%` }}
            initial={{ opacity: 0, scale: 0 }}
            animate={reduce ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1, y: [0, -8, 0] }}
            transition={{
              opacity: { delay: 0.4 + i * 0.1 },
              scale: { ...spring.bouncy, delay: 0.4 + i * 0.1 },
              y: { duration: 2.2 + i * 0.3, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 },
            }}
          >
            {glyph}
          </motion.span>
        ))}
      </div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.3 }}>
        <h1 className="font-display text-5xl font-extrabold tracking-tight [font-stretch:92%] sm:text-6xl">
          Trivia{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">
            Royale
          </span>
        </h1>
        <p className="mt-2 text-balance text-sm text-ink-300 sm:text-base">
          {ROUNDS} rounds · {QUESTION_MS / 1000} s each · fast answers and streaks score big
        </p>
      </motion.div>

      <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Players">
        {players.map((p, i) => (
          <motion.li
            key={p.id}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.4, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ ...spring.bouncy, delay: 0.45 + i * 0.06 }}
            className={cn(
              "glass flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs",
              p.id === me.id && "ring-1 ring-[var(--accent-from)]",
            )}
          >
            <Avatar person={p} size={24} />
            <span className="max-w-24 truncate font-semibold text-ink-100">{p.id === me.id ? "You" : playerName(p)}</span>
          </motion.li>
        ))}
      </ul>

      <Eyebrow>
        {isSpectator ? "Watching" : "Get ready"}
        <AnimatedDots />
      </Eyebrow>
    </Screen>
  );
}

function playerName(p: PlayerInfo): string {
  return p.isBot ? p.name : `@${p.handle}`;
}

/* ---------------------------------------------------------------------- */
/* Game                                                                   */
/* ---------------------------------------------------------------------- */

function Game() {
  const xapps = useXApps();
  const { players, me, isSpectator } = usePlayers();
  const online = usePresence();
  const reduce = useReducedMotion();

  // Spectating a table of bots only happens in the mock host: nobody seated can
  // drive, so this client simulates the table locally (and never writes).
  const [sim] = useState(() => isSpectator && players.length > 0 && players.every((p) => p.isBot));
  const { store, snapshot } = useTriviaStore(xapps, sim);
  const questions = useMemo(() => buildQuestions(xapps.random), [xapps]);

  const seats = useMemo<Seat[]>(() => players.map((p) => ({ id: p.id, seat: p.seat, isBot: p.isBot })), [players]);
  const ids = useMemo(() => players.map((p) => p.id), [players]);
  const state = snapshot.state;
  const { current, previous } = useMemo(() => tables(questions, state, ids), [questions, state, ids]);
  const meSeated = !isSpectator && ids.includes(me.id);
  const meId = meSeated ? me.id : null;

  const { answer } = useTriviaEngine({
    xapps,
    store,
    snapshot,
    questions,
    seats,
    online,
    meId: me.id,
    canWrite: meSeated || sim,
    sim,
    standings: current,
  });

  // Reveal → leaderboard after the answer has sunk in (not after the last round).
  const boardAt = state?.phase === "reveal" && state.round < ROUNDS ? snapshot.anchor + REVEAL_MS : Infinity;
  const boardTime = useDeadline(boardAt);

  const view = !state
    ? "wait"
    : state.phase === "final"
      ? "final"
      : state.phase === "reveal" && boardTime
        ? `board-${state.round}`
        : `q-${state.round}`;

  const question = state ? questions[state.round - 1] : undefined;

  return (
    <div className="relative mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <Header state={state} question={question} spectator={isSpectator} />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          {view === "wait" && (
            <motion.div
              key="wait"
              className="flex flex-1 items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Eyebrow>
                Shuffling questions
                <AnimatedDots />
              </Eyebrow>
            </motion.div>
          )}
          {view.startsWith("q-") && state && question && (
            <QuestionStage
              key={view}
              question={question}
              state={state}
              anchor={snapshot.anchor}
              players={players}
              meId={meId}
              standings={current}
              onAnswer={answer}
              reduce={!!reduce}
            />
          )}
          {view.startsWith("board-") && state && (
            <Leaderboard
              key={view}
              round={state.round}
              players={players}
              meId={meId}
              current={current}
              previous={previous}
            />
          )}
          {view === "final" && <Final key="final" players={players} meId={meId} standings={current} />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Header                                                                 */
/* ---------------------------------------------------------------------- */

function Header({ state, question, spectator }: { state: TriviaState | null; question: Question | undefined; spectator: boolean }) {
  const round = state?.round ?? 0;
  const meta = question ? CATEGORY_META[question.category] : null;
  const final = state?.phase === "final";
  return (
    <header className="flex h-12 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <div className="glass-strong flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3" aria-live="polite">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-300">{final ? "Final" : "Round"}</span>
          {!final && (
            <span className="font-display text-base font-extrabold leading-none tabular">
              <span className="relative inline-block overflow-hidden align-bottom">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={round}
                    className="inline-block"
                    initial={{ y: 18, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -18, opacity: 0 }}
                    transition={spring.snappy}
                  >
                    {Math.max(1, round)}
                  </motion.span>
                </AnimatePresence>
              </span>
              <span className="text-ink-500">/{ROUNDS}</span>
            </span>
          )}
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          {meta && !final && (
            <motion.span
              key={meta.label}
              initial={{ opacity: 0, x: -12, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 12, scale: 0.9, transition: { duration: 0.15 } }}
              transition={spring.bouncy}
              className="inline-flex h-8 min-w-0 items-center gap-1.5 truncate rounded-full px-3 text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}
            >
              <span aria-hidden className="text-sm">
                {meta.icon}
              </span>
              <span className="truncate max-[360px]:hidden">{meta.label}</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {question?.double && !final && <DoubleBadge />}
        {spectator && (
          <span className="glass inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-200">
            <span aria-hidden>👀</span> Watching
          </span>
        )}
      </div>
    </header>
  );
}

/* ---------------------------------------------------------------------- */
/* Question + reveal                                                      */
/* ---------------------------------------------------------------------- */

const CHEERS = ["Correct!", "Nailed it!", "Big brain!", "Too easy!", "Sharp!"];
const JEERS = ["Not quite", "So close!", "Nope!"];

function QuestionStage({
  question,
  state,
  anchor,
  players,
  meId,
  standings,
  onAnswer,
  reduce,
}: {
  question: Question;
  state: TriviaState;
  anchor: number;
  players: PlayerInfo[];
  meId: string | null;
  standings: Standing[];
  onAnswer: (choice: number) => void;
  reduce: boolean;
}) {
  const xapps = useXApps();
  const revealed = state.phase === "reveal";
  const [pick, setPick] = useState<number | null>(null);
  // The question-phase anchor is kept for the clock; the reveal has its own.
  const [questionAnchor] = useState(anchor);
  const timeUp = useDeadline(questionAnchor + INTRO_MS + QUESTION_MS);
  const mine = meId ? state.answers[meId] : undefined;
  const myChoice = mine?.choice ?? pick;
  const canPick = !!meId && !revealed && myChoice === null && !timeUp;
  const meta = CATEGORY_META[question.category];

  const pickTile = (choice: number) => {
    if (!canPick) return;
    setPick(choice);
    onAnswer(choice);
    play("pop");
    xapps.ui.haptic("medium").catch(ignore);
  };

  // 1–4 keyboard shortcuts.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= question.choices.length) {
      event.preventDefault();
      pickTile(n - 1);
    }
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sounds: the card lands; others lock in; the reveal.
  useEffect(() => {
    play("whoosh");
  }, []);
  const answeredCount = Object.keys(state.answers).length;
  const lastCount = useRef(answeredCount);
  useEffect(() => {
    if (answeredCount > lastCount.current && !revealed) play("tick");
    lastCount.current = answeredCount;
  }, [answeredCount, revealed]);

  const myResult = meId ? standings.find((s) => s.id === meId)?.results[question.round - 1] : undefined;
  useEffect(() => {
    if (!revealed) return;
    if (!meId) {
      play("notify");
      return;
    }
    if (myResult?.correct) {
      play("vote");
      xapps.ui.haptic("success").catch(ignore);
    } else {
      play(myResult?.choice === null ? "thump" : "error");
      xapps.ui.haptic("error").catch(ignore);
    }
    // Once per reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);

  const counts = choiceCounts(state.answers, question.choices.length);
  const pickersOf = (i: number) => players.filter((p) => state.answers[p.id]?.choice === i);
  const statusOf = (i: number): TileStatus => {
    if (revealed) {
      if (i === question.correct) return "correct";
      return i === myChoice ? "wrong-pick" : "wrong";
    }
    if (myChoice !== null) return i === myChoice ? "locked" : "muted";
    if (meId && timeUp) return "muted";
    return "idle";
  };

  const marks: Record<string, SeatMark> = {};
  for (const p of players) {
    const a = state.answers[p.id];
    marks[p.id] = revealed
      ? a
        ? a.choice === question.correct
          ? "correct"
          : "wrong"
        : "missed"
      : a || (p.id === meId && pick !== null)
        ? "answered"
        : "waiting";
  }
  const answered = players.filter((p) => state.answers[p.id] || (p.id === meId && pick !== null)).length;

  return (
    <motion.section
      className="flex min-h-0 flex-1 flex-col gap-3 pt-1"
      aria-label={`Round ${question.round} of ${ROUNDS}`}
      exit={
        reduce
          ? { opacity: 0, transition: { duration: 0.15 } }
          : { opacity: 0, y: -24, scale: 0.96, filter: "blur(10px)", transition: { duration: 0.28, ease: ease.inOutQuart } }
      }
    >
      <AnsweredRow
        players={players}
        marks={marks}
        meId={meId}
        label={
          <>
            {answered}/{players.length}
          </>
        }
      />

      {/* Card + answers, centred together so the eye never has to jump */}
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 sm:gap-2">
        <div className="relative flex flex-col">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[min(90vw,30rem)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
            style={{ background: `radial-gradient(circle, ${meta.color}, transparent 65%)` }}
          />
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 36, scale: 0.9, rotateX: 18, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0, filter: "blur(0px)" }}
            transition={{ ...spring.soft, stiffness: 240, filter: BLUR_TWEEN }}
            className="glass-strong relative overflow-hidden rounded-[1.75rem] px-5 pb-6 pt-5 shadow-[0_30px_80px_-40px_var(--accent-to)] sm:px-7 sm:pb-8 sm:pt-6 [@media(max-height:640px)]:py-3"
            style={{ transformPerspective: 900 }}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-40"
              style={{ background: `linear-gradient(180deg, color-mix(in oklab, ${meta.color} 45%, transparent), transparent)` }}
            />
            <div className="relative flex items-start gap-3">
              <p className="min-w-0 flex-1 font-display text-[clamp(1.25rem,5.4vw,1.9rem)] font-extrabold leading-[1.15] tracking-tight [text-wrap:balance] [@media(max-height:640px)]:text-lg">
                {question.text}
              </p>
              <div className="relative -mr-1 -mt-1 shrink-0" style={{ width: CLOCK_SIZE, height: CLOCK_SIZE }}>
                <AnimatePresence initial={false}>
                  {revealed ? (
                    <motion.div
                      key="verdict"
                      className="absolute inset-0"
                      initial={{ scale: 0, rotate: -120 }}
                      animate={{ scale: 1, rotate: 0 }}
                      transition={spring.wobbly}
                    >
                      <Verdict result={myResult} spectator={!meId} />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="clock"
                      className="absolute inset-0"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.3, opacity: 0, transition: { duration: 0.15 } }}
                      transition={{ ...spring.bouncy, delay: 0.2 }}
                    >
                      <QuestionClock anchor={questionAnchor} running={!revealed} size={CLOCK_SIZE} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
            {!revealed && <TimeBar anchor={questionAnchor} running />}
          </motion.div>

          {/* Verdict line under the card */}
          <div className="flex h-9 items-center justify-center" aria-live="polite">
            <AnimatePresence mode="wait">
              {revealed ? (
                <motion.p
                  key="verdict"
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={spring.bouncy}
                  className="flex items-center gap-2 text-sm font-semibold"
                >
                  <VerdictLine result={myResult} question={question} spectator={!meId} counts={counts} players={players.length} />
                </motion.p>
              ) : myChoice !== null ? (
                <motion.p
                  key="locked"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={spring.snappy}
                  className="text-sm font-semibold text-ink-200"
                >
                  Locked in · waiting for the others
                  <AnimatedDots />
                </motion.p>
              ) : meId && timeUp ? (
                <motion.p key="late" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm font-semibold text-danger">
                  Time&apos;s up!
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        {/* Tiles (the row gap leaves room for the reveal's picker avatars) */}
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3.5 pb-2 sm:gap-x-3 sm:gap-y-4">
          {question.choices.map((choice, i) => (
            <AnswerTile
              key={choice}
              index={i}
              text={choice}
              status={statusOf(i)}
              interactive={canPick}
              onPick={pickTile}
              count={revealed || !meId ? (counts[i] ?? 0) : null}
              share={players.length ? (counts[i] ?? 0) / players.length : 0}
              pickers={revealed ? pickersOf(i) : []}
            />
          ))}
        </div>
        <p
          className={cn(
            "hidden text-center text-[11px] text-ink-400 transition-opacity [@media(pointer:fine)_and_(min-height:640px)]:block",
            meId && !canPick && "opacity-0",
          )}
        >
          {meId ? (
            <>
              Press <kbd className="rounded bg-white/10 px-1 font-mono">1</kbd>–<kbd className="rounded bg-white/10 px-1 font-mono">4</kbd> to answer
            </>
          ) : (
            "Live picks per answer"
          )}
        </p>
      </div>
    </motion.section>
  );
}

function Verdict({ result, spectator }: { result: Standing["results"][number] | undefined; spectator: boolean }) {
  const good = !!result?.correct;
  return (
    <div
      className={cn(
        "flex size-full items-center justify-center rounded-full",
        spectator
          ? "bg-white/10 text-2xl"
          : good
            ? "bg-success text-ink-950 shadow-[0_0_30px_-4px_var(--color-success)]"
            : "bg-danger text-white shadow-[0_0_30px_-6px_var(--color-danger)]",
      )}
      role="status"
      aria-label={spectator ? "Revealed" : good ? "Correct" : result?.choice === null ? "Time's up" : "Wrong"}
    >
      {spectator ? (
        <span aria-hidden>💡</span>
      ) : good ? (
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.3 }} />
        </svg>
      ) : result?.choice === null ? (
        <span className="text-2xl leading-none" aria-hidden>
          ⏰
        </span>
      ) : (
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" aria-hidden>
          <motion.path d="M7 7l10 10" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18 }} />
          <motion.path d="M17 7L7 17" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.18, delay: 0.1 }} />
        </svg>
      )}
    </div>
  );
}

function VerdictLine({
  result,
  question,
  spectator,
  counts,
  players,
}: {
  result: Standing["results"][number] | undefined;
  question: Question;
  spectator: boolean;
  counts: number[];
  players: number;
}) {
  const pickFrom = (list: string[]) => list[question.round % list.length] ?? list[0];
  if (spectator) {
    const right = counts[question.correct] ?? 0;
    return (
      <span className="text-ink-200">
        <b className="text-success">{right}</b> of {players} got it right
      </span>
    );
  }
  if (result?.correct) {
    return (
      <>
        <span className="text-success">{pickFrom(CHEERS)}</span>
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: [0.4, 1.35, 1], opacity: 1 }}
          transition={{ duration: 0.5, ease: ease.outBack, delay: 0.1 }}
          className="font-display text-lg font-extrabold tabular text-success [text-shadow:0_0_18px_var(--color-success)]"
        >
          +{result.points.toLocaleString("en")}
        </motion.span>
        <StreakChip streak={result.streak} />
        {result.ms !== null && <span className="font-mono text-xs tabular text-ink-400">{(result.ms / 1000).toFixed(1)}s</span>}
      </>
    );
  }
  return (
    <>
      <span className="text-danger">{result?.choice === null ? "Time's up!" : pickFrom(JEERS)}</span>
      <span className="truncate text-ink-300">
        It was <b className="text-ink-50">{question.choices[question.correct]}</b>
      </span>
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Leaderboard shuffle                                                    */
/* ---------------------------------------------------------------------- */

function Leaderboard({
  round,
  players,
  meId,
  current,
  previous,
}: {
  round: number;
  players: PlayerInfo[];
  meId: string | null;
  current: Standing[];
  previous: Standing[];
}) {
  const reduce = useReducedMotion();
  // Rows land in the old order with the old totals, then shuffle into the new one.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      setSettled(true);
      play("whoosh");
    }, reduce ? 150 : 650);
    return () => clearTimeout(id);
  }, [reduce]);

  const rows = settled ? current : previous;
  const prevRank = new Map(previous.map((s) => [s.id, s.rank]));
  const nowById = new Map(current.map((s) => [s.id, s]));
  const byId = new Map(players.map((p) => [p.id, p]));
  const compact = players.length > 5;

  return (
    <motion.section
      className="flex min-h-0 flex-1 flex-col justify-center pb-6 pt-2"
      aria-label={`Standings after round ${round}`}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 30, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -20, filter: "blur(8px)", transition: { duration: 0.25 } }}
      transition={spring.soft}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-2xl font-extrabold tracking-tight">Standings</h2>
        <Eyebrow>
          after round {round}/{ROUNDS}
        </Eyebrow>
      </div>
      <LayoutGroup>
        <ol className={cn("no-scrollbar flex min-h-0 shrink flex-col overflow-y-auto", compact ? "gap-1.5" : "gap-2")}>
          {rows.map((row, i) => {
            const player = byId.get(row.id);
            if (!player) return null;
            const now = nowById.get(row.id) ?? row;
            const rank = settled ? now.rank : (prevRank.get(row.id) ?? now.rank);
            // Everyone starts tied at 0, so movement only means something from round 2.
            const moved = round > 1 ? (prevRank.get(row.id) ?? now.rank) - now.rank : 0;
            const isMe = row.id === meId;
            const result = now.results[round - 1];
            return (
              <motion.li
                key={row.id}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  layout: spring.layout,
                  opacity: { duration: 0.2, delay: i * 0.05 },
                  x: { ...spring.soft, delay: i * 0.05 },
                }}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-2xl border px-3",
                  compact ? "py-1.5" : "py-2.5",
                  isMe
                    ? "border-[color-mix(in_oklab,var(--accent-from)_60%,transparent)] bg-[color-mix(in_oklab,var(--accent-from)_10%,var(--color-ink-850))] shadow-[0_10px_40px_-18px_var(--accent-from)]"
                    : "glass border-white/[0.07]",
                )}
              >
                <RankBadge rank={rank} />
                <Avatar person={player} size={compact ? 28 : 34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={cn("truncate text-sm font-bold", isMe ? "text-ink-50" : "text-ink-100")}>
                      {isMe ? "You" : playerName(player)}
                    </span>
                    {settled && now.streak >= 2 && <StreakChip streak={now.streak} />}
                  </div>
                  {!compact && (
                    <span className="text-[11px] text-ink-400">
                      {now.correct}/{round} correct
                    </span>
                  )}
                </div>
                <AnimatePresence>
                  {settled && moved !== 0 && (
                    <motion.span
                      initial={{ opacity: 0, y: moved > 0 ? 8 : -8, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ ...spring.bouncy, delay: 0.25 }}
                      className={cn("font-mono text-[11px] font-bold", moved > 0 ? "text-success" : "text-danger")}
                      aria-label={moved > 0 ? `up ${moved}` : `down ${-moved}`}
                    >
                      {moved > 0 ? "▲" : "▼"}
                      {Math.abs(moved)}
                    </motion.span>
                  )}
                </AnimatePresence>
                <DeltaChip result={result} />
                <span className="w-16 text-right font-display text-lg font-extrabold tabular">
                  <TickingNumber value={settled ? now.total : (previous.find((s) => s.id === row.id)?.total ?? 0)} />
                </span>
              </motion.li>
            );
          })}
        </ol>
      </LayoutGroup>
      <NextUp round={round} />
    </motion.section>
  );
}

function NextUp({ round }: { round: number }) {
  const next = round + 1;
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2 }}
      className="mt-3 text-center text-xs font-semibold text-ink-300"
    >
      {next >= ROUNDS ? (
        <>
          Up next: <b className="text-[var(--color-gold)]">final round · double points</b>
        </>
      ) : (
        <>
          Round {next} coming up
          <AnimatedDots />
        </>
      )}
    </motion.p>
  );
}

/* ---------------------------------------------------------------------- */
/* Final                                                                  */
/* ---------------------------------------------------------------------- */

function Final({ players, meId, standings }: { players: PlayerInfo[]; meId: string | null; standings: Standing[] }) {
  const xapps = useXApps();
  const reduce = useReducedMotion();
  const byId = new Map(players.map((p) => [p.id, p]));
  const entries = standings.flatMap((s) => {
    const player = byId.get(s.id);
    return player ? [{ player, standing: s }] : [];
  });
  const mine = meId ? standings.find((s) => s.id === meId) : undefined;
  const winners = standings.filter((s) => s.rank === 1);
  const winner = winners.length === 1 ? byId.get(winners[0]!.id) : undefined;

  useEffect(() => {
    if (!mine) {
      play("win");
      return;
    }
    if (mine.rank === 1) {
      play("win");
      xapps.ui.celebrate("big").catch(ignore);
    } else if (mine.rank <= 3) {
      play("notify");
    } else {
      play("lose");
    }
    // Once, when the podium appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rest = entries.slice(3);

  return (
    <motion.section
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 pt-2"
      aria-label="Final standings"
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring.soft}
    >
      <motion.div
        className="text-center"
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.1 }}
      >
        <Eyebrow>Final standings</Eyebrow>
        <h2 className="mt-1 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          {winners.length > 1
            ? "A tie at the top!"
            : winner?.id === meId
              ? "You take the crown!"
              : `${winner ? (winner.isBot ? winner.name : `@${winner.handle}`) : "Someone"} takes the crown`}
        </h2>
      </motion.div>

      <div className="mt-8 w-full">
        <Podium entries={entries} meId={meId} />
      </div>

      {rest.length > 0 && (
        <ol className="flex w-full flex-wrap justify-center gap-1.5">
          {rest.map(({ player, standing }, i) => (
            <motion.li
              key={player.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 1.3 + i * 0.06 }}
              className={cn(
                "glass flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs",
                player.id === meId && "ring-1 ring-[var(--accent-from)]",
              )}
            >
              <RankBadge rank={standing.rank} className="size-5 text-[11px]" />
              <Avatar person={player} size={20} />
              <span className="max-w-20 truncate font-semibold">{player.id === meId ? "You" : playerName(player)}</span>
              <span className="font-mono tabular text-ink-300">{standing.total.toLocaleString("en")}</span>
            </motion.li>
          ))}
        </ol>
      )}

      {mine && (
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 1.5 }}
          className="glass-strong rounded-2xl px-4 py-2.5 text-center text-sm text-ink-200"
        >
          You finished <b className="text-ink-50">{ordinal(mine.rank)}</b> of {standings.length} ·{" "}
          <b className="font-mono tabular text-ink-50">{mine.total.toLocaleString("en")}</b> pts · {mine.correct}/{ROUNDS} correct
          {mine.bestStreak >= 2 && <> · best streak {mine.bestStreak}</>}
        </motion.p>
      )}
    </motion.section>
  );
}
