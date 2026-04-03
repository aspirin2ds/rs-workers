import type { HomeActivity, ActivityTrait } from "../../data/activities";
import {
  homeActivities,
  BASE_DEPART_CHANCE,
  BASE_TRIP_DURATION,
} from "../../data/activities";
import { locations, type Location } from "../../data/locations";
import type { SeededRng } from "./rng";

interface PetTraits {
  curiosity: number;
  energy: number;
  sociability: number;
  courage: number;
  creativity: number;
}

function clampTrait(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function getTraitValue(traits: PetTraits, trait: ActivityTrait): number {
  return clampTrait(traits[trait]);
}

export function computeHomeActivityWeights(
  traits: PetTraits
): { activities: HomeActivity[]; weights: number[] } {
  const weights = homeActivities.map((activity) => {
    let weight = activity.baseWeight;

    if (activity.traitBoost) {
      const traitValue = getTraitValue(traits, activity.traitBoost.trait);
      weight += traitValue * activity.traitBoost.multiplier;
    }

    if (activity.traitPenalty) {
      const traitValue = getTraitValue(traits, activity.traitPenalty.trait);
      weight = Math.max(1, weight - traitValue * activity.traitPenalty.multiplier);
    }

    return weight;
  });

  return { activities: homeActivities, weights };
}

export function shouldDepart(
  rng: SeededRng,
  traits: PetTraits,
  hasPackItems: boolean
): boolean {
  let chance = BASE_DEPART_CHANCE;
  chance += getTraitValue(traits, "energy") * 0.1;
  chance += getTraitValue(traits, "courage") * 0.08;

  if (hasPackItems) {
    chance += 15;
  }

  return rng.next() * 100 < Math.min(100, chance);
}

export function pickTripDuration(rng: SeededRng, traits: PetTraits): number {
  const energyBonus = Math.floor(getTraitValue(traits, "energy") / 25);
  return BASE_TRIP_DURATION + rng.nextInt(0, 2) + energyBonus;
}

export function pickDestination(rng: SeededRng, traits: PetTraits): Location {
  const courage = getTraitValue(traits, "courage");
  const sociability = getTraitValue(traits, "sociability");
  const curiosity = getTraitValue(traits, "curiosity");
  const eligible = locations.filter((location) => courage >= location.minCourage);

  if (eligible.length === 0) {
    throw new Error("No eligible destinations for the provided traits.");
  }

  const weights = eligible.map((location) => {
    let weight = location.popularity;
    weight += sociability * 0.05 * location.popularity;

    if (curiosity > 50) {
      weight += (100 - location.popularity) * 0.3;
    }

    return Math.max(1, weight);
  });

  return rng.weightedPick(eligible, weights);
}

export function shouldFindItem(rng: SeededRng, traits: PetTraits): boolean {
  const chance = 20 + getTraitValue(traits, "curiosity") * 0.15;
  return rng.next() * 100 < Math.min(100, chance);
}

export function shouldCraftItem(rng: SeededRng, traits: PetTraits): boolean {
  const chance = 5 + getTraitValue(traits, "creativity") * 0.2;
  return rng.next() * 100 < Math.min(100, chance);
}
