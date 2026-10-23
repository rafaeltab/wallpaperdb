CREATE TABLE "asset_deletions" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"source_set_revision" text NOT NULL,
	"delivery_revision" text NOT NULL,
	"evidence_expires_at" timestamp with time zone NOT NULL,
	"capabilities_pending" boolean DEFAULT true NOT NULL,
	"cleanup_pending" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owned_assets" ADD COLUMN "deleted_at" timestamp with time zone;