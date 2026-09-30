import { describe, expect, it } from "vitest";
import {
  COLOR_ANCHORS,
  COLOR_CUTOFFS,
  COLOR_FEATURE_NAMES,
  ColorMeasurementsSchema,
} from "../src/index.js";
const measurements = {
  version: "shade-hue-256-v1",
  sampleCount: 16384,
  layers: COLOR_CUTOFFS.map((cutoff) => ({
    cutoff,
    coverage: Array<number>(256).fill(10000),
    quality: Array<number>(256).fill(1),
  })),
  named: Object.fromEntries(
    COLOR_FEATURE_NAMES.map((name) => [name, { coverage: 10000, quality: 1 }])
  ),
};

describe("versioned color measurement contract", () => {
  it("accepts the complete descriptor layout", () => {
    expect(ColorMeasurementsSchema.safeParse(measurements).success).toBe(true);
    expect(COLOR_ANCHORS).toHaveLength(256);
    expect(new Set(COLOR_ANCHORS.map((anchor) => anchor.index)).size).toBe(256);
  });

  it.each([
    { version: "unknown" },
    { sampleCount: 0 },
    { layers: [] },
    { named: {} },
    { extra: true },
  ])("rejects incomplete or incompatible descriptors %j", (change) => {
    expect(ColorMeasurementsSchema.safeParse({ ...measurements, ...change }).success).toBe(false);
  });

  it("rejects wrong array sizes, fractional coverage, missing named targets and empty-layer quality", () => {
    for (const mutate of [
      (value: typeof measurements) => {
        value.layers[0].coverage.pop();
      },
      (value: typeof measurements) => {
        value.layers[0].quality.push(1);
      },
      (value: typeof measurements) => {
        value.layers[0].coverage[0] = 0.5;
      },
      (value: typeof measurements) => {
        value.layers[0].coverage[0] = -1;
      },
      (value: typeof measurements) => {
        value.layers[0].coverage[0] = 10001;
      },
      (value: typeof measurements) => {
        delete value.named.red;
      },
      (value: typeof measurements) => {
        value.named.unknown = { coverage: 0, quality: 0 };
      },
      (value: typeof measurements) => {
        value.layers[0].coverage[0] = 0;
      },
    ]) {
      const invalid = structuredClone(measurements);
      mutate(invalid);
      expect(ColorMeasurementsSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each([
    NaN,
    Infinity,
    -1,
    1.1,
    0.123456789,
  ])("rejects invalid or non-float32 quality %s", (quality) => {
    const invalid = structuredClone(measurements);
    invalid.layers[0].quality[0] = quality;
    expect(ColorMeasurementsSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects wrong cutoff order, increasing coverage and quality below admission", () => {
    for (const mutate of [
      (value: typeof measurements) => {
        value.layers[0].cutoff = 0.25;
      },
      (value: typeof measurements) => {
        value.layers[1].coverage[0] = 10000;
        value.layers[0].coverage[0] = 0;
      },
      (value: typeof measurements) => {
        value.layers[4].coverage[0] = 1;
        value.layers[4].quality[0] = 0;
      },
    ]) {
      const invalid = structuredClone(measurements);
      mutate(invalid);
      expect(ColorMeasurementsSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
