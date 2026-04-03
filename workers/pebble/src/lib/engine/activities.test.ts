import { describe, expect, it } from "vitest";
import {
  computeHomeActivityWeights,
  pickDestination,
  pickTripDuration,
  shouldCraftItem,
  shouldDepart,
  shouldFindItem,
} from "./activities";
import type { SeededRng } from "./rng";

function stubRng(nextValues: number[] = [], nextIntValues: number[] = [], pickedIndex = 0) {
  let nextIndex = 0;
  let nextIntIndex = 0;

  return {
    next() {
      return nextValues[nextIndex++] ?? 0;
    },
    nextInt() {
      return nextIntValues[nextIntIndex++] ?? 0;
    },
    weightedPick<T>(items: T[]) {
      return items[pickedIndex]!;
    },
  } as unknown as SeededRng;
}

describe("computeHomeActivityWeights", () => {
  it("boosts and penalizes activities based on pet traits", () => {
    const result = computeHomeActivityWeights({
      curiosity: 100,
      energy: 0,
      sociability: 0,
      courage: 0,
      creativity: 100,
    });

    const byType = new Map(
      result.activities.map((activity, index) => [activity.type, result.weights[index]])
    );

    expect(byType.get("sleeping")).toBe(20);
    expect(byType.get("wandering")).toBe(20);
    expect(byType.get("crafting")).toBe(20);
    expect(byType.get("reading")).toBe(18);
    expect(byType.get("stargazing")).toBe(8);
  });
});

describe("travel decisions", () => {
  it("makes packed pets more likely to depart", () => {
    const traits = {
      curiosity: 50,
      energy: 50,
      sociability: 50,
      courage: 50,
      creativity: 50,
    };

    expect(shouldDepart(stubRng([0.2]), traits, false)).toBe(false);
    expect(shouldDepart(stubRng([0.2]), traits, true)).toBe(true);
  });

  it("adds an energy bonus to trip duration", () => {
    const lowEnergy = pickTripDuration(
      stubRng([], [2]),
      {
        curiosity: 50,
        energy: 0,
        sociability: 50,
        courage: 50,
        creativity: 50,
      }
    );

    const highEnergy = pickTripDuration(
      stubRng([], [2]),
      {
        curiosity: 50,
        energy: 100,
        sociability: 50,
        courage: 50,
        creativity: 50,
      }
    );

    expect(highEnergy).toBeGreaterThan(lowEnergy);
  });

  it("only picks destinations the pet is brave enough to visit", () => {
    const timidChoice = pickDestination(
      stubRng([], [], 0),
      {
        curiosity: 50,
        energy: 50,
        sociability: 50,
        courage: 0,
        creativity: 50,
      }
    );

    expect(timidChoice.minCourage).toBe(0);
  });
});

describe("item discovery", () => {
  const traits = {
    curiosity: 100,
    energy: 50,
    sociability: 50,
    courage: 50,
    creativity: 100,
  };

  it("finds items when the roll is under the computed threshold", () => {
    expect(shouldFindItem(stubRng([0.1]), traits)).toBe(true);
    expect(shouldFindItem(stubRng([0.9]), traits)).toBe(false);
  });

  it("crafts items when the roll is under the computed threshold", () => {
    expect(shouldCraftItem(stubRng([0.1]), traits)).toBe(true);
    expect(shouldCraftItem(stubRng([0.9]), traits)).toBe(false);
  });
});
