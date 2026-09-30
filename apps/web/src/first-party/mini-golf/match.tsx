"use client";

/**
 * A round in progress: owns the runtime and the 3D scene, runs the frame
 * loop, turns touches into putts (drag back from the ball like a slingshot;
 * drag anywhere else to look around; hold still to see the whole hole),
 * draws the power ring, and lays the HUD on top.
 */

import { lockGestures } from "@xapps/sdk";
import { useMatchResult, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { play } from "@/lib/sfx";
import { BALL_R } from "./compile";
import { CalloutLayer, FinalCard, Hint, HoleIntro, PlayerStrip, ScorecardSheet, TopBar } from "./hud";
import { GolfRuntime } from "./runtime";
import { GolfScene, detectQuality } from "./scene";

type Drag =
  | { kind: "aim"; id: number; sx: number; sy: number; x: number; y: number }
  | { kind: "pan"; id: number; sx: number; sy: number; x: number; y: number; moved: boolean; timer: ReturnType<typeof setTimeout> | null; held: boolean };

const LONG_PRESS_MS = 380;

export function MatchView() {
  const xapps = useXApps();
  const reduced = useReducedMotion() ?? false;
  const result = useMatchResult();
  const [rt] = useState(() => new GolfRuntime(xapps, reduced));
  const hud = useSyncExternalStore(rt.subscribe, rt.getSnapshot, rt.getSnapshot);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<GolfScene | null>(null);
  const tagRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<Drag | null>(null);
  const keyAimRef = useRef(false);
  const [aiming, setAiming] = useState(false);
  const [power, setPower] = useState(0);
  const [shotsTaken, setShotsTaken] = useState(0);
  const [webglError, setWebglError] = useState(false);
  /** Hole on which the camera was dragged away from the ball (shows "Back to ball"). */
  const [pannedHole, setPannedHole] = useState(-1);

  useRoomEvent("b", (payload, from) => rt.onRemoteBall(payload, from));
  useRoomEvent("c", (payload, from) => rt.onRemoteCard(payload, from));

  useEffect(() => {
    if (result) rt.onResult(result);
  }, [result, rt]);

  // Scene + frame loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let scene: GolfScene;
    try {
      scene = new GolfScene(canvas, rt, reduced, detectQuality());
    } catch (error) {
      console.error("[mini-golf] WebGL unavailable", error);
      queueMicrotask(() => setWebglError(true));
      return;
    }
    sceneRef.current = scene;
    rt.attach();
    const overlay = overlayRef.current;
    const resize = () => {
      const r = stage.getBoundingClientRect();
      scene.resize(r.width, r.height);
      if (overlay) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        overlay.width = Math.round(r.width * dpr);
        overlay.height = Math.round(r.height * dpr);
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    void rt.start();
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      scene.frame(dt);
      drawOverlay(scene, rt, overlay, dragRef.current);
      for (const tag of scene.ghostTags()) {
        const el = tagRefs.current.get(tag.id);
        if (!el) continue;
        el.style.opacity = tag.visible ? "1" : "0";
        if (tag.visible) el.style.transform = `translate(${tag.x}px, ${tag.y}px) translate(-50%, -100%)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scene.dispose();
      sceneRef.current = null;
      rt.detach();
    };
  }, [rt, reduced]);

  // Touches on the course never scroll, zoom or pull-to-refresh the page.
  useEffect(() => lockGestures(stageRef.current), []);

  /* Input ------------------------------------------------------------ */

  const aimFromDrag = (d: Extract<Drag, { kind: "aim" }>) => {
    const scene = sceneRef.current;
    if (!scene) return;
    const pull = Math.hypot(d.x - d.sx, d.y - d.sy);
    const rect = stageRef.current?.getBoundingClientRect();
    const maxPull = Math.max(120, Math.min(260, Math.min(rect?.width ?? 400, rect?.height ?? 400) * 0.42));
    const p = pull < 12 ? 0 : Math.min(1, (pull - 12) / maxPull);
    const h = rt.sim.z + BALL_R;
    const a = scene.screenToGround(d.sx, d.sy, h);
    const b = scene.screenToGround(d.x, d.y, h);
    if (!a || !b || (a.x === b.x && a.y === b.y)) {
      rt.setAim(rt.aim.angle, 0);
      setPower(0);
      return;
    }
    rt.setAim(Math.atan2(a.y - b.y, a.x - b.x), p);
    setPower(p);
  };

  const local = (e: ReactPointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    rt.audio.resume();
    if (rt.phase === "intro") {
      rt.skipIntro();
      return;
    }
    const scene = sceneRef.current;
    if (!scene) return;
    const { x, y } = local(e);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured
    }
    const ball = scene.myBallScreen();
    const near = ball && Math.hypot(ball.x - x, ball.y - y) < Math.max(70, ball.r * 6);
    if (rt.canAim() && near && !rt.overview) {
      dragRef.current = { kind: "aim", id: e.pointerId, sx: x, sy: y, x, y };
      keyAimRef.current = false;
      setAiming(true);
      setPower(0);
      rt.setAim(rt.aim.angle, 0);
      return;
    }
    const drag: Drag = { kind: "pan", id: e.pointerId, sx: x, sy: y, x, y, moved: false, timer: null, held: false };
    drag.timer = setTimeout(() => {
      if (dragRef.current === drag && !drag.moved) {
        drag.held = true;
        rt.setOverview(true);
        play("tick");
      }
    }, LONG_PRESS_MS);
    dragRef.current = drag;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const { x, y } = local(e);
    if (d.kind === "aim") {
      d.x = x;
      d.y = y;
      aimFromDrag(d);
      return;
    }
    const dx = x - d.x;
    const dy = y - d.y;
    d.x = x;
    d.y = y;
    if (!d.moved && Math.hypot(x - d.sx, y - d.sy) > 8) {
      d.moved = true;
      if (d.timer) clearTimeout(d.timer);
    }
    if (d.moved && !d.held) sceneRef.current?.pan(dx, dy);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (d.kind === "aim") {
      setAiming(false);
      setPower(0);
      if (!cancelled && rt.shoot()) {
        sceneRef.current?.resetPan();
        setPannedHole(-1);
        setShotsTaken((n) => n + 1);
      } else rt.cancelAim();
      return;
    }
    if (d.timer) clearTimeout(d.timer);
    if (d.held) rt.setOverview(false);
    if (d.moved && sceneRef.current?.panned) setPannedHole(rt.holeIndex);
  };

  // Keyboard: ←/→ aim, ↑/↓ power, Space/Enter putt, O overview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("button")) {
        if (e.key === " " || e.key === "Enter") return;
      }
      if (rt.phase === "intro" && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        rt.skipIntro();
        return;
      }
      if (e.key === "o" || e.key === "O") {
        rt.setOverview(!rt.overview);
        return;
      }
      if (!rt.canAim()) return;
      const fine = e.shiftKey ? 0.25 : 1;
      let { angle, power: p } = rt.aim;
      if (!keyAimRef.current) p = Math.max(p, 0.3);
      switch (e.key) {
        case "ArrowLeft":
          angle += (1.5 * fine * Math.PI) / 180;
          break;
        case "ArrowRight":
          angle -= (1.5 * fine * Math.PI) / 180;
          break;
        case "ArrowUp":
          p = Math.min(1, p + 0.02 * fine);
          break;
        case "ArrowDown":
          p = Math.max(0.03, p - 0.02 * fine);
          break;
        case " ":
        case "Enter":
          if (!keyAimRef.current) return;
          e.preventDefault();
          keyAimRef.current = false;
          setAiming(false);
          if (rt.shoot()) setShotsTaken((n) => n + 1);
          return;
        default:
          return;
      }
      e.preventDefault();
      rt.audio.resume();
      keyAimRef.current = true;
      rt.setAim(angle, p);
      setAiming(true);
      setPower(p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rt]);

  // A shot that starts rolling (or a knock) ends keyboard aiming.
  useEffect(() => {
    if (hud.phase !== "aim") {
      keyAimRef.current = false;
      if (!dragRef.current) queueMicrotask(() => setAiming(false));
    }
  }, [hud.phase]);

  if (webglError) {
    return (
      <div className="m-auto max-w-xs p-6 text-center text-sm text-ink-300">
        <p className="text-3xl">⛳</p>
        <p className="mt-3 font-semibold text-ink-50">This device can&apos;t draw the course</p>
        <p className="mt-1">Mini Golf needs WebGL. Try another browser or device.</p>
      </div>
    );
  }

  const others = hud.seats.filter((s) => !s.isMe);

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#bfe3ff]">
      <div
        ref={stageRef}
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e, false)}
        onPointerCancel={(e) => endDrag(e, true)}
        onLostPointerCapture={(e) => endDrag(e, true)}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Mini golf course. Drag back from your ball to putt; drag elsewhere to look around."
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full" />
        {others.map((s) => (
          <div
            key={s.id}
            ref={(el) => {
              if (el) tagRefs.current.set(s.id, el);
              else tagRefs.current.delete(s.id);
            }}
            className="pointer-events-none absolute left-0 top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold text-ink-950 opacity-0 shadow-md"
            style={{ background: s.color === "#ffffff" ? "#f1f1f1" : s.color }}
          >
            {s.name}
          </div>
        ))}
      </div>

      <TopBar hud={hud} onOverview={() => rt.setOverview(!rt.overview)} />
      {pannedHole === hud.hole && !hud.overview && (hud.phase === "aim" || hud.phase === "roll") && (
        <button
          type="button"
          onClick={() => {
            sceneRef.current?.resetPan();
            setPannedHole(-1);
            play("pop");
          }}
          className="absolute bottom-[max(64px,calc(env(safe-area-inset-bottom)+60px))] right-3 z-20 flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[13px] font-bold text-ink-950 shadow-lg"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
          Back to ball
        </button>
      )}
      <PlayerStrip hud={hud} />
      <HoleIntro hud={hud} reduced={reduced} />
      <CalloutLayer hud={hud} reduced={reduced} />
      <Hint hud={hud} aiming={aiming} power={power} firstShot={shotsTaken === 0} />
      <ScorecardSheet
        hud={hud}
        reduced={reduced}
        onNext={() => {
          play("pop");
          rt.nextHole();
        }}
      />
      <FinalCard hud={hud} onRetry={() => rt.submitNow()} />
      <p className="sr-only" aria-live="polite">
        {hud.callout ? `${hud.callout.label}. ${hud.callout.strokes} strokes.` : hud.phase === "aim" ? `Hole ${hud.hole + 1}, stroke ${hud.strokes + 1}.` : ""}
      </p>
    </div>
  );
}

/** The slingshot band and the power ring, in screen space. */
function drawOverlay(scene: GolfScene, rt: GolfRuntime, canvas: HTMLCanvasElement | null, drag: Drag | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!rt.aim.active || !rt.canAim()) return;
  const ball = scene.myBallScreen();
  if (!ball) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = rt.aim.power;
  const radius = Math.max(30, ball.r * 3.4);
  // Band from the ball back toward the finger.
  if (drag?.kind === "aim") {
    const dx = drag.x - drag.sx;
    const dy = drag.y - drag.sy;
    const len = Math.hypot(dx, dy);
    if (len > 12) {
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.moveTo(ball.x, ball.y);
      ctx.lineTo(ball.x + dx, ball.y + dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.beginPath();
      ctx.arc(ball.x + dx, ball.y + dy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Power ring: track, then the filled arc from green through gold to red.
  const start = -Math.PI / 2;
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  if (p > 0.005) {
    const hue = 120 - p * 120;
    ctx.strokeStyle = `hsl(${hue} 95% 58%)`;
    ctx.shadowColor = `hsl(${hue} 95% 58%)`;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, radius, start, start + p * Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.font = "800 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.lineWidth = 3;
  const label = `${Math.round(p * 100)}%`;
  ctx.strokeText(label, ball.x, ball.y - radius - 8);
  ctx.fillText(label, ball.x, ball.y - radius - 8);
}
