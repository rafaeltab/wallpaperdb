import { z } from "zod";
import { AssetReferenceSchema } from "./asset-reference.js";

/**
 * Schema for the wallpaper.uploaded event.
 * Published when a wallpaper is successfully uploaded and stored.
 */
const wallpaperMetadata = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  fileType: z.enum(["image", "video"]),
  mimeType: z.string().min(1),
  fileSizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  uploadedAt: z.string().datetime(),
});
const wallpaperSchema = z.union([
  wallpaperMetadata
    .extend({
      asset: AssetReferenceSchema.extend({ owner: z.literal("ingestor") }),
    })
    .strict()
    .refine(
      (wallpaper) => wallpaper.asset.id === wallpaper.id,
      "Original asset identity must match wallpaper"
    ),
  // Retained events remain replayable with their exact recorded storage address.
  wallpaperMetadata.extend({
    asset: z.undefined().optional(),
    storageKey: z.string().min(1),
    storageBucket: z.string().min(1),
    originalFilename: z.string().min(1),
  }),
]);
const LegacyWallpaperUploadedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("wallpaper.uploaded"),
  timestamp: z.string().datetime(),
  wallpaper: wallpaperSchema,
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
