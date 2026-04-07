import { describe, expect, it, vi } from "vitest";
import { processStoryGenerationMessage } from "./consumer";

function makeEnv(input: { queue?: { send: ReturnType<typeof vi.fn> } }) {
  return {
    STORY_QUEUE: input.queue ?? { send: vi.fn() },
    STORY_MIN_DELAY_SECONDS: "600",
    STORY_MAX_DELAY_SECONDS: "1800",
  } as unknown as CloudflareBindings;
}

function makeRepo() {
  return {
    getTaskForProcessing: vi.fn().mockResolvedValue({
      id: "task-1",
      chainId: "chain-1",
      petId: "pet-1",
      userId: "user-1",
      createdStoryId: null,
      status: "queued",
    }),
    markTaskRunning: vi.fn().mockResolvedValue(undefined),
    completeSuccessfulTask: vi.fn().mockResolvedValue({
      storyTime: new Date("2026-04-05T10:20:00.000Z").getTime(),
      remainingGenerations: 4,
    }),
    enqueueNextTask: vi.fn().mockResolvedValue({ id: "task-2" }),
    markTaskInvalid: vi.fn().mockResolvedValue(undefined),
  };
}

describe("processStoryGenerationMessage", () => {
  it("writes one story and enqueues the next task when chain budget remains", async () => {
    const repo = makeRepo();
    const generateStory = vi.fn().mockResolvedValue({
      story: "Basalt drifted through the Moonlit Library.",
      activityType: "wandering",
      location: "Moonlit Library",
      itemsFound: ["rice-ball"],
      proposedNextAt: new Date("2026-04-05T10:40:00.000Z").getTime(),
    });
    const queue = { send: vi.fn() };

    await processStoryGenerationMessage({
      env: makeEnv({ queue }),
      payload: {
        taskId: "task-1",
        petId: "pet-1",
        userId: "user-1",
        scheduledFor: new Date("2026-04-05T10:20:00.000Z").getTime(),
      },
      repo,
      generateStory,
    });

    expect(repo.completeSuccessfulTask).toHaveBeenCalled();
    expect(queue.send).toHaveBeenCalledTimes(1);
  });

  it("marks the task invalid and decrements chain retries without spending generation budget", async () => {
    const repo = {
      ...makeRepo(),
      markTaskInvalid: vi.fn().mockResolvedValue({ retryTask: null }),
      decrementGenerationBudget: vi.fn(),
    };
    const generateStory = vi
      .fn()
      .mockRejectedValue(new Error("invalid ai payload"));

    await processStoryGenerationMessage({
      env: makeEnv({}),
      payload: {
        taskId: "task-1",
        petId: "pet-1",
        userId: "user-1",
        scheduledFor: new Date("2026-04-05T10:20:00.000Z").getTime(),
      },
      repo,
      generateStory,
    });

    expect(repo.markTaskInvalid).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task-1",
        failureReason: "invalid ai payload",
      }),
    );
    expect(repo.decrementGenerationBudget).not.toHaveBeenCalled();
  });

  it("enqueues the retry task returned for an invalid generated story", async () => {
    const repo = {
      ...makeRepo(),
      markTaskInvalid: vi.fn().mockResolvedValue({
        retryTask: {
          id: "task-2",
          petId: "pet-1",
          userId: "user-1",
          scheduledFor: new Date("2026-04-05T10:30:00.000Z").getTime(),
        },
      }),
    };
    const queue = { send: vi.fn() };
    const generateStory = vi
      .fn()
      .mockRejectedValue(new Error("invalid ai payload"));

    await processStoryGenerationMessage({
      env: makeEnv({ queue }),
      payload: {
        taskId: "task-1",
        petId: "pet-1",
        userId: "user-1",
        scheduledFor: new Date("2026-04-05T10:20:00.000Z").getTime(),
      },
      repo,
      generateStory,
    });

    expect(queue.send).toHaveBeenCalledWith(
      {
        taskId: "task-2",
        petId: "pet-1",
        userId: "user-1",
        scheduledFor: new Date("2026-04-05T10:30:00.000Z").getTime(),
      },
      expect.objectContaining({ delaySeconds: expect.any(Number) }),
    );
  });
});
