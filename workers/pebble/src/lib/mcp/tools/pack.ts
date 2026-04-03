import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import {
  pet as petTable,
  pack as packTable,
  inventory as inventoryTable,
} from "@repo/db/schema";
import { getDb } from "../../db";
import { itemMap } from "../../../data/items";

function getPlayerId(): string {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId as string | undefined;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export function registerPackTool(server: McpServer, env: CloudflareBindings) {
  server.registerTool(
    "pack",
    {
      description: "Add an item from your inventory to your pet's travel pack, or view the current pack contents.",
      inputSchema: {
        action: z.enum(["add", "remove", "view"]).describe("What to do: add item, remove item, or view pack"),
        itemId: z.string().optional().describe("Item ID to add or remove (not needed for view)"),
      },
    },
    async ({ action, itemId }) => {
      try {
        const playerId = getPlayerId();
        const db = getDb(env);

        const pets = await db
          .select({ id: petTable.id })
          .from(petTable)
          .where(eq(petTable.playerId, playerId))
          .limit(1);

        if (pets.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "You don't have a pet yet! Use `adopt` first.",
              },
            ],
          };
        }

        const petId = pets[0].id;

        if (action === "view") {
          const packItems = await db
            .select({ itemId: packTable.itemId, quantity: packTable.quantity })
            .from(packTable)
            .where(eq(packTable.petId, petId));

          if (packItems.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Pack is empty. Use `pack` with action \"add\" to prepare items for your pet's next trip.",
                },
              ],
            };
          }

          const lines = packItems.map((packItem) => {
            const def = itemMap.get(packItem.itemId);
            return `• ${def?.name ?? packItem.itemId} x${packItem.quantity}`;
          });

          return {
            content: [{ type: "text" as const, text: `🎒 Pack:\n${lines.join("\n")}` }],
          };
        }

        if (!itemId) {
          return {
            content: [{ type: "text" as const, text: "Please provide an itemId." }],
            isError: true as const,
          };
        }

        if (action === "add") {
          const added = await db.transaction(async (tx) => {
            const inventory = await tx
              .select({ id: inventoryTable.id, quantity: inventoryTable.quantity })
              .from(inventoryTable)
              .where(
                and(eq(inventoryTable.petId, petId), eq(inventoryTable.itemId, itemId))
              )
              .limit(1);

            if (inventory.length === 0 || inventory[0].quantity <= 0) {
              return false;
            }

            if (inventory[0].quantity === 1) {
              await tx.delete(inventoryTable).where(eq(inventoryTable.id, inventory[0].id));
            } else {
              await tx
                .update(inventoryTable)
                .set({ quantity: inventory[0].quantity - 1 })
                .where(eq(inventoryTable.id, inventory[0].id));
            }

            const existingPack = await tx
              .select({ id: packTable.id, quantity: packTable.quantity })
              .from(packTable)
              .where(and(eq(packTable.petId, petId), eq(packTable.itemId, itemId)))
              .limit(1);

            if (existingPack.length > 0) {
              await tx
                .update(packTable)
                .set({ quantity: existingPack[0].quantity + 1 })
                .where(eq(packTable.id, existingPack[0].id));
            } else {
              await tx.insert(packTable).values({
                id: crypto.randomUUID(),
                petId,
                itemId,
                quantity: 1,
              });
            }

            return true;
          });

          if (!added) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `You don't have any ${itemMap.get(itemId)?.name ?? itemId} in your inventory.`,
                },
              ],
            };
          }

          const name = itemMap.get(itemId)?.name ?? itemId;
          return {
            content: [{ type: "text" as const, text: `Added ${name} to the pack.` }],
          };
        }

        if (action === "remove") {
          const removed = await db.transaction(async (tx) => {
            const existing = await tx
              .select({ id: packTable.id, quantity: packTable.quantity })
              .from(packTable)
              .where(and(eq(packTable.petId, petId), eq(packTable.itemId, itemId)))
              .limit(1);

            if (existing.length === 0) {
              return false;
            }

            if (existing[0].quantity === 1) {
              await tx.delete(packTable).where(eq(packTable.id, existing[0].id));
            } else {
              await tx
                .update(packTable)
                .set({ quantity: existing[0].quantity - 1 })
                .where(eq(packTable.id, existing[0].id));
            }

            const inventory = await tx
              .select({ id: inventoryTable.id, quantity: inventoryTable.quantity })
              .from(inventoryTable)
              .where(
                and(eq(inventoryTable.petId, petId), eq(inventoryTable.itemId, itemId))
              )
              .limit(1);

            if (inventory.length > 0) {
              await tx
                .update(inventoryTable)
                .set({ quantity: inventory[0].quantity + 1 })
                .where(eq(inventoryTable.id, inventory[0].id));
            } else {
              await tx.insert(inventoryTable).values({
                id: crypto.randomUUID(),
                petId,
                itemId,
                quantity: 1,
              });
            }

            return true;
          });

          if (!removed) {
            return {
              content: [{ type: "text" as const, text: "That item isn't in the pack." }],
            };
          }

          const name = itemMap.get(itemId)?.name ?? itemId;
          return {
            content: [{ type: "text" as const, text: `Removed ${name} from the pack.` }],
          };
        }

        return {
          content: [{ type: "text" as const, text: "Invalid action." }],
          isError: true as const,
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
