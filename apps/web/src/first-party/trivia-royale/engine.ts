"use client";

import type { XAppsClient } from "@xapps/sdk";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  INTRO_MS,
  ROUNDS,
  advance,
  answerMs,
  botProfile,
  decide,
  earnedAchievements,
  finalStats,
  initialState,
  planBotAnswer,
  submissionFor,
  toReveal,
  withAnswer,
  type Question,
  type Seat,
  type Standing,
} from "./logic";
import { reportStats, unlockAchievements } from "../shared/progress";
import type { Reducer, Snapshot, TriviaStore } from "./store";

const warn = (what: string) => (error: unknown) => console.warn(`[trivia-royale] ${what} failed`, error);
const ignore = () => {};

/** How often every client checks whether it should move the match on. */
const TICK_MS = 150;

export interface EngineOptions {
  xapps: XAppsClient;
  store: TriviaStore;
  snapshot: Snapshot;
  questions: Question[];
  seats: Seat[];
  online: string[];
  /** The local player's id. */
  meId: string;
  /** Seated (may write state and submit). */
  canWrite: boolean;
  /** Local simulation of a bot table (spectating in the mock host). */
  sim: boolean;
  standings: Standing[];
}

/**
 * Runs the match for this client:
 * - the driver loop (every client ticks; `decide()` says whether *this* one acts),
 * - the bots, when this client drives (practice seats beyond the first bot come from the host),
 * - the HUD round counter, and the one-time submissions at the end.
 * Returns `answer(choice)` for the local player.
 */
export function useTriviaEngine(options: EngineOptions): { answer: (choice: number) => void } {
  const { xapps, store, snapshot, questions, seats, online, meId, canWrite, sim, standings } = options;
  const state = snapshot.state;

  /* Driver loop --------------------------------------------------------- */

  const busy = useRef(false);
  const tick = useEffectEvent(() => {
    if (busy.current) return;
    const snap = store.get();
    const now = Date.now();
    const action = decide({
      state: snap.state,
      me: canWrite ? meId : null,
      seats,
      online,
      anchor: snap.anchor,
      changedAt: snap.changedAt,
      now,
      sim,
    });
    if (action.kind === "none") return;
    const fn: Reducer =
      action.kind === "start"
        ? (s) => (s ? undefined : initialState(meId, now))
        : action.kind === "reveal"
          ? (s) => toReveal(s, action.round, meId, now)
          : (s) => advance(s, action.round, meId, now);
    busy.current = true;
    store
      .update(fn)
      .catch(warn(action.kind))
      .finally(() => {
        busy.current = false;
      });
  });
  useEffect(() => {
    const id = setInterval(() => tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  /* Bots ---------------------------------------------------------------- */

  const pilot = canWrite && state !== null && (sim || state.driver === meId);
  const botKey = seats
    .filter((s) => s.isBot)
    .map((s) => s.id)
    .join(",");
  useEffect(() => {
    if (!pilot || !botKey) return;
    const snap = store.get();
    const current = snap.state;
    if (!current || current.phase !== "question") return;
    const question = questions[current.round - 1];
    if (!question) return;
    const round = current.round;
    const timers = botKey
      .split(",")
      .filter((id) => !current.answers[id])
      .map((id) => {
        const plan = planBotAnswer(question, botProfile(id));
        if (!plan) return null; // froze: the clock will run out on them
        const delay = Math.max(0, snap.anchor + INTRO_MS + plan.ms - Date.now());
        return setTimeout(() => {
          store.update((s) => withAnswer(s, id, round, plan.choice, plan.ms)).catch(warn("bot answer"));
        }, delay);
      });
    return () => timers.forEach((t) => t && clearTimeout(t));
  }, [pilot, botKey, snapshot.key, questions, store]);

  /* HUD round counter (the driver keeps it in step) ---------------------- */

  const round = state?.round ?? 0;
  const drivingRound = canWrite && !sim && state?.driver === meId;
  useEffect(() => {
    if (!drivingRound || round <= xapps.round.current) return;
    xapps.round.set(round).catch(ignore);
  }, [drivingRound, round, xapps]);

  /* Achievements: as each answer is revealed, and with the final standings - */

  const revealed = state !== null && state.phase !== "question";
  const revealKey = revealed ? `${state.phase}:${state.round}` : null;
  useEffect(() => {
    if (!revealKey || !canWrite || sim) return;
    const ids = seats.map((s) => s.id);
    unlockAchievements(xapps, earnedAchievements(questions, store.get().state, ids, meId), "trivia-royale");
  }, [revealKey, canWrite, sim, seats, questions, meId, store, xapps]);

  /* Submissions: once, when the final standings are in -------------------- */

  const final = state?.phase === "final";
  const submitted = useRef(new Set<string>());
  useEffect(() => {
    if (!final || !canWrite || sim) return;
    const submitOnce = (id: string, send: () => Promise<unknown>) => {
      if (submitted.current.has(id) || xapps.player(id)?.submitted) return;
      submitted.current.add(id);
      send().catch(warn(`submit ${id}`));
    };
    const mine = standings.find((s) => s.id === meId);
    if (mine) {
      submitOnce(meId, () => {
        reportStats(xapps, finalStats(standings, meId), "trivia-royale");
        return xapps.submit(submissionFor(questions, mine));
      });
    }
    if (store.get().state?.driver === meId) {
      for (const seat of seats) {
        if (!seat.isBot) continue;
        const row = standings.find((s) => s.id === seat.id);
        if (row) submitOnce(seat.id, () => xapps.submitFor(seat.id, submissionFor(questions, row)));
      }
    }
  }, [final, canWrite, sim, standings, meId, questions, seats, store, xapps]);

  /* HUD scores + status ------------------------------------------------- */

  const scoresKey = standings.map((s) => `${s.id}:${s.total}`).join("|");
  useEffect(() => {
    xapps.ui.setScores(Object.fromEntries(standings.map((s) => [s.id, s.total]))).catch(ignore);
    // standings is recomputed every render; the key tracks its content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoresKey, xapps]);

  const phase = state?.phase ?? null;
  useEffect(() => {
    const text =
      phase === null
        ? "Get ready"
        : phase === "final"
          ? "Final standings"
          : round >= ROUNDS
            ? `Final round · double points`
            : `Round ${round} of ${ROUNDS}`;
    xapps.ui.setStatus(text).catch(ignore);
  }, [phase, round, xapps]);

  /* The local player's answer ------------------------------------------- */

  const answer = useCallback(
    (choice: number) => {
      if (!canWrite) return;
      const snap = store.get();
      const current = snap.state;
      if (!current || current.phase !== "question" || current.answers[meId]) return;
      const ms = answerMs(snap.anchor, Date.now());
      const r = current.round;
      const attempt = (n: number) => {
        store.update((s) => withAnswer(s, meId, r, choice, ms)).catch((error: unknown) => {
          // Eight players locking in within the same second can exhaust the CAS retries.
          if (n < 3 && store.get().state?.round === r) setTimeout(() => attempt(n + 1), 200 * (n + 1));
          else warn("answer")(error);
        });
      };
      attempt(0);
    },
    [canWrite, meId, store],
  );

  return { answer };
}

/** `true` once local time passes `at` (re-arms when `at` changes). Infinity never fires. */
export function useDeadline(at: number): boolean {
  const [passedAt, setPassedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!Number.isFinite(at)) return;
    const id = setTimeout(() => setPassedAt(at), Math.max(0, at - Date.now()));
    return () => clearTimeout(id);
  }, [at]);
  return passedAt === at;
}
