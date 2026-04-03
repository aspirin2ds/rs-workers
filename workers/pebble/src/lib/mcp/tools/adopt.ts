import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getMcpAuthContext } from "agents/mcp";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { inventory as inventoryTable, pet as petTable } from "@repo/db/schema";
import { getDb } from "../../db";

function getPlayerId(): string {
  const ctx = getMcpAuthContext();
  const userId = ctx?.props?.userId as string | undefined;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

function rollTrait(): number {
  return Math.floor(Math.random() * 80) + 10;
}

function isExistingPetConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("pet_playerId_unique") ||
    message.includes("UNIQUE constraint failed: pet.player_id")
  );
}

export function registerAdoptTool(server: McpServer, env: CloudflareBindings) {
  server.registerTool(
    "adopt",
    {
      description: "Adopt a new pet. Choose a name and receive a unique creature with its own personality.",
      inputSchema: {
        name: z.string().min(1).max(30).describe("Name for your pet"),
      },
    },
    async ({ name }) => {
      try {
        const playerId = getPlayerId();
        const db = getDb(env);

        const existing = await db
          .select({ id: petTable.id })
          .from(petTable)
          .where(eq(petTable.playerId, playerId))
          .limit(1);

        if (existing.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "You already have a pet! Use the `feed` tool to check on them.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true as const,
          };
        }

        const seed = Math.floor(Math.random() * 2147483647);
        const traits = {
          curiosity: rollTrait(),
          energy: rollTrait(),
          sociability: rollTrait(),
          courage: rollTrait(),
          creativity: rollTrait(),
        };

        const petId = crypto.randomUUID();
        const now = new Date();

        await db.transaction(async (tx) => {
          await tx.insert(petTable).values({
            id: petId,
            playerId,
            name,
            seed,
            asciiArt: null,
            ...traits,
            lastCheckedAt: now,
            createdAt: now,
          });

          await tx.insert(inventoryTable).values([
            { id: crypto.randomUUID(), petId, itemId: "rice-ball", quantity: 3 },
            { id: crypto.randomUUID(), petId, itemId: "compass", quantity: 1 },
          ]);
        });

        const traitLines = [
          `Curiosity: ${"█".repeat(Math.floor(traits.curiosity / 10))}${"░".repeat(10 - Math.floor(traits.curiosity / 10))} ${traits.curiosity}`,
          `Energy:    ${"█".repeat(Math.floor(traits.energy / 10))}${"░".repeat(10 - Math.floor(traits.energy / 10))} ${traits.energy}`,
          `Social:    ${"█".repeat(Math.floor(traits.sociability / 10))}${"░".repeat(10 - Math.floor(traits.sociability / 10))} ${traits.sociability}`,
          `Courage:   ${"█".repeat(Math.floor(traits.courage / 10))}${"░".repeat(10 - Math.floor(traits.courage / 10))} ${traits.courage}`,
          `Creative:  ${"█".repeat(Math.floor(traits.creativity / 10))}${"░".repeat(10 - Math.floor(traits.creativity / 10))} ${traits.creativity}`,
        ].join("\n");

        const dominantTrait = Object.entries(traits).sort(([, left], [, right]) => right - left)[0][0];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  petId,
                  name,
                  traits,
                  dominantTrait,
                  traitBars: traitLines,
                  starterItems: ["3x rice-ball", "1x compass"],
                  hint: "Generate a unique ASCII art creature (max 6 lines, max 20 chars wide) for this pet based on its personality. Then call save-story with { petId, asciiArt } to save it. The creature should be abstract and cute.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        if (isExistingPetConflict(err)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "You already have a pet! Use the `feed` tool to check on them.",
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true as const,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
          isError: true as const,
        };
      }
    }
  );
}
