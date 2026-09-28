import { createRandom } from "@xapps/sdk";
import { describe, expect, it } from "vitest";
import {
  BOT_AFTER_HUMAN_MS,
  BOT_MARK_MS,
  TAKE_LIMIT,
  applySpark,
  assignSides,
  botDueAt,
  botEntry,
  botTypingAt,
  buildEntry,
  countChars,
  counterState,
  createThrottle,
  entryToJson,
  formatClock,
  graphemes,
  hudStatus,
  isSpice,
  leadingOpener,
  normalizeTake,
  onClockExpired,
  opposite,
  outcomeFor,
  pickBotSpice,
  pickBotTake,
  pickSpark,
  promptWords,
  randomBetween,
  reactionFor,
  revealTimeline,
  setupMatch,
  sideForPlayer,
  timerFor,
  truncateTake,
  validateTake,
  voteTally,
} from "./logic";
import { HOT_TAKE_PROMPTS, SPARK_OPENERS, getPrompt, hotTakeDisplay } from "./prompts";

/** Deterministic `() => number` cycling through the given values. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] as number;
}

describe("sides", () => {
  it("always hands the two seats opposite sides", () => {
    expect(assignSides({ chance: () => true })).toEqual(["for", "against"]);
    expect(assignSides({ chance: () => false })).toEqual(["against", "for"]);
    for (let i = 0; i < 200; i++) {
      const [a, b] = assignSides(createRandom(`seed-${i}`));
      expect(a).not.toBe(b);
    }
  });

  it("flips a fair coin for seat 0", () => {
    let fors = 0;
    for (let i = 0; i < 400; i++) if (setupMatch(createRandom(`fair-${i}`)).sides[0] === "for") fors++;
    expect(fors).toBeGreaterThan(140);
    expect(fors).toBeLessThan(260);
  });

  it("opposite() is an involution", () => {
    expect(opposite("for")).toBe("against");
    expect(opposite(opposite("for"))).toBe("for");
  });

  it("maps players to sides by seat rank, whatever their seat numbers", () => {
    const sides = ["against", "for"] as const;
    const players = [
      { id: "b", seat: 2 },
      { id: "a", seat: 1 },
    ];
    expect(sideForPlayer(sides, players, "a")).toBe("against");
    expect(sideForPlayer(sides, players, "b")).toBe("for");
  });
});

describe("setupMatch", () => {
  it("is identical on both clients and stable across repeated calls", () => {
    const hostA = createRandom("match-seed-42");
    const hostB = createRandom("match-seed-42");
    const first = setupMatch(hostA);
    // Burn the main stream on one client: forks must not care.
    for (let i = 0; i < 10; i++) hostA.next();
    expect(setupMatch(hostA)).toEqual(first);
    expect(setupMatch(hostB)).toEqual(first);
  });

  it("spreads prompts across the bank", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) seen.add(setupMatch(createRandom(`spread-${i}`)).prompt.id);
    expect(seen.size).toBeGreaterThan(HOT_TAKE_PROMPTS.length * 0.8);
  });

  it("honours a valid settings.promptId and ignores unknown ones", () => {
    expect(setupMatch(createRandom("x"), { promptId: "water-wet" }).prompt.id).toBe("water-wet");
    const fallback = setupMatch(createRandom("x"), { promptId: "nope" });
    expect(fallback).toEqual(setupMatch(createRandom("x")));
  });
});

describe("character counting", () => {
  it("counts graphemes, not UTF-16 units", () => {
    expect(countChars("hello")).toBe(5);
    expect(countChars("🌶️🌶️🌶️")).toBe(3);
    expect(countChars("👩‍👩‍👧‍👦")).toBe(1);
    expect(countChars("🇺🇸🇯🇵")).toBe(2);
    expect(countChars("é")).toBe(1); // e + combining acute
    expect(graphemes("a🔥b")).toEqual(["a", "🔥", "b"]);
  });

  it("computes the X-style counter state", () => {
    expect(counterState(0).tone).toBe("idle");
    expect(counterState(100)).toMatchObject({ tone: "ok", showNumber: false, remaining: 180 });
    expect(counterState(260)).toMatchObject({ tone: "warn", showNumber: true, remaining: 20 });
    expect(counterState(280)).toMatchObject({ tone: "warn", remaining: 0, progress: 1 });
    expect(counterState(281)).toMatchObject({ tone: "over", remaining: -1, showRing: true, progress: 1 });
    expect(counterState(300).showRing).toBe(false);
  });
});

describe("validation", () => {
  it("normalizes whitespace but keeps the words", () => {
    expect(normalizeTake("  hi  \r\n\n\n\nthere \n")).toBe("hi\n\nthere");
  });

  it("rejects empty and over-limit takes", () => {
    expect(validateTake("   \n ")).toMatchObject({ ok: false, reason: "empty" });
    expect(validateTake("x".repeat(TAKE_LIMIT + 1))).toMatchObject({ ok: false, reason: "too-long" });
    expect(validateTake("x".repeat(TAKE_LIMIT))).toMatchObject({ ok: true, count: TAKE_LIMIT });
  });

  it("allows 280 emoji even though they are 560+ UTF-16 units", () => {
    const take = "🔥".repeat(TAKE_LIMIT);
    expect(take.length).toBeGreaterThan(TAKE_LIMIT);
    expect(validateTake(take).ok).toBe(true);
  });

  it("truncates on grapheme boundaries", () => {
    const cut = truncateTake(`${"a".repeat(279)}👩‍👩‍👧‍👦👩‍👩‍👧‍👦`);
    expect(countChars(cut)).toBe(280);
    expect(cut.endsWith("👩‍👩‍👧‍👦")).toBe(true);
    expect(truncateTake("short")).toBe("short");
  });
});

describe("spark", () => {
  it("prefixes an opener onto an empty or existing take", () => {
    expect(applySpark("", "Hear me out:")).toEqual({ text: "Hear me out: ", caret: 13 });
    expect(applySpark("pineapple rules", "Respectfully,").text).toBe("Respectfully, pineapple rules");
  });

  it("swaps the opener instead of stacking them", () => {
    const once = applySpark("cats win", "Hear me out:").text;
    expect(applySpark(once, "Plot twist:").text).toBe("Plot twist: cats win");
    expect(leadingOpener("Plot twist: cats win")).toBe("Plot twist:");
  });

  it("never picks the opener already in use", () => {
    for (let i = 0; i < 50; i++) {
      const pick = pickSpark("Hear me out: yes", Math.random);
      expect(pick).not.toBe("Hear me out:");
      expect(SPARK_OPENERS).toContain(pick);
    }
    expect(pickSpark("", () => 0.9999)).toBe(SPARK_OPENERS[SPARK_OPENERS.length - 1]);
  });
});

describe("bot", () => {
  const prompt = getPrompt("pineapple-pizza");

  it("picks a line from the right side's bank with an injected rng", () => {
    expect(pickBotTake(prompt, "for", () => 0)).toBe(prompt.for[0]);
    expect(pickBotTake(prompt, "against", () => 0.99)).toBe(prompt.against[prompt.against.length - 1]);
  });

  it("picks a spice between 1 and 3", () => {
    expect(pickBotSpice(() => 0)).toBe(1);
    expect(pickBotSpice(() => 0.5)).toBe(2);
    expect(pickBotSpice(() => 0.9999)).toBe(3);
  });

  it("builds a valid entry", () => {
    const entry = botEntry(prompt, "against", seq(0.2, 0.7));
    expect(entry).toEqual({ promptId: prompt.id, side: "against", take: prompt.against[0], spice: 3 });
    expect(validateTake(entry.take).ok).toBe(true);
  });

  it("submits at its mark or shortly after the human, whichever is first", () => {
    expect(botDueAt(30_000, null, 2_000)).toBe(30_000);
    expect(botDueAt(30_000, 10_000, 2_000)).toBe(12_000);
    expect(botDueAt(30_000, 29_500, 2_000)).toBe(30_000);
  });

  it("keeps its timing inside the documented windows", () => {
    expect(randomBetween(BOT_MARK_MS, () => 0)).toBe(20_000);
    expect(randomBetween(BOT_MARK_MS, () => 1)).toBe(50_000);
    const after = randomBetween(BOT_AFTER_HUMAN_MS, () => 0.5);
    expect(after).toBeGreaterThanOrEqual(BOT_AFTER_HUMAN_MS[0]);
    expect(after).toBeLessThanOrEqual(BOT_AFTER_HUMAN_MS[1]);
  });

  it("only 'types' between thinking and submitting", () => {
    expect(botTypingAt(1_000, 30_000)).toBe(false);
    expect(botTypingAt(3_000, 30_000)).toBe(true);
    expect(botTypingAt(6_000, 30_000)).toBe(false); // pause in the 7 s cycle
    expect(botTypingAt(31_000, 30_000)).toBe(false);
  });

  it("has a non-empty, in-limit bank for both sides of every prompt", () => {
    const ids = new Set<string>();
    for (const p of HOT_TAKE_PROMPTS) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      for (const side of ["for", "against"] as const) {
        expect(p[side].length).toBeGreaterThanOrEqual(2);
        for (const take of p[side]) expect(validateTake(take).ok).toBe(true);
      }
    }
  });
});

describe("entries", () => {
  it("round-trips through JSON and renders a crowd display", () => {
    const entry = buildEntry("cereal-soup", "for", "Soup.", 2);
    expect(JSON.parse(JSON.stringify(entryToJson(entry)))).toEqual(entry);
    expect(hotTakeDisplay(entry)).toEqual({
      kind: "text",
      title: "🥣 Cereal is a soup.",
      body: "Soup.",
      tone: "for:2",
    });
    expect(isSpice(2)).toBe(true);
    expect(isSpice(4)).toBe(false);
  });
});

describe("realtime", () => {
  it("throttles typing pings on the leading edge", () => {
    const allow = createThrottle(1_000);
    expect(allow(0)).toBe(true);
    expect(allow(500)).toBe(false);
    expect(allow(999)).toBe(false);
    expect(allow(1_000)).toBe(true);
    expect(allow(1_500)).toBe(false);
  });
});

describe("clock", () => {
  it("uses a hard 90 s clock live and a soft 180 s clock otherwise", () => {
    expect(timerFor("live")).toEqual({ durationMs: 90_000, hard: true });
    expect(timerFor("async")).toEqual({ durationMs: 180_000, hard: false });
    expect(timerFor("practice").hard).toBe(false);
  });

  it("formats m:ss, rounding up", () => {
    expect(formatClock(90_000)).toBe("1:30");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(4_200)).toBe("0:05");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("auto-submits only a non-empty take on a hard clock", () => {
    expect(onClockExpired(timerFor("live"), "  ")).toEqual({ kind: "wait" });
    expect(onClockExpired(timerFor("async"), "hot")).toEqual({ kind: "wait" });
    expect(onClockExpired(timerFor("live"), " hot ")).toEqual({ kind: "submit", take: "hot" });
    const long = onClockExpired(timerFor("live"), "y".repeat(400));
    expect(long.kind === "submit" && countChars(long.take)).toBe(TAKE_LIMIT);
  });
});

describe("reveal & HUD", () => {
  it("splits prompts into words and orders the reveal milestones", () => {
    expect(promptWords("  A hot  dog is a sandwich. ")).toEqual(["A", "hot", "dog", "is", "a", "sandwich."]);
    const t = revealTimeline(6);
    expect(t.typed).toBeLessThan(t.card);
    expect(t.card).toBeLessThan(t.flip);
    expect(t.flip).toBeLessThan(t.done);
    expect(revealTimeline(6, true).done).toBeLessThan(t.done);
  });

  it("drives the HUD status line", () => {
    expect(hudStatus("compose", "for", "bot")).toBe("Argue FOR");
    expect(hudStatus("compose", "against", "bot")).toBe("Argue AGAINST");
    expect(hudStatus("waiting", "for", "xapps_bot")).toBe("Waiting for @xapps_bot");
    expect(hudStatus("voting", "for", "x")).toBe("Crowd is voting");
  });

  it("derives the outcome, tally and a stable reaction", () => {
    expect(outcomeFor({ winnerId: "me" }, "me")).toBe("won");
    expect(outcomeFor({ winnerId: "them" }, "me")).toBe("lost");
    expect(outcomeFor({ winnerId: null }, "me")).toBe("draw");
    expect(voteTally({ votes: { me: 5, them: 3 } }, "me", "them")).toEqual({ mine: 5, theirs: 3 });
    expect(voteTally({}, "me", "them")).toBeNull();
    expect(reactionFor("won", "match-1")).toBe(reactionFor("won", "match-1"));
  });
});
