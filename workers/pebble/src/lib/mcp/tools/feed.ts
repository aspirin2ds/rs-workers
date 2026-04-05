import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { getDb } from "../../db";
import { createStoryGenerationRepository } from "../../story-generation/repository";
import { itemMap } from "../../../data/items";

function getPlayerId(): string {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId as string | undefined;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export function registerFeedTool(server: McpServer, env: CloudflareBindings) {
  server.registerTool(
    "feed",
    {
      description:
        "Check on your pet — see what they've been up to, read their stories, and collect any items they found.",
      inputSchema: {},
    },
    async () => {
      try {
        const playerId = getPlayerId();
        const repo = createStoryGenerationRepository(getDb(env));
        const pet = await repo.getPetForFeed(playerId);

        if (!pet) {
          return {
            content: [
              {
                type: "text" as const,
                text: "You don't have a pet yet! Use `adopt` to get one.",
              },
            ],
          };
        }

        const now = Date.now();
        const stories = await repo.listRecentVisibleStories(pet.id);
        const unconsumedStories = stories.filter((story: any) => !story.consumedAt);
        const shouldResetBudget = unconsumedStories.length > 0;

        const collectedItems: string[] = [];
        const itemCounts = new Map<string, number>();

        for (const story of unconsumedStories) {
          const itemsFound = story.itemsFound
            ? (JSON.parse(story.itemsFound) as string[])
            : [];
          for (const itemId of itemsFound) {
            const item = itemMap.get(itemId);
            if (item) {
              collectedItems.push(item.name);
            }
            itemCounts.set(itemId, (itemCounts.get(itemId) ?? 0) + 1);
          }
        }

        if (unconsumedStories.length > 0) {
          await repo.consumeStories({
            storyIds: unconsumedStories.map((story: any) => story.id),
            consumedAt: now,
          });
          await repo.upsertInventoryItems({
            petId: pet.id,
            itemCounts,
          });
        }

        const activeHead = await repo.getActiveChainHeadForUser(playerId);
        let generationActive = Boolean(activeHead);
        let remainingGenerations = activeHead?.chain.remainingGenerations ?? null;
        let remainingRetries = activeHead?.chain.remainingRetries ?? null;

        if (!activeHead) {
          const bootstrapped = await repo.bootstrapChain({
            userId: playerId,
            petId: pet.id,
            now,
            minDelaySeconds: env.STORY_MIN_DELAY_SECONDS,
            generationBudget: env.STORY_MAX_GENERATIONS,
            retryBudget: env.STORY_MAX_RETRIES,
          });
          await env.STORY_QUEUE.send(
            {
              taskId: bootstrapped.task.id,
              petId: pet.id,
              userId: playerId,
              scheduledFor: bootstrapped.task.scheduledFor,
            },
            {
              delaySeconds: Math.max(
                0,
                Math.floor((bootstrapped.task.scheduledFor - now) / 1000),
              ),
            },
          );
          generationActive = true;
          remainingGenerations = bootstrapped.chain.remainingGenerations;
          remainingRetries = bootstrapped.chain.remainingRetries;
        } else if (shouldResetBudget) {
          await repo.resetActiveChainBudget({
            chainId: activeHead.chain.id,
            generationBudget: env.STORY_MAX_GENERATIONS,
            retryBudget: env.STORY_MAX_RETRIES,
          });
          remainingGenerations = env.STORY_MAX_GENERATIONS;
          remainingRetries = env.STORY_MAX_RETRIES;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  pet: {
                    name: pet.name,
                    asciiArt: pet.asciiArt,
                    status: "home",
                    traits: {
                      curiosity: pet.curiosity,
                      energy: pet.energy,
                      sociability: pet.sociability,
                      courage: pet.courage,
                      creativity: pet.creativity,
                    },
                  },
                  stories: stories.map((story: any) => ({
                    id: story.id,
                    storyTime:
                      story.storyTime instanceof Date
                        ? story.storyTime.getTime()
                        : story.storyTime,
                    story: story.story,
                    activityType: story.activityType,
                    location: story.location,
                    itemsFound: story.itemsFound
                      ? JSON.parse(story.itemsFound)
                      : [],
                  })),
                  collected: collectedItems,
                  generation: {
                    active: generationActive,
                    remainingGenerations,
                    remainingRetries,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true as const,
        };
      }
    },
  );
}
