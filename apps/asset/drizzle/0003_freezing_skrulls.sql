CREATE TABLE "catalog_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"wallpaper_id" text NOT NULL,
	"notification" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catalog_processed" (
	"source" text NOT NULL,
	"occurrence_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_processed_source_occurrence_id_pk" PRIMARY KEY("source","occurrence_id")
);
