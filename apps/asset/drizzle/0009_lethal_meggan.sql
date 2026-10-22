CREATE TABLE "asset_source_state" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "immutable_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"facts" jsonb NOT NULL,
	"layout" text NOT NULL,
	CONSTRAINT "immutable_sources_layout" CHECK ("immutable_sources"."layout" = 'asset-layout-1')
);
--> statement-breakpoint
CREATE TABLE "source_acceptance_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"confirmation" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "immutable_sources_asset" ON "immutable_sources" USING btree ("asset_id");