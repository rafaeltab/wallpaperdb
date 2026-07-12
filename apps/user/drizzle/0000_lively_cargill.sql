CREATE TYPE "public"."handle_claim_kind" AS ENUM('current', 'alias');--> statement-breakpoint
CREATE TYPE "public"."profile_event_type" AS ENUM('profile.created');--> statement-breakpoint
CREATE SEQUENCE "public"."handle_claim_generation" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "handle_claims" (
	"handle" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"kind" "handle_claim_kind" NOT NULL,
	"generation" bigint DEFAULT nextval('handle_claim_generation') NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profile_events" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"type" "profile_event_type" NOT NULL,
	"profile_version" bigint NOT NULL,
	"event" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"biography_markdown" text DEFAULT '' NOT NULL,
	"picture_asset_id" text,
	"version" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handle_claims" ADD CONSTRAINT "handle_claims_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_events" ADD CONSTRAINT "profile_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_handle_unique" ON "profiles" USING btree ("handle");