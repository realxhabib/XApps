import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  ALL_IN_BEAT_MS,
  BACKUP_STEP_MS,
  BOT_TIMEOUT_CHANCE,
  DIFFICULTY_PLAN,
  INTRO_MS,
  LAST_REVEAL_MS,
  LATE_GRACE_MS,
  LEADERBOARD_MS,
  MAX_POINTS,
  MIN_POINTS,
  QUESTION_MS,
  REVEAL_MS,
  ROUNDS,
  STALE_MS,
  advance,
  allAnswered,
  anchorFor,
  answerMs,
  answerPoints,
  botProfile,
  buildQuestions,
  choiceCounts,
  clockLeft,
  decide,
  driverFor,
  dueAt,
  initialState,
  ordinal,
  parseState,
  pickQuestions,
  planBotAnswer,
  presentSeats,
  rankStandings,
  revealedRounds,
  scoreRounds,
  speedPoints,
  streakBonus,
  submissionFor,
  tables,
  toJson,
  toReveal,
  withAnswer,
  type AnswerMap,
  type Question,
  type Seat,
  type TriviaState,
} from "./logic";
import { CATEGORY_META, QUESTIONS, type TriviaQuestion } from "./questions";

/** Deterministic stand-in for Math.random. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

const SEATS: Seat[] = [
  { id: "ana", seat: 0, isBot: false },
  { id: "ben", seat: 1, isBot: false },
  { id: "bot", seat: 2, isBot: true },
  { id: "cy", seat: 3, isBot: false },
];

function questionsFor(seed = "seed-1"): Question[] {
  return buildQuestions(createRandom(seed));
}

/** Plays rounds from answer maps through the reducers, like the driver would. */
function playThrough(rounds: AnswerMap[], upTo = rounds.length): TriviaState {
  let state = initialState("ana", 0) as TriviaState;
  for (let r = 1; r <= upTo; r++) {
    for (const [id, a] of Object.entries(rounds[r - 1] ?? {})) {
      state = withAnswer(state, id, r, a.choice, a.ms) ?? state;
    }
    state = toReveal(state, r, "ana", r * 10) as TriviaState;
    if (r < upTo || upTo === ROUNDS) state = advance(state, r, "ana", r * 10 + 5) as TriviaState;
  }
  return state;
}

describe("question bank", () => {
  it("has at least 160 questions with unique ids", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(160);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });

  it("has four distinct, non-empty choices and sane lengths", () => {
    for (const q of QUESTIONS) {
      const choices = [q.answer, ...q.wrong];
      expect(new Set(choices.map((c) => c.toLowerCase())).size, q.id).toBe(4);
      for (const c of choices) {
        expect(c.trim().length, q.id).toBeGreaterThan(0);
        expect(c.length, q.id).toBeLessThanOrEqual(40);
      }
      expect(q.text.length, q.id).toBeLessThanOrEqual(110);
      expect(q.text.trim().endsWith("?"), q.id).toBe(true);
    }
  });

  it("has no duplicate question texts", () => {
    const texts = QUESTIONS.map((q) => q.text.toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("covers every category at every difficulty", () => {
    for (const category of Object.keys(CATEGORY_META)) {
      for (const difficulty of [1, 2, 3]) {
        const n = QUESTIONS.filter((q) => q.category === category && q.difficulty === difficulty).length;
        expect(n, `${category}/${difficulty}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("question pick", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = questionsFor("alpha");
    const b = questionsFor("alpha");
    const c = questionsFor("beta");
    expect(a).toEqual(b);
    expect(a.map((q) => q.id)).not.toEqual(c.map((q) => q.id));
  });

  it("picks 8 unique questions from 8 different categories along the difficulty curve", () => {
    for (let s = 0; s < 40; s++) {
      const qs = questionsFor(`s${s}`);
      expect(qs).toHaveLength(ROUNDS);
      expect(new Set(qs.map((q) => q.id)).size).toBe(ROUNDS);
      expect(new Set(qs.map((q) => q.category)).size).toBe(ROUNDS);
      expect(qs.map((q) => q.difficulty)).toEqual(DIFFICULTY_PLAN);
      qs.forEach((q, i) => {
        expect(q.round).toBe(i + 1);
        expect(q.double).toBe(i === ROUNDS - 1);
      });
    }
  });

  it("shuffles choices but always keeps the right answer addressable", () => {
    const positions = new Set<number>();
    for (let s = 0; s < 30; s++) {
      for (const q of questionsFor(`c${s}`)) {
        const source = QUESTIONS.find((b) => b.id === q.id) as TriviaQuestion;
        expect(q.choices[q.correct]).toBe(source.answer);
        expect([...q.choices].sort()).toEqual([source.answer, ...source.wrong].sort());
        positions.add(q.correct);
      }
    }
    expect(positions.size).toBe(4);
  });

  it("falls back gracefully on a tiny bank", () => {
    const bank: TriviaQuestion[] = [1, 2, 3].map((i) => ({
      id: `t${i}`,
      category: "science",
      difficulty: 1,
      text: `Q${i}?`,
      answer: "a",
      wrong: ["b", "c", "d"],
    }));
    const picked = pickQuestions(createRandom("x"), bank, 8);
    expect(picked.map((q) => q.id).sort()).toEqual(["t1", "t2", "t3"]);
  });
});

describe("scoring", () => {
  it("scales with the time left, never below the floor", () => {
    expect(speedPoints(0)).toBe(MAX_POINTS);
    expect(speedPoints(QUESTION_MS / 2)).toBe(500);
    expect(speedPoints(QUESTION_MS * 0.9)).toBe(MIN_POINTS);
    expect(speedPoints(QUESTION_MS * 5)).toBe(MIN_POINTS);
    expect(speedPoints(-500)).toBe(MAX_POINTS);
    expect(speedPoints(3_000)).toBe(750);
  });

  it("adds a capped streak bonus from two in a row", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(streakBonus)).toEqual([0, 0, 100, 200, 300, 300, 300]);
  });

  it("scores wrong answers as zero and doubles the final round", () => {
    expect(answerPoints(false, 0, 3)).toBe(0);
    expect(answerPoints(true, 3_000, 1)).toBe(750);
    expect(answerPoints(true, 3_000, 3)).toBe(950);
    expect(answerPoints(true, 3_000, 3, true)).toBe(1_900);
  });

  it("folds revealed rounds into standings with streaks and competition ranks", () => {
    const qs = questionsFor();
    const right = (r: number, ms: number) => ({ choice: qs[r]!.correct, ms });
    const wrongPick = (r: number) => ({ choice: (qs[r]!.correct + 1) % 4, ms: 1_000 });
    const rounds: AnswerMap[] = [
      { ana: right(0, 0), ben: right(0, 6_000) },
      { ana: right(1, 0), ben: wrongPick(1) },
      { ana: wrongPick(2) }, // ben timed out
    ];
    const table = scoreRounds(qs, rounds, ["ana", "ben", "cy"]);
    const ana = table.find((s) => s.id === "ana")!;
    const ben = table.find((s) => s.id === "ben")!;
    const cy = table.find((s) => s.id === "cy")!;
    expect(ana.total).toBe(1_000 + 1_100);
    expect(ana.streak).toBe(0);
    expect(ana.bestStreak).toBe(2);
    expect(ana.correct).toBe(2);
    expect(ben.total).toBe(500);
    expect(ben.results.map((r) => r.choice)).toEqual([qs[0]!.correct, (qs[1]!.correct + 1) % 4, null]);
    expect(cy.total).toBe(0);
    expect(table.map((s) => [s.id, s.rank])).toEqual([
      ["ana", 1],
      ["ben", 2],
      ["cy", 3],
    ]);
  });

  it("shares ranks on ties and keeps seat order among them", () => {
    const ranked = rankStandings([
      { id: "a", total: 5 },
      { id: "b", total: 9 },
      { id: "c", total: 5 },
      { id: "d", total: 1 },
    ]);
    expect(ranked.map((r) => `${r.id}${r.rank}`)).toEqual(["b1", "a2", "c2", "d4"]);
  });

  it("builds the previous table for the leaderboard shuffle", () => {
    const qs = questionsFor();
    const state = playThrough(
      [
        { ana: { choice: qs[0]!.correct, ms: 0 } },
        { ben: { choice: qs[1]!.correct, ms: 0 }, ana: { choice: (qs[1]!.correct + 1) % 4, ms: 0 } },
      ],
      2,
    );
    expect(state.phase).toBe("reveal");
    const { current, previous } = tables(qs, state, ["ana", "ben"]);
    expect(previous.map((s) => s.id)).toEqual(["ana", "ben"]);
    expect(current.map((s) => [s.id, s.rank])).toEqual([
      ["ana", 1],
      ["ben", 1],
    ]);
  });

  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "103rd",
    ]);
  });
});

describe("state reducer", () => {
  it("records each player's first answer for the current question only", () => {
    const s0 = initialState("ana", 100);
    const s1 = withAnswer(s0, "ben", 1, 2, 4_321)!;
    expect(s1.answers.ben).toEqual({ choice: 2, ms: 4_321 });
    expect(withAnswer(s1, "ben", 1, 3, 10)).toBeUndefined(); // no changing your mind
    expect(withAnswer(s1, "ana", 2, 0, 10)).toBeUndefined(); // wrong round
    expect(withAnswer(s1, "ana", 1, 7, 10)).toBeUndefined(); // no such tile
    expect(withAnswer(null, "ana", 1, 0, 10)).toBeUndefined();
    expect(withAnswer(s1, "ana", 1, 0, 99_999)!.answers.ana!.ms).toBe(QUESTION_MS);
    expect(s0.answers).toEqual({}); // pure
  });

  it("refuses answers once the question is revealed", () => {
    const revealed = toReveal(initialState("ana", 0), 1, "ana", 5)!;
    expect(revealed.phase).toBe("reveal");
    expect(revealed.startedAt).toBe(5);
    expect(withAnswer(revealed, "ben", 1, 0, 100)).toBeUndefined();
  });

  it("makes every transition idempotent so racing drivers can't double-apply", () => {
    const s = initialState("ana", 0);
    const r = toReveal(s, 1, "ben", 10)!;
    expect(toReveal(r, 1, "ana", 11)).toBeUndefined();
    const n = advance(r, 1, "ben", 20)!;
    expect(n).toMatchObject({ round: 2, phase: "question", driver: "ben", answers: {}, startedAt: 20 });
    expect(advance(n, 1, "ana", 21)).toBeUndefined();
    expect(advance(r, 2, "ana", 21)).toBeUndefined(); // stale round number
    expect(toReveal(n, 1, "ana", 22)).toBeUndefined();
  });

  it("moves answers into history and ends in the final phase after round 8", () => {
    const rounds = Array.from({ length: ROUNDS }, (_, i): AnswerMap => ({ ana: { choice: i % 4, ms: 1_000 } }));
    const final = playThrough(rounds, ROUNDS);
    expect(final.phase).toBe("final");
    expect(final.round).toBe(ROUNDS);
    expect(final.history).toHaveLength(ROUNDS);
    expect(final.history[3]).toEqual({ ana: { choice: 3, ms: 1_000 } });
    expect(revealedRounds(final)).toHaveLength(ROUNDS);
    expect(advance(final, ROUNDS, "ana", 1)).toBeUndefined();
  });

  it("only counts revealed rounds", () => {
    const s = withAnswer(initialState("ana", 0), "ana", 1, 1, 10)!;
    expect(revealedRounds(s)).toEqual([]);
    const r = toReveal(s, 1, "ana", 1)!;
    expect(revealedRounds(r)).toEqual([{ ana: { choice: 1, ms: 10 } }]);
    const n = advance(r, 1, "ana", 2)!;
    expect(revealedRounds(n)).toHaveLength(1);
  });

  it("parses and validates untrusted state", () => {
    const s = withAnswer(initialState("ana", 1), "ben", 1, 2, 300)!;
    expect(parseState(toJson(s))).toEqual(s);
    expect(parseState(null)).toBeNull();
    expect(parseState({ v: 2 })).toBeNull();
    expect(parseState({ ...(toJson(s) as object), round: 0 })).toBeNull();
    expect(parseState({ ...(toJson(s) as object), phase: "lobby" })).toBeNull();
    // Garbage answers are dropped, not fatal.
    const messy = { ...(toJson(s) as object), answers: { ben: { choice: 9, ms: 1 }, cy: { choice: 1, ms: 20_000 } } };
    expect(parseState(messy)?.answers).toEqual({ cy: { choice: 1, ms: QUESTION_MS } });
  });

  it("counts picks per tile", () => {
    expect(choiceCounts({ a: { choice: 1, ms: 0 }, b: { choice: 1, ms: 0 }, c: { choice: 3, ms: 0 } })).toEqual([0, 2, 0, 1]);
  });
});

describe("timing", () => {
  it("runs the answer clock after the intro", () => {
    expect(clockLeft(1_000, 1_000)).toBe(QUESTION_MS);
    expect(clockLeft(1_000, 1_000 + INTRO_MS + 2_000)).toBe(QUESTION_MS - 2_000);
    expect(clockLeft(1_000, 1_000 + INTRO_MS + QUESTION_MS + 50)).toBe(0);
    expect(answerMs(1_000, 1_200)).toBe(0);
    expect(answerMs(1_000, 1_000 + INTRO_MS + 3_456)).toBe(3_456);
  });

  it("anchors live phases to now and rejoined ones to their start", () => {
    expect(anchorFor(500, 2_000, true)).toBe(2_000);
    expect(anchorFor(500, 2_000, false)).toBe(500);
    expect(anchorFor(9_000, 2_000, false)).toBe(2_000); // driver clock ahead of ours
    expect(anchorFor(Number.NaN, 2_000, false)).toBe(2_000);
  });

  it("times a question out, or ends it a beat after everyone present answered", () => {
    const present = presentSeats(SEATS, ["ana", "ben", "cy"]);
    const s = initialState("ana", 0);
    expect(dueAt(s, 1_000, 1_000, present)).toBe(1_000 + INTRO_MS + QUESTION_MS + LATE_GRACE_MS);
    let all = s;
    for (const p of present) all = withAnswer(all, p.id, 1, 0, 100)!;
    expect(allAnswered(all, present)).toBe(true);
    expect(dueAt(all, 1_000, 4_000, present)).toBe(4_000 + ALL_IN_BEAT_MS);
    // Instant answers still wait for the intro.
    expect(dueAt(all, 1_000, 1_100, present)).toBe(1_000 + INTRO_MS + ALL_IN_BEAT_MS);
    // Absent players aren't waited for.
    const withoutCy = presentSeats(SEATS, ["ana", "ben"]);
    let most = s;
    for (const id of ["ana", "ben", "bot"]) most = withAnswer(most, id, 1, 1, 100)!;
    expect(allAnswered(most, withoutCy)).toBe(true);
    expect(allAnswered(most, present)).toBe(false);
  });

  it("gives the reveal time for the leaderboard, except after the last round", () => {
    const r = toReveal(initialState("ana", 0), 1, "ana", 0)!;
    expect(dueAt(r, 0, 0, [])).toBe(REVEAL_MS + LEADERBOARD_MS);
    expect(dueAt({ ...r, round: ROUNDS }, 0, 0, [])).toBe(LAST_REVEAL_MS);
    expect(dueAt(null, 42, 0, [])).toBe(42);
  });

  it("treats bots as always present and an empty roster as everyone", () => {
    expect(presentSeats(SEATS, ["ana"]).map((s) => s.id)).toEqual(["ana", "bot"]);
    expect(presentSeats(SEATS, []).map((s) => s.id)).toEqual(["ana", "ben", "bot", "cy"]);
    expect(presentSeats(SEATS, null)).toHaveLength(4);
  });
});

describe("driver election", () => {
  const online = ["ana", "ben", "bot", "cy"];

  it("starts with the lowest-seated human present", () => {
    expect(driverFor(SEATS, online, null, 0)).toBe("ana");
    expect(driverFor(SEATS, ["ben", "cy"], null, 0)).toBe("ben");
  });

  it("never elects a bot", () => {
    const bots: Seat[] = [
      { id: "b1", seat: 0, isBot: true },
      { id: "b2", seat: 1, isBot: true },
    ];
    expect(driverFor(bots, null, null, 0)).toBeNull();
    expect(driverFor([...bots, { id: "me", seat: 2, isBot: false }], null, null, 0)).toBe("me");
  });

  it("keeps the current driver until it is stale", () => {
    expect(driverFor(SEATS, online, "ben", 0)).toBe("ben");
    expect(driverFor(SEATS, online, "ben", STALE_MS)).toBe("ben");
  });

  it("hands over to the next seat after a stale driver, then to further backups", () => {
    expect(driverFor(SEATS, online, "ben", STALE_MS + 1)).toBe("cy");
    expect(driverFor(SEATS, online, "ben", STALE_MS + BACKUP_STEP_MS + 1)).toBe("ana");
    expect(driverFor(SEATS, online, "ben", STALE_MS + 10 * BACKUP_STEP_MS)).toBe("ana");
    expect(driverFor(SEATS, online, "cy", STALE_MS + 1)).toBe("ana"); // wraps around
  });

  it("replaces a driver who left at once", () => {
    expect(driverFor(SEATS, ["ben", "cy", "bot"], "ana", 0)).toBe("ben");
    expect(driverFor(SEATS, ["ben", "cy", "bot"], "ana", STALE_MS)).toBe("ben");
    expect(driverFor(SEATS, ["ben", "cy", "bot"], "ana", STALE_MS + 1)).toBe("cy");
    expect(driverFor(SEATS, online, null, STALE_MS + 1)).toBe("ben");
    expect(driverFor(SEATS, online, null, STALE_MS + BACKUP_STEP_MS + 1)).toBe("cy");
  });

  it("keeps a lone driver trying", () => {
    expect(driverFor(SEATS, ["ana", "bot"], "ana", STALE_MS * 3)).toBe("ana");
  });
});

describe("decide", () => {
  const base = { seats: SEATS, online: ["ana", "ben", "bot", "cy"], anchor: 1_000, changedAt: 1_000 };
  const timeout = 1_000 + INTRO_MS + QUESTION_MS + LATE_GRACE_MS;

  it("lets the elected driver start the match", () => {
    expect(decide({ ...base, state: null, me: "ana", now: 1_000 })).toEqual({ kind: "start" });
    expect(decide({ ...base, state: null, me: "ben", now: 1_000 })).toEqual({ kind: "none" });
    expect(decide({ ...base, state: null, me: "ben", now: 1_000 + STALE_MS + 1 })).toEqual({ kind: "start" });
  });

  it("does nothing for spectators or after the final", () => {
    expect(decide({ ...base, state: null, me: null, now: 99_999 })).toEqual({ kind: "none" });
    const final = { ...initialState("ana", 0), phase: "final" as const };
    expect(decide({ ...base, state: final, me: "ana", now: 99_999 })).toEqual({ kind: "none" });
  });

  it("reveals on timeout", () => {
    const s = initialState("ana", 0);
    expect(decide({ ...base, state: s, me: "ana", now: timeout - 1 })).toEqual({ kind: "none" });
    expect(decide({ ...base, state: s, me: "ana", now: timeout })).toEqual({ kind: "reveal", round: 1 });
    expect(decide({ ...base, state: s, me: "ben", now: timeout })).toEqual({ kind: "none" });
  });

  it("reveals early once every present player answered", () => {
    let s = initialState("ana", 0);
    for (const id of ["ana", "ben", "bot", "cy"]) s = withAnswer(s, id, 1, 0, 500)!;
    const input = { ...base, state: s, me: "ana", changedAt: 5_000 };
    expect(decide({ ...input, now: 5_000 })).toEqual({ kind: "none" });
    expect(decide({ ...input, now: 5_000 + ALL_IN_BEAT_MS })).toEqual({ kind: "reveal", round: 1 });
  });

  it("advances after the reveal and lets a backup take over a frozen driver", () => {
    const r = toReveal(initialState("ana", 0), 1, "ana", 0)!;
    const due = 1_000 + REVEAL_MS + LEADERBOARD_MS;
    expect(decide({ ...base, state: r, me: "ana", now: due })).toEqual({ kind: "advance", round: 1 });
    expect(decide({ ...base, state: r, me: "ben", now: due + STALE_MS })).toEqual({ kind: "none" });
    expect(decide({ ...base, state: r, me: "ben", now: due + STALE_MS + 1 })).toEqual({ kind: "advance", round: 1 });
  });

  it("drives everything itself in local simulation", () => {
    const s = initialState("you", 0);
    const bots = SEATS.filter((x) => x.isBot);
    expect(decide({ ...base, seats: bots, state: null, me: "you", now: 1_000, sim: true })).toEqual({ kind: "start" });
    expect(decide({ ...base, seats: bots, state: s, me: "you", now: timeout, sim: true })).toEqual({ kind: "reveal", round: 1 });
  });
});

describe("bots", () => {
  const q = { correct: 2, difficulty: 2 as const, choices: ["a", "b", "c", "d"] };

  it("have stable, varied personalities", () => {
    expect(botProfile("bot2")).toEqual(botProfile("bot2"));
    const profiles = ["bot", "bot2", "bot3", "bot4", "bot5"].map(botProfile);
    expect(new Set(profiles.map((p) => p.accuracy.toFixed(3))).size).toBeGreaterThan(1);
    for (const p of profiles) {
      expect(p.accuracy).toBeGreaterThanOrEqual(0.6);
      expect(p.accuracy).toBeLessThanOrEqual(0.84);
      expect(p.paceMs).toBeGreaterThanOrEqual(3_000);
      expect(p.paceMs).toBeLessThanOrEqual(6_200);
    }
  });

  it("answer right or wrong within the window, and sometimes freeze", () => {
    const profile = { accuracy: 0.7, paceMs: 4_000 };
    expect(planBotAnswer(q, profile, seq([BOT_TIMEOUT_CHANCE / 2]))).toBeNull();
    const right = planBotAnswer(q, profile, seq([0.5, 0.1, 0.5, 0.5, 0.5]))!;
    expect(right.choice).toBe(2);
    expect(right.ms).toBe(4_000);
    const wrong = planBotAnswer(q, profile, seq([0.5, 0.99, 0.0, 0.5, 0.5, 0.5]))!;
    expect(wrong.choice).not.toBe(2);
    expect(wrong.ms).toBe(5_200); // slower when unsure
  });

  it("land a human-like hit rate that tracks difficulty", () => {
    const rate = (difficulty: 1 | 2 | 3) => {
      let hits = 0;
      let rand = 12345;
      const lcg = () => ((rand = (rand * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
      for (let i = 0; i < 4000; i++) {
        const a = planBotAnswer({ ...q, difficulty }, { accuracy: 0.72, paceMs: 4_500 }, lcg);
        if (a && a.choice === q.correct) hits++;
        if (a) {
          expect(a.ms).toBeGreaterThanOrEqual(1_100);
          expect(a.ms).toBeLessThanOrEqual(QUESTION_MS - 400);
        }
      }
      return hits / 4000;
    };
    const easy = rate(1);
    const hard = rate(3);
    expect(easy).toBeGreaterThan(0.78);
    expect(easy).toBeLessThan(0.9);
    expect(hard).toBeGreaterThan(0.45);
    expect(hard).toBeLessThan(0.6);
  });
});

describe("submission", () => {
  it("reports the total with a readable summary", () => {
    const qs = questionsFor();
    const rounds = qs.map((q, i): AnswerMap => (i % 2 === 0 ? { ana: { choice: q.correct, ms: 6_000 } } : {}));
    const [ana] = scoreRounds(qs, rounds, ["ana"]);
    const sub = submissionFor(qs, ana!);
    expect(sub.score).toBe(ana!.total);
    expect(sub.display.title).toBe(`4/${ROUNDS} correct · ${ana!.total.toLocaleString("en")} pts`);
    expect(sub.display.body).toBe("✅ ⏰ ✅ ⏰ ✅ ⏰ ✅ ⏰");
    expect((sub.data as { rounds: unknown[] }).rounds).toHaveLength(ROUNDS);
  });
});

describe("multi-client simulation", () => {
  /**
   * Three clients share one state document (compare-and-set is modelled by
   * the reducers returning `undefined` when the state moved on). Each client
   * keeps its own anchor per phase, exactly like the store does. Ana drives
   * until she drops out mid-match; Ben must take over and finish.
   */
  it("finishes the match when the driver leaves mid-match", () => {
    const qs = questionsFor("sim");
    const seats: Seat[] = [
      { id: "ana", seat: 0, isBot: false },
      { id: "ben", seat: 1, isBot: false },
      { id: "bot", seat: 2, isBot: true },
    ];
    let shared = null as TriviaState | null;
    let version = 0;
    const clients = ["ana", "ben"].map((id) => ({ id, seenVersion: -1, key: "", anchor: 0, changedAt: 0 }));
    let online = ["ana", "ben", "bot"];
    const drivers = new Set<string>();
    const write = (next: TriviaState | undefined) => {
      if (!next) return;
      shared = next;
      version += 1;
    };
    const leaveAt = 40_000;
    for (let now = 0; now < 400_000 && shared?.phase !== "final"; now += 100) {
      if (now === leaveAt) online = ["ben", "bot"];
      for (const c of clients) {
        if (c.id === "ana" && now >= leaveAt) continue; // gone: no more ticks
        if (c.seenVersion !== version) {
          const key = shared ? `${shared.round}:${shared.phase}` : "none";
          if (key !== c.key) c.anchor = now;
          c.key = key;
          c.changedAt = now;
          c.seenVersion = version;
        }
        const s = shared as TriviaState | null;
        // Players answer 2 s into each question (the bot through the driver).
        if (s?.phase === "question" && now - c.anchor >= INTRO_MS + 2_000) {
          write(withAnswer(s, c.id, s.round, qs[s.round - 1]!.correct, 2_000));
          if (s.driver === c.id) write(withAnswer(shared, "bot", s.round, 0, 3_000));
        }
        const action = decide({ state: shared, me: c.id, seats, online, anchor: c.anchor, changedAt: c.changedAt, now });
        if (action.kind === "start") write(shared ? undefined : initialState(c.id, now));
        if (action.kind === "reveal") write(toReveal(shared, action.round, c.id, now));
        if (action.kind === "advance") write(advance(shared, action.round, c.id, now));
        if (action.kind !== "none") drivers.add(c.id);
      }
    }
    const final = shared as TriviaState | null;
    expect(final?.phase).toBe("final");
    expect(final?.history).toHaveLength(ROUNDS);
    expect(final?.driver).toBe("ben");
    expect([...drivers].sort()).toEqual(["ana", "ben"]);
    const table = scoreRounds(qs, revealedRounds(final), ["ana", "ben", "bot"]);
    // Ben answered every round; Ana stopped answering once she left.
    expect(table[0]!.id).toBe("ben");
    expect(table.find((s) => s.id === "ben")!.correct).toBe(ROUNDS);
  });
});
