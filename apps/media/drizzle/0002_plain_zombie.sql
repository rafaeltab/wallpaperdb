CREATE TABLE "profile_picture_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_picture_heads" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"picture_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "profile_picture_heads_picture_id_idx" ON "profile_picture_heads" USING btree ("picture_id");