import { describe, expect, it } from "vitest";
import { createStoryGenerationRepository } from "./repository";

function makeDb(input: {
  activeChain?: {
    id: string;
    userId: string;
    petId: string;
    remainingGenerations: number;
    remainingRetries: number;
  };
  activeTask?: {
    id: string;
    chainId: string;
    scheduledFor: number;
  };
} = {}) {
  return input as never;
}

describe("story generation repository", () => {
  it("creates one active chain and one head task for a user with no live work", async () => {
    const repo = createStoryGenerationRepository(makeDb());

    const result = await repo.bootstrapChain({
      userId: "user-1",
      petId: "pet-1",
      now: new Date("2026-04-05T10:00:00.000Z").getTime(),
      minDelaySeconds: 600,
      generationBudget: 5,
      retryBudget: 2,
    });

    expect(result.chain.userId).toBe("user-1");
    expect(result.chain.remainingGenerations).toBe(5);
    expect(result.task.scheduledFor).toBe(
      new Date("2026-04-05T10:10:00.000Z").getTime(),
    );
  });

  it("returns the existing active chain instead of creating a duplicate one", async () => {
    const repo = createStoryGenerationRepository(
      makeDb({
        activeChain: {
          id: "chain-1",
          userId: "user-1",
          petId: "pet-1",
          remainingGenerations: 5,
          remainingRetries: 2,
        },
        activeTask: {
          id: "task-1",
          chainId: "chain-1",
          scheduledFor: new Date("2026-04-05T10:10:00.000Z").getTime(),
        },
      }),
    );

    const result = await repo.bootstrapChain({
      userId: "user-1",
      petId: "pet-1",
      now: new Date("2026-04-05T10:00:00.000Z").getTime(),
      minDelaySeconds: 600,
      generationBudget: 5,
      retryBudget: 2,
    });

    expect(result.chain.id).toBe("chain-1");
    expect(result.task.id).toBe("task-1");
  });
});
