import { z } from "zod";
import type { AiStoryResponse } from "./types";

const aiStoryResponse = z.object({
  story: z.string().min(1),
  activityType: z.string().optional(),
  location: z.string().optional(),
  itemsFound: z.array(z.string()).optional(),
  proposedNextAt: z.number().int().optional(),
});

export async function generateStory(
  env: CloudflareBindings,
  prompt: string,
): Promise<AiStoryResponse> {
  const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct" as keyof AiModels, {
    prompt,
    response_format: { type: "json_object" },
  });
  const text =
    typeof response === "string"
      ? response
      : "response" in response
        ? String(response.response)
        : JSON.stringify(response);

  return aiStoryResponse.parse(JSON.parse(text));
}
