import { z } from "zod";

/**
 * Schema for the wallpaper.uploaded event.
 * Published when a wallpaper is successfully uploaded and stored.
 */
const LegacyWallpaperUploadedEventSchema = z.object({
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

/** Canonical producer envelope; the payload remains compatible across the replay horizon. */
export const WallpaperUploadedCloudEventSchema = z.object({
  specversion: z.literal("1.0"),
  id: z.string().min(1),
  source: z.string().url(),
  type: z.literal("wallpaper.uploaded"),
  time: z.string().datetime(),
  datacontenttype: z.literal("application/json"),
  correlationid: z.string().min(1).optional(),
  causationid: z.string().min(1).optional(),
  data: z.object({ wallpaper: LegacyWallpaperUploadedEventSchema.shape.wallpaper }),
});

/** Retained legacy events and new CloudEvents share one consumer-facing interpretation. */
export const WallpaperUploadedEventSchema = z.union([
  LegacyWallpaperUploadedEventSchema,
  WallpaperUploadedCloudEventSchema.transform((event) => ({
    eventId: event.id,
    eventType: event.type,
    timestamp: event.time,
    wallpaper: event.data.wallpaper,
  })),
]);

export type WallpaperUploadedEvent = z.infer<typeof WallpaperUploadedEventSchema>;

/**
 * Event subject/topic for wallpaper.uploaded events
 */
export const WALLPAPER_UPLOADED_SUBJECT = "wallpaper.uploaded" as const;
