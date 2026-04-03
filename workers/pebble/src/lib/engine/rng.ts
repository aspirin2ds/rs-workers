/**
 * Simple deterministic seeded RNG using xorshift32.
 * Same seed always produces the same sequence.
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? 1 : seed;
  }

  /** Returns a number in [0, 1) */
  next(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >> 17;
    this.state ^= this.state << 5;
    return (this.state >>> 0) / 0x100000000;
  }

  /** Returns an integer in [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Pick one item from an array */
  pick<T>(arr: T[]): T {
    if (arr.length === 0) {
      throw new Error("Cannot pick from an empty array.");
    }

    return arr[Math.floor(this.next() * arr.length)];
  }

  /** Weighted random selection. weights[i] corresponds to items[i]. */
  weightedPick<T>(items: T[], weights: number[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty item list.");
    }

    if (items.length !== weights.length) {
      throw new Error("Items and weights must have the same length.");
    }

    if (weights.some((weight) => weight < 0 || !Number.isFinite(weight))) {
      throw new Error("Weights must be finite non-negative numbers.");
    }

    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      throw new Error("Weighted pick requires a positive total weight.");
    }

    let roll = this.next() * total;

    for (let index = 0; index < items.length; index++) {
      roll -= weights[index];
      if (roll <= 0) {
        return items[index];
      }
    }

    return items[items.length - 1];
  }
}

/**
 * Create a deterministic seed from pet seed + time window.
 * Uses a simple integer hash to mix the two values.
 */
export function makeWindowSeed(petSeed: number, timeWindow: number): number {
  let hash = petSeed ^ timeWindow;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = hash ^ (hash >>> 16);
  return hash >>> 0;
}
