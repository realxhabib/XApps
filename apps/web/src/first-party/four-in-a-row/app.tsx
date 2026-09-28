"use client";

import { useXApps } from "@xapps/sdk/react";
import { AnimatePresence, LayoutGroup, motion, useAnimate, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { AnimatedDots, Eyebrow } from "../shared/ui";
import { Board, DiscDefs, DiscShape, useBoardIds } from "./board";
import { SEAT_COLORS, VIEW_H, VIEW_W, dropPlan } from "./geometry";
import { COLS, ROWS, type Seat } from "./logic";
import { PlayerCard, useTurnRemaining, type CardResult } from "./players";
import { useFourInARow, type FourInARow } from "./use-game";

const noop = () => {};
const FOOTER_H = 32;
/** Vertical padding + gaps around the tall layout's group. */
const TALL_CHROME = 12 + 8 + 16 + 6;
/** Don't let the board get silly-big on portrait tablets. */
const TALL_MAX_W = 620;

export function FourInARowApp() {
  const xapps = useXApps();
  const game = useFourInARow();

  const readied = useRef(false);
  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    xapps.ready().catch(noop);
  }, [xapps]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {game.started ? (
        <motion.div
          key="game"
          className="flex h-dvh w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <GameView g={game} />
        </motion.div>
      ) : (
        <motion.div
          key="pregame"
          className="flex h-dvh w-full"
          exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
          transition={{ duration: 0.25 }}
        >
          <PreGame g={game} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------------ */
/* Pre-game                                                                 */
/* ------------------------------------------------------------------------ */

function PreGame({ g }: { g: FourInARow }) {
  const reduced = useReducedMotion() ?? false;
  const ids = useBoardIds();
  const discs: Seat[] = [0, 1, 0, 1];
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-6 text-center">
      <svg viewBox="0 0 440 110" className="h-16 w-auto overflow-visible [@media(max-height:520px)]:hidden" aria-hidden>
        <defs>
          <DiscDefs ids={ids} />
        </defs>
        {discs.map((seat, i) => (
          <g key={i} transform={`translate(${55 + i * 110} 55)`}>
            <motion.g
              initial={{ y: -140, opacity: 0 }}
              animate={reduced ? { y: 0, opacity: 1 } : { y: [-140, 0, -16, 0], opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.12, times: [0, 0.55, 0.75, 1], ease: "easeIn" }}
            >
              <motion.g
                animate={reduced ? undefined : { y: [0, -8, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, delay: 1.2 + i * 0.18, ease: "easeInOut" }}
              >
                <DiscShape seat={seat} ids={ids} r={46} />
              </motion.g>
            </motion.g>
          </g>
        ))}
      </svg>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.1 }}>
        <Eyebrow>{g.live ? "Live match" : "Practice"}</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          Four in a{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">Row</span>
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-ink-300">
          Drop discs in turn. Line up four — across, up or diagonal — to win. 30s per move.
        </p>
      </motion.div>

      <motion.div
        className="flex items-center gap-4"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring.bouncy, delay: 0.25 }}
      >
        {g.players.map((p, seat) => (
          <div key={p.id} className={cn("flex items-center gap-2", seat === 1 && "flex-row-reverse")}>
            <div className="relative">
              <Avatar person={p} size={44} />
              <span
                className="absolute -bottom-0.5 -right-0.5 size-4 rounded-full ring-2 ring-ink-900"
                style={{ background: SEAT_COLORS[seat as Seat].base }}
              />
            </div>
            <div className={cn("text-left", seat === 1 && "text-right")}>
              <p className="max-w-24 truncate text-sm font-semibold">{p.id === g.me?.id ? "You" : p.name}</p>
              <p className="text-[11px] text-ink-400">{seat === 0 ? "moves first" : SEAT_COLORS[1].name}</p>
            </div>
          </div>
        ))}
      </motion.div>
      <p className="text-sm font-medium text-ink-200">
        Get ready
        <AnimatedDots />
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Game                                                                     */
/* ------------------------------------------------------------------------ */

/** Measures an element with a ResizeObserver (callback ref, so it survives remounts). */
function useSize() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

function GameView({ g }: { g: FourInARow }) {
  const reduced = useReducedMotion() ?? false;
  const [rootRef, root] = useSize();
  const [stageRef, stage] = useSize();
  const [barRef, bar] = useSize();
  const [joltScope, animateJolt] = useAnimate<HTMLDivElement>();
  const { game, mySeat, oppSeat, outcome } = g;
  const buzz = useCallback(
    (style: "light" | "medium" | "heavy" | "success" | "error") => g.xapps.ui.haptic(style).catch(noop),
    [g.xapps],
  );

  /* -------------------------- aiming & dropping ------------------------- */

  const [aim, setAim] = useState(3);
  const aimRef = useRef(3);
  const [bump, setBump] = useState<{ col: number; key: number } | null>(null);
  const { myTurn, drop, aim: shareAim } = g;

  const moveAim = useCallback(
    (col: number) => {
      if (col === aimRef.current) return;
      aimRef.current = col;
      setAim(col);
      if (myTurn) play("tick");
      shareAim(col);
    },
    [myTurn, shareAim],
  );

  const tryDrop = useCallback(
    (col: number) => {
      if (!myTurn) return;
      const res = drop(col);
      if (res === "ok") {
        aimRef.current = col;
        setAim(col);
        play("pop");
        buzz("light");
      } else if (res === "column-full") {
        play("error");
        buzz("error");
        setBump({ col, key: Date.now() });
      }
    },
    [myTurn, drop, buzz],
  );

  // Keyboard: ←/→ aim, Enter/Space drop, 1–7 drop straight into a column.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const next = Math.max(0, Math.min(COLS - 1, aimRef.current + (e.key === "ArrowLeft" ? -1 : 1)));
        moveAim(next);
        // Keep keyboard focus in step with the ghost.
        if (target?.dataset.col !== undefined) {
          target.parentElement?.querySelector<HTMLButtonElement>(`[data-col="${next}"]`)?.focus();
        }
      } else if (/^[1-7]$/.test(e.key)) {
        e.preventDefault();
        if (e.repeat) return;
        const col = Number(e.key) - 1;
        moveAim(col);
        tryDrop(col);
      } else if (e.key === "Enter" || e.key === " ") {
        // A focused column button handles its own activation.
        if (target?.closest("button")) return;
        e.preventDefault();
        if (!e.repeat) tryDrop(aimRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moveAim, tryDrop]);

  /* ------------------------- landing & win effects ---------------------- */

  const [landed, setLanded] = useState(0);
  const discCount = game.discs.length;
  const lastDisc = game.discs[discCount - 1];
  useEffect(() => {
    if (!lastDisc) return;
    const plan = dropPlan(lastDisc.row, reduced);
    const timer = setTimeout(() => {
      setLanded(lastDisc.n + 1);
      // Nearly-full columns land with a heavier thud.
      const heavy = lastDisc.row >= ROWS - 2;
      play("thump");
      if (heavy) play("thump");
      buzz(heavy ? "medium" : "light");
      if (!reduced && joltScope.current) {
        const k = heavy ? 1.6 : 1;
        animateJolt(joltScope.current, { y: [0, 5 * k, -1.5 * k, 0], rotate: [0, (lastDisc.col - 3) * 0.12 * k, 0] }, { duration: 0.34, ease: "easeOut" });
      }
    }, plan.impactMs);
    return () => clearTimeout(timer);
  }, [lastDisc, reduced, buzz, animateJolt, joltScope]);

  const reveal = outcome !== null && (outcome.reason === "abandon" || landed >= discCount);
  const iLost = reveal && outcome?.winner === oppSeat;
  useEffect(() => {
    if (!reveal || !outcome) return;
    const won = outcome.winner === mySeat;
    const timer = setTimeout(
      () => {
        if (outcome.winner === null) {
          play("draw");
          buzz("medium");
        } else {
          play(won ? "win" : "lose");
          buzz(won ? "success" : "error");
        }
      },
      outcome.reason === "four" ? 380 : 60,
    );
    if (!won && outcome.winner !== null && !reduced && joltScope.current) {
      animateJolt(joltScope.current, { x: [0, -7, 6, -4, 3, 0] }, { duration: 0.5, delay: 0.35 });
    }
    return () => clearTimeout(timer);
    // Fire once when the result is revealed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  /* -------------------------------- layout ------------------------------ */

  const wide = root.width >= 640 && root.width / Math.max(1, root.height) >= 1.2;
  // Wide: the board fills the measured centre column. Tall: cards, board and
  // footer are sized to fit together and centred as one group.
  const scale = wide
    ? Math.min(stage.width / VIEW_W, stage.height / VIEW_H)
    : Math.min((root.width - 24) / VIEW_W, (root.height - bar.height - FOOTER_H - TALL_CHROME) / VIEW_H, TALL_MAX_W / VIEW_W);
  const boardW = Math.floor(VIEW_W * Math.max(0, scale));
  const boardH = Math.floor(VIEW_H * Math.max(0, scale));
  const laneFont = Math.max(20, Math.min(52, boardH * 0.075));

  const resultFor = (seat: Seat): CardResult => {
    if (!reveal || !outcome) return null;
    if (outcome.winner === null) return "draw";
    return outcome.winner === seat ? "win" : "lose";
  };
  const card = (seat: Seat, variant: "bar" | "side", mirror = false) => (
    <PlayerCard
      key={seat}
      player={g.players[seat]}
      seat={seat}
      isMe={seat === mySeat}
      active={g.playing && game.turn === seat}
      turnStartedAt={g.turnStartedAt}
      thinking={seat === oppSeat && g.opponentTurn}
      result={resultFor(seat)}
      online={seat === oppSeat && g.live ? g.opponentOnline : undefined}
      variant={variant}
      mirror={mirror}
      reduced={reduced}
    />
  );

  const board = boardW > 40 && (
    <motion.div
      className="relative"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 48, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={spring.soft}
    >
      {/* Accent glow under the board */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[8%] bottom-[4%] top-[22%] -z-10 rounded-[40%] opacity-50 blur-3xl"
        style={{ background: "radial-gradient(closest-side, var(--accent-from), transparent), radial-gradient(closest-side at 70% 60%, var(--accent-to), transparent)" }}
      />
      <div ref={joltScope}>
        <Board
          game={game}
          width={boardW}
          height={boardH}
          mySeat={mySeat}
          canPlay={myTurn}
          aim={aim}
          opponentTurn={g.opponentTurn}
          opponentAim={g.opponentAim}
          reveal={reveal}
          reduced={reduced}
          bump={bump}
          onAim={moveAim}
          onDrop={tryDrop}
          lane={<Lane g={g} reveal={reveal} fontSize={laneFont} reduced={reduced} />}
        />
      </div>
    </motion.div>
  );


  return (
    <div ref={rootRef} className={cn("relative flex w-full flex-1 select-none overflow-hidden", iLost && "saturate-[0.85]")}>
      <LayoutGroup id="fiar">
        {root.width === 0 ? null : wide ? (
          <div className="flex min-h-0 flex-1 items-center gap-4 px-4 py-4 lg:gap-8 lg:px-8">
            <motion.div
              className="flex w-40 shrink-0 lg:w-48"
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.soft, delay: 0.1 }}
            >
              {card(mySeat, "side")}
            </motion.div>
            <div className="flex h-full min-w-0 flex-1 flex-col gap-2">
              <div ref={stageRef} className="relative flex min-h-0 w-full flex-1 items-center justify-center">
                {board}
              </div>
              <Footer g={g} reveal={reveal} />
            </div>
            <motion.div
              className="flex w-40 shrink-0 lg:w-48"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...spring.soft, delay: 0.1 }}
            >
              {card(oppSeat, "side")}
            </motion.div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 pb-2 pt-3">
            <motion.div
              ref={barRef}
              className="flex w-full gap-2"
              style={{ maxWidth: Math.max(boardW, 296) }}
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring.soft, delay: 0.05 }}
            >
              {card(mySeat, "bar", false)}
              {card(oppSeat, "bar", true)}
            </motion.div>
            <div className="relative flex shrink-0 items-center justify-center" style={{ width: boardW, height: boardH }}>
              {board}
            </div>
            <Footer g={g} reveal={reveal} />
          </div>
        )}
      </LayoutGroup>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Lane banner: result / timeout notice over the ghost lane                 */
/* ------------------------------------------------------------------------ */

function Lane({ g, reveal, fontSize, reduced }: { g: FourInARow; reveal: boolean; fontSize: number; reduced: boolean }) {
  const { outcome, mySeat } = g;
  const lastIndex = g.game.moves.length - 1;
  const showTimeout = g.autoDropped !== null && g.autoDropped === lastIndex && !outcome;

  let title: string | null = null;
  let tone: "win" | "lose" | "draw" = "draw";
  if (reveal && outcome) {
    if (outcome.winner === null) title = "Draw!";
    else if (outcome.winner === mySeat) {
      title = outcome.reason === "abandon" ? "They left — you win" : "You win!";
      tone = "win";
    } else {
      title = `${g.players[outcome.winner]?.name ?? "They"} wins`;
      tone = "lose";
    }
  }

  return (
    <AnimatePresence mode="popLayout">
      {title ? (
        <motion.p
          key="result"
          role="status"
          className={cn(
            "whitespace-nowrap font-display font-extrabold tracking-tight drop-shadow-[0_6px_24px_rgb(0_0_0/0.6)]",
            tone === "win" && "bg-[linear-gradient(100deg,#fff,var(--accent-to)_55%,var(--accent-from))] bg-clip-text text-transparent",
            tone === "lose" && "text-ink-100",
            tone === "draw" && "text-ink-50",
          )}
          style={{ fontSize }}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -fontSize, scale: 0.6, rotate: -4 }}
          animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
          transition={{ ...spring.wobbly, delay: outcome?.reason === "four" ? 0.55 : 0.1 }}
        >
          {title}
        </motion.p>
      ) : showTimeout ? (
        <motion.p
          key={`timeout-${lastIndex}`}
          className="rounded-full bg-danger/90 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-white"
          initial={{ opacity: 0, y: 10, scale: 0.8 }}
          animate={{ opacity: [0, 1, 1, 0], y: [10, 0, 0, -8], scale: 1 }}
          transition={{ duration: 1.6, times: [0, 0.15, 0.75, 1] }}
        >
          Time&apos;s up — auto-dropped
        </motion.p>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------------ */
/* Footer: hints, last-5s warning, waiting / final state                    */
/* ------------------------------------------------------------------------ */

function Footer({ g, reveal }: { g: FourInARow; reveal: boolean }) {
  const remaining = useTurnRemaining(g.turnStartedAt, g.myTurn);
  const warn = g.myTurn && remaining <= 5_000;
  const opp = g.opponent;

  let key: string;
  let content: React.ReactNode;
  if (reveal && g.outcome) {
    if (g.result) {
      key = "final";
      content = <span className="text-ink-300">Final · {g.game.moves.length} moves</span>;
    } else if (g.submitted && opp && !opp.isBot && !opp.submitted) {
      key = "waiting";
      content = (
        <span className="flex items-center gap-2 text-ink-300">
          {opp && <Avatar person={opp} size={18} />}
          Waiting for <b className="text-ink-50">@{opp.handle}</b>
          <AnimatedDots />
        </span>
      );
    } else {
      key = "done";
      content = (
        <span className="text-ink-300">
          {g.outcome.reason === "four" ? `Four in a row · ${g.game.moves.length} moves` : g.outcome.reason === "draw" ? "Board full — honours even" : "Opponent timed out"}
        </span>
      );
    }
  } else if (warn) {
    key = "warn";
    content = (
      <motion.span
        className="flex items-center gap-2 rounded-full bg-danger/15 px-3 py-1 font-semibold text-danger ring-1 ring-danger/40"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ duration: 0.5, repeat: Infinity }}
      >
        <span className="font-mono tabular">{Math.ceil(remaining / 1000)}s</span> left — auto-drop incoming!
      </motion.span>
    );
  } else if (g.myTurn) {
    key = "hint";
    content = (
      <span className="text-ink-300">
        <span className="pointer-fine:hidden">Tap a column · drag to aim</span>
        <span className="hidden pointer-fine:inline">
          Click a column · <Key>←</Key>
          <Key>→</Key> + <Key>Enter</Key> · <Key>1</Key>–<Key>7</Key>
        </span>
      </span>
    );
  } else if (g.opponentTurn) {
    key = "opp";
    content = (
      <span className="text-ink-400">
        {g.live && !g.opponentOnline ? `@${opp?.handle ?? "opponent"} disconnected — waiting` : `@${opp?.handle ?? "opponent"} is thinking`}
        <AnimatedDots />
      </span>
    );
  } else {
    key = "idle";
    content = <span className="text-ink-400">…</span>;
  }

  return (
    <div className="flex shrink-0 items-center justify-center text-xs sm:text-sm" style={{ height: FOOTER_H }} aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={spring.snappy}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-flex min-w-5 items-center justify-center rounded-md border border-white/15 bg-white/[0.06] px-1 font-mono text-[11px] text-ink-100">
      {children}
    </kbd>
  );
}
