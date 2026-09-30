"use client";

/**
 * Cup Pong root: the pre-game (with a bot difficulty picker in practice), then
 * the 3D table with its HUD — both players' racks, balls left this turn, fire,
 * the re-rack token, the power gauge, banners for every big moment, and the
 * re-rack sheet. Loaded with next/dynamic from the embed page only, so
 * three.js never touches the marketplace bundles.
 */

import type { PlayerInfo } from "@xapps/sdk";
import { useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { play } from "@/lib/sfx";
import { cn } from "@/lib/utils";
import { AnimatedDots, Eyebrow } from "../shared/ui";
import { TableAudio } from "./audio";
import { FORMATION_LABEL, formationSlots, openingRack, other, type Cup, type Formation, type Seat } from "./geometry";
import { BALLS_PER_TURN, DIFFICULTIES, THROW_MS, isDifficulty, type Difficulty } from "./logic";
import { PowerGauge, Stage, usePowerValue, type Banner } from "./stage";
import { useCupPong, type CupPong } from "./use-game";

const noop = () => {};
const DIFFICULTY_KEY = "cup-pong:difficulty";
const DIFFICULTY_LABEL: Record<Difficulty, { name: string; blurb: string }> = {
  easy: { name: "Easy", blurb: "Misses plenty. Arc guide always on." },
  medium: { name: "Medium", blurb: "A solid bar regular." },
  hard: { name: "Hard", blurb: "Rarely misses the front cup." },
};

function loadDifficulty(): Difficulty {
  try {
    const v = window.localStorage.getItem(DIFFICULTY_KEY);
    if (isDifficulty(v)) return v;
  } catch {
    // storage blocked
  }
  return "medium";
}

export function CupPongApp() {
  const xapps = useXApps();
  const [difficulty, setDifficulty] = useState<Difficulty>(() => (typeof window === "undefined" ? "medium" : loadDifficulty()));
  const game = useCupPong(difficulty);

  const practice = game.isBotGame && (game.mode === "practice" || game.mode === "sandbox");
  const resumed = game.log.length > 0;
  const readied = useRef(false);
  const ready = useCallback(() => {
    if (readied.current) return;
    readied.current = true;
    xapps.ready().catch(noop);
  }, [xapps]);

  // Live and async games (and resumed practice) don't wait on a picker.
  useEffect(() => {
    if (!practice || resumed || game.spectating) ready();
  }, [practice, resumed, game.spectating, ready]);

  const pick = (d: Difficulty) => {
    setDifficulty(d);
    try {
      window.localStorage.setItem(DIFFICULTY_KEY, d);
    } catch {
      // storage blocked
    }
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <AnimatePresence mode="wait" initial={false}>
        {game.started ? (
          <motion.div key="game" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            <GameView g={game} difficulty={difficulty} />
          </motion.div>
        ) : (
          <motion.div
            key="pregame"
            className="absolute inset-0 flex"
            exit={{ opacity: 0, scale: 0.96, filter: "blur(6px)" }}
            transition={{ duration: 0.25 }}
          >
            <PreGame g={game} practice={practice && !resumed && !game.spectating} difficulty={difficulty} onDifficulty={pick} onStart={ready} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Pre-game                                                                 */
/* ------------------------------------------------------------------------ */

function PreGame({
  g,
  practice,
  difficulty,
  onDifficulty,
  onStart,
}: {
  g: CupPong;
  practice: boolean;
  difficulty: Difficulty;
  onDifficulty: (d: Difficulty) => void;
  onStart: () => void;
}) {
  const [starting, setStarting] = useState(false);
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-6 text-center">
      <CupsHero />
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring.soft, delay: 0.1 }}>
        <Eyebrow>{g.spectating ? "Watching" : g.async ? "Play anytime" : g.live ? "Live match" : "Practice"}</Eyebrow>
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
          Cup{" "}
          <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text pr-1 text-transparent">Pong</span>
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-ink-300">
          Flick up to throw: speed sets the distance, lean sets the aim. Two balls a turn — clear their ten cups first.
        </p>
      </motion.div>

      <motion.div
        className="flex items-center gap-4"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ ...spring.bouncy, delay: 0.2 }}
      >
        {g.players.map(
          (p, seat) =>
            p && (
              <div key={p.id} className={cn("flex items-center gap-2", seat === 1 && "flex-row-reverse")}>
                <Avatar person={p} size={44} />
                <div className={cn("text-left", seat === 1 && "text-right")}>
                  <p className="max-w-24 truncate text-sm font-semibold">{seat === g.mySeat ? "You" : p.name}</p>
                  <p className="text-[11px] text-ink-400">{seat === 0 ? "throws first" : "10 cups"}</p>
                </div>
              </div>
            ),
        )}
      </motion.div>

      {practice ? (
        <motion.div
          className="flex w-full flex-col items-center gap-4"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring.soft, delay: 0.3 }}
        >
          <div role="radiogroup" aria-label="Bot difficulty" className="glass flex w-full max-w-xs rounded-full p-1">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={difficulty === d}
                onClick={() => {
                  play("tick");
                  onDifficulty(d);
                }}
                className={cn(
                  "relative flex-1 rounded-full py-2 text-sm font-semibold transition-colors",
                  difficulty === d ? "text-ink-950" : "text-ink-300 hover:text-ink-50",
                )}
              >
                {difficulty === d && (
                  <motion.span
                    layoutId="cup-pong-difficulty"
                    className="absolute inset-0 rounded-full bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))]"
                    transition={spring.layout}
                  />
                )}
                <span className="relative">{DIFFICULTY_LABEL[d].name}</span>
              </button>
            ))}
          </div>
          <p className="-mt-2 text-xs text-ink-400">{DIFFICULTY_LABEL[difficulty].blurb}</p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={spring.snappy}
            disabled={starting}
            onClick={() => {
              setStarting(true);
              play("pop");
              onStart();
            }}
            className="rounded-full bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] px-8 py-3 font-display text-lg font-extrabold text-ink-950 shadow-[0_10px_30px_-10px_var(--accent-from)] disabled:opacity-70"
          >
            {starting ? "Racking…" : "Rack ’em up"}
          </motion.button>
        </motion.div>
      ) : (
        <p className="text-sm font-medium text-ink-200">
          {g.log.length > 0 ? "Picking up where you left off" : "Racking the cups"}
          <AnimatedDots />
        </p>
      )}
    </div>
  );
}

/** Three cups and a ball hopping between them. */
function CupsHero() {
  const reduced = useReducedMotion() ?? false;
  return (
    <svg viewBox="0 0 240 120" className="h-24 w-auto overflow-visible [@media(max-height:560px)]:hidden" aria-hidden>
      <defs>
        <linearGradient id="cp-cup" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a50f1f" />
          <stop offset="0.45" stopColor="#ff3b4f" />
          <stop offset="1" stopColor="#b3121f" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="112" rx="110" ry="6" fill="#000" opacity="0.35" />
      {[50, 120, 190].map((x, i) => (
        <motion.g
          key={x}
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ ...spring.bouncy, delay: 0.1 + i * 0.1 }}
        >
          <path d={`M${x - 26} 52 L${x + 26} 52 L${x + 18} 108 L${x - 18} 108 Z`} fill="url(#cp-cup)" />
          <ellipse cx={x} cy="52" rx="27" ry="7" fill="#f7f3ee" />
          <ellipse cx={x} cy="53" rx="22" ry="5" fill="#43b6ff" />
          <path d={`M${x - 23} 70 L${x + 23} 70`} stroke="#fff" strokeOpacity="0.25" strokeWidth="1.5" />
        </motion.g>
      ))}
      <motion.circle
        r="8"
        fill="#fbf8f1"
        initial={{ cx: 20, cy: 20 }}
        animate={reduced ? { cx: 120, cy: 38 } : { cx: [20, 50, 85, 120, 155, 190, 120], cy: [20, 40, 6, 40, 6, 40, 40] }}
        transition={reduced ? { duration: 0 } : { duration: 2.6, repeat: Infinity, repeatDelay: 0.6, ease: "easeInOut" }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------------ */
/* Game                                                                     */
/* ------------------------------------------------------------------------ */

function GameView({ g, difficulty }: { g: CupPong; difficulty: Difficulty }) {
  const reduced = useReducedMotion() ?? false;
  const [audio] = useState(() => new TableAudio());
  useEffect(() => () => audio.dispose(), [audio]);
  const power = usePowerValue();

  const [banner, setBanner] = useState<Banner | null>(null);
  const bannerKey = useRef(0);
  const showBanner = useCallback((b: Omit<Banner, "key">) => {
    bannerKey.current += 1;
    setBanner({ ...b, key: bannerKey.current });
  }, []);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner((cur) => (cur?.key === banner.key ? null : cur)), banner.tone === "win" ? 2600 : 1500);
    return () => clearTimeout(t);
  }, [banner]);

  // Remember where your last throw's power landed on the gauge (a learning aid).
  const lastPower = useMemo(() => {
    for (let i = g.log.length - 1; i >= 0; i--) {
      const a = g.log[i]!;
      if (a.k === "t" && g.mySeat !== null && a.by === g.seats[g.mySeat] && (a.f & 4) === 0) return a.p;
    }
    return null;
  }, [g.log, g.seats, g.mySeat]);

  const [rerackOpen, setRerackOpen] = useState(false);
  const canRerack = g.rerackNow.length > 0;
  const sheetOpen = rerackOpen && canRerack;

  const { shownGame, mySeat, players } = g;
  const leftSeat: Seat = mySeat ?? 0;
  const rightSeat: Seat = other(leftSeat);
  const actorSeat = g.shown < g.log.length ? (g.log[g.shown]!.by === g.seats[1] ? 1 : 0) : g.actor;

  return (
    <div className="relative h-full w-full">
      <Stage g={g} audio={audio} onBanner={showBanner} power={power} className="absolute inset-0" />

      {/* Top: both players and their racks. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <PlayerPill g={g} seat={leftSeat} active={!shownGame.over && actorSeat === leftSeat} align="left" />
        <PlayerPill g={g} seat={rightSeat} active={!shownGame.over && actorSeat === rightSeat} align="right" />
      </div>

      {/* Balls left this turn + fire. */}
      <div className="pointer-events-none absolute inset-x-0 top-[5.4rem] flex justify-center">
        <AnimatePresence>
          {g.playing && !shownGame.over && (
            <motion.div
              key={`${actorSeat}`}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={spring.soft}
              className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              <span className="text-ink-300">{actorSeat === mySeat ? "Your balls" : `${nameOf(players[actorSeat])}`}</span>
              <span className="flex gap-1">
                {Array.from({ length: BALLS_PER_TURN }).map((_, i) => {
                  const left = i >= shownGame.ball && shownGame.turn === actorSeat;
                  return (
                    <motion.span
                      key={i}
                      animate={{ scale: left ? 1 : 0.7, opacity: left ? 1 : 0.25 }}
                      transition={spring.bouncy}
                      className={cn("size-3 rounded-full", shownGame.fire[actorSeat] ? "bg-[#ff7a1a] shadow-[0_0_8px_#ff7a1a]" : "bg-[#fbf8f1]")}
                    />
                  );
                })}
              </span>
              {shownGame.fire[actorSeat] && (
                <motion.span animate={reduced ? undefined : { scale: [1, 1.2, 1] }} transition={{ duration: 0.6, repeat: Infinity }}>
                  🔥
                </motion.span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Hints under the balls pill, where your eyes are (on the cups). */}
      <div className="pointer-events-none absolute inset-x-0 top-[8.2rem] flex justify-center px-4">
        <Hint g={g} />
      </div>

      {/* Banner. */}
      <div className="pointer-events-none absolute inset-x-0 top-[30%] flex justify-center px-6">
        <AnimatePresence mode="popLayout">
          {banner && <BannerView key={banner.key} banner={banner} reduced={reduced} />}
        </AnimatePresence>
      </div>

      {/* Power gauge (your throws). */}
      <AnimatePresence>
        {g.myThrow && (
          <motion.div
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={spring.soft}
          >
            <PowerGauge power={power} last={lastPower} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom: hints, re-rack, clock. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 p-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <BottomBar g={g} difficulty={difficulty} canRerack={canRerack} onRerack={() => setRerackOpen(true)} />
      </div>

      <AnimatePresence>
        {sheetOpen && mySeat !== null && (
          <RerackSheet
            options={g.rerackNow}
            count={shownGame.racks[other(mySeat)].length}
            onPick={(f) => {
              setRerackOpen(false);
              play("pop");
              g.callRerack(f);
            }}
            onClose={() => setRerackOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const nameOf = (p: PlayerInfo | undefined) => (p ? (p.isBot ? p.name : `@${p.handle}`) : "Player");

function PlayerPill({ g, seat, active, align }: { g: CupPong; seat: Seat; active: boolean; align: "left" | "right" }) {
  const p = g.players[seat];
  const cups = g.shownGame.racks[seat];
  const fire = g.shownGame.fire[seat];
  const rerackUsed = g.shownGame.stats[seat].rerackUsed;
  const me = seat === g.mySeat;
  return (
    <motion.div
      data-seat={seat}
      data-cups={cups.length}
      data-me={me || undefined}
      animate={{ scale: active ? 1 : 0.94, opacity: active ? 1 : 0.8 }}
      transition={spring.snappy}
      className={cn(
        "glass flex min-w-0 max-w-[48%] items-center gap-2 rounded-2xl p-1.5 pr-2.5",
        align === "right" && "flex-row-reverse pl-2.5 pr-1.5",
        active && "ring-2 ring-[var(--accent-from)]/70",
      )}
    >
      <div className="relative shrink-0">
        {p && <Avatar person={p} size={34} />}
        {fire && <span className="absolute -bottom-1 -right-1 text-sm">🔥</span>}
      </div>
      <div className={cn("min-w-0", align === "right" && "text-right")}>
        <p className="truncate text-xs font-bold leading-tight">{me ? "You" : nameOf(p)}</p>
        <div className={cn("mt-0.5 flex items-center gap-1.5", align === "right" && "flex-row-reverse")}>
          <MiniRack cups={cups} />
          <span className="font-mono text-[11px] font-bold tabular text-ink-200">{cups.length}</span>
          <span
            title={rerackUsed ? "Re-rack used" : "Re-rack available"}
            className={cn("text-[10px]", rerackUsed ? "opacity-25 grayscale" : "opacity-90")}
            aria-label={rerackUsed ? "Re-rack used" : "Re-rack available"}
          >
            🔺
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/** A seat's rack from above (the opening triangle, sunk cups faded). */
function MiniRack({ cups }: { cups: readonly Cup[] }) {
  const all = useMemo(() => openingRack(), []);
  const alive = new Set(cups.map((c) => c.id));
  const positions = cups.length > 0 && cups.some((c) => !all.find((o) => o.id === c.id && o.u === c.u && o.v === c.v)) ? cups : all;
  const pts = positions.map((c) => ({ id: c.id, x: c.u, y: c.v }));
  const minX = -0.16;
  const maxX = 0.16;
  const maxY = 0.62;
  return (
    <svg viewBox="0 0 44 30" className="h-4 w-6" aria-hidden>
      {pts.map((c) => (
        <circle
          key={c.id}
          cx={2 + ((c.x - minX) / (maxX - minX)) * 40}
          cy={2 + (c.y / maxY) * 26}
          r="3.6"
          fill={alive.has(c.id) ? "#ff3b4f" : "rgb(255 255 255 / 0.15)"}
        />
      ))}
    </svg>
  );
}

function BannerView({ banner, reduced }: { banner: Banner; reduced: boolean }) {
  const tone = {
    turn: "from-white/15 to-white/5 text-ink-50",
    good: "from-[#ffd23d]/30 to-[#ff3b4f]/20 text-white",
    fire: "from-[#ff7a1a]/45 to-[#ff3b4f]/35 text-white",
    bad: "from-white/10 to-white/5 text-ink-100",
    win: "from-[var(--accent-from)]/45 to-[var(--accent-to)]/35 text-white",
    info: "from-[#43b6ff]/30 to-white/5 text-white",
  }[banner.tone];
  return (
    <motion.div
      layout
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6, y: 20, rotate: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -16 }}
      transition={spring.bouncy}
      className={cn("rounded-3xl bg-gradient-to-br px-6 py-3 text-center shadow-2xl ring-1 ring-white/15 backdrop-blur-md", tone)}
    >
      <p className={cn("font-display font-extrabold tracking-tight", banner.tone === "win" ? "text-4xl" : "text-3xl")}>{banner.title}</p>
      {banner.sub && <p className="mt-0.5 text-sm font-medium opacity-85">{banner.sub}</p>}
    </motion.div>
  );
}

function Hint({ g }: { g: CupPong }) {
  const first = g.mySeat !== null && g.shownGame.stats[g.mySeat].throws === 0;
  let hint: string | null = null;
  if (g.myPick) hint = "Tap one of their cups to take it";
  else if (g.myThrow) hint = first ? "Flick up · faster goes further · lean to aim" : null;
  else if (g.async && g.playing && g.actor !== g.mySeat && g.caughtUp) hint = `Waiting for ${nameOf(g.players[g.actor])}'s throw`;
  else if (g.spectating) hint = "Watching";
  return (
    <AnimatePresence>
      {hint && (
        <motion.p
          key={hint}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={spring.soft}
          className="glass rounded-full px-4 py-2 text-center text-xs font-semibold text-ink-100"
        >
          {hint}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

function BottomBar({ g, difficulty, canRerack, onRerack }: { g: CupPong; difficulty: Difficulty; canRerack: boolean; onRerack: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const first = g.mySeat !== null && g.shownGame.stats[g.mySeat].throws === 0;
  return (
    <>
      {g.myThrow && first && !reduced && (
        <motion.div
          aria-hidden
          className="absolute bottom-[14%] left-1/2 ml-12 text-3xl"
          animate={{ y: [24, -40, 24], opacity: [0, 1, 0] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
        >
          👆
        </motion.div>
      )}
      <div className="pointer-events-auto flex w-full items-end justify-between gap-2">
        <div className="min-w-[5.5rem]">
          <AnimatePresence>
            {canRerack && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileTap={{ scale: 0.92 }}
                transition={spring.bouncy}
                onClick={() => {
                  play("tick");
                  onRerack();
                }}
                className="glass flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold ring-1 ring-[var(--accent-to)]/60"
              >
                <span>🔺</span> Re-rack
              </motion.button>
            )}
          </AnimatePresence>
        </div>
        {g.timed && g.idle && <BallClock since={g.idleSince} mine={g.actor === g.mySeat} />}
        <div className="min-w-[5.5rem] text-right">
          {g.isBotGame && (
            <span className="glass rounded-full px-3 py-1.5 text-[11px] font-semibold text-ink-300">Bot · {DIFFICULTY_LABEL[difficulty].name}</span>
          )}
        </div>
      </div>
    </>
  );
}

/** Seconds left on the current ball (live games). */
function BallClock({ since, mine }: { since: number; mine: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, THROW_MS - (now - since));
  const danger = left < 6_000;
  return (
    <span className={cn("glass rounded-full px-3 py-1.5 font-mono text-xs font-bold tabular", danger && mine ? "text-danger" : "text-ink-200")}>
      0:{String(Math.ceil(left / 1000)).padStart(2, "0")}
    </span>
  );
}

function RerackSheet({
  options,
  count,
  onPick,
  onClose,
}: {
  options: readonly Formation[];
  count: number;
  onPick: (f: Formation) => void;
  onClose: () => void;
}) {
  return (
    <motion.div className="absolute inset-0 z-10 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <button type="button" aria-label="Keep the cups as they are" className="absolute inset-0 bg-ink-950/60" onClick={onClose} />
      <motion.div
        role="dialog"
        aria-label="Re-rack their cups"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={spring.soft}
        className="glass relative w-full max-w-md rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      >
        <p className="font-display text-xl font-extrabold">Re-rack their {count} cups</p>
        <p className="mt-1 text-sm text-ink-300">One re-rack per game. Pick a shape — tighter racks catch more near misses.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {options.map((f) => (
            <motion.button
              key={f}
              type="button"
              whileTap={{ scale: 0.94 }}
              transition={spring.snappy}
              onClick={() => onPick(f)}
              className="flex flex-col items-center gap-2 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 hover:bg-white/10"
            >
              <FormationIcon formation={f} count={count} />
              <span className="text-xs font-bold">{FORMATION_LABEL[f]}</span>
            </motion.button>
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-4 w-full rounded-full py-2.5 text-sm font-semibold text-ink-300 hover:text-ink-50">
          Keep them as they are
        </button>
      </motion.div>
    </motion.div>
  );
}

function FormationIcon({ formation, count }: { formation: Formation; count: number }) {
  const slots = formationSlots(formation, count) ?? [];
  const maxV = Math.max(0.3, ...slots.map((s) => s.v));
  return (
    <svg viewBox="-30 -6 60 70" className="h-14 w-12" aria-hidden>
      {slots.map((s, i) => (
        <circle key={i} cx={(s.u / 0.1) * 10} cy={(s.v / maxV) * 52 + 2} r="5.4" fill="#ff3b4f" stroke="#fff" strokeWidth="1.2" />
      ))}
    </svg>
  );
}
