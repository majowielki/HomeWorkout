CREATE TABLE `plan_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`muscles` text NOT NULL,
	`from_date` text NOT NULL,
	`until_date` text NOT NULL,
	`reason` text NOT NULL,
	`source` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`revoked_at` text
);
--> statement-breakpoint
CREATE TABLE `plan_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`trigger` text NOT NULL,
	`from_date` text NOT NULL,
	`changes` text NOT NULL,
	`seen_at` text
);
--> statement-breakpoint
CREATE INDEX `plan_generations_created_idx` ON `plan_generations` (`created_at`);--> statement-breakpoint
CREATE TABLE `planned_days` (
	`date` text PRIMARY KEY NOT NULL,
	`selection` text,
	`forecast` text,
	`status` text NOT NULL,
	`generation_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `user_profile` ADD `rest_weekdays` text;