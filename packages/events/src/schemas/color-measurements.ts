import { z } from "zod";
import anchors from "./color-anchors.json";

/** Frozen descriptor geometry, in traversal order with the original 1024-bank IDs. */
export const COLOR_ANCHORS: readonly Readonly<{ index: number; key: string; hex: string }>[] =
  Object.freeze(anchors.map((anchor) => Object.freeze(anchor)));
export const COLOR_MEASUREMENT_VERSION = "shade-hue-256-v1" as const;
export const COLOR_REFERENCE_COMMIT = "30edcb2a61e6c4cc915a61807210a3ab5e924d96" as const;
export const COLOR_ANCHORS_SHA256 =
  "edbe4d949976fceb541ade0934bb018c1f12f40d99d54ff16544284b11fcee1f" as const;
export const COLOR_CUTOFFS = [0, 0.25, 0.5, 0.75, 0.9] as const;
export const COLOR_FEATURE_NAMES = [
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "cyan",
  "blue",
  "purple",
  "pink",
  "brown",
  "black",
  "gray",
  "white",
  "grayscale",
  "strict_grayscale",
  "near_neutral",
  "dark",
  "light",
  "bright",
  "vivid",
  "muted",
  "monochromatic",
  "rainbow",
] as const;
export type ColorFeatureName = (typeof COLOR_FEATURE_NAMES)[number];
const coverage = z.number().int().min(0).max(10000);
const quality = z
  .number()
  .finite()
  .min(0)
  .max(1)
  .refine((value) => Math.fround(value) === value, "Quality must retain its float32 value");
const pair = z.object({ coverage, quality }).strict();
const layer = z
  .object({
    cutoff: z.number(),
    coverage: z.array(coverage).length(256),
    quality: z.array(quality).length(256),
  })
  .strict();

/** Complete retained measurements, independent of any consumer's utility calculation. */
export const ColorMeasurementsSchema = z
  .object({
    version: z.literal(COLOR_MEASUREMENT_VERSION),
    sampleCount: z.literal(16384),
    layers: z.array(layer).length(5),
    named: z.record(z.enum(COLOR_FEATURE_NAMES), pair),
  })
  .strict()
  .superRefine((value, context) => {
    if (Object.keys(value.named).length !== COLOR_FEATURE_NAMES.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["named"],
        message: "Every named target is required",
      });
    for (let level = 0; level < value.layers.length; level++) {
      const measured = value.layers[level];
      if (measured.cutoff !== COLOR_CUTOFFS[level])
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", level, "cutoff"],
          message: "Cutoff order differs",
        });
      for (let index = 0; index < measured.coverage.length; index++) {
        if (level && measured.coverage[index] > value.layers[level - 1].coverage[index])
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layers", level, "coverage", index],
            message: "Coverage must be nested",
          });
        if (measured.coverage[index] > 0 && measured.quality[index] + 1e-7 < measured.cutoff)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layers", level, "quality", index],
            message: "Mean quality falls below admission",
          });
        if (measured.coverage[index] === 0 && measured.quality[index] !== 0)
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layers", level, "quality", index],
            message: "Empty layers must have zero quality",
          });
      }
    }
  });
export type ColorMeasurements = z.infer<typeof ColorMeasurementsSchema>;
