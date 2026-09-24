-- Validate committed originals before changing their recovery state or schema.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "wallpapers"
		WHERE "upload_state" IN ('stored', 'processing', 'completed')
			AND (
				"file_type" IS DISTINCT FROM 'image'
				OR "mime_type" IS NULL OR "mime_type" NOT IN ('image/jpeg', 'image/png', 'image/webp')
				OR "width" IS NULL OR "width" <= 0
				OR "height" IS NULL OR "height" <= 0
				OR "file_size_bytes" IS NULL OR "file_size_bytes" <= 0
				OR "original_filename" IS NULL OR "content_hash" IS NULL
			)
	) THEN
		RAISE EXCEPTION 'Committed upload metadata is incomplete; repair it before retrying migration'
			USING ERRCODE = 'check_violation';
	END IF;
END
$$;
--> statement-breakpoint
UPDATE "wallpapers"
SET "upload_state" = 'failed',
	"processing_error" = 'Legacy upload metadata incomplete; retry upload',
	"state_changed_at" = NOW()
WHERE "upload_state" IN ('initiated', 'uploading')
	AND (
		"file_type" IS DISTINCT FROM 'image'
		OR "mime_type" IS NULL OR "mime_type" NOT IN ('image/jpeg', 'image/png', 'image/webp')
		OR "width" IS NULL OR "width" <= 0
		OR "height" IS NULL OR "height" <= 0
		OR "file_size_bytes" IS NULL OR "file_size_bytes" <= 0
		OR "original_filename" IS NULL OR "content_hash" IS NULL
	);
--> statement-breakpoint
-- The new uniqueness rule also covers unfinished reservations.
WITH ranked AS (
	SELECT "id",
		ROW_NUMBER() OVER (
			PARTITION BY "user_id", "content_hash"
			ORDER BY CASE WHEN "upload_state" IN ('stored', 'processing', 'completed') THEN 0 ELSE 1 END,
				"uploaded_at", "id"
		) AS position
	FROM "wallpapers"
	WHERE "content_hash" IS NOT NULL AND "upload_state" <> 'failed'
)
UPDATE "wallpapers"
SET "upload_state" = 'failed',
	"processing_error" = 'Superseded legacy upload reservation',
	"state_changed_at" = NOW()
FROM ranked
WHERE "wallpapers"."id" = ranked."id" AND ranked.position > 1
	AND "wallpapers"."upload_state" IN ('initiated', 'uploading');
--> statement-breakpoint
CREATE TABLE "upload_outbox" (
	"event_id" text PRIMARY KEY NOT NULL,
	"wallpaper_id" text NOT NULL,
	"event" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"quarantined_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "idx_wallpapers_content_hash";--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "ingestion_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "wallpapers" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upload_outbox" ADD CONSTRAINT "upload_outbox_wallpaper_id_wallpapers_id_fk" FOREIGN KEY ("wallpaper_id") REFERENCES "public"."wallpapers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_outbox_wallpaper" ON "upload_outbox" USING btree ("wallpaper_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_wallpapers_content_hash" ON "wallpapers" USING btree ("user_id","content_hash") WHERE "wallpapers"."content_hash" IS NOT NULL AND "wallpapers"."upload_state" <> 'failed';--> statement-breakpoint
ALTER TABLE "wallpapers" ADD CONSTRAINT "wallpaper_stored_metadata" CHECK ("wallpapers"."upload_state" NOT IN ('stored', 'processing', 'completed') OR ("wallpapers"."file_type" IS NOT NULL AND "wallpapers"."mime_type" IS NOT NULL AND "wallpapers"."width" > 0 AND "wallpapers"."height" > 0 AND "wallpapers"."file_size_bytes" > 0 AND "wallpapers"."original_filename" IS NOT NULL));
--> statement-breakpoint
-- Record one deterministic occurrence per legacy upload, independent of application code.
WITH legacy AS (
	SELECT *,
		to_char("uploaded_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS uploaded_iso,
		COALESCE(
			substring("storage_key" FROM '/original\.([a-z0-9]+)$'),
			CASE "mime_type"
				WHEN 'image/jpeg' THEN 'jpg'
				WHEN 'image/png' THEN 'png'
				WHEN 'image/webp' THEN 'webp'
			END
		) AS extension
	FROM "wallpapers"
	WHERE "upload_state" IN ('uploading', 'stored', 'processing', 'completed')
)
UPDATE "wallpapers"
SET "ingestion_snapshot" = jsonb_build_object(
		'id', 'uploaded-' || legacy."id",
		'source', 'urn:wallpaperdb:ingestor',
		'occurredAt', legacy.uploaded_iso,
		'correlationId', 'ingestion-' || legacy."id",
		'causationId', 'legacy-command-' || legacy."id",
		'wallpaper', jsonb_build_object(
			'id', legacy."id",
			'profileId', legacy."user_id",
			'originalFilename', legacy."original_filename",
			'uploadedAt', legacy.uploaded_iso,
			'metadata', jsonb_build_object(
				'fileType', legacy."file_type",
				'mimeType', legacy."mime_type",
				'width', legacy."width",
				'height', legacy."height",
				'fileSizeBytes', legacy."file_size_bytes",
				'contentHash', legacy."content_hash",
				'extension', legacy.extension
			)
		)
	),
	"lease_token" = 'legacy-lease-' || legacy."id",
	"lease_expires_at" = NULL
FROM legacy
WHERE "wallpapers"."id" = legacy."id";
--> statement-breakpoint
INSERT INTO "upload_outbox" ("event_id", "wallpaper_id", "event")
SELECT "ingestion_snapshot"->>'id', "id", "ingestion_snapshot"
FROM "wallpapers"
WHERE "upload_state" = 'stored';
