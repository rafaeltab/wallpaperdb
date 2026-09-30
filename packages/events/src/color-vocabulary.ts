import anchors from "./schemas/color-anchors.json";

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
