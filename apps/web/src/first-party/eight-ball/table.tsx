"use client";

import { lockGestures } from "@xapps/sdk";
import { useEffect, useRef, type MutableRefObject } from "react";
import type { PoolAudio } from "./audio";
import {
  BALLS,
  HEAD_X,
  POCKETS,
  R,
  TABLE_L,
  TABLE_W,
  nearestPocket,
  predictAim,
  trackAt,
  trackEnd,
  type Balls,
  type EventKind,
  type Recording,
  type Vec,
} from "./physics";
import {
  BallPainter,
  angleToScreen,
  arrowHead,
  dirToScreen,
  drawCue,
  line,
  makeView,
  paintTable,
  restingOrientation,
  ring,
  roll,
  toScreen,
  toTable,
  type Orientation,
  type View,
} from "./render";
import type { BallInHand } from "./rules";

/** What the shooter is doing right now. Mutated at pointer rate; the table reads it every frame. */
export interface Controls {
  angle: number;
  /** Pull-back of the power control, 0..1. */
  power: number;
  spin: Vec;
  /** Cue ball position while placing it (ball in hand). */
  cue: Vec | null;
  cueOk: boolean;
  call: number | null;
}

export interface Playback {
  key: string;
  rec: Recording;
  /** Show the cue drawing back before the strike (replays, the opponent's shot). */
  windup: boolean;
  strike: { angle: number; power: number } | null;
}

export interface OtherAim {
  angle: number;
  power: number;
  cue: Vec | null;
  call: number | null;
}

export interface TableProps {
  balls: Balls;
  playback: Playback | null;
  onPlaybackDone: (key: string) => void;
  ctl: MutableRefObject<Controls>;
  /** My turn and the table is still: aim, place, call. */
  interactive: boolean;
  placing: BallInHand | null;
  legal: readonly number[];
  needsCall: boolean;
  /** The opponent's (or bot's) cue, when it's their turn. */
  other: OtherAim | null;
  audio: PoolAudio;
  reduced: boolean;
  portrait: boolean;
  width: number;
  height: number;
  onAimChange?: () => void;
  onCall?: (pocket: number) => void;
  onCueDrop?: (p: Vec, ok: boolean) => void;
  onEvent?: (kind: EventKind, value: number) => void;
}

const STRIKE_MS = 90;
const WINDUP_MS = 420;
const DROP_MS = 260;
const TAIL_MS = 350;

interface Run {
  key: string;
  startedAt: number;
  /** Playback clock (recording ms). */
  t: number;
  lastFrame: number;
  eventIndex: number;
  drops: Map<number, { pocket: number; at: number }>;
  eight: { at: number; pocket: number } | null;
  done: boolean;
  windup: boolean;
  strike: { angle: number; power: number } | null;
}

export function PoolTable(props: TableProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // Touches on the table never scroll or bounce the page.
  useEffect(() => lockGestures(canvasRef.current), []);

  const { width, height, portrait } = props;
  const dragging = useRef<"cue" | "aim" | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; t: number; startAngle: number; startPointer: number; moved: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width < 20 || height < 20) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const view = makeView(width, height, portrait, dpr);

    const bg = document.createElement("canvas");
    bg.width = canvas.width;
    bg.height = canvas.height;
    const bgc = bg.getContext("2d");
    if (bgc) {
      bgc.scale(dpr, dpr);
      paintTable(bgc, view);
    }
    const painter = new BallPainter();
    const orient: Orientation[] = Array.from({ length: BALLS }, (_, i) => restingOrientation(i));
    const shown: (Vec | null)[] = new Array(BALLS).fill(null);
    let run: Run | null = null;
    let otherAngle: number | null = null;
    let otherPower = 0;
    let otherCue: Vec | null = null;
    let raf = 0;
    let last = performance.now();

    const place = (i: number, p: Vec | null) => {
      const prev = shown[i];
      if (p && prev) roll(orient[i] as Orientation, p.x - prev.x, p.y - prev.y);
      shown[i] = p ? { x: p.x, y: p.y } : null;
    };

    const startRun = (pb: Playback, now: number) => {
      const drops = new Map<number, { pocket: number; at: number }>();
      for (const [t, kind, a, b] of pb.rec.events) if (kind === "p") drops.set(a, { pocket: b, at: t });
      // Balls whose track ends early without a pocket event but that aren't on the table afterwards.
      const final = propsRef.current.balls;
      pb.rec.tracks.forEach((tr, i) => {
        if (tr.length >= 3 && !final[i] && !drops.has(i)) {
          const end = trackAt(tr, trackEnd(tr));
          drops.set(i, { pocket: end ? nearestPocket(end).id : 0, at: trackEnd(tr) });
        }
      });
      const e8 = drops.get(8);
      run = {
        key: pb.key,
        startedAt: now,
        t: 0,
        lastFrame: now,
        eventIndex: 0,
        drops,
        eight: e8 ? { at: e8.at, pocket: e8.pocket } : null,
        done: false,
        windup: pb.windup,
        strike: pb.strike,
      };
      // Balls jump to where the recording starts (e.g. a cue ball placed with ball in hand).
      pb.rec.tracks.forEach((tr, i) => {
        if (tr.length >= 3) shown[i] = trackAt(tr, 0);
        else shown[i] = null;
      });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = propsRef.current;
      const dt = Math.min(64, now - last);
      last = now;
      const ctl = p.ctl.current;

      /* ---- advance playback ---- */
      if (p.playback && (!run || run.key !== p.playback.key)) startRun(p.playback, now);
      if (!p.playback && run) run = null;
      let zoom: { z: number; at: Vec } | null = null;
      let strikePull: number | null = null;
      if (run && !run.done && p.playback) {
        const rec = p.playback.rec;
        const lead = (run.windup ? WINDUP_MS : 0) + STRIKE_MS;
        const since = now - run.startedAt;
        if (since < lead) {
          // Cue: draw back (windup), then drive through.
          const power = run.strike?.power ?? 0.5;
          if (since < lead - STRIKE_MS) strikePull = power * ease(since / (lead - STRIKE_MS));
          else strikePull = power * (1 - (since - (lead - STRIKE_MS)) / STRIKE_MS);
        } else {
          if (run.t === 0 && run.eventIndex === 0) run.lastFrame = now;
          let rate = 1;
          if (run.eight && !p.reduced) {
            const before = run.eight.at - run.t;
            if (before < 700 && before > -260) {
              rate = 0.3;
              const k = Math.min(1, (700 - before) / 350);
              const pk = POCKETS[run.eight.pocket] as (typeof POCKETS)[number];
              zoom = { z: 1 + 0.55 * smooth(k), at: { x: pk.x, y: pk.y } };
            }
          }
          run.t += dt * rate;
          const t = run.t;
          rec.tracks.forEach((tr, i) => {
            if (tr.length < 3) return;
            const drop = run?.drops.get(i);
            if (drop && t > drop.at) {
              place(i, trackAt(tr, drop.at));
              return;
            }
            place(i, trackAt(tr, t));
          });
          const events = rec.events;
          while (run.eventIndex < events.length && (events[run.eventIndex]?.[0] ?? Infinity) <= t) {
            const [, kind, , value] = events[run.eventIndex] as [number, EventKind, number, number];
            run.eventIndex++;
            if (kind === "b") p.audio.click(value / 100);
            else if (kind === "c") p.audio.rail(value / 100);
            else if (kind === "p") p.audio.pocket();
            else if (kind === "s") p.audio.cue(value / 100);
            p.onEvent?.(kind, value);
          }
          if (t > rec.ms + TAIL_MS) {
            run.done = true;
            p.onPlaybackDone(run.key);
          }
        }
      }
      if (!run || run.done) {
        for (let i = 0; i < BALLS; i++) place(i, p.balls[i] ?? null);
      }

      /* ---- draw ---- */
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (zoom) {
        const f = toScreen(view, zoom.at);
        ctx.translate(f.x, f.y);
        ctx.scale(zoom.z, zoom.z);
        ctx.translate(-f.x, -f.y);
      }
      ctx.drawImage(bg, 0, 0, width, height);

      const s = view.s;
      const rpx = R * s;
      const idle = !run || run.done;
      const mine = p.interactive && idle;

      // Where the cue ball is (placing, the opponent placing, or on the table).
      let cuePos: Vec | null = shown[0] ?? null;
      if (mine && p.placing && ctl.cue) cuePos = ctl.cue;
      if (!mine && idle && p.other?.cue) {
        otherCue = otherCue ? lerpVec(otherCue, p.other.cue, 1 - Math.exp(-dt / 70)) : { ...p.other.cue };
        cuePos = otherCue;
      } else if (!p.other?.cue) {
        otherCue = null;
      }

      // Kitchen while placing behind the head string.
      if (mine && p.placing === "kitchen") {
        const a = toScreen(view, { x: 0, y: 0 });
        const b = toScreen(view, { x: HEAD_X, y: TABLE_W });
        ctx.fillStyle = "rgb(255 255 255 / 0.06)";
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        const h0 = toScreen(view, { x: HEAD_X, y: 0 });
        const h1 = toScreen(view, { x: HEAD_X, y: TABLE_W });
        line(ctx, h0, h1, "rgb(255 255 255 / 0.45)", 1.5, [6, 6]);
      }

      // Shadows.
      for (let i = 0; i < BALLS; i++) {
        const b = i === 0 ? cuePos : shown[i];
        if (!b) continue;
        const q = toScreen(view, b);
        const drop = run?.drops.get(i);
        const k = drop && run && run.t > drop.at ? Math.min(1, (run.t - drop.at) / DROP_MS) : 0;
        painter.drawShadow(ctx, q.x, q.y, rpx, 1 - k);
      }

      // Aim guides (mine), or a faint line for the opponent.
      const balls = shown.slice();
      balls[0] = cuePos;
      const call = mine ? ctl.call : (p.other?.call ?? null);
      if (mine && cuePos && ctl.cueOk !== false) {
        drawGuides(ctx, view, balls, cuePos, ctl.angle, ctl.spin.y, Math.max(0.15, ctl.power || 0.45), p.legal, true);
      } else if (!mine && idle && cuePos && p.other) {
        otherAngle = otherAngle === null ? p.other.angle : lerpAngle(otherAngle, p.other.angle, 1 - Math.exp(-dt / 60));
        otherPower += (p.other.power - otherPower) * (1 - Math.exp(-dt / 60));
        drawGuides(ctx, view, balls, cuePos, otherAngle, 0, 0.5, p.legal, false);
      }
      if (!p.other) otherAngle = null;

      // Pockets that can be (or were) called for the 8.
      if (p.needsCall && idle) {
        const pulse = p.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / 260);
        for (const pk of POCKETS) {
          const q = toScreen(view, { x: pk.x, y: pk.y });
          const called = call === pk.id;
          if (called) {
            ring(ctx, q, 0.07 * s + 3, "rgb(255 214 90 / 0.95)", 2.5, "rgb(255 214 90 / 0.18)");
            ctx.save();
            ctx.fillStyle = "#0b0b0b";
            ctx.strokeStyle = "rgb(255 214 90 / 0.95)";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(q.x, q.y, Math.max(7, rpx * 0.9), 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "#fff";
            ctx.font = `800 ${Math.max(9, rpx)}px ui-sans-serif, system-ui, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("8", q.x, q.y + 0.5);
            ctx.restore();
          } else if (mine) {
            ring(ctx, q, 0.07 * s + 2 + pulse * 2, `rgb(255 255 255 / ${0.25 + pulse * 0.25})`, 1.5);
          }
        }
      }

      // Balls.
      for (let i = BALLS - 1; i >= 0; i--) {
        const b = i === 0 ? cuePos : shown[i];
        if (!b) continue;
        let q = toScreen(view, b);
        let r = rpx;
        let dim = 0;
        let alpha = 1;
        const drop = run?.drops.get(i);
        if (drop && run && run.t > drop.at) {
          const k = Math.min(1, (run.t - drop.at) / DROP_MS);
          if (k >= 1) continue;
          const pk = POCKETS[drop.pocket] ?? nearestPocket(b);
          const c = toScreen(view, { x: pk.x, y: pk.y });
          q = { x: q.x + (c.x - q.x) * ease(k), y: q.y + (c.y - q.y) * ease(k) };
          r = rpx * (1 - 0.35 * k);
          dim = 0.75 * k;
          alpha = 1 - k * k;
        }
        const placingBad = i === 0 && mine && p.placing && !ctl.cueOk;
        painter.draw(ctx, view, i, q.x, q.y, r, orient[i] as Orientation, { dim, alpha: placingBad ? 0.6 * alpha : alpha });
      }

      // Ball in hand: a ring and move arrows around the cue ball.
      if (mine && p.placing && cuePos) {
        const q = toScreen(view, cuePos);
        const bad = !ctl.cueOk;
        const pulse = p.reduced ? 0 : Math.sin(now / 220) * 1.5;
        ring(ctx, q, rpx + 5 + pulse, bad ? "rgb(255 90 90 / 0.95)" : "rgb(255 255 255 / 0.85)", 2);
        const off = rpx + 11 + pulse;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          arrowHead(ctx, { x: q.x + dx * off, y: q.y + dy * off }, { x: dx, y: dy }, 4.5, bad ? "rgb(255 90 90 / 0.9)" : "rgb(255 255 255 / 0.8)");
        }
      }

      // The cue.
      if (cuePos) {
        const q = toScreen(view, cuePos);
        if (run && !run.done && strikePull !== null && run.strike) {
          drawCue(ctx, view, q.x, q.y, angleToScreen(view, run.strike.angle), strikePull * 0.26 * s);
        } else if (mine && !(p.placing && dragging.current === "cue")) {
          const bob = p.reduced || ctl.power > 0 ? 0 : (Math.sin(now / 420) + 1) * 1.5;
          drawCue(ctx, view, q.x, q.y, angleToScreen(view, ctl.angle), ctl.power * 0.26 * s + bob);
        } else if (!mine && idle && p.other && otherAngle !== null) {
          drawCue(ctx, view, q.x, q.y, angleToScreen(view, otherAngle), otherPower * 0.26 * s, 0.92);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [width, height, portrait]);

  /* ------------------------------ input ------------------------------ */

  const viewOf = (): View | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return makeView(props.width, props.height, props.portrait, 1);
  };
  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const cueNow = (): Vec | null => {
    const p = propsRef.current;
    return p.placing && p.ctl.current.cue ? p.ctl.current.cue : (p.balls[0] ?? null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = propsRef.current;
    if (!p.interactive || p.playback || drag.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const view = viewOf();
    if (!view) return;
    const sp = pointOf(e);
    const tp = toTable(view, sp.x, sp.y);
    const ctl = p.ctl.current;
    p.audio.resume();

    // Call a pocket for the 8.
    if (p.needsCall) {
      for (const pk of POCKETS) {
        const q = toScreen(view, { x: pk.x, y: pk.y });
        if (Math.hypot(q.x - sp.x, q.y - sp.y) < Math.max(26, 0.09 * view.s)) {
          p.onCall?.(pk.id);
          return;
        }
      }
    }
    const cue = cueNow();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured
    }
    // Pick up the cue ball with ball in hand.
    if (p.placing && cue) {
      const q = toScreen(view, cue);
      if (Math.hypot(q.x - sp.x, q.y - sp.y) < Math.max(26, R * view.s * 2.4)) {
        dragging.current = "cue";
        drag.current = { id: e.pointerId, x: sp.x, y: sp.y, t: e.timeStamp, startAngle: ctl.angle, startPointer: 0, moved: false };
        return;
      }
    }
    if (!cue) return;
    dragging.current = "aim";
    drag.current = {
      id: e.pointerId,
      x: sp.x,
      y: sp.y,
      t: e.timeStamp,
      startAngle: ctl.angle,
      startPointer: Math.atan2(tp.y - cue.y, tp.x - cue.x),
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const p = propsRef.current;
    const view = viewOf();
    if (!view) return;
    const sp = pointOf(e);
    if (Math.hypot(sp.x - d.x, sp.y - d.y) > 6) d.moved = true;
    const tp = toTable(view, sp.x, sp.y);
    const ctl = p.ctl.current;
    if (dragging.current === "cue") {
      const clamped = {
        x: Math.min(p.placing === "kitchen" ? HEAD_X : TABLE_L - R, Math.max(R, tp.x)),
        y: Math.min(TABLE_W - R, Math.max(R, tp.y)),
      };
      ctl.cue = clamped;
      p.onCueDrop?.(clamped, false);
      return;
    }
    const cue = cueNow();
    if (!cue || !d.moved) return;
    // Relative aiming: the cue turns as far as the finger sweeps around the cue ball,
    // slower when the finger is close to it (fine control without covering the target).
    const now = Math.atan2(tp.y - cue.y, tp.x - cue.x);
    const dist = Math.hypot(tp.x - cue.x, tp.y - cue.y);
    let delta = now - d.startPointer;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const k = Math.min(1, Math.max(0.3, dist / 0.35));
    ctl.angle = d.startAngle + delta * k;
    d.startAngle = ctl.angle;
    d.startPointer = now;
    p.onAimChange?.();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const mode = dragging.current;
    dragging.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released
    }
    const p = propsRef.current;
    const ctl = p.ctl.current;
    if (mode === "cue") {
      if (ctl.cue) p.onCueDrop?.(ctl.cue, true);
      return;
    }
    if (d.moved || e.type === "pointercancel") return;
    // A tap aims straight at the spot, or at the centre of a tapped ball.
    const view = viewOf();
    const cue = cueNow();
    if (!view || !cue) return;
    const sp = pointOf(e);
    let target = toTable(view, sp.x, sp.y);
    for (let i = 1; i < BALLS; i++) {
      const b = p.balls[i];
      if (b && Math.hypot(b.x - target.x, b.y - target.y) < R * 1.4) {
        target = b;
        break;
      }
    }
    if (Math.hypot(target.x - cue.x, target.y - cue.y) < R) return;
    ctl.angle = Math.atan2(target.y - cue.y, target.x - cue.x);
    p.onAimChange?.();
  };

  return (
    <canvas
      ref={canvasRef}
      className="block touch-none select-none"
      style={{ width, height, cursor: props.interactive ? "crosshair" : "default" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="Pool table"
      role="img"
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Guides                                                                   */
/* ------------------------------------------------------------------------ */

function drawGuides(
  ctx: CanvasRenderingContext2D,
  view: View,
  balls: Balls,
  cue: Vec,
  angle: number,
  follow: number,
  power: number,
  legal: readonly number[],
  full: boolean,
) {
  const hit = predictAim(balls, cue, angle, follow, power);
  const s = view.s;
  const rpx = R * s;
  const from = toScreen(view, cue);
  const dir = { x: Math.cos(angle), y: Math.sin(angle) };
  const alpha = full ? 1 : 0.45;
  const reach = hit ? hit.dist : 3;
  const endT = { x: cue.x + dir.x * reach, y: cue.y + dir.y * reach };
  const end = toScreen(view, endT);
  const sd = dirToScreen(view, dir);
  const start = { x: from.x + sd.x * rpx, y: from.y + sd.y * rpx };
  line(ctx, start, end, `rgb(255 255 255 / ${0.18 * alpha})`, 5);
  line(ctx, start, end, `rgb(255 255 255 / ${0.85 * alpha})`, 1.4);
  if (!hit || !full) {
    if (hit?.kind === "ball") ring(ctx, toScreen(view, hit.ghost), rpx, `rgb(255 255 255 / ${0.5 * alpha})`, 1.2);
    return;
  }

  if (hit.kind === "ball") {
    const ok = legal.includes(hit.id);
    const ghost = toScreen(view, hit.ghost);
    const color = ok ? "255 255 255" : "255 95 95";
    ring(ctx, ghost, rpx, `rgb(${color} / 0.95)`, 1.6, `rgb(${color} / 0.12)`);
    if (!ok) {
      // A cross: hitting this ball first is a foul.
      const k = rpx * 0.55;
      line(ctx, { x: ghost.x - k, y: ghost.y - k }, { x: ghost.x + k, y: ghost.y + k }, `rgb(${color} / 0.95)`, 2);
      line(ctx, { x: ghost.x - k, y: ghost.y + k }, { x: ghost.x + k, y: ghost.y - k }, `rgb(${color} / 0.95)`, 2);
      return;
    }
    // Object ball: along the line of centres; longer for fuller hits.
    const obj = balls[hit.id] as Vec;
    const objLen = 0.1 + 0.42 * Math.cos(hit.cut);
    const oFrom = toScreen(view, obj);
    const od = dirToScreen(view, hit.objectDir);
    const oStart = { x: oFrom.x + od.x * rpx, y: oFrom.y + od.y * rpx };
    const oEnd = { x: oFrom.x + od.x * objLen * s, y: oFrom.y + od.y * objLen * s };
    line(ctx, oStart, oEnd, "rgb(255 255 255 / 0.8)", 1.6);
    arrowHead(ctx, oEnd, od, 5, "rgb(255 255 255 / 0.85)");
    // Cue ball: tangent line, bent by follow / draw.
    const cm = Math.hypot(hit.cueDir.x, hit.cueDir.y);
    if (cm > 0.01) {
      const cueLen = 0.06 + 0.3 * Math.max(Math.sin(hit.cut), Math.abs(follow) * 0.6);
      const cd = dirToScreen(view, hit.cueDir);
      const cEnd = { x: ghost.x + cd.x * cueLen * s, y: ghost.y + cd.y * cueLen * s };
      line(ctx, ghost, cEnd, "rgb(190 225 255 / 0.7)", 1.4, [4, 4]);
    }
  } else if (hit.kind === "rail") {
    const at = toScreen(view, hit.at);
    ring(ctx, at, rpx, "rgb(255 255 255 / 0.55)", 1.2);
    const bd = dirToScreen(view, hit.bounce);
    const bEnd = { x: at.x + bd.x * 0.22 * s, y: at.y + bd.y * 0.22 * s };
    line(ctx, at, bEnd, "rgb(255 255 255 / 0.4)", 1.2, [3, 5]);
  } else {
    const at = toScreen(view, hit.at);
    ring(ctx, at, rpx * 0.6, "rgb(255 120 120 / 0.8)", 1.4);
  }
}

/* ------------------------------------------------------------------------ */

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const smooth = (t: number) => t * t * (3 - 2 * t);

function lerpAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

function lerpVec(a: Vec, b: Vec, k: number): Vec {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
