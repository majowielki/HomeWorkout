CREATE TABLE `command_ledger` (
	`command_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`workout_id` text,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `command_ledger_created_idx` ON `command_ledger` (`created_at`);--> statement-breakpoint
CREATE TABLE `exposure_outcomes` (
	`workout_id` text NOT NULL,
	`exposure_id` text NOT NULL,
	`status` text NOT NULL,
	`plan_revision` integer NOT NULL,
	`history_revision` integer NOT NULL,
	`expected` integer NOT NULL,
	`performed` integer NOT NULL,
	`interrupted` integer NOT NULL,
	`skipped` integer NOT NULL,
	PRIMARY KEY(`workout_id`, `exposure_id`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feel_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exposure_id` text,
	`feel` text NOT NULL,
	`channel` text NOT NULL,
	`command_id` text NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feel_reports_command_uq` ON `feel_reports` (`command_id`);--> statement-breakpoint
CREATE TABLE `legacy_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`training_date` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`session_rpe` integer,
	`notes` text,
	`plan` text,
	`sets` text NOT NULL,
	`archived_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `legacy_sessions_date_idx` ON `legacy_sessions` (`training_date`);--> statement-breakpoint
CREATE TABLE `planning_revisions` (
	`domain` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_plan_revisions` (
	`workout_id` text NOT NULL,
	`plan_revision` integer NOT NULL,
	`plan` text NOT NULL,
	`reason` text NOT NULL,
	`channel` text NOT NULL,
	`overrides` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workout_id`, `plan_revision`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `set_dispositions` (
	`workout_id` text NOT NULL,
	`planned_set_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`command_id` text NOT NULL,
	`at` text NOT NULL,
	PRIMARY KEY(`workout_id`, `planned_set_id`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_dispositions_command_uq` ON `set_dispositions` (`command_id`);--> statement-breakpoint
CREATE TABLE `set_log_revisions` (
	`set_log_id` text NOT NULL,
	`revision` integer NOT NULL,
	`payload` text,
	`replaced_at` text NOT NULL,
	PRIMARY KEY(`set_log_id`, `revision`),
	FOREIGN KEY (`set_log_id`) REFERENCES `set_logs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `set_logs` ADD `command_id` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `planned_set_id` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `exposure_id` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `logical_set_id` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `role` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `comparison_key` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `progression_scope` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `source` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `performed_on` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `set_logs` ADD `observation` text;--> statement-breakpoint
CREATE UNIQUE INDEX `set_logs_command_uq` ON `set_logs` (`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `set_logs_planned_uq` ON `set_logs` (`workout_id`,`planned_set_id`) WHERE "set_logs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `set_logs_key_idx` ON `set_logs` (`comparison_key`,`performed_on`);--> statement-breakpoint
ALTER TABLE `workouts` ADD `plan_schema` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `plan_v2` text;--> statement-breakpoint
ALTER TABLE `workouts` ADD `plan_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `time_zone` text;