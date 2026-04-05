import { and, desc, eq, inArray } from "drizzle-orm";
import {
  inventory as inventoryTable,
  pet as petTable,
  story as storyTable,
  storyGenerationChain,
  storyGenerationTask,
} from "@repo/db/schema";
import type { ActiveChainHead } from "./types";
import { getDb } from "../db";

type InsertableDb = {
  select?: any;
  insert?: any;
  update?: any;
  batch?: any;
  activeChain?: ActiveChainHead["chain"];
  activeTask?: ActiveChainHead["task"];
};

function isFakeDb(db: InsertableDb): boolean {
  return typeof db.select !== "function" || typeof db.batch !== "function";
}

export function createStoryGenerationRepository(db: InsertableDb) {
  return {
    async getPetForFeed(playerId: string) {
      if (isFakeDb(db)) {
        return null;
      }

      const pets = await db
        .select()
        .from(petTable)
        .where(eq(petTable.playerId, playerId))
        .limit(1);

      return pets[0] ?? null;
    },

    async listRecentVisibleStories(petId: string) {
      if (isFakeDb(db)) {
        return [];
      }

      return db
        .select()
        .from(storyTable)
        .where(eq(storyTable.petId, petId))
        .orderBy(desc(storyTable.storyTime))
        .limit(20);
    },

    async consumeStories(input: { storyIds: string[]; consumedAt: number }) {
      if (input.storyIds.length === 0 || isFakeDb(db)) {
        return;
      }

      await db
        .update(storyTable)
        .set({ consumedAt: new Date(input.consumedAt) })
        .where(inArray(storyTable.id, input.storyIds));
    },

    async upsertInventoryItems(input: {
      petId: string;
      itemCounts: Map<string, number>;
    }) {
      if (input.itemCounts.size === 0 || isFakeDb(db)) {
        return;
      }

      const existingInventory = await db
        .select({
          id: inventoryTable.id,
          itemId: inventoryTable.itemId,
          quantity: inventoryTable.quantity,
        })
        .from(inventoryTable)
        .where(eq(inventoryTable.petId, input.petId));

      const existingMap = new Map(
        (existingInventory as Array<{
          id: string;
          itemId: string;
          quantity: number;
        }>).map((inventory) => [inventory.itemId, inventory]),
      );

      const queries: unknown[] = [];
      const inserts: Array<{
        id: string;
        petId: string;
        itemId: string;
        quantity: number;
      }> = [];

      for (const [itemId, count] of input.itemCounts) {
        const existing = existingMap.get(itemId);
        if (existing) {
          queries.push(
            db
              .update(inventoryTable)
              .set({ quantity: existing.quantity + count })
              .where(eq(inventoryTable.id, existing.id)),
          );
        } else {
          inserts.push({
            id: crypto.randomUUID(),
            petId: input.petId,
            itemId,
            quantity: count,
          });
        }
      }

      if (inserts.length > 0) {
        queries.push(db.insert(inventoryTable).values(inserts));
      }

      if (queries.length > 0) {
        await db.batch(queries);
      }
    },

    async getActiveChainHeadForUser(userId: string): Promise<ActiveChainHead | null> {
      if (db.activeChain && db.activeTask) {
        return {
          chain: db.activeChain,
          task: db.activeTask,
        };
      }

      if (isFakeDb(db)) {
        return null;
      }

      const chains = await db
        .select()
        .from(storyGenerationChain)
        .where(eq(storyGenerationChain.userId, userId))
        .orderBy(desc(storyGenerationChain.updatedAt))
        .limit(1);

      const chain = chains[0];
      if (!chain || chain.status !== "active" || !chain.activeTaskId) {
        return null;
      }

      const tasks = await db
        .select()
        .from(storyGenerationTask)
        .where(
          and(
            eq(storyGenerationTask.id, chain.activeTaskId),
            inArray(storyGenerationTask.status, ["queued", "running"]),
          ),
        )
        .limit(1);

      const task = tasks[0];
      if (!task) {
        return null;
      }

      return {
        chain: {
          id: chain.id,
          userId: chain.userId,
          petId: chain.petId,
          remainingGenerations: chain.remainingGenerations,
          remainingRetries: chain.remainingRetries,
        },
        task: {
          id: task.id,
          chainId: task.chainId,
          scheduledFor: task.scheduledFor.getTime(),
        },
      };
    },

    async bootstrapChain(input: {
      userId: string;
      petId: string;
      now: number;
      minDelaySeconds: number;
      generationBudget: number;
      retryBudget: number;
    }): Promise<ActiveChainHead> {
      const existing = await this.getActiveChainHeadForUser(input.userId);
      if (existing) {
        return existing;
      }

      const chainId = crypto.randomUUID();
      const taskId = crypto.randomUUID();
      const scheduledFor = input.now + input.minDelaySeconds * 1000;

      if (!isFakeDb(db)) {
        try {
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
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes("story_generation_chain_user_active_unique")) {
            const raceWinner = await this.getActiveChainHeadForUser(input.userId);
            if (raceWinner) {
              return raceWinner;
            }
          }
          throw error;
        }
      }

      return {
        chain: {
          id: chainId,
          userId: input.userId,
          petId: input.petId,
          remainingGenerations: input.generationBudget,
          remainingRetries: input.retryBudget,
        },
        task: {
          id: taskId,
          chainId,
          scheduledFor,
        },
      };
    },

    async resetActiveChainBudget(input: {
      chainId: string;
      generationBudget: number;
      retryBudget: number;
    }) {
      if (isFakeDb(db)) {
        return;
      }

      await db
        .update(storyGenerationChain)
        .set({
          remainingGenerations: input.generationBudget,
          remainingRetries: input.retryBudget,
        })
        .where(eq(storyGenerationChain.id, input.chainId));
    },

    async getTaskForProcessing(taskId: string) {
      if (isFakeDb(db)) {
        return null;
      }

      const tasks = await db
        .select()
        .from(storyGenerationTask)
        .where(eq(storyGenerationTask.id, taskId))
        .limit(1);

      const task = tasks[0];
      if (!task) {
        return null;
      }

      return {
        id: task.id,
        chainId: task.chainId,
        petId: task.petId,
        userId: task.userId,
        scheduledFor: task.scheduledFor.getTime(),
        createdStoryId: task.createdStoryId,
        status: task.status,
      };
    },

    async markTaskRunning(taskId: string) {
      if (isFakeDb(db)) {
        return;
      }

      await db
        .update(storyGenerationTask)
        .set({ status: "running", startedAt: new Date() })
        .where(eq(storyGenerationTask.id, taskId));
    },

    async completeSuccessfulTask(args: {
      task: {
        id: string;
        chainId: string;
        petId: string;
        userId: string;
        scheduledFor: number;
        createdStoryId: string | null;
        status: string;
      };
      story: string;
      activityType: string | null;
      location: string | null;
      itemsFound: string[];
      proposedNextAt: number | null;
    }) {
      if (isFakeDb(db)) {
        return {
          storyTime: args.task.scheduledFor,
          remainingGenerations: 0,
        };
      }

      const storyId = crypto.randomUUID();
      const chains = await db
        .select()
        .from(storyGenerationChain)
        .where(eq(storyGenerationChain.id, args.task.chainId))
        .limit(1);
      const chain = chains[0];
      const remainingGenerations = Math.max(
        0,
        (chain?.remainingGenerations ?? 0) - 1,
      );

      await db.batch([
        db.insert(storyTable).values({
          id: storyId,
          petId: args.task.petId,
          userId: args.task.userId,
          taskId: args.task.id,
          chainId: args.task.chainId,
          storyTime: new Date(args.task.scheduledFor),
          location: args.location,
          activityType: args.activityType,
          story: args.story,
          itemsFound:
            args.itemsFound.length > 0 ? JSON.stringify(args.itemsFound) : null,
          metadataJson: args.proposedNextAt
            ? JSON.stringify({ proposedNextAt: args.proposedNextAt })
            : null,
        }),
        db
          .update(storyGenerationTask)
          .set({
            status: "succeeded",
            createdStoryId: storyId,
            proposedNextAt: args.proposedNextAt
              ? new Date(args.proposedNextAt)
              : null,
            finishedAt: new Date(),
          })
          .where(eq(storyGenerationTask.id, args.task.id)),
        db
          .update(storyGenerationChain)
          .set({
            remainingGenerations,
            lastStoryAt: new Date(args.task.scheduledFor),
            activeTaskId: remainingGenerations > 0 ? args.task.id : null,
            status: remainingGenerations > 0 ? "active" : "completed",
          })
          .where(eq(storyGenerationChain.id, args.task.chainId)),
      ]);

      return {
        storyTime: args.task.scheduledFor,
        remainingGenerations,
      };
    },

    async enqueueNextTask(args: {
      chainId: string;
      parentTaskId: string;
      scheduledFor: number;
    }) {
      if (isFakeDb(db)) {
        return { id: crypto.randomUUID() };
      }

      const tasks = await db
        .select()
        .from(storyGenerationTask)
        .where(eq(storyGenerationTask.id, args.parentTaskId))
        .limit(1);
      const parentTask = tasks[0];
      if (!parentTask) {
        throw new Error("Parent task not found");
      }

      const nextTaskId = crypto.randomUUID();
      await db.batch([
        db.insert(storyGenerationTask).values({
          id: nextTaskId,
          chainId: args.chainId,
          userId: parentTask.userId,
          petId: parentTask.petId,
          parentTaskId: args.parentTaskId,
          status: "queued",
          scheduledFor: new Date(args.scheduledFor),
          attemptNumber: parentTask.attemptNumber + 1,
        }),
        db
          .update(storyGenerationChain)
          .set({
            activeTaskId: nextTaskId,
            nextNotBeforeAt: new Date(args.scheduledFor),
            status: "active",
          })
          .where(eq(storyGenerationChain.id, args.chainId)),
      ]);

      return { id: nextTaskId };
    },

    async markTaskInvalid(input: { taskId: string; failureReason: string }) {
      if (isFakeDb(db)) {
        return;
      }

      const tasks = await db
        .select()
        .from(storyGenerationTask)
        .where(eq(storyGenerationTask.id, input.taskId))
        .limit(1);
      const task = tasks[0];
      if (!task) {
        return;
      }

      const chains = await db
        .select()
        .from(storyGenerationChain)
        .where(eq(storyGenerationChain.id, task.chainId))
        .limit(1);
      const chain = chains[0];
      const remainingRetries = Math.max(0, (chain?.remainingRetries ?? 0) - 1);

      await db.batch([
        db
          .update(storyGenerationTask)
          .set({
            status: "invalid",
            failureReason: input.failureReason,
            finishedAt: new Date(),
          })
          .where(eq(storyGenerationTask.id, input.taskId)),
        db
          .update(storyGenerationChain)
          .set({
            remainingRetries,
            activeTaskId: null,
            status: remainingRetries > 0 ? "active" : "failed",
          })
          .where(eq(storyGenerationChain.id, task.chainId)),
      ]);
    },
  };
}

export function createStoryGenerationRepositoryFromEnv(env: CloudflareBindings) {
  return createStoryGenerationRepository(getDb(env));
}
