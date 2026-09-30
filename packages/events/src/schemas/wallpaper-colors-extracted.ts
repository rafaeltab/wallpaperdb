import { z } from "zod";
import { AssetReferenceSchema } from "./asset-reference.js";
import {
  COLOR_ANCHORS_SHA256,
  COLOR_REFERENCE_COMMIT,
  ColorMeasurementsSchema,
} from "./color-measurements.js";
const payload = z
  .object({
    schemaVersion: z.literal(1),
    wallpaperId: z.string().min(1).max(255),
    original: AssetReferenceSchema.extend({
      owner: z.literal("ingestor"),
      id: z.string().min(1).max(255),
    }),
    provenance: z
      .object({
        referenceCommit: z.literal(COLOR_REFERENCE_COMMIT),
        anchorsSha256: z.literal(COLOR_ANCHORS_SHA256),
        originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    measurements: ColorMeasurementsSchema,
  })
  .strict();
/** Consumer interpretation of the structurally validated measurement fact. */
export const WallpaperColorsExtractedEventSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    eventType: z.literal("wallpaper.colors.extracted"),
    timestamp: z.string().datetime(),
    ...payload.shape,
  })
  .strict()
  .refine(
    (event) => event.wallpaperId === event.original.id,
    "Original identity must match wallpaper"
  );
export const WallpaperColorsExtractedCloudEventSchema = z
  .object({
    specversion: z.literal("1.0"),
    source: z.string().url().max(1024),
    id: z.string().min(1).max(128),
    type: z.literal("wallpaper.colors.extracted"),
    time: z.string().datetime(),
    datacontenttype: z.literal("application/json"),
    correlationid: z.string().max(1024).optional(),
    causationid: z.string().max(1024).optional(),
    causationsource: z.string().max(1024).optional(),
    data: payload.refine(
      (event) => event.wallpaperId === event.original.id,
      "Original identity must match wallpaper"
    ),
  })
  .strict();
export type WallpaperColorsExtractedEvent = z.infer<typeof WallpaperColorsExtractedEventSchema>;
export const WALLPAPER_COLORS_EXTRACTED_SUBJECT = "wallpaper.colors.extracted" as const;
