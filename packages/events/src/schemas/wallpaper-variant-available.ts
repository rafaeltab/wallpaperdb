import { z } from "zod";

/**
 * Schema for the wallpaper.variant.available event.
 * Published when the Media service makes a new variant available for a wallpaper.
 *
 * Design Notes:
 * - Does NOT include variant ID (internal to Media service)
 * - Dimensions (width + height) uniquely identify a variant within a wallpaper
 * - Pre-calculated aspect ratio for efficient filtering
 * - Format enum derived from MIME type for easy GraphQL filtering
 * - No storage details (internal to Media service)
 * - Extensible for future video support
 */
export const WallpaperVariantAvailableEventSchema = z.object({
    eventId: z.string().min(1),
    eventType: z.literal("wallpaper.variant.available"),
    timestamp: z.string().datetime(),

    variant: z.object({
        // Wallpaper identification
        wallpaperId: z.string().min(1),

        // Variant dimensions (uniquely identify variant)
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        aspectRatio: z.number().positive(), // width / height

        // Format information
        format: z.enum(["image/jpeg", "image/png", "image/webp"]), // For filtering/querying

        // Metadata
        fileSizeBytes: z.number().int().positive(),
        createdAt: z.string().datetime(),
    }),
});

export type WallpaperVariantAvailableEvent = z.infer<
    typeof WallpaperVariantAvailableEventSchema
>;

export const WALLPAPER_VARIANT_AVAILABLE_SUBJECT =
    "wallpaper.variant.available" as const;
