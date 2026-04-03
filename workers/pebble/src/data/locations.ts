export interface Location {
  id: string;
  name: string;
  description: string;
  /** Minimum courage level to visit (0 = anyone) */
  minCourage: number;
  /** How popular this location is; higher = more encounters */
  popularity: number;
  /** Possible souvenir item IDs found here */
  souvenirIds: string[];
}

export const locations: Location[] = [
  {
    id: "moonlit-library",
    name: "Moonlit Library",
    description: "A quiet library bathed in silver light",
    minCourage: 0,
    popularity: 8,
    souvenirIds: ["old-bookmark", "dusty-scroll"],
  },
  {
    id: "cloud-garden",
    name: "Cloud Garden",
    description: "A garden floating among soft clouds",
    minCourage: 10,
    popularity: 7,
    souvenirIds: ["cloud-puff", "sky-seed"],
  },
  {
    id: "crystal-caves",
    name: "Crystal Caves",
    description: "Glittering caverns deep underground",
    minCourage: 30,
    popularity: 5,
    souvenirIds: ["shiny-pebble", "crystal-shard"],
  },
  {
    id: "starfall-meadow",
    name: "Starfall Meadow",
    description: "A meadow where fallen stars rest",
    minCourage: 20,
    popularity: 6,
    souvenirIds: ["star-fragment", "glowing-moss"],
  },
  {
    id: "whispering-dunes",
    name: "Whispering Dunes",
    description: "Sand dunes that hum quiet melodies",
    minCourage: 40,
    popularity: 4,
    souvenirIds: ["singing-sand", "desert-glass"],
  },
  {
    id: "ember-hot-springs",
    name: "Ember Hot Springs",
    description: "Warm springs glowing with gentle embers",
    minCourage: 15,
    popularity: 7,
    souvenirIds: ["warm-stone", "ember-jar"],
  },
  {
    id: "frozen-lighthouse",
    name: "Frozen Lighthouse",
    description: "An ancient lighthouse encased in ice",
    minCourage: 60,
    popularity: 2,
    souvenirIds: ["ice-lens", "frozen-feather"],
  },
  {
    id: "mushroom-hollow",
    name: "Mushroom Hollow",
    description: "A cozy hollow of giant glowing mushrooms",
    minCourage: 5,
    popularity: 9,
    souvenirIds: ["spore-lantern", "tiny-mushroom"],
  },
  {
    id: "driftwood-shore",
    name: "Driftwood Shore",
    description: "A quiet shore lined with smooth driftwood",
    minCourage: 10,
    popularity: 6,
    souvenirIds: ["sea-glass", "driftwood-charm"],
  },
  {
    id: "aurora-peak",
    name: "Aurora Peak",
    description: "A mountaintop where auroras dance",
    minCourage: 80,
    popularity: 1,
    souvenirIds: ["aurora-shard", "peak-stone"],
  },
];
