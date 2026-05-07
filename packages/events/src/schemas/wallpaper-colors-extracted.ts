import { z } from "zod";

export const WallpaperColorsExtractedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("wallpaper.colors.extracted"),
  timestamp: z.string().datetime(),

  wallpaperId: z.string().min(1),
  colorHistogram: z.array(z.number()).min(1),
  colorSpace: z.string().min(1),
});

export type WallpaperColorsExtractedEvent = z.infer<typeof WallpaperColorsExtractedEventSchema>;

export const WALLPAPER_COLORS_EXTRACTED_SUBJECT = "wallpaper.colors.extracted" as const;
