CREATE TYPE "public"."picture_import_status" AS ENUM('pending', 'retrying', 'complete');--> statement-breakpoint
CREATE TABLE "profile_picture_imports" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"source_url" text,
	"status" "picture_import_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone,
	"lease_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_picture_imports" ADD CONSTRAINT "profile_picture_imports_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_picture_imports_due_idx" ON "profile_picture_imports" USING btree ("next_attempt_at","profile_id") WHERE "profile_picture_imports"."status" != 'complete';