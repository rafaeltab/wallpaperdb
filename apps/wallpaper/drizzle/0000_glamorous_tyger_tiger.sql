CREATE TABLE "wallpaper_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_namespace" text NOT NULL,
	"contributor_id" text NOT NULL,
	"request_key" text NOT NULL,
	"asset_id" text,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallpaper_workflow_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"wallpaper_id" text NOT NULL,
	"destination" text NOT NULL,
	"event" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	CONSTRAINT "wallpaper_outbox_status" CHECK ("wallpaper_workflow_outbox"."status" IN ('pending','leased','published','quarantined'))
);
--> statement-breakpoint
CREATE TABLE "wallpaper_workflow_quarantine" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallpaper_workflow_outbox" ADD CONSTRAINT "wallpaper_workflow_outbox_wallpaper_id_wallpaper_intents_id_fk" FOREIGN KEY ("wallpaper_id") REFERENCES "public"."wallpaper_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallpaper_request_identity" ON "wallpaper_intents" USING btree ("owner_namespace","contributor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "wallpaper_asset_identity" ON "wallpaper_intents" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "wallpaper_outbox_due" ON "wallpaper_workflow_outbox" USING btree ("status","available_at");