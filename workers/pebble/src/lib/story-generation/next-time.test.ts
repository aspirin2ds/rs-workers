import { describe, expect, it } from "vitest";
import { resolveNextStoryTime } from "./next-time";

describe("resolveNextStoryTime", () => {
  it("clamps the AI-proposed time into the allowed min/max range", () => {
    const storyTime = new Date("2026-04-05T10:00:00.000Z").getTime();

    const nextTime = resolveNextStoryTime({
      storyTime,
      proposedNextAt: new Date("2026-04-05T10:01:00.000Z").getTime(),
      minDelaySeconds: 600,
      maxDelaySeconds: 1800,
    });

    expect(nextTime).toBe(new Date("2026-04-05T10:10:00.000Z").getTime());
  });
});
