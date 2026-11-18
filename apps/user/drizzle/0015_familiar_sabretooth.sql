ALTER TABLE "picture_attachment_quarantine" ADD COLUMN "application_reference" text;--> statement-breakpoint
ALTER TABLE "picture_attachment_quarantine" ADD COLUMN "asset_id" text;--> statement-breakpoint
CREATE INDEX "picture_attachment_quarantine_reference" ON "picture_attachment_quarantine" USING btree ("application_reference") WHERE "picture_attachment_quarantine"."recovered_at" IS NULL;--> statement-breakpoint
CREATE INDEX "picture_attachment_quarantine_asset" ON "picture_attachment_quarantine" USING btree ("asset_id") WHERE "picture_attachment_quarantine"."recovered_at" IS NULL;