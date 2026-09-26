ALTER TABLE "outbox_events" ADD COLUMN "trace_parent" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "trace_state" text;