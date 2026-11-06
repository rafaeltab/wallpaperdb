PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_planning_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`started_at` integer NOT NULL,
	`deadline` integer NOT NULL,
	`phase` text NOT NULL,
	`slot` integer DEFAULT 1 NOT NULL,
	`finished_at` integer,
	`detail` text,
	`result` text,
	CONSTRAINT "planning_attempt_slot" CHECK("__new_planning_attempts"."slot" = 1),
	CONSTRAINT "planning_attempt_phase" CHECK("__new_planning_attempts"."phase" in ('discovery', 'handoff', 'freshness', 'succeeded', 'failed')),
	CONSTRAINT "planning_attempt_revision" CHECK("__new_planning_attempts"."revision" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_planning_attempts`("id", "revision", "started_at", "deadline", "phase", "slot", "finished_at", "detail", "result") SELECT "id", "revision", "started_at", "deadline", "phase", "slot", "finished_at", "detail", "result" FROM `planning_attempts`;--> statement-breakpoint
DROP TABLE `planning_attempts`;--> statement-breakpoint
ALTER TABLE `__new_planning_attempts` RENAME TO `planning_attempts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_planning_attempt` ON `planning_attempts` (`slot`) WHERE "planning_attempts"."phase" in ('discovery', 'handoff', 'freshness');