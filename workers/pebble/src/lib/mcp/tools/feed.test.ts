import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFeedTool } from "./feed";

const { getMcpAuthContext, getDb, createStoryGenerationRepository } = vi.hoisted(
  () => ({
    getMcpAuthContext: vi.fn(),
    getDb: vi.fn(),
    createStoryGenerationRepository: vi.fn(),
  }),
);

vi.mock("agents/mcp", () => ({
  getMcpAuthContext,
}));

vi.mock("../../db", () => ({
  getDb,
}));

vi.mock("../../story-generation/repository", () => ({
  createStoryGenerationRepository,
}));

function makeRepository(overrides: Record<string, unknown> = {}) {
  return {
    getPetForFeed: vi.fn().mockResolvedValue({
      id: "pet-1",
      name: "Basalt",
      asciiArt: null,
      curiosity: 34,
      energy: 74,
      sociability: 88,
      courage: 51,
      creativity: 78,
    }),
    listRecentVisibleStories: vi.fn().mockResolvedValue([]),
    consumeStories: vi.fn().mockResolvedValue(undefined),
    upsertInventoryItems: vi.fn().mockResolvedValue(undefined),
    getActiveChainHeadForUser: vi.fn().mockResolvedValue(null),
    bootstrapChain: vi.fn().mockResolvedValue({
      chain: {
        id: "chain-1",
        remainingGenerations: 5,
        remainingRetries: 2,
      },
      task: {
        id: "task-1",
        scheduledFor: new Date("2026-04-05T10:10:00.000Z").getTime(),
      },
    }),
    resetActiveChainBudget: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function getHandler(repo: ReturnType<typeof makeRepository>) {
  const registerTool = vi.fn();
  const server = { registerTool } as never;

  getDb.mockReturnValue({});
  createStoryGenerationRepository.mockReturnValue(repo);

  registerFeedTool(server, {
    STORY_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
    STORY_MIN_DELAY_SECONDS: 600,
    STORY_MAX_GENERATIONS: 5,
    STORY_MAX_RETRIES: 2,
  } as never);

  return {
    handler: registerTool.mock.calls[0]?.[2] as () => Promise<{
      content: Array<{ text: string }>;
      isError?: boolean;
    }>,
    envQueueSend: (
      registerTool.mock.calls.length,
      (server as never),
      undefined
    ),
  };
}

describe("registerFeedTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMcpAuthContext.mockReturnValue({
      props: {
        userId: "user-1",
      },
    });
  });

  it("creates a new chain and root task on empty bootstrap when no live task exists", async () => {
    const repo = makeRepository();
    const registerTool = vi.fn();
    const server = { registerTool } as never;
    const send = vi.fn().mockResolvedValue(undefined);

    getDb.mockReturnValue({});
    createStoryGenerationRepository.mockReturnValue(repo);

    registerFeedTool(server, {
      STORY_QUEUE: { send },
      STORY_MIN_DELAY_SECONDS: 600,
      STORY_MAX_GENERATIONS: 5,
      STORY_MAX_RETRIES: 2,
    } as never);

    const handler = registerTool.mock.calls[0]?.[2] as () => Promise<{
      content: Array<{ text: string }>;
    }>;
    const result = await handler();
    const payload = JSON.parse(result.content[0]!.text);

    expect(repo.bootstrapChain).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(payload.generation.active).toBe(true);
  });

  it("resets the active chain budget but does not create a new task when one queued task already exists", async () => {
    const repo = makeRepository({
      listRecentVisibleStories: vi.fn().mockResolvedValue([
        {
          id: "story-1",
          storyTime: new Date("2026-04-05T10:00:00.000Z"),
          story: "Basalt drifted.",
          itemsFound: "[\"rice-ball\"]",
          consumedAt: null,
        },
      ]),
      getActiveChainHeadForUser: vi.fn().mockResolvedValue({
        chain: {
          id: "chain-1",
          remainingGenerations: 4,
          remainingRetries: 1,
        },
        task: {
          id: "task-1",
          chainId: "chain-1",
          scheduledFor: new Date("2026-04-05T10:10:00.000Z").getTime(),
        },
      }),
    });
    const registerTool = vi.fn();
    const server = { registerTool } as never;

    getDb.mockReturnValue({});
    createStoryGenerationRepository.mockReturnValue(repo);

    registerFeedTool(server, {
      STORY_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
      STORY_MIN_DELAY_SECONDS: 600,
      STORY_MAX_GENERATIONS: 5,
      STORY_MAX_RETRIES: 2,
    } as never);

    const handler = registerTool.mock.calls[0]?.[2] as () => Promise<{
      content: Array<{ text: string }>;
    }>;
    await handler();

    expect(repo.resetActiveChainBudget).toHaveBeenCalledTimes(1);
    expect(repo.bootstrapChain).not.toHaveBeenCalled();
  });

  it("does not create a new chain during in-flight idle polling with no unconsumed stories", async () => {
    const repo = makeRepository({
      getActiveChainHeadForUser: vi.fn().mockResolvedValue({
        chain: {
          id: "chain-1",
          remainingGenerations: 4,
          remainingRetries: 1,
        },
        task: {
          id: "task-1",
          chainId: "chain-1",
          scheduledFor: new Date("2026-04-05T10:10:00.000Z").getTime(),
        },
      }),
    });
    const registerTool = vi.fn();
    const server = { registerTool } as never;

    getDb.mockReturnValue({});
    createStoryGenerationRepository.mockReturnValue(repo);

    registerFeedTool(server, {
      STORY_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
      STORY_MIN_DELAY_SECONDS: 600,
      STORY_MAX_GENERATIONS: 5,
      STORY_MAX_RETRIES: 2,
    } as never);

    const handler = registerTool.mock.calls[0]?.[2] as () => Promise<{
      content: Array<{ text: string }>;
    }>;
    await handler();

    expect(repo.bootstrapChain).not.toHaveBeenCalled();
    expect(repo.resetActiveChainBudget).not.toHaveBeenCalled();
  });
});
