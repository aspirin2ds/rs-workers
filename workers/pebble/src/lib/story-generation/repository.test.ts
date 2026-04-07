import { describe, expect, it, vi } from "vitest";
import { createStoryGenerationRepository } from "./repository";

function makeMockDb() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    batch: vi.fn().mockResolvedValue([]),
  };
}

describe("story generation repository", () => {
  it("creates one active chain and one head task for a user with no live work", async () => {
    const db = makeMockDb();
    const repo = createStoryGenerationRepository(db as never);

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
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it("returns the existing active chain instead of creating a duplicate one", async () => {
    const db = makeMockDb();

    const chainRow = {
      id: "chain-1",
      userId: "user-1",
      petId: "pet-1",
      status: "active",
      remainingGenerations: 5,
      remainingRetries: 2,
      activeTaskId: "task-1",
    };
    const taskRow = {
      id: "task-1",
      chainId: "chain-1",
      status: "queued",
      scheduledFor: new Date("2026-04-05T10:10:00.000Z"),
    };

    // First select returns chain, second returns task
    db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([chainRow]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([taskRow]),
          }),
        }),
      });

    const repo = createStoryGenerationRepository(db as never);

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
    expect(db.batch).not.toHaveBeenCalled();
  });

  it("recovers from the generic D1 unique error when another feed creates the active chain", async () => {
    const db = makeMockDb();
    const chainRow = {
      id: "chain-1",
      userId: "user-1",
      petId: "pet-1",
      status: "active",
      remainingGenerations: 5,
      remainingRetries: 2,
      activeTaskId: "task-1",
    };
    const taskRow = {
      id: "task-1",
      chainId: "chain-1",
      status: "queued",
      scheduledFor: new Date("2026-04-05T10:10:00.000Z"),
    };

    db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([chainRow]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([taskRow]),
          }),
        }),
      });
    db.batch.mockRejectedValueOnce(
      new Error("D1_ERROR: UNIQUE constraint failed: story_generation_chain.user_id"),
    );

    const repo = createStoryGenerationRepository(db as never);

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

  it("creates a queued retry task when marking a task invalid with retries remaining", async () => {
    const db = makeMockDb();
    const taskRow = {
      id: "task-1",
      chainId: "chain-1",
      userId: "user-1",
      petId: "pet-1",
      parentTaskId: null,
      status: "running",
      scheduledFor: new Date("2026-04-05T10:10:00.000Z"),
      attemptNumber: 1,
    };

    db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([taskRow]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ remainingRetries: 1 }]),
          }),
        }),
      });

    const repo = createStoryGenerationRepository(db as never);

    const result = await repo.markTaskInvalid({
      taskId: "task-1",
      failureReason: "invalid ai payload",
    });

    expect(result?.retryTask).toEqual(
      expect.objectContaining({
        petId: "pet-1",
        userId: "user-1",
      }),
    );
    expect(db.batch).toHaveBeenCalledTimes(1);
  });

  it("fails a stale active chain and bootstraps a replacement after a D1 unique error", async () => {
    const db = makeMockDb();
    const staleChain = {
      id: "chain-stale",
      userId: "user-1",
      petId: "pet-1",
      status: "active",
      remainingGenerations: 5,
      remainingRetries: 1,
      activeTaskId: null,
    };

    db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([staleChain]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });
    db.batch
      .mockRejectedValueOnce(
        new Error("D1_ERROR: UNIQUE constraint failed: story_generation_chain.user_id"),
      )
      .mockResolvedValueOnce([]);

    const repo = createStoryGenerationRepository(db as never);

    const result = await repo.bootstrapChain({
      userId: "user-1",
      petId: "pet-1",
      now: new Date("2026-04-05T10:00:00.000Z").getTime(),
      minDelaySeconds: 600,
      generationBudget: 5,
      retryBudget: 2,
    });

    expect(result.chain.userId).toBe("user-1");
    expect(db.update).toHaveBeenCalled();
    expect(db.batch).toHaveBeenCalledTimes(2);
  });
});
