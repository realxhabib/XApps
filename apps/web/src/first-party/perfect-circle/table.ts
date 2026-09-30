"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { useMatch, usePresence, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useEffect, useRef, useState } from "react";
import { circleSvg } from "./card";
import {
  ATTEMPT_EVENT,
  ATTEMPTS,
  bestOfBot,
  formatAccuracy,
  fromWire,
  parseAttempt,
  planBot,
  type BotAttempt,
  type Point,
} from "./logic";

/**
 * - `bot`   practice seats: this client draws for them (when it pilots) and submits for them.
 * - `live`  a human here right now: their circles arrive through the room.
 * - `async` a human who plays another time: we only know their final score, if any.
 */
export type RowKind = "bot" | "live" | "async";

export interface TableRow {
  player: PlayerInfo;
  kind: RowKind;
  /** Scored circles so far (bots and live players). */
  scores: number[];
  best: number | null;
  bestStroke: Point[] | null;
  /** A bot mid-stroke (the strip animates it). */
  drawing: boolean;
  /** Submitted, or all attempts in. */
  done: boolean;
  online: boolean;
}

interface Progress {
  scores: number[];
  best: number | null;
  bestStroke: Point[] | null;
  drawing: boolean;
}

const EMPTY: Progress = { scores: [], best: null, bestStroke: null, drawing: false };

function withCircle(p: Progress, n: number, accuracy: number, stroke: Point[] | null): Progress {
  if (p.scores.length >= n) return p; // dedupe (live resends, strict-mode replays)
  const scores = [...p.scores, accuracy];
  const improved = p.best === null || accuracy > p.best;
  return {
    scores,
    best: improved ? accuracy : p.best,
    bestStroke: improved ? stroke : p.bestStroke,
    drawing: false,
  };
}

/** Everyone else at the table, and the bots' timelines when this client plays them. */
export function useTable(): TableRow[] {
  const xapps = useXApps();
  const match = useMatch(); // re-renders on match.update (submissions)
  const online = usePresence();
  const [progress, setProgress] = useState<Record<string, Progress>>({});

  const me = xapps.me;
  const seated = match.players.filter((p) => p.role !== "spectator");
  const others = seated.filter((p) => p.id !== me.id);
  const humans = seated.filter((p) => !p.isBot).sort((a, b) => a.seat - b.seat);
  // The lowest-seated human plays the bots; a spectator watching a table of bots
  // (mock host) simulates them locally without submitting.
  const pilot = !xapps.isSpectator && humans[0]?.id === me.id;
  const simulate = xapps.isSpectator && humans.length === 0;
  const botKey = others
    .filter((p) => p.isBot)
    .map((p) => p.id)
    .join(",");

  // Live humans: fold their circles in.
  useRoomEvent(ATTEMPT_EVENT, (payload, from) => {
    const msg = parseAttempt(payload);
    const sender = xapps.player(from);
    if (!msg || !sender || sender.isBot || from === me.id) return;
    setProgress((all) => ({ ...all, [from]: withCircle(all[from] ?? EMPTY, msg.n, msg.accuracy, fromWire(msg.pts)) }));
  });

  // Bots: three circles each on their own timeline, then a submission.
  // Keyed on ids only: player objects are replaced on every match.update.
  const submitted = useRef(new Set<string>());
  useEffect(() => {
    if ((!pilot && !simulate) || !botKey) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const id of botKey.split(",")) {
      if (xapps.player(id)?.submitted) continue;
      const plan: BotAttempt[] = planBot(id, xapps.random.fork(`bot:${id}`));
      plan.forEach((attempt, i) => {
        timers.push(
          setTimeout(
            () => setProgress((all) => ({ ...all, [id]: { ...(all[id] ?? EMPTY), drawing: true } })),
            Math.max(0, attempt.atMs - attempt.drawMs),
          ),
          setTimeout(
            () => setProgress((all) => ({ ...all, [id]: withCircle(all[id] ?? EMPTY, i + 1, attempt.accuracy, attempt.stroke) })),
            attempt.atMs,
          ),
        );
      });
      const last = plan[plan.length - 1];
      const best = bestOfBot(plan);
      if (!pilot || !last || !best) continue;
      timers.push(
        setTimeout(() => {
          if (submitted.current.has(id) || xapps.player(id)?.submitted) return;
          submitted.current.add(id);
          xapps
            .submitFor(id, {
              score: best.accuracy,
              data: { scores: plan.map((a) => a.accuracy) },
              display: { kind: "svg", svg: circleSvg(best.stroke, best.accuracy), alt: `A ${formatAccuracy(best.accuracy)} circle` },
            })
            .catch((error: unknown) => console.warn("[perfect-circle] bot submit failed", error));
        }, last.atMs + 1_200),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [pilot, simulate, botKey, xapps]);

  return others.map((player) => {
    const p = progress[player.id] ?? EMPTY;
    const kind: RowKind = player.isBot ? "bot" : xapps.match.mode === "live" ? "live" : "async";
    const final = player.submitted && typeof player.score === "number" ? player.score : null;
    const best = final ?? p.best;
    return {
      player,
      kind,
      scores: p.scores,
      best,
      bestStroke: p.bestStroke,
      drawing: p.drawing,
      done: player.submitted || p.scores.length >= ATTEMPTS,
      online: player.isBot || online.includes(player.id),
    };
  });
}
