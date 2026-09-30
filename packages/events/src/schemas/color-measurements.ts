import { z } from "zod";
import { COLOR_CUTOFFS, COLOR_MEASUREMENT_VERSION } from "../color-vocabulary.js";
export {
  COLOR_ANCHORS,
  COLOR_MEASUREMENT_VERSION,
  COLOR_REFERENCE_COMMIT,
  COLOR_ANCHORS_SHA256,
  COLOR_CUTOFFS,
  COLOR_FEATURE_NAMES,
  type ColorFeatureName,
} from "../color-vocabulary.js";
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
    named: z
      .object({
        red: pair,
        orange: pair,
        yellow: pair,
        green: pair,
        teal: pair,
        cyan: pair,
        blue: pair,
        purple: pair,
        pink: pair,
        brown: pair,
        black: pair,
        gray: pair,
        white: pair,
        grayscale: pair,
        strict_grayscale: pair,
        near_neutral: pair,
        dark: pair,
        light: pair,
        bright: pair,
        vivid: pair,
        muted: pair,
        monochromatic: pair,
        rainbow: pair,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
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
