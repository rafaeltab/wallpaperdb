CREATE TYPE "public"."picture_asset_state" AS ENUM('staged', 'active', 'retired');--> statement-breakpoint
CREATE TABLE "profile_picture_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size_bytes" integer NOT NULL,
	"state" "picture_asset_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_picture_assets" ADD CONSTRAINT "profile_picture_assets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_picture_assets_cleanup_idx" ON "profile_picture_assets" USING btree ("expires_at");