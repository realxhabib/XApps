"use client";

import { AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { Check, Minus, Plus, RotateCcw, RotateCw, Stamp, Trash2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import {
  MAX_STICKERS,
  clampSticker,
  cleanCaptionInput,
  hasCaption,
  randomStickerPlacement,
  scatterStickers,
  slotAt,
  slotBounds,
  type Point,
} from "./logic";
import { CardBack, useBuzz } from "./pieces";
import { renderMemeSvg } from "./render";
import { StickerLayer, TrashZone, type EditorSticker } from "./stickers";
import { STICKERS, type CaptionSlot, type MemeTemplate, type StickerPlacement } from "./templates";

let stickerSeq = 0;
function nextStickerId(): string {
  stickerSeq += 1;
  return `s${stickerSeq}-${Date.now().toString(36)}`;
}

/** Layout sizes that depend on the viewport: the canvas (--cv) always fits without page scroll. */
const EDITOR_CSS = `
.mdl-editor { --cv: min(calc(100vw - 32px), max(164px, calc(100dvh - 262px - var(--slots) * 62px)), 560px); --r: 20px; }
@media (min-width: 48rem) {
  .mdl-editor { --cv: min(calc(100dvh - 172px), calc(100vw - 468px), 640px); --r: 26px; }
}`;

export interface EditorProps {
  template: MemeTemplate;
  captions: Record<string, string>;
  setCaptions: Dispatch<SetStateAction<Record<string, string>>>;
  stickers: EditorSticker[];
  setStickers: Dispatch<SetStateAction<EditorSticker[]>>;
  /** Called on every edit (throttled "typing" broadcast lives upstream). */
  onActivity: () => void;
  onSubmit: () => void;
  timer: ReactNode;
  opponent: ReactNode;
  /** One line about the clock/opponent, e.g. "Live · auto-submits at 0:00". */
  modeHint: string;
}

export function Editor({
  template,
  captions,
  setCaptions,
  stickers,
  setStickers,
  onActivity,
  onSubmit,
  timer,
  opponent,
  modeHint,
}: EditorProps) {
  const reduced = useReducedMotion() ?? false;
  const buzz = useBuzz();
  const canSubmit = hasCaption({ templateId: template.id, captions });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(() => new Set());
  const [dragging, setDragging] = useState(false);
  const [trashHot, setTrashHot] = useState(false);
  const [focusedSlot, setFocusedSlot] = useState<string | null>(null);
  const [trayWarn, setTrayWarn] = useState(0);
  const [showWarn, setShowWarn] = useState(false);
  const warnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [diceSpins, setDiceSpins] = useState(0);
  const [size, setSize] = useState(0);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  const trashEl = useRef<HTMLDivElement | null>(null);
  const spawns = useRef(new Map<string, Point>());
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const bounceSlot = useRef<string | null>(null);
  const diceRef = useRef<HTMLButtonElement | null>(null);

  const selected = stickers.find((s) => s.id === selectedId && !removing.has(s.id)) ?? null;
  const liveCount = stickers.filter((s) => !removing.has(s.id)).length;

  // The live canvas: the real renderer with placeholders, stickers drawn on top as HTML.
  const baseSvg = useMemo(
    () => renderMemeSvg({ templateId: template.id, captions, stickers: [] }, { placeholders: true, withoutStickers: true }),
    [template.id, captions],
  );

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setSize(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Reveal: the card flips over as the editor arrives.
  const revealed = useRef(false);
  useEffect(() => {
    if (revealed.current) return;
    revealed.current = true;
    play("whoosh");
  }, []);
  useEffect(() => () => clearTimeout(warnTimer.current), []);

  // "Today's template" banner that lands on the card right after the flip.
  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIntro(false), 2400);
    return () => clearTimeout(timer);
  }, []);

  // Typing makes the caption being edited bounce (the SVG node was just replaced).
  useLayoutEffect(() => {
    const id = bounceSlot.current;
    bounceSlot.current = null;
    if (!id || reduced) return;
    const el = svgHostRef.current?.querySelector<SVGGElement>(`[data-slot="${CSS.escape(id)}"]`);
    if (!el || typeof el.animate !== "function") return;
    el.style.transformBox = "fill-box";
    el.style.transformOrigin = "center";
    el.animate(
      [{ transform: "scale(1)" }, { transform: "scale(1.045) translateY(-1.5%)" }, { transform: "scale(1)" }],
      { duration: 260, easing: "cubic-bezier(.3,1.5,.5,1)" },
    );
  }, [captions, reduced]);

  // ⌘/Ctrl+Enter submits; Escape drops the sticker selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
        e.preventDefault();
        onSubmit();
      } else if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmit, onSubmit]);

  /* ------------------------------ captions ------------------------------ */

  const setCaption = (slot: CaptionSlot, raw: string) => {
    const value = cleanCaptionInput(raw, slot.maxLength);
    bounceSlot.current = slot.id;
    setCaptions((prev) => ({ ...prev, [slot.id]: value }));
    onActivity();
  };

  const focusSlot = useCallback((id: string) => inputs.current.get(id)?.focus(), []);

  /* ------------------------------ stickers ------------------------------ */

  const patchSticker = useCallback(
    (id: string, next: (s: StickerPlacement) => StickerPlacement) => {
      setStickers((prev) => prev.map((s) => (s.id === id ? { ...s, ...clampSticker(next(s)) } : s)));
      onActivity();
    },
    [onActivity, setStickers],
  );

  const onCommit = useCallback((id: string, next: StickerPlacement) => patchSticker(id, () => next), [patchSticker]);

  const onRemove = useCallback(
    (id: string) => {
      setRemoving((prev) => new Set(prev).add(id));
      setSelectedId((cur) => (cur === id ? null : cur));
      play("thump");
      buzz("medium");
      onActivity();
    },
    [buzz, onActivity],
  );

  const onRemoved = useCallback(
    (id: string) => {
      setStickers((prev) => prev.filter((s) => s.id !== id));
      setRemoving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [setStickers],
  );

  const takeSpawn = useCallback((id: string) => {
    const spawn = spawns.current.get(id);
    spawns.current.delete(id);
    return spawn;
  }, []);

  const getTrashRect = useCallback(() => trashEl.current?.getBoundingClientRect() ?? null, []);
  const setBin = useCallback((el: HTMLDivElement | null) => {
    trashEl.current = el;
  }, []);

  const onCanvasTap = useCallback(
    (point: Point) => {
      setSelectedId(null);
      const slot = slotAt(template, point);
      if (slot) focusSlot(slot.id);
    },
    [focusSlot, template],
  );

  /** Where on the canvas (0..1) a tray/dice button sits, so new stickers fly out of it. */
  const spawnPoint = (from: HTMLElement | null): Point | undefined => {
    const stage = stageRef.current?.getBoundingClientRect();
    const r = from?.getBoundingClientRect();
    if (!stage || !r || !stage.width) return undefined;
    return { x: (r.left + r.width / 2 - stage.left) / stage.width, y: (r.top + r.height / 2 - stage.top) / stage.height };
  };

  const addSticker = (emoji: string, from: HTMLElement | null) => {
    if (liveCount >= MAX_STICKERS) {
      setTrayWarn((n) => n + 1);
      setShowWarn(true);
      clearTimeout(warnTimer.current);
      warnTimer.current = setTimeout(() => setShowWarn(false), 1800);
      play("error");
      buzz("error");
      return;
    }
    const placement = randomStickerPlacement(template, emoji, Math.random, stickers);
    const id = nextStickerId();
    const spawn = spawnPoint(from);
    if (spawn) spawns.current.set(id, spawn);
    setStickers((prev) => [...prev, { id, ...placement }]);
    play("pop");
    buzz("light");
    onActivity();
  };

  const rollDice = () => {
    setDiceSpins((n) => n + 1);
    play("draw");
    buzz("medium");
    onActivity();
    if (liveCount === 0) {
      // Nothing to shuffle yet: deal two random stickers out of the dice.
      const picks = [...STICKERS].sort(() => Math.random() - 0.5).slice(0, 2);
      const placed: StickerPlacement[] = [];
      const spawn = spawnPoint(diceRef.current);
      const fresh = picks.map((emoji) => {
        const p = randomStickerPlacement(template, emoji, Math.random, placed);
        placed.push(p);
        const id = nextStickerId();
        if (spawn) spawns.current.set(id, spawn);
        return { id, ...p };
      });
      setStickers((prev) => [...prev, ...fresh]);
      return;
    }
    setStickers((prev) => scatterStickers(template, prev, Math.random));
  };

  /* -------------------------------- tilt -------------------------------- */

  const tiltX = useSpring(0, { stiffness: 200, damping: 18 });
  const tiltY = useSpring(0, { stiffness: 200, damping: 18 });
  const glareX = useMotionValue(50);
  const glareY = useMotionValue(30);
  const glareOpacity = useSpring(0, { stiffness: 200, damping: 30 });
  const glare = useMotionTemplate`radial-gradient(circle at ${glareX}% ${glareY}%, rgb(255 255 255 / 0.22), transparent 55%)`;
  const tiltEnabled = !reduced && !dragging && !selected;

  useEffect(() => {
    if (tiltEnabled) return;
    tiltX.set(0);
    tiltY.set(0);
    glareOpacity.set(0);
  }, [tiltEnabled, tiltX, tiltY, glareOpacity]);

  const onStageMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tiltEnabled || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    tiltX.set(-py * 7);
    tiltY.set(px * 9);
    glareX.set((px + 0.5) * 100);
    glareY.set((py + 0.5) * 100);
    glareOpacity.set(1);
  };
  const onStageLeave = () => {
    tiltX.set(0);
    tiltY.set(0);
    glareOpacity.set(0);
  };

  /* ------------------------------- render ------------------------------- */

  const focused = template.slots.find((s) => s.id === focusedSlot);
  const focusBox = focused ? slotBounds(focused) : null;

  return (
    <motion.div
      className="mdl-editor mx-auto flex h-full min-h-0 w-full max-w-[1180px] flex-col gap-2.5 px-4 pb-3 pt-3 md:gap-4 md:px-6 md:pb-6 md:pt-4"
      // Phones reserve room for one input per caption slot below the canvas.
      style={{ "--slots": template.slots.length } as CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.08, delay: 0.24 } }}
    >
      <style>{EDITOR_CSS}</style>

      {/* Top bar */}
      <motion.header
        className="flex h-11 shrink-0 items-center gap-2"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12, transition: { duration: 0.16 } }}
        transition={{ ...spring.soft, delay: 0.15 }}
      >
        <motion.div
          className="flex min-w-0 shrink items-center gap-2 rounded-full bg-white/[0.05] p-1 ring-1 ring-white/10 sm:pr-3"
          title={template.name}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ ...spring.wobbly, delay: 0.55 }}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] text-sm">🖼️</span>
          <span className="hidden truncate font-display text-sm font-bold tracking-tight sm:inline">{template.name}</span>
        </motion.div>
        <div className="flex min-w-0 flex-1 justify-center">{opponent}</div>
        <div className="shrink-0">{timer}</div>
      </motion.header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 md:flex-row md:items-start md:justify-center md:gap-6">
        {/* Canvas column */}
        <div className="flex w-full shrink-0 flex-col items-center gap-2 md:w-auto md:self-start">
          <div
            ref={stageRef}
            className="relative z-20 touch-none select-none"
            style={{ width: "var(--cv)", height: "var(--cv)", perspective: 1100 }}
            onPointerMove={onStageMove}
            onPointerLeave={onStageLeave}
          >
            <motion.div
              className="relative size-full"
              style={{ transformStyle: "preserve-3d" }}
              initial={reduced ? { opacity: 0 } : { rotateY: 180, scale: 0.9 }}
              animate={reduced ? { opacity: 1 } : { rotateY: 0, scale: 1 }}
              exit={
                reduced
                  ? { opacity: 0, transition: { duration: 0.15 } }
                  : { rotateY: 90, scale: 0.92, transition: { duration: 0.24, ease: [0.7, 0, 0.84, 0] } }
              }
              transition={{ type: "spring", stiffness: 90, damping: 14, delay: 0.1 }}
            >
              {/* Front: the live meme */}
              <motion.div
                className="absolute inset-0"
                style={{ backfaceVisibility: "hidden", rotateX: tiltX, rotateY: tiltY, transformStyle: "preserve-3d" }}
              >
                <div
                  className="absolute inset-0 overflow-hidden rounded-[var(--r)] bg-ink-800 shadow-[0_30px_70px_-28px_var(--accent-to),0_0_0_1px_rgb(255_255_255/0.1)]"
                  role="img"
                  aria-label={`${template.name} meme preview`}
                >
                  <div
                    ref={svgHostRef}
                    className="size-full [&>svg]:block [&>svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: baseSvg }}
                  />
                  <motion.div
                    aria-hidden
                    className="pointer-events-none absolute inset-0 mix-blend-overlay"
                    style={{ background: glare, opacity: glareOpacity }}
                  />
                </div>

                <AnimatePresence>
                  {intro && (
                    <motion.div
                      key="intro"
                      className="pointer-events-none absolute inset-x-0 top-[38%] z-10 flex justify-center"
                      initial={{ opacity: 0, scale: 0.4, rotate: -10 }}
                      animate={{ opacity: 1, scale: 1, rotate: -3, transition: { ...spring.wobbly, delay: reduced ? 0 : 0.8 } }}
                      exit={{ opacity: 0, y: -24, scale: 0.85, transition: { duration: 0.25 } }}
                    >
                      <div className="rounded-2xl bg-ink-950/85 px-5 py-2.5 text-center shadow-[0_20px_50px_-12px_rgb(0_0_0/0.7)] ring-1 ring-white/15 backdrop-blur-md">
                        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--accent-from)]">Your template</p>
                        <p className="font-display text-2xl font-extrabold tracking-tight">{template.name}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {focusBox && focused && (
                    <motion.div
                      key="focus"
                      layout
                      aria-hidden
                      className="pointer-events-none absolute rounded-xl border-2 border-dashed border-[var(--accent-from)] shadow-[0_0_0_4px_rgb(0_0_0/0.18),0_0_30px_-6px_var(--accent-from)]"
                      style={{
                        left: `${(focusBox.x - 0.015) * 100}%`,
                        top: `${(focusBox.y - 0.015) * 100}%`,
                        width: `${(focusBox.w + 0.03) * 100}%`,
                        height: `${(focusBox.h + 0.03) * 100}%`,
                      }}
                      initial={{ opacity: 0, scale: 1.08 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 1.04 }}
                      transition={spring.snappy}
                    >
                      <motion.span
                        key={focused.id}
                        initial={{ y: 6, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        className={cn(
                          "absolute left-2 rounded-full bg-[var(--accent-from)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-950",
                          focusBox.y < 0.1 ? "-bottom-3" : "-top-3",
                        )}
                      >
                        {focused.label ?? focused.id}
                      </motion.span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <StickerLayer
                  stickers={stickers}
                  size={size}
                  selectedId={selectedId}
                  removing={removing}
                  onSelect={setSelectedId}
                  onCommit={onCommit}
                  onRemove={onRemove}
                  onRemoved={onRemoved}
                  takeSpawn={takeSpawn}
                  getTrashRect={getTrashRect}
                  onDragChange={setDragging}
                  onTrashHover={setTrashHot}
                  onCanvasTap={onCanvasTap}
                />
              </motion.div>

              {/* Back: the face-down card seen during the reveal flip */}
              <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
                <CardBack />
              </div>
            </motion.div>

            <TrashZone visible={dragging} hot={trashHot} binRef={setBin} />
          </div>

          {/* Sticker tray ⇄ selected-sticker tools */}
          <motion.div
            className="relative flex h-14 w-full items-center md:w-[var(--cv)]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: dragging ? 0.25 : 1, y: 0 }}
            exit={{ opacity: 0, y: 16, transition: { duration: 0.16 } }}
            transition={{ ...spring.soft, delay: 0.25 }}
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {selected ? (
                <StickerTools
                  key="tools"
                  sticker={selected}
                  onRotate={(deg) => patchSticker(selected.id, (s) => ({ ...s, rotate: s.rotate + deg }))}
                  onScale={(f) => patchSticker(selected.id, (s) => ({ ...s, scale: s.scale * f }))}
                  onRemove={() => onRemove(selected.id)}
                  onDone={() => setSelectedId(null)}
                />
              ) : (
                <StickerTray
                  key="tray"
                  count={liveCount}
                  warn={trayWarn}
                  showWarn={showWarn}
                  spins={diceSpins}
                  diceRef={diceRef}
                  onAdd={addSticker}
                  onDice={rollDice}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {/* Controls */}
        <motion.section
          aria-label="Captions"
          className="flex min-h-0 w-full flex-1 flex-col gap-3 md:max-w-[420px] md:self-stretch md:rounded-[28px] md:border md:border-white/[0.08] md:bg-ink-850/60 md:p-5 md:backdrop-blur-xl"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
          transition={{ ...spring.soft, delay: 0.3 }}
        >
          <div className="hidden md:block">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ink-300">Caption battle</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight">Make the crowd laugh</h2>
            <p className="mt-1 text-sm text-ink-300">Same template for both of you. Funniest meme takes the Arena vote.</p>
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-ink-200 ring-1 ring-white/10">
              <span className="size-1.5 rounded-full bg-[var(--accent-from)]" />
              {modeHint}
            </p>
          </div>
          <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-1 pt-1">
            {template.slots.map((slot, i) => (
              <CaptionField
                key={slot.id}
                index={i}
                slot={slot}
                value={captions[slot.id] ?? ""}
                isLast={i === template.slots.length - 1}
                inputRef={(el) => {
                  if (el) inputs.current.set(slot.id, el);
                  else inputs.current.delete(slot.id);
                }}
                onChange={(raw) => setCaption(slot, raw)}
                onFocus={() => {
                  setFocusedSlot(slot.id);
                  setSelectedId(null);
                }}
                onBlur={() => setFocusedSlot((cur) => (cur === slot.id ? null : cur))}
                onNext={() => {
                  const next = template.slots[i + 1];
                  if (next) focusSlot(next.id);
                  else inputs.current.get(slot.id)?.blur();
                }}
              />
            ))}
            <p className="hidden text-xs leading-relaxed text-ink-400 md:block">
              Tip: tap the meme to jump to a caption. Drag stickers anywhere, use the ↻ handle (or pinch / scroll) to spin and
              resize, and drop them in the 🗑️ to remove.
            </p>
          </div>
          <SubmitButton enabled={canSubmit} onSubmit={onSubmit} />
          <p className="-mt-1 hidden text-center text-[11px] text-ink-400 md:block">
            <kbd className="rounded bg-white/10 px-1 font-mono">⌘</kbd> + <kbd className="rounded bg-white/10 px-1 font-mono">Enter</kbd> to lock
            it in
          </p>
        </motion.section>
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Caption field                                                          */
/* ---------------------------------------------------------------------- */

function CaptionField({
  index,
  slot,
  value,
  isLast,
  inputRef,
  onChange,
  onFocus,
  onBlur,
  onNext,
}: {
  index: number;
  slot: CaptionSlot;
  value: string;
  isLast: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onNext: () => void;
}) {
  const reduced = useReducedMotion();
  const [bumps, setBumps] = useState(0);
  const id = `caption-${slot.id}`;
  const length = value.length;
  const ratio = length / slot.maxLength;
  const tone = ratio >= 1 ? "text-danger" : ratio >= 0.85 ? "text-gold" : "text-ink-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.soft, delay: 0.35 + index * 0.07 }}
    >
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <label htmlFor={id} className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink-300">
          {slot.label ?? slot.id}
        </label>
        <motion.span
          key={bumps}
          className={cn("font-mono text-[11px] font-semibold tabular transition-colors", tone)}
          animate={bumps && !reduced ? { x: [0, -5, 5, -3, 3, 0] } : undefined}
          transition={{ duration: 0.35 }}
          aria-live="polite"
        >
          {length}/{slot.maxLength}
        </motion.span>
      </div>
      <div className="group relative flex items-center overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-white/10 transition-[box-shadow,background-color] duration-200 focus-within:bg-white/[0.08] focus-within:ring-2 focus-within:ring-[var(--accent-from)]">
        {slot.prefix && <span className="shrink-0 pl-3.5 text-[15px] font-extrabold text-ink-100">{slot.prefix}</span>}
        <input
          ref={inputRef}
          id={id}
          value={value}
          maxLength={slot.maxLength}
          placeholder={slot.placeholder}
          autoComplete="off"
          autoCapitalize="sentences"
          enterKeyHint={isLast ? "done" : "next"}
          spellCheck
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              onNext();
            } else if (value.length >= slot.maxLength && e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
              setBumps((n) => n + 1);
              play("error");
            }
          }}
          className="h-12 min-w-0 flex-1 bg-transparent px-3.5 text-[15px] font-semibold text-ink-50 outline-none placeholder:font-medium placeholder:text-ink-400"
        />
        <AnimatePresence>
          {value && (
            <motion.button
              type="button"
              aria-label={`Clear ${slot.label ?? slot.id}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              whileTap={{ scale: 0.8 }}
              transition={spring.bouncy}
              onClick={() => {
                onChange("");
                play("tick");
              }}
              className="mr-2 grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-ink-200 hover:bg-white/20"
            >
              <X className="size-3.5" strokeWidth={3} />
            </motion.button>
          )}
        </AnimatePresence>
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-[linear-gradient(90deg,var(--accent-from),var(--accent-to))]"
          animate={{ scaleX: Math.min(1, ratio) }}
          transition={spring.snappy}
        />
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------------- */
/* Sticker tray & tools                                                   */
/* ---------------------------------------------------------------------- */

function StickerTray({
  count,
  warn,
  showWarn,
  spins,
  diceRef,
  onAdd,
  onDice,
}: {
  count: number;
  /** Bumps every time a full tray is tapped (drives the shake). */
  warn: number;
  showWarn: boolean;
  spins: number;
  diceRef: RefObject<HTMLButtonElement | null>;
  onAdd: (emoji: string, from: HTMLElement) => void;
  onDice: () => void;
}) {
  const reduced = useReducedMotion();
  const full = count >= MAX_STICKERS;

  return (
    <motion.div
      className="relative flex size-full items-center gap-2"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={spring.snappy}
    >
      <motion.button
        ref={diceRef}
        type="button"
        aria-label="Shuffle stickers"
        title="Shuffle stickers"
        onClick={onDice}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.85 }}
        className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] text-2xl shadow-[0_10px_30px_-12px_var(--accent-to)]"
      >
        <motion.span animate={{ rotate: spins * 360 }} transition={spring.wobbly} className="block">
          🎲
        </motion.span>
        <motion.span
          key={count}
          initial={{ scale: 0.4 }}
          animate={{ scale: 1 }}
          transition={spring.wobbly}
          className={cn(
            "absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[10px] font-bold tabular ring-2 ring-ink-950",
            full ? "bg-gold text-ink-950" : "bg-ink-100 text-ink-950",
          )}
        >
          {count}/{MAX_STICKERS}
        </motion.span>
      </motion.button>

      <motion.div
        key={warn}
        className="no-scrollbar mask-fade-x flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-2"
        animate={warn && !reduced ? { x: [0, -8, 8, -5, 5, 0] } : undefined}
        transition={{ duration: 0.4 }}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
        role="toolbar"
        aria-label="Stickers"
      >
        {STICKERS.map((emoji, i) => (
          <motion.button
            key={emoji}
            type="button"
            aria-label={`Add ${emoji} sticker`}
            aria-disabled={full}
            onClick={(e) => onAdd(emoji, e.currentTarget)}
            whileHover={{ scale: 1.22, y: -3, rotate: i % 2 ? 8 : -8 }}
            whileTap={{ scale: 0.78 }}
            transition={spring.bouncy}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-2xl bg-white/[0.05] text-[26px] leading-none ring-1 ring-white/[0.08] transition-[opacity,background-color] hover:bg-white/[0.12]",
              full && "opacity-40",
            )}
          >
            {emoji}
          </motion.button>
        ))}
      </motion.div>

      <AnimatePresence>
        {showWarn && (
          <motion.p
            role="status"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={spring.bouncy}
            className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold px-3 py-1 text-xs font-bold text-ink-950 shadow-lg"
          >
            3 stickers max — drag one to the 🗑️
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StickerTools({
  sticker,
  onRotate,
  onScale,
  onRemove,
  onDone,
}: {
  sticker: EditorSticker;
  onRotate: (deg: number) => void;
  onScale: (factor: number) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  return (
    <motion.div
      className="flex size-full items-center gap-1 rounded-2xl bg-ink-850/80 px-1.5 ring-1 ring-white/10 backdrop-blur-xl"
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -14, scale: 0.96 }}
      transition={spring.snappy}
      role="toolbar"
      aria-label="Selected sticker"
    >
      <motion.span
        key={sticker.id}
        className="grid size-10 shrink-0 place-items-center text-[26px]"
        initial={{ scale: 0.3, rotate: -30 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={spring.wobbly}
      >
        {sticker.emoji}
      </motion.span>
      <div className="flex flex-1 items-center justify-center gap-1">
        <ToolButton label="Rotate left" onClick={() => onRotate(-15)}>
          <RotateCcw className="size-[18px]" />
        </ToolButton>
        <ToolButton label="Rotate right" onClick={() => onRotate(15)}>
          <RotateCw className="size-[18px]" />
        </ToolButton>
        <ToolButton label="Smaller" onClick={() => onScale(1 / 1.15)}>
          <Minus className="size-[18px]" />
        </ToolButton>
        <ToolButton label="Bigger" onClick={() => onScale(1.15)}>
          <Plus className="size-[18px]" />
        </ToolButton>
        <ToolButton label="Remove sticker" tone="danger" onClick={onRemove}>
          <Trash2 className="size-[18px]" />
        </ToolButton>
      </div>
      <ToolButton label="Done" tone="accent" onClick={onDone}>
        <Check className="size-[18px]" strokeWidth={3} />
      </ToolButton>
    </motion.div>
  );
}

function ToolButton({
  label,
  onClick,
  tone = "plain",
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: "plain" | "danger" | "accent";
  children: ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        play("tick");
        onClick();
      }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.82 }}
      transition={spring.bouncy}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
        tone === "plain" && "text-ink-100 hover:bg-white/10",
        tone === "danger" && "text-danger hover:bg-danger/15",
        tone === "accent" && "bg-[linear-gradient(135deg,var(--accent-from),var(--accent-to))] text-ink-950",
      )}
    >
      {children}
    </motion.button>
  );
}

/* ---------------------------------------------------------------------- */
/* Submit                                                                 */
/* ---------------------------------------------------------------------- */

function SubmitButton({ enabled, onSubmit }: { enabled: boolean; onSubmit: () => void }) {
  const reduced = useReducedMotion();
  return (
    <motion.button
      type="button"
      disabled={!enabled}
      onClick={() => {
        play("pop");
        onSubmit();
      }}
      whileHover={enabled ? { scale: 1.02 } : undefined}
      whileTap={enabled ? { scale: 0.95 } : undefined}
      animate={enabled && !reduced ? { scale: [1, 1.05, 1], transition: { duration: 0.45, ease: "easeOut" } } : { scale: 1 }}
      transition={spring.bouncy}
      className={cn(
        "relative flex h-13 w-full shrink-0 items-center justify-center gap-2 overflow-hidden rounded-2xl text-base font-bold tracking-tight transition-[background-color,color,box-shadow] duration-300 md:h-14",
        enabled
          ? "bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] text-ink-950 shadow-[0_14px_40px_-14px_var(--accent-to)]"
          : "bg-white/[0.06] text-ink-400 ring-1 ring-white/10",
      )}
    >
      {enabled && (
        <span
          aria-hidden
          className="absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,transparent_35%,rgb(255_255_255/0.35)_50%,transparent_65%)] bg-[length:250%_100%] motion-reduce:animate-none"
        />
      )}
      <Stamp className="relative size-5" strokeWidth={2.5} />
      <span className="relative">{enabled ? "Lock it in" : "Write a caption to submit"}</span>
    </motion.button>
  );
}
