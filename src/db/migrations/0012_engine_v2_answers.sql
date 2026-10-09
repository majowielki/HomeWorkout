CREATE TABLE `prescription_answers` (
	`comparison_key` text NOT NULL,
	`kind` text NOT NULL,
	`answer` text NOT NULL,
	`after_exposure_id` text NOT NULL,
	`answered_on` text NOT NULL,
	`command_id` text NOT NULL,
	`answered_at` text NOT NULL,
	PRIMARY KEY(`comparison_key`, `kind`)
);
