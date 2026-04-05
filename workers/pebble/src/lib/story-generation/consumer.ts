import { resolveNextStoryTime } from "./next-time";
import { createStoryGenerationRepositoryFromEnv } from "./repository";
import type { AiStoryResponse, StoryQueueMessage } from "./types";

export type GenerateStoryFn = (
  env: CloudflareBindings,
  prompt: string,
) => Promise<AiStoryResponse>;

function buildStoryPrompt(task: {
  petId: string;
  scheduledFor?: number;
}) {
  return `Write one cozy pet story for ${task.petId} at ${task.scheduledFor ?? "unknown time"}. Return JSON.`;
}

export async function processStoryGenerationMessage(input: {
  env: CloudflareBindings;
  payload: StoryQueueMessage;
  repo: {
    getTaskForProcessing: (taskId: string) => Promise<{
      id: string;
      chainId: string;
      petId: string;
      userId: string;
      scheduledFor: number;
      createdStoryId: string | null;
      status: string;
    } | null>;
    markTaskRunning: (taskId: string) => Promise<unknown>;
    completeSuccessfulTask: (args: {
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
    }) => Promise<{
      storyTime: number;
      remainingGenerations: number;
    }>;
    enqueueNextTask: (args: {
      chainId: string;
      parentTaskId: string;
      scheduledFor: number;
    }) => Promise<{ id: string }>;
    markTaskInvalid?: (args: {
      taskId: string;
      failureReason: string;
    }) => Promise<unknown>;
  };
  generateStory: GenerateStoryFn;
}) {
  const task = await input.repo.getTaskForProcessing(input.payload.taskId);
  if (!task || task.createdStoryId || task.status === "succeeded") {
    return;
  }

  await input.repo.markTaskRunning(task.id);

  try {
    const result = await input.generateStory(input.env, buildStoryPrompt(input.payload));
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
      const nextTask = await input.repo.enqueueNextTask({
        chainId: task.chainId,
        parentTaskId: task.id,
        scheduledFor: nextScheduledFor,
      });
      await input.env.STORY_QUEUE.send(
        {
          taskId: nextTask.id,
          petId: task.petId,
          userId: task.userId,
          scheduledFor: nextScheduledFor,
        },
        {
          delaySeconds: Math.max(
            0,
            Math.floor((nextScheduledFor - Date.now()) / 1000),
          ),
        },
      );
    }
  } catch (error) {
    if (input.repo.markTaskInvalid) {
      await input.repo.markTaskInvalid({
        taskId: input.payload.taskId,
        failureReason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function processStoryGenerationBatch(
  batch: MessageBatch<StoryQueueMessage>,
  env: CloudflareBindings,
  _ctx: ExecutionContext,
  generateStory: GenerateStoryFn,
) {
  for (const message of batch.messages) {
    await processStoryGenerationMessage({
      env,
      payload: message.body,
      repo: createStoryGenerationRepositoryFromEnv(env),
      generateStory,
    });
    message.ack();
  }
}
