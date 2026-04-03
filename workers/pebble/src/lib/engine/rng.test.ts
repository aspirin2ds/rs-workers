import { describe, expect, it } from "vitest";
import { SeededRng, makeWindowSeed } from "./rng";

describe("SeededRng", () => {
  it("produces the same sequence for the same seed", () => {
    const left = new SeededRng(12345);
    const right = new SeededRng(12345);

    const leftValues = Array.from({ length: 5 }, () => left.next());
    const rightValues = Array.from({ length: 5 }, () => right.next());

    expect(leftValues).toEqual(rightValues);
  });

  it("falls back to the last item when floating point drift leaves a positive remainder", () => {
    const rng = new SeededRng(1);
    rng["next"] = () => 0.999999999999;

    expect(rng.weightedPick(["a", "b", "c"], [1, 1, 1])).toBe("c");
  });

  it("rejects invalid weighted picks", () => {
    const rng = new SeededRng(99);

    expect(() => rng.weightedPick([], [])).toThrow("Cannot pick from an empty item list.");
    expect(() => rng.weightedPick(["a"], [1, 2])).toThrow(
      "Items and weights must have the same length."
    );
    expect(() => rng.weightedPick(["a"], [-1])).toThrow(
      "Weights must be finite non-negative numbers."
    );
    expect(() => rng.weightedPick(["a"], [0])).toThrow(
      "Weighted pick requires a positive total weight."
    );
  });
});

describe("makeWindowSeed", () => {
  it("is deterministic for the same pet seed and window", () => {
    expect(makeWindowSeed(42, 1_700_000_000_000)).toBe(
      makeWindowSeed(42, 1_700_000_000_000)
    );
  });

  it("changes when either input changes", () => {
    const base = makeWindowSeed(42, 1_700_000_000_000);

    expect(makeWindowSeed(43, 1_700_000_000_000)).not.toBe(base);
    expect(makeWindowSeed(42, 1_700_000_000_001)).not.toBe(base);
  });
});
