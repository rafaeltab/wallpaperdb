ALTER TYPE "public"."picture_asset_state" ADD VALUE 'uploading';--> statement-breakpoint
ALTER TYPE "public"."picture_asset_state" ADD VALUE 'deleting';--> statement-breakpoint
ALTER TABLE "profile_picture_assets" ADD COLUMN "upload_lease_until" timestamp with time zone;