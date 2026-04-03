import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { eq, and, desc } from "drizzle-orm";
import {
  pet as petTable,
  story as storyTable,
  inventory as inventoryTable,
} from "@repo/db/schema";
import { getDb } from "../../db";
import { runLifeEngine } from "../../engine/life-engine";
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
      description: "Check on your pet — see what they've been up to, read their stories, and collect any items they found.",
      inputSchema: {},
    },
    async () => {
      try {
        const playerId = getPlayerId();
        const db = getDb(env);

        const pets = await db
          .select()
          .from(petTable)
          .where(eq(petTable.playerId, playerId))
          .limit(1);

        if (pets.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "You don't have a pet yet! Use `adopt` to get one.",
              },
            ],
          };
        }

        const pet = pets[0];
        const now = Date.now();

        await runLifeEngine(db, pet, now);

        const uncollected = await db
          .select()
          .from(storyTable)
          .where(and(eq(storyTable.petId, pet.id), eq(storyTable.collected, false)));

        const collectedItems: string[] = [];
        const uncollectedIds: string[] = [];
        const itemCounts = new Map<string, number>();
        for (const entry of uncollected) {
          uncollectedIds.push(entry.id);
          if (entry.itemsFound) {
            const items = JSON.parse(entry.itemsFound) as string[];
            for (const id of items) {
              const def = itemMap.get(id);
              if (def) {
                collectedItems.push(def.name);
              }
              itemCounts.set(id, (itemCounts.get(id) ?? 0) + 1);
            }
          }
        }

        if (uncollectedIds.length > 0 || itemCounts.size > 0) {
          await db.transaction(async (tx) => {
            if (itemCounts.size > 0) {
              const existingInventory = await tx
                .select({
                  id: inventoryTable.id,
                  itemId: inventoryTable.itemId,
                  quantity: inventoryTable.quantity,
                })
                .from(inventoryTable)
                .where(eq(inventoryTable.petId, pet.id));

              const existingMap = new Map(
                existingInventory.map((inventory) => [inventory.itemId, inventory])
              );

              const inserts: Array<{
                id: string;
                petId: string;
                itemId: string;
                quantity: number;
              }> = [];
              const updates: Array<{ id: string; quantity: number }> = [];

              for (const [itemId, count] of itemCounts) {
                const existing = existingMap.get(itemId);
                if (existing) {
                  updates.push({ id: existing.id, quantity: existing.quantity + count });
                } else {
                  inserts.push({
                    id: crypto.randomUUID(),
                    petId: pet.id,
                    itemId,
                    quantity: count,
                  });
                }
              }

              if (inserts.length > 0) {
                await tx.insert(inventoryTable).values(inserts);
              }

              for (const update of updates) {
                await tx
                  .update(inventoryTable)
                  .set({ quantity: update.quantity })
                  .where(eq(inventoryTable.id, update.id));
              }
            }

            for (const id of uncollectedIds) {
              await tx
                .update(storyTable)
                .set({ collected: true })
                .where(eq(storyTable.id, id));
            }
          });
        }

        await db
          .update(petTable)
          .set({ lastCheckedAt: new Date(now) })
          .where(eq(petTable.id, pet.id));

        const recentStories = await db
          .select()
          .from(storyTable)
          .where(eq(storyTable.petId, pet.id))
          .orderBy(desc(storyTable.timeWindow))
          .limit(20);

        const latest = recentStories[0];
        const isHome = !latest || !latest.location || latest.activityType === "returning";

        const events = recentStories.reverse().map((story) => ({
          id: story.id,
          activityType: story.activityType,
          location: story.location,
          encounteredPetId: story.encounteredPetId,
          itemsFound: story.itemsFound ? JSON.parse(story.itemsFound) : null,
          narrative: story.story,
          timeWindow: story.timeWindow,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  pet: {
                    name: pet.name,
                    asciiArt: pet.asciiArt,
                    status: isHome ? "home" : "traveling",
                    currentLocation: isHome ? null : latest?.location,
                    traits: {
                      curiosity: pet.curiosity,
                      energy: pet.energy,
                      sociability: pet.sociability,
                      courage: pet.courage,
                      creativity: pet.creativity,
                    },
                  },
                  events,
                  collected: collectedItems,
                  hint: "Narrate any events where narrative is null in a cozy, whimsical tone. Then call save-story with { stories: [{ id, narrative }] } to persist them.",
                },
                null,
                2
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
    }
  );
}
