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
CREATE UNIQUE INDEX `story_generation_chain_user_active_unique` ON `story_generation_chain` (`user_id`) WHERE `status` = 'active';
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
