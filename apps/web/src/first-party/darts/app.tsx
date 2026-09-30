"use client";

import type { PlayerInfo, XAppsClient } from "@xapps/sdk";
import { useGestureLock, useMatchResult, useMatchStarted, usePlayers, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { motion, useAnimate, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useTimeouts } from "@/first-party/shared/hooks";
import { reportStats, unlockAchievements } from "@/first-party/shared/progress";
import { AnimatedDots } from "@/first-party/shared/ui";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
  BREATH,
  analyzeFlick,
  breathHeld,
  chargeLevel,
  chargeToSpeed,
  clampAim,
  flightMs,
  landingPoint,
  normalizeSpeed,
  powerVerdict,
  reticleAt,
  swayParams,
  type PowerVerdict,
  type Sample,
  type SwayParams,
} from "./aim";
import { playBreath, playChime, playCrowd, playGroan, playPull, playRaise, playThunk, playWhoosh } from "./audio";
import { VIEW, clampToView, hitTest, wireDistance, type Point } from "./board";
import { BoardView, toPx, type Flight, type Pop, type StuckDart } from "./board-view";
import { planBot, hurrySchedule } from "./bots";
import { DartDefs, flightColor } from "./dart";
import {
  BIG_ROUND_END_MS,
  DARTS_PER_ROUND,
  ROUND_END_MS,
  TOTAL_DARTS,
  dartTone,
  earnedAchievements,
  gameStats,
  mergeDarts,
  ordinal,
  parseMessage,
  quantize,
  roundCallout,
  roundOf,
  roundScores,
  submissionFor,
  toMessage,
  total,
  wonTable,
  type Callout,
} from "./logic";
import { CalloutBanner, FinalPanel, Pregame, ThrowZone, Tray, type Standing } from "./parts";
import { Scoreboard, type Contender } from "./scoreboard";

const TAG = "darts";
/** Finger → aim: board mm per screen px, relative to the board's own scale. */
const AIM_GAIN = 0.8;
/** Keyboard aiming speed (mm per second). */
const KEY_AIM_MM_S = 85;
/** An upward finger speed (px/ms) above this is a flick in progress: the aim stops following. */
const FREEZE_AIM_SPEED = 0.9;
/** The throwing zone under the board never gets shorter than this (px)… */
const MIN_ZONE = 150;
/** …or than this share of the screen. */
const ZONE_SHARE = 0.2;

type Phase = "aim" | "flight" | "round-end" | "pull" | "done";
type HapticStyle = Parameters<XAppsClient["ui"]["haptic"]>[0];

interface Session {
  kind: "pointer" | "key";
  pointerId: number;
  raiseAt: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  aim0: Point;
  samples: Sample[];
  breathAt: number | null;
  params: SwayParams;
  /** Keyboard throws: when Space went down. */
  chargeAt: number | null;
}

const ignore = () => {};
function quietly(promise: Promise<unknown>): void {
  promise.catch(ignore);
}

function nameOf(p: PlayerInfo): string {
  return p.isBot ? p.name : p.name?.trim() || `@${p.handle}`;
}

/** Prefer the input's own timestamp over "now" when it's sane. */
function eventTime(stamp: number): number {
  const now = performance.now();
  return stamp > 0 && stamp <= now + 1 && now - stamp < 1000 ? stamp : now;
}

/** A stable per-dart flight spin, so the X of the flights varies from dart to dart. */
function spinOf(p: Point): number {
  return Math.abs((p.x * 7.31 + p.y * 3.17) % 6.283);
}

/* Unsubmitted darts survive a reload (and can't be re-rolled by one). */
const saveKey = (matchId: string) => `xapps:darts:${matchId}`;
function loadSaved(matchId: string): Point[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(saveKey(matchId));
    return (raw && parseMessage(JSON.parse(raw))) || [];
  } catch {
    return [];
  }
}
function saveDarts(matchId: string, darts: Point[]): void {
  try {
    window.localStorage.setItem(saveKey(matchId), JSON.stringify(toMessage(darts)));
  } catch {
    // private mode: fine
  }
}
function clearSaved(matchId: string): void {
  try {
    window.localStorage.removeItem(saveKey(matchId));
  } catch {
    // ignore
  }
}

export function Darts() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const { players, me } = usePlayers();
  const readyRef = useRef(false);

  useEffect(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn(`[${TAG}] ready failed`, error));
  }, [xapps]);

  if (!started) return <Pregame players={players} meId={me.id} names={nameOf} />;
  return <Game />;
}

function Game() {
  const xapps = useXApps();
  const result = useMatchResult();
  const { players, me, isSpectator } = usePlayers();
  const reduced = useReducedMotion() ?? false;
  const later = useTimeouts();
  const matchId = xapps.match.id;
  const live = xapps.match.mode === "live";
  const color = flightColor(me.seat);

  const [initial] = useState<Point[]>(() => (isSpectator ? [] : loadSaved(matchId)));
  const [darts, setDarts] = useState<Point[]>(initial);
  const [phase, setPhase] = useState<Phase>(initial.length >= TOTAL_DARTS ? "done" : "aim");
  const [flight, setFlight] = useState<Flight | null>(null);
  const [freshIndex, setFreshIndex] = useState(-1);
  const [pops, setPops] = useState<Pop[]>([]);
  const [held, setHeld] = useState(false);
  const [breath, setBreath] = useState<"ready" | "held" | "spent">("ready");
  const [charging, setCharging] = useState(false);
  const [power, setPower] = useState<{ id: number; verdict: PowerVerdict; speed: number } | null>(null);
  const [callout, setCallout] = useState<(Callout & { id: number }) | null>(null);
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);
  const [zoom, setZoom] = useState(false);
  const [others, setOthers] = useState<Record<string, Point[]>>({});
  const [boardSize, setBoardSize] = useState(0);
  const [submitState, setSubmitState] = useState<"idle" | "sent" | "error">("idle");
  const [focusId, setFocusId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const handRef = useRef<HTMLDivElement>(null);
  const reticleRef = useRef<HTMLDivElement>(null);
  const chargeRef = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const aimRef = useRef<Point>({ x: 0, y: 0 });
  const dartsRef = useRef<Point[]>(initial);
  const keysRef = useRef(new Set<string>());
  const startRef = useRef<number | null>(null);
  const hurryRef = useRef<number | null>(null);
  const heardRef = useRef(new Set<string>());
  const botSubmitted = useRef(new Set<string>());
  const submittedRef = useRef(false);
  const seq = useRef(0);
  const [camera, animateCamera] = useAnimate<HTMLDivElement>();

  useGestureLock(rootRef);

  const humans = players.filter((p) => !p.isBot).sort((a, b) => a.seat - b.seat);
  const driverIndex = isSpectator ? -1 : humans.findIndex((p) => p.id === me.id);
  const liveHumans = live && players.some((p) => !p.isBot && p.id !== me.id);
  const canThrow = !isSpectator && !result && phase === "aim";
  const aiming = held && !result;

  const haptic = useCallback((style: HapticStyle) => quietly(xapps.ui.haptic(style)), [xapps]);
  const nextId = () => ++seq.current;

  /* ---------------------------------------------------------------- */
  /* Board sizing, clock, bots                                          */
  /* ---------------------------------------------------------------- */

  // The board takes what the width allows; the throwing zone below gets the rest of the height.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      const head = headRef.current?.offsetHeight ?? 64;
      const tray = trayRef.current?.offsetHeight ?? 0;
      const zone = isSpectator ? 44 : Math.max(MIN_ZONE, r.height * ZONE_SHARE);
      const avail = r.height - head - tray - zone - 16;
      setBoardSize(Math.max(120, Math.floor(Math.min(r.width - 12, avail, 640))));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [isSpectator]);

  useEffect(() => {
    startRef.current = performance.now();
  }, []);

  // Say hello so live opponents send us what they've thrown so far (and see ours).
  useEffect(() => {
    if (liveHumans && !isSpectator) quietly(xapps.room.send("throws", toMessage(dartsRef.current)));
  }, [liveHumans, isSpectator, xapps]);

  const botKey = JSON.stringify(players.filter((p) => p.isBot).map((p) => [p.id, p.seat]));
  const botPlans = useMemo(
    () =>
      (JSON.parse(botKey) as [string, number][]).map(([id, seat]) => ({
        id,
        plan: planBot(xapps.random.fork(`bot:${seat}`).next),
      })),
    [botKey, xapps],
  );

  // Bots throw on their own clock; once we're done they hurry up.
  useEffect(() => {
    if (botPlans.length === 0) return;
    const timer = setInterval(() => {
      const start = startRef.current;
      if (start === null) return;
      const elapsed = performance.now() - start;
      const hurry = hurryRef.current;
      setOthers((prev) => {
        let next = prev;
        for (const b of botPlans) {
          const schedule = hurry !== null ? hurrySchedule(b.plan.schedule, hurry) : b.plan.schedule;
          const count = schedule.filter((t) => t <= elapsed).length;
          if ((prev[b.id]?.length ?? 0) !== count) {
            if (next === prev) next = { ...prev };
            next[b.id] = b.plan.darts.slice(0, count);
          }
        }
        return next;
      });
    }, 120);
    return () => clearInterval(timer);
  }, [botPlans]);

  // The first human at the table submits for bots as they finish; the others back it up.
  useEffect(() => {
    if (driverIndex < 0) return;
    for (const b of botPlans) {
      if ((others[b.id]?.length ?? 0) < TOTAL_DARTS || botSubmitted.current.has(b.id)) continue;
      if (xapps.player(b.id)?.submitted) continue;
      const delay = driverIndex === 0 ? 0 : phase === "done" ? 3000 * driverIndex : -1;
      if (delay < 0) continue;
      botSubmitted.current.add(b.id);
      later(() => {
        if (xapps.player(b.id)?.submitted) return;
        xapps
          .submitFor(b.id, submissionFor(b.plan.darts))
          .catch((error: unknown) => console.warn(`[${TAG}] bot submit failed`, error));
      }, delay);
    }
  }, [others, botPlans, driverIndex, phase, xapps, later]);

  /* ---------------------------------------------------------------- */
  /* Live opponents                                                    */
  /* ---------------------------------------------------------------- */

  useRoomEvent("throws", (payload, from) => {
    if (from === me.id) return;
    const p = players.find((x) => x.id === from);
    if (!p || p.isBot) return;
    const parsed = parseMessage(payload);
    if (!parsed) return;
    setOthers((prev) => ({ ...prev, [from]: mergeDarts(prev[from], parsed) }));
    if (!heardRef.current.has(from)) {
      heardRef.current.add(from);
      if (!isSpectator && live) quietly(xapps.room.send("throws", toMessage(dartsRef.current)));
    }
  });

  /* ---------------------------------------------------------------- */
  /* Aiming loop                                                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!aiming) return;
    let raf = 0;
    let prev = performance.now();
    let spent = false;
    const tick = (now: number) => {
      const s = session.current;
      if (!s) return;
      const dt = Math.min(0.05, Math.max(0, (now - prev) / 1000));
      prev = now;
      const keys = keysRef.current;
      if (s.kind === "key" && keys.size > 0) {
        const dx = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        const dy = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
        aimRef.current = clampAim({ x: aimRef.current.x + dx * KEY_AIM_MM_S * dt, y: aimRef.current.y + dy * KEY_AIM_MM_S * dt });
      }
      const t = now - s.raiseAt;
      const r = reticleAt(aimRef.current, s.params, t, s.breathAt);
      const px = toPx(clampToView(r, 4), boardSize);
      const reticle = reticleRef.current;
      if (reticle) {
        reticle.style.transform = `translate3d(${px.x}px, ${px.y}px, 0)`;
        reticle.dataset.calm = breathHeld(t, s.breathAt) ? "1" : "0";
      }
      const hand = handRef.current;
      if (hand) {
        const fx = s.kind === "pointer" ? (s.lastX - s.startX) * 0.35 : (aimRef.current.x - s.aim0.x) * 0.3;
        const fy = s.kind === "pointer" ? (s.lastY - s.startY) * 0.22 : (aimRef.current.y - s.aim0.y) * 0.2;
        const x = Math.max(-80, Math.min(80, fx));
        const y = Math.max(-28, Math.min(28, fy));
        hand.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${x * 0.14}deg)`;
      }
      if (s.chargeAt !== null && chargeRef.current) {
        chargeRef.current.style.height = `${chargeLevel(now - s.chargeAt) * 100}%`;
      }
      if (!spent && s.breathAt !== null && t - s.breathAt >= BREATH.holdMs) {
        spent = true;
        setBreath("spent");
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const hand = handRef.current;
    return () => {
      cancelAnimationFrame(raf);
      if (hand) hand.style.transform = "";
    };
  }, [aiming, boardSize]);

  /* ---------------------------------------------------------------- */
  /* Throwing                                                          */
  /* ---------------------------------------------------------------- */

  const flashHint = (text: string) => {
    const id = nextId();
    setHint({ id, text });
    later(() => setHint((h) => (h?.id === id ? null : h)), 1800);
  };

  const raise = (kind: Session["kind"], pointerId: number, x: number, y: number, t: number) => {
    session.current = {
      kind,
      pointerId,
      raiseAt: t,
      startX: x,
      startY: y,
      lastX: x,
      lastY: y,
      aim0: aimRef.current,
      samples: [{ t, x, y }],
      breathAt: null,
      params: swayParams(xapps.random.fork(`sway:${dartsRef.current.length}`).next),
      chargeAt: null,
    };
    setHeld(true);
    setBreath("ready");
    setHint(null);
    playRaise();
    haptic("light");
  };

  const lower = () => {
    session.current = null;
    keysRef.current.clear();
    setHeld(false);
    setCharging(false);
  };

  const holdBreath = () => {
    const s = session.current;
    if (!s || s.breathAt !== null) return;
    s.breathAt = performance.now() - s.raiseAt;
    setBreath("held");
    playBreath();
    haptic("light");
  };

  const land = (at: Point, speed: number) => {
    const next = [...dartsRef.current, at];
    dartsRef.current = next;
    setDarts(next);
    saveDarts(matchId, next);
    setFlight(null);
    setFreshIndex(next.length - 1);

    const hit = hitTest(at);
    const tone = dartTone(hit);
    const id = nextId();
    const label = hit.ring === "off" ? "Wall!" : hit.ring === "board" ? "Miss" : hit.label;
    setPops((list) => [...list.slice(-3), { id, at, label, points: hit.score, tone }]);
    setPower({ id, verdict: powerVerdict(speed), speed });

    playThunk(speed, hit.ring === "off" ? "wall" : hit.ring === "board" ? "ring" : wireDistance(at) < 1.2 ? "wire" : "sisal");
    if (hit.ring === "bull") playChime("bull");
    else if (hit.ring === "outer-bull") playChime("outer-bull");
    else if (tone === "treble") playChime("treble");
    else if (tone === "double") playChime("double");
    haptic(tone === "bull" || tone === "treble" ? "heavy" : tone === "miss" ? "light" : "medium");

    if (!reduced && camera.current) {
      animateCamera(camera.current, { y: [0, 2.5 * Math.min(1.5, speed / 2), 0] }, { duration: 0.18, ease: "easeOut" });
    }
    if (hit.ring === "bull" && !reduced) {
      setZoom(true);
      later(() => setZoom(false), 1150);
    }
    if (liveHumans) quietly(xapps.room.send("throws", toMessage(next)));
    unlockAchievements(xapps, earnedAchievements(next, false), TAG);

    if (next.length % DARTS_PER_ROUND === 0) later(() => endRound(next), 560);
    else setPhase("aim");
  };

  const endRound = (next: Point[]) => {
    const hits = next.slice(-DARTS_PER_ROUND).map(hitTest);
    const sum = hits.reduce((s, h) => s + h.score, 0);
    const c = roundCallout(hits);
    setCallout({ ...c, id: nextId() });
    setPhase("round-end");
    if (c.tone === "legend") {
      playCrowd(c.text.startsWith("ONE HUNDRED") ? 1 : 0.85);
      quietly(xapps.ui.celebrate("big"));
      haptic("success");
      if (!reduced && camera.current) {
        animateCamera(camera.current, { x: [0, -10, 9, -6, 4, -2, 0], rotate: [0, -1.2, 1, -0.6, 0.3, 0, 0] }, { duration: 0.6 });
      }
    } else if (c.tone === "hot") {
      playCrowd(sum >= 140 ? 0.7 : 0.45);
      quietly(xapps.ui.celebrate("small"));
      haptic("success");
    } else if (c.tone === "good") {
      playCrowd(0.22);
    } else if (sum === 0) {
      playGroan();
    }
    const hold = c.tone === "legend" || c.tone === "hot" ? BIG_ROUND_END_MS : ROUND_END_MS;
    later(() => {
      setCallout(null);
      if (next.length >= TOTAL_DARTS) {
        finish(next);
        return;
      }
      setPhase("pull");
      playPull();
      later(
        () => {
          setPhase("aim");
          setFreshIndex(-1);
        },
        reduced ? 60 : 380,
      );
    }, hold);
  };

  const finish = (final: Point[]) => {
    setPhase("done");
    const start = startRef.current;
    hurryRef.current = start === null ? 0 : performance.now() - start;
    reportStats(xapps, gameStats(final), TAG);
    unlockAchievements(xapps, earnedAchievements(final, true), TAG);
    quietly(xapps.ui.setTurn(null));
  };

  const throwDart = (at: Point, speed: number) => {
    lower();
    setPhase("flight");
    const board = boardRef.current?.getBoundingClientRect();
    const hand = handRef.current?.getBoundingClientRect();
    const landPx = toPx(clampToView(at), boardSize);
    let from = { x: 0, y: boardSize * 0.95 };
    if (board && hand && board.width > 0) {
      const sc = board.width / boardSize;
      from = { x: (hand.left - board.left) / sc - landPx.x, y: (hand.top - 150 - board.top) / sc - landPx.y };
    }
    const ms = reduced ? 120 : flightMs(speed);
    setFlight({ id: nextId(), at, from, ms, color, spin: spinOf(at) });
    playWhoosh(speed);
    haptic("light");
    later(() => land(at, speed), ms);
  };

  const release = (s: Session) => {
    const flick = analyzeFlick(s.samples);
    if (flick.kind === "cancel") {
      lower();
      flashHint(flick.reason === "slow" ? "Faster! Flick up to throw" : "Flick up to throw");
      return;
    }
    const start = s.samples[flick.startIndex]!;
    // Aim where the finger rested just before it took off (the first flick sample is already moving),
    // and read the sway at the moment the flick began.
    const rest = s.samples[Math.max(0, flick.startIndex - 1)]!;
    const k = ((2 * VIEW) / Math.max(1, boardSize)) * AIM_GAIN;
    const aim = clampAim({ x: s.aim0.x + (rest.x - s.startX) * k, y: s.aim0.y + (rest.y - s.startY) * k });
    aimRef.current = aim; // the next dart starts where this one was aimed
    const speed = normalizeSpeed(flick.speed, rootRef.current?.clientHeight ?? 760);
    const at = quantize(landingPoint({ aim, swayT: start.t - s.raiseAt, breathAt: s.breathAt, speed, angle: flick.angle }, s.params));
    throwDart(at, speed);
  };

  /* Pointer ------------------------------------------------------------ */

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canThrow || session.current || !e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-no-aim]")) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events can't be captured
    }
    raise("pointer", e.pointerId, e.clientX, e.clientY, eventTime(e.timeStamp));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (!s || s.kind !== "pointer" || e.pointerId !== s.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length > 0 ? events : [e.nativeEvent]) {
      const t = eventTime(ev.timeStamp);
      const last = s.samples[s.samples.length - 1];
      if (last && t < last.t) continue;
      s.samples.push({ t, x: ev.clientX, y: ev.clientY });
    }
    if (s.samples.length > 400) s.samples.splice(0, s.samples.length - 400);
    s.lastX = e.clientX;
    s.lastY = e.clientY;
    const n = s.samples.length;
    const a = s.samples[n - 2];
    const b = s.samples[n - 1]!;
    const flicking = !!a && b.t > a.t && (a.y - b.y) / (b.t - a.t) > FREEZE_AIM_SPEED;
    if (!flicking) {
      const k = ((2 * VIEW) / Math.max(1, boardSize)) * AIM_GAIN;
      aimRef.current = clampAim({ x: s.aim0.x + (e.clientX - s.startX) * k, y: s.aim0.y + (e.clientY - s.startY) * k });
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (!s || s.kind !== "pointer" || e.pointerId !== s.pointerId) return;
    const t = eventTime(e.timeStamp);
    const last = s.samples[s.samples.length - 1]!;
    if (t >= last.t) {
      const moved = e.clientX !== last.x || e.clientY !== last.y;
      s.samples.push(moved ? { t, x: e.clientX, y: e.clientY } : { t, x: last.x, y: last.y });
    }
    release(s);
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = session.current;
    if (s && s.kind === "pointer" && e.pointerId === s.pointerId) lower();
  };

  /* Keyboard ------------------------------------------------------------ */

  const onKey = useEffectEvent((e: KeyboardEvent, down: boolean) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const s = session.current;
    const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown";
    if (arrow) {
      if (down) {
        if (!s && canThrow) raise("key", -1, 0, 0, performance.now());
        if (session.current?.kind === "key") {
          keysRef.current.add(e.key);
          e.preventDefault();
        }
      } else keysRef.current.delete(e.key);
      return;
    }
    if (down && !e.repeat && (e.key === "b" || e.key === "B" || e.key === "Shift")) {
      holdBreath();
      return;
    }
    if (e.key === "Escape" && down && s) {
      lower();
      return;
    }
    if (e.key !== " " && e.code !== "Space") return;
    if (down) {
      if (e.repeat) {
        if (s) e.preventDefault();
        return;
      }
      if (!s && canThrow) raise("key", -1, 0, 0, performance.now());
      const cur = session.current;
      if (cur?.kind === "key" && cur.chargeAt === null) {
        cur.chargeAt = performance.now();
        setCharging(true);
        e.preventDefault();
      }
      return;
    }
    if (s?.kind === "key" && s.chargeAt !== null) {
      e.preventDefault();
      const now = performance.now();
      const speed = chargeToSpeed(chargeLevel(now - s.chargeAt));
      const at = quantize(landingPoint({ aim: aimRef.current, swayT: now - s.raiseAt, breathAt: s.breathAt, speed, angle: 0 }, s.params));
      throwDart(at, speed);
    }
  });

  useEffect(() => {
    const down = (e: KeyboardEvent) => onKey(e, true);
    const up = (e: KeyboardEvent) => onKey(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Submit, result, HUD                                               */
  /* ---------------------------------------------------------------- */

  const submitNow = useCallback(() => {
    const final = dartsRef.current;
    xapps.submit(submissionFor(final)).then(
      () => {
        clearSaved(matchId);
        setSubmitState("sent");
      },
      (error: unknown) => {
        console.error(`[${TAG}] submit failed`, error);
        setSubmitState("error");
      },
    );
  }, [xapps, matchId]);

  useEffect(() => {
    if (phase !== "done" || isSpectator || submittedRef.current || xapps.me.submitted) return;
    submittedRef.current = true;
    submitNow();
  }, [phase, isSpectator, submitNow, xapps]);

  useEffect(() => {
    if (!result || isSpectator) return;
    if (wonTable(result.ranks, me.id, players.length)) unlockAchievements(xapps, ["winner"], TAG);
  }, [result, isSpectator, me.id, players.length, xapps]);

  const contenders: Contender[] = [...players]
    .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.seat - b.seat))
    .map((p) => {
      const isMe = p.id === me.id && !isSpectator;
      const list = isMe ? darts : (others[p.id] ?? []);
      const fromResult = result?.scores[p.id];
      const settled =
        typeof fromResult === "number" ? fromResult : !isMe && p.submitted && p.score !== null && list.length < TOTAL_DARTS ? p.score : null;
      return {
        player: p,
        name: isMe ? "You" : nameOf(p),
        color: flightColor(p.seat),
        isMe,
        darts: list,
        total: total(list),
        settled,
        presence: isMe || p.isBot || live ? "live" : p.submitted ? "done" : "later",
      };
    });
  const best = Math.max(0, ...contenders.map((c) => c.settled ?? c.total));
  const leaders = contenders.filter((c) => (c.settled ?? c.total) === best && best > 0);
  const leaderId = leaders.length === 1 ? leaders[0]!.player.id : null;

  const scoreKey = contenders.map((c) => `${c.player.id}:${c.settled ?? c.total}`).join("|");
  const pushScores = useEffectEvent(() => {
    quietly(xapps.ui.setScores(Object.fromEntries(contenders.map((c) => [c.player.id, c.settled ?? c.total]))));
  });
  useEffect(() => pushScores(), [scoreKey]);

  const round = roundOf(darts.length);
  const status = isSpectator
    ? "Watching"
    : phase === "done"
      ? result
        ? "Game over"
        : "Waiting for the table"
      : `Round ${Math.min(3, round + 1)} of 3 · dart ${(darts.length % DARTS_PER_ROUND) + 1}`;
  useEffect(() => {
    quietly(xapps.ui.setStatus(status));
  }, [status, xapps]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const focus = isSpectator ? (contenders.find((c) => c.player.id === focusId) ?? contenders[0]) : null;
  const shown = focus ? focus.darts : darts;
  const shownColor = focus ? focus.color : color;
  const showingRound = focus || phase === "round-end" || phase === "pull" || phase === "done";
  const roundStart = showingRound
    ? Math.max(0, Math.floor((shown.length - 1) / DARTS_PER_ROUND) * DARTS_PER_ROUND)
    : Math.floor(shown.length / DARTS_PER_ROUND) * DARTS_PER_ROUND;
  const stuck: StuckDart[] = shown.slice(roundStart).map((at, i) => ({
    key: `${roundStart + i}`,
    at,
    color: shownColor,
    spin: spinOf(at),
    fresh: !focus && roundStart + i === freshIndex,
  }));
  const holes = shown.slice(0, roundStart);

  const myTotal = total(darts);
  const hintText =
    hint?.text ??
    (isSpectator || phase !== "aim"
      ? null
      : held
        ? breath === "held"
          ? "Steady… now flick!"
          : "Fight the sway · flick up to throw"
        : darts.length === 0
          ? "Hold anywhere to raise a dart"
          : "Hold to raise your next dart");

  const pendingBots = contenders.some((c) => c.player.isBot && c.darts.length < TOTAL_DARTS && c.settled === null);
  const waitingOn = contenders.filter((c) => !c.isMe && !c.player.isBot && !c.player.submitted && c.settled === null);
  const finalStatus = result ? (
    <span className="font-semibold text-success">✓ Result locked in</span>
  ) : submitState === "error" ? (
    <span className="inline-flex items-center gap-2 text-danger">
      Couldn&apos;t submit your score.
      <button
        type="button"
        data-no-aim
        onPointerDown={() => {
          setSubmitState("idle");
          submitNow();
        }}
        onClick={(e) => {
          if (e.detail === 0) {
            setSubmitState("idle");
            submitNow();
          }
        }}
        className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-ink-50 ring-1 ring-white/15"
      >
        Retry
      </button>
    </span>
  ) : waitingOn.length > 0 ? (
    <span>
      {live ? `Waiting for ${waitingOn.map((c) => c.name).join(", ")}` : "The others throw in their own time"}
      {live && <AnimatedDots />}
    </span>
  ) : pendingBots ? (
    <span>
      The bots are finishing their darts
      <AnimatedDots />
    </span>
  ) : (
    <span>
      Locking in your score
      <AnimatedDots />
    </span>
  );

  let headline: string | null = null;
  let standings: Standing[] | null = null;
  if (result) {
    const rank = result.ranks?.[me.id];
    const firsts = Object.values(result.ranks ?? {}).filter((r) => r === 1).length;
    headline = rank === 1 ? (firsts > 1 ? "Tied for 1st" : "You win!") : rank ? `${ordinal(rank)} place` : null;
    standings = contenders
      .map((c) => ({
        id: c.player.id,
        name: c.name,
        color: c.color,
        score: result.scores[c.player.id] ?? c.total,
        rank: result.ranks?.[c.player.id] ?? 0,
        isMe: c.isMe,
      }))
      .sort((a, b) => (a.rank || 99) - (b.rank || 99) || b.score - a.score);
  }

  const boardLabel = `Dartboard. ${stuck.map((d) => hitTest(d.at).label).join(", ") || "No darts this round"}.`;

  return (
    <div
      ref={rootRef}
      className="relative flex h-dvh min-h-[520px] w-full select-none flex-col overflow-hidden [-webkit-touch-callout:none]"
      data-phase={phase}
      data-darts={darts.length}
      data-testid="darts-game"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <DartDefs />
      {/* A warm lamp over the board. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 48% at 50% 40%, rgb(255 214 150 / 0.13), transparent 70%), linear-gradient(to bottom, rgb(0 0 0 / 0.25), transparent 30%, rgb(0 0 0 / 0.35))",
        }}
      />
      <div ref={headRef} className="relative z-20 shrink-0">
        <Scoreboard
          contenders={contenders}
          leaderId={leaderId}
          onSelect={isSpectator ? (id) => setFocusId(id) : undefined}
          focusId={focus?.player.id ?? null}
        />
      </div>

      <div
        className={cn("relative flex shrink-0 items-center justify-center px-1.5 pt-2", isSpectator && "my-auto")}
        style={{ height: boardSize + 10 }}
      >
        <div ref={camera} className="relative">
          <motion.div
            ref={boardRef}
            initial={false}
            animate={{ scale: zoom ? 1.45 : aiming && !reduced ? 1.025 : 1 }}
            transition={zoom ? { type: "spring", stiffness: 200, damping: 22 } : spring.soft}
          >
            <BoardView
              size={boardSize}
              darts={stuck}
              holes={holes}
              pops={pops}
              flight={flight}
              reticleRef={isSpectator ? undefined : reticleRef}
              aiming={aiming}
              pulling={phase === "pull"}
              reduced={reduced}
              onPopDone={(id) => setPops((list) => list.filter((p) => p.id !== id))}
              label={boardLabel}
            />
          </motion.div>
        </div>
        <CalloutBanner callout={callout} reduced={reduced} />
      </div>

      {!isSpectator && (
        <>
          <div ref={trayRef} className="relative z-10 shrink-0">
            <Tray darts={darts} roundStart={roundStart} round={Math.floor(roundStart / DARTS_PER_ROUND)} total={myTotal} power={power} />
          </div>
          <ThrowZone
            color={color}
            held={aiming}
            visible={phase === "aim" && !result}
            handRef={handRef}
            hint={hintText}
            breath={breath}
            onBreath={holdBreath}
            charge={charging}
            chargeRef={chargeRef}
            showGuide={darts.length === 0 && phase === "aim"}
            reduced={reduced}
          />
        </>
      )}
      {phase === "done" && !isSpectator && (
        <FinalPanel total={myTotal} roundScores={roundScores(darts)} standings={standings} status={finalStatus} headline={headline} />
      )}
      {isSpectator && (
        <p className="relative z-10 pb-6 text-center text-sm text-ink-300">
          Watching {focus?.name ?? "the table"} · tap a player to follow them
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {power && darts.length > 0 ? `${hitTest(darts[darts.length - 1]!).label}. Total ${myTotal}.` : ""}
      </p>
    </div>
  );
}
