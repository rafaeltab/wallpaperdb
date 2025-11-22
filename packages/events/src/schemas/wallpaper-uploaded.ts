import { z } from "zod";

/**
 * Schema for the wallpaper.uploaded event.
 * Published when a wallpaper is successfully uploaded and stored.
 */
export const WallpaperUploadedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("wallpaper.uploaded"),
  timestamp: z.string().datetime(),
  wallpaper: z.object({
    id: z.string().min(1),
    userId: z.string().min(1),
    fileType: z.enum(["image", "video"]),
    mimeType: z.string().min(1),
    fileSizeBytes: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.number().positive(),
    storageKey: z.string().min(1),
    storageBucket: z.string().min(1),
    originalFilename: z.string().min(1),
    uploadedAt: z.string().datetime(),
  }),
});

export type WallpaperUploadedEvent = z.infer<typeof WallpaperUploadedEventSchema>;

/**
 * Event subject/topic for wallpaper.uploaded events
 */
export const WALLPAPER_UPLOADED_SUBJECT = "wallpaper.uploaded" as const;
