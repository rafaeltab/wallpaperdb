import { z } from 'zod';

/**
 * Schema for the wallpaper.variant.uploaded event.
 * Published by the variant-generator service when a new variant has been
 * generated and uploaded to object storage.
 *
 * This event is consumed by the media service to update its variants table.
 *
 * Design Notes:
 * - Includes storage details (key, bucket) since media service needs to know where the variant is stored
 * - Format derived from MIME type for easy filtering
 * - Pre-calculated aspect ratio for efficient querying
 */
export const WallpaperVariantUploadedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal('wallpaper.variant.uploaded'),
  timestamp: z.string().datetime(),

  variant: z.object({
    // Wallpaper identification
    wallpaperId: z.string().min(1),

    // Variant dimensions
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.number().positive(), // width / height

    // Format information
    format: z.enum(['image/jpeg', 'image/png', 'image/webp']),

    // File metadata
    fileSizeBytes: z.number().int().positive(),

    // Storage location (needed by media service)
    storageKey: z.string().min(1),
    storageBucket: z.string().min(1),

    // Timestamps
    createdAt: z.string().datetime(),
  }),
});

export type WallpaperVariantUploadedEvent = z.infer<typeof WallpaperVariantUploadedEventSchema>;

export const WALLPAPER_VARIANT_UPLOADED_SUBJECT = 'wallpaper.variant.uploaded' as const;
