CREATE TABLE "asset_commands" (
	"application_id" text NOT NULL,
	"command_id" text NOT NULL,
	"canonical" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "asset_commands_application_id_command_id_pk" PRIMARY KEY("application_id","command_id"),
	CONSTRAINT "asset_commands_identity" CHECK (octet_length("asset_commands"."command_id") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "asset_configuration" (
	"id" integer PRIMARY KEY NOT NULL,
	"revision" text NOT NULL,
	CONSTRAINT "asset_configuration_singleton" CHECK ("asset_configuration"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "asset_result_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"command_id" text NOT NULL,
	"payload_digest" text NOT NULL,
	"result" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_id" text,
	"notified_at" timestamp with time zone,
	CONSTRAINT "asset_result_outbox_status" CHECK ("asset_result_outbox"."status" IN ('pending', 'publishing', 'published', 'quarantined')),
	CONSTRAINT "asset_result_outbox_attempts" CHECK ("asset_result_outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "owned_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"application_id" text NOT NULL,
	"asset_type" text NOT NULL,
	"owner_namespace" text NOT NULL,
	"owner_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owned_assets_application_id" CHECK ("owned_assets"."application_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "owned_assets_type" CHECK ("owned_assets"."asset_type" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "owned_assets_namespace" CHECK (octet_length("owned_assets"."owner_namespace") BETWEEN 1 AND 256),
	CONSTRAINT "owned_assets_subject" CHECK (octet_length("owned_assets"."owner_subject") BETWEEN 1 AND 256)
);
--> statement-breakpoint
CREATE INDEX "asset_result_outbox_ready" ON "asset_result_outbox" USING btree ("status","available_at");