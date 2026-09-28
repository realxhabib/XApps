"use client";

import type { PlayerInfo } from "@xapps/sdk";
import { useMatch, usePresence, useRoomEvent, useXApps } from "@xapps/sdk/react";
import { useEffect, useRef, useState } from "react";
import { useBot, useLiveOpponent } from "@/first-party/shared/hooks";
import {
  ANSWERED_EVENT,
  QUESTION_COUNT,
  REVEAL_MS,
  answeredCount,
  applyToTrack,
  emptyTrack,
  parseAnswered,
  planBot,
  type Question,
  type Track,
} from "./logic";

/**
 * - `bot`   practice/sandbox (or any isBot opponent): this client plays it.
 * - `live`  human online right now: progress arrives through the room.
 * - `async` human who plays another time: we only know their final score, if any.
 * - `solo`  nobody to race.
 */
export type OpponentKind = "bot" | "live" | "async" | "solo";

export interface OpponentView {
  kind: OpponentKind;
  player: PlayerInfo | undefined;
  track: Track;
  /** Running total (bot/live) or known final score (async). */
  total: number | null;
  /** Final score once they have submitted. */
  finalScore: number | null;
  done: boolean;
  online: boolean;
}

export function useOpponent(questions: Question[]): OpponentView {
  const xapps = useXApps();
  const match = useMatch(); // re-renders on match.update (submissions)
  const online = usePresence();
  const bot = useBot();
  const live = useLiveOpponent();
  const player = bot ?? live ?? xapps.opponent;
  const kind: OpponentKind = bot ? "bot" : live ? "live" : player ? "async" : "solo";
  const [track, setTrack] = useState<Track>(emptyTrack);

  // Live: fold the opponent's broadcasts in (validated, deduped by `q`).
  const liveId = live?.id;
  useRoomEvent(ANSWERED_EVENT, (payload, from) => {
    if (!liveId || from !== liveId) return;
    const parsed = parseAnswered(payload);
    if (parsed) setTrack((t) => applyToTrack(t, parsed));
  });

  // Bot: runs its own timeline in parallel with ours, then submits for itself.
  // Keyed on the id only — player objects are replaced on every match.update.
  const botId = bot?.id;
  const botSubmitted = useRef(false);
  useEffect(() => {
    if (!botId || botSubmitted.current || xapps.player(botId)?.submitted) return;
    const plan = planBot(questions);
    const timers = plan.map((step) => setTimeout(() => setTrack((t) => applyToTrack(t, step)), step.atMs));
    const last = plan[plan.length - 1];
    if (last) {
      timers.push(
        setTimeout(() => {
          if (botSubmitted.current) return;
          botSubmitted.current = true;
          xapps
            .submitFor(botId, {
              score: last.total,
              data: { answers: plan.map((s) => ({ q: s.q, correct: s.correct, points: s.points, ms: s.delayMs })) },
            })
            .catch((error: unknown) => console.warn("[emoji-decode] bot submit failed", error));
        }, last.atMs + REVEAL_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [botId, questions, xapps]);

  const info = player ? match.players.find((p) => p.id === player.id) : undefined;
  const finalScore = info?.submitted && typeof info.score === "number" ? info.score : null;
  const total = kind === "async" ? finalScore : (finalScore ?? track.total);

  return {
    kind,
    player: info ?? player,
    track,
    total,
    finalScore,
    done: answeredCount(track) >= QUESTION_COUNT || finalScore !== null,
    online: player ? online.includes(player.id) : false,
  };
}
