CREATE TABLE "picture_attachment_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"attachment_id" text NOT NULL,
	"destination" text NOT NULL,
	"event" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	"notified_at" timestamp with time zone,
	CONSTRAINT "picture_attachment_outbox_status" CHECK ("picture_attachment_outbox"."status" IN ('pending','leased','published','quarantined'))
);
--> statement-breakpoint
CREATE TABLE "picture_attachment_quarantine" (
	"id" text PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "picture_attachment_source_intents" (
	"attachment_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"intent_id" text NOT NULL,
	CONSTRAINT "picture_attachment_source_intents_attachment_id_candidate_id_intent_id_pk" PRIMARY KEY("attachment_id","candidate_id","intent_id"),
	CONSTRAINT "picture_attachment_candidate_bound" CHECK (octet_length("picture_attachment_source_intents"."candidate_id") BETWEEN 1 AND 256),
	CONSTRAINT "picture_attachment_intent_bound" CHECK (octet_length("picture_attachment_source_intents"."intent_id") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE TABLE "picture_attachment_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"request_key" text NOT NULL,
	"asset_id" text,
	"state" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picture_attachment_slots" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "picture_attachment_outbox" ADD CONSTRAINT "picture_attachment_outbox_attachment_id_picture_attachment_intents_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."picture_attachment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_attachment_source_intents" ADD CONSTRAINT "picture_attachment_source_intents_attachment_id_picture_attachment_intents_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."picture_attachment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_attachment_intents" ADD CONSTRAINT "picture_attachment_intents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_attachment_slots" ADD CONSTRAINT "picture_attachment_slots_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picture_attachment_slots" ADD CONSTRAINT "picture_attachment_slots_intent_id_picture_attachment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."picture_attachment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "picture_attachment_outbox_due" ON "picture_attachment_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "picture_attachment_request_identity" ON "picture_attachment_intents" USING btree ("profile_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "picture_attachment_asset_identity" ON "picture_attachment_intents" USING btree ("asset_id");