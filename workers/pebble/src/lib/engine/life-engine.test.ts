import { beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOW_MINUTES } from "../../data/activities";
import { locations } from "../../data/locations";
import {
  computeHomeActivityWeights,
  pickDestination,
  pickTripDuration,
  shouldCraftItem,
  shouldDepart,
  shouldFindItem,
} from "./activities";
import { findEncountersBatch } from "./encounters";
import { runLifeEngine } from "./life-engine";

vi.mock("./activities", async () => {
  const actual = await vi.importActual<typeof import("./activities")>("./activities");
  return {
    ...actual,
    shouldDepart: vi.fn(actual.shouldDepart),
    pickTripDuration: vi.fn(actual.pickTripDuration),
    pickDestination: vi.fn(actual.pickDestination),
    shouldFindItem: vi.fn(actual.shouldFindItem),
    shouldCraftItem: vi.fn(actual.shouldCraftItem),
    computeHomeActivityWeights: vi.fn(actual.computeHomeActivityWeights),
  };
});

vi.mock("./encounters", () => ({
  findEncountersBatch: vi.fn(async () => new Map()),
}));

const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

function makePet(overrides: Partial<Parameters<typeof runLifeEngine>[1]> = {}) {
  return {
    id: "pet-1",
    seed: 123,
    curiosity: 50,
    energy: 50,
    sociability: 50,
    courage: 50,
    creativity: 50,
    lastCheckedAt: new Date(WINDOW_MS * 10),
    ...overrides,
  };
}

function makeQueryResult<T>(result: T) {
  const chain = {
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (value: T) => unknown) => Promise.resolve(resolve(result)),
  };

  return chain;
}

function createFakeDb(options: {
  selectResults: unknown[];
  throwTransactionError?: Error;
}) {
  const inserts: unknown[] = [];
  const deletes: unknown[] = [];
  const updates: unknown[] = [];
  let selectIndex = 0;

  const tx = {
    insert: () => ({
      values: async (value: unknown) => {
        inserts.push(value);
      },
    }),
    delete: () => ({
      where: async (value: unknown) => {
        deletes.push(value);
      },
    }),
    update: () => ({
      set: (value: unknown) => ({
        where: async (whereValue: unknown) => {
          updates.push({ value, whereValue });
        },
      }),
    }),
    select: () => {
      const result = options.selectResults[selectIndex++] ?? [];
      return makeQueryResult(result);
    },
  };

  const db = {
    select: () => {
      const result = options.selectResults[selectIndex++] ?? [];
      return makeQueryResult(result);
    },
    transaction: async (callback: (innerTx: typeof tx) => Promise<void>) => {
      if (options.throwTransactionError) {
        throw options.throwTransactionError;
      }
      await callback(tx);
    },
  };

  return { db, inserts, deletes, updates };
}

describe("runLifeEngine", () => {
  beforeEach(() => {
    vi.mocked(shouldDepart).mockReset();
    vi.mocked(pickTripDuration).mockReset();
    vi.mocked(pickDestination).mockReset();
    vi.mocked(shouldFindItem).mockReset();
    vi.mocked(shouldCraftItem).mockReset();
    vi.mocked(computeHomeActivityWeights).mockReset();
    vi.mocked(findEncountersBatch).mockReset();
    vi.mocked(findEncountersBatch).mockResolvedValue(new Map());
  });

  it("returns no stories when no full new time window has elapsed", async () => {
    const pet = makePet({ lastCheckedAt: new Date(WINDOW_MS * 10 + 1) });

    const result = await runLifeEngine({} as never, pet, WINDOW_MS * 10 + 1000);

    expect(result).toEqual([]);
  });

  it("creates a traveling story and clears the pack when a trip starts", async () => {
    vi.mocked(shouldDepart).mockReturnValue(true);
    vi.mocked(pickDestination).mockReturnValue(locations[0]);
    vi.mocked(pickTripDuration).mockReturnValue(2);

    const { db, inserts, deletes } = createFakeDb({
      selectResults: [
        [],
        [{ itemId: "compass", quantity: 1, effectTarget: "curiosity", effectStrength: 15 }],
        [],
        [],
      ],
    });

    const pet = makePet();
    const result = await runLifeEngine(db as never, pet, WINDOW_MS * 11);

    expect(result).toEqual([
      {
        petId: pet.id,
        timeWindow: WINDOW_MS * 11,
        activityType: "traveling",
        location: locations[0].name,
        encounteredPetId: null,
        itemsFound: null,
      },
    ]);
    expect(inserts).toHaveLength(1);
    expect(deletes).toHaveLength(1);
  });

  it("creates an exploring story with found items while already traveling", async () => {
    vi.mocked(pickTripDuration).mockReturnValue(3);
    vi.mocked(shouldFindItem).mockReturnValue(true);
    vi.mocked(shouldCraftItem).mockReturnValue(true);

    const { db, inserts, deletes } = createFakeDb({
      selectResults: [
        [],
        [],
        [
          {
            timeWindow: WINDOW_MS * 10,
            activityType: "traveling",
            location: locations[0].name,
          },
        ],
        [{ timeWindow: WINDOW_MS * 10 }],
      ],
    });

    const pet = makePet();
    const result = await runLifeEngine(db as never, pet, WINDOW_MS * 11);

    expect(result).toHaveLength(1);
    expect(result[0]?.activityType).toBe("exploring");
    expect(result[0]?.location).toBe(locations[0].name);
    expect(result[0]?.itemsFound).toHaveLength(2);
    for (const itemId of result[0]?.itemsFound ?? []) {
      expect(locations[0].souvenirIds).toContain(itemId);
    }
    expect(inserts).toHaveLength(1);
    expect(deletes).toHaveLength(0);
  });

  it("swallows story window conflicts and returns no new stories", async () => {
    vi.mocked(shouldDepart).mockReturnValue(true);
    vi.mocked(pickDestination).mockReturnValue(locations[0]);
    vi.mocked(pickTripDuration).mockReturnValue(2);

    const { db } = createFakeDb({
      selectResults: [
        [],
        [],
        [],
        [],
      ],
      throwTransactionError: new Error(
        "UNIQUE constraint failed: story.pet_id, story.time_window"
      ),
    });

    const pet = makePet();
    const result = await runLifeEngine(db as never, pet, WINDOW_MS * 11);

    expect(result).toEqual([]);
  });
});
