CREATE TABLE "upload_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"wallpaper_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "idx_wallpapers_content_hash";--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "ingestion_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_outbox" ADD CONSTRAINT "upload_outbox_wallpaper_id_wallpapers_id_fk" FOREIGN KEY ("wallpaper_id") REFERENCES "public"."wallpapers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_outbox_wallpaper" ON "upload_outbox" USING btree ("wallpaper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallpapers_content_hash" ON "wallpapers" USING btree ("user_id","content_hash") WHERE "wallpapers"."content_hash" IS NOT NULL AND "wallpapers"."upload_state" <> 'failed';--> statement-breakpoint
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpaper_stored_metadata" CHECK ("wallpapers"."upload_state" NOT IN ('stored', 'processing', 'completed') OR ("wallpapers"."file_type" IS NOT NULL AND "wallpapers"."mime_type" IS NOT NULL AND "wallpapers"."width" > 0 AND "wallpapers"."height" > 0 AND "wallpapers"."file_size_bytes" > 0 AND "wallpapers"."original_filename" IS NOT NULL));