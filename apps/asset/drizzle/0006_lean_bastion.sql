CREATE TABLE "catalog_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
