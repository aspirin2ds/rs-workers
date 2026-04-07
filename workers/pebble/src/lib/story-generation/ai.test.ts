import { describe, expect, it, vi } from "vitest";
import { generateStory } from "./ai";

describe("generateStory", () => {
  it("requests Workers AI structured output with json_schema response format", async () => {
    const run = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        story: "Basalt found a quiet path.",
      }),
    });

    await generateStory(
      { AI: { run } } as unknown as CloudflareBindings,
      "Write one story as JSON.",
    );

    expect(run).toHaveBeenCalledWith(
      "@cf/meta/llama-3.1-8b-instruct",
      expect.objectContaining({
        response_format: expect.objectContaining({
          type: "json_schema",
          json_schema: expect.objectContaining({
            type: "object",
          }),
        }),
      }),
    );
  });
});
