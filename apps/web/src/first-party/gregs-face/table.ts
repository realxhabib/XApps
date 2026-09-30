"use client";

import { useMatch, usePlayers, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PART_ORDER, type FaceConfig, type PartId } from "./face";
import { DROP_EVENT, botPilotId, parseDrop, planBot, runningScore, submission, type BotRun, type Slides } from "./logic";
import type { TableRow } from "./parts";

/** How often bot progress is re-read (and due bot submissions sent). */
const CLOCK_MS = 200;

/**
 * Everyone else at the table, with live progress:
 * - bots are simulated on their own timeline from the match start (and, on
 *   the pilot's client, submitted when they finish);
 * - live humans broadcast each drop through the room;
 * - anyone who has submitted shows their final score.
 */
export function useTable(face: FaceConfig, slides: Slides): TableRow[] {
  const xapps = useXApps();
  useMatch(); // re-render on submissions
  const { players, me, isSpectator } = usePlayers();
  const others = useMemo(() => players.filter((p) => p.id !== me.id), [players, me.id]);

  const botKey = others
    .filter((p) => p.isBot)
    .map((p) => p.id)
    .join(",");
  const bots = useMemo(() => {
    const out = new Map<string, BotRun>();
    for (const id of botKey ? botKey.split(",") : []) out.set(id, planBot(face, slides, xapps.random.fork(`bot:${id}`)));
    return out;
  }, [botKey, face, slides, xapps]);

  const pilot = !isSpectator && botPilotId(players) === me.id;
  const submitted = useRef(new Set<string>());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (bots.size === 0) return;
    const t0 = performance.now();
    const end = Math.max(...[...bots.values()].map((run) => run.finishMs));
    const id = setInterval(() => {
      const now = performance.now() - t0;
      setElapsed(now);
      if (pilot) {
        for (const [botId, run] of bots) {
          if (now < run.finishMs || submitted.current.has(botId) || xapps.player(botId)?.submitted) continue;
          submitted.current.add(botId);
          xapps
            .submitFor(botId, submission(run.drops))
            .catch((error: unknown) => console.warn(`[gregs-face] submit for ${botId} failed`, error));
        }
      }
      if (now > end + CLOCK_MS) clearInterval(id);
    }, CLOCK_MS);
    return () => clearInterval(id);
  }, [bots, pilot, xapps]);

  const [live, setLive] = useState<Record<string, Partial<Record<PartId, number>>>>({});
  useRoomEvent(DROP_EVENT, (payload, from) => {
    const drop = parseDrop(payload);
    if (!drop || !from || from === me.id) return;
    setLive((prev) => ({ ...prev, [from]: { ...prev[from], [drop.part]: drop.accuracy } }));
  });

  return others.map((player) => {
    const final = player.submitted && typeof player.score === "number" ? player.score : null;
    const run = bots.get(player.id);
    if (run) {
      const shown = run.drops.filter((_, i) => elapsed >= (run.times[i] ?? Infinity));
      return {
        player,
        parts: PART_ORDER.map((_, i) => (i < shown.length ? run.drops[i]!.accuracy : null)),
        score: final ?? (shown.length ? runningScore(shown) : null),
        done: player.submitted || elapsed >= run.finishMs,
      };
    }
    const parts = PART_ORDER.map((part) => live[player.id]?.[part] ?? null);
    const known = parts.filter((a): a is number => a !== null).map((accuracy) => ({ accuracy }));
    return { player, parts, score: final ?? (known.length ? runningScore(known) : null), done: player.submitted };
  });
}
