import { describe, expect, it } from "vitest";
import * as events from "../src/index.js";
import * as colorVocabulary from "@wallpaperdb/events/color-vocabulary";

describe("shared event contracts", () => {
  it("shares descriptor geometry through the pure vocabulary without exposing event schemas", () => {
    expect(colorVocabulary.COLOR_ANCHORS).toBe(events.COLOR_ANCHORS);
    expect(colorVocabulary.COLOR_CUTOFFS).toBe(events.COLOR_CUTOFFS);
    expect(colorVocabulary.COLOR_FEATURE_NAMES).toBe(events.COLOR_FEATURE_NAMES);
    expect(colorVocabulary).not.toHaveProperty("ColorMeasurementsSchema");
    expect(colorVocabulary).not.toHaveProperty("WallpaperColorsExtractedEventSchema");
  });

  it("does not expose broker runners that bypass application-owned delivery guarantees", () => {
    expect(events).not.toHaveProperty("BaseEventConsumer");
    expect(events).not.toHaveProperty("BaseEventPublisher");
  });
});
