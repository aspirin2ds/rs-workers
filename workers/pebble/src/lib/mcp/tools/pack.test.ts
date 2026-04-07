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

describe("registerPackTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePlayer.mockResolvedValue({
      userId: "user-1",
      email: "test@example.com",
      name: "Test",
    });
  });

  it("adds an item using batch writes when D1 transactions are unavailable", async () => {
    const registerTool = vi.fn();
    const server = { registerTool } as never;
    const selectResults = [
      [{ id: "pet-1" }],
      [{ id: "inv-1", quantity: 2 }],
      [],
    ];

    getDb.mockReturnValue({
      select: () => makeSelectResult(selectResults.shift() ?? []),
      update: () => ({
        set: (value: unknown) => ({
          where: (whereValue: unknown) => ({ value, whereValue }),
        }),
      }),
      delete: () => ({
        where: (whereValue: unknown) => ({ whereValue }),
      }),
      insert: () => ({
        values: (value: unknown) => value,
      }),
      batch: vi.fn(async () => []),
      transaction: vi.fn(async () => {
        throw new Error("Failed query: begin\nparams: ");
      }),
    });

    registerPackTool(server, {} as CloudflareBindings);
    const handler = registerTool.mock.calls[0]?.[2] as ((input: {
      action: "add" | "remove" | "view";
      itemId?: string;
    }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>);

    const result = await handler({ action: "add", itemId: "rice-ball" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Added Rice Ball to the pack.");
  });

  it("removes an item using batch writes when D1 transactions are unavailable", async () => {
    const registerTool = vi.fn();
    const server = { registerTool } as never;
    const selectResults = [
      [{ id: "pet-1" }],
      [{ id: "pack-1", quantity: 1 }],
      [{ id: "inv-1", quantity: 2 }],
    ];

    getDb.mockReturnValue({
      select: () => makeSelectResult(selectResults.shift() ?? []),
      update: () => ({
        set: (value: unknown) => ({
          where: (whereValue: unknown) => ({ value, whereValue }),
        }),
      }),
      delete: () => ({
        where: (whereValue: unknown) => ({ whereValue }),
      }),
      insert: () => ({
        values: (value: unknown) => value,
      }),
      batch: vi.fn(async () => []),
      transaction: vi.fn(async () => {
        throw new Error("Failed query: begin\nparams: ");
      }),
    });

    registerPackTool(server, {} as CloudflareBindings);
    const handler = registerTool.mock.calls[0]?.[2] as ((input: {
      action: "add" | "remove" | "view";
      itemId?: string;
    }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>);

    const result = await handler({ action: "remove", itemId: "rice-ball" });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("Removed Rice Ball from the pack.");
  });
});
