CREATE TABLE `bands` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`nominal_min_kg` real NOT NULL,
	`nominal_max_kg` real NOT NULL,
	`calibration` text,
	`cycle_count` integer DEFAULT 0 NOT NULL,
	`calibrated_at` text
);
--> statement-breakpoint
CREATE TABLE `body_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`weight_kg` real NOT NULL,
	`body_fat_pct` real,
	`source` text NOT NULL,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_date_idx` ON `body_metrics` (`date`);--> statement-breakpoint
CREATE TABLE `cardio_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text,
	`training_date` text NOT NULL,
	`purpose` text NOT NULL,
	`minutes` integer NOT NULL,
	`resistance_level` integer,
	`avg_cadence` integer,
	`avg_hr` integer,
	`rpe` integer,
	`logged_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cardio_date_idx` ON `cardio_logs` (`training_date`);--> statement-breakpoint
CREATE TABLE `daily_logs` (
	`date` text PRIMARY KEY NOT NULL,
	`sleep_hours` real,
	`energy` integer,
	`stress` integer,
	`soreness` text,
	`steps` integer,
	`note` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`data` text NOT NULL,
	`data_version` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`waist_cm` real,
	`hips_cm` real,
	`chest_cm` real,
	`arm_cm` real,
	`thigh_cm` real,
	`neck_cm` real,
	`logged_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `set_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`exercise_order` integer NOT NULL,
	`set_index` integer NOT NULL,
	`is_warmup` integer DEFAULT false NOT NULL,
	`reps` integer,
	`time_sec` integer,
	`rir` integer,
	`weight_kg` real,
	`dumbbell_mode` text,
	`band_id` text,
	`anchor_position` integer,
	`estimated_load_kg` real,
	`logged_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`band_id`) REFERENCES `bands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `set_logs_workout_idx` ON `set_logs` (`workout_id`);--> statement-breakpoint
CREATE INDEX `set_logs_exercise_idx` ON `set_logs` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`height_cm` real,
	`birth_year` integer,
	`sex` text,
	`day_boundary_hour` integer DEFAULT 4 NOT NULL,
	`saddle_height_cm` real,
	`knee_profile` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workout_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`blocks` text NOT NULL,
	`sort_order` integer NOT NULL,
	`is_archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`training_date` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`template_id` text,
	`session_rpe` integer,
	`notes` text,
	FOREIGN KEY (`template_id`) REFERENCES `workout_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workouts_date_idx` ON `workouts` (`training_date`);--> statement-breakpoint
CREATE INDEX `workouts_status_idx` ON `workouts` (`status`);