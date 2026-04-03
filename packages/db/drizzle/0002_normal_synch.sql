CREATE TABLE `inventory` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_petId_itemId_idx` ON `inventory` (`pet_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_petId_itemId_unique` ON `inventory` (`pet_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`ascii_art` text NOT NULL,
	`category` text NOT NULL,
	`effect_target` text,
	`effect_strength` integer,
	`rarity` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pack` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`item_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pack_petId_itemId_idx` ON `pack` (`pet_id`,`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pack_petId_itemId_unique` ON `pack` (`pet_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `pet` (
	`id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`name` text NOT NULL,
	`seed` integer NOT NULL,
	`ascii_art` text,
	`curiosity` integer NOT NULL,
	`energy` integer NOT NULL,
	`sociability` integer NOT NULL,
	`courage` integer NOT NULL,
	`creativity` integer NOT NULL,
	`last_checked_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pet_playerId_idx` ON `pet` (`player_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pet_playerId_unique` ON `pet` (`player_id`);--> statement-breakpoint
CREATE TABLE `story` (
	`id` text PRIMARY KEY NOT NULL,
	`pet_id` text NOT NULL,
	`time_window` integer NOT NULL,
	`activity_type` text NOT NULL,
	`location` text,
	`story` text,
	`encountered_pet_id` text,
	`items_found` text,
	`collected` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`pet_id`) REFERENCES `pet`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `story_petId_idx` ON `story` (`pet_id`);--> statement-breakpoint
CREATE INDEX `story_timeWindow_location_idx` ON `story` (`time_window`,`location`);--> statement-breakpoint
CREATE UNIQUE INDEX `story_petId_timeWindow_unique` ON `story` (`pet_id`,`time_window`);