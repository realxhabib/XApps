"use client";

/**
 * Race HUD: item slots with the roulette, lap and time, stardust, the big
 * place badge, the standings column, countdown and callouts, the wrong-way
 * warning, the track title card, the race results table and the Grand Prix
 * podium.
 */

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { spring } from "@/lib/motion";
import { CoinIcon, ItemIcon } from "./icons";
import { ITEM_IDS, ITEMS, MAX_COINS } from "./items";
import { formatTime, placeSuffix } from "./logic";
import type { HudSnapshot, StandingRow } from "./race";
import { liveryFor } from "./race";
import { SHIPS, shipIconSvg } from "./ships";
import { trackById } from "./tracks";

const PLACE_COLORS = [
  ["#fff6a8", "#ffb800"],
  ["#f4f8ff", "#9fb3cc"],
  ["#ffd2a8", "#d0782c"],
  ["#d6f0ff", "#4aa3ff"],
] as const;

function placeColors(place: number): readonly [string, string] {
  return PLACE_COLORS[Math.min(3, place)]!;
}

export function PlaceBadge({ place, big = false }: { place: number; big?: boolean }) {
  const [a, b] = placeColors(place);
  const n = place + 1;
  const suffix = placeSuffix(n).slice(String(n).length);
  return (
    <span
      className="font-display inline-flex items-baseline font-black italic leading-none"
      style={{
        fontSize: big ? "clamp(56px, 13vw, 104px)" : 28,
        backgroundImage: `linear-gradient(180deg, ${a} 10%, ${b} 90%)`,
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        WebkitTextStroke: big ? "3px rgba(20,10,40,0.85)" : "1.5px rgba(20,10,40,0.85)",
        filter: "drop-shadow(0 4px 0 rgba(10,5,30,0.55)) drop-shadow(0 0 18px rgba(255,255,255,0.25))",
        paddingRight: "0.08em",
      }}
    >
      {n}
      <span style={{ fontSize: "0.45em", marginLeft: "0.04em" }}>{suffix}</span>
    </span>
  );
}

function ItemSlots({ hud }: { hud: HudSnapshot }) {
  const reduced = useReducedMotion();
  const [face, setFace] = useState(0);
  useEffect(() => {
    if (!hud.roulette) return;
    const id = setInterval(() => setFace((f) => (f + 1 + Math.floor(Math.random() * 3)) % ITEM_IDS.length), reduced ? 250 : 70);
    return () => clearInterval(id);
  }, [hud.roulette, reduced]);
  const first = hud.items[0];
  const second = hud.items[1] ?? (hud.roulette && hud.items.length === 1 ? null : undefined);
  const main = hud.roulette && !first ? ITEM_IDS[face]! : first?.id;
  const secondId = hud.roulette && first ? ITEM_IDS[face]! : second?.id;
  return (
    <div className="flex items-start gap-2">
      <Slot size={78} glow={main ? ITEMS[main].color : null} spinning={hud.roulette && !first}>
        {main ? <ItemIcon id={main} className="size-[62px]" /> : null}
        {first && first.uses > 1 ? (
          <span className="absolute -bottom-1 -right-1 grid size-6 place-items-center rounded-full bg-white text-[13px] font-black text-ink-900 shadow">
            ×{first.uses}
          </span>
        ) : null}
      </Slot>
      <Slot size={48} glow={secondId ? ITEMS[secondId].color : null} spinning={hud.roulette && !!first}>
        {secondId ? <ItemIcon id={secondId} className="size-[38px]" /> : null}
      </Slot>
    </div>
  );
}

function Slot({ size, glow, spinning, children }: { size: number; glow: string | null; spinning: boolean; children: ReactNode }) {
  return (
    <div
      className="relative grid place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.28), rgba(20,16,40,0.72) 62%)",
        border: "3px solid rgba(255,255,255,0.85)",
        boxShadow: `0 4px 0 rgba(10,6,30,0.6), inset 0 0 14px rgba(0,0,0,0.5)${glow ? `, 0 0 22px ${glow}` : ""}`,
      }}
    >
      <motion.div animate={spinning ? { scale: [0.92, 1.05, 0.92] } : { scale: 1 }} transition={spinning ? { duration: 0.25, repeat: Infinity } : spring.snappy}>
        {children}
      </motion.div>
    </div>
  );
}

function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl px-3 py-1.5 font-black italic text-white ${className}`}
      style={{ background: "linear-gradient(180deg, rgba(40,30,80,0.75), rgba(12,8,30,0.75))", border: "2px solid rgba(255,255,255,0.35)", boxShadow: "0 3px 0 rgba(0,0,0,0.45)" }}
    >
      {children}
    </div>
  );
}

function Standings({ rows }: { rows: readonly StandingRow[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.idx}
          className="flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-[11px] font-bold text-white"
          style={{
            background: row.isMe ? "linear-gradient(90deg, rgba(255,215,90,0.85), rgba(255,140,40,0.7))" : "rgba(12,8,30,0.55)",
            border: `1.5px solid ${row.isMe ? "#fff" : "rgba(255,255,255,0.18)"}`,
            color: row.isMe ? "#2a1400" : "#fff",
          }}
        >
          <span className="w-4 text-center font-black italic">{row.place + 1}</span>
          <RacerFace row={row} size={20} />
          <span className="max-w-[72px] truncate">{row.name}</span>
        </li>
      ))}
    </ol>
  );
}

function RacerFace({ row, size }: { row: StandingRow; size: number }) {
  if (row.avatarUrl || row.kind === "human" || row.kind === "me") {
    return (
      <span className="relative inline-block rounded-full" style={{ boxShadow: `0 0 0 2px ${row.color}` }}>
        <Avatar person={{ name: row.name, handle: row.name, avatarUrl: row.avatarUrl }} size={size} />
      </span>
    );
  }
  const design = SHIPS[row.designIndex % SHIPS.length]!;
  const svg = shipIconSvg(design, liveryFor(design, row.liveryIndex));
  return (
    <span
      className="inline-grid place-items-center overflow-hidden rounded-full bg-white/90"
      style={{ width: size, height: size, boxShadow: `0 0 0 2px ${row.color}` }}
      dangerouslySetInnerHTML={{ __html: svg.replace("<svg", `<svg width="${size * 1.25}" height="${size * 0.8}"`) }}
    />
  );
}

export function RaceHud({ hud, minimap }: { hud: HudSnapshot; minimap: ReactNode }) {
  const racing = hud.phase === "race" || hud.phase === "countdown";
  const showRace = racing || hud.phase === "finished";
  return (
    <div className="pointer-events-none absolute inset-0 select-none" style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}>
      <AnimatePresence>
        {showRace && !hud.spectator ? (
          <motion.div key="top" className="absolute left-3 top-3 flex flex-col gap-2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <ItemSlots hud={hud} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {showRace ? (
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <Pill className="text-[18px] leading-none">
            <span className="text-[11px] not-italic opacity-80">LAP </span>
            {hud.lap}
            <span className="text-[13px] opacity-70">/{hud.laps}</span>
          </Pill>
          <Pill className="font-mono text-[14px] not-italic tabular-nums leading-none">{formatTime(hud.raceTime)}</Pill>
          {!hud.spectator ? (
            <Pill className="flex items-center gap-1 text-[15px] leading-none">
              <CoinIcon className="size-5" />
              <span className={hud.coins >= MAX_COINS ? "text-amber-300" : ""}>{hud.coins}</span>
            </Pill>
          ) : null}
          {hud.lastLap !== null ? <div className="rounded-lg bg-black/40 px-2 py-0.5 font-mono text-[10px] text-white/80">last {formatTime(hud.lastLap)}</div> : null}
        </div>
      ) : null}

      {showRace ? (
        <div className="absolute left-3 top-[118px] hidden sm:block">
          <Standings rows={hud.standings} />
        </div>
      ) : null}

      {showRace ? <div className="absolute bottom-3 left-3">{minimap}</div> : null}

      {showRace && !hud.spectator ? (
        <div className="absolute bottom-2 right-4 flex items-end gap-2 max-sm:bottom-[168px]">
          <AnimatePresence mode="popLayout">
            <motion.div key={hud.place} initial={{ scale: 1.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.6, opacity: 0 }} transition={spring.bouncy}>
              <PlaceBadge place={hud.place} big />
            </motion.div>
          </AnimatePresence>
        </div>
      ) : null}

      <Countdown value={hud.countdown} />
      <CalloutView hud={hud} />
      {hud.wrongWay ? (
        <motion.div
          className="absolute left-1/2 top-[28%] -translate-x-1/2 rounded-2xl border-2 border-white bg-red-600/85 px-5 py-2 text-2xl font-black italic text-white"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 0.6, repeat: Infinity }}
        >
          ↺ WRONG WAY
        </motion.div>
      ) : null}
      <AnimatePresence>{hud.phase === "intro" ? <TitleCard key={`t${hud.raceIndex}`} hud={hud} /> : null}</AnimatePresence>
      <AnimatePresence>{hud.phase === "results" ? <Results key={`r${hud.raceIndex}`} hud={hud} /> : null}</AnimatePresence>
      <AnimatePresence>{hud.phase === "podium" ? <Podium key="podium" hud={hud} /> : null}</AnimatePresence>
      <AnimatePresence>
        {hud.phase === "finished" && hud.finishedPlace !== null ? (
          <motion.div key="fin" className="absolute inset-x-0 top-[18%] flex flex-col items-center gap-1" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={spring.bouncy}>
            <div className="text-[clamp(34px,9vw,68px)] font-black italic text-white" style={{ WebkitTextStroke: "2px #1b0b3a", filter: "drop-shadow(0 4px 0 rgba(0,0,0,0.5))" }}>
              FINISH!
            </div>
            <PlaceBadge place={hud.finishedPlace} big />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Countdown({ value }: { value: number | null }) {
  return (
    <AnimatePresence>
      {value !== null ? (
        <motion.div
          key={value}
          className="absolute inset-x-0 top-[26%] text-center font-black italic"
          initial={{ scale: 2.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 18 }}
          style={{
            fontSize: value === 0 ? "clamp(80px, 22vw, 180px)" : "clamp(90px, 24vw, 200px)",
            color: value === 0 ? "#7dff9a" : "#fff",
            WebkitTextStroke: "4px #1b0b3a",
            filter: "drop-shadow(0 6px 0 rgba(0,0,0,0.5)) drop-shadow(0 0 30px rgba(255,255,255,0.35))",
          }}
        >
          {value === 0 ? "GO!" : value}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function CalloutView({ hud }: { hud: HudSnapshot }) {
  const c = hud.callout;
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (!c) return;
    const t1 = setTimeout(() => setShown(c.id), 0);
    const t2 = setTimeout(() => setShown((s) => (s === c.id ? null : s)), c.tone === "big" ? 2200 : 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [c]);
  const visible = c && shown === c.id && hud.phase !== "results" && hud.phase !== "podium";
  const color = c?.tone === "bad" ? "#ff6b6b" : c?.tone === "good" ? "#7dffb0" : c?.tone === "big" ? "#ffe066" : "#ffffff";
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          key={c.id}
          className="absolute inset-x-0 top-[40%] text-center font-black italic"
          initial={{ y: 20, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={spring.bouncy}
          style={{
            fontSize: c.tone === "big" ? "clamp(34px, 8vw, 64px)" : "clamp(22px, 5vw, 36px)",
            color,
            WebkitTextStroke: "2px #1b0b3a",
            filter: "drop-shadow(0 3px 0 rgba(0,0,0,0.5))",
          }}
        >
          {c.text}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function TitleCard({ hud }: { hud: HudSnapshot }) {
  const def = trackById(hud.trackId);
  return (
    <motion.div className="absolute inset-x-0 bottom-[14%] flex flex-col items-center gap-1 text-center" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.5 }}>
      <div className="rounded-full bg-black/45 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-white/85">
        {hud.cupName} · Race {hud.raceIndex + 1}/{hud.raceCount} · {hud.cc}cc
      </div>
      <div
        className="text-[clamp(38px,10vw,84px)] font-black italic leading-none"
        style={{
          backgroundImage: `linear-gradient(180deg, #fff 20%, ${def.accent[0]} 60%, ${def.accent[1]})`,
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
          WebkitTextStroke: "2px rgba(15,5,35,0.8)",
          filter: "drop-shadow(0 5px 0 rgba(0,0,0,0.45))",
        }}
      >
        {def.name}
      </div>
      <div className="max-w-md px-6 text-sm font-semibold text-white/90 drop-shadow">{def.blurb}</div>
      {hud.waiting ? <div className="mt-2 text-xs font-bold text-white/80">Waiting for the other racers…</div> : null}
    </motion.div>
  );
}

function Results({ hud }: { hud: HudSnapshot }) {
  return (
    <motion.div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-[rgba(8,4,24,0.45)] p-4 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="w-full max-w-md">
        <div className="mb-2 text-center text-[13px] font-bold uppercase tracking-[0.25em] text-white/80">
          {hud.trackName} · results
        </div>
        <ol className="flex flex-col gap-1.5">
          {hud.standings.map((row, i) => (
            <motion.li
              key={row.idx}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ ...spring.snappy, delay: 0.08 * i }}
              className="flex items-center gap-2 rounded-2xl px-2 py-1.5 text-white"
              style={{
                background: row.isMe ? "linear-gradient(90deg, #ffcf40, #ff8a1f)" : "linear-gradient(90deg, rgba(60,40,120,0.85), rgba(20,12,50,0.85))",
                border: `2px solid ${row.isMe ? "#fff" : "rgba(255,255,255,0.25)"}`,
                color: row.isMe ? "#2a1400" : "#fff",
              }}
            >
              <span className="w-9 text-center">
                <PlaceBadge place={row.place} />
              </span>
              <RacerFace row={row} size={26} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{row.name}</span>
              <span className="font-mono text-[11px] opacity-80">{row.time !== null ? formatTime(row.time) : "--"}</span>
              <motion.span className="w-10 text-right text-sm font-black" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + 0.08 * i }}>
                +{row.gain}
              </motion.span>
              <span className="w-10 rounded-lg bg-black/30 px-1 text-center text-sm font-black text-white">{row.points}</span>
            </motion.li>
          ))}
        </ol>
        {hud.raceIndex + 1 < hud.raceCount ? (
          <div className="mt-3 text-center text-xs font-semibold text-white/75">Next: {trackById(hud.trackIdNext ?? hud.trackId).name} · tap to continue</div>
        ) : (
          <div className="mt-3 text-center text-xs font-semibold text-white/75">Final standings next…</div>
        )}
      </div>
    </motion.div>
  );
}

function Podium({ hud }: { hud: HudSnapshot }) {
  const rows = hud.standings;
  const top = [rows[1], rows[0], rows[2]];
  const heights = [96, 132, 72];
  const me = rows.find((r) => r.isMe);
  return (
    <motion.div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(8,4,24,0.5)] p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="text-[12px] font-bold uppercase tracking-[0.25em] text-white/80">{hud.cupName} · final standings</div>
      <div className="flex items-end gap-2">
        {top.map((row, i) =>
          row ? (
            <motion.div key={row.idx} className="flex w-[92px] flex-col items-center gap-1" initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ ...spring.bouncy, delay: [0.5, 0.9, 0.2][i] }}>
              <RacerFace row={row} size={44} />
              <span className="max-w-full truncate text-xs font-bold text-white">{row.name}</span>
              <div
                className="flex w-full flex-col items-center justify-start rounded-t-xl pt-2"
                style={{
                  height: heights[i],
                  background: `linear-gradient(180deg, ${placeColors(row.place)[0]}, ${placeColors(row.place)[1]})`,
                  border: "2px solid rgba(255,255,255,0.7)",
                }}
              >
                <PlaceBadge place={row.place} />
                <span className="text-sm font-black text-[#2a1400]">{row.points} pts</span>
              </div>
            </motion.div>
          ) : null,
        )}
      </div>
      {me ? (
        <div className="text-center text-sm font-bold text-white">
          You finished <PlaceBadge place={me.place} /> with {me.points} pts
          <div className="mt-1 text-xs font-medium text-white/70">{hud.submitError ? "Couldn't send your result. Retrying…" : hud.submitted ? "Result sent" : "Sending result…"}</div>
        </div>
      ) : null}
    </motion.div>
  );
}
