CREATE TABLE "source_candidates" (
	"asset_id" text NOT NULL,
	"id" text NOT NULL,
	"replay_key" text NOT NULL,
	"position" integer NOT NULL,
	"source_id" text NOT NULL,
	"live_until" timestamp with time zone,
	"candidate" jsonb NOT NULL,
	CONSTRAINT "source_candidates_asset_id_id_pk" PRIMARY KEY("asset_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_replay" ON "source_candidates" USING btree ("asset_id","replay_key");--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_page" ON "source_candidates" USING btree ("asset_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "source_candidates_source" ON "source_candidates" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "source_candidates_live" ON "source_candidates" USING btree ("asset_id","live_until") WHERE "source_candidates"."live_until" IS NOT NULL;