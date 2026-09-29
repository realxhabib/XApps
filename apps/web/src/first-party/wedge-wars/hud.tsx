"use client";

/**
 * The in-match HUD (DOM, over the canvas): player cards with hull + armor
 * bars, the round clock, KO feed, weapon cooldown ring + boost meter, big
 * callouts, the controls hint, the pause/quality menu, spectator controls,
 * and the imperative overlay pools the runtime animates every frame (damage
 * numbers, off-screen arrows, speed lines, damage vignette).
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpFromLine, ChevronRight, Disc3, Eye, Flame, Hammer, Pause, Play, Skull, Volume2, VolumeX, Zap } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { isSoundEnabled, onSoundChange, setSoundEnabled } from "@/lib/sfx";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WedgeLoading } from "./loading";
import { HP_MAX, WEAPONS, formatClock, ordinal, type WeaponKind } from "./logic";
import type { QualityPref, Tier } from "./quality";
import type { MatchRuntime } from "./runtime";
import type { HudSnapshot, HudTruck } from "./world";

export const WEAPON_ICON: Record<WeaponKind, typeof Disc3> = {
  spinner: Disc3,
  flipper: ArrowUpFromLine,
  hammer: Hammer,
  flamer: Flame,
};

export function useHud(rt: MatchRuntime): HudSnapshot {
  return useSyncExternalStore(rt.world.subscribe, rt.world.hud, rt.world.hud);
}

function useSound(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (notify) => onSoundChange(() => notify()),
    () => isSoundEnabled(),
    () => true,
  );
  return [on, setSoundEnabled];
}

const NUMBER_POOL = 14;

export function Hud({
  rt,
  touch,
  pref,
  tier,
  onPref,
}: {
  rt: MatchRuntime;
  touch: boolean;
  pref: QualityPref;
  tier: Tier;
  onPref: (pref: QualityPref) => void;
}) {
  const hud = useHud(rt);
  const reduce = useReducedMotion();
  const [menu, setMenu] = useState(false);
  const [hintGone, setHintGone] = useState(false);

  // Escape / P / Start toggle the menu.
  useEffect(() => rt.input.onPause(() => setMenu((m) => !m)), [rt]);
  useEffect(() => {
    rt.setPaused(menu);
  }, [menu, rt]);
  // Hide the controls hint after a while (or once they drive, checked on HUD ticks).
  useEffect(() => {
    const id = setTimeout(() => setHintGone(true), 9000);
    return () => clearTimeout(id);
  }, []);
  const showHint = !hintGone && hud.phase === "fight" && !!hud.me && !rt.input.touched;

  const me = hud.me;
  const watching = hud.watching ? hud.trucks.find((t) => t.id === hud.watching) : undefined;
  const spectating = !me || !me.alive;
  const low = hud.remainingMs < 30_000 && hud.phase === "fight";

  if (!hud.ready) {
    return (
      <div className="absolute inset-0 flex bg-ink-950">
        <WedgeLoading label="Rolling out" />
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden text-ink-50">
      <OverlayPools rt={rt} trucks={hud.trucks} />

      {/* Top bar */}
      <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))] sm:px-4">
        <div className="hidden w-60 flex-col gap-1.5 sm:flex">
          {hud.trucks.map((t) => (
            <PlayerCard key={t.id} t={t} />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:flex-none">
          <motion.div
            className={cn(
              "glass-strong rounded-2xl px-4 py-1.5 font-mono text-2xl font-bold tabular tracking-tight shadow-[0_10px_30px_-12px_rgb(0_0_0/0.8)]",
              low && "text-danger",
            )}
            animate={low && !reduce ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={low ? { duration: 1, repeat: Infinity } : spring.snappy}
            aria-label="Time left"
          >
            {formatClock(hud.remainingMs)}
          </motion.div>
          <div className="grid w-full max-w-md grid-cols-2 gap-1 sm:hidden">
            {hud.trucks.map((t) => (
              <PlayerCard key={t.id} t={t} compact />
            ))}
          </div>
        </div>
        <div className="flex w-auto flex-col items-end gap-2 sm:w-60">
          <button
            type="button"
            onClick={() => setMenu(true)}
            className="pointer-events-auto flex size-10 items-center justify-center rounded-full glass-strong transition hover:bg-white/10"
            aria-label="Pause menu"
          >
            <Pause className="size-4" />
          </button>
          <KoFeed hud={hud} />
        </div>
      </div>

      {/* Callouts */}
      <Callout hud={hud} reduce={!!reduce} />

      {/* Flipped */}
      <AnimatePresence>
        {me?.alive && me.flipped && hud.phase === "fight" && (
          <motion.div
            key="flip"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-0 top-[38%] flex justify-center"
          >
            <div className="glass-strong rounded-full px-4 py-2 text-sm font-semibold">
              {me.selfRightReady ? (touch ? "Flipped! Tap ⟲ to self-right" : "Flipped! Press R to self-right") : "Self-right recharging…"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Weapon + boost (desktop) */}
      {me && me.alive && !touch && (
        <div className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 flex items-end gap-3">
          <BoostMeter value={me.boost} />
          <WeaponRing weapon={me.weapon as WeaponKind} cooldown={me.cooldown} ready={me.weaponReady} size={84} />
        </div>
      )}

      {/* Spectating */}
      {spectating && hud.phase === "fight" && (
        <div className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center">
          <div className="glass-strong pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pl-3 pr-1.5 text-sm">
            <Eye className="size-4 text-ink-300" />
            <span className="text-ink-300">{me ? "Wrecked · watching" : "Watching"}</span>
            <b className="max-w-32 truncate">{watching ? nameOf(watching) : "TV cam"}</b>
            <button
              type="button"
              onClick={() => rt.watchNext()}
              className="ml-1 flex items-center gap-0.5 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/15"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Controls hint */}
      <AnimatePresence>
        {showHint && (
          <motion.div
            key="hint"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0, transition: { ...spring.soft, delay: 0.6 } }}
            exit={{ opacity: 0, y: 8 }}
            className={cn("absolute inset-x-0 flex justify-center px-4", touch ? "top-[30%]" : "bottom-28")}
          >
            <div className="glass-strong max-w-md rounded-2xl px-4 py-3 text-center text-xs leading-relaxed text-ink-200 sm:text-sm">
              {touch ? (
                <>
                  <b className="text-ink-50">Left thumb</b> drives · <b className="text-ink-50">big button</b> fires your{" "}
                  {WEAPONS[(me?.weapon as WeaponKind) ?? "spinner"].name.toLowerCase()} · <b className="text-ink-50">⚡</b> boosts
                </>
              ) : (
                <>
                  <Key>W A S D</Key> drive · <Key>Space</Key> {WEAPONS[(me?.weapon as WeaponKind) ?? "spinner"].name.toLowerCase()} ·{" "}
                  <Key>Shift</Key> boost · <Key>R</Key> self-right · <Key>Esc</Key> menu
                </>
              )}
              <p className="mt-1 text-[11px] text-ink-400">Ram nose-first · knock rivals into the glowing pit</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Final standings (the host's results screen follows) */}
      <AnimatePresence>{hud.results && <Results hud={hud} />}</AnimatePresence>

      {/* Menu */}
      <AnimatePresence>
        {menu && (
          <PauseMenu
            key="menu"
            canPause={rt.canPause}
            pref={pref}
            tier={tier}
            onPref={onPref}
            onClose={() => setMenu(false)}
            touch={touch}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function nameOf(t: { isMe: boolean; isBot: boolean; name: string; handle: string }): string {
  return t.isMe ? "You" : t.isBot ? t.name : `@${t.handle}`;
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded-md border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[11px] text-ink-50">{children}</kbd>;
}

function PlayerCard({ t, compact = false }: { t: HudTruck; compact?: boolean }) {
  const hp = Math.max(0, t.hp) / HP_MAX;
  const armor = t.armorMax > 0 ? Math.max(0, t.armor) / t.armorMax : 0;
  const hpColor = hp > 0.6 ? "#37e39b" : hp > 0.3 ? "#ffc93d" : "#ff4d5e";
  const Icon = WEAPON_ICON[t.weapon as WeaponKind] ?? Disc3;
  return (
    <motion.div
      layout
      animate={t.hurt ? { x: [0, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.25 }}
      className={cn(
        "glass-strong relative flex items-center gap-2 overflow-hidden rounded-xl pr-2.5",
        compact ? "py-1 pl-1" : "py-1.5 pl-1.5",
        t.isMe && "ring-1 ring-[var(--accent-from)]/70",
        !t.alive && "opacity-55 grayscale",
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: t.color }} />
      <div className="relative ml-1 shrink-0">
        <Avatar person={t} size={compact ? 22 : 30} />
        {!t.alive && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-ink-950/70">
            <Skull className="size-3.5 text-danger" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className={cn("truncate font-semibold", compact ? "text-[10px]" : "text-xs")}>{nameOf(t)}</span>
          {!compact && <Icon className="size-3 shrink-0 text-ink-300" />}
          <span className={cn("ml-auto font-mono tabular text-ink-300", compact ? "text-[9px]" : "text-[10px]")}>{t.alive ? Math.ceil(t.hp) : "KO"}</span>
        </div>
        <div className={cn("mt-0.5 overflow-hidden rounded-full bg-white/10", compact ? "h-1" : "h-1.5")}>
          <div className="h-full rounded-full transition-[width] duration-200" style={{ width: `${hp * 100}%`, background: hpColor, boxShadow: `0 0 8px ${hpColor}` }} />
        </div>
        {t.armorMax > 0 && (
          <div className="mt-0.5 h-[3px] overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#8fb3ff] transition-[width] duration-200" style={{ width: `${armor * 100}%` }} />
          </div>
        )}
      </div>
      {t.hurt && <span className="pointer-events-none absolute inset-0 bg-danger/25" />}
    </motion.div>
  );
}

function KoFeed({ hud }: { hud: HudSnapshot }) {
  const name = (id: string | null) => {
    const t = id ? hud.trucks.find((x) => x.id === id) : undefined;
    return t ? nameOf(t) : "The arena";
  };
  return (
    <ul className="flex flex-col items-end gap-1">
      <AnimatePresence initial={false}>
        {hud.feed.slice(0, 4).map((f) => (
          <motion.li
            key={f.key}
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={spring.snappy}
            className="glass-strong flex max-w-[15rem] items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
          >
            <span className="truncate font-semibold">{f.by ? name(f.by) : f.cause === "dc" ? "Signal lost" : "The arena"}</span>
            <span className="shrink-0 text-danger">
              {f.cause === "pit" ? "⤓ pitted" : f.cause === "dc" ? "⏻" : f.cause === "hazard" ? "⚙" : <Skull className="inline size-3" />}
            </span>
            <span className="truncate text-ink-200">{name(f.victim)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function Callout({ hud, reduce }: { hud: HudSnapshot; reduce: boolean }) {
  const c = hud.callout;
  return (
    <AnimatePresence>
      {c && (
        <motion.div
          key={c.key}
          className="absolute inset-x-0 top-[26%] flex justify-center"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 2.2, filter: "blur(10px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.8 }}
          transition={{ type: "spring", stiffness: 420, damping: 22, filter: { duration: 0.25 } }}
        >
          <span
            className={cn(
              "font-display text-5xl font-extrabold italic tracking-tight drop-shadow-[0_6px_24px_rgb(0_0_0/0.8)] sm:text-7xl",
              c.tone === "ko" && "text-[#ff5a1f]",
              c.tone === "win" && "bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text text-transparent",
            )}
          >
            {c.text}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function WeaponRing({
  weapon,
  cooldown,
  ready,
  size = 84,
  label = true,
}: {
  weapon: WeaponKind;
  cooldown: number;
  ready: boolean;
  size?: number;
  label?: boolean;
}) {
  const Icon = WEAPON_ICON[weapon];
  const r = 44;
  const c = 2 * Math.PI * r;
  const fill = 1 - Math.max(0, Math.min(1, cooldown));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
          <circle cx="50" cy="50" r={r} fill="rgb(9 11 17 / 0.72)" stroke="rgb(255 255 255 / 0.12)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={ready ? "var(--accent-from)" : "rgb(255 255 255 / 0.55)"}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - fill)}
            style={{ transition: "stroke-dashoffset 90ms linear, stroke 200ms" }}
          />
        </svg>
        <span
          className={cn("absolute inset-0 flex items-center justify-center transition-transform", ready && "scale-110")}
          style={{ color: ready ? "var(--accent-from)" : "rgb(255 255 255 / 0.6)", filter: ready ? "drop-shadow(0 0 8px var(--accent-from))" : undefined }}
        >
          <Icon style={{ width: size * 0.36, height: size * 0.36 }} />
        </span>
      </div>
      {label && <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-300">{WEAPONS[weapon].name}</span>}
    </div>
  );
}

function BoostMeter({ value }: { value: number }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-1">
      <div className="glass-strong relative h-20 w-4 overflow-hidden rounded-full">
        <div
          className="absolute inset-x-0 bottom-0 rounded-full"
          style={{
            height: `${Math.max(0, Math.min(1, value)) * 100}%`,
            background: "linear-gradient(to top, #35c8ff, #c6ff3d)",
            boxShadow: "0 0 12px #35c8ff",
            transition: "height 90ms linear",
          }}
        />
      </div>
      <Zap className="size-4 text-[#35c8ff]" />
    </div>
  );
}

function Results({ hud }: { hud: HudSnapshot }) {
  const rows = hud.results ?? [];
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={spring.soft}
      className="absolute inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] flex justify-center px-4"
    >
      <ol className="glass-strong w-full max-w-sm divide-y divide-white/5 rounded-2xl px-2 py-1">
        {rows.map((r) => {
          const t = hud.trucks.find((x) => x.id === r.id);
          if (!t) return null;
          return (
            <li key={r.id} className={cn("flex items-center gap-2 px-2 py-1.5 text-sm", t.isMe && "font-semibold")}>
              <span className="w-8 font-mono text-xs text-ink-300">{ordinal(r.rank)}</span>
              <span className="size-2.5 rounded-full" style={{ background: t.color }} />
              <span className="min-w-0 flex-1 truncate">{nameOf(t)}</span>
              <span className="font-mono text-xs text-ink-300 tabular">{Math.round(r.dmg)} dmg</span>
              <span className="w-14 text-right font-mono tabular">{r.score.toLocaleString()}</span>
            </li>
          );
        })}
      </ol>
    </motion.div>
  );
}

function PauseMenu({
  canPause,
  pref,
  tier,
  onPref,
  onClose,
  touch,
}: {
  canPause: boolean;
  pref: QualityPref;
  tier: Tier;
  onPref: (p: QualityPref) => void;
  onClose: () => void;
  touch: boolean;
}) {
  const [sound, setSound] = useSound();
  const options: { id: QualityPref; label: string }[] = [
    { id: "auto", label: `Auto · ${tier}` },
    { id: "high", label: "High" },
    { id: "medium", label: "Medium" },
    { id: "low", label: "Low" },
  ];
  return (
    <motion.div
      className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-ink-950/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-label="Menu"
        className="glass-strong w-full max-w-sm rounded-3xl p-5"
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={spring.snappy}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-extrabold">{canPause ? "Paused" : "Menu"}</h2>
          {!canPause && <span className="text-[11px] text-ink-400">The fight goes on</span>}
        </div>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-300">Graphics</p>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onPref(o.id)}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-semibold capitalize transition",
                pref === o.id ? "bg-[var(--accent-from)] text-ink-950" : "bg-white/5 text-ink-100 hover:bg-white/10",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setSound(!sound)}
          className="mt-3 flex w-full items-center gap-2 rounded-xl bg-white/5 px-3 py-2.5 text-sm font-semibold hover:bg-white/10"
        >
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />} Sound {sound ? "on" : "off"}
        </button>
        <div className="mt-4 rounded-2xl bg-white/[0.04] p-3 text-xs leading-6 text-ink-200">
          {touch ? (
            <p>Left thumb: drive · Big button: weapon · ⚡: boost · ⟲: self-right when flipped</p>
          ) : (
            <p>
              <Key>W A S D</Key> / arrows drive · <Key>Space</Key> weapon · <Key>Shift</Key> boost · <Key>R</Key> self-right · gamepad: stick, RT/LT, A, B, Y
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(120deg,var(--accent-from),var(--accent-to))] font-bold text-ink-950"
        >
          <Play className="size-4" /> {canPause ? "Resume" : "Back to the fight"}
        </button>
      </motion.div>
    </motion.div>
  );
}

/** DOM pools the runtime animates imperatively every frame. */
function OverlayPools({ rt, trucks }: { rt: MatchRuntime; trucks: HudTruck[] }) {
  const numbersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = numbersRef.current;
    if (!host) return;
    rt.setNumberEls(Array.from(host.children) as HTMLElement[]);
    return () => rt.setNumberEls([]);
  }, [rt]);
  return (
    <>
      <div
        ref={(el) => {
          rt.setVignetteEl(el);
          return () => rt.setVignetteEl(null);
        }}
        className="absolute inset-0 opacity-0"
        style={{ boxShadow: "inset 0 0 90px 10px rgb(255 40 30 / 0.45)" }}
      />
      <div
        ref={(el) => {
          rt.setSpeedEl(el);
          return () => rt.setSpeedEl(null);
        }}
        className="absolute inset-0 opacity-0"
        style={{
          background:
            "repeating-conic-gradient(from 0deg at 50% 55%, rgb(255 255 255 / 0.16) 0deg 0.6deg, transparent 0.6deg 7deg)",
          maskImage: "radial-gradient(ellipse at 50% 55%, transparent 38%, black 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 55%, transparent 38%, black 80%)",
        }}
      />
      <div ref={numbersRef} className="absolute inset-0">
        {Array.from({ length: NUMBER_POOL }).map((_, i) => (
          <span
            key={i}
            className="absolute left-0 top-0 font-display text-2xl font-extrabold italic opacity-0 drop-shadow-[0_2px_6px_rgb(0_0_0/0.9)] data-[tone=hit]:text-ink-100 data-[tone=mine]:text-[var(--accent-from)]"
          />
        ))}
      </div>
      {trucks
        .filter((t) => !t.isMe)
        .map((t) => (
          <div
            key={t.id}
            ref={(el) => {
              rt.setArrowEl(t.id, el);
              return () => rt.setArrowEl(t.id, null);
            }}
            className="absolute left-0 top-0 flex flex-col items-center opacity-0"
          >
            <span className="flex size-7 items-center justify-center" style={{ color: t.color }}>
              <svg viewBox="0 0 24 24" className="size-6 drop-shadow-[0_0_6px_currentColor]">
                <path d="M4 12 L20 4 L15 12 L20 20 Z" fill="currentColor" transform="rotate(180 12 12)" />
              </svg>
            </span>
            <span className="rounded bg-ink-950/60 px-1 font-mono text-[9px] text-ink-100">0m</span>
          </div>
        ))}
    </>
  );
}

