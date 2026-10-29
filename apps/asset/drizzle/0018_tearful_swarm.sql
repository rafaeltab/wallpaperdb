CREATE TABLE "source_candidates" (
	"asset_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"position" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"candidate" jsonb NOT NULL,
	CONSTRAINT "source_candidates_asset_id_candidate_id_pk" PRIMARY KEY("asset_id","candidate_id")
);
--> statement-breakpoint
ALTER TABLE "asset_source_state" ADD COLUMN "candidate_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_replay" ON "source_candidates" USING btree ("asset_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_history" ON "source_candidates" USING btree ("asset_id","position");--> statement-breakpoint
CREATE INDEX "source_candidates_live" ON "source_candidates" USING btree ("asset_id","expires_at") WHERE "source_candidates"."status" NOT IN ('accepted', 'rejected', 'cancelled');