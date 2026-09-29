"use client";

/**
 * Wedge Wars root: the garage (pick a loadout, then `ready()`), a watching
 * lobby for spectators, and the match once the host fires `match.start`.
 * This module (and everything 3D under it) is loaded with next/dynamic from
 * the embed page only, so three.js never touches the marketplace bundles.
 */

import { useMatchStarted, usePlayers, useXApps } from "@xapps/sdk/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AnimatedDots, Eyebrow, Screen } from "@/first-party/shared/ui";
import { ease } from "@/lib/motion";
import { Garage } from "./garage";
import { DEFAULT_LOADOUT, parseLoadout, type Loadout } from "./logic";
import { MatchView } from "./match";

const STORAGE_KEY = "wedge-wars:loadout";
/** Nobody holds up the table: the garage locks you in after this long. */
const AUTO_READY_S = 45;
const ignore = () => {};

function loadSaved(): Loadout {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseLoadout(JSON.parse(raw)) : { ...DEFAULT_LOADOUT };
  } catch {
    return { ...DEFAULT_LOADOUT };
  }
}

function save(l: Loadout): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(l));
  } catch {
    // storage blocked
  }
}

export function WedgeWarsApp() {
  const xapps = useXApps();
  const started = useMatchStarted();
  const { players, me, isSpectator } = usePlayers();
  const [loadout, setLoadout] = useState<Loadout>(() => loadSaved());
  const [locked, setLocked] = useState(false);
  const [autoIn, setAutoIn] = useState<number | null>(null);
  const readyRef = useRef(false);

  const ready = () => {
    if (readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[wedge-wars] ready failed", error));
  };

  // Spectators have no garage: ready straight away.
  useEffect(() => {
    if (!isSpectator || readyRef.current) return;
    readyRef.current = true;
    xapps.ready().catch((error: unknown) => console.warn("[wedge-wars] ready failed", error));
  }, [isSpectator, xapps]);

  useEffect(() => {
    if (started) return;
    xapps.ui.setStatus(isSpectator ? "Watching" : locked ? "Ready" : "In the garage").catch(ignore);
  }, [started, isSpectator, locked, xapps]);

  const lockIn = () => {
    save(loadout);
    setLocked(true);
    ready();
  };

  // Auto lock-in countdown (only matters with other people waiting).
  const others = players.some((p) => !p.isBot && p.id !== me.id);
  useEffect(() => {
    if (locked || started || isSpectator || !others) return;
    const at = Date.now() + AUTO_READY_S * 1000;
    const id = setInterval(() => {
      const left = Math.ceil((at - Date.now()) / 1000);
      setAutoIn(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        setLocked(true);
        if (!readyRef.current) {
          readyRef.current = true;
          xapps.ready().catch(ignore);
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [locked, started, isSpectator, others, xapps]);

  return (
    <div className="relative h-dvh w-full overflow-hidden">
      <AnimatePresence mode="wait">
        {started ? (
          <motion.div key="match" className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
            <MatchView loadout={loadout} />
          </motion.div>
        ) : isSpectator ? (
          <motion.div key="watch" className="absolute inset-0 flex" exit={{ opacity: 0 }}>
            <Screen className="gap-5 text-center">
              <h1 className="font-display text-4xl font-extrabold italic tracking-tight">
                Wedge <span className="bg-[linear-gradient(100deg,var(--accent-from),var(--accent-to))] bg-clip-text pr-1 text-transparent">Wars</span>
              </h1>
              <ul className="flex flex-wrap justify-center gap-2">
                {players.map((p) => (
                  <li key={p.id} className="glass flex items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-xs">
                    <Avatar person={p} size={24} />
                    <span className="max-w-24 truncate font-semibold">{p.isBot ? p.name : `@${p.handle}`}</span>
                  </li>
                ))}
              </ul>
              <Eyebrow>
                Trucks are in the garage
                <AnimatedDots />
              </Eyebrow>
            </Screen>
          </motion.div>
        ) : (
          <motion.div
            key="garage"
            className="absolute inset-0"
            exit={{ opacity: 0, scale: 1.04, filter: "blur(10px)" }}
            transition={{ duration: 0.35, ease: ease.inOutQuart }}
          >
            <Garage
              loadout={loadout}
              onChange={(l) => {
                setLoadout(l);
                save(l);
              }}
              onReady={lockIn}
              locked={locked}
              players={players}
              me={me}
              autoReadyIn={autoIn}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
