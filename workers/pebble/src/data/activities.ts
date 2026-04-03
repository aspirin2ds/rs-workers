export type ActivityTrait =
  | "curiosity"
  | "energy"
  | "sociability"
  | "courage"
  | "creativity";

export type ActivityType =
  | "sleeping"
  | "eating"
  | "wandering"
  | "crafting"
  | "reading"
  | "stargazing"
  | "traveling"
  | "exploring";

export interface HomeActivity {
  type: ActivityType;
  /** Base weight for this activity */
  baseWeight: number;
  /** Which trait boosts this activity's weight */
  traitBoost?: { trait: ActivityTrait; multiplier: number };
  /** Which trait reduces this activity's weight */
  traitPenalty?: { trait: ActivityTrait; multiplier: number };
}

export const homeActivities: HomeActivity[] = [
  {
    type: "sleeping",
    baseWeight: 20,
    traitPenalty: { trait: "energy", multiplier: 0.15 },
  },
  {
    type: "eating",
    baseWeight: 15,
  },
  {
    type: "wandering",
    baseWeight: 10,
    traitBoost: { trait: "curiosity", multiplier: 0.1 },
  },
  {
    type: "crafting",
    baseWeight: 5,
    traitBoost: { trait: "creativity", multiplier: 0.15 },
  },
  {
    type: "reading",
    baseWeight: 10,
    traitBoost: { trait: "curiosity", multiplier: 0.08 },
  },
  {
    type: "stargazing",
    baseWeight: 8,
    traitPenalty: { trait: "energy", multiplier: 0.05 },
  },
];

/** Base chance (out of 100) that a pet departs on a trip in any given window */
export const BASE_DEPART_CHANCE = 8;

/** Base number of windows a trip lasts */
export const BASE_TRIP_DURATION = 6;

/** Minutes per time window */
export const WINDOW_MINUTES = 20;
