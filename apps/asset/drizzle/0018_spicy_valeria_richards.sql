CREATE TABLE "source_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"ordinal" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_id" text NOT NULL,
	"status" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"candidate" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_source_state" ADD COLUMN "next_candidate_ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidate_replay" ON "source_candidates" USING btree ("asset_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidate_page" ON "source_candidates" USING btree ("asset_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidate_source" ON "source_candidates" USING btree ("asset_id","source_id");--> statement-breakpoint
CREATE INDEX "source_candidate_pending" ON "source_candidates" USING btree ("asset_id","expires_at") WHERE "source_candidates"."status" NOT IN ('accepted', 'rejected', 'cancelled');