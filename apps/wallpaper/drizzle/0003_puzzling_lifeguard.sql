CREATE TABLE "wallpaper_source_intents" (
	"wallpaper_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"intent_id" text NOT NULL,
	CONSTRAINT "wallpaper_source_intents_wallpaper_id_candidate_id_intent_id_pk" PRIMARY KEY("wallpaper_id","candidate_id","intent_id"),
	CONSTRAINT "wallpaper_source_candidate_bound" CHECK (octet_length("wallpaper_source_intents"."candidate_id") BETWEEN 1 AND 256),
	CONSTRAINT "wallpaper_source_intent_bound" CHECK (octet_length("wallpaper_source_intents"."intent_id") BETWEEN 1 AND 256)
);
--> statement-breakpoint
ALTER TABLE "wallpaper_source_intents" ADD CONSTRAINT "wallpaper_source_intents_wallpaper_id_wallpaper_intents_id_fk" FOREIGN KEY ("wallpaper_id") REFERENCES "public"."wallpaper_intents"("id") ON DELETE no action ON UPDATE no action;