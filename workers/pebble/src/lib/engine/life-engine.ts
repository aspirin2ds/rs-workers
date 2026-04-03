import {
  eq,
  and,
  gte,
  lt,
  desc,
} from "drizzle-orm";
import {
  story as storyTable,
  pack as packTable,
  item as itemTable,
} from "@repo/db/schema";
import { drizzle } from "drizzle-orm/d1";
import { SeededRng, makeWindowSeed } from "./rng";
import {
  computeHomeActivityWeights,
  shouldDepart,
  pickTripDuration,
  pickDestination,
  shouldFindItem,
  shouldCraftItem,
} from "./activities";
import { findEncountersBatch } from "./encounters";
import { WINDOW_MINUTES } from "../../data/activities";
import { locations } from "../../data/locations";
import type { Location } from "../../data/locations";

const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

interface PetRow {
  id: string;
  seed: number;
  curiosity: number;
  energy: number;
  sociability: number;
  courage: number;
  creativity: number;
  lastCheckedAt: Date;
}

export interface ComputedStory {
  petId: string;
  timeWindow: number;
  activityType: string;
  location: string | null;
  encounteredPetId: string | null;
  itemsFound: string[] | null;
}

interface ExistingStoryState {
  timeWindow: number;
  activityType: string;
  location: string | null;
}

function windowFloor(timestamp: number): number {
  return Math.floor(timestamp / WINDOW_MS) * WINDOW_MS;
}

function getTimeWindows(lastCheckedAt: number, now: number): number[] {
  const windows: number[] = [];
  let window = windowFloor(lastCheckedAt) + WINDOW_MS;
  const end = windowFloor(now);

  while (window <= end) {
    windows.push(window);
    window += WINDOW_MS;
  }

  return windows;
}

interface SimState {
  traveling: boolean;
  tripWindowsLeft: number;
  currentLocation: Location | null;
}

function isStoryWindowConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("story_petId_timeWindow_unique") ||
    message.includes("UNIQUE constraint failed: story.pet_id, story.time_window")
  );
}

function getLocationByName(name: string | null): Location | null {
  if (!name) {
    return null;
  }

  return locations.find((location) => location.name === name) ?? null;
}

function getTripDurationForWindow(
  petSeed: number,
  window: number,
  traits: {
    curiosity: number;
    energy: number;
    sociability: number;
    courage: number;
    creativity: number;
  }
): number {
  const rng = new SeededRng(makeWindowSeed(petSeed, window));
  return pickTripDuration(rng, traits);
}

function deriveInitialState(
  latestBeforeRange: ExistingStoryState | undefined,
  latestDepartureBeforeRange: Pick<ExistingStoryState, "timeWindow"> | undefined,
  firstWindow: number,
  petSeed: number,
  traits: {
    curiosity: number;
    energy: number;
    sociability: number;
    courage: number;
    creativity: number;
  }
): SimState {
  if (
    !latestBeforeRange ||
    (latestBeforeRange.activityType !== "traveling" &&
      latestBeforeRange.activityType !== "exploring")
  ) {
    return {
      traveling: false,
      tripWindowsLeft: 0,
      currentLocation: null,
    };
  }

  const departureWindow = latestDepartureBeforeRange?.timeWindow;
  if (departureWindow === undefined) {
    return {
      traveling: true,
      tripWindowsLeft: 1,
      currentLocation: getLocationByName(latestBeforeRange.location),
    };
  }

  const duration = getTripDurationForWindow(petSeed, departureWindow, traits);
  const processedSinceDeparture = Math.max(
    0,
    Math.floor((firstWindow - departureWindow) / WINDOW_MS) - 1
  );

  return {
    traveling: true,
    tripWindowsLeft: Math.max(1, duration - processedSinceDeparture),
    currentLocation: getLocationByName(latestBeforeRange.location),
  };
}

function applyExistingStoryToState(
  state: SimState,
  story: ExistingStoryState,
  petSeed: number,
  traits: {
    curiosity: number;
    energy: number;
    sociability: number;
    courage: number;
    creativity: number;
  }
) {
  if (story.activityType === "traveling") {
    state.traveling = true;
    state.tripWindowsLeft = getTripDurationForWindow(petSeed, story.timeWindow, traits);
    state.currentLocation = getLocationByName(story.location);
    return;
  }

  if (story.activityType === "exploring") {
    state.traveling = true;
    state.tripWindowsLeft = Math.max(1, state.tripWindowsLeft - 1);
    state.currentLocation = getLocationByName(story.location);
    return;
  }

  state.traveling = false;
  state.tripWindowsLeft = 0;
  state.currentLocation = null;
}

export async function runLifeEngine(
  db: ReturnType<typeof drizzle>,
  pet: PetRow,
  now: number
): Promise<ComputedStory[]> {
  const lastChecked = pet.lastCheckedAt.getTime();
  const windows = getTimeWindows(lastChecked, now);

  if (windows.length === 0) {
    return [];
  }

  const maxWindows = 200;
  const windowsToProcess = windows.slice(-maxWindows);
  const firstWindow = windowsToProcess[0];

  const existingStories = await db
    .select({
      timeWindow: storyTable.timeWindow,
      activityType: storyTable.activityType,
      location: storyTable.location,
    })
    .from(storyTable)
    .where(
      and(
        eq(storyTable.petId, pet.id),
        gte(storyTable.timeWindow, firstWindow)
      )
    );
  const existingMap = new Map(
    existingStories.map((story) => [story.timeWindow, story])
  );

  const packItems = await db
    .select({
      itemId: packTable.itemId,
      quantity: packTable.quantity,
      effectTarget: itemTable.effectTarget,
      effectStrength: itemTable.effectStrength,
    })
    .from(packTable)
    .innerJoin(itemTable, eq(packTable.itemId, itemTable.id))
    .where(eq(packTable.petId, pet.id));

  let hasPackItems = packItems.length > 0;
  let shouldClearPack = false;

  const traits = {
    curiosity: pet.curiosity,
    energy: pet.energy,
    sociability: pet.sociability,
    courage: pet.courage,
    creativity: pet.creativity,
  };
  for (const packItem of packItems) {
    if (packItem.effectTarget && packItem.effectStrength) {
      const key = packItem.effectTarget as keyof typeof traits;
      if (key in traits) {
        traits[key] = Math.min(
          100,
          traits[key] + packItem.effectStrength * packItem.quantity
        );
      }
    }
  }

  const latestBeforeRange = await db
    .select({
      timeWindow: storyTable.timeWindow,
      activityType: storyTable.activityType,
      location: storyTable.location,
    })
    .from(storyTable)
    .where(
      and(
        eq(storyTable.petId, pet.id),
        lt(storyTable.timeWindow, firstWindow)
      )
    )
    .orderBy(desc(storyTable.timeWindow))
    .limit(1);

  const latestDepartureBeforeRange = await db
    .select({
      timeWindow: storyTable.timeWindow,
    })
    .from(storyTable)
    .where(
      and(
        eq(storyTable.petId, pet.id),
        eq(storyTable.activityType, "traveling"),
        lt(storyTable.timeWindow, firstWindow)
      )
    )
    .orderBy(desc(storyTable.timeWindow))
    .limit(1);

  const state = deriveInitialState(
    latestBeforeRange[0],
    latestDepartureBeforeRange[0],
    firstWindow,
    pet.seed,
    traits
  );

  const newStories: ComputedStory[] = [];

  for (const window of windowsToProcess) {
    const existingStory = existingMap.get(window);
    if (existingStory) {
      applyExistingStoryToState(state, existingStory, pet.seed, traits);
      continue;
    }

    const rng = new SeededRng(makeWindowSeed(pet.seed, window));

    let entry: ComputedStory;

    if (state.traveling) {
      state.tripWindowsLeft--;

      if (state.tripWindowsLeft <= 0) {
        entry = {
          petId: pet.id,
          timeWindow: window,
          activityType: "returning",
          location: state.currentLocation?.name ?? null,
          encounteredPetId: null,
          itemsFound: null,
        };
        state.traveling = false;
        state.currentLocation = null;
      } else {
        const location = state.currentLocation!;
        let itemsFound: string[] | null = null;

        if (shouldFindItem(rng, traits) && location.souvenirIds.length > 0) {
          const foundId = rng.pick(location.souvenirIds);
          itemsFound = [foundId];
        }

        if (shouldCraftItem(rng, traits) && location.souvenirIds.length > 0) {
          const craftedId = rng.pick(location.souvenirIds);
          itemsFound = itemsFound ? [...itemsFound, craftedId] : [craftedId];
        }

        entry = {
          petId: pet.id,
          timeWindow: window,
          activityType: "exploring",
          location: location.name,
          encounteredPetId: null,
          itemsFound: itemsFound && itemsFound.length > 0 ? itemsFound : null,
        };
      }
    } else if (shouldDepart(rng, traits, hasPackItems)) {
      const destination = pickDestination(rng, traits);
      const duration = pickTripDuration(rng, traits);

      state.traveling = true;
      state.tripWindowsLeft = duration;
      state.currentLocation = destination;

      if (hasPackItems) {
        shouldClearPack = true;
        hasPackItems = false;
      }

      entry = {
        petId: pet.id,
        timeWindow: window,
        activityType: "traveling",
        location: destination.name,
        encounteredPetId: null,
        itemsFound: null,
      };
    } else {
      const { activities, weights } = computeHomeActivityWeights(traits);
      const activity = rng.weightedPick(activities, weights);

      entry = {
        petId: pet.id,
        timeWindow: window,
        activityType: activity.type,
        location: null,
        encounteredPetId: null,
        itemsFound: null,
      };
    }

    newStories.push(entry);
  }

  const encounterQueries = newStories
    .filter((story) => story.activityType === "exploring" && story.location)
    .map((story) => ({ timeWindow: story.timeWindow, location: story.location! }));

  if (encounterQueries.length > 0) {
    const encounterMap = await findEncountersBatch(db, encounterQueries, pet.id);
    for (const story of newStories) {
      if (story.activityType === "exploring" && story.location) {
        const key = `${story.timeWindow}:${story.location}`;
        story.encounteredPetId = encounterMap.get(key) ?? null;
      }
    }
  }

  if (newStories.length > 0) {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(storyTable).values(
          newStories.map((story) => ({
            id: crypto.randomUUID(),
            petId: story.petId,
            timeWindow: story.timeWindow,
            activityType: story.activityType,
            location: story.location,
            encounteredPetId: story.encounteredPetId,
            itemsFound: story.itemsFound ? JSON.stringify(story.itemsFound) : null,
            collected: false,
          }))
        );

        for (const story of newStories) {
          if (!story.encounteredPetId || !story.location) {
            continue;
          }

          const counterpart = await tx
            .select({
              id: storyTable.id,
              encounteredPetId: storyTable.encounteredPetId,
            })
            .from(storyTable)
            .where(
              and(
                eq(storyTable.petId, story.encounteredPetId),
                eq(storyTable.timeWindow, story.timeWindow),
                eq(storyTable.location, story.location),
                eq(storyTable.activityType, "exploring")
              )
            )
            .limit(1);

          if (counterpart[0] && !counterpart[0].encounteredPetId) {
            await tx
              .update(storyTable)
              .set({ encounteredPetId: pet.id })
              .where(eq(storyTable.id, counterpart[0].id));
          }
        }

        if (shouldClearPack) {
          await tx.delete(packTable).where(eq(packTable.petId, pet.id));
        }

      });
    } catch (error) {
      if (isStoryWindowConflict(error)) {
        return [];
      }

      throw error;
    }
  }

  return newStories;
}
