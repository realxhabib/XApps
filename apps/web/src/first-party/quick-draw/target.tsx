"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, animate, motion, useAnimate, useMotionValue, useTransform } from "motion/react";
import { useEffect, useId } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { DuelView } from "./duel";
import { MAX_ROUNDS, classify, resultLabel, roundLabel, type RoundResult } from "./logic";

export type Face = "steady" | "sun" | "foul";

/** Which side of the disc faces the player. */
export function faceFor(view: DuelView): Face {
  const { phase, mine } = view;
  if (mine?.falseStart && (phase === "shot" || phase === "reveal")) return "foul";
  if (phase === "draw") return "sun";
  if ((phase === "shot" || phase === "reveal") && mine) return "sun";
  return "steady";
}

export interface Impact {
  id: number;
  kind: "nudge" | "hit" | "foul";
}

/** The target's size: as big as the viewport allows, leaving room for the scoreboard and footer. */
export const TARGET_SIZE = "clamp(196px, min(84vw, calc(100dvh - 250px)), 440px)";

export function Target({
  view,
  beat,
  impact,
  reduced,
  oppPlayer,
  oppName,
}: {
  view: DuelView;
  beat: number;
  impact: Impact | null;
  reduced: boolean;
  oppPlayer: PlayerInfo;
  oppName: string;
}) {
  const face = faceFor(view);
  const [scope, animateTarget] = useAnimate<HTMLDivElement>();

  // Heartbeat: a lub-dub squeeze on every beat.
  useEffect(() => {
    if (beat === 0 || reduced || !scope.current) return;
    animateTarget(scope.current, { scale: [1, 1.045, 0.995, 1.02, 1] }, { duration: 0.5, ease: "easeOut" });
  }, [beat, reduced, animateTarget, scope]);

  // Physical feedback: a squash on a good shot, a jolt on a foul, a wobble for "not yet".
  useEffect(() => {
    if (!impact || reduced || !scope.current) return;
    if (impact.kind === "hit") {
      animateTarget(scope.current, { scale: [0.9, 1.05, 1] }, { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] });
    } else {
      const amp = impact.kind === "foul" ? 12 : 6;
      animateTarget(
        scope.current,
        { x: [0, -amp, amp * 0.8, -amp * 0.5, amp * 0.25, 0], rotate: [0, -2, 1.5, -1, 0, 0] },
        { duration: impact.kind === "foul" ? 0.5 : 0.35, ease: "easeOut" },
      );
    }
  }, [impact, reduced, animateTarget, scope]);

  const ripples = view.phase === "steady" ? [beat - 2, beat - 1, beat].filter((b) => b > 0) : [];

  return (
    <div className="relative aspect-square" style={{ width: TARGET_SIZE }}>
      {/* Heat glow behind the disc */}
      <motion.div
        aria-hidden
        className="absolute -inset-[24%] rounded-full"
        initial={false}
        animate={{
          opacity: face === "sun" ? 0.85 : face === "foul" ? 0.6 : 0.14,
          scale: face === "steady" ? 0.75 : 1,
        }}
        transition={spring.soft}
        style={{
          background:
            face === "foul"
              ? "radial-gradient(circle closest-side, rgb(255 77 94 / 0.85), rgb(255 77 94 / 0.25) 60%, transparent)"
              : "radial-gradient(circle closest-side, var(--accent-from), rgb(255 122 26 / 0.45) 55%, rgb(255 122 26 / 0.12) 78%, transparent)",
        }}
      />

      <div ref={scope} className="relative size-full">
        {/* Heartbeat shock rings */}
        {ripples.map((b) => (
          <motion.span
            key={b}
            aria-hidden
            className="absolute inset-0 rounded-full border-2 border-[rgb(255_92_92/0.55)]"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: reduced ? 1 : 1.32, opacity: 0 }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
          />
        ))}

        {/* Pulses while DRAW is up and waiting for you */}
        <motion.div
          className="absolute inset-0"
          animate={view.phase === "draw" && !reduced ? { scale: [1, 1.045, 1] } : { scale: 1 }}
          transition={view.phase === "draw" ? { duration: 0.42, repeat: Infinity, ease: "easeInOut" } : spring.soft}
        >
          <Disc face={face} reduced={reduced} />
        </motion.div>

        <div className="@container absolute inset-0">
          <Readout view={view} reduced={reduced} oppPlayer={oppPlayer} oppName={oppName} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The disc: a dark gunsight on the front, a blazing sun on the back   */
/* ------------------------------------------------------------------ */

function Disc({ face, reduced }: { face: Face; reduced: boolean }) {
  const flipped = face === "sun";
  if (reduced) {
    // No 3D flip: a straight crossfade.
    return (
      <div className="absolute inset-0">
        <SteadyFace foul={face === "foul"} />
        <motion.div className="absolute inset-0" initial={false} animate={{ opacity: flipped ? 1 : 0 }} transition={{ duration: 0.15 }}>
          <SunFace />
        </motion.div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 perspective-[1400px]">
      <motion.div
        className="relative size-full transform-3d"
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={flipped ? { type: "spring", stiffness: 520, damping: 32 } : { type: "spring", stiffness: 260, damping: 26 }}
      >
        <div className="absolute inset-0 backface-hidden">
          <SteadyFace foul={face === "foul"} />
        </div>
        <div className="absolute inset-0 rotate-y-180 backface-hidden">
          <SunFace />
        </div>
      </motion.div>
    </div>
  );
}

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2;
  const major = i % 5 === 0;
  const r1 = major ? 84 : 89;
  const r2 = 94;
  return {
    x1: 100 + Math.sin(a) * r1,
    y1: 100 - Math.cos(a) * r1,
    x2: 100 + Math.sin(a) * r2,
    y2: 100 - Math.cos(a) * r2,
    major,
  };
});

/** Front: a dark bezel with ticks and a gunsight, tinted red on a false start. */
export function SteadyFace({ foul = false, sight = false }: { foul?: boolean; sight?: boolean }) {
  const id = `qd${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const line = foul ? "rgb(255 77 94 / 0.75)" : "rgb(255 255 255 / 0.22)";
  return (
    <div className="absolute inset-0 rounded-full shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]">
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <radialGradient id={`${id}-face`} cx="50%" cy="40%" r="68%">
            <stop offset="0%" stopColor="#1f2536" />
            <stop offset="62%" stopColor="#0f121b" />
            <stop offset="100%" stopColor="#07080d" />
          </radialGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(255 255 255 / 0.35)" />
            <stop offset="100%" stopColor="rgb(255 255 255 / 0.04)" />
          </linearGradient>
        </defs>
        <circle cx="100" cy="100" r="99" fill={`url(#${id}-face)`} stroke={`url(#${id}-rim)`} strokeWidth="1.2" />
        <g stroke={line} strokeLinecap="round" style={{ transition: "stroke 200ms" }}>
          {TICKS.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} strokeWidth={t.major ? 1.6 : 0.7} opacity={t.major ? 1 : 0.6} />
          ))}
        </g>
        <circle cx="100" cy="100" r="74" fill="none" stroke="rgb(255 255 255 / 0.07)" />
        <circle cx="100" cy="100" r="50" fill="none" stroke="rgb(255 255 255 / 0.09)" />
        <path d="M100 18 V70 M100 130 V182 M18 100 H70 M130 100 H182" stroke="rgb(255 255 255 / 0.1)" strokeWidth="0.8" />
        {/* The bullseye only on the idle target; in play the center carries text. */}
        {sight && (
          <>
            <circle cx="100" cy="100" r="26" fill="none" stroke="var(--accent-from)" strokeOpacity="0.4" strokeWidth="1.2" />
            <circle cx="100" cy="100" r="3.2" fill="var(--accent-from)" />
          </>
        )}
      </svg>
      <motion.div
        aria-hidden
        className="absolute inset-0 rounded-full"
        initial={false}
        animate={{ opacity: foul ? 1 : 0 }}
        transition={{ duration: 0.18 }}
        style={{
          background: "radial-gradient(circle at 50% 50%, rgb(255 77 94 / 0.22), rgb(110 0 14 / 0.5) 72%, rgb(255 77 94 / 0.35))",
          boxShadow: "inset 0 0 0 2px rgb(255 77 94 / 0.85), 0 0 60px -10px rgb(255 77 94 / 0.8)",
        }}
      />
    </div>
  );
}

/** Back: the accent sun with slow-turning rays. */
function SunFace() {
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-full"
      style={{
        background:
          "radial-gradient(circle at 50% 38%, #fffbe8 0%, var(--accent-from) 30%, #ffae34 58%, var(--accent-to) 84%, #e2520a 100%)",
        boxShadow: "inset 0 0 0 2px rgb(255 255 255 / 0.5), inset 0 -26px 60px rgb(170 40 0 / 0.35)",
      }}
    >
      <div
        aria-hidden
        className="absolute -inset-1/4 animate-[spin_14s_linear_infinite] opacity-30 motion-reduce:animate-none"
        style={{
          background: "repeating-conic-gradient(from 0deg, rgb(255 255 255 / 0.95) 0deg 3deg, transparent 3deg 15deg)",
          maskImage: "radial-gradient(circle, transparent 22%, #000 72%)",
        }}
      />
      <div aria-hidden className="absolute inset-[13%] rounded-full border border-ink-950/10" />
      <div aria-hidden className="absolute inset-[31%] rounded-full border border-ink-950/10" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What's written on the target                                       */
/* ------------------------------------------------------------------ */

const layer = "absolute inset-0 flex flex-col items-center justify-center text-center";

function Readout({
  view,
  reduced,
  oppPlayer,
  oppName,
}: {
  view: DuelView;
  reduced: boolean;
  oppPlayer: PlayerInfo;
  oppName: string;
}) {
  const { phase, round, mine, score } = view;
  const showResult = !!mine && (phase === "shot" || phase === "reveal");
  const label = roundLabel(round, score);
  return (
    <AnimatePresence initial={false}>
      {phase === "intro" && (
        <motion.div
          key={`intro-${round}`}
          className={layer}
          initial={{ opacity: 0, scale: 0.6, filter: "blur(10px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.2, filter: "blur(6px)", transition: { duration: 0.18 } }}
          transition={spring.bouncy}
        >
          <p
            className={cn(
              "text-[clamp(10px,4.4cqw,16px)] font-bold uppercase tracking-[0.3em]",
              label ? "text-[var(--accent-from)]" : "text-ink-300",
            )}
          >
            {label ?? "Round"}
          </p>
          <p className="font-display text-[36cqw] font-extrabold leading-[0.9] tracking-tight text-ink-50">{round}</p>
          <p className="text-[clamp(10px,3.8cqw,14px)] font-semibold uppercase tracking-[0.28em] text-ink-400">
            of {MAX_ROUNDS}
          </p>
        </motion.div>
      )}

      {phase === "steady" && (
        <motion.div
          key={`steady-${round}`}
          className={layer}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.05 } }}
          transition={spring.soft}
        >
          <p className="pl-[0.2em] font-display text-[13cqw] font-extrabold tracking-[0.2em] text-ink-50">STEADY</p>
          <p className="mt-[1cqw] text-[clamp(11px,4cqw,15px)] font-medium text-ink-300">
            wait for it
            <AnimatedDots />
          </p>
        </motion.div>
      )}

      {phase === "draw" && (
        <motion.div
          key={`draw-${round}`}
          className={layer}
          initial={{ opacity: 0, scale: reduced ? 1 : 3.2, filter: reduced ? "blur(0px)" : "blur(18px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.1 } }}
          transition={{
            scale: { type: "spring", stiffness: 640, damping: 24, mass: 0.9 },
            opacity: { duration: 0.08 },
            filter: { duration: 0.22 },
          }}
        >
          <p className="font-display text-[27cqw] font-extrabold leading-none tracking-[-0.04em] text-ink-950 [text-shadow:0_2px_0_rgb(255_255_255/0.35)]">
            DRAW!
          </p>
          <p className="mt-[2cqw] pl-[0.4em] text-[clamp(11px,4.4cqw,16px)] font-extrabold uppercase tracking-[0.4em] text-ink-950/70">
            Tap!
          </p>
        </motion.div>
      )}

      {showResult && mine && (
        <motion.div
          key={`result-${round}`}
          className={layer}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9, filter: "blur(6px)", transition: { duration: 0.2 } }}
          transition={spring.bouncy}
        >
          <MyResult result={mine} reduced={reduced} />
          <div className="mt-[3cqw] h-[clamp(24px,9cqw,34px)]">
            <OppChip result={view.opp} player={oppPlayer} name={oppName} onSun={!mine.falseStart} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MyResult({ result, reduced }: { result: RoundResult; reduced: boolean }) {
  const kind = classify(result);
  if (kind === "false-start") {
    return (
      <motion.p
        className="font-display text-[15.5cqw] font-extrabold uppercase leading-[0.88] tracking-tight text-danger [text-shadow:0_0_30px_rgb(255_77_94/0.6)]"
        initial={{ scale: reduced ? 1 : 1.8, rotate: 0 }}
        animate={{ scale: 1, rotate: reduced ? 0 : -4 }}
        transition={spring.wobbly}
      >
        Too
        <br />
        early
      </motion.p>
    );
  }
  if (kind === "miss") {
    return (
      <p className="font-display text-[15cqw] font-extrabold uppercase leading-[0.88] tracking-tight text-ink-950">
        Too
        <br />
        slow
      </p>
    );
  }
  return (
    <div className="flex flex-col items-center text-ink-950">
      <p className="text-[clamp(9px,3.4cqw,13px)] font-extrabold uppercase tracking-[0.3em] text-ink-950/60">Your draw</p>
      <p className="flex items-baseline font-mono font-bold leading-none tabular">
        <CountUp value={result.ms ?? 0} reduced={reduced} className="text-[25cqw] tracking-[-0.06em]" />
        <span className="ml-[1cqw] text-[7cqw] tracking-tight">ms</span>
      </p>
    </div>
  );
}

/** Mono digits that race up to the final value. */
function CountUp({ value, reduced, className }: { value: number; reduced: boolean; className?: string }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => String(Math.round(v)));
  useEffect(() => {
    if (reduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [mv, value, reduced]);
  return <motion.span className={className}>{text}</motion.span>;
}

/** The opponent's result sliding in under yours (or a "still aiming" placeholder). */
function OppChip({
  result,
  player,
  name,
  onSun,
}: {
  result: RoundResult | null;
  player: PlayerInfo;
  name: string;
  onSun: boolean;
}) {
  const chip = cn(
    "flex h-full items-center gap-[1.6cqw] rounded-full pl-[0.6cqw] pr-[3cqw] text-[clamp(11px,3.9cqw,15px)] font-semibold shadow-lg",
    onSun ? "bg-ink-950/85 text-ink-50" : "bg-white/12 text-ink-50 ring-1 ring-white/15",
  );
  const kind = result ? classify(result) : null;
  return (
    <AnimatePresence mode="wait" initial={false}>
      {result ? (
        <motion.div
          key="known"
          className={chip}
          initial={{ x: 56, opacity: 0, scale: 0.85 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          transition={spring.bouncy}
        >
          <Avatar person={player} size={22} />
          <span className="max-w-[26cqw] truncate text-ink-300">{name}</span>
          <span className={cn("font-mono font-bold tabular", kind === "false-start" ? "text-danger" : "text-ink-50")}>
            {resultLabel(result)}
          </span>
        </motion.div>
      ) : (
        <motion.div
          key="waiting"
          className={chip}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          <Avatar person={player} size={22} />
          <span className="max-w-[30cqw] truncate text-ink-300">{name}</span>
          <AnimatedDots />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
