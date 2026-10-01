"use client";

/**
 * The 3D table and everything you do with your hands: flick to throw (mouse,
 * touch or pen), tap a cup to take a bonus pick, or use the keyboard (←/→ to
 * aim, hold Space to charge, release to throw). Also the playback loop that
 * animates each action in the log before the game moves on.
 */

import { useGestureLock } from "@xapps/sdk/react";
import { motion, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import type { TableAudio } from "./audio";
import { FORMATION_LABEL, other, type Seat } from "./geometry";
import { F_TIMEOUT, actorOf, applyAction, type Action, type GameState } from "./logic";
import { EV_OUT, EV_RIM, EV_SINK, EV_TABLE, EV_WALL, decodeEvents, decodePath, previewArc, throwFromFlick, type ThrowInput } from "./physics";
import { PongScene, type SceneEvent } from "./scene";
import type { CupPong } from "./use-game";

export interface Banner {
  key: number;
  title: string;
  sub?: string;
  tone: "turn" | "good" | "fire" | "bad" | "win" | "info";
}

const noop = () => {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Flick speed is measured over the last part of the swipe. */
const RELEASE_WINDOW_MS = 90;
/** Swipes shorter than this (fraction of the height) are cancelled. */
const MIN_SWIPE = 0.06;
/** Sideways drag (share of the table's width) that aims fully left/right: the rack spans ~45% of it. */
const LEAN_SPAN = 0.45;
const KEY_CHARGE_MS = 1_300;

interface Sample {
  t: number;
  x: number;
  y: number;
}

function flickOf(samples: readonly Sample[], height: number): ThrowInput | null {
  const end = samples[samples.length - 1];
  if (!end || samples.length < 2) return null;
  let i0 = samples.length - 1;
  while (i0 > 0 && end.t - samples[i0 - 1]!.t <= RELEASE_WINDOW_MS) i0--;
  // A janky frame (slow phone, busy tab) can leave only the release point in the
  // window: reach back to the last real movement instead of dropping the throw.
  while (i0 > 0 && samples[i0]!.x === end.x && samples[i0]!.y === end.y) i0--;
  const first = samples[i0]!;
  const ms = Math.max(16, end.t - first.t);
  return throwFromFlick({ dx: end.x - first.x, dy: end.y - first.y, ms, height });
}

/** Sound and haptics for what the ball hits. */
function soundFor(e: SceneEvent, g: CupPong, audio: TableAudio) {
  const mine = e.thrower === g.mySeat;
  switch (e.kind) {
    case EV_TABLE:
      audio.pong(e.speed);
      break;
    case EV_RIM:
      audio.rim(e.speed);
      if (mine) g.xapps.ui.haptic("light").catch(noop);
      break;
    case EV_WALL:
      audio.wall(e.speed);
      break;
    case EV_SINK:
      audio.splash();
      audio.crowd("cheer");
      g.xapps.ui.haptic(mine ? "success" : "medium").catch(noop);
      break;
    case EV_OUT:
      break;
  }
}

export function Stage({
  g,
  audio,
  onBanner,
  power,
  className,
}: {
  g: CupPong;
  audio: TableAudio;
  onBanner: (banner: Omit<Banner, "key">) => void;
  /** Live power gauge (0…1.25), for the HUD. */
  power: MotionValue<number>;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<PongScene | null>(null);
  const [failed, setFailed] = useState(false);
  useGestureLock(boxRef);

  const { shownGame, mySeat, seats, xapps } = g;
  const seatOf = useCallback((id: string): Seat => (id === seats[1] ? 1 : 0), [seats]);

  // Latest props for handlers and the playback loop.
  const live = useRef({ g, onBanner, audio });
  useEffect(() => {
    live.current = { g, onBanner, audio };
  });
  /** Rim contacts during the current flight (for the crowd's "ooh"). */
  const flightRims = useRef(0);

  /* ------------------------------ scene ------------------------------ */

  const reducedRef = useRef(reduced);
  // Each mount gets a fresh canvas: the scene frees its GL context on dispose, and a
  // context that was lost can't be reused (React remounts in dev, rematches in prod).
  const attach = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) return;
      const canvas = document.createElement("canvas");
      canvas.className = "absolute inset-0 block size-full";
      host.appendChild(canvas);
      let s: PongScene;
      try {
        s = new PongScene(canvas, {
          reducedMotion: reducedRef.current,
          onEvent: (e) => {
            if (e.kind === EV_RIM) flightRims.current++;
            soundFor(e, live.current.g, live.current.audio);
          },
          onFps: (fps) => {
            // Couldn't hold ~45 fps: render fewer pixels.
            if (fps < 45) s.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
          },
        });
      } catch (error) {
        console.warn("[cup-pong] WebGL unavailable", error);
        canvas.remove();
        setFailed(true);
        return;
      }
      setScene(s);
      return () => {
        s.dispose();
        canvas.remove();
        setScene(null);
      };
    },
    [],
  );

  useEffect(() => {
    const box = boxRef.current;
    if (!scene || !box) return;
    const fit = () => {
      const rect = box.getBoundingClientRect();
      scene.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [scene]);

  // Cups follow the shown game (new cups pop in, re-racks slide, removed cups leave).
  const racked = useRef(false);
  useEffect(() => {
    if (!scene) return;
    scene.setRacks(shownGame.racks, racked.current);
    racked.current = true;
  }, [scene, shownGame.racks]);

  // Camera: behind whoever acts (the action being replayed, or the next one).
  const playingAction = g.shown < g.log.length ? g.log[g.shown] : undefined;
  const viewSeat: Seat = playingAction ? seatOf(playingAction.by) : actorOf(shownGame);
  const viewed = useRef(false);
  useEffect(() => {
    if (!scene) return;
    scene.setView(viewSeat, !viewed.current);
    viewed.current = true;
  }, [scene, viewSeat]);

  // Bonus pick: your target cups glow and become tappable.
  const picking = g.myPick;
  useEffect(() => {
    if (!scene) return;
    scene.setPickable(picking && mySeat !== null ? other(mySeat) : null);
  }, [scene, picking, mySeat]);

  /* ---------------------------- the hand ---------------------------- */

  const drag = useRef<{ id: number; samples: Sample[]; x0: number; y0: number } | null>(null);
  const handAim = useRef({ aim: 0, lift: 0 });
  const keyState = useRef<{ aim: number; charging: number | null }>({ aim: 0, charging: null });

  const handVisible = g.playing && g.caughtUp && !shownGame.over && shownGame.pendingPick === null;
  const opponentAim = g.opponentAim;
  const fireNow = shownGame.fire[viewSeat];
  const syncHand = useCallback(() => {
    if (!scene) return;
    const cur = live.current.g;
    const mine = cur.myThrow && mySeat !== null && viewSeat === mySeat;
    const aim = mine ? handAim.current : opponentAim ? { aim: opponentAim.aim, lift: opponentAim.lift } : { aim: 0, lift: 0 };
    scene.setHand({ visible: handVisible, seat: viewSeat, aim: aim.aim, lift: aim.lift, fire: fireNow });
  }, [scene, handVisible, viewSeat, opponentAim, fireNow, mySeat]);
  useEffect(() => syncHand(), [syncHand]);

  const clearAim = useCallback(() => {
    handAim.current = { aim: 0, lift: 0 };
    power.set(0);
    scene?.setPreview(null, mySeat ?? 0);
    syncHand();
  }, [scene, mySeat, power, syncHand]);

  const release = useCallback(
    (input: ThrowInput | null) => {
      const cur = live.current.g;
      if (!input || !cur.myThrow) {
        clearAim();
        return;
      }
      audio.resume();
      audio.whoosh();
      xapps.ui.haptic("light").catch(noop);
      handAim.current = { aim: 0, lift: 0 };
      scene?.setPreview(null, mySeat ?? 0);
      cur.throwBall(input);
    },
    [audio, clearAim, mySeat, scene, xapps],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    audio.resume();
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cur = live.current.g;
    if (cur.myPick && scene && boxRef.current) {
      const id = scene.pickAt(e.clientX, e.clientY, boxRef.current.getBoundingClientRect());
      if (id !== null && cur.pickCup(id)) xapps.ui.haptic("medium").catch(noop);
      return;
    }
    if (!cur.myThrow || drag.current) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured
    }
    drag.current = { id: e.pointerId, samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }], x0: e.clientX, y0: e.clientY };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) d.samples.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY });
    if (d.samples.length > 90) d.samples.splice(0, d.samples.length - 90);
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const up = Math.max(0, d.y0 - e.clientY);
    handAim.current = {
      aim: Math.max(-1, Math.min(1, (e.clientX - d.x0) / (rect.width * LEAN_SPAN))),
      lift: Math.min(1, up / (rect.height * 0.3)),
    };
    // Aim is the lean you see (the ball slides with your finger); the flick's speed is the power.
    const flick = flickOf(d.samples, rect.height);
    const est = flick && { ...flick, aim: handAim.current.aim };
    power.set(est && up > rect.height * 0.02 ? est.power : 0);
    const cur = live.current.g;
    if (cur.showPreview && est && up > rect.height * 0.03 && mySeat !== null) scene?.setPreview(previewArc(est, 0.42), mySeat);
    else scene?.setPreview(null, mySeat ?? 0);
    cur.shareAim(handAim.current.aim, handAim.current.lift);
    syncHand();
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    d.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    const rect = boxRef.current?.getBoundingClientRect();
    const travel = d.y0 - e.clientY;
    if (cancelled || !rect || travel < rect.height * MIN_SWIPE) {
      clearAim();
      return;
    }
    const flick = flickOf(d.samples, rect.height);
    release(flick && { ...flick, aim: Math.max(-1, Math.min(1, (e.clientX - d.x0) / (rect.width * LEAN_SPAN))) });
  };

  // Keyboard: ←/→ aim, hold Space (or Enter) to charge, release to throw.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const k = keyState.current;
      if (k.charging === null) return;
      const t = ((performance.now() - k.charging) % (KEY_CHARGE_MS * 2)) / KEY_CHARGE_MS;
      power.set(t <= 1 ? t : 2 - t);
      raf = requestAnimationFrame(tick);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      const cur = live.current.g;
      if (!cur.myThrow) return;
      const k = keyState.current;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        k.aim = Math.max(-1, Math.min(1, k.aim + (e.key === "ArrowLeft" ? -0.05 : 0.05)));
        handAim.current = { aim: k.aim, lift: handAim.current.lift };
        syncHand();
        cur.shareAim(k.aim, 0);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (e.repeat || k.charging !== null) return;
        audio.resume();
        k.charging = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = keyState.current;
      if ((e.key !== " " && e.key !== "Enter") || k.charging === null) return;
      e.preventDefault();
      cancelAnimationFrame(raf);
      k.charging = null;
      const p = power.get();
      release({ aim: k.aim, power: p });
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, [audio, power, release, syncHand]);

  /* ---------------------------- playback ---------------------------- */

  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!scene || busy.current) return;
    const cur = live.current.g;
    if (cur.shown >= cur.log.length) return;
    busy.current = true;
    const n = cur.shown;
    const action = cur.log[n] as Action;
    const before = cur.shownGame;
    const seat = seatOf(action.by);
    const run = async () => {
      // Let the camera get behind the thrower first.
      for (let i = 0; i < 40 && scene.orbiting; i++) await sleep(50);
      if (!mounted.current) return;
      const after = applyAction(before, action, seat) ?? before;
      if (action.k === "t") {
        const traj = live.current.g.trajFor(n);
        const path = traj ? decodePath(traj.path) : null;
        const events = traj ? decodeEvents(traj.ev) : null;
        flightRims.current = 0;
        if (path && events) {
          await scene.playThrow(seat, path, events, before.fire[seat]);
        } else {
          // No trajectory (a timed-out ball, or an old throw): just show the result.
          if (action.c >= 0) {
            audio.splash();
            scene.removeCupById(other(seat), action.c, true);
          }
          await sleep(action.f & F_TIMEOUT ? 700 : 500);
        }
        if (!mounted.current) return;
        announceThrow(before, after, action, seat, flightRims.current > 0);
      } else if (action.k === "x") {
        scene.removeCupById(other(seat), action.c, true);
        audio.splash();
        await sleep(650);
      } else {
        audio.slide();
        announce({ title: "Re-rack!", sub: FORMATION_LABEL[action.f], tone: "info" });
        busy.current = false;
        live.current.g.advance(n + 1);
        return;
      }
      if (!mounted.current) return;
      if (after.over) {
        const g2 = live.current.g;
        const won = seat === g2.mySeat;
        audio.crowd("roar");
        announce({
          title: won ? "You win!" : g2.spectating ? `${nameOf(seat)} wins!` : `${nameOf(seat)} wins`,
          sub: after.racks[seat].length === 10 ? "Clean sweep 🧹" : after.racks[seat].length === 1 ? "Down to the last cup 😅" : undefined,
          tone: won || g2.spectating ? "win" : "bad",
        });
        if (won) xapps.ui.celebrate("big").catch(noop);
      } else if (actorOf(after) !== actorOf(before) || (action.k === "x" && after.turn !== before.turn)) {
        announceTurn(actorOf(after));
      }
      busy.current = false;
      live.current.g.advance(n + 1);
    };

    const nameOf = (s: Seat) => {
      const p = live.current.g.players[s];
      return p ? (p.isBot ? p.name : `@${p.handle}`) : "Player";
    };
    const announce = (b: Omit<Banner, "key">) => live.current.onBanner(b);
    const announceTurn = (s: Seat) => {
      const g2 = live.current.g;
      if (s === g2.mySeat) announce({ title: "Your turn", sub: "Flick up to throw", tone: "turn" });
      else announce({ title: `${nameOf(s)}'s turn`, tone: "turn" });
    };
    const announceThrow = (b: GameState, a: GameState, act: Action, s: Seat, rimmed: boolean) => {
      if (act.k !== "t") return;
      const mine = s === live.current.g.mySeat;
      if (act.f & F_TIMEOUT) {
        announce({ title: "Time's up", sub: "Ball dropped", tone: "bad" });
        return;
      }
      if (act.c < 0) {
        if (rimmed) audio.crowd("ooh");
        return;
      }
      if (a.fire[s] && !b.fire[s]) {
        audio.ignite();
        announce({ title: "On fire 🔥", sub: mine ? "Hot ball: easier makes until you miss" : undefined, tone: "fire" });
        return;
      }
      if (act.f & 1 && a.pendingPick === s) {
        announce({ title: "Bounce shot! 🏓", sub: mine ? "Tap a cup to take it too" : "…and they take a bonus cup", tone: "good" });
        return;
      }
      if (a.stats[s].ballsBack > b.stats[s].ballsBack) {
        audio.crowd("roar");
        announce({ title: "Balls back! 🔁", sub: mine ? "Throw again" : undefined, tone: "good" });
        return;
      }
      if (rimmed) announce({ title: "Rattled in! 🌀", tone: "good" });
    };

    // An action plays to the end even if props change meanwhile; the next one starts when it's done.
    void run().finally(() => {
      busy.current = false;
    });
    // Re-run whenever a new action lands or one finishes playing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, g.shown, g.log.length]);

  // Opening line once the match starts.
  const greeted = useRef(false);
  useEffect(() => {
    if (!g.started || greeted.current || !g.playing || !g.caughtUp) return;
    greeted.current = true;
    const s = actorOf(g.shownGame);
    const p = g.players[s];
    const t = setTimeout(() => {
      if (s === g.mySeat) live.current.onBanner({ title: "Your turn", sub: "Flick up to throw", tone: "turn" });
      else live.current.onBanner({ title: `${p ? (p.isBot ? p.name : `@${p.handle}`) : "Their"} throws first`, tone: "turn" });
    }, 250);
    return () => clearTimeout(t);
  }, [g.started, g.playing, g.caughtUp, g.shownGame, g.players, g.mySeat]);

  if (failed) {
    return (
      <div className={cn("flex items-center justify-center p-6 text-center text-sm text-ink-300", className)}>
        This device couldn&apos;t start 3D graphics (WebGL). Try another browser.
      </div>
    );
  }

  return (
    <div
      ref={boxRef}
      className={cn("relative h-full w-full touch-none select-none", g.myThrow ? "cursor-grab active:cursor-grabbing" : g.myPick ? "cursor-pointer" : "cursor-default", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Cup pong table. Flick up to throw, or use the arrow keys to aim and hold Space to throw."
    >
      <div ref={attach} className="absolute inset-0" />
    </div>
  );
}

/** Vertical power gauge shown while you swipe or charge. */
export function PowerGauge({ power, last }: { power: MotionValue<number>; last: number | null }) {
  const height = useTransform(power, (p) => `${Math.min(100, (Math.min(1.25, p) / 1.25) * 100)}%`);
  const opacity = useTransform(power, (p) => (p > 0.001 ? 1 : 0.35));
  return (
    <motion.div style={{ opacity }} className="pointer-events-none relative h-40 w-2.5 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/15">
      <motion.div
        style={{ height }}
        className="absolute inset-x-0 bottom-0 rounded-full bg-[linear-gradient(to_top,#43b6ff,#ffd23d_55%,#ff3b4f)]"
      />
      {last !== null && (
        <div className="absolute inset-x-[-3px] h-0.5 rounded bg-white" style={{ bottom: `${(Math.min(1.25, last) / 1.25) * 100}%` }} />
      )}
    </motion.div>
  );
}

export function usePowerValue() {
  return useMotionValue(0);
}
