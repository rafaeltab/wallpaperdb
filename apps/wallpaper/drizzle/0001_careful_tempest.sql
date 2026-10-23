ALTER TABLE "wallpaper_workflow_outbox" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallpaper_workflow_quarantine" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallpaper_workflow_quarantine" ADD COLUMN "recovered_at" timestamp with time zone;