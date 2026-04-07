import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPackTool } from "./pack";

const { requirePlayer, getDb } = vi.hoisted(() => ({
  requirePlayer: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("../../auth", () => ({
  requirePlayer,
}));

vi.mock("../../db", () => ({
  getDb,
}));

function makeSelectResult<T>(result: T) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
    then: (resolve: (value: T) => unknown) => Promise.resolve(resolve(result)),
  };

  return chain;
}

describe("registerPackTool bootstrap guidance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlayer.mockResolvedValue({
      userId: "user-1",
      email: "test@example.com",
      name: "Test",
    });
  });

  it("tells the caller to open feed first when no pet exists yet", async () => {
    const registerTool = vi.fn();
    const server = { registerTool } as never;

    getDb.mockReturnValue({
      select: () => makeSelectResult([]),
    });

    registerPackTool(server, {} as CloudflareBindings);
    const handler = registerTool.mock.calls[0]?.[2] as (input: {
      action: "view";
    }) => Promise<{ content: Array<{ text: string }> }>;

    const result = await handler({ action: "view" });

    expect(result.content[0]!.text).toContain("Open `feed` first");
    expect(result.content[0]!.text).not.toContain("adopt");
  });
});
