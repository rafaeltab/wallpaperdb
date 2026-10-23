CREATE TABLE "source_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"source_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "source_reads_identity" ON "source_reads" USING btree ("asset_id","source_id","expires_at");--> statement-breakpoint
CREATE INDEX "source_reads_expiry" ON "source_reads" USING btree ("expires_at");