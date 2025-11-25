CREATE TABLE "variants" (
	"id" text PRIMARY KEY NOT NULL,
	"wallpaper_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallpapers" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_wallpaper_id_wallpapers_id_fk" FOREIGN KEY ("wallpaper_id") REFERENCES "public"."wallpapers"("id") ON DELETE cascade ON UPDATE no action;