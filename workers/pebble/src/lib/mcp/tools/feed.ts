import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { inventory as inventoryTable, pet as petTable } from "@repo/db/schema";
import { getDb } from "../../db";
import { requirePlayer } from "../../auth";
import { createStoryGenerationRepository } from "../../story-generation/repository";
import { itemMap } from "../../../data/items";

function rollTrait(): number {
  return Math.floor(Math.random() * 80) + 10;
}

async function ensurePetForFeed(
  playerId: string,
  env: CloudflareBindings,
  repo: ReturnType<typeof createStoryGenerationRepository>,
) {
  let pet = await repo.getPetForFeed(playerId);
  let createdPet = false;

  if (pet) {
    return { pet, createdPet };
  }

  const db = getDb(env);
  const petId = crypto.randomUUID();
  const now = new Date();

  try {
    await db.batch([
      db.insert(petTable).values({
        id: petId,
        playerId,
        name: "Pebble",
        seed: Math.floor(Math.random() * 2147483647),
        asciiArt: null,
        curiosity: rollTrait(),
        energy: rollTrait(),
        sociability: rollTrait(),
        courage: rollTrait(),
        creativity: rollTrait(),
        lastCheckedAt: now,
        createdAt: now,
      }),
      db.insert(inventoryTable).values([
        { id: crypto.randomUUID(), petId, itemId: "rice-ball", quantity: 3 },
        { id: crypto.randomUUID(), petId, itemId: "compass", quantity: 1 },
      ]),
    ]);
    createdPet = true;
  } catch {
    // Another request may have created the pet first.
  }

  pet = await repo.getPetForFeed(playerId);
  if (!pet) {
    throw new Error("Unable to initialize pet");
  }

  return { pet, createdPet };
}

export function registerFeedTool(server: McpServer, env: CloudflareBindings) {
  server.registerTool(
    "feed",
    {
      description:
        "Open Pebble. This bootstraps your pet automatically on first use, then returns server-generated stories and collected items. Story generation is asynchronous, so poll again while `generation.active` is true.",
      inputSchema: {},
    },
    async () => {
      try {
        const { userId: playerId } = await requirePlayer(env);
        const repo = createStoryGenerationRepository(getDb(env));
        const { pet, createdPet } = await ensurePetForFeed(playerId, env, repo);

        const now = Date.now();
        const stories = await repo.listRecentVisibleStories(pet.id);
        const unconsumedStories = stories.filter((story) => !story.consumedAt);
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
            storyIds: unconsumedStories.map((story) => story.id),
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
            minDelaySeconds: Number(env.STORY_MIN_DELAY_SECONDS),
            generationBudget: Number(env.STORY_MAX_GENERATIONS),
            retryBudget: Number(env.STORY_MAX_RETRIES),
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
            generationBudget: Number(env.STORY_MAX_GENERATIONS),
            retryBudget: Number(env.STORY_MAX_RETRIES),
          });
          remainingGenerations = Number(env.STORY_MAX_GENERATIONS);
          remainingRetries = Number(env.STORY_MAX_RETRIES);
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
                  stories: stories.map((story) => ({
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
                  bootstrap: {
                    createdPet,
                  },
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
