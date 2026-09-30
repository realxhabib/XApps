"use client";

import { useXApps } from "@xapps/sdk/react";
import { Eye, Hourglass, RotateCcw } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { AnimatedDots, Eyebrow } from "../shared/ui";
import { PoolAudio } from "./audio";
import { potCandidates } from "./bot";
import { FineAim, PowerBar, SpinControl } from "./controls";
import { Banner, MiniBall, PlayerCard, type BannerInfo, type CardResult } from "./hud";
import { POCKETS, predictAim, speedOf, type EventKind, type Vec } from "./physics";
import { OUTER_L, OUTER_W } from "./render";
import { checkCueSpot, defaultCueSpot, groupOf, needsCall, onEight, type Foul, type Game, type Seat } from "./rules";
import { PoolTable, type Controls } from "./table";
import { useEightBall, type EightBall } from "./use-game";

const noop = () => {};

export function EightBallApp() {
  const xapps = useXApps();
  const game = useEightBall();

  const readied = useRef(false);
  useEffect(() => {
    if (readied.current) return;
    readied.current = true;
    xapps.ready().catch(noop);
  }, [xapps]);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {game.started ? (
        <motion.div key="game" className="flex h-dvh w-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <GameView g={game} />
        </motion.div>
      ) : (
        <motion.div
          key="pregame"
          className="flex h-dvh w-full"
          exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
          transition={{ duration: 0.25 }}
        >
          <PreGame g={game} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------------ */
/* Pre-game                                                                 */
/* ------------------------------------------------------------------------ */

const RACK_ART: [number, number, number][] = [
  [1, 0, 0],
  [9, -0.5, 1],
  [2, 0.5, 1],
  [10, -1, 2],
  [8, 0, 2],
  [3, 1, 2],
  [11, -1.5, 3],
  [4, -0.5, 3],
  [12, 0.5, 3],
  [5, 1.5, 3],
];

function PreGame({ g }: { g: EightBall }) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-6 text-center">
      <div className="relative h-28 w-40 [@media(max-height:520px)]:hidden" aria-hidden>
        {RACK_ART.map(([id, col, row], i) => (
          <motion.span
            key={id}
            className="absolute"
            style={{ left: `calc(50% + ${col * 26}px - 13px)`, top: row * 23 }}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -40, scale: 0.4 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ ...spring.bouncy, delay: 0.1 + i * 0.05 }}
          >
            <MiniBall id={id} size={26} />
          </motion.span>
        ))}
      </div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.1 }}>
        <Eyebrow>{g.spectating ? "Watching" : g.async ? "Play anytime" : g.live ? "Live match" : "Practice"}</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          8-
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent">Ball</span>
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-ink-300">
          Pot your group — solids or stripes — then call your pocket and sink the 8.{" "}
          {g.async ? "Take your time: days per shot." : g.timed ? "60s per shot." : ""}
        </p>
      </motion.div>
      <motion.div className="flex items-center gap-3 text-sm" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ ...spring.bouncy, delay: 0.25 }}>
        {g.players.map(
          (p, seat) =>
            p && (
              <span key={p.id} className={cn("flex items-center gap-2 font-semibold", seat === 1 && "flex-row-reverse")}>
                <span className="max-w-28 truncate">{p.id === g.me?.id ? "You" : p.name}</span>
                <span className="text-[11px] font-normal text-ink-400">{seat === 0 ? "breaks" : ""}</span>
              </span>
            ),
        )}
      </motion.div>
      <p className="text-sm font-medium text-ink-200">
        {g.game.n > 0 ? "Picking up where you left off" : "Racking up"}
        <AnimatedDots />
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Game                                                                     */
/* ------------------------------------------------------------------------ */

function useSize() {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize((prev) => (prev.width === rect.width && prev.height === rect.height ? prev : { width: rect.width, height: rect.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, size] as const;
}

const FOUL_TEXT: Record<Foul, string> = {
  scratch: "Cue ball potted",
  no_hit: "No ball hit",
  wrong_ball: "Wrong ball first",
  no_rail: "No cushion after contact",
  weak_break: "Weak break",
  timeout: "Shot clock ran out",
};

const POCKET_NAMES = ["bottom-left corner", "bottom side", "bottom-right corner", "top-right corner", "top side", "top-left corner"];

function GameView({ g }: { g: EightBall }) {
  const reduced = useReducedMotion() ?? false;
  const [rootRef, root] = useSize();
  const audio = useMemo(() => new PoolAudio(), []);
  useEffect(() => () => audio.dispose(), [audio]);
  const { game, mySeat, myTurn, xapps } = g;
  const buzz = useCallback((style: "light" | "medium" | "heavy" | "success" | "error") => xapps.ui.haptic(style).catch(noop), [xapps]);

  /* --------------------------- shot controls --------------------------- */

  const ctl = useRef<Controls>({ angle: 0, power: 0, spin: { x: 0, y: 0 }, cue: null, cueOk: true, call: null });
  const [spin, setSpin] = useState<Vec>({ x: 0, y: 0 });
  const [call, setCall] = useState<number | null>(null);
  const [suggested, setSuggested] = useState<number | null>(null);
  const [kbPull, setKbPull] = useState(0);
  const [cueOk, setCueOk] = useState(true);
  const lastGoodCue = useRef<Vec | null>(null);

  const placing = myTurn ? game.bih : null;
  const calling = myTurn && mySeat !== null && needsCall(game, mySeat);

  // A new turn of ours: fresh controls, a sensible first aim, the cue ball in hand if we have it.
  const turnKey = myTurn ? game.n : -1;
  const [seenTurn, setSeenTurn] = useState(-1);
  if (turnKey !== seenTurn) {
    setSeenTurn(turnKey);
    if (turnKey >= 0) {
      setSpin({ x: 0, y: 0 });
      setCall(null);
      setSuggested(null);
      setKbPull(0);
      setCueOk(true);
    }
  }
  useEffect(() => {
    if (turnKey < 0 || mySeat === null) return;
    const c = ctl.current;
    c.power = 0;
    c.spin = { x: 0, y: 0 };
    c.call = null;
    c.cueOk = true;
    c.cue = game.bih ? defaultCueSpot(game) : null;
    lastGoodCue.current = c.cue;
    const cue = c.cue ?? game.balls[0];
    if (cue) c.angle = firstAim(game, mySeat, cue);
    g.sendAim({ angle: c.angle, power: 0, cue: c.cue, call: null }, true);
    // Only when a new turn of ours begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  const share = useCallback(() => {
    const c = ctl.current;
    g.sendAim({ angle: c.angle, power: c.power, cue: placing ? c.cue : null, call: c.call });
  }, [g, placing]);

  // Suggest the pocket the 8 is heading for, until the player taps one.
  useEffect(() => {
    if (!calling || call !== null) return;
    const id = setInterval(() => {
      const c = ctl.current;
      const cue = (placing && c.cue) || game.balls[0];
      const next = cue ? eightPocket(game, cue, c.angle) : null;
      c.call = next;
      setSuggested((s) => (s === next ? s : next));
    }, 120);
    return () => clearInterval(id);
  }, [calling, call, placing, game]);

  const onCall = useCallback(
    (pocket: number) => {
      setCall(pocket);
      ctl.current.call = pocket;
      audio.tick();
      buzz("light");
      share();
    },
    [audio, buzz, share],
  );

  const onCueDrop = useCallback(
    (p: Vec, final: boolean) => {
      const ok = checkCueSpot(game, p) === "ok";
      const c = ctl.current;
      if (final && !ok && lastGoodCue.current) {
        c.cue = lastGoodCue.current;
        c.cueOk = true;
        setCueOk(true);
        play("error");
        buzz("error");
        return;
      }
      c.cueOk = ok;
      if (ok) lastGoodCue.current = p;
      setCueOk((prev) => (prev === ok ? prev : ok));
      if (final) {
        audio.tick();
        buzz("light");
      }
      share();
    },
    [game, audio, buzz, share],
  );

  const onSpin = useCallback((next: Vec) => {
    setSpin(next);
    ctl.current.spin = next;
  }, []);

  const shootWith = useCallback(
    (power: number) => {
      const c = ctl.current;
      if (!myTurn || mySeat === null) {
        c.power = 0;
        return;
      }
      if (power < 0.03) {
        c.power = 0;
        share();
        return;
      }
      if (placing && !c.cueOk) {
        c.power = 0;
        play("error");
        xapps.ui.toast("The cue ball can't go there", "danger").catch(noop);
        return;
      }
      const res = g.shoot({
        angle: c.angle,
        power,
        spin: c.spin,
        cue: placing ? c.cue : null,
        call: calling ? (call ?? suggested) : null,
      });
      c.power = 0;
      setKbPull(0);
      if (res === "ok") {
        audio.resume();
        buzz(speedOf(power) > 4.5 ? "heavy" : "medium");
      } else if (res === "call-pocket") {
        play("error");
        xapps.ui.toast("Tap a pocket to call the 8", "danger").catch(noop);
      } else if (res === "bad-cue") {
        play("error");
        xapps.ui.toast("The cue ball can't go there", "danger").catch(noop);
      }
    },
    [myTurn, mySeat, placing, calling, call, suggested, g, audio, buzz, share, xapps],
  );

  const onPull = useCallback(
    (pull: number) => {
      ctl.current.power = pull;
      share();
    },
    [share],
  );

  // Keyboard: ←/→ aim (Shift = fine), ↑/↓ power, Space/Enter shoot.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !myTurn) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;
      const c = ctl.current;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = ((e.shiftKey ? 0.05 : 0.6) * Math.PI) / 180;
        c.angle += e.key === "ArrowLeft" ? step : -step;
        share();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(1, Math.max(0, c.power + (e.key === "ArrowDown" ? 0.05 : -0.05)));
        c.power = next;
        setKbPull(next);
        share();
      } else if ((e.key === " " || e.key === "Enter") && !e.repeat) {
        e.preventDefault();
        shootWith(c.power > 0.03 ? c.power : 0.45);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [myTurn, share, shootWith]);

  const onEvent = useCallback(
    (kind: EventKind, value: number) => {
      if (kind === "p") buzz("light");
      else if (kind === "b" && value > 350) buzz("light");
    },
    [buzz],
  );

  /* ------------------------------ banners ------------------------------ */

  const names: [string, string] = [nameOf(g, 0), nameOf(g, 1)];
  const banner = describe(g, names);
  const [hiddenBanner, setHiddenBanner] = useState("");
  const shownBanner = banner && banner.key !== hiddenBanner ? banner : null;
  const bannerKey = shownBanner?.key ?? "";
  const sticky = shownBanner?.tone === "win" || shownBanner?.tone === "lose";
  useEffect(() => {
    if (!bannerKey || sticky) return;
    const t = setTimeout(() => setHiddenBanner(bannerKey), 1_700);
    return () => clearTimeout(t);
  }, [bannerKey, sticky]);
  // Sound and haptics for the banner moments.
  useEffect(() => {
    if (!shownBanner) return;
    if (shownBanner.tone === "win") {
      play("win");
      buzz("success");
    } else if (shownBanner.tone === "lose") {
      play("lose");
      buzz("error");
    } else if (shownBanner.tone === "bad") {
      play("error");
      buzz("error");
    } else if (shownBanner.key.startsWith("turn")) {
      play("notify");
      buzz("medium");
    }
    // Once per banner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bannerKey]);

  /* ------------------------------- layout ------------------------------ */

  const portrait = root.width < 640 || root.height > root.width * 0.9;
  const header = portrait ? 56 : 64;
  const footer = portrait ? 92 : 58;
  const padX = portrait ? 10 : 20;
  const bar = 48;
  const gap = 8;
  const availW = Math.max(0, root.width - padX * 2 - bar - gap);
  const availH = Math.max(0, root.height - header - footer - 16);
  const aspect = portrait ? OUTER_W / OUTER_L : OUTER_L / OUTER_W; // width / height
  let tableW = Math.min(availW, availH * aspect);
  let tableH = tableW / aspect;
  if (!portrait && tableW > 1100) {
    tableW = 1100;
    tableH = tableW / aspect;
  }
  tableW = Math.floor(tableW);
  tableH = Math.floor(tableH);

  const resultFor = (seat: Seat): CardResult => (!g.reveal || !g.outcome ? null : g.outcome.winner === seat ? "win" : "lose");
  const card = (seat: Seat, mirror: boolean) => (
    <PlayerCard
      key={seat}
      player={g.players[seat]}
      isMe={seat === mySeat}
      active={g.playing && game.turn === seat}
      group={groupOf(game, seat)}
      balls={game.balls}
      onEight={onEight(game, seat)}
      result={resultFor(seat)}
      turnStartedAt={seat === mySeat ? g.turnStartedAt : null}
      timed={g.timed}
      deadline={g.deadline}
      online={seat === g.oppSeat && g.live && !g.spectating ? g.opponentOnline : undefined}
      mirror={mirror}
      reduced={reduced}
      compact={portrait && root.width < 400}
    />
  );

  const canControl = myTurn && !g.animating;
  // Pocket markers while the shooter (us, or the opponent we're watching) plays the 8.
  const showCall = !g.animating && g.playing && needsCall(game, game.turn) && (calling || g.otherAim !== null);

  return (
    <div ref={rootRef} className="relative flex w-full flex-1 select-none flex-col overflow-hidden">
      {root.width > 0 && (
        <LayoutGroup id="pool">
          <motion.div
            className="mx-auto flex w-full items-center gap-2 px-2.5 pt-2"
            style={{ height: header, maxWidth: portrait ? undefined : Math.max(560, tableW + bar + gap) }}
            initial={{ opacity: 0, y: -14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring.soft, delay: 0.05 }}
          >
            {card(g.viewSeat, false)}
            {card(g.oppSeat, true)}
          </motion.div>

          <div className="relative flex flex-1 items-center justify-center" style={{ gap, paddingLeft: padX, paddingRight: padX }}>
            <PowerBar length={tableH * (portrait ? 0.92 : 0.86)} enabled={canControl} onPull={onPull} onRelease={shootWith} reduced={reduced} keyboardPull={kbPull} />
            <motion.div
              className="relative"
              style={{ width: tableW, height: tableH }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={spring.soft}
            >
              {tableW > 60 && (
                <PoolTable
                  balls={game.balls}
                  playback={g.playback}
                  onPlaybackDone={g.onPlaybackDone}
                  ctl={ctl}
                  interactive={canControl}
                  placing={placing}
                  legal={g.legal}
                  needsCall={showCall}
                  other={g.otherAim}
                  audio={audio}
                  reduced={reduced}
                  portrait={portrait}
                  width={tableW}
                  height={tableH}
                  onAimChange={share}
                  onCall={onCall}
                  onCueDrop={onCueDrop}
                  onEvent={onEvent}
                />
              )}
              <Banner banner={shownBanner} reduced={reduced} />
            </motion.div>
          </div>

          <div
            className={cn("mx-auto flex w-full px-3 pb-2", portrait ? "flex-col gap-2" : "items-center gap-3")}
            style={{ height: footer, maxWidth: portrait ? undefined : Math.max(560, tableW + bar + gap) }}
          >
            <Hint g={g} placing={!!placing} cueOk={cueOk} calling={calling} call={call} suggested={suggested} />
            <div className={cn("flex items-center gap-3", portrait ? "w-full" : "w-[420px] shrink-0")}>
              <FineAim
                enabled={canControl}
                onNudge={(d) => {
                  ctl.current.angle += d;
                  share();
                }}
              />
              <SpinControl spin={spin} onChange={onSpin} enabled={canControl} />
            </div>
          </div>
        </LayoutGroup>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Hint line                                                                */
/* ------------------------------------------------------------------------ */

function Hint({
  g,
  placing,
  cueOk,
  calling,
  call,
  suggested,
}: {
  g: EightBall;
  placing: boolean;
  cueOk: boolean;
  calling: boolean;
  call: number | null;
  suggested: number | null;
}) {
  const opp = g.opponent;
  let key: string;
  let content: React.ReactNode;
  const last = g.game.last;
  const canReplay = !g.animating && g.settled && (g.myTurn || g.async) && !!last && last.kind === "shot" && last.seat !== g.mySeat && !g.reveal;
  if (g.reveal && g.outcome) {
    key = "final";
    content =
      g.result || (g.submitted && opp && !opp.isBot && opp.submitted) ? (
        <span className="text-ink-300">Final · {g.game.n} shots</span>
      ) : g.submitted && opp && !opp.isBot && !opp.submitted ? (
        <span className="text-ink-300">
          Waiting for <b className="text-ink-50">@{opp.handle}</b>
          <AnimatedDots />
        </span>
      ) : (
        <span className="text-ink-300">{g.game.n} shots</span>
      );
  } else if (g.unreadable) {
    key = "bad";
    content = <span className="text-ink-400">This table couldn&apos;t be loaded</span>;
  } else if (g.awaitingOpponent) {
    key = "awaiting";
    content = (
      <span className="flex items-center gap-2 text-ink-300">
        <Hourglass className="size-3.5 text-ink-400" aria-hidden />
        Waiting for <b className="text-ink-50">@{opp?.handle ?? "opponent"}</b> to accept
      </span>
    );
  } else if (g.animating) {
    key = "rolling";
    content = <span className="text-ink-400">Rolling…</span>;
  } else if (g.spectating) {
    key = `watch-${g.turnSeat}`;
    content = (
      <span className="flex items-center gap-2 text-ink-300">
        <Eye className="size-3.5" aria-hidden />
        Watching · <b className="text-ink-50">@{g.players[g.turnSeat]?.handle ?? "player"}</b> to shoot
      </span>
    );
  } else if (g.myTurn && placing) {
    key = `place-${cueOk}`;
    content = (
      <span className={cn("font-medium", cueOk ? "text-ink-200" : "text-danger")}>
        {cueOk ? `Ball in hand${g.game.bih === "kitchen" ? " (behind the line)" : ""} · drag the cue ball` : "Not there — it overlaps a ball"}
      </span>
    );
  } else if (g.myTurn && calling) {
    const which = call ?? suggested;
    key = `call-${which}-${call !== null}`;
    content = (
      <span className="text-ink-200">
        {which === null ? (
          <b className="text-[var(--accent-to)]">Tap a pocket to call the 8</b>
        ) : (
          <>
            8-ball → <b className="text-[#ffd65a]">{POCKET_NAMES[which]}</b>
            {call === null && <span className="text-ink-400"> · tap a pocket to change</span>}
          </>
        )}
      </span>
    );
  } else if (g.myTurn) {
    key = "aim";
    content = (
      <span className="flex items-center gap-2 text-ink-300">
        <motion.span
          className="shrink-0 rounded-full bg-[linear-gradient(110deg,var(--accent-from),var(--accent-to))] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-950"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={spring.bouncy}
        >
          Your shot
        </motion.span>
        <span className="truncate">Drag to aim · pull the cue down to shoot</span>
      </span>
    );
  } else if (g.opponentTurn && g.async) {
    key = "their-shot";
    content = (
      <span className="flex items-center gap-2 text-ink-300">
        <Hourglass className="size-3.5 text-ink-400" aria-hidden />
        <span>
          <b className="text-ink-50">@{opp?.handle ?? "opponent"}</b>&apos;s shot · we&apos;ll tell you when it&apos;s yours
        </span>
      </span>
    );
  } else if (g.opponentTurn) {
    key = "opp";
    content = (
      <span className="text-ink-400">
        {g.live && !g.opponentOnline ? `@${opp?.handle ?? "opponent"} disconnected — waiting` : `@${opp?.handle ?? "opponent"} is lining up`}
        <AnimatedDots />
      </span>
    );
  } else {
    key = "idle";
    content = <span className="text-ink-400">…</span>;
  }
  return (
    <div className="flex min-h-7 min-w-0 flex-1 items-center justify-center gap-2 text-xs sm:text-sm" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          className="min-w-0 truncate"
          initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          transition={{ ...spring.snappy, filter: { duration: 0.2 } }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
      {canReplay && (
        <button
          type="button"
          onClick={g.replayLast}
          className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2.5 py-1 text-[11px] font-semibold text-ink-100 ring-1 ring-white/10 hover:bg-white/[0.12]"
        >
          <RotateCcw className="size-3" aria-hidden /> Replay
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

function nameOf(g: EightBall, seat: Seat): string {
  if (seat === g.mySeat) return "You";
  return g.players[seat]?.name ?? "Opponent";
}

const REASON_TEXT: Record<string, string> = {
  eight: "8-ball in the called pocket",
  golden_break: "The 8 on the break!",
  early_eight: "The 8 went down early",
  scratch_eight: "Scratched on the 8",
  foul_eight: "Foul on the 8",
  wrong_pocket: "The 8 found the wrong pocket",
  abandon: "Opponent left the table",
};

/** The banner for the shot that just finished playing (or the result). */
function describe(g: EightBall, names: [string, string]): BannerInfo | null {
  if (!g.started || g.animating) return null;
  const { game, mySeat } = g;
  if (g.outcome) {
    const won = mySeat === null || g.outcome.winner === mySeat;
    const title = mySeat === null ? `${names[g.outcome.winner]} wins` : won ? "You win!" : `${names[g.outcome.winner]} wins`;
    // A loss by an 8-ball mistake: say whose mistake it was.
    const loser = other(g.outcome.winner);
    const blame = g.outcome.reason !== "eight" && g.outcome.reason !== "golden_break" && g.outcome.reason !== "abandon" && loser !== mySeat;
    const sub = blame ? `${names[loser]}: ${REASON_TEXT[g.outcome.reason]?.toLowerCase()}` : REASON_TEXT[g.outcome.reason];
    return { key: `end-${g.outcome.reason}`, title, sub, tone: won ? "win" : "lose" };
  }
  const last = game.last;
  if (!last || last.n !== game.n - 1 || g.shownN < game.n) return null;
  const out = last.out;
  const shooter = names[last.seat];
  const next = game.turn;
  const nextIsMe = next === mySeat;
  if (out.foul) {
    const hand = nextIsMe ? "Ball in hand" : `${names[next]} has ball in hand`;
    return {
      key: `foul-${game.n}`,
      title: out.foul === "scratch" ? "Scratch!" : out.foul === "timeout" ? "Time!" : "Foul",
      sub: `${out.foul === "scratch" ? "" : `${FOUL_TEXT[out.foul]} · `}${hand}`,
      tone: last.seat === mySeat ? "bad" : "info",
    };
  }
  if (out.assigned !== null) {
    const group = (seat: Seat) => (out.assigned === seat ? "solids" : "stripes");
    const title = mySeat === null ? `${shooter}: ${group(last.seat)}` : `You're ${group(mySeat)}`;
    return { key: `assign-${game.n}`, title, sub: mySeat === null ? undefined : `${names[other(mySeat)]}: ${group(other(mySeat))}`, tone: "good" };
  }
  if (out.respotted) return { key: `spot-${game.n}`, title: "8 re-spotted", tone: "info" };
  if (out.cont && game.run >= 3) return { key: `run-${game.n}`, title: `${game.run} in a row!`, sub: last.seat === mySeat ? undefined : shooter, tone: "good" };
  if (out.brk && out.potted.length > 0 && out.cont) return { key: `break-${game.n}`, title: "Great break!", sub: `${out.potted.length} down`, tone: "good" };
  if (out.banked.length > 0 && out.cont) return { key: `bank-${game.n}`, title: "Bank shot!", tone: "good" };
  if (nextIsMe && last.seat !== mySeat) return { key: `turn-${game.n}`, title: "Your shot", tone: "info" };
  return null;
}

function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** A first aim for a new turn: the easiest pot, else the nearest legal ball, else the rack. */
function firstAim(game: Game, seat: Seat, cue: Vec): number {
  const legal = game.balls
    .map((b, id) => (b && id > 0 ? id : -1))
    .filter((id) => id > 0 && (!game.broken || isLegal(game, seat, id)));
  const best = game.broken ? potCandidates(game.balls, cue, legal)[0] : undefined;
  if (best) return best.angle;
  let target: Vec | null = null;
  let bestD = Infinity;
  for (const id of legal) {
    const b = game.balls[id] as Vec;
    const d = game.broken ? Math.hypot(b.x - cue.x, b.y - cue.y) : b.x; // the break: the head ball
    if (d < bestD) {
      bestD = d;
      target = b;
    }
  }
  return target ? Math.atan2(target.y - cue.y, target.x - cue.x) : 0;
}

function isLegal(game: Game, seat: Seat, id: number): boolean {
  const g = groupOf(game, seat);
  if (onEight(game, seat)) return id === 8;
  if (g === null) return id !== 8;
  return g === "solids" ? id < 8 : id > 8;
}

/** Which pocket the 8 is heading for on the current aim (null if it isn't going in). */
function eightPocket(game: Game, cue: Vec, angle: number): number | null {
  const balls = game.balls.slice();
  balls[0] = cue;
  const hit = predictAim(balls, cue, angle);
  if (!hit || hit.kind !== "ball" || hit.id !== 8) return null;
  const eight = balls[8] as Vec;
  const rest = balls.slice();
  rest[8] = null;
  rest[0] = hit.ghost;
  const path = predictAim(rest, eight, Math.atan2(hit.objectDir.y, hit.objectDir.x));
  if (path?.kind === "pocket") return path.pocket;
  // Close to a pocket even if the ray clips a jaw first.
  if (path) {
    const end = path.kind === "ball" ? path.ghost : path.at;
    for (const pk of POCKETS) if (Math.hypot(pk.x - end.x, pk.y - end.y) < 0.1) return pk.id;
  }
  return null;
}
