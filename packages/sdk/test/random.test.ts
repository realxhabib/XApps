import { describe, expect, it } from "vitest";
import { createRandom } from "../src/random";

describe("createRandom", () => {
  it("is deterministic for the same seed", () => {
    const a = createRandom("match-123");
    const b = createRandom("match-123");
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("differs across seeds", () => {
    const a = createRandom("seed-a").next();
    const b = createRandom("seed-b").next();
    expect(a).not.toEqual(b);
  });

  it("keeps int() within bounds and hits both ends", () => {
    const rng = createRandom("bounds");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it("shuffles into a permutation without mutating the input", () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRandom("shuffle").shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it("forks into independent but reproducible streams", () => {
    const f1 = createRandom("root").fork("round-1");
    const f1b = createRandom("root").fork("round-1");
    const f2 = createRandom("root").fork("round-2");
    expect(f1.next()).toEqual(f1b.next());
    expect(createRandom("root").fork("round-1").next()).not.toEqual(f2.next());
  });

  it("produces a roughly normal distribution", () => {
    const rng = createRandom("normal");
    const samples = Array.from({ length: 4000 }, () => rng.normal(100, 10));
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    expect(mean).toBeGreaterThan(98);
    expect(mean).toBeLessThan(102);
  });
});
