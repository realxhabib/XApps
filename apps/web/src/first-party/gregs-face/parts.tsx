"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffectEvent, useLayoutEffect, useRef, type ReactNode, type Ref } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { PART_LABEL, PART_ORDER, type FaceConfig, type PartId } from "./face";
import type { FaceKit } from "./kit";
import { formatPct, slideU, trackX, trueX, type Drop, type Slide } from "./logic";

export const PART_EMOJI: Record<PartId, string> = { eyes: "👀", nose: "👃", mouth: "👄" };

/** Accuracy → colour: green for great, accent for decent, red for a whiff. */
export function toneFor(accuracy: number): string {
  if (accuracy >= 90) return "var(--color-success)";
  if (accuracy >= 70) return "var(--accent-from)";
  if (accuracy >= 45) return "var(--color-gold)";
  return "var(--color-danger)";
}

/** Horizontal offset (in % of the feature's own width) that puts its centre at image x `x`. */
function offsetPct(face: FaceConfig, part: PartId, x: number): number {
  return ((x - trueX(face, part)) / face.parts[part].w) * 100;
}

/** Box style for a rect, in % of the stage. */
function boxStyle(face: FaceConfig, part: PartId) {
  const r = face.parts[part];
  return {
    left: `${(r.x / face.width) * 100}%`,
    top: `${(r.y / face.height) * 100}%`,
    width: `${(r.w / face.width) * 100}%`,
    height: `${(r.h / face.height) * 100}%`,
  };
}

/* ---------------------------------------------------------------------- */
/* Stage                                                                  */
/* ---------------------------------------------------------------------- */

/** The face card everything happens on: fixed aspect ratio, scales with the screen. */
export function Stage({
  face,
  src,
  children,
  stageRef,
  className,
  maxVh = 50,
}: {
  face: FaceConfig;
  src: string;
  children?: ReactNode;
  stageRef?: Ref<HTMLDivElement>;
  className?: string;
  /** Height cap: a number of dvh, or any CSS length (e.g. a custom property). */
  maxVh?: number | string;
}) {
  const maxH = typeof maxVh === "number" ? `${maxVh}dvh` : maxVh;
  return (
    <div
      ref={stageRef}
      className={cn(
        "relative mx-auto shrink-0 overflow-hidden rounded-[clamp(20px,6vw,32px)] bg-ink-800 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8),0_0_0_1px_rgb(255_255_255/0.1)]",
        className,
      )}
      style={{
        aspectRatio: `${face.width} / ${face.height}`,
        width: `min(100%, 460px, calc(${maxH} * ${face.width / face.height}))`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- generated blob URL */}
      <img src={src} alt="" draggable={false} className="absolute inset-0 size-full select-none" />
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* A feature                                                              */
/* ---------------------------------------------------------------------- */

export type FeatureState = "intro" | "moving" | "dropped" | "placed" | "reveal";

/**
 * One feature sprite. While `moving` it follows its slide from
 * requestAnimationFrame (a motion value, no React renders) at exactly its true
 * height, and reports each painted frame's time through `onFrame` so a drop
 * lands where the player saw it (what you see is what you score). Once dropped
 * it settles with a small squash in place, and on the reveal it wobbles.
 */
export function Feature({
  kit,
  part,
  slide,
  state,
  startAt,
  drop,
  reduced,
  order = 0,
  onBounce,
  onFrame,
}: {
  kit: FaceKit;
  part: PartId;
  slide: Slide;
  state: FeatureState;
  /** performance.now() when the slide started (moving only). */
  startAt: number;
  drop: Drop | null;
  reduced: boolean;
  order?: number;
  onBounce?: () => void;
  /** Called with the slide time (ms) of every frame painted while moving. */
  onFrame?: (tMs: number) => void;
}) {
  const { face } = kit;
  // The horizontal position is written straight to this element inside the rAF
  // callback (not through a motion value, which lands a frame later), so what's
  // painted is exactly the slide time reported to `onFrame`.
  const slider = useRef<HTMLDivElement>(null);
  const bounce = useEffectEvent(() => onBounce?.());
  const frame = useEffectEvent((tMs: number) => onFrame?.(tMs));

  useLayoutEffect(() => {
    const el = slider.current;
    if (!el) return;
    const place = (x: number) => {
      el.style.transform = `translateX(${offsetPct(face, part, x)}%)`;
    };
    if (drop) {
      place(drop.x);
      return;
    }
    place(trackX(face, slideU(slide, state === "moving" ? Math.max(0, performance.now() - startAt) : 0)));
    if (state !== "moving") return;
    let raf = 0;
    let lastU = slideU(slide, performance.now() - startAt);
    let lastDir = 0;
    const tick = () => {
      const t = performance.now() - startAt;
      const u = slideU(slide, t);
      place(trackX(face, u));
      frame(t);
      const dir = Math.sign(u - lastU);
      if (dir !== 0) {
        if (lastDir !== 0 && dir !== lastDir) bounce();
        lastDir = dir;
      }
      lastU = u;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [state, startAt, slide, face, part, drop]);

  const hovering = state === "intro" || state === "moving";
  // A small settle in place: the sprite never shifts on a drop, so the landing matches the tap.
  const squash =
    state === "dropped" && !reduced
      ? { scaleX: [1.06, 0.98, 1], scaleY: [0.94, 1.02, 1], rotate: 0 }
      : state === "reveal" && !reduced
        ? { scaleX: [1, 1.08, 0.96, 1.02, 1], scaleY: [1, 0.92, 1.05, 0.99, 1], rotate: [0, -7, 6, -3, 0] }
        : { scaleX: 1, scaleY: 1, rotate: 0 };

  return (
    <div ref={slider} className="pointer-events-none absolute" style={{ ...boxStyle(face, part), zIndex: hovering ? 20 : 10 }}>
      <motion.div
        className="size-full"
        initial={reduced ? false : { y: "-220%", opacity: 0 }}
        animate={{ y: "0%", opacity: 1 }}
        transition={reduced ? { duration: 0 } : spring.bouncy}
      >
        <motion.img
          src={kit.spriteUrls[part]}
          alt={PART_LABEL[part]}
          draggable={false}
          className="size-full select-none"
          animate={{
            ...squash,
            filter: hovering ? "drop-shadow(0px 3px 4px rgba(0,0,0,0.22))" : "drop-shadow(0px 0px 0px rgba(0,0,0,0))",
          }}
          transition={{
            duration: state === "reveal" ? 0.9 : 0.5,
            delay: state === "reveal" ? order * 0.12 : 0,
            ease: "easeOut",
            filter: { duration: 0.2 },
          }}
        />
      </motion.div>
    </div>
  );
}

/** Dashed outline (and faint ghost) where a feature really belongs, plus the miss bar. */
export function Ghost({ kit, drop, reduced }: { kit: FaceKit; drop: Drop; reduced: boolean }) {
  const { face } = kit;
  const r = face.parts[drop.part];
  const tx = trueX(face, drop.part);
  const cy = r.y + r.h / 2;
  const from = Math.min(tx, drop.x);
  const span = Math.abs(drop.x - tx);
  const color = toneFor(drop.accuracy);
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[5] rounded-[35%] border-2 border-dashed"
        style={{ ...boxStyle(face, drop.part), borderColor: "rgb(255 255 255 / 0.85)" }}
        initial={reduced ? false : { opacity: 0, scale: 1.35 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={spring.bouncy}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- generated blob URL */}
        <img src={kit.spriteUrls[drop.part]} alt="" className="size-full opacity-25 grayscale" draggable={false} />
      </motion.div>
      {span / face.width > 0.004 && (
        <motion.div
          className="pointer-events-none absolute z-[15] h-[3px] rounded-full"
          style={{
            left: `${(from / face.width) * 100}%`,
            width: `${(span / face.width) * 100}%`,
            top: `calc(${(cy / face.height) * 100}% - 1.5px)`,
            background: color,
            boxShadow: `0 0 10px ${color}`,
            originX: drop.x < tx ? 1 : 0,
          }}
          initial={reduced ? false : { scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 0.9 }}
          transition={{ ...spring.soft, delay: 0.15 }}
        />
      )}
    </>
  );
}

/** The dashed row the moving feature travels along. */
export function RowGuide({ face, part }: { face: FaceConfig; part: PartId }) {
  const r = face.parts[part];
  return (
    <motion.div
      key={part}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-white/35"
      style={{ top: `${((r.y + r.h / 2) / face.height) * 100}%` }}
      initial={{ opacity: 0, scaleX: 0.3 }}
      animate={{ opacity: 1, scaleX: 1 }}
      exit={{ opacity: 0 }}
      transition={spring.soft}
    />
  );
}

/** "+92%" popping off a freshly dropped feature. */
export function DropPop({ face, drop }: { face: FaceConfig; drop: Drop }) {
  const r = face.parts[drop.part];
  return (
    <motion.div
      className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full"
      style={{ left: `${(drop.x / face.width) * 100}%`, top: `${(r.y / face.height) * 100}%` }}
      initial={{ opacity: 0, y: 10, scale: 0.6 }}
      animate={{ opacity: [0, 1, 1, 0], y: -26, scale: 1 }}
      transition={{ duration: 1, times: [0, 0.15, 0.75, 1], ease: "easeOut" }}
    >
      <span
        className="whitespace-nowrap rounded-full bg-ink-950/85 px-2.5 py-1 font-display text-base font-extrabold tabular shadow-lg ring-1 ring-white/15"
        style={{ color: toneFor(drop.accuracy) }}
      >
        {drop.perfect ? "PERFECT!" : formatPct(drop.accuracy)}
      </span>
    </motion.div>
  );
}

/** Sparkles for a pixel-perfect drop. */
export function Burst({ face, drop }: { face: FaceConfig; drop: Drop }) {
  const r = face.parts[drop.part];
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30"
      style={{ left: `${(drop.x / face.width) * 100}%`, top: `${((r.y + r.h / 2) / face.height) * 100}%` }}
    >
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i / 12) * Math.PI * 2;
        const dist = 46 + (i % 3) * 16;
        return (
          <motion.span
            key={i}
            className="absolute size-2 rounded-full"
            style={{ background: i % 2 ? "var(--color-success)" : "var(--color-gold)", marginLeft: -4, marginTop: -4 }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* HUD bits                                                               */
/* ---------------------------------------------------------------------- */

/** Eyes · Nose · Mouth, with the current one lit and finished ones scored. */
export function StepPips({ current, drops }: { current: number; drops: readonly Drop[] }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-label="Progress">
      {PART_ORDER.map((part, i) => {
        const drop = drops.find((d) => d.part === part);
        const active = i === current && !drop;
        return (
          <motion.div
            key={part}
            layout
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold ring-1 transition-colors",
              active ? "bg-[var(--accent-from)] text-ink-950 ring-transparent" : "bg-white/[0.06] text-ink-300 ring-white/10",
            )}
            animate={{ scale: active ? 1.06 : 1 }}
            transition={spring.bouncy}
          >
            <span className="text-base leading-none">{PART_EMOJI[part]}</span>
            <span className={cn(active ? "inline" : "hidden sm:inline")}>{PART_LABEL[part]}</span>
            <AnimatePresence>
              {drop && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={spring.bouncy}
                  className="font-mono tabular"
                  style={{ color: toneFor(drop.accuracy) }}
                >
                  {Math.round(drop.accuracy)}%
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
