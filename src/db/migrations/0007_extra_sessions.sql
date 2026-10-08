PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_planned_days` (
	`date` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`workout_id` text,
	`selection` text,
	`forecast` text,
	`status` text NOT NULL,
	`generation_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`date`, `seq`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_planned_days`("date", "seq", "workout_id", "selection", "forecast", "status", "generation_id", "updated_at") SELECT "date", 1, NULL, "selection", "forecast", "status", "generation_id", "updated_at" FROM `planned_days`;--> statement-breakpoint
DROP TABLE `planned_days`;--> statement-breakpoint
ALTER TABLE `__new_planned_days` RENAME TO `planned_days`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
