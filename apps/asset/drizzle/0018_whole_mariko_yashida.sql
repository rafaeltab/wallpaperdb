CREATE TABLE "source_candidates" (
	"asset_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "source_candidates_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"terminal" boolean NOT NULL,
	"candidate" jsonb NOT NULL,
	CONSTRAINT "source_candidates_asset_id_candidate_id_pk" PRIMARY KEY("asset_id","candidate_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_replay" ON "source_candidates" USING btree ("asset_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "source_candidates_page" ON "source_candidates" USING btree ("asset_id","position");--> statement-breakpoint
CREATE INDEX "source_candidates_pending" ON "source_candidates" USING btree ("asset_id","expires_at") WHERE NOT "source_candidates"."terminal";--> statement-breakpoint
CREATE INDEX "source_candidates_source" ON "source_candidates" USING btree ("asset_id","source_id");