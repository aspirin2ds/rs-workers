import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { pet as petTable, inventory as inventoryTable } from "@repo/db/schema";
import { getDb } from "../../db";
import { requirePlayer } from "../../auth";
import { itemMap } from "../../../data/items";

export function registerItemsTool(server: McpServer, env: CloudflareBindings) {
  server.registerTool(
    "items",
    {
      description: "View your inventory — all items you own.",
      inputSchema: {},
    },
    async () => {
      try {
        const { userId: playerId } = await requirePlayer(env);
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
                text: "You don't have a pet yet. Open `feed` first to bootstrap Pebble.",
              },
            ],
          };
        }

        const petId = pets[0].id;

        const items = await db
          .select({ itemId: inventoryTable.itemId, quantity: inventoryTable.quantity })
          .from(inventoryTable)
          .where(eq(inventoryTable.petId, petId));

        if (items.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Your inventory is empty." }],
          };
        }

        const byCategory: Record<string, string[]> = {};
        for (const inventory of items) {
          const def = itemMap.get(inventory.itemId);
          const category = def?.category ?? "unknown";
          const line = `  ${def?.name ?? inventory.itemId} x${inventory.quantity} — ${def?.description ?? ""}`;
          if (!byCategory[category]) {
            byCategory[category] = [];
          }
          byCategory[category].push(line);
        }

        const sections = Object.entries(byCategory)
          .map(([category, lines]) => `[${category}]\n${lines.join("\n")}`)
          .join("\n\n");

        return {
          content: [{ type: "text" as const, text: `📦 Inventory:\n\n${sections}` }],
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
