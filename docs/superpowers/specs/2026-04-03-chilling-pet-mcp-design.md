# Chilling Pet MCP Server — Design Spec

A cozy virtual pet MCP server running on Cloudflare Workers. Inspired by Travel Frog — an idle game where your pet lives its own life, goes on trips, and sends back stories. You prepare its pack, buy items from the shop, and check in through a feed.

## Architecture

### Approach: Lazy Evaluation (Compute on Read)

No background processing. When the player checks in via the `feed` tool, the **Life Engine** computes what the pet has been doing since the last check. This is deterministic — the same check at the same time always produces the same history.

### Worker: `workers/pet`

A new worker in the monorepo following the same patterns as `workers/auth`:
- **Hono** for HTTP routing
- **@modelcontextprotocol/sdk + agents** for MCP server
- **D1** (shared `rs-db` database) via **Drizzle ORM**
- **Workers AI** for story generation and ASCII art
- **OAuth** via existing `rs-auth` worker

Future chat API endpoints will be added to the same worker (deferred — not in scope for initial build).

## MCP Tools

| Tool | Description |
|---|---|
| `adopt` | Create your pet. Choose a name. Generates unique ASCII art and random personality traits via Workers AI. One pet per user. |
| `feed` | Main interaction — "open the app." Returns: pet status (home or traveling), home ASCII scene, collects pending rewards (fish catches, trip souvenirs, coins), and the story feed of recent activities. Triggers Life Engine computation. |
| `pack` | Set out items from inventory for the pet's next trip. The pet chooses from the pack based on its personality when it departs. |
| `shop` | Browse and buy items (food, tools, charms) with coins. |
| `items` | View inventory — owned items and coin balance. |

## Data Model

### `pets` table

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Unique pet ID |
| `user_id` | text FK → user | Owner |
| `name` | text | Player-chosen name |
| `seed` | integer | Random seed for deterministic life simulation |
| `ascii_art` | text | Unique ASCII art (generated at adoption) |
| `curiosity` | integer (0-100) | Explores new places vs. stays familiar |
| `energy` | integer (0-100) | Active (adventuring) vs. passive (sleeping) |
| `sociability` | integer (0-100) | Likelihood of visiting places where other pets go |
| `courage` | integer (0-100) | Visits rare/far locations vs. stays close |
| `creativity` | integer (0-100) | Tendency to craft or create souvenirs |
| `last_checked_at` | integer | Timestamp of last feed check (compute-from marker) |
| `coins` | integer | Coin balance (default 0) |
| `created_at` | integer | Birth timestamp |

Personality traits are randomly rolled at adoption and immutable. They directly weight the Life Engine's activity probability distribution.

### `items` table (catalog)

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Item ID |
| `name` | text | Display name |
| `description` | text | Flavor text |
| `ascii_art` | text | Item ASCII art |
| `category` | text | `food`, `tool`, `charm`, `souvenir` |
| `effect_target` | text nullable | Which personality trait it modifies |
| `effect_strength` | integer nullable | How much it shifts the trait |
| `shop_price` | integer nullable | Coin cost (null = not sold in shop) |
| `rarity` | text | `common`, `uncommon`, `rare` |

### `pet_inventory` table

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Row ID |
| `pet_id` | text FK → pets | Owner pet |
| `item_id` | text FK → items | Item |
| `quantity` | integer | How many owned |

Coin balance is stored on `pets.coins`.

### `pet_pack` table

| Column | Type | Description |
|---|---|---|
| `pet_id` | text FK → pets | Owner pet |
| `item_id` | text FK → items | Item set out |
| `quantity` | integer | How many packed |

When the pet departs, it selects from the pack based on personality. Consumed items are removed.

### `activity_log` table

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Row ID |
| `pet_id` | text FK → pets | The pet |
| `time_window` | integer | Which 30-min slot (timestamp) |
| `activity_type` | text | `sleeping`, `eating`, `wandering`, `traveling`, `fishing`, `crafting`, etc. |
| `location` | text nullable | Where the pet is (null = home) |
| `story` | text nullable | Workers AI narrative (cached after generation) |
| `encountered_pet_id` | text nullable FK → pets | Another pet met at this location |
| `items_found` | text nullable | JSON array of item IDs found/crafted |
| `created_at` | integer | When this log was computed |

This is a write-behind cache. Entries are computed on `feed` and stored so they don't need recomputation.

### `fishing_state` table

| Column | Type | Description |
|---|---|---|
| `pet_id` | text FK → pets | Owner pet |
| `last_fished_at` | integer | Last fishing timestamp |
| `pending_catches` | text | JSON array of uncollected catches (item IDs + coins) |

Fishing catches accumulate over time. Collected via `feed`.

## Life Engine

The core simulation algorithm, triggered by `feed`:

```
1. Read pet.last_checked_at → compute elapsed time to now
2. Divide elapsed time into 30-minute time windows
3. For each window:
   a. Seed RNG: hash(pet.seed, window_timestamp)
   b. Read pack items → compute temporary trait modifiers
   c. Weight activity probabilities by modified traits
   d. Determine pet state:
      - If pet was home: chance to depart on trip (energy + courage)
      - If pet was traveling: chance to arrive at location, continue, or return home
      - If pet is home: pick home activity (sleeping, eating, wandering, crafting)
   e. If at a location: check if another pet's RNG puts them at the same
      location in the same window → passive encounter
   f. If traveling: determine items found based on location + traits
   g. If creative enough: chance to craft an item
4. Store computed activities in activity_log
5. Compute pending fishing catches since last_fished_at
6. Generate story feed via Workers AI (batch the recent activities into a narrative)
7. Update pet.last_checked_at to now
8. Return: current state, story feed, new items, pending rewards
```

### Deterministic RNG

All randomness is seeded by `hash(pet.seed, time_window)`. This means:
- The same pet always does the same thing in the same time window
- No background processing needed
- State can be recomputed if the cache is lost

### Encounter Detection

When computing a pet's activities, check other pets' computed locations for the same time window. If locations match, it's a passive encounter. Since RNG is deterministic, both owners will see the same encounter when they each check in.

For performance: only check pets that have overlapping travel windows. Index `activity_log` on `(time_window, location)`.

### Trip Lifecycle

1. Pet is home → Life Engine rolls "depart" based on energy + courage + whether pack has items
2. Pet departs → selects items from pack (personality-driven), pack items consumed
3. Pet travels for N windows (duration based on energy + items taken)
4. During trip: visits locations, may encounter other pets, finds items
5. Pet returns home → souvenirs + coins + stories added to inventory/feed

### Fishing

Passive resource generation. Between `feed` checks, catches accumulate:
- Catch rate: one attempt per hour
- Results: common items, coins, occasionally uncommon items
- Collected automatically when player calls `feed`

## Story Feed

The `feed` tool returns a chronological list of recent activities as short stories. Workers AI generates cozy, personality-flavored narratives:

- "Your pet curled up by the window and watched the rain for a while."
- "Took the compass you packed and wandered to the Crystal Caves. Found a shiny pebble."
- "Met a wispy creature at the Moonlit Library. They sat together in comfortable silence."

Stories are cached in `activity_log.story` after first generation.

## ASCII Art

- **Pet**: unique abstract creature generated by Workers AI at adoption. Stored in `pets.ascii_art`.
- **Home scene**: composited from pet ASCII art + current state (home activities show the pet doing things).
- **Postcards/encounters**: ASCII scene of two pets together at a location.
- **Items**: each item has small ASCII art.

## Authentication

Reuse the existing OAuth flow from `workers/auth`. The pet worker registers as an MCP server with OAuth protection, same pattern as `rs-auth-mcp`. User identity comes from the OAuth token's `userId` prop.

## Project Structure

```
workers/pet/
  src/
    index.ts              — Hono app + OAuthProvider wrapper
    lib/
      mcp/
        index.ts          — MCP server setup
        tools/
          adopt.ts        — adopt tool
          feed.ts         — feed tool (main interaction)
          pack.ts         — pack tool
          shop.ts         — shop tool
          items.ts        — items tool
      engine/
        life-engine.ts    — core simulation logic
        rng.ts            — deterministic seeded RNG
        activities.ts     — activity types, weights, locations
        encounters.ts     — passive encounter detection
        fishing.ts        — fishing catch computation
      ai/
        stories.ts        — Workers AI story generation
        ascii.ts          — Workers AI ASCII art generation
      db.ts               — D1/Drizzle setup
    data/
      items.ts            — item catalog (seed data)
      locations.ts        — location definitions
      activities.ts       — activity type definitions
  wrangler.jsonc
  package.json
  tsconfig.json

packages/db/
  src/schema.ts           — add pet-related tables to existing schema
  drizzle/                — migrations
```

## Bindings (wrangler.jsonc)

```jsonc
{
  "name": "rs-pet",
  "main": "src/index.ts",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "RS_DB",
      "database_name": "rs-db",
      "database_id": "<same as auth>",
      "migrations_dir": "../../packages/db/drizzle"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "OAUTH_KV",
      "id": "<same as auth>"
    }
  ],
  "ai": {
    "binding": "AI"
  }
}
```

## Scope Boundaries

### In scope (initial build)
- 5 MCP tools: adopt, feed, pack, shop, items
- Life Engine with lazy evaluation
- Deterministic pet behavior driven by personality traits
- Passive encounters between pets
- Story feed via Workers AI
- ASCII art generation
- Item system: shop, pack, souvenirs, fishing
- OAuth authentication via existing rs-auth

### Deferred
- Chat API (REST endpoints for non-MCP clients)
- Home decoration system
- Visit other users' pets
- Friendship/social features beyond passive encounters
- Real-time notifications
