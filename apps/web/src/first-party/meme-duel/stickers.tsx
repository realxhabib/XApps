"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { RotateCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { clamp, clampScale, clampSticker, handleTransform, pinchTransform, shortestTurn, type Point } from "./logic";
import { useBuzz } from "./pieces";
import { STICKER_SIZE } from "./render";
import { CANVAS, type StickerPlacement } from "./templates";

/** A sticker in the editor: a placement plus a stable id for React and gestures. */
export interface EditorSticker extends StickerPlacement {
  id: string;
}

export const EMOJI_FONT = "'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";

/** Soft settle used whenever a sticker moves to a new resting place (snap-back, dice, keyboard). */
const SETTLE = { type: "spring", stiffness: 300, damping: 19, mass: 0.9 } as const;

/**
 * CSS twin of the SVG die-cut filter in render.ts: four hard white shadows
 * dilate the glyph into an outline, then a soft drop shadow. `k` converts
 * canvas units to pixels; the element's own scale grows it like the SVG does.
 */
function dieCut(k: number, lifted: boolean): string {
  const o = (4 * k).toFixed(2);
  const shadow = lifted
    ? `drop-shadow(0 ${(16 * k).toFixed(1)}px ${(14 * k).toFixed(1)}px rgb(0 0 0 / 0.5))`
    : `drop-shadow(0 ${(5 * k).toFixed(1)}px ${(8 * k).toFixed(1)}px rgb(0 0 0 / 0.35))`;
  return `drop-shadow(${o}px 0 0 #fff) drop-shadow(-${o}px 0 0 #fff) drop-shadow(0 ${o}px 0 #fff) drop-shadow(0 -${o}px 0 #fff) ${shadow}`;
}

interface Callbacks {
  onSelect: (id: string | null) => void;
  /** A settled placement (already clamped by the parent). */
  onCommit: (id: string, next: StickerPlacement) => void;
  /** Ask to remove (toolbar, keyboard, × handle): the parent flags it `removing`. */
  onRemove: (id: string) => void;
  /** The exit animation finished: drop it from state. */
  onRemoved: (id: string) => void;
  /** Where a freshly added sticker should fly in from (0..1 canvas coords), consumed once. */
  takeSpawn: (id: string) => Point | undefined;
  /** Current trash-can rect while dragging, if visible. */
  getTrashRect: () => DOMRect | null;
  onDragChange: (dragging: boolean) => void;
  onTrashHover: (over: boolean) => void;
}

export interface StickerLayerProps extends Callbacks {
  stickers: EditorSticker[];
  /** Canvas size in CSS pixels. */
  size: number;
  selectedId: string | null;
  removing: ReadonlySet<string>;
  /** A tap on bare canvas (0..1 coords): deselect and maybe focus a caption. */
  onCanvasTap: (point: Point) => void;
  /** Interactive pieces that sit under the stickers but above the canvas (draggable captions). */
  underlay?: ReactNode;
}

/**
 * Stickers live in two stacked layers sharing motion values via portals:
 * glyphs are clipped to the rounded canvas at rest (like the final render)
 * but free while dragging, and the selection chrome/handles are never
 * clipped so they stay grabbable at the edges.
 */
export function StickerLayer({ stickers, size, selectedId, removing, onCanvasTap, onDragChange, underlay, ...callbacks }: StickerLayerProps) {
  const [glyphLayer, setGlyphLayer] = useState<HTMLDivElement | null>(null);
  const [chromeLayer, setChromeLayer] = useState<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastGesture = useRef(0);

  const handleDragChange = useCallback(
    (next: boolean) => {
      setDragging(next);
      onDragChange(next);
    },
    [onDragChange],
  );
  const markGesture = useCallback(() => {
    lastGesture.current = Date.now();
  }, []);

  return (
    <>
      <div
        ref={setGlyphLayer}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ clipPath: dragging ? undefined : "inset(0 round var(--r))" }}
      />
      <div
        ref={setChromeLayer}
        className="absolute inset-0"
        onClick={(e) => {
          // Ignore the synthetic click a mouse drag produces when released off the sticker.
          if (e.target !== e.currentTarget || Date.now() - lastGesture.current < 250) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onCanvasTap({ x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
        }}
      >
        {underlay}
      </div>
      {glyphLayer &&
        chromeLayer &&
        size > 0 &&
        stickers.map((sticker, index) => (
          <StickerItem
            key={sticker.id}
            index={index}
            sticker={sticker}
            size={size}
            selected={selectedId === sticker.id}
            removing={removing.has(sticker.id)}
            glyphLayer={glyphLayer}
            chromeLayer={chromeLayer}
            onDragChange={handleDragChange}
            markGesture={markGesture}
            {...callbacks}
          />
        ))}
    </>
  );
}

type Gesture =
  | { kind: "drag"; start: Point; from: Point; moved: boolean; width: number; height: number }
  | { kind: "pinch"; a0: Point; b0: Point; scale: number; rotate: number }
  | { kind: "handle"; center: Point; start: Point; scale: number; rotate: number };

interface StickerItemProps extends Callbacks {
  index: number;
  sticker: EditorSticker;
  size: number;
  selected: boolean;
  removing: boolean;
  glyphLayer: HTMLElement;
  chromeLayer: HTMLElement;
  markGesture: () => void;
}

function StickerItem({
  index,
  sticker,
  size,
  selected,
  removing,
  glyphLayer,
  chromeLayer,
  markGesture,
  onSelect,
  onCommit,
  onRemove,
  onRemoved,
  takeSpawn,
  getTrashRect,
  onDragChange,
  onTrashHover,
}: StickerItemProps) {
  const reduced = useReducedMotion() ?? false;
  const buzz = useBuzz();
  const { id, emoji } = sticker;

  // Normalized position (0..1), degrees and scale — shared by glyph and chrome.
  const nx = useMotionValue(sticker.x);
  const ny = useMotionValue(sticker.y);
  const rot = useMotionValue(sticker.rotate);
  const scl = useMotionValue(sticker.scale);
  const left = useTransform(nx, (v) => `${v * 100}%`);
  const top = useTransform(ny, (v) => `${v * 100}%`);
  const counterRot = useTransform(rot, (r) => -r);

  const k = size / CANVAS.width;
  const base = STICKER_SIZE * k;
  const ringSize = useTransform(scl, (s) => base * s * 1.18 + 14);
  // Keep the touch target at least ~44px however small the sticker gets.
  const hitSize = useTransform(scl, (s) => Math.max(44 / s, base * 1.2));

  const [lifted, setLifted] = useState(false);
  const [binning, setBinning] = useState(false);
  const interacting = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const overTrash = useRef(false);
  const dragReported = useRef(false);
  const stopSession = useRef<(() => void) | null>(null);
  const hitRef = useRef<HTMLDivElement | null>(null);
  const last = useRef({ x: sticker.x, y: sticker.y, scale: sticker.scale, rotate: sticker.rotate });
  const introduced = useRef(false);

  // Entrance: fly out of the tray (or pop in place) with a wobbly spring.
  useEffect(() => {
    if (introduced.current) return;
    introduced.current = true;
    const spawn = takeSpawn(id);
    if (reduced) return;
    if (spawn) {
      nx.jump(spawn.x);
      ny.jump(spawn.y);
      animate(nx, last.current.x, { type: "spring", stiffness: 170, damping: 19 });
      animate(ny, last.current.y, { type: "spring", stiffness: 150, damping: 13 });
    }
    scl.jump(spawn ? 0.35 : 0);
    animate(scl, last.current.scale, spring.wobbly);
    rot.jump(last.current.rotate - 40);
    animate(rot, last.current.rotate, spring.wobbly);
  }, [id, nx, ny, reduced, rot, scl, takeSpawn]);

  // Settle into new props (dice, keyboard, toolbar, clamped snap-back after a drag).
  useEffect(() => {
    const prev = last.current;
    if (prev.x === sticker.x && prev.y === sticker.y && prev.scale === sticker.scale && prev.rotate === sticker.rotate) return;
    last.current = { x: sticker.x, y: sticker.y, scale: sticker.scale, rotate: sticker.rotate };
    if (interacting.current) return;
    const t = reduced ? { duration: 0 } : SETTLE;
    animate(nx, sticker.x, t);
    animate(ny, sticker.y, t);
    animate(scl, sticker.scale, t);
    animate(rot, rot.get() + shortestTurn(rot.get(), sticker.rotate), t);
  }, [sticker.x, sticker.y, sticker.scale, sticker.rotate, reduced, nx, ny, rot, scl]);

  // Removal from the toolbar / keyboard / × handle.
  useEffect(() => {
    if (!removing) return;
    const t = reduced ? { duration: 0 } : { duration: 0.22, ease: [0.5, 0, 0.75, 0] as const };
    animate(rot, rot.get() - 50, t);
    const done = animate(scl, 0, t);
    void done.then(() => onRemoved(id));
  }, [removing, reduced, id, onRemoved, rot, scl]);

  useEffect(() => () => stopSession.current?.(), []);

  const commit = useCallback(() => {
    onCommit(id, clampSticker({ emoji, x: nx.get(), y: ny.get(), scale: scl.get(), rotate: rot.get() }));
  }, [emoji, id, nx, ny, onCommit, rot, scl]);

  /** Trash drop: shrink into the can, then leave. */
  const binIt = useCallback(() => {
    const trash = getTrashRect();
    const canvas = chromeLayer.getBoundingClientRect();
    play("thump");
    buzz("medium");
    const t = reduced ? { duration: 0 } : { duration: 0.26, ease: [0.5, 0, 0.75, 0] as const };
    if (trash) {
      animate(nx, (trash.left + trash.width / 2 - canvas.left) / canvas.width, t);
      animate(ny, (trash.top + trash.height / 2 - canvas.top) / canvas.height, t);
    }
    animate(rot, rot.get() + 120, t);
    void animate(scl, 0, t).then(() => onRemoved(id));
  }, [buzz, chromeLayer, getTrashRect, id, nx, ny, onRemoved, reduced, rot, scl]);

  /** Tell the editor a one-finger drag is (or isn't) underway: it shows the trash and unclips the glyphs. */
  const reportDrag = useCallback(
    (next: boolean) => {
      if (dragReported.current === next) return;
      dragReported.current = next;
      onDragChange(next);
      if (!next && overTrash.current) {
        overTrash.current = false;
        setBinning(false);
        onTrashHover(false);
      }
    },
    [onDragChange, onTrashHover],
  );

  const finish = useCallback(() => {
    const g = gesture.current;
    gesture.current = null;
    interacting.current = false;
    setLifted(false);
    markGesture();
    const binned = overTrash.current;
    overTrash.current = false;
    reportDrag(false);
    if (binned) {
      setBinning(false);
      onTrashHover(false);
      binIt();
      return;
    }
    if (g && (g.kind !== "drag" || g.moved)) commit();
  }, [binIt, commit, markGesture, onTrashHover, reportDrag]);

  /**
   * Window-level pointer tracking for one gesture: it keeps working when the
   * finger leaves the sticker, and a second finger anywhere turns a drag
   * into a pinch.
   */
  const startSession = useCallback(
    (first: ReactPointerEvent, initial: Gesture) => {
      stopSession.current?.();
      pointers.current = new Map([[first.pointerId, { x: first.clientX, y: first.clientY }]]);
      gesture.current = initial;
      interacting.current = true;
      setLifted(true);
      markGesture();

      const onDown = (e: PointerEvent) => {
        const g = gesture.current;
        if (!g || g.kind === "handle" || pointers.current.size !== 1) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.current.values()] as [Point, Point];
        // Pinching is not dragging: no trash can, and the sticker stays put.
        reportDrag(false);
        gesture.current = { kind: "pinch", a0: a, b0: b, scale: scl.get(), rotate: rot.get() };
        e.preventDefault();
      };
      const onMove = (e: PointerEvent) => {
        if (!pointers.current.has(e.pointerId)) return;
        const p = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, p);
        const g = gesture.current;
        if (!g) return;
        if (g.kind === "drag") {
          const dx = p.x - g.start.x;
          const dy = p.y - g.start.y;
          if (!g.moved) {
            if (Math.hypot(dx, dy) < 4) return;
            g.moved = true;
          }
          reportDrag(true);
          // Free to leave the canvas (the trash lives below it); clamped on release.
          nx.set(clamp(g.from.x + dx / g.width, -0.2, 1.2));
          ny.set(clamp(g.from.y + dy / g.height, -0.2, 1.45));
          const trash = getTrashRect();
          const over =
            !!trash && p.x > trash.left - 14 && p.x < trash.right + 14 && p.y > trash.top - 14 && p.y < trash.bottom + 14;
          if (over !== overTrash.current) {
            overTrash.current = over;
            setBinning(over);
            onTrashHover(over);
            if (over) buzz("light");
          }
        } else if (g.kind === "pinch") {
          const [a, b] = [...pointers.current.values()] as [Point, Point];
          const next = pinchTransform(g.a0, g.b0, a, b, g.scale, g.rotate);
          scl.set(next.scale);
          rot.set(g.rotate + shortestTurn(g.rotate, next.rotate));
        } else {
          const next = handleTransform(g.center, g.start, p, g.scale, g.rotate);
          scl.set(next.scale);
          rot.set(g.rotate + shortestTurn(g.rotate, next.rotate));
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!pointers.current.delete(e.pointerId)) return;
        const g = gesture.current;
        if (g?.kind === "pinch" && pointers.current.size === 1) {
          // One finger left: keep dragging with the remaining one, no jump.
          const [rest] = [...pointers.current.values()] as [Point];
          const rect = chromeLayer.getBoundingClientRect();
          gesture.current = { kind: "drag", start: rest, from: { x: nx.get(), y: ny.get() }, moved: true, width: rect.width, height: rect.height };
          return;
        }
        if (pointers.current.size > 0) return;
        stop();
        finish();
      };
      const stop = () => {
        window.removeEventListener("pointerdown", onDown, true);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        stopSession.current = null;
      };
      window.addEventListener("pointerdown", onDown, true);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
      stopSession.current = stop;
    },
    [buzz, chromeLayer, finish, getTrashRect, markGesture, nx, ny, onTrashHover, reportDrag, rot, scl],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (removing || e.button > 0 || gesture.current) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    onSelect(id);
    play("pop");
    buzz("light");
    const rect = chromeLayer.getBoundingClientRect();
    startSession(e, {
      kind: "drag",
      start: { x: e.clientX, y: e.clientY },
      from: { x: nx.get(), y: ny.get() },
      moved: false,
      width: rect.width,
      height: rect.height,
    });
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (removing || e.button > 0) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = chromeLayer.getBoundingClientRect();
    buzz("light");
    startSession(e, {
      kind: "handle",
      center: { x: rect.left + nx.get() * rect.width, y: rect.top + ny.get() * rect.height },
      start: { x: e.clientX, y: e.clientY },
      scale: scl.get(),
      rotate: rot.get(),
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.08 : 0.02;
    const cur: StickerPlacement = { emoji, x: sticker.x, y: sticker.y, scale: sticker.scale, rotate: sticker.rotate };
    let next: StickerPlacement | null = null;
    switch (e.key) {
      case "ArrowLeft":
        next = { ...cur, x: cur.x - step };
        break;
      case "ArrowRight":
        next = { ...cur, x: cur.x + step };
        break;
      case "ArrowUp":
        next = { ...cur, y: cur.y - step };
        break;
      case "ArrowDown":
        next = { ...cur, y: cur.y + step };
        break;
      case "[":
      case "q":
        next = { ...cur, rotate: cur.rotate - 15 };
        break;
      case "]":
      case "e":
        next = { ...cur, rotate: cur.rotate + 15 };
        break;
      case "+":
      case "=":
        next = { ...cur, scale: cur.scale * 1.12 };
        break;
      case "-":
      case "_":
        next = { ...cur, scale: cur.scale / 1.12 };
        break;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        onRemove(id);
        return;
      case "Escape":
        e.currentTarget.blur();
        onSelect(null);
        return;
      default:
        return;
    }
    e.preventDefault();
    onCommit(id, clampSticker(next));
  };

  // Wheel = resize, Shift+wheel = rotate (selected sticker only). Non-passive so the page never scrolls.
  useEffect(() => {
    const el = hitRef.current;
    if (!el || !selected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      interacting.current = true;
      if (e.shiftKey) rot.set(rot.get() + (e.deltaY || e.deltaX) * 0.12);
      else scl.set(clampScale(scl.get() * Math.exp(-e.deltaY * 0.0015)));
      clearTimeout(timer);
      timer = setTimeout(() => {
        interacting.current = false;
        commit();
      }, 180);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      clearTimeout(timer);
    };
  }, [commit, rot, scl, selected]);

  const glyph = (
    <motion.div className="absolute inset-0" style={{ x: left, y: top, zIndex: lifted ? 30 : 10 + index }}>
      <motion.div className="absolute left-0 top-0 size-0" style={{ rotate: rot, scale: scl }}>
        <motion.div
          className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
          animate={
            binning
              ? { scale: 0.62, opacity: 0.75, rotate: 0 }
              : lifted
                ? { scale: 1.18, opacity: 1, rotate: reduced ? 0 : [0, -9, 7, -4, 2, 0] }
                : { scale: 1, opacity: 1, rotate: 0 }
          }
          transition={lifted && !binning ? { scale: spring.bouncy, opacity: spring.snappy, rotate: { duration: 0.55, ease: "easeOut" } } : spring.bouncy}
        >
          <span
            className="block select-none whitespace-nowrap leading-none transition-[filter] duration-200"
            style={{ fontSize: base, fontFamily: EMOJI_FONT, filter: dieCut(k, lifted) }}
          >
            {emoji}
          </span>
        </motion.div>
      </motion.div>
    </motion.div>
  );

  const chrome = (
    <motion.div className="pointer-events-none absolute inset-0" style={{ x: left, y: top, zIndex: lifted || selected ? 30 : 10 + index }}>
      <motion.div className="absolute left-0 top-0 size-0" style={{ rotate: rot }}>
        <AnimatePresence>
          {selected && !removing && (
            <motion.div
              key="ring"
              className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2"
              style={{ width: ringSize, height: ringSize }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: lifted ? 0.35 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={spring.bouncy}
            >
              <div className="absolute inset-0 animate-spin-slow rounded-full border-2 border-dashed border-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.2),0_0_22px_-2px_var(--accent-from)] motion-reduce:animate-none" />
              <button
                type="button"
                aria-label="Remove sticker"
                className="pointer-events-auto absolute left-0 top-0 grid size-7 -translate-x-1/3 -translate-y-1/3 place-items-center rounded-full bg-ink-950 text-white shadow-lg ring-2 ring-white transition-transform hover:scale-110 active:scale-90"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(id);
                }}
              >
                <motion.span style={{ rotate: counterRot }} className="grid place-items-center">
                  <X className="size-3.5" strokeWidth={3} />
                </motion.span>
              </button>
              <button
                type="button"
                aria-label="Drag to rotate and resize"
                className="pointer-events-auto absolute bottom-0 right-0 grid size-8 translate-x-1/3 translate-y-1/3 cursor-grab touch-none place-items-center rounded-full bg-white text-ink-950 shadow-lg ring-2 ring-[var(--accent-from)] transition-transform hover:scale-110 active:scale-95"
                onPointerDown={onHandleDown}
                onClick={(e) => e.stopPropagation()}
              >
                <motion.span style={{ rotate: counterRot }} className="grid place-items-center">
                  <RotateCw className="size-4" strokeWidth={2.75} />
                </motion.span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <motion.div className="absolute left-0 top-0 size-0" style={{ rotate: rot, scale: scl }}>
        <motion.div
          ref={hitRef}
          role="button"
          tabIndex={0}
          aria-label={`${emoji} sticker. Drag to move. Arrow keys move, [ and ] rotate, + and − resize, Delete removes.`}
          aria-pressed={selected}
          className={cn(
            "pointer-events-auto absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full outline-none",
            lifted ? "cursor-grabbing" : "cursor-grab",
            "focus-visible:ring-2 focus-visible:ring-white/80",
          )}
          style={{ width: hitSize, height: hitSize }}
          onPointerDown={onPointerDown}
          onClick={(e) => e.stopPropagation()}
          onFocus={() => onSelect(id)}
          onKeyDown={onKeyDown}
        />
      </motion.div>
    </motion.div>
  );

  return (
    <>
      {createPortal(glyph, glyphLayer)}
      {createPortal(chrome, chromeLayer)}
    </>
  );
}

/** The bin that appears under the canvas while a sticker is being dragged. */
export function TrashZone({ visible, hot, binRef }: { visible: boolean; hot: boolean; binRef: (el: HTMLDivElement | null) => void }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="trash"
          ref={binRef}
          initial={{ opacity: 0, y: -18, scale: 0.5 }}
          animate={{ opacity: 1, y: 0, scale: hot ? 1.22 : 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.5 }}
          transition={spring.bouncy}
          className={cn(
            "pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-40 -ml-8 grid size-16 place-items-center rounded-full border-2 border-dashed transition-colors duration-150",
            hot
              ? "border-danger bg-danger/25 shadow-[0_0_40px_-4px_var(--color-danger)]"
              : "border-white/30 bg-ink-900/85 backdrop-blur-md",
          )}
          aria-hidden
        >
          <motion.span
            className="text-3xl"
            animate={hot && !reduced ? { rotate: [0, -14, 12, -8, 0], y: [0, -3, 0] } : { rotate: 0, y: 0 }}
            transition={hot ? { duration: 0.45, repeat: Infinity } : spring.snappy}
          >
            🗑️
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
