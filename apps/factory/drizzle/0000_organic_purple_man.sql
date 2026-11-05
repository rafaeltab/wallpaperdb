CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`namespace` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`namespace`, `name`)
);
