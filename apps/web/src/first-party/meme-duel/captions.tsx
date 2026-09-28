"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { captionRange, clamp, defaultCaptionPosition, type Point } from "./logic";
import { useBuzz } from "./pieces";
import { renderCaptionSvg, slotFrame } from "./render";
import type { CaptionPosition, CaptionSlot } from "./templates";

/** Room (canvas units) around a caption's frame for label boxes and outlines. */
const PAD = 12;
/** Same soft settle the stickers use. */
const SETTLE = { type: "spring", stiffness: 300, damping: 19, mass: 0.9 } as const;
/** How close (0..1) to the vertical center line a caption snaps onto it. */
const SNAP = 0.014;

export interface MovableCaptionProps {
  slot: CaptionSlot;
  canvas: { width: number; height: number };
  value: string;
  /** Player-chosen spot (0..1), or undefined for the template default. */
  position?: CaptionPosition;
  focused: boolean;
  index: number;
  /** Where the caption's visuals render (below the stickers). The hit target renders in place. */
  visualLayer: HTMLElement;
  /** Current stage rect (for pointer math). */
  getStageRect: () => DOMRect | null;
  /** Tap without dragging: jump to the caption's input. */
  onTap: () => void;
  /** A settled position, already clamped (undefined = back to default). */
  onMove: (position: CaptionPosition | undefined) => void;
  /** Center guide on/off while dragging. */
  onGuide: (visible: boolean) => void;
}

/**
 * A caption on a photo template that can be dragged anywhere on the canvas.
 * Like the stickers, it's two elements sharing motion values: the rendered
 * caption (under the stickers, clipped to the canvas) and an invisible hit
 * target with the selection chrome (above the canvas, in the sticker layer).
 */
export function MovableCaption({
  slot,
  canvas,
  value,
  position,
  focused,
  index,
  visualLayer,
  getStageRect,
  onTap,
  onMove,
  onGuide,
}: MovableCaptionProps) {
  const reduced = useReducedMotion() ?? false;
  const buzz = useBuzz();
  const home = useMemo(() => defaultCaptionPosition(slot, canvas), [slot, canvas]);
  const range = useMemo(() => captionRange(slot, canvas), [slot, canvas]);
  const frame = slotFrame(slot);
  const boxW = frame.width + PAD * 2;
  const boxH = frame.height + PAD * 2;

  const start = position ?? home;
  const nx = useMotionValue(start.x);
  const ny = useMotionValue(start.y);
  // Offsets as a percentage of the element's own box: independent of the stage's pixel size.
  const x = useTransform(nx, (v) => `${(((v - home.x) * canvas.width) / boxW) * 100}%`);
  const y = useTransform(ny, (v) => `${(((v - home.y) * canvas.height) / boxH) * 100}%`);

  const [lifted, setLifted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ id: number; start: Point; from: Point; moved: boolean; rect: DOMRect } | null>(null);
  const last = useRef(start);
  const snapped = useRef(false);

  // Settle into new props (keyboard, reset) unless a drag is driving the values.
  useEffect(() => {
    const next = position ?? home;
    const prev = last.current;
    if (prev.x === next.x && prev.y === next.y) return;
    last.current = next;
    if (drag.current) return;
    const t = reduced ? { duration: 0 } : SETTLE;
    animate(nx, next.x, t);
    animate(ny, next.y, t);
  }, [position, home, nx, ny, reduced]);

  const svg = useMemo(() => renderCaptionSvg(slot, value, true, PAD), [slot, value]);

  /** Past the edge the caption follows the finger at a quarter speed (rubber band). */
  const rubber = (v: number, min: number, max: number) => (v < min ? min - (min - v) * 0.25 : v > max ? max + (v - max) * 0.25 : v);

  const commit = (px: number, py: number) => {
    const cx = clamp(px, range.minX, range.maxX);
    const cy = clamp(py, range.minY, range.maxY);
    const t = reduced ? { duration: 0 } : SETTLE;
    animate(nx, cx, t);
    animate(ny, cy, t);
    const atHome = Math.abs(cx - home.x) < 0.002 && Math.abs(cy - home.y) < 0.002;
    const next = atHome ? undefined : { x: Math.round(cx * 10_000) / 10_000, y: Math.round(cy * 10_000) / 10_000 };
    last.current = next ?? home;
    onMove(next);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button > 0 || drag.current) return;
    const rect = getStageRect();
    if (!rect || !rect.width) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, start: { x: e.clientX, y: e.clientY }, from: { x: nx.get(), y: ny.get() }, moved: false, rect };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.start.x;
    const dy = e.clientY - d.start.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      d.moved = true;
      setLifted(true);
      play("pop");
      buzz("light");
    }
    let px = d.from.x + dx / d.rect.width;
    const py = d.from.y + dy / d.rect.height;
    // Magnetic center line (only when the caption can sit there).
    const canCenter = range.minX <= 0.5 && range.maxX >= 0.5 && range.maxX > range.minX;
    const snap = canCenter && Math.abs(px - 0.5) < SNAP;
    if (snap) px = 0.5;
    if (snap !== snapped.current) {
      snapped.current = snap;
      onGuide(snap);
      if (snap) buzz("light");
    }
    nx.set(rubber(px, range.minX, range.maxX));
    ny.set(rubber(py, range.minY, range.maxY));
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (snapped.current) {
      snapped.current = false;
      onGuide(false);
    }
    if (!d.moved) {
      if (e.type === "pointerup") onTap();
      return;
    }
    setLifted(false);
    play("tick");
    commit(nx.get(), ny.get());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.08 : 0.02;
    const cur = { x: nx.get(), y: ny.get() };
    switch (e.key) {
      case "ArrowLeft":
        cur.x -= step;
        break;
      case "ArrowRight":
        cur.x += step;
        break;
      case "ArrowUp":
        cur.y -= step;
        break;
      case "ArrowDown":
        cur.y += step;
        break;
      case "Home":
      case "0":
        e.preventDefault();
        commit(home.x, home.y);
        return;
      case "Enter":
        e.preventDefault();
        onTap();
        return;
      default:
        return;
    }
    e.preventDefault();
    commit(cur.x, cur.y);
  };

  const box = {
    left: `${((frame.x - PAD) / canvas.width) * 100}%`,
    top: `${((frame.y - PAD) / canvas.height) * 100}%`,
    width: `${(boxW / canvas.width) * 100}%`,
    height: `${(boxH / canvas.height) * 100}%`,
  };
  const label = slot.label ?? slot.id;
  const showChrome = focused || lifted || hovered;

  const visual = (
    <motion.div className="absolute" style={{ ...box, x, y, zIndex: lifted ? 5 : 1 + index }}>
      <motion.div
        className="size-full [&>svg]:block [&>svg]:size-full [&>svg]:overflow-visible"
        animate={lifted && !reduced ? { scale: 1.05, filter: "drop-shadow(0 10px 14px rgb(0 0 0 / 0.45))" } : { scale: 1, filter: "drop-shadow(0 0px 0px rgb(0 0 0 / 0))" }}
        transition={spring.bouncy}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </motion.div>
  );

  return (
    <>
      {createPortal(visual, visualLayer)}
      <motion.div
        role="button"
        tabIndex={0}
        aria-label={`${label} caption. Drag to move it, arrow keys nudge, Enter edits, 0 resets.`}
        data-caption={slot.id}
        className={cn("absolute touch-none rounded-xl outline-none", lifted ? "cursor-grabbing" : "cursor-grab")}
        style={{ ...box, x, y, zIndex: lifted ? 8 : 2 + index }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!position) return;
          play("draw");
          buzz("medium");
          commit(home.x, home.y);
        }}
        onKeyDown={onKeyDown}
      >
        <AnimatePresence>
          {showChrome && (
            <motion.div
              key="chrome"
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed",
                focused || lifted
                  ? "border-[var(--accent-from)] shadow-[0_0_0_3px_rgb(0_0_0/0.18),0_0_26px_-6px_var(--accent-from)]"
                  : "border-white/60",
              )}
              initial={{ opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={spring.snappy}
            >
              <span
                className={cn(
                  "absolute left-2 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                  focused || lifted ? "bg-[var(--accent-from)] text-ink-950" : "bg-ink-950/80 text-white",
                  frame.y < canvas.height * 0.12 ? "-bottom-3" : "-top-3",
                )}
              >
                {lifted ? "Moving" : label}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

/** The magnetic center line shown while a caption snaps to it. */
export function CenterGuide({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="guide"
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 z-[9] w-0 border-l-2 border-dashed border-[var(--accent-from)]"
          initial={{ opacity: 0, scaleY: 0.6 }}
          animate={{ opacity: 0.9, scaleY: 1 }}
          exit={{ opacity: 0 }}
          transition={spring.snappy}
        />
      )}
    </AnimatePresence>
  );
}
