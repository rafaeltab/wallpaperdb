CREATE TABLE `github_issues` (
	`number` integer PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`open` integer NOT NULL,
	`candidate` integer NOT NULL,
	`labels` text NOT NULL,
	`assignees` text NOT NULL,
	`project_status` text,
	`comment_count` integer NOT NULL,
	`blockers` text NOT NULL,
	`parents` text NOT NULL,
	`pull_requests` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `github_pulls` (
	`number` integer PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`state` text NOT NULL,
	`head` text NOT NULL,
	`head_branch` text NOT NULL,
	`base` text NOT NULL,
	`base_branch` text NOT NULL,
	`cross_referenced_issues` text NOT NULL,
	`linked_issues` text NOT NULL,
	`review` text NOT NULL,
	`ci` text NOT NULL,
	`evidence_head` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observation_refresh` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer,
	`observed_at` integer,
	`failed_at` integer,
	`error` text,
	`recoveries` text,
	`jobs` text,
	`jobs_observed_at` integer
);
