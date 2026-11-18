ALTER TABLE "wallpaper_workflow_quarantine" ADD COLUMN "application_reference" text;--> statement-breakpoint
ALTER TABLE "wallpaper_workflow_quarantine" ADD COLUMN "asset_id" text;--> statement-breakpoint
CREATE INDEX "wallpaper_workflow_quarantine_reference" ON "wallpaper_workflow_quarantine" USING btree ("application_reference") WHERE "wallpaper_workflow_quarantine"."recovered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "wallpaper_workflow_quarantine_asset" ON "wallpaper_workflow_quarantine" USING btree ("asset_id") WHERE "wallpaper_workflow_quarantine"."recovered_at" IS NULL;