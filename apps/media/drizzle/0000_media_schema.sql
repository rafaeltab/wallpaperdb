-- Media Service Database Schema
-- This schema stores wallpaper metadata consumed from events

-- Wallpapers table - stores metadata from wallpaper.uploaded events
CREATE TABLE IF NOT EXISTS "wallpapers" (
  "id" text PRIMARY KEY NOT NULL,
  "storage_bucket" text NOT NULL,
  "storage_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Variants table - stores information about pre-generated size variants
CREATE TABLE IF NOT EXISTS "variants" (
  "id" text PRIMARY KEY NOT NULL,
  "wallpaper_id" text NOT NULL REFERENCES "wallpapers"("id") ON DELETE CASCADE,
  "storage_key" text NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "file_size_bytes" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_variants_wallpaper_id" ON "variants" ("wallpaper_id");
CREATE INDEX IF NOT EXISTS "idx_variants_dimensions" ON "variants" ("wallpaper_id", "width", "height");
