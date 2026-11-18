CREATE TABLE `observation_entities` (
	`stream` text NOT NULL,
	`id` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`stream`, `id`),
	FOREIGN KEY (`stream`) REFERENCES `observation_checkpoints`(`stream`) ON UPDATE no action ON DELETE cascade
);
