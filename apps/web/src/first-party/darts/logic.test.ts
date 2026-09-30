import { describe, expect, it } from "vitest";
import { hitTest, target, type Point } from "./board";
import {
  MAX_TOTAL,
  TOTAL_DARTS,
  dartTone,
  isBedAndBreakfast,
  isHatTrick,
  isRobinHood,
  isShanghai,
  is180,
  mergeDarts,
  ordinal,
  parseMessage,
  quantize,
  roundCallout,
  roundOf,
  roundScores,
  rounds,
  submissionFor,
  toMessage,
  total,
  wonTable,
} from "./logic";

const T20 = target(20, "treble");
const S20 = target(20, "outer-single");
const S1 = target(1, "outer-single");
const S5 = target(5, "inner-single");
const BULL = target(25, "bull");
const OUTER = target(25, "outer-bull");
const MISS: Point = { x: 0, y: -200 };
const hits = (...pts: Point[]) => pts.map(hitTest);

describe("scoring", () => {
  it("totals darts and splits them into rounds of three", () => {
    const darts = [T20, T20, T20, S20, S1, S5, BULL, OUTER, MISS];
    expect(total(darts)).toBe(180 + 26 + 75);
    expect(roundScores(darts)).toEqual([180, 26, 75]);
    expect(rounds([1, 2, 3, 4])).toEqual([[1, 2, 3], [4]]);
    expect(MAX_TOTAL).toBe(540);
    expect(total(Array(TOTAL_DARTS).fill(T20))).toBe(MAX_TOTAL);
  });

  it("knows which round the next dart belongs to", () => {
    expect(roundOf(0)).toBe(0);
    expect(roundOf(2)).toBe(0);
    expect(roundOf(3)).toBe(1);
    expect(roundOf(8)).toBe(2);
    expect(roundOf(9)).toBe(3);
  });

  it("tones darts for the pop-ups", () => {
    expect(dartTone(hitTest(BULL))).toBe("bull");
    expect(dartTone(hitTest(OUTER))).toBe("bull");
    expect(dartTone(hitTest(T20))).toBe("treble");
    expect(dartTone(hitTest(target(16, "double")))).toBe("double");
    expect(dartTone(hitTest(S1))).toBe("single");
    expect(dartTone(hitTest(MISS))).toBe("miss");
  });
});

describe("round callouts", () => {
  it("180 only for three treble 20s", () => {
    expect(is180(hits(T20, T20, T20))).toBe(true);
    expect(is180(hits(T20, T20))).toBe(false);
    expect(is180(hits(T20, T20, target(19, "treble")))).toBe(false);
    expect(roundCallout(hits(T20, T20, T20))).toMatchObject({ tone: "legend", text: "ONE HUNDRED AND EIGHTY!" });
  });

  it("hat trick, shanghai, bed & breakfast", () => {
    expect(isHatTrick(hits(BULL, OUTER, BULL))).toBe(true);
    expect(isHatTrick(hits(BULL, OUTER, T20))).toBe(false);
    expect(isShanghai(hits(target(7, "inner-single"), target(7, "double"), target(7, "treble")))).toBe(true);
    expect(isShanghai(hits(target(7, "inner-single"), target(7, "treble"), target(7, "treble")))).toBe(false);
    expect(isShanghai(hits(OUTER, BULL, OUTER))).toBe(false);
    expect(isBedAndBreakfast(hits(S20, S5, S1))).toBe(true);
    expect(isBedAndBreakfast(hits(S20, S5, target(1, "double")))).toBe(false);
    expect(roundCallout(hits(S20, S5, S1)).text).toBe("Bed & breakfast");
  });

  it("tons and ordinary rounds", () => {
    expect(roundCallout(hits(T20, T20, S20)).text).toBe("Ton 40!");
    expect(roundCallout(hits(T20, S20, S20)).text).toBe("Ton!");
    expect(roundCallout(hits(T20, S20, target(19, "treble"))).text).toBe("Ton 37");
    expect(roundCallout(hits(MISS, MISS, MISS))).toMatchObject({ tone: "cold" });
    expect(roundCallout(hits(T20, S1, MISS))).toMatchObject({ text: "61", tone: "good" });
    expect(roundCallout(hits(S1, S1, S5))).toMatchObject({ text: "7", tone: "cold" });
  });

  it("robin hood: two darts of a round within 3 mm", () => {
    expect(isRobinHood([T20, { x: T20.x + 2, y: T20.y + 1 }])).toBe(true);
    expect(isRobinHood([T20, { x: T20.x + 5, y: T20.y }])).toBe(false);
    expect(isRobinHood([{ x: 500, y: 0 }, { x: 500, y: 0 }])).toBe(false); // off the board doesn't count
  });
});

describe("room messages", () => {
  it("round-trips darts at 0.1 mm", () => {
    const darts = [{ x: 1.234, y: -103.46 }, { x: -50, y: 0.05 }];
    const parsed = parseMessage(toMessage(darts));
    expect(parsed).toEqual(darts.map(quantize));
    expect(parsed!.map(hitTest)).toEqual(darts.map(quantize).map(hitTest));
  });

  it("rejects malformed payloads", () => {
    expect(parseMessage(null)).toBeNull();
    expect(parseMessage([1, 2])).toBeNull();
    expect(parseMessage({ d: [1] })).toBeNull();
    expect(parseMessage({ d: [1, "2"] })).toBeNull();
    expect(parseMessage({ d: Array(20).fill(0) })).toBeNull();
    expect(parseMessage({ d: [1e9, 0] })).toBeNull();
    expect(parseMessage({ d: [] })).toEqual([]);
  });

  it("keeps the longest list when messages arrive out of order", () => {
    const a = [T20];
    const b = [T20, S20];
    expect(mergeDarts(undefined, a)).toEqual(a);
    expect(mergeDarts(a, b)).toEqual(b);
    expect(mergeDarts(b, a)).toEqual(b);
  });
});

describe("submission", () => {
  it("scores the darts and describes each round", () => {
    const s = submissionFor([T20, T20, T20, S1]);
    expect(s.score).toBe(181);
    expect(s.display.title).toBe("181");
    expect(s.display.body).toBe("T20 T20 T20 · 1");
    expect(s.data).toMatchObject({ rounds: [180, 1] });
  });
});

describe("misc", () => {
  it("wonTable needs an outright first place at a real table", () => {
    expect(wonTable({ me: 1, b: 2 }, "me", 2)).toBe(true);
    expect(wonTable({ me: 1, b: 1 }, "me", 2)).toBe(false);
    expect(wonTable({ me: 2, b: 1 }, "me", 2)).toBe(false);
    expect(wonTable(undefined, "me", 2)).toBe(false);
  });

  it("ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
