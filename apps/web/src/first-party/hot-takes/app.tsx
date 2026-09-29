"use client";

import type { PlayerInfo } from "@xapps/sdk";
import {
  useMatch,
  useMatchResult,
  useMatchStarted,
  useReactions,
  useRoomEvent,
  useXApps,
} from "@xapps/sdk/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { useBot, useLiveOpponent } from "@/first-party/shared/hooks";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { AnimatedDots } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { Composer, type OpponentState } from "./composer";
import { LockedView, type LockedPhase, type OpponentProgress } from "./locked";
import {
  BOT_AFTER_HUMAN_MS,
  BOT_MARK_MS,
  ROOM_SUBMITTED,
  ROOM_TYPING,
  TYPING_SEND_INTERVAL_MS,
  TYPING_VISIBLE_MS,
  botDueAt,
  botEntry,
  botTypingAt,
  buildEntry,
  createThrottle,
  entryToJson,
  hudStatus,
  lockInAchievements,
  lockInStats,
  onClockExpired,
  opposite,
  outcomeFor,
  randomBetween,
  resultProgress,
  setupMatch,
  sideForPlayer,
  timerFor,
  validateTake,
  type Phase,
} from "./logic";
import { hotTakeDisplay, type HotTakeEntry, type Spice } from "./prompts";
import { Reveal } from "./reveal";
import { Stage } from "./stage";
import { SIDE_THEME, SPICE_HEAT } from "./theme";

type Step = "reveal" | "compose" | "locked";
type HapticStyle = "light" | "medium" | "heavy" | "success" | "error";

const noop = () => {};

export function HotTakesApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const match = useMatch();
  const result = useMatchResult();
  const bot = useBot();
  const liveOpponent = useLiveOpponent();

  const me = xapps.me;
  const opponent = xapps.opponent;
  const setup = useMemo(() => setupMatch(xapps.random, xapps.match.settings), [xapps]);
  const mySide = sideForPlayer(setup.sides, xapps.players, me.id);
  const opponentSide = opposite(mySide);
  const rule = timerFor(xapps.match.mode);

  const [step, setStep] = useState<Step>(() => (xapps.me.submitted ? "locked" : "reveal"));
  const [text, setText] = useState("");
  const [spice, setSpice] = useState<Spice>(1);
  const [entry, setEntry] = useState<HotTakeEntry | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const [burst, setBurst] = useState(0);
  const [writingSince, setWritingSince] = useState<number | null>(null);
  const [humanAt, setHumanAt] = useState<number | null>(null);
  const [botSubmission, setBotSubmission] = useState<HotTakeEntry | null>(null);
  const [botTyping, setBotTyping] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerLocked, setPeerLocked] = useState(false);
  const [opponentWasDone] = useState(() => Boolean(xapps.opponent?.submitted));

  const lockedRef = useRef(Boolean(xapps.me.submitted));
  const textRef = useRef("");
  const typingThrottle = useRef<((now: number) => boolean) | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const botPlan = useRef<{ mark: number; after: number; phase: number; submitted: boolean } | null>(null);

  const haptic = (style: HapticStyle) => void xapps.ui.haptic(style).catch(noop);

  /* ---------------- lifecycle ---------------- */

  const readied = useRef(false);
  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    void xapps.ready().catch(noop);
  }, [xapps]);

  /* ---------------- opponent state ---------------- */

  const opponentRow = opponent ? match.players.find((p) => p.id === opponent.id) : undefined;
  const opponentSubmitted = Boolean(opponentRow?.submitted || peerLocked || botSubmission);
  const opponentTyping = !opponentSubmitted && (peerTyping || botTyping);

  const phase: Phase = !started
    ? "pregame"
    : result
      ? "result"
      : step === "reveal"
        ? "reveal"
        : step === "compose"
          ? "compose"
          : match.status === "voting" || opponentSubmitted
            ? "voting"
            : "waiting";

  // The crowd decided while we were here: wins and votes count once. A result
  // that was already in when the app opened was counted back then.
  const [settledAtOpen] = useState(() => xapps.finalResult !== null);
  const resultCounted = useRef(false);
  useEffect(() => {
    if (!result || settledAtOpen || resultCounted.current) return;
    resultCounted.current = true;
    const progress = resultProgress(result, me.id, opponent?.id, entry);
    reportStats(xapps, progress.stats, "hot-takes");
    unlockAchievements(xapps, progress.achievements, "hot-takes");
  }, [result, settledAtOpen, me.id, opponent?.id, entry, xapps]);

  // HUD status line.
  const status = hudStatus(phase, mySide, opponent?.handle);
  useEffect(() => {
    void xapps.ui.setStatus(status).catch(noop);
  }, [xapps, status]);

  // A little ping when the other side locks in while you're still going.
  const prevOpponentSubmitted = useRef(opponentSubmitted);
  useEffect(() => {
    if (opponentSubmitted && !prevOpponentSubmitted.current && started) {
      play("notify");
      void xapps.ui.haptic("light").catch(noop);
    }
    prevOpponentSubmitted.current = opponentSubmitted;
  }, [opponentSubmitted, started, xapps]);

  /* ---------------- live room ---------------- */

  useRoomEvent(ROOM_TYPING, (_payload, from) => {
    if (!liveOpponent || from !== liveOpponent.id) return;
    setPeerTyping(true);
    clearTimeout(peerTypingTimer.current);
    peerTypingTimer.current = setTimeout(() => setPeerTyping(false), TYPING_VISIBLE_MS);
  });
  useRoomEvent(ROOM_SUBMITTED, (_payload, from) => {
    if (!liveOpponent || from !== liveOpponent.id) return;
    setPeerLocked(true);
    setPeerTyping(false);
  });
  useEffect(() => () => clearTimeout(peerTypingTimer.current), []);

  /* ---------------- bot ---------------- */

  // Schedule the bot's submission: its random mark, or shortly after the
  // human locks in — whichever comes first. Re-plans when the human submits.
  useEffect(() => {
    if (!bot || !started || step === "reveal" || botSubmission) return;
    if (xapps.player(bot.id)?.submitted) return;
    botPlan.current ??= {
      mark: randomBetween(BOT_MARK_MS),
      after: randomBetween(BOT_AFTER_HUMAN_MS),
      phase: Math.random() * 7_000,
      submitted: false,
    };
    const plan = botPlan.current;
    const since = writingSince ?? performance.now();
    const due = botDueAt(plan.mark, humanAt === null ? null : humanAt - since, plan.after);

    const submitForBot = () => {
      if (plan.submitted || xapps.player(bot.id)?.submitted) return;
      plan.submitted = true;
      const botSide = sideForPlayer(setup.sides, xapps.players, bot.id);
      const take = botEntry(setup.prompt, botSide, Math.random);
      setBotSubmission(take);
      setBotTyping(false);
      xapps.submitFor(bot.id, { data: entryToJson(take), display: hotTakeDisplay(take) }).catch(() => {
        // Transient host hiccup: back off, then let this effect reschedule.
        setTimeout(() => {
          plan.submitted = false;
          setBotSubmission(null);
        }, 1_500);
      });
    };

    const timer = setTimeout(submitForBot, Math.max(0, due - (performance.now() - since)));
    // Cosmetic typing bursts while the bot "writes".
    const typing = setInterval(() => setBotTyping(botTypingAt(performance.now() - since, due, plan.phase)), 400);
    return () => {
      clearTimeout(timer);
      clearInterval(typing);
    };
  }, [bot, started, step, botSubmission, writingSince, humanAt, setup, xapps]);

  /* ---------------- composing ---------------- */

  // Reveal finished (or skipped): start the clock. Idempotent.
  const startWriting = () => {
    if (step !== "reveal") return;
    setWritingSince(performance.now());
    setStep("compose");
  };

  const onText = (next: string) => {
    textRef.current = next;
    setText(next);
    if (!liveOpponent) return;
    typingThrottle.current ??= createThrottle(TYPING_SEND_INTERVAL_MS);
    if (typingThrottle.current(performance.now())) void xapps.room.send(ROOM_TYPING, {}).catch(noop);
  };

  const submit = async (forced?: string) => {
    if (lockedRef.current) return;
    const check = validateTake(forced ?? textRef.current);
    if (!check.ok) {
      setShakeKey((k) => k + 1);
      play("error");
      haptic("error");
      return;
    }
    lockedRef.current = true;
    const remainingMs = writingSince === null ? null : rule.durationMs - (performance.now() - writingSince);
    const mine = buildEntry(setup.prompt.id, mySide, check.take, spice);
    setEntry(mine);
    setStep("locked");
    setHumanAt(performance.now());
    play("whoosh");
    try {
      await xapps.submit({ data: entryToJson(mine), display: hotTakeDisplay(mine) });
      if (liveOpponent) void xapps.room.send(ROOM_SUBMITTED, {}).catch(noop);
      reportStats(xapps, lockInStats(), "hot-takes");
      unlockAchievements(
        xapps,
        lockInAchievements({ take: mine.take, spice: mine.spice, remainingMs, forced: forced !== undefined }),
        "hot-takes",
      );
    } catch {
      lockedRef.current = false;
      setEntry(null);
      setHumanAt(null);
      setStep("compose");
      void xapps.ui.toast("Couldn't lock in your take — try again", "danger").catch(noop);
    }
  };

  // Clock ran out: live auto-submits whatever is written; soft clocks just nag.
  const onExpire = () => {
    const action = onClockExpired(rule, textRef.current);
    if (action.kind === "submit") void submit(action.take);
    else if (rule.hard && !lockedRef.current) {
      play("error");
      void xapps.ui.toast("Time! Type anything to lock in", "warning").catch(noop);
    }
  };

  const [reactions, setReactions] = useState<{ id: number; emoji: string; x: number }[]>([]);
  const reactionSeq = useRef(0);
  useReactions(({ emoji }) => {
    const id = ++reactionSeq.current;
    setReactions((list) => [...list.slice(-8), { id, emoji, x: 10 + Math.random() * 80 }]);
    setTimeout(() => setReactions((list) => list.filter((r) => r.id !== id)), 2_200);
  });

  /* ---------------- render ---------------- */

  const lockedPhase: LockedPhase = phase === "result" ? "result" : phase === "voting" ? "voting" : "waiting";
  const opponentProgress: OpponentProgress = opponentSubmitted ? "locked" : opponentTyping ? "typing" : "writing";
  const opponentState: OpponentState = opponentSubmitted
    ? opponentWasDone
      ? "earlier"
      : "locked"
    : opponentTyping
      ? "typing"
      : xapps.match.mode === "async"
        ? "later"
        : "idle";

  const outcome = result ? outcomeFor(result, me.id) : null;
  const heat =
    phase === "pregame"
      ? 0.2
      : phase === "reveal"
        ? 0.35
        : phase === "compose"
          ? SPICE_HEAT[spice].embers
          : outcome === "won"
            ? 1
            : outcome === "lost"
              ? 0.1
              : 0.35;
  const tint = phase === "pregame" ? undefined : SIDE_THEME[mySide].tint;

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden">
      <Stage heat={heat} tint={tint} burst={burst} />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <AnimatePresence mode="wait">
          {phase === "pregame" && (
            <Screen key="pregame">
              <Pregame me={me} opponent={opponent} />
            </Screen>
          )}
          {phase === "reveal" && (
            <Screen key="reveal">
              <Reveal
                prompt={setup.prompt}
                side={mySide}
                me={me}
                opponent={opponent}
                onDone={startWriting}
                onFlip={() => haptic("medium")}
              />
            </Screen>
          )}
          {phase === "compose" && (
            <Screen key="compose">
              <Composer
                prompt={setup.prompt}
                side={mySide}
                text={text}
                onText={onText}
                spice={spice}
                onSpice={setSpice}
                onSubmit={() => void submit()}
                timer={rule}
                onExpire={onExpire}
                opponent={opponent}
                opponentState={opponentState}
                shakeKey={shakeKey}
                haptic={haptic}
              />
            </Screen>
          )}
          {(phase === "waiting" || phase === "voting" || (phase === "result" && step !== "reveal")) && (
            <Screen key="locked">
              <LockedView
                prompt={setup.prompt}
                entry={entry}
                me={me}
                opponent={opponent}
                opponentSide={opponentSide}
                opponentProgress={opponentProgress}
                mode={xapps.match.mode}
                phase={lockedPhase}
                result={result}
                opponentEntry={botSubmission}
                onSlam={() => setBurst((b) => b + 1)}
                haptic={haptic}
              />
            </Screen>
          )}
        </AnimatePresence>
      </div>

      {/* Emoji reactions fired from the host HUD float up the stage. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.span
              key={r.id}
              className="absolute bottom-6 text-4xl"
              style={{ left: `${r.x}%` }}
              initial={{ y: 0, opacity: 0, scale: 0.4 }}
              animate={{ y: -260, opacity: [0, 1, 1, 0], scale: [0.4, 1.2, 1, 0.9], rotate: [0, -12, 10, 0] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, ease: "easeOut" }}
            >
              {r.emoji}
            </motion.span>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** Full-bleed phase container with a soft cross-fade between phases. */
function Screen({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex min-h-0 flex-1 flex-col"
      initial={{ opacity: 0, scale: 0.985, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.97, filter: "blur(10px)", transition: { duration: 0.22 } }}
      transition={spring.soft}
    >
      {children}
    </motion.div>
  );
}

function Pregame({ me, opponent }: { me: PlayerInfo; opponent?: PlayerInfo }) {
  const title = "HOT TAKES";
  return (
    <div className="m-auto flex w-full max-w-xl flex-col items-center px-6 py-8 text-center">
      <motion.div
        aria-hidden
        className="text-[clamp(3.5rem,12vh,5.5rem)] leading-none drop-shadow-[0_0_40px_rgb(255_120_50/0.7)]"
        initial={{ scale: 0, rotate: -20 }}
        animate={{ scale: [1, 1.08, 1], rotate: [-3, 3, -3] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      >
        🔥
      </motion.div>
      <h1
        aria-label="Hot Takes"
        className="mt-3 font-display font-extrabold leading-[0.9] tracking-tight"
        style={{ fontSize: "clamp(3rem, min(15vw, 12vh), 6.5rem)", fontVariationSettings: "'wdth' 75" }}
      >
        {Array.from(title).map((ch, i) => (
          <motion.span
            key={i}
            aria-hidden
            className="inline-block bg-[linear-gradient(180deg,#fff3d6,var(--accent-from)_55%,var(--accent-to))] bg-clip-text text-transparent"
            initial={{ opacity: 0, y: 40, rotate: i % 2 ? 8 : -8 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ ...spring.bouncy, delay: 0.05 * i }}
          >
            {ch === " " ? " " : ch}
          </motion.span>
        ))}
      </h1>
      <motion.p
        className="mt-3 max-w-sm text-balance text-[15px] text-ink-200"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...spring.soft, delay: 0.5 }}
      >
        One prompt. Opposite sides. 280 characters to win the crowd.
      </motion.p>
      <motion.div
        className="mt-6 flex items-center gap-4"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring.bouncy, delay: 0.65 }}
      >
        <PlayerTag player={me} tone="var(--accent-from)" />
        <span className="font-display text-xl font-extrabold italic text-white/80" style={{ textShadow: "0 0 18px var(--accent-to)" }}>
          VS
        </span>
        {opponent && <PlayerTag player={opponent} tone="var(--accent-to)" />}
      </motion.div>
      <p className="mt-6 text-sm font-medium text-ink-300">
        Get ready
        <AnimatedDots />
      </p>
    </div>
  );
}

function PlayerTag({ player, tone }: { player: PlayerInfo; tone: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="rounded-full p-[2px]" style={{ background: `linear-gradient(135deg, ${tone}, transparent)` }}>
        <Avatar person={player} size={48} />
      </span>
      <span className="max-w-[7rem] truncate text-xs font-semibold text-ink-200">@{player.handle}</span>
    </div>
  );
}
