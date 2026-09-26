import { z } from "zod";
import { AssetReferenceSchema } from "./asset-reference.js";

/**
 * Schema for the wallpaper.variant.uploaded event.
 * Published by the variant-generator service when a new variant has been
 * generated and uploaded to object storage.
 *
 * This event is consumed by the media service to update its variants table.
 *
 * Design Notes:
 * - Identifies immutable assets without publishing storage coordinates
 * - Format derived from MIME type for easy filtering
 * - Pre-calculated aspect ratio for efficient querying
 */
const variantMetadata = z.object({
  // Wallpaper identification
  wallpaperId: z.string().min(1),

  // Variant dimensions
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(), // width / height

  // Format information
  format: z.enum(["image/jpeg", "image/png", "image/webp"]),

  // File metadata
  fileSizeBytes: z.number().int().positive(),

  // Timestamps
  createdAt: z.string().datetime(),
});
export const WallpaperVariantUploadedEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("wallpaper.variant.uploaded"),
  timestamp: z.string().datetime(),
  variant: z.union([
    variantMetadata
      .extend({
        asset: AssetReferenceSchema.extend({ owner: z.literal("variant-generator") }),
      })
      .strict(),
    variantMetadata.extend({
      asset: z.undefined().optional(),
      storageKey: z.string().min(1),
      storageBucket: z.string().min(1),
    }),
  ]),
});

export type WallpaperVariantUploadedEvent = z.infer<typeof WallpaperVariantUploadedEventSchema>;

export const WALLPAPER_VARIANT_UPLOADED_SUBJECT = "wallpaper.variant.uploaded" as const;
