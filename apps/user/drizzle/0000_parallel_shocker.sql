CREATE TABLE "handle_claims" (
	"handle" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"handle" text NOT NULL,
	"biography_markdown" text DEFAULT '' NOT NULL,
	"picture_asset_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handle_claims" ADD CONSTRAINT "handle_claims_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handle_claims_profile_id_idx" ON "handle_claims" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handle_claims_handle_lower_idx" ON "handle_claims" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_lower_idx" ON "profiles" USING btree (lower("handle"));