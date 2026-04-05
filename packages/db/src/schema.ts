import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .default(false)
    .notNull(),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  role: text("role"),
  banned: integer("banned", { mode: "boolean" }).default(false),
  banReason: text("ban_reason"),
  banExpires: integer("ban_expires", { mode: "timestamp_ms" }),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// --- Pebble tables ---

export const pet = sqliteTable(
  "pet",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seed: integer("seed").notNull(),
    asciiArt: text("ascii_art"),
    curiosity: integer("curiosity").notNull(),
    energy: integer("energy").notNull(),
    sociability: integer("sociability").notNull(),
    courage: integer("courage").notNull(),
    creativity: integer("creativity").notNull(),
    lastCheckedAt: integer("last_checked_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("pet_playerId_idx").on(table.playerId),
    uniqueIndex("pet_playerId_unique").on(table.playerId),
  ],
);

export const item = sqliteTable("item", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  asciiArt: text("ascii_art").notNull(),
  category: text("category").notNull(),
  effectTarget: text("effect_target"),
  effectStrength: integer("effect_strength"),
  rarity: text("rarity").notNull(),
});

export const inventory = sqliteTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pet.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [
    index("inventory_petId_itemId_idx").on(table.petId, table.itemId),
    uniqueIndex("inventory_petId_itemId_unique").on(table.petId, table.itemId),
  ],
);

export const pack = sqliteTable(
  "pack",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pet.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => item.id),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [
    index("pack_petId_itemId_idx").on(table.petId, table.itemId),
    uniqueIndex("pack_petId_itemId_unique").on(table.petId, table.itemId),
  ],
);

export const story = sqliteTable(
  "story",
  {
    id: text("id").primaryKey(),
    petId: text("pet_id")
      .notNull()
      .references(() => pet.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => storyGenerationTask.id, {
      onDelete: "set null",
    }),
    chainId: text("chain_id").references(() => storyGenerationChain.id, {
      onDelete: "set null",
    }),
    storyTime: integer("story_time", { mode: "timestamp_ms" }).notNull(),
    location: text("location"),
    activityType: text("activity_type"),
    story: text("story"),
    itemsFound: text("items_found"),
    metadataJson: text("metadata_json"),
    consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("story_task_id_idx").on(table.taskId),
    index("story_chain_id_idx").on(table.chainId),
    index("story_pet_story_time_idx").on(table.petId, table.storyTime),
    index("story_pet_consumed_story_time_idx").on(
      table.petId,
      table.consumedAt,
      table.storyTime,
    ),
    index("story_user_consumed_at_idx").on(table.userId, table.consumedAt),
  ],
);

export const storyGenerationChain = sqliteTable(
  "story_generation_chain",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    petId: text("pet_id")
      .notNull()
      .references(() => pet.id, { onDelete: "cascade" }),
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
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
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
    chainId: text("chain_id")
      .notNull()
      .references(() => storyGenerationChain.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    petId: text("pet_id")
      .notNull()
      .references(() => pet.id, { onDelete: "cascade" }),
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
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
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

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));
