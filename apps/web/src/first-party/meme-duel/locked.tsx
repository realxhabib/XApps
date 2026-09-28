"use client";

import type { MatchMode, PlayerInfo } from "@xapps/sdk";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { WaitingFor } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import type { Outcome } from "./logic";
import { Burst, CardBack, useBuzz } from "./pieces";
import { svgToDataUrl } from "./render";

/** What the locked screen shows: exactly the SVG that was submitted. */
export interface LockedMeme {
  svg: string;
  alt: string;
  /** Height / width of the canvas. */
  aspect: number;
}

/** Card width (--lc) keeps the whole card on screen whatever the meme's aspect ratio (--ar). */
const LOCKED_CSS = `
.mdl-locked { --lc: min(calc(100vw - 48px), calc((100dvh - 236px) / var(--ar)), 460px); --r: 24px; }`;

const INK = Array.from({ length: 10 }, (_, i) => {
  // Deterministic splatter so renders stay pure.
  const angle = (i / 10) * Math.PI * 2 + (i % 3) * 0.4;
  const d = 46 + ((i * 37) % 30);
  return { x: Math.cos(angle) * d, y: Math.sin(angle) * d * 0.6, size: 4 + ((i * 13) % 7) };
});

const WIN_BURST = ["😂", "🔥", "💯", "👑", "✨", "🏆"];

export function LockedScreen({
  meme,
  opponent,
  opponentLocked,
  opponentTyping,
  voting,
  outcome,
  mode,
}: {
  /** Null when we reloaded after submitting (we don't have the entry anymore). */
  meme: LockedMeme | null;
  opponent?: PlayerInfo;
  opponentLocked: boolean;
  opponentTyping: boolean;
  voting: boolean;
  outcome: Outcome | null;
  mode: MatchMode;
}) {
  const reduced = useReducedMotion() ?? false;
  const buzz = useBuzz();
  const [scope, animateCard] = useAnimate<HTMLDivElement>();
  const [slammed, setSlammed] = useState(false);
  const [settled, setSettled] = useState(false);
  const slamOnce = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const src = useMemo(() => (meme ? svgToDataUrl(meme.svg) : null), [meme]);

  const onStampLanded = () => {
    if (slamOnce.current) return;
    slamOnce.current = true;
    play("slam");
    buzz("heavy");
    setSlammed(true);
    // Hold the big stamp for a beat, then get it off the meme.
    settleTimer.current = setTimeout(() => setSettled(true), reduced ? 0 : 950);
    if (!reduced && scope.current) {
      void animateCard(scope.current, { x: [0, -9, 8, -5, 3, 0], y: [0, 5, -3, 2, 0], rotate: [0, -1.2, 1, -0.4, 0] }, { duration: 0.42 });
    }
  };

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // The crowd's verdict gets a little bounce (win) or a sad droop (loss) on the card itself.
  useEffect(() => {
    if (!outcome || reduced || !scope.current) return;
    if (outcome === "win") void animateCard(scope.current, { scale: [1, 1.08, 0.98, 1.02, 1], rotate: [0, -3, 2, 0] }, { duration: 0.7 });
    else if (outcome === "lose") void animateCard(scope.current, { rotate: [0, 4, 3], y: [0, 8, 6], filter: ["saturate(1)", "saturate(0.55)"] }, { duration: 0.8 });
  }, [outcome, reduced, animateCard, scope]);

  return (
    <motion.div
      className="mdl-locked flex h-full min-h-0 w-full flex-col items-center justify-center gap-5 px-6 py-5"
      style={{ "--ar": meme?.aspect ?? 1 } as CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <style>{LOCKED_CSS}</style>

      <div className="relative" style={{ width: "var(--lc)", height: "calc(var(--lc) * var(--ar))", perspective: 1200 }}>
        <div ref={scope} className="relative size-full">
          <motion.div
            className="relative size-full"
            style={{ transformStyle: "preserve-3d" }}
            // Continues the editor's exit spin (0 → 90°) from the other edge (-90° → 0).
            initial={reduced ? { opacity: 0 } : { rotateY: -90, scale: 0.9 }}
            animate={reduced ? { opacity: 1 } : { rotateY: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
          >
            <div
              className="absolute inset-0 overflow-hidden rounded-[var(--r)] bg-ink-800 shadow-[0_40px_90px_-30px_var(--accent-to),0_0_0_1px_rgb(255_255_255/0.12)]"
              style={{ backfaceVisibility: "hidden" }}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL, same as the Arena renders it
                <img src={src} alt={meme?.alt ?? ""} className="size-full select-none" draggable={false} />
              ) : (
                <div className="grid size-full place-items-center bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] text-center">
                  <div>
                    <p className="text-6xl">🖼️</p>
                    <p className="mt-3 font-display text-xl font-extrabold text-ink-950">Your meme is in</p>
                  </div>
                </div>
              )}
            </div>
            <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <CardBack />
            </div>
          </motion.div>

          {/* The stamp slams down big in the middle, then tucks itself onto the corner. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-10 flex",
              settled ? "items-start justify-end" : "items-center justify-center",
            )}
          >
            <motion.div layout transition={spring.soft} className={settled ? "-mr-5 -mt-10 sm:-mr-9" : undefined}>
              <motion.div
                initial={reduced ? { opacity: 0, scale: 0.74, rotate: -8 } : { scale: 3.4, opacity: 0, rotate: -34 }}
                animate={reduced ? { opacity: 1 } : { scale: settled ? 0.74 : 1.12, opacity: 1, rotate: settled ? -8 : -12 }}
                transition={
                  reduced
                    ? { duration: 0.2, delay: 0.3 }
                    : settled
                      ? spring.bouncy
                      : { delay: 0.5, duration: 0.2, ease: [0.7, 0, 0.84, 0] }
                }
                onAnimationComplete={onStampLanded}
                className="relative"
              >
                <div className="relative whitespace-nowrap rounded-2xl border-[3px] border-[var(--accent-from)] bg-ink-950/85 px-4 py-1.5 font-display text-3xl font-extrabold uppercase tracking-wide text-[var(--accent-from)] shadow-[0_14px_40px_-8px_rgb(0_0_0/0.7)] backdrop-blur-sm">
                  Locked in
                  <span aria-hidden className="absolute inset-1 rounded-xl border border-[var(--accent-from)]/40" />
                </div>
                {slammed && !reduced && (
                  <div aria-hidden className="absolute left-1/2 top-1/2">
                    {INK.map((dot, i) => (
                      <motion.span
                        key={i}
                        className="absolute rounded-full bg-[var(--accent-from)]"
                        style={{ width: dot.size, height: dot.size }}
                        initial={{ x: 0, y: 0, opacity: 0.9, scale: 1 }}
                        animate={{ x: dot.x * 1.6, y: dot.y * 1.6, opacity: 0, scale: 0.4 }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                      />
                    ))}
                  </div>
                )}
              </motion.div>
            </motion.div>
          </div>

          {outcome === "win" && <Burst items={WIN_BURST} count={18} distance={220} />}
        </div>
      </div>

      <div className="flex min-h-24 w-full max-w-sm flex-col items-center justify-start text-center" aria-live="polite">
        <AnimatePresence mode="wait">
          {outcome ? (
            <OutcomeBanner key={`outcome-${outcome}`} outcome={outcome} opponent={opponent} />
          ) : voting ? (
            <motion.div
              key="voting"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={spring.soft}
              className="flex flex-col items-center gap-2"
            >
              <motion.span
                className="text-4xl"
                animate={reduced ? undefined : { y: [0, -6, 0], rotate: [0, -6, 6, 0] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              >
                🗳️
              </motion.span>
              <p className="font-display text-lg font-bold tracking-tight">Your meme is in the Arena</p>
              <p className="flex items-center gap-2 text-sm text-ink-300">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 animate-ping-soft rounded-full bg-[var(--accent-from)]" />
                  <span className="relative size-2 rounded-full bg-[var(--accent-from)]" />
                </span>
                The crowd is voting
              </p>
            </motion.div>
          ) : opponentLocked ? (
            <motion.div
              key="both"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={spring.soft}
              className="flex flex-col items-center gap-2"
            >
              <span className="text-3xl">🤝</span>
              <p className="font-display text-lg font-bold tracking-tight">Both memes are in</p>
              <p className="text-sm text-ink-300">Sending them to the Arena…</p>
            </motion.div>
          ) : (
            <motion.div key={`waiting-${opponentTyping}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <WaitingFor
                player={opponent}
                text={
                  mode === "async" ? (
                    <>
                      <b className="text-ink-50">@{opponent?.handle ?? "opponent"}</b> hasn&apos;t played yet — you&apos;ll get a ping
                      when voting opens
                    </>
                  ) : opponentTyping ? (
                    <>
                      <b className="text-ink-50">@{opponent?.handle ?? "opponent"}</b> is still cooking
                    </>
                  ) : undefined
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function OutcomeBanner({ outcome, opponent }: { outcome: Outcome; opponent?: PlayerInfo }) {
  const copy =
    outcome === "win"
      ? { emoji: "🏆", title: "The crowd picked yours!", sub: "Certified funniest in the room." }
      : outcome === "lose"
        ? { emoji: "🫠", title: `The crowd went with @${opponent?.handle ?? "them"}`, sub: "Tough crowd. Run it back?" }
        : { emoji: "🤝", title: "Dead heat", sub: "The crowd couldn't split you." };
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={spring.wobbly}
      className="flex flex-col items-center gap-1.5"
    >
      <motion.span
        className="text-5xl"
        initial={{ rotate: -30, scale: 0.4 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ ...spring.wobbly, delay: 0.08 }}
      >
        {copy.emoji}
      </motion.span>
      <p
        className={cn(
          "font-display text-2xl font-extrabold tracking-tight",
          outcome === "win" && "bg-[linear-gradient(100deg,var(--color-gold),#fff,var(--color-gold))] bg-clip-text text-transparent",
        )}
      >
        {copy.title}
      </p>
      <p className="text-sm text-ink-300">{copy.sub}</p>
    </motion.div>
  );
}
