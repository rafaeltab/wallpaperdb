CREATE TYPE "public"."file_type" AS ENUM('image', 'video');--> statement-breakpoint
CREATE TYPE "public"."upload_state" AS ENUM('initiated', 'uploading', 'stored', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "wallpapers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"content_hash" text,
	"upload_state" "upload_state" DEFAULT 'initiated' NOT NULL,
	"state_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_attempts" integer DEFAULT 0 NOT NULL,
	"processing_error" text,
	"file_type" "file_type",
	"mime_type" text,
	"file_size_bytes" bigint,
	"original_filename" text,
	"width" integer,
	"height" integer,
	"aspect_ratio" numeric(10, 4),
	"storage_key" text,
	"storage_bucket" text DEFAULT 'wallpapers',
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_wallpapers_user_id" ON "wallpapers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wallpapers_upload_state" ON "wallpapers" USING btree ("upload_state");--> statement-breakpoint
CREATE INDEX "idx_wallpapers_state_changed_at" ON "wallpapers" USING btree ("state_changed_at");--> statement-breakpoint
CREATE INDEX "idx_wallpapers_uploaded_at" ON "wallpapers" USING btree ("uploaded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallpapers_content_hash" ON "wallpapers" USING btree ("user_id","content_hash") WHERE "wallpapers"."content_hash" IS NOT NULL AND "wallpapers"."upload_state" IN ('stored', 'processing', 'completed');