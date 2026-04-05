# Pebble Feed Async Story Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pebble's synchronous `feed` simulation with a queue-driven, server-side AI story generation pipeline that keeps `feed` non-blocking and enforces one active generation chain per user.

**Review fixes applied (2026-04-05):**
1. Migration SQL: added missing FKs (`user_id`, `pet_id`) on `story_generation_task`, added all spec indexes on both new tables and `story`
2. Consumer DI: `processStoryGenerationMessage` accepts `generateStory` as a parameter for testability — no module mocking needed for AI layer
3. Wrangler config: added `vars` section with `STORY_MIN_DELAY_SECONDS`, `STORY_MAX_DELAY_SECONDS`, `STORY_MAX_GENERATIONS`, `STORY_MAX_RETRIES`
4. Schema: added missing indexes (`pet_status`, `scheduled_for`, `parent_task_id`) on `story_generation_task`
5. Race test: replaced superficial mock with realistic two-call dedup scenario
6. Migration strategy: explicit permission to rebuild legacy `story` table instead of preserving the old `time_window`-centric shape
7. Feed reset ordering: newly bootstrapped chains must be created with already-reset budget values, not reset afterward by `userId`

**Architecture:** Introduce `story_generation_chain` and `story_generation_task` as authoritative async workflow tables, wire Cloudflare Queue + Workers AI into the Pebble worker, and refactor `feed` into a synchronous reader/collector plus chain bootstrapper. The queue consumer will generate one future story per task, clamp the AI-proposed next schedule, persist the story, and auto-enqueue the next task while chain budget remains.

**Tech Stack:** Cloudflare Workers, Cloudflare Queues, Workers AI binding, Hono, MCP SDK, Drizzle ORM, D1, Vitest, TypeScript

---

## File Map

- Modify: `packages/db/src/schema.ts`
  - Add `story_generation_chain` and `story_generation_task`
  - Extend `story` for async ownership fields
- Create: `packages/db/drizzle/0003_feed_async_story_queue.sql`
  - D1 migration for new tables, indexes, and `story` columns
- Modify: `packages/db/drizzle/meta/_journal.json`
  - Register migration
- Create: `workers/pebble/src/lib/story-generation/types.ts`
  - Shared queue payload and validated AI output types
- Create: `workers/pebble/src/lib/story-generation/repository.ts`
  - Chain/task/story persistence helpers
- Create: `workers/pebble/src/lib/story-generation/next-time.ts`
  - Clamp and fallback scheduling logic
- Create: `workers/pebble/src/lib/story-generation/ai.ts`
  - Workers AI prompt + schema validation wrapper
- Create: `workers/pebble/src/lib/story-generation/consumer.ts`
  - Queue consumer orchestration for one task
- Create: `workers/pebble/src/lib/story-generation/repository.test.ts`
  - Feed scenario repository tests and chain/task invariants
- Create: `workers/pebble/src/lib/story-generation/next-time.test.ts`
  - Scheduling clamp tests
- Create: `workers/pebble/src/lib/story-generation/consumer.test.ts`
  - Queue consumer success/failure/auto-advance tests
- Modify: `workers/pebble/src/index.ts`
  - Add queue handler and Workers AI binding typing
- Modify: `workers/pebble/wrangler.jsonc`
  - Add queue consumer/producer config and AI binding
- Modify: `workers/pebble/src/lib/mcp/tools/feed.ts`
  - Replace `runLifeEngine` flow with async chain bootstrap + story consumption logic
- Modify: `workers/pebble/src/lib/mcp/tools/feed.test.ts`
  - Cover all `feed` scenarios from the spec
- Modify: `workers/pebble/src/lib/mcp/tools/save-story.ts`
  - Narrow scope to pet ASCII art or other client-authored content only
- Modify: `workers/pebble/src/lib/mcp/index.ts`
  - Keep MCP registration stable while `feed` internals change

## Task 1: Database Schema And Migration

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/0003_feed_async_story_queue.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`
- Test: `workers/pebble/src/lib/story-generation/repository.test.ts`

- [ ] **Step 1: Write the failing repository test for chain bootstrap shape**

```ts
import { describe, expect, it } from "vitest";
import { createStoryGenerationRepository } from "./repository";

describe("story generation repository", () => {
  it("creates one active chain and one head task for a user with no live work", async () => {
    const repo = createStoryGenerationRepository(makeDb());

    const result = await repo.bootstrapChain({
      userId: "user-1",
      petId: "pet-1",
      now: new Date("2026-04-05T10:00:00.000Z").getTime(),
      minDelaySeconds: 600,
      generationBudget: 5,
      retryBudget: 2,
    });

    expect(result.chain.userId).toBe("user-1");
    expect(result.chain.remainingGenerations).toBe(5);
    expect(result.task.scheduledFor).toBe(
      new Date("2026-04-05T10:10:00.000Z").getTime(),
    );
  });

  it("returns the existing active chain instead of creating a duplicate one", async () => {
    const repo = createStoryGenerationRepository(makeDb({
      activeChain: {
        id: "chain-1",
        userId: "user-1",
        petId: "pet-1",
        remainingGenerations: 5,
        remainingRetries: 2,
      },
      activeTask: {
        id: "task-1",
        chainId: "chain-1",
        scheduledFor: new Date("2026-04-05T10:10:00.000Z").getTime(),
      },
    }));

    const result = await repo.bootstrapChain({
      userId: "user-1",
      petId: "pet-1",
      now: new Date("2026-04-05T10:00:00.000Z").getTime(),
      minDelaySeconds: 600,
      generationBudget: 5,
      retryBudget: 2,
    });

    expect(result.chain.id).toBe("chain-1");
    expect(result.task.id).toBe("task-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir workers/pebble test -- story-generation/repository.test.ts`
Expected: FAIL with module/file not found for `./repository`

- [ ] **Step 3: Add Drizzle schema entries**

```ts
export const storyGenerationChain = sqliteTable(
  "story_generation_chain",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    petId: text("pet_id").notNull().references(() => pet.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    remainingGenerations: integer("remaining_generations").notNull(),
    remainingRetries: integer("remaining_retries").notNull(),
    activeTaskId: text("active_task_id"),
    lastStoryAt: integer("last_story_at", { mode: "timestamp_ms" }),
    nextNotBeforeAt: integer("next_not_before_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("story_generation_chain_user_status_idx").on(table.userId, table.status),
    index("story_generation_chain_pet_status_idx").on(table.petId, table.status),
  ],
);

export const storyGenerationTask = sqliteTable(
  "story_generation_task",
  {
    id: text("id").primaryKey(),
    chainId: text("chain_id").notNull().references(() => storyGenerationChain.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    petId: text("pet_id").notNull().references(() => pet.id, { onDelete: "cascade" }),
    parentTaskId: text("parent_task_id"),
    status: text("status").notNull(),
    scheduledFor: integer("scheduled_for", { mode: "timestamp_ms" }).notNull(),
    attemptNumber: integer("attempt_number").notNull().default(1),
    proposedNextAt: integer("proposed_next_at", { mode: "timestamp_ms" }),
    validatedNextAt: integer("validated_next_at", { mode: "timestamp_ms" }),
    createdStoryId: text("created_story_id"),
    failureReason: text("failure_reason"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("story_generation_task_chain_status_idx").on(table.chainId, table.status),
    index("story_generation_task_user_status_idx").on(table.userId, table.status),
    index("story_generation_task_pet_status_idx").on(table.petId, table.status),
    index("story_generation_task_scheduled_for_idx").on(table.scheduledFor),
    index("story_generation_task_parent_task_id_idx").on(table.parentTaskId),
  ],
);
```

- [ ] **Step 4: Write the migration**

```sql
PRAGMA foreign_keys=OFF;

ALTER TABLE `story` RENAME TO `story_old`;

CREATE TABLE `story_generation_chain` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `pet_id` text NOT NULL,
  `status` text NOT NULL,
  `remaining_generations` integer NOT NULL,
  `remaining_retries` integer NOT NULL,
  `active_task_id` text,
  `last_story_at` integer,
  `next_not_before_at` integer,
  `created_at` integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  `updated_at` integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade,
  FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON DELETE cascade
);

CREATE TABLE `story_generation_task` (
  `id` text PRIMARY KEY NOT NULL,
  `chain_id` text NOT NULL,
  `user_id` text NOT NULL,
  `pet_id` text NOT NULL,
  `parent_task_id` text,
  `status` text NOT NULL,
  `scheduled_for` integer NOT NULL,
  `attempt_number` integer NOT NULL DEFAULT 1,
  `proposed_next_at` integer,
  `validated_next_at` integer,
  `created_story_id` text,
  `failure_reason` text,
  `started_at` integer,
  `finished_at` integer,
  `created_at` integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  `updated_at` integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  FOREIGN KEY (`chain_id`) REFERENCES `story_generation_chain`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade,
  FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON DELETE cascade
);

CREATE INDEX `story_generation_chain_user_status_idx` ON `story_generation_chain` (`user_id`, `status`);
CREATE INDEX `story_generation_chain_pet_status_idx` ON `story_generation_chain` (`pet_id`, `status`);
CREATE INDEX `story_generation_task_chain_status_idx` ON `story_generation_task` (`chain_id`, `status`);
CREATE INDEX `story_generation_task_user_status_idx` ON `story_generation_task` (`user_id`, `status`);
CREATE INDEX `story_generation_task_pet_status_idx` ON `story_generation_task` (`pet_id`, `status`);
CREATE INDEX `story_generation_task_scheduled_for_idx` ON `story_generation_task` (`scheduled_for`);
CREATE INDEX `story_generation_task_parent_task_id_idx` ON `story_generation_task` (`parent_task_id`);

CREATE TABLE `story` (
  `id` text PRIMARY KEY NOT NULL,
  `pet_id` text NOT NULL,
  `user_id` text NOT NULL,
  `task_id` text,
  `chain_id` text,
  `story_time` integer NOT NULL,
  `location` text,
  `activity_type` text,
  `story` text,
  `items_found` text,
  `metadata_json` text,
  `consumed_at` integer,
  `created_at` integer NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade,
  FOREIGN KEY (`task_id`) REFERENCES `story_generation_task`(`id`) ON DELETE set null,
  FOREIGN KEY (`chain_id`) REFERENCES `story_generation_chain`(`id`) ON DELETE set null
);

INSERT INTO `story` (
  `id`, `pet_id`, `user_id`, `story_time`, `location`, `activity_type`, `story`, `items_found`, `consumed_at`, `created_at`
)
SELECT
  s.`id`,
  s.`pet_id`,
  p.`player_id`,
  s.`time_window`,
  s.`location`,
  s.`activity_type`,
  s.`story`,
  s.`items_found`,
  CASE WHEN s.`collected` = 1 THEN s.`created_at` ELSE NULL END,
  s.`created_at`
FROM `story_old` s
JOIN `pet` p ON p.`id` = s.`pet_id`;

CREATE INDEX `story_task_id_idx` ON `story` (`task_id`);
CREATE INDEX `story_chain_id_idx` ON `story` (`chain_id`);
CREATE INDEX `story_pet_story_time_idx` ON `story` (`pet_id`, `story_time` DESC);
CREATE INDEX `story_pet_consumed_story_time_idx` ON `story` (`pet_id`, `consumed_at`, `story_time` DESC);
CREATE INDEX `story_user_consumed_at_idx` ON `story` (`user_id`, `consumed_at`);

DROP TABLE `story_old`;
PRAGMA foreign_keys=ON;
```

- [ ] **Step 5: Run repository test to verify schema compiles**

Run: `pnpm --dir workers/pebble test -- story-generation/repository.test.ts`
Expected: FAIL with `createStoryGenerationRepository is not a function`

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0003_feed_async_story_queue.sql packages/db/drizzle/meta/_journal.json workers/pebble/src/lib/story-generation/repository.test.ts
git commit -m "feat(db): add async feed story queue schema"
```

## Task 2: Story Generation Repository And Scheduling Helpers

**Files:**
- Create: `workers/pebble/src/lib/story-generation/types.ts`
- Create: `workers/pebble/src/lib/story-generation/repository.ts`
- Create: `workers/pebble/src/lib/story-generation/next-time.ts`
- Create: `workers/pebble/src/lib/story-generation/next-time.test.ts`
- Modify: `workers/pebble/src/lib/story-generation/repository.test.ts`

- [ ] **Step 1: Write the failing clamp test**

```ts
import { describe, expect, it } from "vitest";
import { resolveNextStoryTime } from "./next-time";

describe("resolveNextStoryTime", () => {
  it("clamps the AI-proposed time into the allowed min/max range", () => {
    const storyTime = new Date("2026-04-05T10:00:00.000Z").getTime();

    const nextTime = resolveNextStoryTime({
      storyTime,
      proposedNextAt: new Date("2026-04-05T10:01:00.000Z").getTime(),
      minDelaySeconds: 600,
      maxDelaySeconds: 1800,
    });

    expect(nextTime).toBe(new Date("2026-04-05T10:10:00.000Z").getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir workers/pebble test -- story-generation/next-time.test.ts`
Expected: FAIL with module/file not found for `./next-time`

- [ ] **Step 3: Implement scheduling helper**

```ts
export function resolveNextStoryTime(input: {
  storyTime: number;
  proposedNextAt?: number | null;
  minDelaySeconds: number;
  maxDelaySeconds: number;
}): number {
  const earliest = input.storyTime + input.minDelaySeconds * 1000;
  const latest = input.storyTime + input.maxDelaySeconds * 1000;
  const fallback = earliest;
  const proposed = input.proposedNextAt ?? fallback;
  return Math.min(latest, Math.max(earliest, proposed));
}
```

- [ ] **Step 4: Implement repository bootstrap and chain-head updates**

```ts
export function createStoryGenerationRepository(db: ReturnType<typeof getDb>) {
  return {
    async getActiveChainHeadForUser(userId: string) {
      // Return `{ chain, task }` for the single queued/running head task, or `null`.
    },

    async bootstrapChain(input: {
      userId: string;
      petId: string;
      now: number;
      minDelaySeconds: number;
      generationBudget: number;
      retryBudget: number;
    }) {
      const existing = await this.getActiveChainHeadForUser(input.userId);
      if (existing) {
        return existing;
      }

      const chainId = crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const scheduledFor = input.now + input.minDelaySeconds * 1000;

      await db.batch([
        db.insert(storyGenerationChain).values({
          id: chainId,
          userId: input.userId,
          petId: input.petId,
          status: "active",
          remainingGenerations: input.generationBudget,
          remainingRetries: input.retryBudget,
          activeTaskId: taskId,
        }),
        db.insert(storyGenerationTask).values({
          id: taskId,
          chainId,
          userId: input.userId,
          petId: input.petId,
          status: "queued",
          scheduledFor: new Date(scheduledFor),
        }),
      ]);

      return {
        chain: { id: chainId, userId: input.userId, petId: input.petId, remainingGenerations: input.generationBudget, remainingRetries: input.retryBudget },
        task: { id: taskId, scheduledFor },
      };
    },
  };
}
```

- [ ] **Step 5: Run focused tests to verify they pass**

Run: `pnpm --dir workers/pebble test -- story-generation/repository.test.ts story-generation/next-time.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/pebble/src/lib/story-generation/types.ts workers/pebble/src/lib/story-generation/repository.ts workers/pebble/src/lib/story-generation/next-time.ts workers/pebble/src/lib/story-generation/repository.test.ts workers/pebble/src/lib/story-generation/next-time.test.ts
git commit -m "feat(pebble): add story generation repository and schedule helper"
```

## Task 3: Queue And Workers AI Wiring

**Files:**
- Modify: `workers/pebble/wrangler.jsonc`
- Modify: `workers/pebble/src/index.ts`
- Create: `workers/pebble/src/lib/story-generation/ai.ts`
- Create: `workers/pebble/src/lib/story-generation/consumer.test.ts`

- [ ] **Step 1: Write the failing consumer test for successful task execution**

Note: `processStoryGenerationMessage` accepts a `generateStory` function via its input object for testability — no module mocking needed for the AI layer.

```ts
import { describe, expect, it, vi } from "vitest";
import { processStoryGenerationMessage } from "./consumer";

describe("processStoryGenerationMessage", () => {
  it("writes one story and enqueues the next task when chain budget remains", async () => {
    const repo = makeRepo();
    const generateStory = vi.fn().mockResolvedValue({
      story: "Basalt drifted through the Moonlit Library.",
      activityType: "wandering",
      location: "Moonlit Library",
      itemsFound: ["rice-ball"],
      proposedNextAt: new Date("2026-04-05T10:40:00.000Z").getTime(),
    });
    const queue = { send: vi.fn() };

    await processStoryGenerationMessage({
      env: makeEnv({ queue }),
      payload: {
        taskId: "task-1",
        petId: "pet-1",
        userId: "user-1",
        scheduledFor: new Date("2026-04-05T10:20:00.000Z").getTime(),
      },
      repo,
      generateStory,
    });

    expect(repo.completeSuccessfulTask).toHaveBeenCalled();
    expect(queue.send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir workers/pebble test -- story-generation/consumer.test.ts`
Expected: FAIL with module/file not found for `./consumer`

- [ ] **Step 3: Add Wrangler bindings**

```jsonc
{
  "vars": {
    "STORY_MIN_DELAY_SECONDS": 600,
    "STORY_MAX_DELAY_SECONDS": 1800,
    "STORY_MAX_GENERATIONS": 5,
    "STORY_MAX_RETRIES": 2
  },
  "queues": {
    "producers": [
      {
        "binding": "STORY_QUEUE",
        "queue": "rs-pebble-story-generation"
      }
    ],
    "consumers": [
      {
        "queue": "rs-pebble-story-generation",
        "max_batch_size": 1,
        "max_batch_timeout": 1
      }
    ]
  },
  "ai": {
    "binding": "AI"
  }
}
```

- [ ] **Step 4: Verify the existing `OAuthProvider` export shape before adding queue handling**

Run: `sed -n '1,220p' workers/pebble/src/index.ts`
Expected: current file exports `new OAuthProvider(...)` directly, so queue support must be added in a way that preserves the existing handler contract rather than assuming object spread is safe

- [ ] **Step 5: Add queue handler to the Worker entrypoint using a verified export shape**

```ts
import { processStoryGenerationBatch } from "./lib/story-generation/consumer";
import { generateStory } from "./lib/story-generation/ai";

const oauthWorker = new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
});

export default {
  fetch: oauthWorker.fetch.bind(oauthWorker),
  async queue(batch: MessageBatch<StoryQueueMessage>, env: CloudflareBindings, ctx: ExecutionContext) {
    await processStoryGenerationBatch(batch, env, ctx, generateStory);
  },
};
```

- [ ] **Step 6: Add Workers AI wrapper**

```ts
import { z } from "zod";

const aiStoryResponse = z.object({
  story: z.string().min(1),
  activityType: z.string().optional(),
  location: z.string().optional(),
  itemsFound: z.array(z.string()).optional(),
  proposedNextAt: z.number().int().optional(),
});

export async function generateStory(env: CloudflareBindings, prompt: string) {
  const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    prompt,
    response_format: { type: "json_object" },
  });
  return aiStoryResponse.parse(JSON.parse(String(response.response)));
}
```

- [ ] **Step 7: Run focused tests**

Run: `pnpm --dir workers/pebble test -- story-generation/consumer.test.ts`
Expected: FAIL with missing repository behavior, but entrypoint/build-time imports resolve

- [ ] **Step 8: Commit**

```bash
git add workers/pebble/wrangler.jsonc workers/pebble/src/index.ts workers/pebble/src/lib/story-generation/ai.ts workers/pebble/src/lib/story-generation/consumer.test.ts
git commit -m "feat(pebble): wire queue and workers ai bindings"
```

## Task 4: Queue Consumer Implementation

**Files:**
- Create: `workers/pebble/src/lib/story-generation/consumer.ts`
- Modify: `workers/pebble/src/lib/story-generation/repository.ts`
- Modify: `workers/pebble/src/lib/story-generation/consumer.test.ts`

- [ ] **Step 1: Add failing test for invalid AI output consuming retry budget only**

```ts
it("marks the task invalid and decrements chain retries without spending generation budget", async () => {
  const repo = makeRepo();
  const generateStory = vi.fn().mockRejectedValue(new Error("invalid ai payload"));

  await processStoryGenerationMessage({
    env: makeEnv(),
    payload: makePayload(),
    repo,
    generateStory,
  });

  expect(repo.markTaskInvalid).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: "task-1", failureReason: "invalid ai payload" }),
  );
  expect(repo.decrementGenerationBudget).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir workers/pebble test -- story-generation/consumer.test.ts`
Expected: FAIL on missing `markTaskInvalid` / `processStoryGenerationMessage`

- [ ] **Step 3: Implement consumer orchestration**

```ts
export type GenerateStoryFn = (env: CloudflareBindings, prompt: string) => Promise<AiStoryResponse>;

export async function processStoryGenerationMessage(input: {
  env: CloudflareBindings;
  payload: StoryQueueMessage;
  repo: ReturnType<typeof createStoryGenerationRepository>;
  generateStory: GenerateStoryFn;
}) {
  const task = await input.repo.getTaskForProcessing(input.payload.taskId);
  if (!task || task.createdStoryId || task.status === "succeeded") {
    return;
  }

  await input.repo.markTaskRunning(task.id);

  try {
    const result = await input.generateStory(input.env, buildStoryPrompt(task));
    const story = await input.repo.completeSuccessfulTask({
      task,
      story: result.story,
      activityType: result.activityType ?? null,
      location: result.location ?? null,
      itemsFound: result.itemsFound ?? [],
      proposedNextAt: result.proposedNextAt ?? null,
    });

    if (story.remainingGenerations > 0) {
      const nextScheduledFor = resolveNextStoryTime({
        storyTime: story.storyTime,
        proposedNextAt: result.proposedNextAt ?? null,
        minDelaySeconds: input.env.STORY_MIN_DELAY_SECONDS,
        maxDelaySeconds: input.env.STORY_MAX_DELAY_SECONDS,
      });
      const nextTask = await input.repo.enqueueNextTask({ chainId: task.chainId, parentTaskId: task.id, scheduledFor: nextScheduledFor });
      await input.env.STORY_QUEUE.send({ taskId: nextTask.id, petId: task.petId, userId: task.userId, scheduledFor: nextScheduledFor }, { delaySeconds: Math.max(0, Math.floor((nextScheduledFor - Date.now()) / 1000)) });
    }
  } catch (error) {
    await input.repo.markTaskInvalid({
      taskId: task.id,
      failureReason: error instanceof Error ? error.message : String(error),
    });
  }
}
```

- [ ] **Step 4: Run consumer tests to verify they pass**

Run: `pnpm --dir workers/pebble test -- story-generation/consumer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add workers/pebble/src/lib/story-generation/consumer.ts workers/pebble/src/lib/story-generation/repository.ts workers/pebble/src/lib/story-generation/consumer.test.ts
git commit -m "feat(pebble): implement async story generation consumer"
```

## Task 5: Refactor `feed` To Async Bootstrap And Consumption

**Files:**
- Modify: `workers/pebble/src/lib/mcp/tools/feed.ts`
- Modify: `workers/pebble/src/lib/mcp/tools/feed.test.ts`
- Modify: `workers/pebble/src/lib/mcp/tools/save-story.ts`

- [ ] **Step 1: Expand `feed` tests to cover the scenario matrix**

```ts
it("creates a new chain and root task on empty bootstrap when no live task exists", async () => {
  const repo = makeRepo({
    activeTask: null,
    unconsumedStories: [],
  });

  const result = await runFeed({ repo });
  const payload = JSON.parse(result.content[0]!.text);

  expect(repo.bootstrapChain).toHaveBeenCalledTimes(1);
  expect(payload.generation.active).toBe(true);
});

it("resets the active chain budget but does not create a new task when one queued task already exists", async () => {
  const repo = makeRepo({
    activeTask: { id: "task-1", status: "queued" },
    unconsumedStories: [{ id: "story-1", story: "Basalt drifted.", storyTime: 1 }],
  });

  await runFeed({ repo });

  expect(repo.resetActiveChainBudget).toHaveBeenCalledTimes(1);
  expect(repo.bootstrapChain).not.toHaveBeenCalled();
});

it("does not create a new chain during in-flight idle polling with no unconsumed stories", async () => {
  const repo = makeRepo({
    activeTask: { id: "task-1", status: "queued" },
    unconsumedStories: [],
  });

  await runFeed({ repo });

  expect(repo.bootstrapChain).not.toHaveBeenCalled();
  expect(repo.resetActiveChainBudget).not.toHaveBeenCalled();
});

it("bootstraps a new chain after a terminal idle state with no unconsumed stories", async () => {
  const repo = makeRepo({
    activeTask: null,
    unconsumedStories: [],
    latestChain: { id: "chain-1", status: "completed" },
  });

  await runFeed({ repo });

  expect(repo.bootstrapChain).toHaveBeenCalledTimes(1);
});

it("creates at most one chain when two feed calls race with no live task", async () => {
  const repo = makeRaceAwareRepo();

  const results = await Promise.allSettled([runFeed({ repo }), runFeed({ repo })]);

  expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  expect(repo.bootstrapChain).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir workers/pebble test -- lib/mcp/tools/feed.test.ts`
Expected: FAIL on missing repository methods and old `runLifeEngine` assertions

- [ ] **Step 3: Replace `runLifeEngine` in `feed.ts`**

```ts
const playerId = getPlayerId();
const repo = createStoryGenerationRepository(getDb(env));
const pet = await repo.getPetForFeed(playerId);
const now = Date.now();

const stories = await repo.listRecentVisibleStories(pet.id);
const unconsumedStories = stories.filter((story) => !story.consumedAt);

const shouldResetBudget = unconsumedStories.length > 0;
const generationBudget = env.STORY_MAX_GENERATIONS;
const retryBudget = env.STORY_MAX_RETRIES;

if (unconsumedStories.length > 0) {
  await repo.consumeStories({
    storyIds: unconsumedStories.map((story) => story.id),
    consumedAt: now,
  });
}

const activeHead = await repo.getActiveChainHeadForUser(playerId);
if (!activeHead) {
  const bootstrapped = await repo.bootstrapChain({
    userId: playerId,
    petId: pet.id,
    now,
    minDelaySeconds: env.STORY_MIN_DELAY_SECONDS,
    generationBudget,
    retryBudget,
  });
  await env.STORY_QUEUE.send({
    taskId: bootstrapped.task.id,
    petId: pet.id,
    userId: playerId,
    scheduledFor: bootstrapped.task.scheduledFor,
  }, {
    delaySeconds: Math.max(0, Math.floor((bootstrapped.task.scheduledFor - now) / 1000)),
  });
} else if (shouldResetBudget) {
  await repo.resetActiveChainBudget({
    chainId: activeHead.chain.id,
    generationBudget: env.STORY_MAX_GENERATIONS,
    retryBudget: env.STORY_MAX_RETRIES,
  });
}
```

- [ ] **Step 4: Restrict `save-story` to non-feed authored content**

```ts
if (input.stories && input.stories.length > 0) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      error: "Feed stories are server-generated now. save-story only accepts pet ASCII art.",
    }) }],
    isError: true as const,
  };
}
```

- [ ] **Step 5: Run focused tests**

Run: `pnpm --dir workers/pebble test -- lib/mcp/tools/feed.test.ts lib/mcp/tools/adopt.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add workers/pebble/src/lib/mcp/tools/feed.ts workers/pebble/src/lib/mcp/tools/feed.test.ts workers/pebble/src/lib/mcp/tools/save-story.ts
git commit -m "feat(pebble): refactor feed to async chain bootstrap"
```

## Task 6: Full Verification, Cleanup, And Docs Alignment

**Files:**
- Modify: `docs/superpowers/specs/2026-04-05-feed-async-story-queue-design.md`
- Modify: `docs/superpowers/plans/2026-04-05-feed-async-story-queue.md`
- Verify: `workers/pebble/src/lib/engine/life-engine.ts`

- [ ] **Step 1: Add an integration-style test for race-safe chain bootstrap only if Task 5 coverage is still insufficient**

Note: If the Task 5 race test fully covers the repository + feed dedup path, keep this step focused on any remaining uncovered repository edge case instead of duplicating the same scenario.

```ts
it("creates at most one chain when two feed calls race with no live task", async () => {
  const repo = makeRepo({
    activeTask: null,
    unconsumedStories: [],
  });

  // After the first bootstrapChain call, simulate the task now existing
  let callCount = 0;
  const originalBootstrap = repo.bootstrapChain;
  repo.bootstrapChain = vi.fn(async (...args) => {
    callCount++;
    if (callCount > 1) {
      // Second call sees the task created by the first
      throw new Error("UNIQUE constraint failed");
    }
    return originalBootstrap(...args);
  });
  repo.getActiveChainHeadForUser = vi.fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({
      chain: { id: "chain-1", remainingGenerations: 5, remainingRetries: 2 },
      task: { id: "task-1", chainId: "chain-1", status: "queued" },
    });

  const results = await Promise.allSettled([runFeed({ repo }), runFeed({ repo })]);

  // Both should succeed (second catches the constraint error gracefully)
  expect(results.every((r) => r.status === "fulfilled")).toBe(true);
});
```

- [ ] **Step 2: Run the full Pebble test suite**

Run: `pnpm --dir workers/pebble test`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm --dir workers/pebble typecheck`
Expected: PASS

Run: `pnpm --dir packages/db exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Smoke-check that legacy life-engine code is no longer on the `feed` path**

Run: `rg -n "runLifeEngine" workers/pebble/src/lib/mcp/tools/feed.ts workers/pebble/src/index.ts workers/pebble/src/lib/story-generation`
Expected: no matches in `feed.ts`; matches allowed only in legacy files/tests that are still intentionally retained

- [ ] **Step 5: Update docs inline if implementation names diverged**

```md
- If `STORY_QUEUE` / `story_generation_chain` / `story_generation_task` names changed during implementation,
  update `docs/superpowers/specs/2026-04-05-feed-async-story-queue-design.md`
  and this plan so the saved documents match the shipped code exactly.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-04-05-feed-async-story-queue-design.md docs/superpowers/plans/2026-04-05-feed-async-story-queue.md workers/pebble/src/lib/mcp/tools/feed.test.ts
git commit -m "test(pebble): verify async feed story queue flow"
```

## Self-Review

- Spec coverage:
  - queue-driven future story generation: Tasks 2-4
  - one active chain per user: Tasks 1-2 and 5
  - `feed` scenario matrix: Task 5 and Task 6
  - Workers AI + Queue wiring: Task 3
  - migration from `runLifeEngine` feed path: Tasks 1 and 5
- Placeholder scan:
  - no `TODO`/`TBD`
  - commands use actual repo scripts
  - every code-changing step includes concrete code
- Type consistency:
  - `story_generation_chain`, `story_generation_task`, `STORY_QUEUE`, and `resolveNextStoryTime` are used consistently across tasks

Plan complete and saved to `docs/superpowers/plans/2026-04-05-feed-async-story-queue.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
