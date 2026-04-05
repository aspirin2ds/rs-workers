# Pebble Feed Async Story Queue — Design Spec

This spec replaces Pebble's current `feed`-time deterministic life simulation with a non-blocking, queue-driven story pipeline.

The new model is:

- `feed` never generates stories synchronously.
- A Cloudflare Queue consumer generates exactly one future story per task.
- AI writes the story and proposes the next story time.
- The system validates and clamps the proposed next time into configured min/max bounds.
- Generated stories are stored as unconsumed feed entries.
- When `feed` returns one or more unconsumed stories, it marks them consumed and resets the shared per-user generation budget to `N` once for that request.

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

Each queued task represents one future story for one pet.

When a task executes:

1. It generates exactly one story for the task's `scheduled_for` time.
2. It asks AI for:
   - the narrative payload for that story
   - a proposed next story time or delay
3. The system validates and clamps the proposed next time into configured bounds.
4. If budget remains, it creates the next future-story task and sends it to Cloudflare Queues with the appropriate delay.

This model avoids "catching up" missed windows. The system is always scheduling the next future story, not reconstructing past missing stories.

### Runtime Split

- MCP Worker:
  - serves `feed`, `adopt`, `pack`, `items`, `save-story`
  - reads visible stories and player state
  - collects loot and other synchronous feed information
  - seeds a new async story task when needed
- Queue Consumer Worker path:
  - consumes one `story_task`
  - calls AI worker/model
  - writes one generated story
  - schedules the next task if allowed
- D1:
  - source of truth for tasks, stories, pet state, and per-user budget
- Cloudflare Queues:
  - transport for delayed async story generation

## Core Behavioral Rules

### Feed Contract

`feed` is strictly non-blocking.

It may:

- return already-generated stories
- mark returned stories consumed
- collect loot or other synchronous state
- reset the user's generation budget once if at least one story was consumed
- seed a new future-story task if no queued or running task exists for the pet

It may not:

- wait for AI generation
- call the AI worker directly
- generate current or missing stories inline

### Task Contract

One task produces one story.

The task's `scheduled_for` timestamp is the authoritative story time for the story it creates.

The worker may create at most one child task from a completed parent task.

### Budget Contract

Generation budget is shared per user, not per pet.

- The user has one generation budget value `N`.
- A successful story generation consumes one generation unit.
- Invalid AI output or other task-level generation failure consumes retry budget, not generation budget.
- A `feed` request that consumes one or more stories resets the user's generation budget to `N` once for that request.
- Empty polling does not reset budget.

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

### `story_task`

Single-table task lineage. This table replaces the need for separate chain and job tables.

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Task ID |
| `pet_id` | text FK | Pet this task generates for |
| `user_id` | text FK | User who owns the budget |
| `parent_task_id` | text nullable FK → `story_task.id` | Previous task in the chain |
| `status` | text | `queued`, `running`, `succeeded`, `invalid`, `failed`, `cancelled` |
| `scheduled_for` | integer | Exact future timestamp for the story this task should generate |
| `attempt_number` | integer | Retry or replacement attempt count for this lineage step |
| `remaining_generations` | integer | Shared user budget snapshot after this task was created |
| `remaining_retries` | integer | Retry budget snapshot for this task lineage |
| `proposed_next_at` | integer nullable | Raw AI-proposed next time |
| `validated_next_at` | integer nullable | Clamped system-approved next time |
| `created_story_id` | text nullable FK → `story.id` | Story created by this task |
| `failure_reason` | text nullable | Validation or generation failure detail |
| `started_at` | integer nullable | Execution start time |
| `finished_at` | integer nullable | Execution finish time |
| `created_at` | integer | Insert time |
| `updated_at` | integer | Last update time |

Indexes:

- `(pet_id, status)`
- `(user_id, status)`
- `(scheduled_for)`
- `(parent_task_id)`

Constraint:

- At most one `queued` or `running` task per pet at a time. Enforce in application logic and, if practical, with a partial uniqueness strategy.

### `user_story_budget`

Shared per-user budget state.

| Column | Type | Description |
|---|---|---|
| `user_id` | text PK | Budget owner |
| `max_generations` | integer | Configured `N` |
| `remaining_generations` | integer | Current shared budget |
| `max_retries` | integer | Configured retry budget `R` |
| `remaining_retries` | integer | Current shared retry budget |
| `reset_at` | integer nullable | Last reset timestamp |
| `updated_at` | integer | Last mutation time |

This table is the authoritative source for the player's current budget. Task rows store snapshots for auditability and idempotent task decisions.

### `story`

Generated feed entries. This stays user-visible and becomes fully server-authored.

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Story ID |
| `pet_id` | text FK | Pet |
| `user_id` | text FK | Owner |
| `task_id` | text FK → `story_task.id` | Task that generated this story |
| `story_time` | integer | Canonical time of the story |
| `location` | text nullable | Optional location |
| `activity_type` | text nullable | Optional structured label |
| `story` | text | AI-generated narrative |
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
2. Load the user's pet and current budget state.
3. Load recent stories for display.
4. Select unconsumed stories that are now visible to the player.
5. Collect synchronous loot or other feed-side state from those stories.
6. Mark returned stories as consumed in the same transaction.
7. If at least one story was consumed:
   - reset `user_story_budget.remaining_generations = N`
   - reset `user_story_budget.remaining_retries = R`
   - do this once per request
8. Check whether the pet already has a `queued` or `running` task.
9. If not, seed a new root task:
   - `scheduled_for = now + min_delay`
   - task budget snapshot comes from the current user budget
10. Send the queue message for that task.
11. Return:
   - generated stories
   - collected loot
   - pet status and other synchronous feed info
   - whether async generation is active

Important rule:

- `feed` seeds work only when no queued/running task exists for the pet.
- A consumed-story budget reset does not itself create multiple tasks.

## Queue Consumer Flow

When a queue task becomes due:

1. Load the `story_task` row by ID.
2. Exit if task is already terminal or already has `created_story_id`.
3. Mark task `running`.
4. Load pet context, recent story history, inventory/pack context, and user budget.
5. Build the AI prompt for one future story at `scheduled_for`.
6. Ask AI to return:
   - story text
   - optional structured fields like `activityType`, `location`, `itemsFound`
   - proposed next story time or delay
7. Validate AI output.
8. If valid:
   - create one `story` row with `story_time = scheduled_for`
   - mark task `succeeded`
   - decrement `user_story_budget.remaining_generations` by 1
   - clamp the proposed next time into allowed bounds
   - if remaining generations > 0, create one child task and queue it
9. If invalid:
   - mark task `invalid`
   - decrement `user_story_budget.remaining_retries` by 1
   - if remaining retries > 0, create a replacement child task for the same lineage step or the next allowed time
10. If retries are exhausted or generations are exhausted, stop the chain.

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
- client-side story narration followed by `save-story`

Retained concepts:

- synchronous loot collection during `feed`
- pet-facing feed history
- item and pack mechanics where useful for story prompts and structured outputs

## Idempotency And Concurrency

The consumer must be safe under redelivery.

Rules:

- if `story_task.created_story_id` is already set, do not create another story
- if the task is already terminal, exit
- only one queued/running task per pet
- task creation and queue send should happen as one logical operation; if exact atomicity is not available, add recovery logic to detect unsent queued tasks

`feed` must also avoid duplicate root tasks:

- check for existing queued/running task first
- create a root task only if none exists

## Failure Handling

### Invalid AI Output

- mark task `invalid`
- decrement shared retry budget
- optionally create a replacement task if retry budget remains

### Worker/Queue Failure

- queue redelivery re-runs the same task
- idempotency check prevents duplicate story creation

### Exhausted Budget

When `remaining_generations` reaches zero:

- no child task is created
- the pet has no active chain
- the next `feed` request that consumes one or more stories may reset the user budget and seed a new root task

### Empty Feed Polling

If `feed` consumes no stories:

- do not reset budget
- do not spend budget
- only seed a new task if the pet has no queued/running task and the current user budget allows it

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

### `save-story`

If server-side AI is the only story author, `save-story` no longer owns narrative persistence for feed stories.

Options:

- keep `save-story` only for pet ASCII art or other future client-authored content
- or remove story-narrative support from `save-story`

This refactor should treat feed-story persistence as server-owned.

## Migration Notes

Migration should:

1. add `story_task`
2. add `user_story_budget`
3. extend `story` with `task_id`, `story_time`, `consumed_at`, and optional metadata
4. keep old fields temporarily if needed for compatibility
5. migrate `feed` reads to the new async-visible model
6. stop using `runLifeEngine` for story generation

Old deterministic story rows do not need to be rewritten immediately. They can remain historical feed entries if the read path supports both legacy and new story fields during rollout.

## Testing Strategy

### Unit Tests

- `feed` marks unconsumed stories consumed and resets user budget once per request
- `feed` does not reset budget on empty polling
- `feed` seeds a root task only when no queued/running task exists
- consumer creates one story per task
- consumer clamps AI-proposed next time into min/max bounds
- invalid AI output spends retry budget, not generation budget
- successful generation spends generation budget, not retry budget
- duplicate consumer execution does not duplicate stories

### Integration Tests

- queue-driven story chain generates multiple stories across multiple tasks
- story consumption on `feed` re-arms user budget
- no duplicate active tasks are created for a pet under repeated feed calls
- shared user budget is visible consistently across pet/task interactions

## Open Decisions Resolved

- `feed` is strictly non-blocking
- one task generates one story
- AI proposes next timing, system clamps it
- retries and generation budget are separate
- root chain seeding happens only when no queued/running task exists
- stories are generated for the future, not reconstructed for the present
- consuming one or more stories resets budget once per request
- generation budget is shared per user, not per pet

## Recommendation

Ship the async queue model behind the existing `feed` interface first, with a single `story_task` table and shared `user_story_budget`.

This is the smallest design that:

- moves generation out of `feed`
- uses Cloudflare Queues appropriately
- keeps AI pacing bounded
- ties replenishment to real player consumption
- avoids introducing a heavier chain/job split before it is needed
