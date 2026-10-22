import { expect, it } from "vitest";
import { WallpaperPublishedSchema } from "../src/schemas/index.js";
it("identifies the committed Wallpaper Asset and stable analysis provenance without storage ownership", () => {
  const data = {
    wallpaperId: "wallpaper-1",
    contributorId: "creator-1",
    assetId: "asset-1",
    firstSourceId: "source-1",
    initialAnalysisSourceId: "source-1",
  };
  expect(WallpaperPublishedSchema.parse(data)).toEqual(data);
  expect(WallpaperPublishedSchema.safeParse({ ...data, storageKey: "private/path" }).success).toBe(
    false
  );
  expect(WallpaperPublishedSchema.safeParse({ ...data, variants: [] }).success).toBe(false);
});
