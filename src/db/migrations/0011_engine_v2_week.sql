CREATE TABLE `plan_generations_v2` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`trigger` text NOT NULL,
	`from_date` text NOT NULL,
	`changes` text NOT NULL,
	`seen_at` text
);
--> statement-breakpoint
CREATE INDEX `plan_generations_v2_created_idx` ON `plan_generations_v2` (`created_at`);--> statement-breakpoint
CREATE TABLE `planned_days_v2` (
	`date` text PRIMARY KEY NOT NULL,
	`selection` text,
	`forecast` text,
	`status` text NOT NULL,
	`generation_id` text NOT NULL,
	`updated_at` text NOT NULL
);
