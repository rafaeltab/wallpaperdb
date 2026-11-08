CREATE TABLE `planning_deadline_failures` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`notice_id` text NOT NULL,
	`position` integer NOT NULL,
	`value` text NOT NULL,
	FOREIGN KEY (`notice_id`) REFERENCES `planning_notices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "planning_deadline_failure_bound" CHECK("planning_deadline_failures"."position" between 1 and 3)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_deadline_failure_position` ON `planning_deadline_failures` (`notice_id`,`position`);--> statement-breakpoint
CREATE TABLE `planning_notices` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`acknowledged_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `planning_notices_id_unique` ON `planning_notices` (`id`);--> statement-breakpoint
CREATE INDEX `planning_notices_pending` ON `planning_notices` (`acknowledged_at`,`sequence`);--> statement-breakpoint
CREATE TABLE `planning_safety` (
	`id` integer PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`consecutive_model_deadline_failures` integer NOT NULL,
	`current_notice_id` text,
	CONSTRAINT "planning_safety_singleton" CHECK("planning_safety"."id" = 1),
	CONSTRAINT "planning_safety_counter" CHECK("planning_safety"."consecutive_model_deadline_failures" between 0 and 3),
	CONSTRAINT "planning_safety_version" CHECK("planning_safety"."version" >= 0)
);
