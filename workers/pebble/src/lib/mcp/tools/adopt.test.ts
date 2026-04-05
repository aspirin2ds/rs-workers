import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAdoptTool } from "./adopt";

const { getMcpAuthContext, getDb } = vi.hoisted(() => ({
  getMcpAuthContext: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("agents/mcp", () => ({
  getMcpAuthContext,
}));

vi.mock("../../db", () => ({
  getDb,
}));

function makeSelectResult<T>(result: T) {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
  };

  return chain;
}

describe("registerAdoptTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMcpAuthContext.mockReturnValue({
      props: {
        userId: "user-1",
      },
    });
  });

  it("adopts successfully using a D1-compatible write path", async () => {
    const registerTool = vi.fn();
    const server = { registerTool } as never;

    getDb.mockReturnValue({
      select: () => makeSelectResult([]),
      insert: () => ({
        values: (value: unknown) => value,
      }),
      batch: vi.fn(async () => []),
      transaction: vi.fn(async () => {
        throw new Error("Failed query: begin\nparams: ");
      }),
    });

    registerAdoptTool(server, {} as CloudflareBindings);

    const handler = registerTool.mock.calls[0]?.[2] as ((input: { name: string }) => Promise<{
      content: Array<{ text: string }>;
      isError?: boolean;
    }>);

    const result = await handler({ name: "Basalt" });
    const payload = JSON.parse(result.content[0]!.text);

    expect(result.isError).toBeUndefined();
    expect(payload.name).toBe("Basalt");
    expect(payload.starterItems).toEqual(["3x rice-ball", "1x compass"]);
  });
});
