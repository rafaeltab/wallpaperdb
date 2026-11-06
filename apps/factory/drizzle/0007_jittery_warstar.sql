CREATE TABLE `github_rich_facts` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `v2_board` (
	`scope` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `v2_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`request` text NOT NULL,
	`receipt` text NOT NULL
);
