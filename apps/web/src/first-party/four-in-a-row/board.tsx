"use client";

import { AnimatePresence, motion } from "motion/react";
import { memo, useId, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  BOARD_H,
  BOARD_RADIUS,
  BOARD_W,
  CELL,
  DISC_R,
  GHOST_Y,
  HOLE_R,
  LANE,
  PAD,
  SEAT_COLORS,
  VIEW_H,
  VIEW_W,
  colX,
  dropPlan,
  rowY,
} from "./geometry";
import { COLS, ROWS, type Coord, type Disc, type GameState, type Seat } from "./logic";

/* ------------------------------------------------------------------------ */
/* Shared SVG defs                                                          */
/* ------------------------------------------------------------------------ */

export type BoardIds = ReturnType<typeof useBoardIds>;

/** Unique ids so several boards (e.g. the pre-game preview) can coexist. */
export function useBoardIds() {
  const base = `fiar${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return useMemo(
    () => ({
      mask: `${base}-mask`,
      plate: `${base}-plate`,
      tint: `${base}-tint`,
      sheen: `${base}-sheen`,
      edge: `${base}-edge`,
      rim: `${base}-rim`,
      well: `${base}-well`,
      inner: `${base}-inner`,
      spec: `${base}-spec`,
      glow: `${base}-glow`,
      soft: `${base}-soft`,
      col0: `${base}-col0`,
      col1: `${base}-col1`,
      disc0: `${base}-disc0`,
      disc1: `${base}-disc1`,
    }),
    [base],
  );
}

export function DiscDefs({ ids }: { ids: BoardIds }) {
  return (
    <>
      {([0, 1] as const).map((seat) => {
        const c = SEAT_COLORS[seat];
        return (
          <radialGradient key={seat} id={seat === 0 ? ids.disc0 : ids.disc1} cx="0.4" cy="0.34" r="0.78">
            <stop offset="0" stopColor={c.light} />
            <stop offset="0.42" stopColor={c.base} />
            <stop offset="1" stopColor={c.dark} />
          </radialGradient>
        );
      })}
      <radialGradient id={ids.spec} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
        <stop offset="1" stopColor="#fff" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

/** A disc centred on (0, 0): gradient body, moulded inner ring, specular glint. */
export function DiscShape({ seat, ids, r = DISC_R }: { seat: Seat; ids: BoardIds; r?: number }) {
  const c = SEAT_COLORS[seat];
  return (
    <>
      <circle r={r} fill={`url(#${seat === 0 ? ids.disc0 : ids.disc1})`} />
      <circle r={r * 0.68} fill="none" stroke={c.dark} strokeOpacity={0.55} strokeWidth={r * 0.1} />
      <circle r={r * 0.68} cy={r * 0.05} fill="none" stroke="#fff" strokeOpacity={0.25} strokeWidth={r * 0.04} />
      <ellipse
        cx={-r * 0.3}
        cy={-r * 0.42}
        rx={r * 0.36}
        ry={r * 0.18}
        transform={`rotate(-28 ${-r * 0.3} ${-r * 0.42})`}
        fill={`url(#${ids.spec})`}
      />
    </>
  );
}

const SVG_ORIGIN = { transformBox: "fill-box", transformOrigin: "50% 50%" } as const;

/* ------------------------------------------------------------------------ */
/* Discs                                                                    */
/* ------------------------------------------------------------------------ */

const DiscSprite = memo(function DiscSprite({
  disc,
  ids,
  dim,
  reduced,
  delay,
  settled,
}: {
  disc: Disc;
  ids: BoardIds;
  dim: boolean;
  reduced: boolean;
  delay: number;
  /** Already on the board when we opened it: no drop, it's just there. */
  settled: boolean;
}) {
  const plan = useMemo(() => dropPlan(disc.row, reduced), [disc.row, reduced]);
  return (
    <g transform={`translate(${colX(disc.col)} ${rowY(disc.row)})`}>
      <motion.g animate={{ opacity: dim ? 0.26 : 1 }} transition={{ duration: 0.45 }}>
        <motion.g
          style={SVG_ORIGIN}
          initial={settled ? false : { y: plan.y[0], scaleX: 1, scaleY: 1 }}
          animate={{ y: plan.y, scaleX: plan.scaleX, scaleY: plan.scaleY }}
          transition={{
            y: { duration: plan.totalMs / 1000, times: plan.yTimes, ease: plan.yEase, delay },
            scaleX: { duration: plan.totalMs / 1000, times: plan.scaleTimes, delay },
            scaleY: { duration: plan.totalMs / 1000, times: plan.scaleTimes, delay },
          }}
        >
          <DiscShape seat={disc.seat} ids={ids} />
        </motion.g>
      </motion.g>
    </g>
  );
});

/* ------------------------------------------------------------------------ */
/* Board                                                                    */
/* ------------------------------------------------------------------------ */

export interface BoardProps {
  game: GameState;
  width: number;
  height: number;
  mySeat: Seat;
  /** It's our move: show our ghost and accept input. */
  canPlay: boolean;
  aim: number;
  /** Where the player to move (not us) is aiming: a live opponent, the bot. */
  otherAim: { seat: Seat; col: number } | null;
  /** Win/draw effects are showing. */
  reveal: boolean;
  /** Discs already on the board when it mounted (a resumed game) appear at rest. */
  restoredCount: number;
  /** Softly pulse a ring on the most recent disc (it has landed). */
  highlightLast: boolean;
  /** Bumped each time the turn arrives: a sweep of our colour around the rim. */
  turnFlash: number;
  reduced: boolean;
  /** Bumped when a drop is rejected (full column) to wiggle the ghost. */
  bump: { col: number; key: number } | null;
  onAim: (col: number) => void;
  onDrop: (col: number) => void;
  /** Rendered over the ghost lane (results, timeout notices). */
  lane?: ReactNode;
  className?: string;
}

const HOLES: Coord[] = Array.from({ length: COLS * ROWS }, (_, i) => ({ col: i % COLS, row: Math.floor(i / COLS) }));

export function Board({
  game,
  width,
  height,
  mySeat,
  canPlay,
  aim,
  otherAim,
  reveal,
  restoredCount,
  highlightLast,
  turnFlash,
  reduced,
  bump,
  onAim,
  onDrop,
  lane,
  className,
}: BoardProps) {
  const ids = useBoardIds();
  const [pressed, setPressed] = useState(false);

  // Discs that arrive together (a sync catching us up) cascade in.
  const [firstBatch, setFirstBatch] = useState({ count: game.discs.length, seen: game.discs.length });
  if (firstBatch.seen !== game.discs.length) {
    setFirstBatch({ count: firstBatch.seen, seen: game.discs.length });
  }
  const batchStart = firstBatch.count;

  const winSet = useMemo(() => new Set(game.winLines.flat().map((c) => `${c.col}:${c.row}`)), [game.winLines]);
  const aimFull = (game.heights[aim] ?? 0) >= ROWS;
  const ghostSeat: Seat | null = canPlay ? mySeat : (otherAim?.seat ?? null);
  const ghostCol = canPlay ? aim : (otherAim?.col ?? null);
  const lastDisc = game.discs[game.discs.length - 1];

  const colFromEvent = (event: ReactPointerEvent<HTMLDivElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const y = event.clientY - rect.top;
    // Released well outside the board → treat as a cancel.
    if (x < -CELL / 2 || x > VIEW_W + CELL / 2 || y < -40 || y > rect.height + 40) return null;
    return Math.max(0, Math.min(COLS - 1, Math.floor((x - PAD) / CELL)));
  };

  const describe = `Four in a row board, ${game.discs.length} discs played.`;

  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={width} height={height} role="img" aria-label={describe} className="absolute inset-0 overflow-visible">
        <defs>
          <DiscDefs ids={ids} />
          <linearGradient id={ids.plate} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a97ff" />
            <stop offset="0.5" stopColor="#3d7bff" />
            <stop offset="1" stopColor="#1f4fd4" />
          </linearGradient>
          <linearGradient id={ids.tint} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#35e0ff" stopOpacity="0" />
            <stop offset="1" stopColor="#35e0ff" stopOpacity="0.28" />
          </linearGradient>
          <linearGradient id={ids.sheen} x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.34" />
            <stop offset="0.3" stopColor="#fff" stopOpacity="0.1" />
            <stop offset="0.31" stopColor="#fff" stopOpacity="0.02" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={ids.edge} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dff6ff" stopOpacity="0.7" />
            <stop offset="0.5" stopColor="#9fd0ff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#061a5c" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id={ids.rim} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#03103f" stopOpacity="0.75" />
            <stop offset="0.55" stopColor="#1b3fa8" stopOpacity="0.2" />
            <stop offset="1" stopColor="#c4ecff" stopOpacity="0.75" />
          </linearGradient>
          <linearGradient id={ids.well} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#07102e" />
            <stop offset="1" stopColor="#0c1c52" />
          </linearGradient>
          <radialGradient id={ids.inner} cx="0.5" cy="0.62" r="0.62">
            <stop offset="0.7" stopColor="#020a2a" stopOpacity="0" />
            <stop offset="1" stopColor="#020a2a" stopOpacity="0.6" />
          </radialGradient>
          {([0, 1] as const).map((seat) => (
            <linearGradient key={seat} id={seat === 0 ? ids.col0 : ids.col1} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={SEAT_COLORS[seat].base} stopOpacity="0.4" />
              <stop offset="1" stopColor={SEAT_COLORS[seat].base} stopOpacity="0.08" />
            </linearGradient>
          ))}
          <filter id={ids.glow} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id={ids.soft} x="-20%" y="-200%" width="140%" height="500%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <mask id={ids.mask} maskUnits="userSpaceOnUse" x="0" y="0" width={VIEW_W} height={VIEW_H}>
            <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#fff" />
            {HOLES.map(({ col, row }) => (
              <circle key={`${col}:${row}`} cx={colX(col)} cy={rowY(row)} r={HOLE_R} fill="#000" />
            ))}
          </mask>
        </defs>

        {/* Ground shadow */}
        <ellipse cx={VIEW_W / 2} cy={LANE + BOARD_H + 6} rx={BOARD_W * 0.44} ry={12} fill="#000" opacity={0.55} filter={`url(#${ids.soft})`} />

        {/* The well behind the discs, seen through empty holes */}
        <rect x={PAD / 2} y={LANE + PAD / 2} width={BOARD_W - PAD} height={BOARD_H - PAD} rx={BOARD_RADIUS - 8} fill={`url(#${ids.well})`} />

        {/* Hovered column lights up its empty holes */}
        <AnimatePresence>
          {canPlay && !aimFull && (
            <motion.rect
              key="col-glow"
              y={LANE + PAD}
              width={CELL}
              height={ROWS * CELL}
              fill={`url(#${mySeat === 0 ? ids.col0 : ids.col1})`}
              initial={{ opacity: 0, x: colX(aim) - CELL / 2 }}
              animate={{ opacity: 1, x: colX(aim) - CELL / 2 }}
              exit={{ opacity: 0 }}
              transition={{ x: { type: "spring", stiffness: 520, damping: 34 }, opacity: { duration: 0.2 } }}
            />
          )}
        </AnimatePresence>

        {/* Discs sit behind the plate and show through the holes */}
        <g>
          {game.discs.map((disc) => (
            <DiscSprite
              key={disc.n}
              disc={disc}
              ids={ids}
              reduced={reduced}
              dim={reveal && winSet.size > 0 && !winSet.has(`${disc.col}:${disc.row}`)}
              delay={disc.n >= batchStart && game.discs.length - batchStart > 1 ? (disc.n - batchStart) * 0.06 : 0}
              settled={disc.n < restoredCount}
            />
          ))}
        </g>

        {/* Recess shading inside each hole */}
        <g pointerEvents="none">
          {HOLES.map(({ col, row }) => (
            <circle key={`${col}:${row}`} cx={colX(col)} cy={rowY(row)} r={HOLE_R + 0.5} fill={`url(#${ids.inner})`} />
          ))}
        </g>

        {/* The glossy plate with holes punched out */}
        <g mask={`url(#${ids.mask})`}>
          <rect x={0} y={LANE} width={BOARD_W} height={BOARD_H} rx={BOARD_RADIUS} fill={`url(#${ids.plate})`} />
          <rect x={0} y={LANE} width={BOARD_W} height={BOARD_H} rx={BOARD_RADIUS} fill={`url(#${ids.tint})`} />
          <rect x={0} y={LANE} width={BOARD_W} height={BOARD_H} rx={BOARD_RADIUS} fill={`url(#${ids.sheen})`} />
        </g>
        <rect
          x={1.5}
          y={LANE + 1.5}
          width={BOARD_W - 3}
          height={BOARD_H - 3}
          rx={BOARD_RADIUS - 1.5}
          fill="none"
          stroke={`url(#${ids.edge})`}
          strokeWidth={3}
        />
        <g pointerEvents="none">
          {HOLES.map(({ col, row }) => (
            <circle key={`${col}:${row}`} cx={colX(col)} cy={rowY(row)} r={HOLE_R + 1.5} fill="none" stroke={`url(#${ids.rim})`} strokeWidth={3.5} />
          ))}
        </g>

        {/* "Your turn": a sweep of our colour around the rim */}
        {turnFlash > 0 && (
          <motion.g
            key={`flash-${turnFlash}`}
            pointerEvents="none"
            initial={{ opacity: reduced ? 0 : 1 }}
            animate={{ opacity: reduced ? [0, 0.9, 0] : [1, 1, 0] }}
            // Starts as the opponent's disc lands, not while it's still falling.
            transition={{ duration: reduced ? 0.9 : 1.3, times: [0, 0.6, 1], ease: "easeOut", delay: reduced ? 0 : 0.3 }}
          >
            {[
              { width: 20, opacity: 0.7, blur: true },
              { width: 6, opacity: 1, blur: false },
            ].map(({ width, opacity, blur }) => (
              <motion.rect
                key={width}
                x={1.5}
                y={LANE + 1.5}
                width={BOARD_W - 3}
                height={BOARD_H - 3}
                rx={BOARD_RADIUS - 1.5}
                fill="none"
                stroke={blur ? SEAT_COLORS[mySeat].glow : SEAT_COLORS[mySeat].light}
                strokeWidth={width}
                strokeLinecap="round"
                opacity={opacity}
                filter={blur ? `url(#${ids.glow})` : undefined}
                initial={reduced ? false : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
              />
            ))}
          </motion.g>
        )}

        {/* The last move: a gentle pulse so a returning player sees what changed */}
        <AnimatePresence>
          {highlightLast && lastDisc && !(reveal && game.winner !== null) && (
            <motion.g
              key={`last-${lastDisc.n}`}
              pointerEvents="none"
              transform={`translate(${colX(lastDisc.col)} ${rowY(lastDisc.row)})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.2 } }}
              transition={{ duration: 0.3 }}
            >
              <motion.circle
                r={HOLE_R + 5}
                fill="none"
                stroke="#fff"
                strokeWidth={4}
                style={SVG_ORIGIN}
                animate={reduced ? { opacity: 0.55 } : { opacity: [0.7, 0.18, 0.7], scale: [1, 1.07, 1] }}
                transition={reduced ? { duration: 0.2 } : { duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.g>
          )}
        </AnimatePresence>

        {/* Where our disc will land */}
        <AnimatePresence>
          {canPlay && !aimFull && (
            <motion.g
              key="landing"
              initial={{ opacity: 0, x: colX(aim), y: rowY(game.heights[aim] ?? 0) }}
              animate={{ opacity: 1, x: colX(aim), y: rowY(game.heights[aim] ?? 0) }}
              exit={{ opacity: 0 }}
              transition={{ x: { type: "spring", stiffness: 520, damping: 34 }, y: spring.snappy, opacity: { duration: 0.2 } }}
            >
              <motion.circle
                r={HOLE_R - 5}
                fill="none"
                stroke={SEAT_COLORS[mySeat].base}
                strokeWidth={4}
                strokeDasharray="9 8"
                strokeLinecap="round"
                style={SVG_ORIGIN}
                animate={reduced ? { opacity: 0.7 } : { rotate: 360, opacity: [0.45, 0.9, 0.45] }}
                transition={{ rotate: { duration: 7, repeat: Infinity, ease: "linear" }, opacity: { duration: 1.4, repeat: Infinity } }}
              />
            </motion.g>
          )}
        </AnimatePresence>

        {/* Ghost disc hovering in the lane */}
        <AnimatePresence>
          {ghostSeat !== null && ghostCol !== null && (
            <Ghost
              key={`ghost-${game.moves.length}`}
              seat={ghostSeat}
              col={ghostCol}
              ids={ids}
              mine={canPlay}
              pressed={canPlay && pressed}
              bump={canPlay && bump?.col === ghostCol ? bump.key : null}
              reduced={reduced}
            />
          )}
        </AnimatePresence>

        {/* Winning four: pop out, pulse, and a glowing line through them */}
        {reveal && game.winLines.length > 0 && game.winner !== null && (
          <WinOverlay lines={game.winLines} seat={game.winner} ids={ids} reduced={reduced} />
        )}
      </svg>

      {/* Lane overlay (HTML so text renders crisply) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center" style={{ height: `${(LANE / VIEW_H) * 100}%` }}>
        {lane}
      </div>

      {/* Input: one surface for mouse & touch (aim by hovering/dragging, release to drop) */}
      <div
        className={cn("absolute inset-x-0 top-0 touch-none", canPlay ? "cursor-pointer" : "cursor-default")}
        style={{ height: `${((LANE + BOARD_H) / VIEW_H) * 100}%` }}
        role="group"
        aria-label="Board columns"
        onPointerMove={(e) => {
          const col = colFromEvent(e);
          if (col !== null && (e.pointerType === "mouse" || pressed)) onAim(col);
        }}
        onPointerDown={(e) => {
          if (!canPlay || (e.pointerType === "mouse" && e.button !== 0)) return;
          const col = colFromEvent(e);
          if (col === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setPressed(true);
          onAim(col);
        }}
        onPointerUp={(e) => {
          if (!pressed) return;
          setPressed(false);
          const col = colFromEvent(e);
          if (col !== null) onDrop(col);
        }}
        onPointerCancel={() => setPressed(false)}
      >
        {Array.from({ length: COLS }, (_, col) => {
          const full = (game.heights[col] ?? 0) >= ROWS;
          return (
            <button
              key={col}
              type="button"
              data-col={col}
              tabIndex={canPlay ? 0 : -1}
              aria-label={`Drop in column ${col + 1}${full ? " (full)" : ""}`}
              aria-disabled={!canPlay || full}
              onFocus={() => onAim(col)}
              onClick={() => onDrop(col)}
              className="pointer-events-none absolute top-0 h-full rounded-[1.25rem] outline-none focus-visible:bg-white/[0.06] focus-visible:ring-2 focus-visible:ring-white/60"
              style={{ left: `${((PAD + col * CELL) / VIEW_W) * 100}%`, width: `${(CELL / VIEW_W) * 100}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Ghost disc                                                               */
/* ------------------------------------------------------------------------ */

function Ghost({
  seat,
  col,
  ids,
  mine,
  pressed,
  bump,
  reduced,
}: {
  seat: Seat;
  col: number;
  ids: BoardIds;
  mine: boolean;
  pressed: boolean;
  bump: number | null;
  reduced: boolean;
}) {
  return (
    <motion.g
      initial={{ x: colX(col), y: GHOST_Y - 60, opacity: 0, scale: 0.4 }}
      animate={{ x: colX(col), y: GHOST_Y, opacity: 1, scale: 1 }}
      // Vanishes instantly: the real disc takes its place and falls.
      exit={{ opacity: 0, transition: { duration: 0.05 } }}
      transition={{
        x: { type: "spring", stiffness: mine ? 560 : 300, damping: mine ? 32 : 26, mass: 0.9 },
        y: spring.bouncy,
        scale: spring.bouncy,
        opacity: { duration: 0.15 },
      }}
      style={SVG_ORIGIN}
    >
      <motion.g
        key={bump ?? "still"}
        animate={bump !== null && !reduced ? { x: [0, -12, 10, -7, 4, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <motion.g
          style={SVG_ORIGIN}
          animate={pressed ? { y: -10, scale: 0.9 } : reduced ? { y: 0, scale: 1 } : { y: [0, -6, 0], scale: 1 }}
          transition={
            pressed || reduced
              ? spring.snappy
              : { y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, scale: spring.snappy }
          }
        >
          {/* Soft glow under the ghost in its colour */}
          <circle r={DISC_R + 10} fill={SEAT_COLORS[seat].glow} opacity={mine ? 0.22 : 0.12} filter={`url(#${ids.glow})`} />
          <g opacity={mine ? 1 : 0.72}>
            <DiscShape seat={seat} ids={ids} />
          </g>
        </motion.g>
      </motion.g>
    </motion.g>
  );
}

/* ------------------------------------------------------------------------ */
/* Win overlay                                                              */
/* ------------------------------------------------------------------------ */

function WinOverlay({ lines, seat, ids, reduced }: { lines: readonly (readonly Coord[])[]; seat: Seat; ids: BoardIds; reduced: boolean }) {
  const cells = lines.flat();
  return (
    <g pointerEvents="none">
      {cells.map((cell, i) => (
        <g key={`${cell.col}:${cell.row}`} transform={`translate(${colX(cell.col)} ${rowY(cell.row)})`}>
          <motion.g
            style={SVG_ORIGIN}
            initial={{ scale: 1 }}
            animate={reduced ? { scale: 1.06 } : { scale: [1, 1.16, 1.06] }}
            transition={
              reduced
                ? { duration: 0.2 }
                : { duration: 1.1, delay: 0.08 * i, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }
            }
          >
            <circle r={DISC_R + 8} fill={SEAT_COLORS[seat].glow} opacity={0.55} filter={`url(#${ids.glow})`} />
            <DiscShape seat={seat} ids={ids} />
            <circle r={DISC_R + 2} fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={4} />
          </motion.g>
        </g>
      ))}
      {lines.map((line, i) => {
        const a = line[0] as Coord;
        const b = line[line.length - 1] as Coord;
        const x1 = colX(a.col);
        const y1 = rowY(a.row);
        const x2 = colX(b.col);
        const y2 = rowY(b.row);
        // Overshoot the end discs a little so the line reads as a stroke through them.
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ex = ((x2 - x1) / len) * 34;
        const ey = ((y2 - y1) / len) * 34;
        const d = `M ${x1 - ex} ${y1 - ey} L ${x2 + ex} ${y2 + ey}`;
        const draw = { duration: reduced ? 0 : 0.55, delay: reduced ? 0 : 0.25 + i * 0.15, ease: [0.16, 1, 0.3, 1] as const };
        return (
          <g key={i}>
            <motion.path d={d} stroke="#35e0ff" strokeWidth={34} strokeLinecap="round" fill="none" opacity={0.95} filter={`url(#${ids.glow})`} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />
            <motion.path d={d} stroke="#9ff0ff" strokeWidth={16} strokeLinecap="round" fill="none" opacity={0.7} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />
            <motion.path d={d} stroke="#fff" strokeWidth={8} strokeLinecap="round" fill="none" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />
          </g>
        );
      })}
    </g>
  );
}
