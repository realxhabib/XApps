"use client";

import { AnimatePresence, motion, useAnimate, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { AppGlyph } from "@/components/marketplace/app-glyph";
import { Avatar } from "@/components/ui/avatar";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sfx";
import { sleep } from "@/lib/utils";
import { MODE_LABEL } from "@/platform/match-utils";
import type { AppManifest, MatchPlayer, PlayableMode } from "@/platform/types";

type Stage = "clash" | "count" | "done";

/**
 * The pre-match sequence: split panels slam together, the players fly in,
 * VS lands with a shockwave, then a 3-2-1-GO countdown. ~4.5s total.
 */
export function VersusIntro({
  app,
  left,
  right,
  mode,
  onDone,
}: {
  app: AppManifest;
  left: MatchPlayer;
  right?: MatchPlayer;
  mode: PlayableMode;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const [scope, animate] = useAnimate();
  const [stage, setStage] = useState<Stage>("clash");
  const [count, setCount] = useState(3);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      play("whoosh");
      await sleep(reduced ? 300 : 650);
      if (cancelled) return;
      play("slam");
      haptic("heavy");
      if (!reduced && scope.current) {
        void animate(
          scope.current,
          { x: [0, -14, 12, -8, 6, -3, 0], y: [0, 8, -6, 4, -2, 0] },
          { duration: 0.45, ease: "easeOut" },
        );
      }
      await sleep(reduced ? 700 : 1650);
      if (cancelled) return;
      setStage("count");
      for (const n of [3, 2, 1]) {
        if (cancelled) return;
        setCount(n);
        play("tick");
        haptic("light");
        await sleep(650);
      }
      if (cancelled) return;
      setCount(0);
      play("go");
      haptic("medium");
      await sleep(520);
      if (cancelled) return;
      setStage("done");
      onDone();
    };
    void run();
    return () => {
      cancelled = true;
    };
    // Runs once per intro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [from, to] = app.accent;

  return (
    <AnimatePresence>
      {stage !== "done" && (
        <motion.div
          ref={scope}
          className="fixed inset-0 z-[70] overflow-hidden"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.08, filter: "blur(10px)", transition: { duration: 0.35 } }}
          aria-live="assertive"
        >
          {/* Backdrop */}
          <motion.div className="absolute inset-0 bg-ink-950/85 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />

          {/* Split panels */}
          <motion.div
            className="absolute inset-y-0 -left-[10%] w-[62%] -skew-x-12"
            style={{ background: `linear-gradient(120deg, ${from}, ${from}55 70%, transparent)` }}
            initial={{ x: "-110%" }}
            animate={{ x: stage === "count" ? "-120%" : "0%" }}
            transition={{ type: "spring", stiffness: 170, damping: 22 }}
          />
          <motion.div
            className="absolute inset-y-0 -right-[10%] w-[62%] -skew-x-12"
            style={{ background: `linear-gradient(300deg, ${to}, ${to}55 70%, transparent)` }}
            initial={{ x: "110%" }}
            animate={{ x: stage === "count" ? "120%" : "0%" }}
            transition={{ type: "spring", stiffness: 170, damping: 22 }}
          />

          <AnimatePresence>
            {stage === "clash" && (
              <motion.div
                key="clash"
                className="absolute inset-0 flex flex-col items-center justify-center px-6"
                exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.25 } }}
              >
                <div className="flex w-full max-w-3xl items-center justify-between gap-4">
                  <Fighter player={left} side="left" />
                  <div className="relative flex size-28 shrink-0 items-center justify-center sm:size-36">
                    {/* Shockwave rings */}
                    {!reduced &&
                      [0, 0.12].map((delay) => (
                        <motion.span
                          key={delay}
                          className="absolute inset-0 rounded-full border-2 border-white/70"
                          initial={{ scale: 0.2, opacity: 0 }}
                          animate={{ scale: [0.2, 3.2], opacity: [0.9, 0] }}
                          transition={{ delay: 0.65 + delay, duration: 0.8, ease: "easeOut" }}
                        />
                      ))}
                    <motion.span
                      className="font-display text-7xl font-extrabold italic tracking-tighter text-white drop-shadow-[0_0_30px_rgb(255_255_255/0.6)] sm:text-8xl"
                      style={{ fontVariationSettings: "'wdth' 75" }}
                      initial={{ scale: 4, opacity: 0, filter: "blur(18px)", rotate: -12 }}
                      animate={{ scale: 1, opacity: 1, filter: "blur(0px)", rotate: -6 }}
                      transition={{ delay: 0.6, type: "spring", stiffness: 420, damping: 16, filter: { delay: 0.6, duration: 0.3, ease: "easeOut" } }}
                    >
                      VS
                    </motion.span>
                  </div>
                  <Fighter player={right} side="right" />
                </div>
                <motion.div
                  className="mt-10 flex items-center gap-3 rounded-full glass px-4 py-2"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.2, type: "spring", stiffness: 200, damping: 20 }}
                >
                  <AppGlyph app={app} size={28} />
                  <span className="font-display font-bold">{app.name}</span>
                  <span className="text-sm text-ink-300">· {MODE_LABEL[mode]}</span>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Gradient text is clipped to its box: the padding and line height keep the glyph tops inside it. */}
          <AnimatePresence mode="popLayout">
            {stage === "count" && (
              <motion.div
                key={count}
                className="absolute inset-0 flex items-center justify-center"
                initial={{ scale: reduced ? 1 : 2.2, opacity: 0, filter: "blur(16px)" }}
                animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
                exit={{ scale: reduced ? 1 : 0.6, opacity: 0, filter: "blur(8px)", transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 380, damping: 20, filter: { duration: 0.25, ease: "easeOut" } }}
              >
                <span
                  className="px-[0.08em] py-[0.1em] font-display text-[34vmin] font-extrabold leading-[1.1] tracking-tighter"
                  style={{
                    backgroundImage: count === 0 ? "linear-gradient(120deg, #c6ff3d, #1fd1b2)" : `linear-gradient(120deg, #fff, ${to})`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                    fontVariationSettings: "'wdth' 80",
                  }}
                >
                  {count === 0 ? "GO!" : count}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Fighter({ player, side }: { player?: MatchPlayer; side: "left" | "right" }) {
  const dir = side === "left" ? -1 : 1;
  return (
    <motion.div
      className="flex min-w-0 flex-1 flex-col items-center gap-3 text-center"
      initial={{ x: dir * 240, opacity: 0, rotate: dir * 18, scale: 0.6 }}
      animate={{ x: 0, opacity: 1, rotate: 0, scale: 1 }}
      transition={{ delay: 0.15, type: "spring", stiffness: 240, damping: 18 }}
    >
      <div className="rounded-full p-1.5 shadow-[0_0_60px_rgb(255_255_255/0.25)] ring-2 ring-white/80">
        {player ? (
          <Avatar person={{ ...player.profile, isBot: player.isBot }} size={112} />
        ) : (
          <div className="flex size-28 items-center justify-center rounded-full bg-white/10 font-display text-4xl font-bold">?</div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate font-display text-xl font-extrabold sm:text-2xl">{player?.profile.name ?? "Anyone"}</p>
        <p className="truncate text-sm text-white/70">{player ? `@${player.profile.handle}` : "open seat"}</p>
      </div>
    </motion.div>
  );
}
