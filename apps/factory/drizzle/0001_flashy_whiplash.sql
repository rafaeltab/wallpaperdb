CREATE TABLE `planning_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`started_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`phase` text NOT NULL,
	`slot` integer DEFAULT 1 NOT NULL,
	`finished_at` integer,
	`detail` text,
	`result` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_planning_attempt` ON `planning_attempts` (`slot`) WHERE "planning_attempts"."phase" in ('discovery', 'freshness');