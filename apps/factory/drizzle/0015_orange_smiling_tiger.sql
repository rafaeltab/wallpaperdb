CREATE TABLE `observation_checkpoints` (
	`stream` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`sequence` integer NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "observation_revision_positive" CHECK("observation_checkpoints"."revision" > 0),
	CONSTRAINT "observation_sequence_nonnegative" CHECK("observation_checkpoints"."sequence" >= 0)
);
