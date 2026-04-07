# Pebble Feed Async Story Queue — Design Spec

This spec replaces Pebble's current `feed`-time deterministic life simulation with a non-blocking, queue-driven story pipeline.

The new model is:

- `feed` never generates stories synchronously.
- A Cloudflare Queue consumer generates exactly one future story per task.
- Story generation is organized into one chain per user generation cycle.
- AI writes the story and proposes the next story time.
- The system validates and clamps the proposed next time into configured min/max bounds.
- After a story is generated, the worker automatically creates the next generation task if the user still has remaining generation budget.
- Generated stories are stored as unconsumed feed entries.
- `feed` creates a new chain whenever the user has no queued or running task.
- If `feed` returns one or more unconsumed stories, it marks them consumed and resets that new or active chain budget to `N` once for that request.

## Goals

- Remove synchronous story generation from `feed`.
- Use server-side AI generation in a background worker.
- Keep `feed` fast and non-blocking.
- Let AI influence story pacing without giving it authoritative scheduling control.
- Limit autonomous generation with explicit user-budget and retry-budget controls.
- Keep the workflow simple enough to ship without introducing unnecessary state machines.

## Non-Goals

- Reproduce the old deterministic window-by-window Life Engine.
- Guarantee exact story cadence independent of queue delay or worker retry timing.
- Support multiple independent budgets per pet.
- Make the queue itself the source of truth for workflow state.

## Architecture

### Approach: Future Story Chain

Each generation cycle is represented by a `story_generation_chain`.

Each queued task under that chain represents one future story for one pet.

When a task executes:

1. It generates exactly one story for the task's `scheduled_for` time.
2. It asks AI for:
   - the narrative payload for that story
   - a proposed next story time or delay
3. The system validates and clamps the proposed next time into configured bounds.
4. If the chain still has remaining generation budget after this successful story, it creates the next future-story task and sends it to Cloudflare Queues with the appropriate delay.

This model avoids "catching up" missed windows. The system is always scheduling the next future story, not reconstructing past missing stories.

### Runtime Split

- MCP Worker:
  - serves `feed`, `pack`, `items`
  - reads visible stories and player state
  - collects loot and other synchronous feed information
  - seeds a new async story task when needed
- Queue Consumer Worker path:
  - consumes one `story_generation_task`
  - calls Workers AI via an AI binding
  - writes one generated story
  - schedules the next task if allowed
- D1:
  - source of truth for chains, tasks, stories, pet state, and per-user generation budget
- Cloudflare Queues:
  - transport for delayed async story generation
- Workers AI:
  - server-side story authoring and next-time proposal generation

## Core Behavioral Rules

### Feed Contract

`feed` is strictly non-blocking.

It may:

- return already-generated stories
- mark returned stories consumed
- collect loot or other synchronous state
- create a new generation chain if the user has no queued or running task
- seed the first future-story task for that new chain
- reset chain budget once if at least one story was consumed in that request

It may not:

- wait for AI generation
- call the AI worker directly
- generate current or missing stories inline

### Task Contract

One task produces one story.

The task's `scheduled_for` timestamp is the authoritative story time for the story it creates.

The worker may create at most one child task from a completed parent task.

After a successful story generation, creating that child task is required whenever remaining generation budget is greater than zero.

### Budget Contract

Generation budget is shared per user, not per pet, and belongs to the generation chain.

- Each new chain starts with generation budget `N`.
- A successful story generation consumes one generation unit.
- Invalid AI output or other task-level generation failure consumes retry budget, not generation budget.
- A `feed` request that consumes one or more stories resets chain generation budget to `N` once for that request.
- Empty polling does not reset budget, but it may still create a new chain when no queued/running task exists.

### Chain Contract

The chain is the authoritative owner of mutable generation state.

- At most one queued/running chain may exist per user at a time.
- A chain is active only while it has at least one queued or running task.
- When the last task finishes and no next task is created, the chain is closed.
- The next eligible `feed` call starts a new chain rather than reusing an old one.

### Scheduling Contract

AI may propose the next story time, but the system is authoritative.

For each successful task:

- AI proposes `next_at` or an equivalent delay.
- The system computes:
  - `earliest_allowed = story_time + min_delay`
  - `latest_allowed = story_time + max_delay`
- The stored next schedule is `clamp(ai_proposed_time, earliest_allowed, latest_allowed)`

If AI output omits a usable next time, the system uses a deterministic fallback inside the allowed range.

## Data Model

### `story_generation_chain`

Chain-level generation state. One chain represents one user generation cycle.

The chain row tracks current state only. It does not store a list of queued tasks. Instead, `active_task_id` points to the single queued or running head task for the chain. Historical tasks are queried from `story_generation_task` by `chain_id`.

Repository/read-model note:

- read operations should expose the active head as `{ chain, task } | null`
- feed/bootstrap logic should use that chain-head shape rather than a task-only lookup

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Chain ID |
| `user_id` | text FK | Chain owner |
| `pet_id` | text FK | Pet currently being generated for |
| `status` | text | `active`, `exhausted`, `failed`, `cancelled`, `completed` |
| `remaining_generations` | integer | Remaining generation budget for this chain |
| `remaining_retries` | integer | Remaining retry budget for this chain |
| `active_task_id` | text nullable FK → `story_generation_task.id` | Pointer to the single current queued/running head task |
| `last_story_at` | integer nullable | Most recent generated story time |
| `next_not_before_at` | integer nullable | Earliest allowed next schedule |
| `created_at` | integer | Insert time |
| `updated_at` | integer | Last update time |

Indexes:

- `(user_id, status)`
- `(pet_id, status)`

Constraint:

- At most one active chain per user at a time.

### `story_generation_task`

Task-level execution history. One row per generation step.

This table stores full lineage and history. To inspect all tasks in a chain, query by `chain_id`. The chain row only points at the current live head task.

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Task ID |
| `chain_id` | text FK → `story_generation_chain.id` | Parent chain |
| `user_id` | text FK | User who owns the chain |
| `pet_id` | text FK | Pet this task generates for |
| `parent_task_id` | text nullable FK → `story_generation_task.id` | Previous task in the chain |
| `status` | text | `queued`, `running`, `succeeded`, `invalid`, `failed`, `cancelled` |
| `scheduled_for` | integer | Exact future timestamp for the story this task should generate |
| `attempt_number` | integer | Retry or replacement attempt count for this lineage step |
| `proposed_next_at` | integer nullable | Raw AI-proposed next time |
| `validated_next_at` | integer nullable | Clamped system-approved next time |
| `created_story_id` | text nullable FK → `story.id` | Story created by this task |
| `failure_reason` | text nullable | Validation or generation failure detail |
| `started_at` | integer nullable | Execution start time |
| `finished_at` | integer nullable | Execution finish time |
| `created_at` | integer | Insert time |
| `updated_at` | integer | Last update time |

Indexes:

- `(chain_id, status)`
- `(user_id, status)`
- `(pet_id, status)`
- `(scheduled_for)`
- `(parent_task_id)`

Constraint:

- At most one `queued` or `running` task per active chain at a time.

### `story`

Generated feed entries. This stays user-visible and becomes fully server-authored.

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Story ID |
| `pet_id` | text FK | Pet |
| `user_id` | text FK | Owner |
| `task_id` | text FK → `story_generation_task.id` | Task that generated this story |
| `chain_id` | text FK → `story_generation_chain.id` | Chain that generated this story |
| `story_time` | integer | Canonical time of the story |
| `location` | text nullable | Optional location |
| `activity_type` | text nullable | Optional structured label |
| `story` | text nullable | AI-generated narrative; remains nullable to preserve legacy rows that never had saved narrative text |
| `items_found` | text nullable | JSON array of item IDs |
| `metadata_json` | text nullable | Optional AI/debug context |
| `consumed_at` | integer nullable | First time returned by `feed` |
| `created_at` | integer | Insert time |

Indexes:

- `(pet_id, story_time desc)`
- `(pet_id, consumed_at, story_time desc)`
- `(user_id, consumed_at)`
- `(task_id)`

## Queue Message Shape

Each Cloudflare Queue message should carry the minimum information required for idempotent execution:

```json
{
  "taskId": "task_123",
  "petId": "pet_123",
  "userId": "user_123",
  "scheduledFor": 1760000000000
}
```

The consumer must re-read task and budget state from D1. The queue payload is a pointer, not the source of truth.

## Feed Flow

When `feed` is requested:

1. Authenticate the user.
2. Load the user's pet and active chain head as `{ chain, task } | null`.
3. Load recent stories for display.
4. Select unconsumed stories that are now visible to the player.
5. Collect synchronous loot or other feed-side state from those stories.
6. Mark returned stories as consumed in the same transaction.
7. Compute whether this request consumed at least one story.
8. If the user has no queued/running task:
   - create a new `story_generation_chain`
   - initialize generation and retry budgets for the chain
   - if this request consumed stories, initialize the new chain with reset values `N` and `R`
   - otherwise initialize the new chain with the configured default values, which in the current design are also `N` and `R`
   - do this at most once per request
9. If a new chain was created, create the first root task for that chain:
   - `scheduled_for = now + min_delay`
   - attach it to the new chain
10. Send the queue message for that task.
11. If at least one story was consumed in this request and an active chain already existed before bootstrap:
   - reset the current chain's `remaining_generations = N`
   - reset the current chain's `remaining_retries = R`
   - do this once per request
12. Return:
   - generated stories
   - collected loot
   - pet status and other synchronous feed info
   - whether async generation is active

Important rule:

- `feed` creates a new chain only when the user has no queued/running task.
- `feed` creates at most one new chain per request.
- Story consumption and chain creation are separate decisions.
- Empty feed polling may bootstrap a new chain, but it does not reset budget.
- If a new chain is bootstrapped after story consumption, it is born with reset values rather than being reset afterward by a separate user-level mutation.

### Feed Scenarios

This section defines the expected `feed` behavior for every meaningful generation-state combination. These scenarios should be mirrored directly in tests.

#### Scenario 1: No queued/running task, no unconsumed stories

State:

- no queued task
- no running task
- no unconsumed stories returned by this request

Expected behavior:

- `feed` returns current synchronous status and any historical stories already visible
- `feed` consumes no stories
- `feed` does not reset budget
- `feed` creates a new chain
- `feed` creates one root task for that chain
- `feed` sends one queue message

This is the empty-feed bootstrap path. It prevents brand new or fully drained users from deadlocking in an idle state.

#### Scenario 2: No queued/running task, one or more unconsumed stories exist

State:

- no queued task
- no running task
- one or more unconsumed stories are returned by this request

Expected behavior:

- `feed` returns those unconsumed stories
- `feed` marks them consumed
- `feed` collects any synchronous loot or status updates
- `feed` resets budget to `N` once for the request
- `feed` creates a new chain
- `feed` creates one root task for that chain
- `feed` sends one queue message

This is the normal "player progressed and generation is currently idle" path.

#### Scenario 3: One queued/running task exists, no unconsumed stories

State:

- one queued or running task exists
- no unconsumed stories are returned by this request

Expected behavior:

- `feed` must not create a new chain
- `feed` must not create a new task
- `feed` returns current synchronous status and any previously visible history
- `feed` does not reset budget
- `feed` does not spend budget
- the existing queued/running task remains the chain head via `active_task_id`

This is the in-flight idle poll path.

#### Scenario 4: One queued/running task exists, one or more unconsumed stories exist

State:

- one queued or running task exists
- one or more unconsumed stories are returned by this request

Expected behavior:

- `feed` returns those unconsumed stories
- `feed` marks them consumed
- `feed` collects any synchronous loot or status updates
- `feed` resets the active chain budget to `N` once for the request
- `feed` must not create a new chain
- `feed` must not create a new task
- the existing queued/running task remains the chain head via `active_task_id`

This is the in-flight progression path. The player progresses, but generation work is already active, so only budget is refreshed.

#### Scenario 5: Race between `feed` and worker completion

State:

- a queued/running task exists at the beginning of the request
- the worker may complete it concurrently while `feed` is executing

Expected behavior:

- `feed` bases chain-creation decisions on a transactionally consistent read
- `feed` must still avoid creating duplicate chains or duplicate tasks
- if the system cannot guarantee a single consistent snapshot, application-level deduplication must ensure only one live chain head remains

This is a concurrency scenario. The implementation must handle it without parallel task creation.

#### Scenario 6: Terminal chain, no queued/running task, no unconsumed stories

State:

- previous chain is terminal
- no queued/running task exists
- no unconsumed stories are returned by this request

Expected behavior:

- `feed` does not reset budget
- `feed` creates a new chain
- `feed` creates one root task
- `feed` sends one queue message

This is the post-terminal bootstrap path.

#### Scenario 7: Terminal chain, no queued/running task, one or more unconsumed stories

State:

- previous chain is terminal
- no queued/running task exists
- one or more unconsumed stories are returned by this request

Expected behavior:

- `feed` returns and consumes those stories
- `feed` resets budget to `N` once for the request
- `feed` creates a new chain
- `feed` creates one root task
- `feed` sends one queue message

This is the post-terminal recovery path after player progression.

#### Scenario 8: Duplicate `feed` requests arrive back-to-back while no queued/running task exists

State:

- two `feed` requests race while the user has no queued/running task

Expected behavior:

- at most one new chain is created
- at most one new root task is created
- the losing request observes the newly created queued/running task and does not create another

This is the key deduplication scenario for `feed`.

## Queue Consumer Flow

When a queue task becomes due:

1. Load the `story_generation_task` row by ID.
2. Load its parent `story_generation_chain`.
3. Exit if task is already terminal or already has `created_story_id`.
4. Mark task `running`.
5. Load pet context, recent story history, inventory/pack context, and chain state.
6. Build the AI prompt for one future story at `scheduled_for`.
7. Ask AI to return:
   - story text
   - optional structured fields like `activityType`, `location`, `itemsFound`
   - proposed next story time or delay
8. Validate AI output.
9. If valid:
   - create one `story` row with `story_time = scheduled_for`
   - mark task `succeeded`
   - decrement `story_generation_chain.remaining_generations` by 1
   - update `last_story_at`
   - clamp the proposed next time into allowed bounds
   - if remaining generations > 0 after the decrement, create one child task and queue it
   - otherwise close the chain
10. If invalid:
   - mark task `invalid`
   - decrement `story_generation_chain.remaining_retries` by 1
   - if remaining retries > 0, create a replacement child task for the same lineage step or the next allowed time
   - otherwise close the chain as failed

## AI Contract

The AI worker should not be treated as a trusted scheduler.

The prompt should ask for:

- one cozy story for the pet at the specified future moment
- optional structured fields useful for inventory, location, or UI
- one proposed next story time or delay

The response must be validated against a strict schema.

Suggested validated output shape:

```json
{
  "story": "Basalt spent the late afternoon ...",
  "activityType": "wandering",
  "location": "Moonlit Library",
  "itemsFound": ["rice-ball"],
  "proposedNextAt": 1760003600000
}
```

Validation rules:

- `story` must be non-empty
- `proposedNextAt` must parse to a timestamp if present
- structured fields must be optional and bounded
- the system clamps or replaces invalid scheduling output

## State Simplification

This design intentionally removes the old deterministic time-window simulation loop.

Removed concepts:

- `last_checked_at` as the simulation cursor
- deterministic replay over elapsed time windows
- synchronous story computation inside `feed`
- no client-authored follow-up is required; the server generates and persists stories

Retained concepts:

- synchronous loot collection during `feed`
- pet-facing feed history
- item and pack mechanics where useful for story prompts and structured outputs

## Idempotency And Concurrency

The consumer must be safe under redelivery.

Rules:

- if `story_generation_task.created_story_id` is already set, do not create another story
- if the task is already terminal, exit
- only one active chain per user
- only one queued/running task per active chain
- task creation and queue send should happen as one logical operation; if exact atomicity is not available, add recovery logic to detect unsent queued tasks

`feed` must also avoid duplicate root chains:

- check for existing queued/running task first
- create a new chain and root task only if none exists

## Failure Handling

### Invalid AI Output

- mark task `invalid`
- decrement chain retry budget
- optionally create a replacement task if retry budget remains

### Worker/Queue Failure

- queue redelivery re-runs the same task
- idempotency check prevents duplicate story creation

### Exhausted Budget

When `remaining_generations` reaches zero:

- no child task is created
- the chain is closed
- the next `feed` request that consumes one or more stories may create a new chain and seed a new root task

### Empty Feed Polling

If `feed` consumes no stories:

- do not reset budget
- do not spend budget
- create a new chain only if no queued/running task exists

## Configuration

Required configuration values:

- `STORY_MIN_DELAY_SECONDS`
- `STORY_MAX_DELAY_SECONDS`
- `STORY_MAX_GENERATIONS`
- `STORY_MAX_RETRIES`
- queue binding for story generation
- AI binding or service configuration for server-side generation

Rules:

- `min_delay` must be less than or equal to `max_delay`
- all task scheduling must use these configured values, not hardcoded windows

## API Changes

### `feed`

`feed` should return a shape centered on visible generated stories and async status, for example:

```json
{
  "pet": {
    "name": "Basalt",
    "status": "home"
  },
  "stories": [
    {
      "id": "story_1",
      "storyTime": 1760000000000,
      "story": "Basalt wandered under paper lanterns...",
      "itemsFound": ["rice-ball"]
    }
  ],
  "collected": ["Rice Ball"],
  "generation": {
    "active": true,
    "remainingGenerations": 4,
    "remainingRetries": 2
  }
}
```

### Pet Bootstrap

`feed` is the only entrypoint. If the player has no pet yet, the first `feed` call creates a starter pet automatically, seeds starter inventory, starts the async generation chain, and returns a payload that tells the client to poll again while generation is active.

This refactor should treat feed-story persistence as server-owned.

## Migration Notes

Migration should:

1. add `story_generation_chain`
2. add `story_generation_task`
3. extend `story` with `task_id`, `chain_id`, `story_time`, `consumed_at`, and optional metadata
4. keep old fields temporarily if needed for compatibility
5. migrate `feed` reads to the new async-visible model
6. stop using `runLifeEngine` for story generation

Old deterministic story rows do not need to be rewritten immediately. They can remain historical feed entries if the read path supports both legacy and new story fields during rollout.

## Testing Strategy

### Unit Tests

- `feed` marks unconsumed stories consumed and resets budget once per request
- `feed` creates a new chain when no queued/running task exists, including empty-feed bootstrap
- `feed` seeds exactly one root task for a new chain
- consumer creates one story per task
- consumer clamps AI-proposed next time into min/max bounds
- invalid AI output spends chain retry budget, not chain generation budget
- successful generation spends chain generation budget, not chain retry budget
- duplicate consumer execution does not duplicate stories

### Integration Tests

- queue-driven story chain generates multiple stories across multiple tasks
- after each successful story, the worker automatically queues the next task while remaining chain generation budget is still positive
- story consumption on `feed` resets chain budget, and no-task states bootstrap a fresh chain
- no duplicate active chains are created for a user under repeated feed calls
- chain/task state remains consistent across task execution and feed reads

## Open Decisions Resolved

- `feed` is strictly non-blocking
- one task generates one story
- AI proposes next timing, system clamps it
- retries and generation budget are separate
- new chain seeding happens only when no queued/running task exists
- stories are generated for the future, not reconstructed for the present
- consuming one or more stories resets chain budget once per request
- generation budget is shared per user chain, not per pet
- each successful story generation automatically advances the chain by enqueuing the next task while budget remains

## Recommendation

Ship the async queue model behind the existing `feed` interface first, with separate `story_generation_chain` and `story_generation_task` tables.

This is the smallest design that:

- moves generation out of `feed`
- uses Cloudflare Queues appropriately
- keeps AI pacing bounded
- ties replenishment to real player consumption
- gives generation budget a correct owner without overloading task rows
