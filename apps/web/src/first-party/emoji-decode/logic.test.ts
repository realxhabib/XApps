import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  BOT_MAX_MS,
  BOT_MIN_MS,
  EMPTY_RUN,
  INTRO_GRACE_MS,
  MAX_PER_CATEGORY,
  QUESTION_COUNT,
  QUESTION_MS,
  REVEAL_MS,
  TRANSITION_MS,
  answerPoints,
  answeredCount,
  applyToTrack,
  buildMatch,
  emptyTrack,
  paceScore,
  parseAnswered,
  planBot,
  recordAnswer,
  remainingAt,
  scoreRun,
  speedBonus,
  splitEmoji,
  submissionData,
  summarize,
  trackFromRun,
} from "./logic";
import { PUZZLES } from "./puzzles";

/** Deterministic stand-in for Math.random in bot tests. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe("puzzle bank", () => {
  it("has at least 48 puzzles with unique ids", () => {
    expect(PUZZLES.length).toBeGreaterThanOrEqual(48);
    expect(new Set(PUZZLES.map((p) => p.id)).size).toBe(PUZZLES.length);
  });

  it("has four distinct options and 1–5 emoji per puzzle", () => {
    for (const p of PUZZLES) {
      const options = [p.answer, ...p.distractors];
      expect(new Set(options.map((o) => o.toLowerCase())).size, p.id).toBe(4);
      const tiles = splitEmoji(p.emoji);
      expect(tiles.length, p.id).toBeGreaterThanOrEqual(1);
      expect(tiles.length, p.id).toBeLessThanOrEqual(5);
      expect(p.answer.length, p.id).toBeLessThanOrEqual(44);
    }
  });

  it("covers every category with enough puzzles for the category cap", () => {
    const counts = new Map<string, number>();
    for (const p of PUZZLES) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(["Idiom", "Movie", "Phrase", "Song"]);
    for (const n of counts.values()) expect(n).toBeGreaterThanOrEqual(MAX_PER_CATEGORY);
  });
});

describe("splitEmoji", () => {
  it("keeps ZWJ sequences, keycaps and variation selectors together", () => {
    expect(splitEmoji("🧙‍♂️💍🌋")).toEqual(["🧙‍♂️", "💍", "🌋"]);
    expect(splitEmoji("1️⃣🔵🌙")).toEqual(["1️⃣", "🔵", "🌙"]);
    expect(splitEmoji("🌧️ 🐱 🐶")).toEqual(["🌧️", "🐱", "🐶"]);
  });
});

describe("buildMatch", () => {
  it("is identical for the same seed and differs across seeds", () => {
    const a = buildMatch(createRandom("seed-1"));
    const b = buildMatch(createRandom("seed-1"));
    const c = buildMatch(createRandom("seed-2"));
    expect(a).toEqual(b);
    expect(a.map((q) => q.puzzle.id)).not.toEqual(c.map((q) => q.puzzle.id));
  });

  it("does not consume the root random stream (safe to call twice)", () => {
    const rng = createRandom("seed-x");
    const first = buildMatch(rng);
    const second = buildMatch(rng);
    expect(second).toEqual(first);
  });

  it("picks 8 unique puzzles with a category cap and a valid correct index", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const match = buildMatch(createRandom(seed));
      expect(match).toHaveLength(QUESTION_COUNT);
      expect(new Set(match.map((q) => q.puzzle.id)).size).toBe(QUESTION_COUNT);
      const perCategory = new Map<string, number>();
      for (const q of match) {
        perCategory.set(q.puzzle.category, (perCategory.get(q.puzzle.category) ?? 0) + 1);
        expect(q.options).toHaveLength(4);
        expect(q.options[q.correctIndex]).toBe(q.puzzle.answer);
        expect([...q.options].sort()).toEqual([q.puzzle.answer, ...q.puzzle.distractors].sort());
      }
      for (const n of perCategory.values()) expect(n).toBeLessThanOrEqual(MAX_PER_CATEGORY);
    }
  });

  it("shuffles option order per question with the q<i> fork", () => {
    const match = buildMatch(createRandom("order"));
    const expected = createRandom("order")
      .fork("q3")
      .shuffle([match[3]!.puzzle.answer, ...match[3]!.puzzle.distractors]);
    expect(match[3]!.options).toEqual(expected);
    // The correct answer shouldn't always sit in the same slot.
    const slots = new Set<number>();
    for (const seed of ["s1", "s2", "s3", "s4", "s5"]) buildMatch(createRandom(seed)).forEach((q) => slots.add(q.correctIndex));
    expect(slots.size).toBe(4);
  });
});

describe("scoring", () => {
  it("clock: grace period, then 12 s countdown clamped at 0", () => {
    expect(remainingAt(1000, 1000)).toBe(QUESTION_MS);
    expect(remainingAt(1000, 1000 + INTRO_GRACE_MS)).toBe(QUESTION_MS);
    expect(remainingAt(1000, 1000 + INTRO_GRACE_MS + 3000)).toBe(QUESTION_MS - 3000);
    expect(remainingAt(0, 999_999)).toBe(0);
  });

  it("speed bonus is round(100 × remaining / 12 s)", () => {
    expect(speedBonus(QUESTION_MS)).toBe(100);
    expect(speedBonus(6000)).toBe(50);
    expect(speedBonus(5400)).toBe(45);
    expect(speedBonus(0)).toBe(0);
    expect(speedBonus(-50)).toBe(0);
    expect(speedBonus(99_999)).toBe(100);
  });

  it("correct = 100 + speed (+25 from the 3rd in a row); wrong/timeout = 0", () => {
    expect(answerPoints(true, 5400, 1)).toBe(145);
    expect(answerPoints(true, 5400, 2)).toBe(145);
    expect(answerPoints(true, 5400, 3)).toBe(170);
    expect(answerPoints(true, 0, 7)).toBe(125);
    expect(answerPoints(false, 12_000, 5)).toBe(0);
  });

  it("recordAnswer tracks streaks, totals and is idempotent per question", () => {
    const match = buildMatch(createRandom("run"));
    const q0 = match[0]!;
    const wrong = (q0.correctIndex + 1) % 4;
    const first = recordAnswer(EMPTY_RUN, q0, q0.correctIndex, 6000, 6420);
    expect(first.answer).toMatchObject({ correct: true, points: 150, streak: 1, total: 150, elapsedMs: 6420 });
    const again = recordAnswer(first.run, q0, wrong, 12_000);
    expect(again.run).toBe(first.run);
    expect(again.answer).toBe(first.answer);
    const timeout = recordAnswer(first.run, match[1]!, null, 0);
    expect(timeout.answer).toMatchObject({ correct: false, points: 0, streak: 0, choice: null, total: 150 });
  });

  it("scores a full run with streak bonuses", () => {
    const match = buildMatch(createRandom("full"));
    const right = (i: number, ms: number) => ({ choice: match[i]!.correctIndex, remainingMs: ms });
    const wrong = (i: number) => ({ choice: (match[i]!.correctIndex + 1) % 4, remainingMs: 8000 });
    const run = scoreRun(match, [
      right(0, 12_000), // 200
      right(1, 6000), // 150
      right(2, 6000), // 150 + 25
      right(3, 0), // 100 + 25
      wrong(4), // 0, streak resets
      right(5, 3000), // 125
      right(6, 3000), // 125
      { choice: null, remainingMs: 0 }, // timeout
    ]);
    expect(run.answers.map((a) => a.points)).toEqual([200, 150, 175, 125, 0, 125, 125, 0]);
    expect(run.total).toBe(900);
    expect(run.bestStreak).toBe(4);
    expect(run.streak).toBe(0);
    const summary = summarize(run);
    expect(summary).toMatchObject({ correct: 6, total: 900, bestStreak: 4 });
    // Default elapsed = clock time used + the intro grace.
    expect(summary.avgCorrectMs).toBe(Math.round((0 + 6000 + 6000 + 12_000 + 9000 + 9000) / 6) + INTRO_GRACE_MS);
    const data = submissionData(match, run) as { answers: { pick: string | null; points: number }[] };
    expect(data.answers).toHaveLength(8);
    expect(data.answers[0]!.pick).toBe(match[0]!.puzzle.answer);
    expect(data.answers[7]!.pick).toBeNull();
  });
});

describe("live sync", () => {
  it("parses valid payloads and rejects junk", () => {
    expect(parseAnswered({ q: 2, correct: true, points: 145, total: 400 })).toEqual({ q: 2, correct: true, points: 145, total: 400 });
    expect(parseAnswered(null)).toBeNull();
    expect(parseAnswered([1, 2])).toBeNull();
    expect(parseAnswered({ q: 8, correct: true, points: 1, total: 1 })).toBeNull();
    expect(parseAnswered({ q: 1.5, correct: true, points: 1, total: 1 })).toBeNull();
    expect(parseAnswered({ q: 1, correct: "yes", points: 1, total: 1 })).toBeNull();
    expect(parseAnswered({ q: 1, correct: true, points: 9999, total: 1 })).toBeNull();
    expect(parseAnswered({ q: 1, correct: true, points: 100, total: -4 })).toBeNull();
  });

  it("applies answers idempotently and tolerates out-of-order delivery", () => {
    let track = emptyTrack();
    track = applyToTrack(track, { q: 1, correct: true, points: 150, total: 290 });
    track = applyToTrack(track, { q: 0, correct: true, points: 140, total: 140 });
    const dup = applyToTrack(track, { q: 0, correct: false, points: 0, total: 0 });
    expect(dup).toBe(track);
    expect(track.total).toBe(290);
    expect(answeredCount(track)).toBe(2);
    expect(track.results[0]).toEqual({ correct: true, points: 140 });
  });

  it("simulates a human opponent's broadcast stream end to end", () => {
    const match = buildMatch(createRandom("live"));
    // "Their" client plays and broadcasts; "our" client folds the messages in.
    let theirRun = EMPTY_RUN;
    let ourView = emptyTrack();
    match.forEach((q, i) => {
      const { run, answer } = recordAnswer(theirRun, q, i % 3 === 0 ? null : q.correctIndex, 7000);
      theirRun = run;
      const wire = JSON.parse(JSON.stringify({ q: answer.q, correct: answer.correct, points: answer.points, total: answer.total }));
      const parsed = parseAnswered(wire);
      expect(parsed).not.toBeNull();
      ourView = applyToTrack(ourView, parsed!);
      ourView = applyToTrack(ourView, parsed!); // duplicate delivery is harmless
    });
    expect(ourView).toEqual(trackFromRun(theirRun));
    expect(ourView.total).toBe(theirRun.total);
    expect(answeredCount(ourView)).toBe(QUESTION_COUNT);
  });

  it("paces an async ghost evenly toward the target", () => {
    expect(paceScore(1200, 0)).toBe(0);
    expect(paceScore(1200, 4)).toBe(600);
    expect(paceScore(1200, 8)).toBe(1200);
    expect(paceScore(1000, 3)).toBe(375);
  });
});

describe("bot", () => {
  it("answers 2.5–9 s after each puzzle appears, on its own timeline", () => {
    const match = buildMatch(createRandom("bot"));
    const plan = planBot(match, seq([0, 0.1, 0.5, 1 - 1e-9, 0.9, 0.3]));
    expect(plan).toHaveLength(QUESTION_COUNT);
    let shownAt = 0;
    for (const step of plan) {
      expect(step.delayMs).toBeGreaterThanOrEqual(BOT_MIN_MS);
      expect(step.delayMs).toBeLessThanOrEqual(BOT_MAX_MS);
      expect(step.atMs).toBe(shownAt + step.delayMs);
      shownAt = step.atMs + REVEAL_MS + TRANSITION_MS;
    }
    expect(plan[plan.length - 1]!.total).toBe(plan.reduce((s, p) => s + p.points, 0));
  });

  it("picks the right option when correct and a wrong one otherwise", () => {
    const match = buildMatch(createRandom("bot-choice"));
    const allRight = planBot(match, () => 0.01);
    allRight.forEach((s, i) => {
      expect(s.correct).toBe(true);
      expect(s.choice).toBe(match[i]!.correctIndex);
    });
    // Streak bonus kicks in from the third answer.
    expect(allRight[2]!.points - allRight[1]!.points).toBe(25);
    const allWrong = planBot(match, () => 0.99);
    allWrong.forEach((s, i) => {
      expect(s.correct).toBe(false);
      expect(s.choice).not.toBe(match[i]!.correctIndex);
      expect(s.points).toBe(0);
    });
  });

  it("lands near 72% accuracy over many runs", () => {
    const match = buildMatch(createRandom("bot-acc"));
    let correct = 0;
    let total = 0;
    let state = 42;
    const lcg = () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    for (let i = 0; i < 400; i++) {
      for (const step of planBot(match, lcg)) {
        total++;
        if (step.correct) correct++;
      }
    }
    expect(correct / total).toBeGreaterThan(0.67);
    expect(correct / total).toBeLessThan(0.77);
  });
});
