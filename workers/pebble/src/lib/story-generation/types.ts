export interface StoryQueueMessage {
  taskId: string;
  petId: string;
  userId: string;
  scheduledFor: number;
}

export interface ActiveChainHead {
  chain: {
    id: string;
    userId: string;
    petId: string;
    remainingGenerations: number;
    remainingRetries: number;
  };
  task: {
    id: string;
    chainId?: string;
    scheduledFor: number;
  };
}

export interface AiStoryResponse {
  story: string;
  activityType?: string;
  location?: string;
  itemsFound?: string[];
  proposedNextAt?: number;
}
