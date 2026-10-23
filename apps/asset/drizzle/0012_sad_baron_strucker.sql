CREATE TABLE "source_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"application_id" text NOT NULL,
	"target" jsonb NOT NULL,
	"due_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	"notified_at" timestamp with time zone,
	CONSTRAINT "source_cleanup_status" CHECK ("source_cleanup"."status" IN ('pending', 'reclaiming', 'completed', 'quarantined')),
	CONSTRAINT "source_cleanup_attempts" CHECK ("source_cleanup"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "source_cleanup_ready" ON "source_cleanup" USING btree ("status","due_at","available_at");--> statement-breakpoint
CREATE INDEX "source_cleanup_asset" ON "source_cleanup" USING btree ("asset_id");