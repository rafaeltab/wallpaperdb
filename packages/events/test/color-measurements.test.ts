import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { COLOR_ANCHORS, ColorMeasurementsSchema } from "../src/index.js";

const fixtures = JSON.parse(
  await readFile(
    new URL("../../../apps/color-extractor/test/fixtures/prototype/expected.json", import.meta.url),
    "utf8"
  )
);
const measurements = fixtures.cases[0].measurements;

describe("versioned color measurement contract", () => {
  it("accepts every complete frozen prototype descriptor", () => {
    for (const fixture of fixtures.cases)
      expect(ColorMeasurementsSchema.safeParse(fixture.measurements).success).toBe(true);
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
