CREATE TABLE `training_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`block_index` integer NOT NULL,
	`started_on` text NOT NULL,
	`deload_from` text,
	`deload_reason` text,
	`selections` text NOT NULL,
	`closed_on` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `training_blocks_closed_idx` ON `training_blocks` (`closed_on`);--> statement-breakpoint
ALTER TABLE `user_profile` ADD `excluded_exercise_ids` text;--> statement-breakpoint
ALTER TABLE `workouts` ADD `plan` text;