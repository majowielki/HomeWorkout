CREATE TABLE `ai_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` text NOT NULL,
	`prompt_version` text,
	`model` text,
	`latency_ms` integer,
	`tokens_in` integer,
	`tokens_out` integer,
	`attempts` integer,
	`outcome` text NOT NULL,
	`trimmed_count` integer,
	`request` text,
	`response` text,
	`accepted` integer
);
--> statement-breakpoint
CREATE INDEX `ai_exchanges_created_idx` ON `ai_exchanges` (`created_at`);