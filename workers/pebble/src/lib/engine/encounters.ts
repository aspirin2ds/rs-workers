import { and, asc, eq, inArray } from "drizzle-orm";
import { story as storyTable } from "@repo/db/schema";
import { drizzle } from "drizzle-orm/d1";

interface EncounterQuery {
  timeWindow: number;
  location: string;
}

/**
 * Batch encounter detection — single query for all (timeWindow, location) pairs.
 * Returns a map from "timeWindow:location" to encountered pet ID.
 */
export async function findEncountersBatch(
  db: ReturnType<typeof drizzle>,
  queries: EncounterQuery[],
  excludePetId: string
): Promise<Map<string, string>> {
  if (queries.length === 0) {
    return new Map();
  }

  const timeWindows = [...new Set(queries.map((query) => query.timeWindow))];
  const locations = [...new Set(queries.map((query) => query.location))];
  const requestedKeys = new Set(
    queries.map((query) => `${query.timeWindow}:${query.location}`)
  );

  const results = await db
    .select({
      petId: storyTable.petId,
      timeWindow: storyTable.timeWindow,
      location: storyTable.location,
    })
    .from(storyTable)
    .where(
      and(
        eq(storyTable.activityType, "exploring"),
        inArray(storyTable.timeWindow, timeWindows),
        inArray(storyTable.location, locations)
      )
    )
    .orderBy(asc(storyTable.petId));

  const encounterMap = new Map<string, string>();
  for (const result of results) {
    if (result.petId !== excludePetId && result.location) {
      const key = `${result.timeWindow}:${result.location}`;
      if (requestedKeys.has(key) && !encounterMap.has(key)) {
        encounterMap.set(key, result.petId);
      }
    }
  }

  return encounterMap;
}
