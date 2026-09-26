import { describe, expect, it } from "vitest";
import {
  WallpaperUploadedCloudEventSchema,
  WallpaperVariantUploadedEventSchema,
  ProfileUpdatedEventSchema,
} from "../src/index.js";

describe("logical asset contracts", () => {
  it("accepts an uploaded original using its producer-owned asset identity", () => {
    const parsed = WallpaperUploadedCloudEventSchema.safeParse({
      specversion: "1.0",
      id: "upload-1",
      source: "https://wallpaperdb/ingestor",
      type: "wallpaper.uploaded",
      time: "2026-01-01T00:00:00.000Z",
      datacontenttype: "application/json",
      data: {
        wallpaper: {
          id: "wallpaper-1",
          userId: "profile-1",
          fileType: "image",
          mimeType: "image/png",
          fileSizeBytes: 100,
          width: 1920,
          height: 1080,
          aspectRatio: 1920 / 1080,
          asset: { owner: "ingestor", id: "wallpaper-1" },
          uploadedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a generated variant with a logical asset instead of storage coordinates", () => {
    expect(
      WallpaperVariantUploadedEventSchema.safeParse({
        eventId: "variant-1",
        eventType: "wallpaper.variant.uploaded",
        timestamp: "2026-01-01T00:00:00.000Z",
        variant: {
          wallpaperId: "wallpaper-1",
          width: 1280,
          height: 720,
          aspectRatio: 1280 / 720,
          format: "image/png",
          fileSizeBytes: 100,
          createdAt: "2026-01-01T00:00:00.000Z",
          asset: { owner: "variant-generator", id: "wallpaper-1:1280x720:image/png" },
        },
      }).success
    ).toBe(true);
  });

  it("announces a picture using a logical reference without storage coordinates", () => {
    const time = "2026-01-01T00:00:00.000Z";
    expect(
      ProfileUpdatedEventSchema.safeParse({
        eventId: "picture-event",
        eventType: "profile.updated",
        timestamp: time,
        profile: {
          id: "profile-1",
          displayName: "Test",
          handle: "test",
          claimGeneration: 1,
          biographyMarkdown: "",
          pictureAssetId: "picture-1",
          version: 2,
          createdAt: time,
          updatedAt: time,
        },
        change: {
          type: "picture-changed",
          before: null,
          after: "picture-1",
          source: "upload",
          asset: {
            id: "picture-1",
            reference: { owner: "user", id: "picture-1" },
            mimeType: "image/webp",
            width: 1600,
            height: 900,
            fileSizeBytes: 100,
          },
        },
      }).success
    ).toBe(true);
  });
});
