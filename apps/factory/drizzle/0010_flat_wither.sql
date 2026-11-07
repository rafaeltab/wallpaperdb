CREATE TABLE `github_request_budget` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "github_request_budget_singleton" CHECK("github_request_budget"."id" = 1)
);
