import { describe, expect, it } from "vitest";
import { BOARD_STAT, cleanStanding, formatCount, percentLabel, standingMoments, topPercent } from "./standing";

const player = (id: string) => ({ id, handle: id, name: id.toUpperCase(), avatarUrl: null });

describe("Greg's Face standing", () => {
  it("formats counts and percentiles", () => {
    expect(formatCount(2380)).toBe("2,380");
    expect(formatCount(7)).toBe("7");
    expect(topPercent(14, 2380)).toBe(1);
    expect(topPercent(120, 2380)).toBe(6);
    expect(topPercent(3, 4)).toBe(75);
    expect(topPercent(1, 1)).toBeNull();
    expect(topPercent(5, 3)).toBeNull();
    expect(topPercent(0, 10)).toBeNull();
  });

  it("labels the percentile", () => {
    expect(percentLabel(1, 2380)).toBe("Best in the world");
    expect(percentLabel(14, 2380)).toBe("Top 1%");
    expect(percentLabel(10, 20)).toBe("Top 50%");
    expect(percentLabel(15, 20)).toBe("Better than 25% of players");
    expect(percentLabel(20, 20)).toBeNull();
    expect(percentLabel(1, 1)).toBeNull();
  });

  it("finds the moments: new best, first face, places climbed", () => {
    const before = { me: { rank: 20, value: 88.2 } };
    expect(standingMoments(before, { me: { rank: 14, value: 91.5 } }, 91.5)).toEqual({ newBest: true, first: false, climbed: 6 });
    expect(standingMoments(before, { me: { rank: 21, value: 88.2 } }, 80)).toEqual({ newBest: false, first: false, climbed: 0 });
    // Your first face on the board.
    expect(standingMoments({ me: null }, { me: { rank: 300, value: 70 } }, 70)).toEqual({ newBest: true, first: true, climbed: 0 });
    // Unknown before (the board couldn't be read): claim nothing.
    expect(standingMoments(undefined, { me: { rank: 1, value: 99 } }, 99)).toEqual({ newBest: false, first: false, climbed: 0 });
    // The fresh board failed: a better face is still a new best, but no climb.
    expect(standingMoments(before, null, 95)).toEqual({ newBest: true, first: false, climbed: 0 });
    expect(standingMoments({ me: null }, null, 50)).toEqual({ newBest: false, first: false, climbed: 0 });
  });

  it("keeps the well-formed parts of a host answer", () => {
    expect(cleanStanding(null)).toBeNull();
    expect(cleanStanding({ top: "nope" })).toBeNull();
    const standing = cleanStanding({
      key: BOARD_STAT,
      top: [
        { rank: 1, player: player("ann"), value: 99.1 },
        { rank: 2, player: { id: 3 }, value: 98 },
        { rank: 2, player: { ...player("bob"), name: "", avatarUrl: "https://x.test/b.png" }, value: 97 },
        "junk",
      ],
      me: { rank: "14", value: 91 },
      total: 1,
    });
    expect(standing).toEqual({
      key: BOARD_STAT,
      top: [
        { rank: 1, player: player("ann"), value: 99.1 },
        { rank: 2, player: { id: "bob", handle: "bob", name: "bob", avatarUrl: "https://x.test/b.png" }, value: 97 },
      ],
      me: null,
      total: 2,
    });
    expect(cleanStanding({ key: BOARD_STAT, top: [], me: { rank: 1, value: 80 }, total: 1 })?.me).toEqual({ rank: 1, value: 80 });
    expect(cleanStanding({ key: BOARD_STAT, top: [], me: null, total: 0 })).toEqual({ key: BOARD_STAT, top: [], me: null, total: 0 });
  });
});
