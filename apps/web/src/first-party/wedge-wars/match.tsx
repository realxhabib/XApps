"use client";

/**
 * A live match: builds the runtime from the table, mounts the canvas + HUD,
 * forwards room events, keeps the host HUD (scores/status) in step, unlocks
 * achievements as they happen, and submits once when the round is decided
 * (for you, and for the bots this client drives).
 */

import type { PlayerInfo, XAppsClient } from "@xapps/sdk";
import { usePlayers, usePresence, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { Canvas } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { Suspense, useEffect, useState } from "react";
import { AgXToneMapping } from "three";
import { reportStats, unlockAchievements } from "../shared/progress";
import { isTouchDevice } from "./controls";
import { Hud } from "./hud";
import {
  botLoadout,
  botSkill,
  earnedAchievements,
  finalStats,
  formatClock,
  ordinal,
  WEAPONS,
  type Loadout,
  type MatchLog,
} from "./logic";
import { TIERS, detectTier, loadPref, lower, savePref, type QualityPref, type Tier } from "./quality";
import { MatchRuntime } from "./runtime";
import { MatchScene } from "./scene";
import { TouchControls } from "./touch";
import type { FinalRow, TruckRuntime } from "./world";

const TAG = "wedge-wars";
const ignore = () => {};

function playerName(p: PlayerInfo): string {
  return p.isBot ? p.name : `@${p.handle}`;
}

/** Who simulates what, from the table. */
export function tableRoles(players: PlayerInfo[], meId: string, spectator: boolean) {
  const sim = spectator && players.length > 0 && players.every((p) => p.isBot);
  const humans = players.filter((p) => !p.isBot).sort((a, b) => a.seat - b.seat);
  const botDriver = sim ? meId : (humans[0]?.id ?? null);
  const local = new Set<string>();
  if (sim) players.forEach((p) => local.add(p.id));
  else if (!spectator) {
    local.add(meId);
    if (botDriver === meId) players.filter((p) => p.isBot).forEach((p) => local.add(p.id));
  }
  return { sim, botDriver, local, humans };
}

function createRuntime(xapps: XAppsClient, players: PlayerInfo[], me: PlayerInfo, spectator: boolean, loadout: Loadout, reduce: boolean) {
  const { sim, botDriver, local, humans } = tableRoles(players, me.id, spectator);
  const loadouts = new Map<string, Loadout>();
  const skills = new Map<string, number>();
  // Bots get distinct paints, avoiding the paint of whoever drives them (identical on every client).
  const driverPaint = botDriver === me.id && !spectator ? loadout.paint : -1;
  const used = new Set<number>(driverPaint >= 0 ? [driverPaint] : []);
  for (const p of [...players].sort((a, b) => a.seat - b.seat)) {
    if (p.id === me.id && !spectator) loadouts.set(p.id, loadout);
    else if (p.isBot) {
      const r = xapps.random.fork(`loadout:${p.seat}`);
      const l = botLoadout(() => r.next(), p.seat);
      while (used.has(l.paint) && used.size < 6) l.paint = (l.paint + 1) % 6;
      used.add(l.paint);
      loadouts.set(p.id, l);
      skills.set(p.id, botSkill(() => r.next(), p.seat));
    }
  }
  return new MatchRuntime({
    xapps,
    seats: players.map((p) => ({ id: p.id, seat: p.seat, name: playerName(p), handle: p.handle, isBot: p.isBot, avatarUrl: p.avatarUrl })),
    meId: spectator ? null : me.id,
    spectator,
    sim,
    reduceMotion: reduce,
    localIds: local,
    loadouts,
    skills,
    botDriver,
    canPause: sim || (!spectator && humans.length <= 1),
  });
}

function matchLog(t: TruckRuntime, row: FinalRow, players: number): MatchLog {
  return {
    players,
    rank: row.rank,
    weapon: t.loadout.weapon,
    hpLeft: row.alive ? row.hp : 0,
    dmgDealt: t.dmgDealt,
    kos: t.kos,
    firstKo: t.firstKo,
    pitKos: t.pitKos,
    flameKos: t.flameKos,
    hammerHits: t.hammerHits,
    bestFlipCm: t.bestFlipCm,
    pulverized: t.pulverized,
  };
}

function submitResults(xapps: XAppsClient, rt: MatchRuntime, rows: FinalRow[], submitted: Set<string>) {
  const w = rt.world;
  xapps.ui.setScores(Object.fromEntries(rows.map((r) => [r.id, r.score]))).catch(ignore);
  if (w.sim || w.spectator) return;
  const n = w.trucks.length;
  const submitOnce = (id: string, send: () => Promise<unknown>) => {
    if (submitted.has(id) || xapps.player(id)?.submitted) return;
    submitted.add(id);
    send().catch((error: unknown) => console.warn(`[${TAG}] submit ${id} failed`, error));
  };
  for (const row of rows) {
    const t = w.byId.get(row.id);
    if (!t || !t.local) continue;
    const log = matchLog(t, row, n);
    const data = { rank: row.rank, hp: Math.round(row.hp), dmg: Math.round(t.dmgDealt), kos: t.kos, weapon: t.loadout.weapon, armor: t.loadout.armor };
    const display = {
      kind: "text" as const,
      title: `${ordinal(row.rank)} of ${n}`,
      body: `${WEAPONS[t.loadout.weapon].name} · ${Math.round(t.dmgDealt)} damage · ${t.kos} KO${t.kos === 1 ? "" : "s"}`,
    };
    if (t.isMe) {
      submitOnce(t.id, () => {
        reportStats(xapps, finalStats(log), TAG);
        unlockAchievements(xapps, earnedAchievements(log), TAG);
        return xapps.submit({ score: row.score, data, display });
      });
    } else if (t.isBot) {
      submitOnce(t.id, () => xapps.submitFor(t.id, { score: row.score, data, display }));
    }
  }
  const mine = rows.find((r) => r.id === w.meId);
  if (mine?.rank === 1) xapps.ui.celebrate("big").catch(ignore);
}

export function MatchView({ loadout }: { loadout: Loadout }) {
  const xapps = useXApps();
  const { players, me, isSpectator } = usePlayers();
  const reduce = useReducedMotion();
  const [rt] = useState(() => createRuntime(xapps, players, me, isSpectator, loadout, !!reduce));
  const [touch] = useState(() => isTouchDevice());
  const [pref, setPref] = useState<QualityPref>(() => loadPref());
  const [autoTier, setAutoTier] = useState<Tier>(() => detectTier());
  const tierName: Tier = pref === "auto" ? autoTier : pref;
  const tier = TIERS[tierName];

  useEffect(() => () => rt.dispose(), [rt]);

  useEffect(() => rt.onLowFps(() => setAutoTier((t) => lower(t))), [rt]);

  // Room traffic.
  useRoomEvent("s", (p, from) => rt.net.onState(p, from, performance.now()));
  useRoomEvent("h", (p, from) => rt.net.onHit(p, from, performance.now()));
  useRoomEvent("k", (p, from) => rt.net.onKo(p, from));
  useRoomEvent("f", (p, from) => rt.net.onFin(p, from, performance.now()));
  const online = usePresence();
  useEffect(() => rt.setOnline(online), [rt, online]);

  // Submissions when the round is decided.
  const [submitted] = useState(() => new Set<string>());
  useEffect(() => rt.onFinal((rows) => submitResults(xapps, rt, rows, submitted)), [rt, xapps, submitted]);

  // Host HUD + achievements as they happen (1 Hz).
  useEffect(() => {
    let lastScores = "";
    let lastStatus = "";
    const id = setInterval(() => {
      const w = rt.world;
      if (w.phase !== "fight") return;
      const scores = Object.fromEntries(w.trucks.map((t) => [t.id, Math.round(t.dmgDealt)]));
      const key = JSON.stringify(scores);
      if (key !== lastScores) {
        lastScores = key;
        xapps.ui.setScores(scores).catch(ignore);
      }
      const hud = w.hud();
      const status = `${formatClock(hud.remainingMs)} · ${w.alive().length} trucks left`;
      if (status !== lastStatus) {
        lastStatus = status;
        xapps.ui.setStatus(isSpectator ? `Watching · ${status}` : status).catch(ignore);
      }
      const mine = w.me;
      if (mine && !w.sim) {
        // Mid-match badges (win-based ones wait for the final standings).
        const log = matchLog(mine, { id: mine.id, rank: 99, score: 0, hp: mine.hp, dmg: mine.dmgDealt, alive: mine.alive }, w.trucks.length);
        unlockAchievements(xapps, earnedAchievements(log), TAG);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [rt, xapps, isSpectator]);

  const onPref = (p: QualityPref) => {
    savePref(p);
    setPref(p);
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink-950">
      <Canvas
        shadows="percentage"
        dpr={tier.dpr}
        gl={{ antialias: !tier.post, powerPreference: "high-performance", stencil: false }}
        camera={{ fov: 60, near: 0.1, far: 240, position: [0, 24, -32] }}
        onCreated={({ gl }) => {
          gl.toneMapping = AgXToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
      >
        <Suspense fallback={null}>
          <MatchScene rt={rt} tier={tier} tierName={tierName} />
        </Suspense>
      </Canvas>
      <Hud rt={rt} touch={touch} pref={pref} tier={tierName} onPref={onPref} />
      {touch && !isSpectator && <TouchControls rt={rt} />}
    </div>
  );
}
